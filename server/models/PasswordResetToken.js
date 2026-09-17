const mongoose = require("mongoose");

// Password-reset codes: stored HASHED, single-use, auto-expiring.
const passwordResetTokenSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, lowercase: true, trim: true },
        codeHash: { type: String, required: true }, // sha256 of the 6-digit code
        expiresAt: { type: Date, required: true },
        createdAt: { type: Date, default: Date.now }
    },
    { timestamps: false }
);

passwordResetTokenSchema.index({ email: 1 });
// TTL index: MongoDB removes expired tokens automatically.
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PasswordResetToken", passwordResetTokenSchema);
