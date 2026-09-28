// ------------------------------------------------------------
// Shared nutrition arithmetic — the client-side mirror of the server's
// per-100g-basis engine (server/nutrition/totals.js). Every preview in the
// UI is deterministic arithmetic over per-100g snapshots x grams; nothing
// here ever asks a model or invents a number.
//
// Conversions are only applied when a KNOWN gram weight backs the unit
// (corpus portion anchor, user-declared serving weight, or a real volume
// like 1 ml ≈ 1 g for water-like liquids). Unknown weights surface as
// missing flags — never silently treated as zero.
// ------------------------------------------------------------

export const UNIT_OPTIONS = [
    { value: "g", label: "g" },
    { value: "ml", label: "ml" },
    { value: "piece", label: "piece" },
    { value: "serving", label: "serving" },
    { value: "egg", label: "egg" },
    { value: "slice", label: "slice" },
    { value: "cup", label: "cup" },
    { value: "scoop", label: "scoop" },
    { value: "tbsp", label: "tbsp" },
    { value: "tsp", label: "tsp" },
];

// Display order for portion anchors derived from a food row.
export const GRAMS_MIN = 1;
export const GRAMS_MAX = 5000;

/**
 * Build the portion anchors ("1 piece ~ 50 g", "100 g", …) available for a
 * food. Only KNOWN weights produce an anchor — missing ones are omitted.
 */
export function portionAnchors(food) {
    const list = [];
    const push = (unit, qty, g, labelOverride) => {
        if (!Number.isFinite(g) || g <= 0) return;
        list.push({ unit, quantity: qty, grams: g, label: labelOverride || `1 ${unit} (~${Math.round(g)} g)` });
    };
    if (food?.portionPerUnitG) push("piece", 1, food.portionPerUnitG);
    if (food?.portionSmallG) push("piece", 1, food.portionSmallG, `Small (~${Math.round(food.portionSmallG)} g)`);
    if (food?.portionMediumG) push("piece", 1, food.portionMediumG, `Medium (~${Math.round(food.portionMediumG)} g)`);
    if (food?.portionLargeG) push("piece", 1, food.portionLargeG, `Large (~${Math.round(food.portionLargeG)} g)`);
    if (food?.servingSizeG) push("serving", 1, food.servingSizeG, `1 serving (~${Math.round(food.servingSizeG)} g)`);
    return list;
}

/**
 * Grams for a (quantity, unit) pair given the food's known anchors.
 * Returns null when the conversion is unknown — callers must surface that,
 * never default to a silent value.
 */
export function toGrams(quantity, unit, food) {
    const q = Number(quantity);
    if (!Number.isFinite(q) || q <= 0) return null;
    switch (unit) {
        case "g":
            return clampGrams(q);
        case "ml":
            // water-like density approximation; still a real conversion
            return clampGrams(q);
        case "piece":
        case "serving":
        case "egg": {
            const g = food?.portionPerUnitG ?? food?.servingSizeG ?? null;
            return g ? clampGrams(q * g) : null;
        }
        case "slice": {
            // bread-style slice; only when the food declares a serving weight
            const g = food?.portionPerUnitG ?? food?.servingSizeG ?? null;
            return g ? clampGrams(q * g) : null;
        }
        case "cup": {
            // FNDDS-style cup anchor when known; otherwise not convertible
            const g = food?.cupGrams ?? null;
            return g ? clampGrams(q * g) : null;
        }
        case "scoop": {
            // protein-powder style scoop; only when serving weight is declared
            const g = food?.servingSizeG ?? null;
            return g ? clampGrams(q * g) : null;
        }
        case "tbsp":
        case "tsp": {
            const g = food?.portionPerUnitG ?? food?.servingSizeG ?? null;
            return g ? clampGrams(q * (unit === "tbsp" ? g : g / 3)) : null;
        }
        default:
            return null;
    }
}

export function clampGrams(g) {
    const n = Number(g);
    if (!Number.isFinite(n)) return null;
    return Math.min(GRAMS_MAX, Math.max(GRAMS_MIN, n));
}

/** Deterministic per-100g scaling — mirrors totals.rowTotals on the server. */
export function scaleRow(per100g, grams) {
    const f = grams / 100;
    const s = (v) => (v == null ? 0 : v * f);
    return {
        kcal: s(per100g?.kcal),
        protein_g: s(per100g?.protein_g),
        carbs_g: s(per100g?.carbs_g),
        fat_g: s(per100g?.fat_g),
    };
}

/**
 * Sum ingredient rows: [{ per100g, grams }]. Full float precision —
 * rounding happens once, at display (regime B mirrors toDisplayTotals).
 */
export function sumTotals(rows) {
    const acc = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    for (const r of rows || []) {
        const t = scaleRow(r.per100g, r.grams);
        acc.kcal += t.kcal;
        acc.protein_g += t.protein_g;
        acc.carbs_g += t.carbs_g;
        acc.fat_g += t.fat_g;
    }
    return acc;
}

/** Display rounding — identical regime to the server (self-consistent kcal). */
export function displayTotals(raw) {
    const rd = (g) => (g < 10 ? Math.round(g * 10) / 10 : Math.round(g));
    const protein_g = rd(raw.protein_g);
    const fat_g = rd(raw.fat_g);
    const carbs_g = rd(raw.carbs_g);
    return {
        kcal: Math.round(protein_g * 4 + carbs_g * 4 + fat_g * 9),
        protein_g,
        fat_g,
        carbs_g,
    };
}

/** Convenience: rows -> display totals in one call. */
export function totalsFor(rows) {
    return displayTotals(sumTotals(rows));
}

/** Scale an entire ingredient list by a portions factor (recipe logging). */
export function scaleIngredients(ingredients, portions) {
    const p = Number(portions);
    if (!Number.isFinite(p) || p <= 0) return ingredients;
    return ingredients.map((ing) => ({ ...ing, grams: Math.round(ing.grams * p * 10) / 10 }));
}

export const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString());
export const fmtG = (v) => (v == null ? "—" : Math.round(v * 10) / 10);
