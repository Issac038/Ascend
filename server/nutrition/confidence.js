// ------------------------------------------------------------
// Confidence and calibration.
//
// Port of Nut AI's @nutai/confidence (AGPL-3.0 — see LICENSE-NUTAI.md).
//
// WHY THE MODEL'S OWN CONFIDENCE NUMBER IS NOT THE ANSWER: verbalized LLM
// confidence is measurably miscalibrated (Xiong et al., arXiv:2306.13063).
// The model's self-report is a MODIFIER, never the signal. The primary
// signal is measured per-pathway and per-category error — shipped as DATA
// with provenance, never fabricated as "measured".
// ------------------------------------------------------------

const FoodCategory = {
    WHOLE_FOOD: "whole_food",
    PACKAGED_LABELED: "packaged_labeled",
    SIMPLE_COOKED: "simple_cooked",
    MIXED_COMPOSITE: "mixed_composite",
    HIDDEN_FAT_LIKELY: "hidden_fat_likely",
    LIQUID: "liquid",
};

/** Never display a band wider than this — past it, say it in words instead. */
const MAX_DISPLAYED_HALF_PCT = 0.6;

// Measured baselines, shipped as DATA. All values still SEEDED from the
// literature table (see bands) — an eval harness regenerates these. The UI
// must never claim they are measured.
const SEEDED_BASELINES = {
    pathwayHalfPct: {
        packaged_exact: 0.02,
        discrete_count: 0.125,
        personal_prior: 0.1,
        geometry_exact_ref: 0.175,
        geometry_soft_ref: 0.275,
        fndds_standard_portion: 0.375,
        container_fill: 0.325,
        model_guess: 0.375,
        clamped: 0.5,
        user_edited: 0.0,
    },
    categoryHalfPct: {
        whole_food: 0.15,
        packaged_labeled: 0.03,
        simple_cooked: 0.25,
        mixed_composite: 0.45,
        hidden_fat_likely: 0.4,
        liquid: 0.3,
    },
    localPathMultiplier: 1.3,
    provenance: { all: "seeded" },
    generatedAt: null,
};

function bandTier(halfPct) {
    if (halfPct <= 0.05) return "none";
    if (halfPct <= 0.15) return "tight";
    if (halfPct <= 0.3) return "moderate";
    if (halfPct <= 0.45) return "wide";
    return "very_wide";
}

// Deliberately NOT a colour scale — uncertainty renders violet, never amber
// or red. Red is reserved for safety warnings only.
const TIER_GLYPH = { none: "●", tight: "◕", moderate: "◑", wide: "◔", very_wide: "○" };

function classifyCategory(item) {
    if (item.legible_label_text != null) return FoodCategory.PACKAGED_LABELED;
    if (item.is_beverage || item.food_form === "liquid") return FoodCategory.LIQUID;

    const key = String(item.canonical_food_key || "").toLowerCase();
    if (/\b(stir.?fry|curry|fried rice|saute|sautee|casserole|stew|lasagna|risotto|pad thai)\b/.test(key)) {
        return FoodCategory.MIXED_COMPOSITE;
    }
    if (
        item.cooking_method_cues.includes("deep_fried_color") ||
        item.cooking_method_cues.includes("visible_oil_pooling") ||
        item.cooking_method_cues.includes("batter_or_breading")
    ) {
        return FoodCategory.HIDDEN_FAT_LIKELY;
    }
    if (item.cooking_method_cues.some((c) => c !== "none_visible" && c !== "raw")) {
        return FoodCategory.SIMPLE_COOKED;
    }
    return FoodCategory.WHOLE_FOOD;
}

function isGroundMeat(item) {
    return /\b(ground beef|ground meat|mince|burger|meatball|meatloaf)\b/.test(
        String(item.canonical_food_key || "").toLowerCase(),
    );
}
function isPouredAlcohol(item) {
    return item.beverage_category === "alcoholic_poured_or_mixed";
}
function isBlendedShake(item) {
    return item.beverage_category === "blended_shake_or_smoothie";
}
function isDeepFried(item) {
    return (
        item.cooking_method_cues.includes("deep_fried_color") ||
        item.cooking_method_cues.includes("batter_or_breading")
    );
}

/** Steps 1-8 of §7.2, in order. */
function computeBand(input) {
    const { row, item, baselines, path } = input;
    const reasons = [];

    // 1. PRIMARY — measured half-width for the gram pathway actually used.
    let half = (baselines.pathwayHalfPct && baselines.pathwayHalfPct[row.gramPathway]) || 0.4;

    // 2. Category widening. A mixed dish is harder than its pathway suggests.
    const cat = classifyCategory(item);
    const catHalf = baselines.categoryHalfPct[cat];
    if (catHalf > half) {
        half = catHalf;
        if (cat === FoodCategory.MIXED_COMPOSITE) reasons.push("Mixed dishes are harder to estimate accurately.");
        if (cat === FoodCategory.HIDDEN_FAT_LIKELY) reasons.push("Cooking oil is not visible in a photo.");
    }

    // 3. Food-class widening for known structural variance.
    if (isGroundMeat(item)) {
        half *= 1.15;
        reasons.push("Ground meat loses 62-77% of its weight cooking, depending on fat content.");
    }
    if (isPouredAlcohol(item)) {
        half *= 1.35;
        reasons.push("The alcohol content of a poured drink is not visible.");
    }
    if (isBlendedShake(item)) {
        half *= 1.35;
        reasons.push("A blended drink's recipe is not visible.");
    }
    if (isDeepFried(item)) {
        half *= 1.15;
        reasons.push("Fried food absorbs 10-28% of its weight in oil.");
    }

    // 4. MODIFIER ONLY — the model's own portion confidence. It never
    //    replaces the measured baseline.
    if (item.portion_confidence < 0.4) {
        half *= 1.5;
        reasons.push("The model said it was unsure about this portion.");
    } else if (item.portion_confidence > 0.8) {
        half *= 0.85;
    }

    // 5. Path widening (closed vocabulary is a real constraint).
    if (path === "local") half *= baselines.localPathMultiplier || 1;

    // 6. Personal-prior narrowing — the ONLY mechanism that can beat the
    //    population baseline, and only on demonstrated consistency.
    if (
        input.priorSampleCount != null &&
        input.priorSampleCount >= 5 &&
        (input.priorRatioVariance == null || input.priorRatioVariance < 0.05)
    ) {
        half = Math.min(half, baselines.pathwayHalfPct.personal_prior);
        reasons.push("Narrowed because your own logs for this food are consistent.");
    }

    // 7. Empirical agreement between two independent models (optional pass).
    const second = input.secondOpinion ? input.secondOpinion.gramsFor(row.id) : null;
    if (second != null && second > 0) {
        const relDiff = Math.abs(row.grams - second) / Math.max(row.grams, second);
        if (relDiff < 0.15) {
            half *= 0.6;
            reasons.push("Two models independently agreed on this portion.");
        } else {
            half *= 1.3;
            reasons.push("Two models disagreed on this portion.");
        }
    }

    // 8. Clamp flags and generic fallbacks FLOOR the band. Never narrow.
    if (row.gramPathway === "clamped" || input.hadClampFlag === true) {
        half = Math.max(half, 0.5);
        reasons.push("Something about this estimate looked out of range — please check it.");
    }

    const capped = Math.min(half, MAX_DISPLAYED_HALF_PCT);
    return { halfPct: capped, tier: bandTier(capped), reasons };
}

/**
 * Per-meal, errors COMPOUND and must not be averaged: quadrature weighted by
 * each item's calorie contribution, with a floor at 0.7x the dominant item's
 * band — one uncertain main course is not diluted by three confident sides.
 */
function mealBand(items) {
    const total = items.reduce((s, i) => s + i.kcal, 0);
    if (total === 0 || items.length === 0) return { halfPct: 0, tier: "none", reasons: [] };

    const variance = items.reduce((acc, i) => {
        const w = i.kcal / total;
        return acc + (w * i.band.halfPct) ** 2;
    }, 0);
    let half = Math.sqrt(variance);

    const dominant = items.reduce((a, b) => (a.kcal > b.kcal ? a : b));
    half = Math.max(half, dominant.band.halfPct * 0.7);

    const reasons = [...new Set(items.flatMap((i) => i.band.reasons))];
    const capped = Math.min(half, MAX_DISPLAYED_HALF_PCT);
    return { halfPct: capped, tier: bandTier(capped), reasons };
}

/** The displayed range for a value, at its band. */
function rangeFor(value, band) {
    return { low: value * (1 - band.halfPct), high: value * (1 + band.halfPct) };
}

module.exports = {
    FoodCategory, MAX_DISPLAYED_HALF_PCT, SEEDED_BASELINES, bandTier, TIER_GLYPH,
    classifyCategory, isGroundMeat, isPouredAlcohol, isBlendedShake, isDeepFried,
    computeBand, mealBand, rangeFor,
};
