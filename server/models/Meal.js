const mongoose = require("mongoose");

// One logged eating occasion for a day (e.g. "Lunch — Chicken Biryani + Raita").
// Nutrition totals are NOT stored: they are computed server-side from foods[]
// on every read, so there is no cached value that can drift out of sync
// (same lesson as goal progress — one authoritative calculation).
const foodSchema = new mongoose.Schema(
    {
        // where the nutrition data came from: "fatsecret" | "manual"
        provider: { type: String, enum: ["fatsecret", "manual"], default: "fatsecret" },
        providerFoodId: { type: String, default: null, maxlength: 40 },
        name: { type: String, required: true, trim: true, maxlength: 200 },
        brand: { type: String, default: "", maxlength: 120 },
        servingDescription: { type: String, default: "", maxlength: 200 },
        servingId: { type: String, default: null, maxlength: 20 },

        // how many of the serving (or 100g-grams basis) were eaten
        quantity: { type: Number, default: 1, min: 0.01, max: 50 },
        // optional absolute weight when the user grams-based portion is known
        grams: { type: Number, default: null, min: 0, max: 5000 },

        // nutrition for ONE quantity of the described serving (kcal / grams)
        calories: { type: Number, default: 0, min: 0, max: 10000 },
        protein: { type: Number, default: 0, min: 0, max: 2000 },
        carbs: { type: Number, default: 0, min: 0, max: 2000 },
        fat: { type: Number, default: 0, min: 0, max: 2000 },

        // true only for photo-estimated items (provider-provided estimates)
        estimated: { type: Boolean, default: false }
    },
    { _id: true }
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

        foods: {
            type: [foodSchema],
            validate: {
                validator: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 30,
                message: "A meal needs 1–30 foods"
            }
        },

        // how this meal was logged: "search" | "photo" | "barcode" | "manual"
        source: {
            type: String,
            enum: ["search", "photo", "barcode", "manual"],
            default: "search"
        },

        notes: { type: String, default: "", maxlength: 500 }
    },
    { timestamps: true }
);

mealSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model("Meal", mealSchema);
