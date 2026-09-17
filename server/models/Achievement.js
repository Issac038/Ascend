const mongoose = require("mongoose");

const userAchievementSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        code: { type: String, required: true, maxlength: 40 },
        earnedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

userAchievementSchema.index({ userId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("UserAchievement", userAchievementSchema);
