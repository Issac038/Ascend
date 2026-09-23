const mongoose = require("mongoose");

// Web Push subscription for background notifications.
// One document per browser/endpoint; a user may have several devices.
const pushSubscriptionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        endpoint: { type: String, required: true, maxlength: 1000 },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true }
        },
        // user agent string for device identification in settings UI
        userAgent: { type: String, default: "", maxlength: 300 },
        // TZ offset (JS convention) at subscribe time — scheduling sanity only
        timezoneOffset: { type: Number, default: 0, min: -840, max: 840 },
        lastUsedAt: { type: Date, default: Date.now },
        // set when a push 404/410s so we stop sending to dead endpoints
        expiredAt: { type: Date, default: null }
    },
    { timestamps: true }
);

pushSubscriptionSchema.index({ userId: 1 });
pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
