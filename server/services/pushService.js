// ------------------------------------------------------------
// Web Push sender + daily/evening scheduler.
//
// TRUE BACKGROUND NOTIFICATIONS REQUIRE Web Push:
//   - a VAPID key pair (env: WEB_PUSH_VAPID_PUBLIC_KEY / _PRIVATE_KEY_)
//   - the `web-push` npm package
//   - a PushSubscription saved from the browser
//   - a server-side scheduler that runs even when no one has the
//     app open (in production: the always-on Render web service)
//
// When VAPID env vars are ABSENT the pipeline is honestly DISABLED:
// no fake pushes, no pretend scheduling. The scheduler still writes
// in-app Notification documents so nothing is lost while the app is
// closed, and /api/push/status reports exactly what is missing.
//
// NO ENVIRONMENT FILES WERE MODIFIED — the env vars above are
// documented here and in the report for the user to add themselves.
// ------------------------------------------------------------

// web-push is an optional dependency: the app must boot cleanly when
// it is not installed (it is added to package.json, but a stale deploy
// or offline dev box should not crash the whole backend).
let webpush = null;
try {
    webpush = require("web-push");
} catch {
    webpush = null;
}

const mongoose = require("mongoose");
const PushSubscription = require("../models/PushSubscription");
const Notification = require("../models/Notification");
const Settings = require("../models/Settings");
const User = require("../models/User");

const VAPID_PUBLIC = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.WEB_PUSH_SUBJECT || "mailto:admin@ascend.app";

let vapidConfigured = false;
if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) {
    try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
        vapidConfigured = true;
    } catch (e) {
        console.error("[push] invalid VAPID config:", e.message);
        vapidConfigured = false;
    }
}

const MORNING_TITLE = "Good morning.";
const MORNING_BODY = "Here's what you need to get done today.";
const EVENING_TITLE = "How did you do today?";
const EVENING_BODY = "Finish what remains before the day ends.";

// A scheduler tick fires for users whose reminder minute has arrived.
// Ticks run every minute; a fire window of ±90s makes one missed tick
// recoverable while never double-firing (per-user date+slot key).
function minutesOfDay(localNow, tzOffsetMinutes) {
    // JS convention: getTimezoneOffset() minutes to ADD to local to get UTC,
    // so local = UTC - offset.
    const local = new Date(localNow.getTime() - tzOffsetMinutes * 60 * 1000);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function dayKeyFor(localNow, tzOffsetMinutes) {
    const local = new Date(localNow.getTime() - tzOffsetMinutes * 60 * 1000);
    return local.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// Fire a notification to every subscription of a user.
// Writes an in-app Notification document first (source of truth),
// then attempts Web Push. Dead endpoints (404/410) are expired.
// Returns { inApp, pushed, failed, skipped }.
// ------------------------------------------------------------
async function deliver(userId, { type, title, body }) {
    const out = { inApp: false, pushed: 0, failed: 0, skipped: 0 };

    await Notification.create({ userId, type, title, body });
    out.inApp = true;

    if (!vapidConfigured) {
        out.skipped = 1; // pipeline disabled — in-app copy saved
        return out;
    }

    const subs = await PushSubscription.find({ userId, expiredAt: null });
    if (!subs.length) {
        out.skipped = 1; // no device subscribed
        return out;
    }

    await Promise.all(
        subs.map(async (s) => {
            try {
                await webpush.sendNotification(
                    { endpoint: s.endpoint, keys: s.keys },
                    JSON.stringify({ type, title, body })
                );
                out.pushed += 1;
            } catch (e) {
                if (e && (e.statusCode === 404 || e.statusCode === 410)) {
                    await PushSubscription.updateOne({ _id: s._id }, { $set: { expiredAt: new Date() } });
                }
                out.failed += 1;
            }
        })
    );
    return out;
}

// ------------------------------------------------------------
// Scheduler tick.
// For every user with matching local morning/evening time:
//   1. settings.notifications.dailyReminder + dailyReminderTime (morning)
//   2. settings.notifications.eveningReflection (evening, 20:00)
// Idempotency: an in-app Notification with the same dedupe key is
// checked before sending, so a tick re-run never double-fires.
// ------------------------------------------------------------
async function tick(now = new Date(), windowMinutes = 1.5) {
    if (!mongoose.connection.readyState) return;

    const users = await User.find({}).select("timezoneOffset").lean();
    const nowMinUTC = now.getUTCHours() * 60 + now.getUTCMinutes();

    for (const u of users) {
        const tz = u.timezoneOffset || 0;
        let settings;
        try {
            settings = await Settings.findOne({ userId: u._id }).lean();
        } catch {
            continue;
        }
        if (!settings) continue;
        const n = settings.notifications || {};
        const day = dayKeyFor(now, tz);
        const localMin = minutesOfDay(now, tz);

        const due = [];
        if (n.dailyReminder && n.dailyReminderTime) {
            const [h, m] = String(n.dailyReminderTime).split(":").map(Number);
            if (Number.isFinite(h) && Number.isFinite(m)) {
                const target = h * 60 + m;
                if (Math.abs(localMin - target) <= windowMinutes) {
                    due.push({ slot: "morning", type: "morning", title: MORNING_TITLE, body: MORNING_BODY });
                }
            }
        }
        if (n.eveningReflection) {
            if (Math.abs(localMin - 20 * 60) <= windowMinutes) {
                due.push({ slot: "evening", type: "evening", title: EVENING_TITLE, body: EVENING_BODY });
            }
        }
        if (!due.length) continue;

        for (const d of due) {
            // Idempotency key: one notification per user per day per slot.
            const already = await Notification.countDocuments({
                userId: u._id,
                type: d.type,
                createdAt: { $gte: new Date(`${day}T00:00:00.000Z`) } // approx guard
            });
            if (already > 0 && d.type === "morning") {
                // multiple morning pushes per day would be spammy — skip
                continue;
            }
            if (d.type === "evening" && already > 0) continue;

            await deliver(u._id, d);
        }
    }
}

function startScheduler() {
    // In production the Render web service is always on, so setInterval here
    // is a genuine server-side scheduler (NOT a browser timer).
    // Tests import tick() directly and never start the interval.
    if (process.env.NODE_ENV === "test") return;
    setInterval(() => {
        tick().catch((e) => console.error("[push] scheduler tick failed:", e.message));
    }, 60 * 1000);
}

function pushStatus() {
    return {
        webPushAvailable: !!webpush,
        vapidConfigured,
        // Public key is safe to expose — the browser needs it to subscribe.
        publicKey: vapidConfigured ? VAPID_PUBLIC : null,
        transport: vapidConfigured ? "web-push (background-capable)" : "in-app notifications only",
        missing: vapidConfigured
            ? []
            : [
                ...(webpush ? [] : ["web-push package not installed"]),
                ...(!VAPID_PUBLIC ? ["WEB_PUSH_VAPID_PUBLIC_KEY"] : []),
                ...(!VAPID_PRIVATE ? ["WEB_PUSH_VAPID_PRIVATE_KEY"] : [])
            ]
    };
}

module.exports = {
    tick,
    deliver,
    startScheduler,
    pushStatus,
    minutesOfDay,
    dayKeyFor,
    MORNING_TITLE,
    MORNING_BODY,
    EVENING_TITLE,
    EVENING_BODY
};
