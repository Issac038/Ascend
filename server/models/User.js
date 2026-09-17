const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 60 },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        password: { type: String, required: true },

        // ---- Profile ----
        avatarInitials: { type: String, default: "", maxlength: 2 },
        motto: { type: String, default: "", maxlength: 140 },
        futureVision: { type: String, default: "", maxlength: 500 },
        bio: { type: String, default: "", maxlength: 300 },
        onboarded: { type: Boolean, default: false },

        // User's timezone offset at last profile/onboarding update.
        // JS Date#getTimezoneOffset convention: minutes to ADD to local time
        // to reach UTC (UTC+2 -> -120, UTC-5 -> 300). Range covers all
        // real-world offsets incl. ±14h with 45-minute zones.
        timezoneOffset: { type: Number, default: 0, min: -840, max: 840 },

        // ---- Gamification (cached, recomputed on write) ----
        xp: { type: Number, default: 0, min: 0 },
        ascendDate: { type: Date, default: Date.now },

        // ---- Recovery state ----
        recovery: {
            active: { type: Boolean, default: false },
            since: { type: String, default: null },
            missedDays: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
