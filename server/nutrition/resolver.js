// ------------------------------------------------------------
// Nutrition resolution — food text/ID to corpus row.
//
// Port of Nut AI's @nutai/resolver (AGPL-3.0 — see LICENSE-NUTAI.md).
// The stage between "the model says this is grilled chicken breast" and
// "165 kcal per 100 g, from USDA row 171077".
//
// Everything here is offline (MongoDB only — no external API), which is
// what makes the whole correction loop free and instant.
//
// SQLite FTS5 is replaced by MongoDB $text (English stemming via the
// english stopwords/language rules). The match ladder, six-signal scoring
// and two-part auto-accept rule are carried over unchanged.
// ------------------------------------------------------------

const WEIGHTS = {
    bm25: 0.35,
    brandMatch: 0.2, // directly-observed packaging text is an observation
    prepMatch: 0.1,
    categoryPrior: 0.1,
    portionPlausibility: 0.1,
    popularityPrior: 0.1,
    basisAmbiguityPenalty: 0.15,
};

// Auto-accept thresholds. BOTH must hold (absolute floor + relative gap).
const AUTO_ACCEPT = { minScore: 0.6, minGap: 0.12 };

const RESOLUTION_OUTCOMES = ["auto_accepted", "needs_disambiguation", "miss"];

// ---------------- query construction ----------------

/** Tokens safe for a $text search (strip operator-ish characters). */
function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);
}

/**
 * Progressively broader search ladder. The full AND query is precise but
 * brittle: one token absent from the corpus returns zero rows even when the
 * rest matched. Drop the least-informative (trailing) tokens and retry — in
 * USDA-style names the head noun leads, so "chicken breast, grilled"
 * degrades to "chicken breast" rather than "grilled". Last rung ORs tokens.
 */
function searchLadder(canonicalFoodKey) {
    const tokens = tokenize(canonicalFoodKey);
    if (tokens.length === 0) return [];
    const ladder = [];
    for (let keep = tokens.length; keep >= 1; keep--) {
        const phrase = tokens.slice(0, keep).join(" ");
        if (!ladder.includes(phrase)) ladder.push(phrase);
    }
    if (tokens.length > 1) ladder.push(tokens.join(" ")); // $text ORs terms implicitly
    return ladder;
}

// ---------------- scoring signals ----------------

function normalizeText(s) {
    return String(s || "").trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}

/** 1.0 on exact brand match, 0 otherwise. */
function brandMatch(c, ctx) {
    if (!ctx.observedBrand || !c.brand) return 0;
    return normalizeText(c.brand) === normalizeText(ctx.observedBrand) ? 1 : 0;
}

/** 1.0 match / 0.5 unknown / 0 conflict — the 0.5 punishes generic rows least. */
function prepMatch(c, ctx) {
    if (!ctx.prepFacet) return 0.5;
    if (!c.prepFacet) return 0.5;
    return normalizeText(c.prepFacet) === normalizeText(ctx.prepFacet) ? 1 : 0;
}

/** A scoring PRIOR, never a hard filter. */
function categoryPrior(c, ctx) {
    if (!ctx.modelCategory || !c.category) return 0.5;
    return normalizeText(c.category) === normalizeText(ctx.modelCategory) ? 1 : 0;
}

/** How plausible this row is at the estimated mass (decays smoothly). */
function portionPlausibility(c, ctx) {
    if (ctx.estimatedGrams == null || ctx.estimatedGrams <= 0) return 0.5;
    const min = c.typicalMinG != null ? c.typicalMinG : c.servingSizeG != null ? c.servingSizeG * 0.25 : null;
    const max = c.typicalMaxG != null ? c.typicalMaxG : c.servingSizeG != null ? c.servingSizeG * 4 : null;
    if (min == null || max == null) return 0.5;
    if (ctx.estimatedGrams >= min && ctx.estimatedGrams <= max) return 1;
    const distance = ctx.estimatedGrams < min ? min / Math.max(ctx.estimatedGrams, 0.1) : ctx.estimatedGrams / max;
    return Math.max(0, 1 / distance);
}

/** Zipfian tie-break toward the more commonly logged row. */
function popularityPrior(c) {
    if (c.popularityRank == null || c.popularityRank <= 0) return 0.3;
    return 1 / (1 + Math.log10(c.popularityRank));
}

/** Subtracted when serving/energy metadata is incomplete. */
function basisAmbiguity(c) {
    let penalty = 0;
    if (c.completenessScore != null && c.completenessScore < 0.5) penalty += 0.3;
    if (c.energyKcal == null) penalty += 0.4;
    return Math.min(1, penalty);
}

/**
 * Map the result set's $text score onto 0-1 by its own range, so a query
 * whose best hit is weak does not get a free 1.0 for being best-of-a-bad-set
 * — the absolute auto-accept floor then catches it. Single/all-equal sets
 * get a neutral 0.5, not 1.0.
 */
function normalizeTextScores(docs) {
    const out = new Map();
    if (docs.length === 0) return out;
    const raw = docs.map((d) => (typeof d.textScore === "number" ? d.textScore : 0));
    const min = Math.min(...raw);
    const max = Math.max(...raw);
    const range = max - min;
    docs.forEach((d, i) => {
        out.set(d.foodId, range === 0 ? 0.5 : (raw[i] - min) / range);
    });
    return out;
}

function scoreCandidates(docs, ctx) {
    const textScores = normalizeTextScores(docs);
    return docs
        .map((d) => {
            const c = {
                foodId: d.foodId,
                name: d.name,
                brand: d.brand || null,
                category: d.category || null,
                cuisine: d.cuisine || null,
                prepFacet: d.prepFacet || null,
                servingSizeG: d.servingSizeG,
                energyKcal: d.energyKcal,
                popularityRank: d.popularityRank,
                completenessScore: d.completenessScore,
                typicalMinG: d.typicalMinG,
                typicalMaxG: d.typicalMaxG,
            };
            const parts = {
                bm25: textScores.get(c.foodId) || 0,
                brandMatch: brandMatch(c, ctx),
                prepMatch: prepMatch(c, ctx),
                categoryPrior: categoryPrior(c, ctx),
                portionPlausibility: portionPlausibility(c, ctx),
                popularityPrior: popularityPrior(c),
                basisAmbiguity: basisAmbiguity(c),
            };
            const score =
                WEIGHTS.bm25 * parts.bm25 +
                WEIGHTS.brandMatch * parts.brandMatch +
                WEIGHTS.prepMatch * parts.prepMatch +
                WEIGHTS.categoryPrior * parts.categoryPrior +
                WEIGHTS.portionPlausibility * parts.portionPlausibility +
                WEIGHTS.popularityPrior * parts.popularityPrior -
                WEIGHTS.basisAmbiguityPenalty * parts.basisAmbiguity;
            return { ...c, score: Math.max(0, Math.min(1, score)), breakdown: parts };
        })
        .sort((a, b) => b.score - a.score);
}

/**
 * The two-part auto-accept decision (see AUTO_ACCEPT above).
 */
function decideOutcome(scored) {
    const top = scored[0];
    if (!top) return { kind: "miss" };
    if (scored.length === 1) {
        return top.score >= AUTO_ACCEPT.minScore ? { kind: "auto_accepted", candidate: top } : { kind: "needs_disambiguation", candidates: scored.slice(0, 6) };
    }
    const gap = top.score - (scored[1] ? scored[1].score : 0);
    if (top.score >= AUTO_ACCEPT.minScore && gap >= AUTO_ACCEPT.minGap) {
        return { kind: "auto_accepted", candidate: top };
    }
    return { kind: "needs_disambiguation", candidates: scored.slice(0, 6) };
}

// ---------------- the adapter-facing resolver ----------------

/**
 * Resolve by free text over the corpus collection.
 * `ctx`: { canonicalFoodKey, observedBrand, prepFacet, modelCategory, estimatedGrams }
 * Returns { outcome, ladderStep, zeroHit, candidate?, candidates? }.
 */
async function resolveByText(coll, ctx) {
    const ladder = searchLadder(ctx.canonicalFoodKey);
    for (let step = 0; step < ladder.length; step++) {
        const phrase = ladder[step];
        if (!phrase) continue;
        let docs;
        try {
            docs = await coll
                .find({ $text: { $search: phrase } }, { projection: { textScore: { $meta: "textScore" } } })
                .sort({ textScore: { $meta: "textScore" } })
                .limit(50)
                .toArray();
        } catch {
            continue; // a malformed query must not take down a scan
        }
        if (docs.length === 0) continue;
        const mapped = docs.map((d) => ({
            foodId: String(d.fdcId),
            name: d.name,
            brand: d.brand || null,
            category: d.category || null,
            cuisine: d.cuisine || null,
            prepFacet: d.prepFacet || null,
            servingSizeG: d.servingSizeG ?? null,
            energyKcal: d.kcal ?? null,
            popularityRank: d.popularityRank ?? null,
            completenessScore: d.completeness ?? null,
            typicalMinG: d.typicalMinG ?? null,
            typicalMaxG: d.typicalMaxG ?? null,
            textScore: d.textScore,
        }));
        const scored = scoreCandidates(mapped, ctx);
        return { outcome: decideOutcome(scored), ladderStep: step, zeroHit: false };
    }
    return { outcome: { kind: "miss" }, ladderStep: ladder.length, zeroHit: true };
}

/** Food detail by corpus id. */
async function loadFood(coll, foodId) {
    const id = Number(foodId);
    if (!Number.isFinite(id)) return null;
    const d = await coll.findOne({ fdcId: id });
    if (!d) return null;
    return {
        foodId: String(d.fdcId),
        name: d.name,
        brand: d.brand || null,
        source: d.source,
        category: d.category || null,
        cuisine: d.cuisine || null,
        per100g: {
            kcal: d.kcal ?? null,
            protein_g: d.protein ?? null,
            fat_g: d.fat ?? null,
            carbs_g: d.carb ?? null,
            fiber_g: d.fiber ?? null,
            sugar_g: d.sugar ?? null,
            sodium_mg: d.sodium ?? null,
        },
        servingSizeG: d.servingSizeG ?? null,
        portionPerUnitG: d.portionPerUnitG ?? null,
        portionSmallG: d.portionSmallG ?? null,
        portionMediumG: d.portionMediumG ?? null,
        portionLargeG: d.portionLargeG ?? null,
        license: d.license || "CC0-1.0 (USDA FoodData Central)",
    };
}

module.exports = {
    WEIGHTS, AUTO_ACCEPT, RESOLUTION_OUTCOMES,
    tokenize, searchLadder, normalizeTextScores,
    brandMatch, prepMatch, categoryPrior, portionPlausibility, popularityPrior, basisAmbiguity,
    scoreCandidates, decideOutcome, resolveByText, loadFood,
};
