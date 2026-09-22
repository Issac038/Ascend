const mongoose = require("mongoose");

// ------------------------------------------------------------
// One logged eating occasion.
//
// Domain model ported from Nut AI's @nutai/core-schema domain.ts
// (AGPL-3.0 — see ../nutrition/LICENSE-NUTAI.md). The invariant that pays
// for the entire feature:
//
//   Every ingredient row, regardless of origin, is stored as
//   (food_reference, grams, per-100g nutrient snapshot) — NEVER as a bare
//   calorie or macro number.
//
// That makes corrections free and instant (arithmetic over stored values),
// keeps historical logs stable when the corpus is updated (the snapshot was
// copied at add time and is immutable), and removes any need to re-derive
// old meals from a changing database.
// ------------------------------------------------------------

const assumptionTagSchema = new mongoose.Schema(
    {
        type: { type: String, default: "", maxlength: 200 }, // the assumption text
        gramsEquiv: { type: Number, default: null },
        userConfirmed: { type: Boolean, default: false }
    },
    { _id: false }
);

const ingredientRowSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, maxlength: 60 },

        displayName: { type: String, required: true, trim: true, maxlength: 160 },

        // Corpus reference (USDA fdcId string). Null for a pure AI estimate
        // or a fully manual row with no corpus match.
        sourceFoodId: { type: String, default: null, maxlength: 40 },

        // The ONE quantity the user edits directly (grams).
        grams: { type: Number, required: true, min: 0, max: 5000 },

        // Per-100g values copied at add time. Immutable. null = NOT REPORTED
        // (never a fabricated 0; sums treat null as 0 — arithmetic, not a claim).
        nutrientSnapshot: {
            kcal: { type: Number, required: true, min: 0, max: 920 },
            protein_g: { type: Number, default: null, min: 0, max: 100 },
            fat_g: { type: Number, default: null, min: 0, max: 100 },
            carbs_g: { type: Number, default: null, min: 0, max: 100 },
            fiber_g: { type: Number, default: null, min: 0, max: 100 },
            sugar_g: { type: Number, default: null, min: 0, max: 100 },
            sodium_mg: { type: Number, default: null, min: 0, max: 5000 }
        },

        // vision_model | barcode | label_ocr | db_search | manual_custom |
        // assumption_filler | web_lookup
        origin: { type: String, required: true, maxlength: 30 },

        gramPathway: { type: String, required: true, maxlength: 30 },

        // Half-width of this row's uncertainty band, as a fraction (e.g. 0.275).
        bandHalfPct: { type: Number, default: 0.4, min: 0, max: 0.8 },

        // True for DB misses — drives the "AI estimate" badge.
        isEstimate: { type: Boolean, default: false },

        assumptions: { type: [assumptionTagSchema], default: [] },

        // True once the user edited a macro on this row: calories then recompute
        // via Atwater and the "recalculated from macros" note shows.
        macrosUserEdited: { type: Boolean, default: false },

        // Correction history for this row (deterministic edits only).
        corrections: {
            type: [{
                at: { type: Date, default: Date.now },
                field: { type: String, maxlength: 40 },
                from: { type: Number, default: null },
                to: { type: Number, default: null }
            }],
            default: []
        }
    },
    { _id: false }
);

const mealSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        date: { type: String, required: true }, // YYYY-MM-DD (user's timezone)

        mealType: {
            type: String,
            enum: ["breakfast", "lunch", "dinner", "snack"],
            default: "snack"
        },

        ingredients: {
            type: [ingredientRowSchema],
            validate: {
                validator: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 30,
                message: "A meal needs 1–30 ingredient rows"
            }
        },

        // 1.0 = ate all of it. FINAL multiplier on the summed totals (how
        // people actually reason about "I ate about half of this plate").
        portionEatenFraction: { type: Number, default: 1, min: 0.05, max: 1 },

        // photo | manual | db_search | label (a barcode hit lands as db_search)
        source: {
            type: String,
            enum: ["photo", "manual", "db_search", "label"],
            default: "db_search"
        },

        notes: { type: String, default: "", maxlength: 500 }
    },
    { timestamps: true }
);

mealSchema.index({ userId: 1, date: 1 });

// Personal gram priors — the "it learns from you" mechanism (a statistics
// problem: EWMA ratios, NOT model fine-tuning). One doc per user+food concept.
const mealPriorSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        foodConceptKey: { type: String, required: true, maxlength: 160 },
        ewmaRatio: { type: Number, default: 1 },
        ratioVariance: { type: Number, default: 0 },
        sampleCount: { type: Number, default: 0, min: 0, max: 100000 },
        medianGrams: { type: Number, default: null },
        lastCorrectedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

mealPriorSchema.index({ userId: 1, foodConceptKey: 1 }, { unique: true });

// Answer memory (repair §8.7): same answer 3x → applied silently afterwards.
const mealAnswerMemorySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        foodConceptKey: { type: String, required: true, maxlength: 160 },
        attribute: { type: String, required: true, maxlength: 60 },
        value: { type: String, required: true, maxlength: 60 },
        answerCount: { type: Number, default: 1, min: 1, max: 100000 }
    },
    { timestamps: true }
);

mealAnswerMemorySchema.index({ userId: 1, foodConceptKey: 1, attribute: 1 }, { unique: true });

module.exports = {
    Meal: mongoose.model("Meal", mealSchema),
    MealPrior: mongoose.model("MealPrior", mealPriorSchema),
    MealAnswerMemory: mongoose.model("MealAnswerMemory", mealAnswerMemorySchema)
};
