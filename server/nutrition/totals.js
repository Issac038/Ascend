// ------------------------------------------------------------
// Totals, recompute, and display rounding.
//
// Port of Nut AI's @nutai/totals (AGPL-3.0 — see LICENSE-NUTAI.md).
// Pure arithmetic over per-100g snapshots. Zero network, sub-millisecond.
//
// This module is why no correction ever needs a paid model call. The
// inference model's only job was producing the initial ingredient rows;
// every subsequent action is local arithmetic:
//   edit grams  -> factor changes, snapshot does not. Multiplication.
//   swap food   -> new snapshot copied from a corpus row. Instant.
//   answer "oil?" -> push a synthetic row, recompute.
//   "ate half"  -> portionEatenFraction. One multiplier.
// ------------------------------------------------------------

function zeroTotals() {
    return { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 };
}

function scaleTotals(t, factor) {
    return {
        kcal: t.kcal * factor,
        protein_g: t.protein_g * factor,
        fat_g: t.fat_g * factor,
        carbs_g: t.carbs_g * factor,
        fiber_g: t.fiber_g * factor,
        sugar_g: t.sugar_g * factor,
        sodium_mg: t.sodium_mg * factor,
    };
}

/** Totals contributed by a single row, before the whole-meal portion multiplier. */
function rowTotals(row) {
    const factor = row.grams / 100;
    const s = row.nutrientSnapshot;
    // A missing micronutrient contributes 0 to a SUM — that is arithmetic, not
    // a claim that the food contains none. The null survives on the row itself
    // and renders distinctly in the UI.
    return {
        kcal: s.kcal * factor,
        protein_g: s.protein_g * factor,
        fat_g: s.fat_g * factor,
        carbs_g: s.carbs_g * factor,
        fiber_g: (s.fiber_g || 0) * factor,
        sugar_g: (s.sugar_g || 0) * factor,
        sodium_mg: (s.sodium_mg || 0) * factor,
    };
}

/** The whole meal. Full float precision — rounding happens once, at display. */
function recomputeTotals(meal) {
    const raw = (meal.ingredients || []).reduce((acc, row) => {
        const t = rowTotals(row);
        acc.kcal += t.kcal;
        acc.protein_g += t.protein_g;
        acc.fat_g += t.fat_g;
        acc.carbs_g += t.carbs_g;
        acc.fiber_g += t.fiber_g;
        acc.sugar_g += t.sugar_g;
        acc.sodium_mg += t.sodium_mg;
        return acc;
    }, zeroTotals());
    return scaleTotals(raw, meal.portionEatenFraction == null ? 1 : meal.portionEatenFraction);
}

/** Atwater. Any macro edit anywhere recomputes through this. No exceptions. */
function reconcileFromMacros(protein_g, carbs_g, fat_g) {
    return protein_g * 4 + carbs_g * 4 + fat_g * 9;
}

/** Which basis produced a calorie figure. Surfaced, never switched silently. */
function calorieBasisFor(row) {
    return row.macrosUserEdited ? "recomputed" : "database";
}

function itemCalories(row) {
    const t = rowTotals(row);
    return calorieBasisFor(row) === "recomputed"
        ? reconcileFromMacros(t.protein_g, t.carbs_g, t.fat_g)
        : t.kcal;
}

// ---------------- Display rounding (two separate regimes) ----------------

/** Regime B — aggregated totals. One decimal below 10 g, whole grams at 10+. */
function roundDisplayGrams(g) {
    return g < 10 ? Math.round(g * 10) / 10 : Math.round(g);
}

/**
 * Calories for display are computed from the ALREADY-ROUNDED macro grams, so
 * a user can hand-multiply the visible macros and reproduce the visible
 * calories. We STORE/EXPORT full precision; we SHOW the self-consistent figure.
 */
function toDisplayTotals(t) {
    const protein_g = roundDisplayGrams(t.protein_g);
    const fat_g = roundDisplayGrams(t.fat_g);
    const carbs_g = roundDisplayGrams(t.carbs_g);
    return {
        kcal: Math.round(reconcileFromMacros(protein_g, carbs_g, fat_g)),
        protein_g,
        fat_g,
        carbs_g,
        fiber_g: roundDisplayGrams(t.fiber_g),
        sugar_g: roundDisplayGrams(t.sugar_g),
        sodium_mg: Math.round(t.sodium_mg),
    };
}

/**
 * Regime A — "as labeled", for a SINGLE packaged item. FDA 21 CFR 101.9(c).
 * MUST NOT be used for sums (label increments do not compose additively).
 */
const labelRounding = {
    calories(kcal) {
        if (kcal < 5) return 0;
        if (kcal <= 50) return Math.round(kcal / 5) * 5;
        return Math.round(kcal / 10) * 10;
    },
    fat(g) {
        if (g < 0.5) return 0;
        if (g < 5) return Math.round(g * 2) / 2;
        return Math.round(g);
    },
    sodium(mg) {
        if (mg < 5) return 0;
        if (mg <= 140) return Math.round(mg / 5) * 5;
        return Math.round(mg / 10) * 10;
    },
    gramNutrient(g) {
        if (g < 0.5) return 0;
        return Math.round(g);
    },
    isTrace(g) {
        return g >= 0.5 && g < 1;
    },
    cholesterol(mg) {
        if (mg < 2) return 0;
        return Math.round(mg / 5) * 5;
    },
    percentDV(pct) {
        if (pct <= 10) return Math.round(pct / 2) * 2;
        if (pct <= 50) return Math.round(pct / 5) * 5;
        return Math.round(pct / 10) * 10;
    },
};

module.exports = {
    zeroTotals, scaleTotals, rowTotals, recomputeTotals,
    reconcileFromMacros, calorieBasisFor, itemCalories,
    roundDisplayGrams, toDisplayTotals, labelRounding,
};
