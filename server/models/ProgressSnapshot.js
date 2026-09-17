const mongoose = require("mongoose");

const progressSnapshotSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        date: { type: String, required: true }, // YYYY-MM-DD

        habitsDone: { type: Number, default: 0 },
        habitsScheduled: { type: Number, default: 0 },
        tasksDone: { type: Number, default: 0 },
        tasksTotal: { type: Number, default: 0 },
        score: { type: Number, default: null }, // 0..100, null = rest day
        counted: { type: Boolean, default: false }, // counts toward streaks

        actions: { type: Number, default: 0 }, // habits + tasks done
        journalLogged: { type: Boolean, default: false },
        bestStreak: { type: Number, default: 0 }, // as of this date

        // Total XP this snapshot has granted (day-score XP + reflection XP).
        // The engine grants only the DELTA vs this value, making day XP
        // idempotent across recomputes. PERSISTED — without it every
        // recompute would re-award the full day XP.
        xpGranted: { type: Number, default: 0 }
    },
    { timestamps: true }
);

progressSnapshotSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("ProgressSnapshot", progressSnapshotSchema);
