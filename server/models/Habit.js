const mongoose = require("mongoose");

const habitSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        name: { type: String, required: true, trim: true, maxlength: 80 },
        description: { type: String, default: "", maxlength: 500 },
        area: { type: String, required: true, maxlength: 30 },
        type: { type: String, enum: ["boolean", "numeric"], default: "boolean" },

        // "daily" | "specific_days" | "times_per_week"
        frequency: {
            type: String,
            enum: ["daily", "specific_days", "times_per_week"],
            default: "daily"
        },
        // 0=Sun .. 6=Sat, used when frequency = "specific_days"
        specificDays: [{ type: Number, min: 0, max: 6 }],

        // numeric habits: target value + unit; boolean habits: 1
        target: { type: Number, default: 1, min: 0 },
        unit: { type: String, default: "", maxlength: 20 },

        difficulty: {
            type: String,
            enum: ["easy", "medium", "hard"],
            default: "medium"
        },

        reminderTime: { type: String, default: null },
        startDate: { type: String, default: null },
        archived: { type: Boolean, default: false }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Habit", habitSchema);
