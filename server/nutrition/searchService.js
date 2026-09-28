// ------------------------------------------------------------
// Search service — extends the resolver's corpus $text search with:
//   1. seed-row alias matching (transliterations: "ethakka appam",
//      "mutta curry", …)
//   2. tolerant token matching (reasonable spelling variations:
//      "parotta"/"porotta", "idli"/"idly", "paneer"/"panir", …)
//   3. matchType classification so the client can label results:
//      exact | approximate | branded | custom
//
// The corpus stays the single source of nutrition truth — this layer only
// changes WHICH rows are found and HOW confidently they are labeled.
// ------------------------------------------------------------

const { SEED_DOCS } = require("./keralaSeeds");

// ---------------- text normalization ----------------

function normalizeText(s) {
    return String(s || "").trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}

function tokens(s) {
    const t = normalizeText(s).split(" ").filter(Boolean);
    return t;
}

// Common transliteration/spelling variants — a small deterministic map, not
// a fuzzy guesser. Both sides of the pair normalize to the same key.
const VARIANT_GROUPS = [
    ["appam", "apam", "appa"],
    ["porotta", "parotta", "porota", "poritha"],
    ["idli", "idly", "iddelee"],
    ["vada", "wada", "vade", "vadai"],
    ["paneer", "panir", "paneer"],
    ["curry", "kari", "kuzhambu", "korma", "kurma"],
    ["chicken", "chicken"],
    ["egg", "mutta", "anda"],
    ["fish", "meen", "machli"],
    ["banana", "kela", "ethakka", "ethapazham", "pazham", "plantain"],
    ["bread", "brd"],
    ["omelette", "omelet", "omlette", "omlet"],
    ["momos", "momo", "momoa"],
    ["noodles", "noodle", "maggi"],
    ["sambar", "sambhar", "sambal", "sambur"],
    ["chapati", "chappati", "chappathi", "roti", "phulka", "fulka"],
    ["puttu", "pittu"],
    ["idiyappam", "idiyappem", "noolputtu"],
    ["pazham", "pazhm"],
    ["biryani", "biriyani", "biriani", "briyani"],
    ["parippu", "paripp", "dal", "daal", "dhal"],
    ["thoran", "thoranam", "poriyal"],
    ["butter", "butter"],
    ["shake", "shakes"],
    ["sandwich", "sandwhich", "sandwitch"],
    ["protein", "proten"],
    ["oats", "oat", "oatmeal"],
    ["peanut", "groundnut"],
];

const VARIANT_OF = new Map();
for (const group of VARIANT_GROUPS) {
    for (const w of group) VARIANT_OF.set(w, group[0]);
}
const canonicalWord = (w) => VARIANT_OF.get(w) || w;

/** Token-wise similarity for reasonable spelling variations (Damerau-ish, cheap). */
function tokenSimilarity(a, b) {
    if (a === b) return 1;
    const ca = canonicalWord(a);
    const cb = canonicalWord(b);
    if (ca === cb) return 0.95;
    // same first letter + levenshtein distance 1 → likely a typo
    if (a[0] === b[0] && Math.abs(a.length - b.length) <= 1) {
        const dist = lev1(a, b);
        if (dist) return 0.85;
    }
    return 0;
}

function lev1(a, b) {
    // true if edit distance (insert/delete/substitute) <= 1
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (la > lb) i++;
        else if (lb > la) j++;
        else { i++; j++; }
    }
    if (i < la || j < lb) edits++;
    return edits <= 1;
}

// ---------------- alias index (built once, in memory) ----------------

const aliasIndex = []; // { alias, fdcId, words }
for (const d of SEED_DOCS) {
    for (const alias of d.aliases || []) {
        aliasIndex.push({ alias, fdcId: d.fdcId, words: tokens(alias) });
    }
}

function matchSeedAlias(qTokens) {
    let best = null; // { fdcId, ratio }
    for (const e of aliasIndex) {
        const ratio = tokenSetRatio(qTokens, e.words);
        if (ratio >= 0.6 && (!best || ratio > best.ratio)) {
            best = { fdcId: e.fdcId, ratio };
        }
    }
    return best;
}

function tokenSetRatio(aTokens, bTokens) {
    if (aTokens.length === 0 || bTokens.length === 0) return 0;
    let matched = 0;
    for (const bt of bTokens) {
        let m = 0;
        for (const at of aTokens) m = Math.max(m, tokenSimilarity(at, bt));
        matched += m;
    }
    return matched / bTokens.length;
}

// ---------------- result classification ----------------

/**
 * Classify how closely a corpus row matches the query.
 * exact      — normalized query is contained in the name/alias nearly fully
 * approximate— partial overlap / spelling-tolerant hit
 * branded    — row has a real brand (or is a seed brand row)
 * Seed rows also match against their aliases, so "ethakka appam" classifies
 * as an exact hit for "Pazham pori (ethakka appam)".
 */
function classifyMatch(queryTokens, row, aliases) {
    const nameTokens = tokens(row.name);
    let overlap = tokenSetRatio(queryTokens, nameTokens);
    for (const alias of aliases || []) {
        const a = tokenSetRatio(queryTokens, tokens(alias));
        if (a > overlap) overlap = a;
    }
    if (row.brand) return { matchType: "branded", matchScore: overlap };
    if (overlap >= 0.9) return { matchType: "exact", matchScore: overlap };
    return { matchType: "approximate", matchScore: overlap };
}

// ---------------- public API ----------------

/**
 * Extended search over the corpus collection.
 * Returns { rows, matchType, aliasHit } — rows are corpus-shaped documents.
 */
async function searchFoods(coll, query, { limit = 12 } = {}) {
    const q = String(query || "").trim();
    const qTokens = tokens(q);
    if (qTokens.length === 0) return { rows: [], matchType: "none", aliasHit: null };

    // 1) direct $text search (USDA stemming handles the english cases)
    let docs = [];
    try {
        docs = await coll
            .find({ $text: { $search: q.replace(/[^a-zA-Z0-9\s]/g, " ") } }, { projection: { score: { $meta: "textScore" } } })
            .sort({ score: { $meta: "textScore" } })
            .limit(40)
            .toArray();
    } catch {
        docs = [];
    }

    // 2) alias match for seed rows (transliterations that $text cannot see —
    //    aliases live in a separate field)
    const aliasHit = qTokens.length >= 1 ? matchSeedAlias(qTokens) : null;
    if (aliasHit) {
        const seedRow = SEED_DOCS.find((d) => d.fdcId === aliasHit.fdcId);
        if (seedRow && !docs.some((d) => d.fdcId === seedRow.fdcId)) {
            docs = [seedRow, ...docs];
        }
    }

    if (docs.length === 0) return { rows: [], matchType: "none", aliasHit: null };

    // 3) classify + sort: alias hits first, then text score, then popularity
    const rows = docs
        .map((d) => toSearchRow(d))
        .map((r) => {
            const seed = SEED_DOCS.find((s) => String(s.fdcId) === r.foodId);
            return { ...r, ...classifyMatch(qTokens, r, seed ? seed.aliases : null) };
        })
        .sort((a, b) => {
            const aliasA = aliasHit && a.foodId === String(aliasHit.fdcId) ? 1 : 0;
            const aliasB = aliasHit && b.foodId === String(aliasHit.fdcId) ? 1 : 0;
            if (aliasA !== aliasB) return aliasB - aliasA;
            if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
            return (a.popularityRank ?? 1e9) - (b.popularityRank ?? 1e9);
        })
        .slice(0, limit);

    const top = rows[0];
    const topIsAlias = aliasHit && top.foodId === String(aliasHit.fdcId);
    const matchType = topIsAlias ? "exact" : top.matchType;
    return { rows, matchType, aliasHit };
}

function toSearchRow(d) {
    return {
        foodId: String(d.fdcId),
        name: d.name,
        brand: d.brand || null,
        category: d.category || null,
        cuisine: d.cuisine || null,
        source: d.source || null,
        servingSizeG: d.servingSizeG ?? null,
        portionPerUnitG: d.portionPerUnitG ?? null,
        energyKcal: d.kcal ?? null,
        popularityRank: d.popularityRank ?? null,
        license: d.license || null,
    };
}

module.exports = {
    normalizeText,
    tokens,
    canonicalWord,
    tokenSimilarity,
    tokenSetRatio,
    classifyMatch,
    searchFoods,
    toSearchRow,
};
