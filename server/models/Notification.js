const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        type: { type: String, default: "info", maxlength: 30 },
        title: { type: String, required: true, maxlength: 100 },
        body: { type: String, default: "", maxlength: 300 },
        read: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now }
    }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
