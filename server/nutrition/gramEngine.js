// ------------------------------------------------------------
// The gram engine.
//
// Port of Nut AI's @nutai/gram-engine (AGPL-3.0 — see LICENSE-NUTAI.md),
// consolidated into one CommonJS module: reconciliation ladder, bands,
// density, volume heuristics, cooking yields / oil absorption, personal
// priors and reference-object scale priors.
//
// This is where the accuracy actually lives. The model told us WHAT is on
// the plate and roughly what shape it is; this decides HOW MUCH, using
// deterministic tables — and the difference between those two jobs is the
// entire product thesis.
// ------------------------------------------------------------

// ====================== bands.ts ======================

const PATHWAY_BANDS = {
    packaged_exact: { halfPct: 0.02, anchor: "Exact printed serving arithmetic; label rounding only." },
    discrete_count: { halfPct: 0.125, anchor: "Counting is near-solved (87.5-93% zero-shot); per-unit weight is FNDDS-backed." },
    personal_prior: { halfPct: 0.1, anchor: "Derived from this user's own observed correction variance." },
    geometry_exact_ref: { halfPct: 0.175, anchor: "DPF-Nutrition mass PMAE 10.6%; GoCARB reference-card volumetry." },
    geometry_soft_ref: { halfPct: 0.275, anchor: "Above, plus the 23-33 cm dinner-plate diameter spread." },
    fndds_standard_portion: { halfPct: 0.375, anchor: 'ODU 2025 "predicted weight" tier: 39.5% carbohydrate MAPE.' },
    container_fill: { halfPct: 0.325, anchor: "Fill-fraction judgment is easy; the container volume table is unvalidated." },
    model_guess: { halfPct: 0.375, anchor: "Fridolfsson 2025: GPT-4o 36.3% weight MAPE, Claude 3.5 Sonnet 37.3%." },
    clamped: { halfPct: 0.5, anchor: "No basis — the value was out of physical bounds. Please check this." },
    user_edited: { halfPct: 0, anchor: "The user supplied this number. It is not an estimate." },
};

const MIXED_DISH_BAND = {
    halfPct: 0.45,
    anchor: "Lo 2024: MAE more than doubles single food -> mixed meal; Çınar 2026: up to 54% energy error on complex plates.",
};

const GROUND_MEAT_EXTRA = 0.08;
const UNKNOWN_BEVERAGE_EXTRA = 0.15;

function computeGramBand(inputs) {
    const base = PATHWAY_BANDS[inputs.pathway];
    let anchor = base ? base.anchor : "No basis — the value was out of physical bounds. Please check this.";

    // Pathway band is the literature-anchored FLOOR; measuredSpread is what
    // this scan observed. Take the larger, not quadrature — they describe the
    // same quantity from two directions and adding double-counts.
    const terms = [Math.max(base ? base.halfPct : 0.5, inputs.measuredSpread || 0)];
    if (inputs.isMixedDish) { terms.push(MIXED_DISH_BAND.halfPct); anchor = MIXED_DISH_BAND.anchor; }
    if (inputs.isGroundMeat) terms.push(GROUND_MEAT_EXTRA);
    if (inputs.isUnknownBeverage) terms.push(UNKNOWN_BEVERAGE_EXTRA);

    let halfPct = Math.sqrt(terms.reduce((s, t) => s + t * t, 0));

    // A trusted personal prior NARROWS the band — only in proportion to sample
    // count AND consistency. Noisy corrections keep it wide.
    if (inputs.pathway === "personal_prior" && inputs.priorSampleCount != null) {
        const countFactor = Math.min(1, 3 / Math.max(1, inputs.priorSampleCount));
        const noise = Math.sqrt(inputs.priorVariance || 0);
        halfPct = Math.max(0.06, halfPct * countFactor + noise);
    }

    // Never claim better than ±2%, never exceed ±80%.
    return { halfPct: Math.min(0.8, Math.max(0.02, halfPct)), anchor };
}

// ====================== reconcile.ts ======================

/** Relative disagreement above which two signals become a question, not a blend. */
const DISAGREEMENT_THRESHOLD = 0.35;
const GENERIC_FALLBACK_G = 150;
const GRAM_BOUNDS = [0.1, 3000];

function reconcile(candidates) {
    if (candidates.length === 0) {
        return { grams: GENERIC_FALLBACK_G, pathway: "clamped", spread: 0.5, forceLowConfidence: true };
    }
    const sorted = [...candidates].sort((a, b) => b.weight - a.weight);
    const best = sorted[0];
    if (!best) {
        return { grams: GENERIC_FALLBACK_G, pathway: "clamped", spread: 0.5, forceLowConfidence: true };
    }
    const rival = sorted[1];

    if (rival) {
        const disagreement = Math.abs(best.grams - rival.grams) / Math.max(best.grams, rival.grams, Number.EPSILON);
        if (disagreement > DISAGREEMENT_THRESHOLD) {
            // DO NOT SILENTLY AVERAGE. A large disagreement between two
            // independent signals is information — the one case where the app
            // knows it does not know. Surface it as a question.
            return {
                grams: best.grams,
                pathway: best.pathway,
                rivalGrams: rival.grams,
                rivalPathway: rival.pathway,
                surfaceDisagreementQuestion: true,
                spread: Math.max(best.spread, disagreement),
            };
        }
        // Close enough that the disagreement is not informative: blend the top
        // TWO only, weighted by trust. Never all candidates.
        const w = best.weight + rival.weight;
        return {
            grams: (best.grams * best.weight + rival.grams * rival.weight) / w,
            pathway: best.pathway,
            spread: Math.min(best.spread, rival.spread),
        };
    }
    return { grams: best.grams, pathway: best.pathway, spread: best.spread };
}

/** Hard bounds. Flags by switching pathway, never by truncating quietly. */
function clampGrams(estimate) {
    const [lo, hi] = GRAM_BOUNDS;
    const clamped = Math.min(hi, Math.max(lo, estimate.grams));
    if (clamped === estimate.grams) return estimate;
    return { ...estimate, grams: clamped, pathway: "clamped", forceLowConfidence: true };
}

// ====================== density.ts ======================

// Hand-authored table (FAO/INFOODS used as validation reference only — see
// Nut AI density.ts licensing header). The one important property: there is
// no universal density (raw salad 0.06 g/mL vs casserole 1.04 g/mL).
const DEFAULT_MIXED_DISH_DENSITY = 0.9;

const DENSITY_TABLE = {
    water: 1.0, "fruit juice": 1.06, "orange juice": 1.04, cola: 1.04, soda: 1.04,
    "whole milk": 1.03, milk: 1.03, "chicken noodle soup": 1.0, "tomato soup": 1.017,
    "vegetable soup": 0.99, "thick soup": 1.09, "heavy cream": 0.994,
    "corn oil": 0.922, "olive oil": 0.918, "vegetable oil": 0.92, "soybean oil": 0.927,
    "peanut oil": 0.914, lard: 0.919, mayonnaise: 0.91, butter: 0.911,
    "rice, cooked": 0.725, "white rice, cooked": 0.725, "rice, raw": 0.85,
    "pasta, cooked": 0.55, "pasta, raw": 0.39, "noodles, cooked": 0.59,
    "white bread": 0.35, "sliced bread": 0.29, "corn flakes": 0.11,
    "potato, boiled": 0.59, "sweet potato, boiled": 0.65, "carrot, raw, chopped": 0.54,
    "carrot, grated": 0.71, "cauliflower, boiled": 0.45,
    "spinach, raw": 0.08, "salad greens, raw": 0.06, "lettuce, raw": 0.06,
    "kidney beans, boiled": 0.79, "green beans, boiled": 0.7, "lentils, boiled": 0.85,
    "cowpeas, boiled": 0.75, "soybeans, boiled": 0.79,
    "beef, lean, raw": 0.96, "pork, fatty, raw": 0.97, "pork, fatty, boiled": 0.63, "egg, boiled": 0.6,
    "potato chips": 0.105, "puffed snack": 0.11,
    lasagna: 1.04, "macaroni and cheese": 1.0, "chicken and dumplings": 1.04,
    "beef stew": 1.05, "broccoli casserole": 0.95, "green bean casserole": 0.95,
    "cheese tortellini": 1.03, "tuna noodle casserole": 0.93, "eggplant parmesan": 0.83,
    moussaka: 0.85, "beef and noodles, no sauce": 0.65, "beef and noodles, in gravy": 1.04,
};

const FOOD_GROUP_DENSITY = {
    leafy_green: 0.08, cooked_grain: 0.65, raw_grain: 0.6, oil: 0.92,
    liquid: 1.0, soup: 1.02, legume: 0.78, root_vegetable: 0.6, meat: 1.0,
    snack: 0.11, mixed_dish: DEFAULT_MIXED_DISH_DENSITY,
};

const GROUP_KEYWORDS = [
    [/\b(lettuce|spinach|arugula|kale|salad greens|mixed greens)\b/, "leafy_green"],
    [/\b(oil|ghee|shortening)\b/, "oil"],
    [/\b(soup|broth|bisque|chowder)\b/, "soup"],
    [/\b(juice|water|soda|cola|milk|tea|coffee|smoothie)\b/, "liquid"],
    [/\b(rice|pasta|noodle|quinoa|couscous|barley|oats)\b.*\b(cooked|boiled|steamed)\b/, "cooked_grain"],
    [/\b(rice|pasta|noodle|quinoa|couscous|barley|oats)\b/, "cooked_grain"],
    [/\b(bean|lentil|chickpea|pea|legume)\b/, "legume"],
    [/\b(potato|carrot|beet|turnip|parsnip|yam)\b/, "root_vegetable"],
    [/\b(chicken|beef|pork|lamb|turkey|fish|salmon|steak|meat)\b/, "meat"],
    [/\b(chips|crisps|popcorn|puffs|cereal)\b/, "snack"],
];

function normalizeFoodKey(key) {
    return String(key || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Never returns "no density" — always resolves, recording which tier. */
function lookupDensity(canonicalFoodKey) {
    const key = normalizeFoodKey(canonicalFoodKey);
    const exact = DENSITY_TABLE[key];
    if (exact !== undefined) return { gPerMl: exact, tier: "exact", relativeSigma: 0.08 };

    // Try the leading food class before each comma: "rice, cooked, white" -> "rice, cooked" -> "rice".
    const parts = key.split(",").map((p) => p.trim());
    for (let i = parts.length; i > 0; i--) {
        const candidate = parts.slice(0, i).join(", ");
        const hit = DENSITY_TABLE[candidate];
        if (hit !== undefined) return { gPerMl: hit, tier: "exact", relativeSigma: 0.1 };
    }
    for (const [pattern, group] of GROUP_KEYWORDS) {
        if (pattern.test(key)) {
            const g = FOOD_GROUP_DENSITY[group];
            if (g !== undefined) return { gPerMl: g, tier: "food_group", relativeSigma: 0.2 };
        }
    }
    return { gPerMl: DEFAULT_MIXED_DISH_DENSITY, tier: "default", relativeSigma: 0.3 };
}

// ====================== volume.ts ======================

// INFERRED — no published source (Nut AI's declared unproven-number risk).
const FLAT_THICKNESS_CM = {
    chicken_breast: { min: 2.0, max: 2.5 },
    steak_or_chop: { min: 1.5, max: 2.5 },
    burger_patty: { min: 1.0, max: 1.5 },
    fish_fillet: { min: 1.0, max: 2.0 },
    pancake_or_flatbread: { min: 0.5, max: 1.0 },
};
const DEFAULT_FLAT_THICKNESS_CM = { min: 1.0, max: 2.0 };

const PILE_FACTORS = {
    leafy_salad: { min: 0.15, max: 0.25 },
    scooped_grain: { min: 0.3, max: 0.45 },
    loose_fries: { min: 0.35, max: 0.5 },
};
const DEFAULT_PILE_FACTOR = { min: 0.25, max: 0.4 };

const WRAPPED_PACKING_DENSITY = { min: 0.6, max: 0.8 };

const TABLESPOON_ML = 15;

// UNVALIDATED — population container volumes in mL (user-calibrated entries
// always preferred when available).
const CONTAINER_USABLE_ML = {
    cereal_bowl: 500, soup_plate: 350, mug: 300, drinking_glass: 350,
    wine_glass: 150, pint_glass: 470, takeout_container: 700, other: 400,
};

function midpoint(range) {
    const mid = (range.min + range.max) / 2;
    const relSigma = mid > 0 ? (range.max - range.min) / 2 / mid : 0.5;
    return { mid, relSigma };
}

function flatVolume(areaCm2, foodClass) {
    const range = (foodClass ? FLAT_THICKNESS_CM[foodClass] : undefined) || DEFAULT_FLAT_THICKNESS_CM;
    const { mid, relSigma } = midpoint(range);
    return { ml: areaCm2 * mid, relativeSigma: relSigma };
}

// Spherical cap on the segmented footprint.
function piledVolume(areaCm2, foodClass) {
    const range = (foodClass ? PILE_FACTORS[foodClass] : undefined) || DEFAULT_PILE_FACTOR;
    const { mid: pileFactor, relSigma } = midpoint(range);
    const r = Math.sqrt(areaCm2 / Math.PI);
    const h = pileFactor * r;
    const ml = ((Math.PI * h) / 6) * (3 * r * r + h * h);
    return { ml, relativeSigma: relSigma };
}

function liquidVolume(container, userContainers) {
    const usable = (userContainers && userContainers.get && userContainers.get(container.type)) || CONTAINER_USABLE_ML[container.type];
    if (usable === undefined) return null;
    const calibrated = !!(userContainers && userContainers.has && userContainers.has(container.type));
    return { ml: usable * container.fill_fraction, relativeSigma: calibrated ? 0.12 : 0.3 };
}

function wrappedVolume(bboxVolumeCm3) {
    const { mid, relSigma } = midpoint(WRAPPED_PACKING_DENSITY);
    return { ml: bboxVolumeCm3 * mid, relativeSigma: relSigma };
}

function spreadVolume(qualitativeSize) {
    const tablespoons = qualitativeSize === "small" ? 1 : qualitativeSize === "large" ? 3 : 2;
    return { ml: tablespoons * TABLESPOON_ML, relativeSigma: 0.5 };
}

function volumeForForm(input) {
    switch (input.form) {
        case "discrete":
            return null; // handled by counting; geometry never runs for discrete foods
        case "flat":
            return input.areaCm2 != null ? flatVolume(input.areaCm2, input.foodClass) : null;
        case "piled":
            return input.areaCm2 != null ? piledVolume(input.areaCm2, input.foodClass) : null;
        case "liquid":
            return input.container ? liquidVolume(input.container, input.userContainers) : null;
        case "wrapped":
            return input.bboxVolumeCm3 != null ? wrappedVolume(input.bboxVolumeCm3) : null;
        case "spread":
            return spreadVolume(input.qualitativeSize);
        default:
            return null;
    }
}

// ====================== yields.ts ======================

// CONFIRMED from the USDA Table of Cooking Yields for Meat and Poultry
// (Showell et al., 2012) — public domain as a US government work.
// THE LOAD-BEARING RULE: food-class-specific lookups only. There is no
// generic meat constant anywhere, and there must not be one.
const COOKING_YIELDS = {
    "chicken breast|baked": { yield: 0.72, range: [0.61, 0.82] },
    "chicken breast|roasted": { yield: 0.72, range: [0.61, 0.82] },
    "chicken breast|poached": { yield: 0.77, range: [0.7, 0.88] },
    "chicken breast|stewed": { yield: 0.77, range: [0.7, 0.88] },
    "chicken thigh|baked": { yield: 0.69, range: [0.58, 0.79] },
    "chicken thigh|poached": { yield: 0.74, range: [0.67, 0.82] },
    "chicken drumstick|baked": { yield: 0.76, range: [0.63, 0.87] },
    "chicken whole|baked": { yield: 0.78, range: [0.68, 0.84] },
    "chicken wing|baked": { yield: 0.74, range: [0.64, 0.83] },
    "chicken wing|deep_fried": { yield: 0.66, range: [0.53, 0.78] },
    "chicken back|baked": { yield: 0.61, range: [0.49, 0.71] },
    "ground beef high fat|fried": { yield: 0.62 },
    "ground beef high fat|baked": { yield: 0.63 },
    "ground beef high fat|grilled": { yield: 0.63 },
    "ground beef high fat|pan_broiled": { yield: 0.69 },
    "ground beef medium fat|grilled": { yield: 0.69 },
    "ground beef medium fat|pan_broiled": { yield: 0.73 },
    "ground beef low fat|fried": { yield: 0.69 },
    "ground beef low fat|baked": { yield: 0.72 },
    "ground beef low fat|grilled": { yield: 0.73 },
    "ground beef low fat|pan_broiled": { yield: 0.77 },
    "pork backribs|baked": { yield: 0.82 },
    "bacon|baked": { yield: 0.32 },
    "bacon|pan_fried": { yield: 0.31 },
    "bacon|microwaved": { yield: 0.29 },
    "ham cured|baked": { yield: 0.96 },
    "pork loin chop|braised": { yield: 0.74 },
    "pork shoulder steak|braised": { yield: 0.65 },
};

// Grain dry-to-cooked mass ratios (reported, secondary references).
const GRAIN_YIELDS = { pasta: 2.25, "white rice": 3.0, rice: 3.0, "brown rice": 2.5 };

// Oil absorbed during frying, as a fraction of the food's own mass.
const OIL_ABSORPTION = {
    deep_fried_potato: 0.25, doughnut: 0.22, battered_fried_meat: 0.12,
    tempura_vegetable: 0.15, pan_fried_generic: 0.06,
};

const OIL_TRIGGER_CUES = new Set(["deep_fried_color", "batter_or_breading", "visible_oil_pooling"]);
const PAN_FRY_CUES = new Set(["visible_oil_sheen"]);

function normalizeKey(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function methodFromCues(cues) {
    if (cues.includes("deep_fried_color")) return "deep_fried";
    if (cues.includes("grill_marks") || cues.includes("char")) return "grilled";
    if (cues.includes("boiled")) return "poached";
    if (cues.includes("steamed_no_browning")) return "poached";
    if (cues.includes("dry_surface")) return "baked";
    if (cues.includes("visible_oil_pooling") || cues.includes("visible_oil_sheen")) return "pan_fried";
    return null;
}

function lookupYield(foodClass, method) {
    if (!method) return null;
    const key = `${normalizeKey(foodClass)}|${method}`;
    return COOKING_YIELDS[key] || null;
}

function oilAbsorptionFor(foodClass, cues, massG) {
    const key = normalizeKey(foodClass);
    const triggered = cues.some((c) => OIL_TRIGGER_CUES.has(c));
    const panOnly = !triggered && cues.some((c) => PAN_FRY_CUES.has(c));
    if (!triggered && !panOnly) return null;

    let absorptionClass = "pan_fried_generic";
    if (triggered) {
        if (/\b(fries|french fries|potato|chips|hash brown|tots)\b/.test(key)) absorptionClass = "deep_fried_potato";
        else if (/\b(doughnut|donut|beignet|churro)\b/.test(key)) absorptionClass = "doughnut";
        else if (/\b(tempura)\b/.test(key)) absorptionClass = "tempura_vegetable";
        else if (cues.includes("batter_or_breading") || /\b(fried chicken|katsu|schnitzel|nugget)\b/.test(key)) absorptionClass = "battered_fried_meat";
        else absorptionClass = "battered_fried_meat";
    }
    const rate = OIL_ABSORPTION[absorptionClass];
    if (rate === undefined) return null;
    return { addedOilGrams: massG * rate, absorptionClass };
}

function isWideYieldClass(foodClass) {
    return /\b(ground beef|ground meat|mince|burger|meatball|meatloaf)\b/.test(normalizeKey(foodClass));
}

// ====================== reference-objects.ts ======================

// Ranked by SIZE VARIANCE, not by how often the object appears.
const REFERENCE_DIMENSIONS = {
    credit_card: { mm: 85.6, sigmaMm: 0.0, tier: "exact" }, // ISO/IEC 7810 ID-1
    drink_can_12oz: { mm: 66.0, sigmaMm: 1.0, tier: "high" },
    smartphone: { mm: 147.0, sigmaMm: 8.0, tier: "high" },
    cereal_bowl: { mm: 190, sigmaMm: 20, tier: "medium" },
    dinner_plate: { mm: 280, sigmaMm: 30, tier: "medium" },
    salad_plate: { mm: 200, sigmaMm: 20, tier: "medium" },
    soup_plate: { mm: 230, sigmaMm: 20, tier: "medium" },
    dessert_plate: { mm: 200, sigmaMm: 15, tier: "medium" },
    bread_plate: { mm: 165, sigmaMm: 15, tier: "medium" },
    // Qualitative only — NEVER used to derive cm_per_px.
    hand: { mm: 183, sigmaMm: 15, tier: "qualitative" },
    fork: { mm: 190, sigmaMm: 25, tier: "qualitative" },
    spoon: { mm: 175, sigmaMm: 25, tier: "qualitative" },
    tablespoon: { mm: 0, sigmaMm: 0, tier: "qualitative" },
    chopsticks: { mm: 240, sigmaMm: 20, tier: "qualitative" },
    coin: { mm: 24, sigmaMm: 4, tier: "qualitative" },
    drinking_glass: { mm: 75, sigmaMm: 15, tier: "qualitative" },
    mug: { mm: 95, sigmaMm: 15, tier: "qualitative" },
    none: { mm: 0, sigmaMm: 0, tier: "qualitative" },
};

const TIER_RANK = { exact: 0, high: 1, medium: 2, qualitative: 3 };
const MIN_REFERENCE_CONFIDENCE = 0.5;

function longestBboxSpanPx(bbox, imageWidthPx, imageHeightPx) {
    const w = (bbox[2] || 0) * imageWidthPx;
    const h = (bbox[3] || 0) * imageHeightPx;
    return Math.max(w, h);
}

function scaleFromReferences(refs, imageWidthPx, imageHeightPx) {
    const usable = refs
        .filter((r) => REFERENCE_DIMENSIONS[r.type] && REFERENCE_DIMENSIONS[r.type].tier !== "qualitative")
        .filter((r) => r.confidence >= MIN_REFERENCE_CONFIDENCE)
        .sort((a, b) => TIER_RANK[REFERENCE_DIMENSIONS[a.type].tier] - TIER_RANK[REFERENCE_DIMENSIONS[b.type].tier]);

    const best = usable[0];
    if (!best) return null;

    const dim = REFERENCE_DIMENSIONS[best.type];
    const pxSpan = longestBboxSpanPx(best.bbox, imageWidthPx, imageHeightPx);
    if (pxSpan <= 0) return null;
    return {
        cmPerPx: dim.mm / 10 / pxSpan,
        relativeSigma: dim.sigmaMm / dim.mm,
        sourceType: best.type,
        tier: dim.tier,
    };
}

// ====================== priors.ts ======================

const EWMA_ALPHA = 0.3;
const MIN_SAMPLES_TO_TRUST = 3;

function updatePrior(existing, foodConceptKey, modelEstimateG, userFinalG, now) {
    if (modelEstimateG <= 0) {
        return {
            foodConceptKey,
            ewmaRatio: existing ? existing.ewmaRatio : 1,
            ratioVariance: existing ? existing.ratioVariance : 0,
            sampleCount: (existing ? existing.sampleCount : 0) + 1,
            medianGrams: userFinalG,
            lastCorrectedAt: now,
        };
    }
    const ratio = userFinalG / modelEstimateG;
    if (!existing) {
        return { foodConceptKey, ewmaRatio: ratio, ratioVariance: 0, sampleCount: 1, medianGrams: userFinalG, lastCorrectedAt: now };
    }
    const ewmaRatio = EWMA_ALPHA * ratio + (1 - EWMA_ALPHA) * existing.ewmaRatio;
    const delta = ratio - existing.ewmaRatio;
    const ratioVariance = (1 - EWMA_ALPHA) * (existing.ratioVariance + EWMA_ALPHA * delta * delta);
    return {
        foodConceptKey,
        ewmaRatio,
        ratioVariance,
        sampleCount: existing.sampleCount + 1,
        medianGrams: existing.medianGrams == null ? userFinalG : existing.medianGrams + (userFinalG - existing.medianGrams) * EWMA_ALPHA,
        lastCorrectedAt: now,
    };
}

function isTrusted(prior) {
    return prior != null && prior.sampleCount >= MIN_SAMPLES_TO_TRUST;
}

/** Adjusts the estimate; never hard-overrides (disclosure belongs to the UI). */
function applyPrior(prior, modelEstimateG) {
    return modelEstimateG * prior.ewmaRatio;
}

const NOISE_WORDS = new Set([
    "grilled", "baked", "roasted", "fried", "boiled", "steamed", "raw", "cooked",
    "fresh", "homemade", "organic", "plain", "seasoned", "a", "an", "the", "with",
    "and", "of", "style", "sliced", "chopped", "diced", "whole", "large", "small", "medium",
]);
const SYNONYMS = { chix: "chicken", chik: "chicken", veggie: "vegetable", veggies: "vegetable", potatoes: "potato", tomatoes: "tomato" };

function canonicalConceptKey(name, resolvedFoodId) {
    if (resolvedFoodId) return `fdc:${resolvedFoodId}`;
    const tokens = String(name || "").toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/).filter(Boolean)
        .map((t) => SYNONYMS[t] || t)
        .map((t) => (t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t))
        .filter((t) => !NOISE_WORDS.has(t))
        .sort();
    return tokens.join(" ") || String(name || "").toLowerCase().trim();
}

// ====================== the engine ======================

function parseCount(qualitativeSize) {
    const m = /^count:(\d+(?:\.\d+)?)$/.exec(qualitativeSize);
    if (!m || !m[1]) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Tier 0 — packaged / label short-circuit. Exact arithmetic, no estimation. */
function exactServingArithmetic(resolved, servings) {
    const perServing = resolved && resolved.servingSizeG;
    if (perServing == null || perServing <= 0) return null;
    return { grams: perServing * servings, pathway: "packaged_exact", spread: 0.02 };
}

function finish(estimate, input) {
    const { item } = input;
    const isUnknownBeverage =
        item.is_beverage &&
        (item.beverage_category === "alcoholic_poured_or_mixed" ||
            item.beverage_category === "blended_shake_or_smoothie");

    const band = computeGramBand({
        pathway: estimate.pathway,
        measuredSpread: estimate.spread,
        isMixedDish: input.isMixedDish || false,
        isGroundMeat: isWideYieldClass(item.canonical_food_key),
        isUnknownBeverage,
        priorSampleCount: estimate.personalPriorApplied ? estimate.personalPriorApplied.sampleCount : undefined,
    });
    return { ...estimate, halfPct: band.halfPct, bandAnchor: band.anchor };
}

/**
 * The 6-tier reconciliation ladder. `db.fnddsPortionGrams(foodId, measure)`
 * is the corpus adapter (MongoDB here, SQLite in Nut AI).
 */
function estimateGrams(input) {
    const { item, priors, db, resolved } = input;

    // ---- Tier 0: packaged / label. No estimation at all. ----------------
    if ((input.barcodeMatch === true || item.legible_label_text != null) && resolved) {
        const exact = exactServingArithmetic(resolved, input.servingsConsumed || 1);
        if (exact) return finish(exact, input);
    }

    // ---- Tier 1: discrete count. The cheapest accuracy win. -------------
    const count = parseCount(item.qualitative_size);
    if (item.food_form === "discrete" && count != null && resolved) {
        const perUnit = db.fnddsPortionGrams(resolved.foodId, "per_unit");
        if (perUnit != null && perUnit > 0) {
            return finish({ grams: perUnit * count, pathway: "discrete_count", spread: 0.125 }, input);
        }
    }

    const candidates = [];
    const conceptKey = canonicalConceptKey(item.canonical_food_key, resolved ? resolved.foodId : null);
    const prior = priors.get(conceptKey);

    // ---- Tier 2: personal prior (>= 3 corrections). ----------------------
    if (isTrusted(prior) && item.model_gram_estimate != null) {
        candidates.push({
            grams: applyPrior(prior, item.model_gram_estimate),
            pathway: "personal_prior",
            weight: 0.9,
            spread: Math.sqrt(prior.ratioVariance),
        });
    }

    // ---- Tier 3: reference-object-calibrated geometry. -------------------
    const scale = input.imageWidthPx != null && input.imageHeightPx != null
        ? scaleFromReferences(item.visible_reference_objects, input.imageWidthPx, input.imageHeightPx)
        : null;
    if (scale && scale.tier !== "qualitative") {
        const vol = volumeForForm({
            form: item.food_form,
            areaCm2: input.areaCm2,
            bboxVolumeCm3: input.bboxVolumeCm3,
            container: item.container,
            qualitativeSize: item.qualitative_size,
            userContainers: priors.containers,
        });
        if (vol) {
            const density = lookupDensity(item.canonical_food_key);
            candidates.push({
                grams: vol.ml * density.gPerMl,
                pathway: scale.tier === "exact" ? "geometry_exact_ref" : "geometry_soft_ref",
                weight: scale.tier === "exact" ? 0.85 : 0.6,
                spread: Math.sqrt(scale.relativeSigma ** 2 + density.relativeSigma ** 2 + vol.relativeSigma ** 2),
            });
        }
    }

    // ---- Tier 4: FNDDS standard portion keyed to qualitative size. -------
    if (resolved && ["small", "medium", "large"].includes(item.qualitative_size)) {
        const g = db.fnddsPortionGrams(resolved.foodId, item.qualitative_size);
        if (g != null && g > 0) {
            candidates.push({ grams: g, pathway: "fndds_standard_portion", weight: 0.55, spread: 0.25 });
        }
    }

    // ---- Tier 4b: container fill, for liquids. ---------------------------
    if (item.food_form === "liquid" && item.container) {
        const vol = volumeForForm({
            form: "liquid",
            container: item.container,
            qualitativeSize: item.qualitative_size,
            userContainers: priors.containers,
        });
        if (vol) {
            const density = lookupDensity(item.canonical_food_key);
            candidates.push({
                grams: vol.ml * density.gPerMl,
                pathway: "container_fill",
                weight: 0.5,
                spread: Math.sqrt(vol.relativeSigma ** 2 + density.relativeSigma ** 2),
            });
        }
    }

    // ---- Tier 5: the model's own guess. Lowest trust, widest band. -------
    // A trusted prior is computed AS model_gram_estimate x ewmaRatio — the
    // same signal before and after the user's correction. When the prior is
    // driving, the raw guess does not also get a vote.
    const priorIsDriving = isTrusted(prior) && item.model_gram_estimate != null;
    if (item.model_gram_estimate != null && !priorIsDriving) {
        candidates.push({ grams: item.model_gram_estimate, pathway: "model_guess", weight: 0.25, spread: 0.4 });
    }

    let out = reconcile(candidates);

    if (isTrusted(prior) && out.pathway === "personal_prior") {
        out = { ...out, personalPriorApplied: { medianGrams: prior.medianGrams, sampleCount: prior.sampleCount } };
    }

    out = applyYieldFactor(out, item, resolved);
    out = applyOilCorrection(out, item);
    out = clampGrams(out);

    return finish(out, input);
}

/** Cooked/raw basis conversion (rarely needed — USDA rows carry cooked states). */
function applyYieldFactor(estimate, item, _resolved) {
    if (item.weight_basis !== "raw") return estimate;
    const method = methodFromCues(item.cooking_method_cues);
    const entry = lookupYield(item.canonical_food_key, method);
    if (!entry) return estimate;
    const grams = estimate.grams / entry.yield;
    const rangeSpread = entry.range ? (entry.range[1] - entry.range[0]) / 2 / entry.yield : 0.05;
    return { ...estimate, grams, spread: Math.sqrt(estimate.spread ** 2 + rangeSpread ** 2) };
}

/** Add absorbed frying oil to the mass (fat row applied by the pipeline). */
function applyOilCorrection(estimate, item) {
    const oil = oilAbsorptionFor(item.canonical_food_key, item.cooking_method_cues, estimate.grams);
    if (!oil) return estimate;
    return { ...estimate, grams: estimate.grams + oil.addedOilGrams, addedOilGrams: oil.addedOilGrams };
}

module.exports = {
    PATHWAY_BANDS, MIXED_DISH_BAND, GROUND_MEAT_EXTRA, UNKNOWN_BEVERAGE_EXTRA, computeGramBand,
    DISAGREEMENT_THRESHOLD, GENERIC_FALLBACK_G, GRAM_BOUNDS, reconcile, clampGrams,
    DEFAULT_MIXED_DISH_DENSITY, DENSITY_TABLE, FOOD_GROUP_DENSITY, lookupDensity, normalizeFoodKey,
    FLAT_THICKNESS_CM, PILE_FACTORS, WRAPPED_PACKING_DENSITY, TABLESPOON_ML, CONTAINER_USABLE_ML,
    flatVolume, piledVolume, liquidVolume, wrappedVolume, spreadVolume, volumeForForm,
    COOKING_YIELDS, GRAIN_YIELDS, OIL_ABSORPTION, normalizeKey, methodFromCues,
    lookupYield, oilAbsorptionFor, isWideYieldClass,
    REFERENCE_DIMENSIONS, MIN_REFERENCE_CONFIDENCE, longestBboxSpanPx, scaleFromReferences,
    EWMA_ALPHA, MIN_SAMPLES_TO_TRUST, updatePrior, isTrusted, applyPrior, canonicalConceptKey,
    parseCount, estimateGrams, applyYieldFactor, applyOilCorrection,
};
