const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
        ref: "User",
            required: true
        },
        title: { type: String, required: true, trim: true, maxlength: 140 },
        notes: { type: String, default: "", maxlength: 1000 },

        date: { type: String, required: true }, // YYYY-MM-DD

        // morning | afternoon | evening | anytime
        timeBlock: {
            type: String,
            enum: ["morning", "afternoon", "evening", "anytime"],
            default: "anytime"
        },

        priority: {
            type: String,
            enum: ["low", "normal", "high"],
            default: "normal"
        },

        completed: { type: Boolean, default: false },
        completedAt: { type: Date, default: null },
        skipped: { type: Boolean, default: false },

        // Recurrence: "none" | "daily" | "weekdays" | "weekly"
        recurrence: { type: String, enum: ["none", "daily", "weekdays", "weekly"], default: "none" },

        goalId: { type: mongoose.Schema.Types.ObjectId, ref: "Goal", default: null },
        habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", default: null }
    },
    { timestamps: true }
);

taskSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model("Task", taskSchema);
