const mongoose = require("mongoose");

// ============================================================
// BASELINE — the onboarding starting point from four self-reported sliders
// and the user's plain-text Goal Drive motivation.
//
// Exactly ONE document per user (unique userId), created on first assess
// and only replaced through an explicit baseline update before confirmation
// or the account reset/delete flows. It is deliberately stored apart from
// activity-based metrics: four values are self-reported slider conversions
// and Goal Drive is not scored. They are NOT derived from tracked habits,
// tasks, goals or workouts and must never be blended with them silently.
//
// `status`:
//   draft     — generated, awaiting user review/confirm
//   confirmed — user pressed "Start ascending"; preserved verbatim
//               if onboarding is revisited (never silently replaced)
// ============================================================

const VALID_STATUSES = ["draft", "confirmed"];
const CONF = { minimize: true };
const sliderAnswerField = () => ({
    type: mongoose.Schema.Types.Mixed,
    default: "",
    validate: {
        validator(value) {
            return (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10) ||
                (typeof value === "string" && value.length <= 600);
        },
        message: "Slider answers must be integers from 1 to 10 or legacy strings up to 600 characters."
    }
});

const assessmentSchema = new mongoose.Schema(
    {
        // null = not scored (Goal Drive is retained as plain-text motivation).
        score: { type: Number, default: null, min: 0, max: 100 },

        // Short explanation of how the self-reported rating was recorded.
        explanation: { type: String, default: "", maxlength: 500 },

        // Kept for historical records; local slider ratings have no confidence score.
        confidence: { type: String, default: null, enum: ["high", "medium", "low", null] },

        // Kept for historical records.
        followUpQuestion: { type: String, default: null, maxlength: 300 },

        // true when there was not enough relevant information to score.
        // Displayed as "Not enough information yet" — no fabricated number.
        insufficient: { type: Boolean, default: false }
    },
    { _id: false }
);

const baselineSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true
        },

        // Mixed keeps legacy string answers readable while slider ratings are
        // stored as numbers. Goal Drive remains plain text.
        answers: {
            body: sliderAnswerField(),
            discipline: sliderAnswerField(),
            learning: sliderAnswerField(),
            productivity: sliderAnswerField(),
            goalDrive: { type: String, default: "", maxlength: 600 }
        },

        // Four locally scored slider ratings plus unscored Goal Drive text.
        // Draft = last saved baseline; confirmed = the locked-in starting baseline.
        assessments: {
            type: Map,
            of: assessmentSchema,
            default: () => ({})
        },

        status: { type: String, enum: VALID_STATUSES, default: "draft" },

        // Which scores belong to `assessments` (the confirmed baseline).
        confirmedAt: { type: Date, default: null },
        assessedAt: { type: Date, default: null },

        // Provenance for the baseline scoring format; old values remain readable.
        rubricVersion: { type: String, default: "" },
        model: { type: String, default: "" },
        assessmentMethod: { type: String, enum: ["", "gemini", "rule-based", "self-reported"], default: "" }
    },
    { timestamps: true, minimize: false }
);

baselineSchema.index({ userId: 1 });

module.exports = mongoose.model("Baseline", baselineSchema);
