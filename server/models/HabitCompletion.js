const mongoose = require("mongoose");

const habitCompletionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        habitId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Habit",
            required: true
        },
        date: { type: String, required: true }, // YYYY-MM-DD

        // boolean habits
        completed: { type: Boolean, default: false },

        // numeric habits
        value: { type: Number, default: 0 },
        target: { type: Number, default: 0 } // snapshot of target when logged
    },
    { timestamps: true }
);

habitCompletionSchema.index({ userId: 1, date: 1 });
habitCompletionSchema.index({ userId: 1, habitId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("HabitCompletion", habitCompletionSchema);
