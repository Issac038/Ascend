const express = require("express");
const auth = require("../middleware/auth");
const PushSubscription = require("../models/PushSubscription");
const { pushStatus } = require("../services/pushService");

const router = express.Router();

// Capability + configuration status. Honest about what's missing —
// the client renders exactly this state, no fake promises.
router.get("/status", auth, (req, res) => {
    res.json({ success: true, ...pushStatus() });
});

// Save (or replace) this browser's push subscription.
router.post("/subscribe", auth, async (req, res) => {
    try {
        const { endpoint, keys } = req.body || {};
        if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
            return res.status(400).json({ success: false, message: "Invalid subscription" });
        }
        await PushSubscription.findOneAndUpdate(
            { endpoint: String(endpoint).slice(0, 1000) },
            {
                userId: req.userId,
                endpoint: String(endpoint).slice(0, 1000),
                keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
                userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
                timezoneOffset: Number.isFinite(req.body.timezoneOffset)
                    ? Math.max(-840, Math.min(840, Math.round(req.body.timezoneOffset)))
                    : 0,
                expiredAt: null,
                lastUsedAt: new Date()
            },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to save subscription" });
    }
});

// Remove this browser's subscription (user turned reminders off, etc.)
router.post("/unsubscribe", auth, async (req, res) => {
    try {
        const { endpoint } = req.body || {};
        if (!endpoint) return res.status(400).json({ success: false, message: "endpoint is required" });
        await PushSubscription.deleteOne({ userId: req.userId, endpoint: String(endpoint).slice(0, 1000) });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: "Failed to remove subscription" });
    }
});

module.exports = router;
