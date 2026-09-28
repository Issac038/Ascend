const mongoose = require("mongoose");

// ------------------------------------------------------------
// Personal nutrition library — user-owned records that live ALONGSIDE
// the global corpus:
//
//   CustomFood  — a food the user created (per-100g OR per-serving basis)
//   FoodRef     — favorite / recent reference to ANY food (corpus or custom)
//   Recipe      — a reusable multi-ingredient meal ("My Meals")
//
// Ownership is enforced at the ROUTE level (every query includes userId);
// these schemas additionally index userId so per-user scans stay fast.
//
// NOTE on Meal history compatibility: logged Meal documents are NEVER
// rewritten when a Recipe or CustomFood changes — recipes are copied into
// Meal ingredient rows (with per-100g snapshots) at log time, exactly like
// corpus foods. Editing a recipe only affects future logs.
// ------------------------------------------------------------

const GRAMS_MIN = 1;
const GRAMS_MAX = 5000;

const customFoodSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        name: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
        brand: { type: String, default: null, maxlength: 120 },

        // "per_100g" (default, matches the corpus basis) or "per_serving"
        basis: { type: String, enum: ["per_100g", "per_serving"], default: "per_100g" },

        // Weight of ONE serving in grams. Required when basis is per_serving
        // (so grams math stays deterministic); optional extra info otherwise.
        servingSizeG: { type: Number, default: null, min: GRAMS_MIN, max: GRAMS_MAX },

        // Nutrients stored PER 100 g internally (converted at save time if
        // the user entered per-serving values) — one computational basis,
        // same as the corpus. null = not reported, never a fabricated 0.
        kcal: { type: Number, required: true, min: 0, max: 950 },
        protein_g: { type: Number, default: null, min: 0, max: 100 },
        carbs_g: { type: Number, default: null, min: 0, max: 100 },
        fat_g: { type: Number, default: null, min: 0, max: 100 },
        fiber_g: { type: Number, default: null, min: 0, max: 100 },
        sugar_g: { type: Number, default: null, min: 0, max: 100 },
        sodium_mg: { type: Number, default: null, min: 0, max: 5000 },

        // User-entered values are labeled as user data everywhere they show.
        source: { type: String, default: "user", enum: ["user"] },
    },
    { timestamps: true }
);

customFoodSchema.index({ userId: 1, name: 1 });
customFoodSchema.index({ userId: 1, updatedAt: -1 });

const foodRefSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        // "corpus" (fdcId in sourceFoodId) or "custom" (_id of a CustomFood)
        kind: { type: String, enum: ["corpus", "custom"], required: true },
        sourceFoodId: { type: String, default: null, maxlength: 40 }, // corpus
        customFoodId: { type: mongoose.Schema.Types.ObjectId, ref: "NutritionCustomFood", default: null },
        // denormalized for list rendering without joins
        name: { type: String, required: true, maxlength: 200 },
        brand: { type: String, default: null, maxlength: 120 },

        favorite: { type: Boolean, default: false },
        lastLoggedAt: { type: Date, default: null },
        logCount: { type: Number, default: 0, min: 0 },
    },
    { timestamps: true }
);

foodRefSchema.index({ userId: 1, kind: 1, sourceFoodId: 1, customFoodId: 1 }, { unique: true });
foodRefSchema.index({ userId: 1, favorite: 1, lastLoggedAt: -1 });

const recipeIngredientSchema = new mongoose.Schema(
    {
        // corpus food id (string) or custom food ObjectId (string form)
        foodKind: { type: String, enum: ["corpus", "custom"], required: true },
        foodId: { type: String, required: true, maxlength: 40 },

        // denormalized for offline editing / stable display
        displayName: { type: String, required: true, maxlength: 160 },
        brand: { type: String, default: null, maxlength: 120 },

        // quantity expressed in the ingredient's unit — stored as the grams
        // equivalent. Unit text kept for display ("piece", "cup", "scoop").
        grams: { type: Number, required: true, min: GRAMS_MIN, max: GRAMS_MAX },
        unit: { type: String, default: "g", maxlength: 16 },
        quantity: { type: Number, required: true, min: 0.01, max: 5000 },

        // per-100g snapshot copied from the corpus/custom food at save time
        per100g: {
            kcal: { type: Number, required: true, min: 0, max: 950 },
            protein_g: { type: Number, default: null, min: 0, max: 100 },
            carbs_g: { type: Number, default: null, min: 0, max: 100 },
            fat_g: { type: Number, default: null, min: 0, max: 100 },
            fiber_g: { type: Number, default: null, min: 0, max: 100 },
            sugar_g: { type: Number, default: null, min: 0, max: 100 },
            sodium_mg: { type: Number, default: null, min: 0, max: 5000 },
        },
        // "user" when the ingredient was a CustomFood — flagged in previews
        origin: { type: String, default: "db_search", maxlength: 30 },
    },
    { _id: false }
);

const recipeSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        name: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
        notes: { type: String, default: "", maxlength: 500 },
        mealType: {
            type: String,
            enum: ["breakfast", "lunch", "dinner", "snack"],
            default: "snack"
        },
        ingredients: {
            type: [recipeIngredientSchema],
            validate: {
                validator: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 30,
                message: "A recipe needs 1–30 ingredients"
            }
        },
        // denormalized per-1-portion totals (per_100g basis arithmetic),
        // recomputed server-side on every save — never trusted from the client
        totalsPerPortion: {
            kcal: { type: Number, default: 0, min: 0 },
            protein_g: { type: Number, default: 0, min: 0 },
            carbs_g: { type: Number, default: 0, min: 0 },
            fat_g: { type: Number, default: 0, min: 0 },
        },
        lastLoggedAt: { type: Date, default: null },
        logCount: { type: Number, default: 0, min: 0 },
    },
    { timestamps: true }
);

recipeSchema.index({ userId: 1, name: 1 });
recipeSchema.index({ userId: 1, lastLoggedAt: -1 });

module.exports = {
    NutritionCustomFood: mongoose.model("NutritionCustomFood", customFoodSchema),
    NutritionFoodRef: mongoose.model("NutritionFoodRef", foodRefSchema),
    NutritionRecipe: mongoose.model("NutritionRecipe", recipeSchema),
    GRAMS_MIN,
    GRAMS_MAX,
};
