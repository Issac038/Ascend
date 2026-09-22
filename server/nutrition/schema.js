// ------------------------------------------------------------
// Ascend nutrition domain schema.
//
// Port of Nut AI's @nutai/core-schema (vision-payload.ts + domain.ts),
// AGPL-3.0 — see LICENSE-NUTAI.md. Translated from Zod to dependency-free
// runtime validation. The governing rule is preserved verbatim:
//
//   The model is a perception device. It never owns a number the user sees.
//
// Deliberate omissions preserved:
//   1. There is NO meal_totals on the vision payload — not "ignored",
//      absent. Totals are computed in totals.js from database rows.
//   2. The mass field is `model_gram_estimate` (rank 5 of 6 in the
//      reconciliation ladder), never `estimated_grams`.
//   3. Structural violations fail validation; value-range violations do
//      NOT (the clamp demotes them gracefully instead).
// ------------------------------------------------------------

const FOOD_FORMS = ["discrete", "flat", "piled", "liquid", "wrapped", "spread"];
const WEIGHT_BASES = ["cooked", "raw", "as_served"];
const UNCERTAINTY_REASONS = [
    "oil_or_fat_not_visually_determinable",
    "sauce_type_ambiguous",
    "milk_type_ambiguous",
    "meat_fat_percent_ambiguous",
    "cooked_vs_raw_ambiguous",
    "container_size_no_reference",
    "serving_count_ambiguous",
    "portion_depth_not_visible",
    "identity_ambiguous",
    "partially_occluded",
    "abv_unknown",
    "shake_recipe_unknown",
    "none",
];
const REFERENCE_OBJECT_TYPES = [
    "credit_card", "drink_can_12oz", "dinner_plate", "salad_plate", "soup_plate",
    "bread_plate", "dessert_plate", "cereal_bowl", "mug", "drinking_glass",
    "fork", "spoon", "tablespoon", "chopsticks", "hand", "smartphone", "coin", "none",
];
const CONTAINER_TYPES = [
    "cereal_bowl", "soup_plate", "mug", "drinking_glass", "wine_glass",
    "pint_glass", "takeout_container", "other",
];
const COOKING_CUES = [
    "grill_marks", "char", "visible_oil_sheen", "visible_oil_pooling",
    "batter_or_breading", "deep_fried_color", "steamed_no_browning", "boiled",
    "raw", "melted_cheese", "sauce_coating", "dry_surface", "none_visible",
];
const BEVERAGE_CATEGORIES = [
    "alcoholic_packaged", "alcoholic_poured_or_mixed", "blended_shake_or_smoothie",
    "coffee_tea", "soda_juice_other", "milk_or_dairy_drink",
];
const GRAM_PATHWAYS = [
    "packaged_exact", "discrete_count", "personal_prior", "geometry_exact_ref",
    "geometry_soft_ref", "fndds_standard_portion", "container_fill", "model_guess",
    "clamped", "user_edited",
];
const INGREDIENT_ORIGINS = [
    "vision_model", "barcode", "label_ocr", "db_search", "manual_custom",
    "assumption_filler", "web_lookup",
];

class ValidationError extends Error {
    constructor(message) { super(message); this.name = "ValidationError"; this.code = "BAD_INPUT"; }
}

function requireEnum(value, allowed, field) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new ValidationError(`${field}: expected one of ${allowed.slice(0, 6).join(", ")}${allowed.length > 6 ? "…" : ""}`);
    }
    return value;
}
function optEnum(value, allowed, field) {
    if (value == null) return null;
    return requireEnum(value, allowed, field);
}
function requireStr(value, field, max = 200) {
    if (typeof value !== "string" || value.trim().length === 0) throw new ValidationError(`${field}: non-empty string required`);
    return value.trim().slice(0, max);
}
function optStr(value, field, max = 200) {
    if (value == null) return null;
    if (typeof value !== "string") throw new ValidationError(`${field}: string or null expected`);
    const t = value.trim();
    return t === "" ? null : t.slice(0, max);
}
function requireNum(value, field) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ValidationError(`${field}: finite number required`);
    return n;
}
function requireNum01(value, field) {
    const n = requireNum(value, field);
    if (n < 0 || n > 1) throw new ValidationError(`${field}: expected 0..1`);
    return n;
}
function optNum(value, field) {
    if (value == null || value === "") return null;
    return requireNum(value, field);
}

// qualitative_size: 'small' | 'medium' | 'large' | 'count:N'
function validateQualitativeSize(value) {
    const v = requireStr(value, "qualitative_size", 20);
    if (v === "small" || v === "medium" || v === "large") return v;
    const m = /^count:(\d+(\.\d+)?)$/.exec(v);
    if (m && Number(m[1]) > 0) return v;
    throw new ValidationError(`qualitative_size: 'small', 'medium', 'large' or 'count:N' expected (got "${v.slice(0, 20)}")`);
}

function validateMacros(value, field) {
    if (value == null || typeof value !== "object") throw new ValidationError(`${field}: object required`);
    return {
        calories_kcal: requireNum(value.calories_kcal, `${field}.calories_kcal`),
        protein_g: requireNum(value.protein_g, `${field}.protein_g`),
        carbs_g: requireNum(value.carbs_g, `${field}.carbs_g`),
        fat_g: requireNum(value.fat_g, `${field}.fat_g`),
        fiber_g: optNum(value.fiber_g, `${field}.fiber_g`),
        sodium_mg: optNum(value.sodium_mg, `${field}.sodium_mg`),
    };
}

function validateItem(value, field) {
    if (value == null || typeof value !== "object") throw new ValidationError(`${field}: object required`);
    const item = {
        name: requireStr(value.name, `${field}.name`, 120),
        brand: optStr(value.brand, `${field}.brand`, 120),
        canonical_food_key: requireStr(value.canonical_food_key, `${field}.canonical_food_key`, 160).toLowerCase(),
        food_form: requireEnum(value.food_form, FOOD_FORMS, `${field}.food_form`),
        qualitative_size: validateQualitativeSize(value.qualitative_size),
        weight_basis: requireEnum(value.weight_basis, WEIGHT_BASES, `${field}.weight_basis`),
        // Deliberately unbounded here — range policing belongs to the clamp.
        model_gram_estimate: optNum(value.model_gram_estimate, `${field}.model_gram_estimate`),
        identification_confidence: requireNum01(value.identification_confidence, `${field}.identification_confidence`),
        portion_confidence: requireNum01(value.portion_confidence, `${field}.portion_confidence`),
        uncertainty_reason: requireEnum(value.uncertainty_reason, UNCERTAINTY_REASONS, `${field}.uncertainty_reason`),
        visible_reference_objects: [],
        container: null,
        cooking_method_cues: [],
        is_beverage: !!value.is_beverage,
        beverage_category: optEnum(value.beverage_category, BEVERAGE_CATEGORIES, `${field}.beverage_category`),
        // Optional category hint from the model — feeds the resolver's
        // categoryPrior signal (ctx.modelCategory). A hint, never a filter.
        cuisine_hint: optStr(value.cuisine_hint, `${field}.cuisine_hint`, 80),
        legible_label_text: optStr(value.legible_label_text, `${field}.legible_label_text`, 2000),
        stated_assumptions: [],
        clarifying_questions: [],
        fallback_macros_at_estimate: validateMacros(value.fallback_macros_at_estimate, `${field}.fallback_macros_at_estimate`),
    };
    if (!Array.isArray(value.visible_reference_objects) || value.visible_reference_objects.length > 10) {
        throw new ValidationError(`${field}.visible_reference_objects: array (max 10) required`);
    }
    item.visible_reference_objects = value.visible_reference_objects.map((r, i) => ({
        type: requireEnum(r.type, REFERENCE_OBJECT_TYPES, `${field}.ref[${i}].type`),
        bbox: (Array.isArray(r.bbox) && r.bbox.length === 4 && r.bbox.every((v) => Number.isFinite(Number(v))))
            ? r.bbox.map(Number)
            : (() => { throw new ValidationError(`${field}.ref[${i}].bbox: [x,y,w,h] normalized expected`); })(),
        confidence: requireNum01(r.confidence, `${field}.ref[${i}].confidence`),
    }));
    if (value.container != null) {
        if (typeof value.container !== "object") throw new ValidationError(`${field}.container: object or null expected`);
        item.container = {
            type: requireEnum(value.container.type, CONTAINER_TYPES, `${field}.container.type`),
            fill_fraction: requireNum01(value.container.fill_fraction, `${field}.container.fill_fraction`),
        };
    }
    if (!Array.isArray(value.cooking_method_cues) || value.cooking_method_cues.length > 13) {
        throw new ValidationError(`${field}.cooking_method_cues: array (max 13) required`);
    }
    item.cooking_method_cues = value.cooking_method_cues.map((c, i) => requireEnum(c, COOKING_CUES, `${field}.cues[${i}]`));
    if (!Array.isArray(value.stated_assumptions) || value.stated_assumptions.length > 10) {
        throw new ValidationError(`${field}.stated_assumptions: array (max 10) required`);
    }
    item.stated_assumptions = value.stated_assumptions.map((a, i) => requireStr(a, `${field}.assumptions[${i}]`, 200));
    if (!Array.isArray(value.clarifying_questions) || value.clarifying_questions.length > 2) {
        throw new ValidationError(`${field}.clarifying_questions: array (max 2) required`);
    }
    item.clarifying_questions = value.clarifying_questions.map((q, i) => requireStr(q, `${field}.questions[${i}]`, 200));
    return item;
}

/** The ONLY thing a vision provider is allowed to return. */
function validateVisionPayload(value) {
    if (value == null || typeof value !== "object") throw new ValidationError("payload: object required");
    if (value.schema_version !== "1.0.0") throw new ValidationError("schema_version: '1.0.0' expected");
    if (typeof value.is_food !== "boolean") throw new ValidationError("is_food: boolean required");
    const payload = {
        schema_version: "1.0.0",
        is_food: !!value.is_food,
        refusal_reason: optStr(value.refusal_reason, "refusal_reason", 300),
        items: [],
        meal_overall: {
            identification_confidence: 0,
            portion_confidence: 0,
            assumptions: [],
            clarifying_questions: [],
        },
    };
    if (value.is_food) {
        if (!Array.isArray(value.items) || value.items.length === 0) throw new ValidationError("items: non-empty array required for food");
        if (value.items.length > 20) throw new ValidationError("items: max 20 components per meal");
        payload.items = value.items.map((it, i) => validateItem(it, `items[${i}]`));
    }
    if (value.meal_overall != null && typeof value.meal_overall === "object") {
        const mo = value.meal_overall;
        payload.meal_overall = {
            identification_confidence: requireNum01(mo.identification_confidence, "meal_overall.identification_confidence"),
            portion_confidence: requireNum01(mo.portion_confidence, "meal_overall.portion_confidence"),
            assumptions: Array.isArray(mo.assumptions) ? mo.assumptions.map((a, i) => requireStr(a, `meal_overall.assumptions[${i}]`, 200)) : [],
            clarifying_questions: Array.isArray(mo.clarifying_questions) ? mo.clarifying_questions.map((q, i) => requireStr(q, `meal_overall.clarifying_questions[${i}]`, 200)) : [],
        };
    }
    return payload;
}

/** A transcribed nutrition label (label-scan.ts port). */
function validateLabelPayload(value) {
    if (value == null || typeof value !== "object") throw new ValidationError("label: object required");
    const per = value.per_serving;
    if (per == null || typeof per !== "object") throw new ValidationError("label.per_serving: object required");
    return {
        product_name: optStr(value.product_name, "label.product_name", 160),
        serving_desc: optStr(value.serving_desc, "label.serving_desc", 160),
        serving_g: optNum(value.serving_g, "label.serving_g"),
        servings_per_container: optNum(value.servings_per_container, "label.servings_per_container"),
        per_serving: {
            calories_kcal: Math.max(0, requireNum(per.calories_kcal, "per_serving.calories_kcal")),
            protein_g: Math.max(0, requireNum(per.protein_g, "per_serving.protein_g")),
            carbs_g: Math.max(0, requireNum(per.carbs_g, "per_serving.carbs_g")),
            fat_g: Math.max(0, requireNum(per.fat_g, "per_serving.fat_g")),
            fiber_g: optNum(per.fiber_g, "per_serving.fiber_g"),
            sugar_g: optNum(per.sugar_g, "per_serving.sugar_g"),
            sodium_mg: optNum(per.sodium_mg, "per_serving.sodium_mg"),
        },
    };
}

module.exports = {
    SCHEMA_VERSION: "1.0.0",
    ValidationError,
    FOOD_FORMS,
    WEIGHT_BASES,
    UNCERTAINTY_REASONS,
    REFERENCE_OBJECT_TYPES,
    CONTAINER_TYPES,
    COOKING_CUES,
    BEVERAGE_CATEGORIES,
    GRAM_PATHWAYS,
    INGREDIENT_ORIGINS,
    validateVisionPayload,
    validateLabelPayload,
};
