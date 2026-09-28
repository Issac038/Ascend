// ------------------------------------------------------------
// Library service — the ONE calculation + validation surface for
// custom foods, recipes, and logging from the library.
//
// Rules enforced here (and nowhere else):
//   - per-100g is the only stored basis; per-serving input is converted
//     at save time via the user-declared serving weight
//   - recipe/custom totals are ALWAYS recomputed server-side from
//     snapshots x grams; client-sent totals are ignored
//   - all quantities and nutrients are validated + clamped; impossible
//     values are rejected, not silently fixed
//   - Atwater reconciliation (totals.reconcileFromMacros) keeps kcal
//     self-consistent with displayed macros
// ------------------------------------------------------------

const totals = require("./totals");
const { GRAMS_MIN, GRAMS_MAX } = require("../models/NutritionLibrary");

// ---------------- validation helpers ----------------

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}

function requireNumber(value, label, { min = 0, max = Infinity, integer = false } = {}) {
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n)) {
        throw new ValidationError(`${label} must be a number`);
    }
    if (integer && !Number.isInteger(n)) throw new ValidationError(`${label} must be a whole number`);
    if (n < min || n > max) throw new ValidationError(`${label} must be between ${min} and ${max}`);
    return n;
}

function optionalNumber(value, label, { min = 0, max = Infinity } = {}) {
    if (value === undefined || value === null || value === "") return null;
    return requireNumber(value, label, { min, max });
}

function cleanText(value, label, { max = 160, required = false } = {}) {
    const s = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
    if (required && !s) throw new ValidationError(`${label} is required`);
    if (s.length > max) throw new ValidationError(`${label} is too long (max ${max} characters)`);
    return s || null;
}

// ---------------- custom food input ----------------

/**
 * Validate a custom-food payload. Returns normalized fields with nutrients
 * stored per-100g (per-serving input converted via servingSizeG).
 */
function normalizeCustomFoodInput(body) {
    const name = cleanText(body.name, "Food name", { required: true });
    const brand = cleanText(body.brand, "Brand", { max: 120 });
    const basis = body.basis === "per_serving" ? "per_serving" : "per_100g";

    const servingSizeG = optionalNumber(body.servingSizeG, "Serving weight (g)", { min: GRAMS_MIN, max: GRAMS_MAX });
    if (basis === "per_serving" && !servingSizeG) {
        throw new ValidationError("Enter how many grams one serving weighs so values can be converted to per-100 g");
    }

    // required: energy. optional: macros. Values are per the chosen basis.
    const kcalIn = requireNumber(body.kcal, "Calories", { min: 0, max: 950 });
    const pIn = optionalNumber(body.protein_g, "Protein", { min: 0, max: 200 });
    const cIn = optionalNumber(body.carbs_g, "Carbohydrates", { min: 0, max: 200 });
    const fIn = optionalNumber(body.fat_g, "Fat", { min: 0, max: 200 });

    // Atwater plausibility — same guard the manual-entry path uses: macros
    // implying far MORE energy than the declared kcal are inconsistent.
    const macroKcal = totals.reconcileFromMacros(pIn || 0, cIn || 0, fIn || 0);
    if (macroKcal > kcalIn * 1.6 + 60) {
        throw new ValidationError("Protein/carbs/fat values don't add up to the calories you entered — check them");
    }

    const toPer100 = (v) => {
        if (v == null) return null;
        if (basis === "per_100g") return Math.round(v * 100) / 100;
        return Math.round(((v * 100) / servingSizeG) * 100) / 100;
    };

    return {
        name,
        brand,
        basis,
        servingSizeG: servingSizeG ? Math.round(servingSizeG * 10) / 10 : null,
        kcal: toPer100(kcalIn),
        protein_g: toPer100(pIn),
        carbs_g: toPer100(cIn),
        fat_g: toPer100(fIn),
        fiber_g: null,
        sugar_g: null,
        sodium_mg: null,
    };
}

// ---------------- recipe ingredient resolution ----------------

/**
 * Resolve a recipe ingredient request to a stored recipeIngredient.
 * Nutrition values ALWAYS come from the corpus or the user's own custom
 * food — never from the request body.
 */
async function resolveRecipeIngredient(raw, { corpusColl, CustomFood, userId }) {
    if (raw == null || typeof raw !== "object") throw new ValidationError("Each ingredient must be an object");

    const kind = raw.foodKind === "custom" ? "custom" : "corpus";
    const grams = requireNumber(raw.grams, "Ingredient quantity (g)", { min: GRAMS_MIN, max: GRAMS_MAX });
    const quantity = optionalNumber(raw.quantity, "Ingredient quantity", { min: 0.01, max: GRAMS_MAX }) ?? grams;
    const unit = cleanText(raw.unit, "Unit", { max: 16 }) || "g";

    if (kind === "custom") {
        const cf = await CustomFood.findOne({ _id: String(raw.foodId || ""), userId });
        if (!cf) throw new ValidationError("A custom food in this recipe could not be found — it may have been deleted");
        const displayName = cf.brand ? `${cf.brand} ${cf.name}` : cf.name;
        return {
            foodKind: "custom",
            foodId: String(cf._id),
            displayName,
            brand: cf.brand,
            grams: Math.round(grams * 10) / 10,
            unit,
            quantity,
            per100g: {
                kcal: cf.kcal,
                protein_g: cf.protein_g,
                carbs_g: cf.carbs_g,
                fat_g: cf.fat_g,
                fiber_g: cf.fiber_g,
                sugar_g: cf.sugar_g,
                sodium_mg: cf.sodium_mg,
            },
            origin: "custom",
        };
    }

    const resolver = require("./resolver");
    const food = await resolver.loadFood(corpusColl, String(raw.foodId || ""));
    if (!food || food.per100g.kcal == null) {
        throw new ValidationError(`"${cleanText(raw.displayName, "Food name") || "An ingredient"}" is not in the food corpus any more — search for it again`);
    }
    return {
        foodKind: "corpus",
        foodId: food.foodId,
        displayName: food.brand ? `${food.brand} ${food.name}` : food.name,
        brand: food.brand,
        grams: Math.round(grams * 10) / 10,
        unit,
        quantity,
        per100g: food.per100g,
        origin: "db_search",
    };
}

// ---------------- deterministic arithmetic ----------------

/** Raw per-100g-basis totals for a list of recipe ingredients (per 1 portion). */
function recipeTotals(ingredients) {
    const acc = totals.zeroTotals();
    for (const ing of ingredients || []) {
        const f = (ing.grams || 0) / 100;
        acc.kcal += (ing.per100g?.kcal || 0) * f;
        acc.protein_g += (ing.per100g?.protein_g || 0) * f;
        acc.carbs_g += (ing.per100g?.carbs_g || 0) * f;
        acc.fat_g += (ing.per100g?.fat_g || 0) * f;
        acc.fiber_g += (ing.per100g?.fiber_g || 0) * f;
        acc.sugar_g += (ing.per100g?.sugar_g || 0) * f;
        acc.sodium_mg += (ing.per100g?.sodium_mg || 0) * f;
    }
    return acc;
}

/** Display-rounded totals for a recipe (per 1 portion). */
function recipeDisplayTotals(ingredients) {
    const t = recipeTotals(ingredients);
    return {
        kcal: totals.toDisplayTotals(t).kcal,
        protein_g: totals.toDisplayTotals(t).protein_g,
        carbs_g: totals.toDisplayTotals(t).carbs_g,
        fat_g: totals.toDisplayTotals(t).fat_g,
    };
}

/**
 * Validate a "log this recipe" payload. `portions` scales the WHOLE recipe
 * deterministically (0.05–10). Returns the ingredient rows shaped exactly
 * like Meal ingredient rows (snapshot per 100g), ready for Meal.create.
 */
function buildMealRowsFromRecipe(recipe, portions) {
    const p = requireNumber(portions ?? 1, "Portions", { min: 0.05, max: 10 });
    const rows = (recipe.ingredients || []).map((ing, i) => ({
        id: `rec-${recipe._id}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        displayName: ing.displayName,
        sourceFoodId: ing.foodKind === "corpus" ? ing.foodId : null,
        grams: Math.round(ing.grams * p * 10) / 10,
        nutrientSnapshot: {
            kcal: ing.per100g.kcal,
            protein_g: ing.per100g.protein_g,
            fat_g: ing.per100g.fat_g,
            carbs_g: ing.per100g.carbs_g,
            fiber_g: ing.per100g.fiber_g,
            sugar_g: ing.per100g.sugar_g,
            sodium_mg: ing.per100g.sodium_mg,
        },
        origin: ing.foodKind === "custom" ? "manual_custom" : "db_search",
        sourceUrl: null,
        gramPathway: "user_edited",
        bandHalfPct: 0,
        isEstimate: false,
        assumptions: [],
        macrosUserEdited: false,
        corrections: [],
    }));
    return { rows, portions: p };
}

module.exports = {
    ValidationError,
    requireNumber,
    optionalNumber,
    cleanText,
    normalizeCustomFoodInput,
    resolveRecipeIngredient,
    recipeTotals,
    recipeDisplayTotals,
    buildMealRowsFromRecipe,
};
