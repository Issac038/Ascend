const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true
        },

        notifications: {
            dailyReminder: { type: Boolean, default: false },
            dailyReminderTime: { type: String, default: "08:00" },
            eveningReflection: { type: Boolean, default: true },
            weeklyReview: { type: Boolean, default: true },
            achievements: { type: Boolean, default: true }
        },

        appearance: {
            reduceMotion: { type: Boolean, default: false },
            highContrast: { type: Boolean, default: false },
            largerText: { type: Boolean, default: false }
        },

        nutrition: {
            // Optional, user-defined daily calorie tracking target (kcal).
            // Deliberately NOT auto-prescribed from age/weight/sex — it is a
            // personal tracking goal, not medical advice.
            dailyCalorieTarget: { type: Number, default: null, min: 800, max: 10000 }
        },

        privacy: {
            showStreaks: { type: Boolean, default: true }
        },

        account: {
            dataSharing: { type: Boolean, default: false }
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
