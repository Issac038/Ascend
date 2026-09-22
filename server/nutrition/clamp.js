// ------------------------------------------------------------
// The deterministic sanity clamp.
//
// Port of Nut AI's @nutai/clamp (AGPL-3.0 — see LICENSE-NUTAI.md).
// Spec-accuracy-engine §3.4. Always on. Every scan. Both inference paths.
// Non-LLM. Near-zero cost. Never skippable.
//
// A flag never silently deletes an item. It degrades it honestly:
//   (a) the flag is recorded on the log entry,
//   (b) the item's confidence is forced to the lowest band,
//   (c) a visible "please check this one" marker is surfaced in the UI.
//
// Pure — returns a new payload, never mutates its input.
// ------------------------------------------------------------

const CLAMP_BOUNDS = {
    MEAL_KCAL: [0, 5000],
    ITEM_KCAL: [0, 3000],
    ITEM_GRAMS: [0.1, 3000],
    // 902 kcal/100g is the real USDA maximum (beef tallow / lard / fish oils,
    // Atwater 9.02 for fat). 900 false-positives on ordinary cooking fats; 920
    // clears the real maximum with headroom while catching kJ-as-kcal (~4.2x),
    // decimal slips and per-100g-as-absolute.
    MAX_KCAL_PER_100G: 920,
    MACRO_ARITHMETIC_TOLERANCE: 0.15,
};

const CLAMP_FLAG_KINDS = [
    "grams_out_of_bounds",
    "macro_arithmetic_mismatch",
    "impossible_energy_density",
    "item_kcal_out_of_bounds",
    "meal_kcal_out_of_bounds",
];

/** Atwater. The arithmetic the model does not get to override. */
function caloriesFromMacros(m) {
    return 4 * m.protein_g + 4 * m.carbs_g + 9 * m.fat_g;
}

function clampItem(item, flags) {
    let next = item;

    // 1. Grams out of bounds -> demote to null so the reconciliation ladder
    //    falls through to its other tiers. A demotion, not a deletion.
    if (next.model_gram_estimate != null) {
        const [lo, hi] = CLAMP_BOUNDS.ITEM_GRAMS;
        if (next.model_gram_estimate < lo || next.model_gram_estimate > hi) {
            flags.push({ item: next.name, kind: "grams_out_of_bounds", original: next.model_gram_estimate });
            next = { ...next, model_gram_estimate: null };
        }
    }

    // 2. Macro arithmetic. 4/4/9 wins over whatever the model asserted — the
    //    structural fix for "macros don't add up to the calories". The macros
    //    are the more trustworthy signal because they are what the model
    //    actually reasoned about.
    const m = next.fallback_macros_at_estimate;
    const derived = caloriesFromMacros(m);
    if (m.calories_kcal > 0 && Math.abs(derived - m.calories_kcal) / m.calories_kcal > CLAMP_BOUNDS.MACRO_ARITHMETIC_TOLERANCE) {
        flags.push({ item: next.name, kind: "macro_arithmetic_mismatch", original: m.calories_kcal, derived });
        next = { ...next, fallback_macros_at_estimate: { ...m, calories_kcal: derived } };
    }

    // 3. Item calorie ceiling (post-reconciliation value).
    const itemKcal = next.fallback_macros_at_estimate.calories_kcal;
    const [kcalLo, kcalHi] = CLAMP_BOUNDS.ITEM_KCAL;
    if (itemKcal < kcalLo || itemKcal > kcalHi) {
        flags.push({ item: next.name, kind: "item_kcal_out_of_bounds", original: itemKcal });
    }

    // 4. Energy density — catches unit confusion, decimal slips, per-100g as
    //    absolute. Flag only; we never invent a replacement density.
    if (next.model_gram_estimate != null && next.model_gram_estimate > 0) {
        const per100 = itemKcal / (next.model_gram_estimate / 100);
        if (per100 > CLAMP_BOUNDS.MAX_KCAL_PER_100G) {
            flags.push({ item: next.name, kind: "impossible_energy_density", derived: per100 });
        }
    }

    return next;
}

/** Validate and correct a payload's arithmetic. Returns a NEW payload. */
function clamp(payload) {
    const flags = [];
    const items = payload.items.map((item) => clampItem(item, flags));

    const mealKcal = items.reduce((sum, i) => sum + i.fallback_macros_at_estimate.calories_kcal, 0);
    const [mealLo, mealHi] = CLAMP_BOUNDS.MEAL_KCAL;
    if (mealKcal < mealLo || mealKcal > mealHi) {
        flags.push({ item: null, kind: "meal_kcal_out_of_bounds", original: mealKcal });
    }

    return { payload: { ...payload, items }, flags };
}

/** Flags that arm an optional verifier pass — internally incoherent output. */
function armsVerifierPass(flags) {
    return flags.some((f) => f.kind === "impossible_energy_density" || f.kind === "meal_kcal_out_of_bounds");
}

module.exports = { CLAMP_BOUNDS, CLAMP_FLAG_KINDS, caloriesFromMacros, clamp, armsVerifierPass };
