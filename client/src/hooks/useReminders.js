import { useEffect, useRef } from "react";

// ------------------------------------------------------------
// In-app reminder scheduler.
//
// Honors the user's notification settings while ASCEND is open:
//  - daily reminder at the configured time (browser notification if
//    permitted, otherwise an in-app toast)
//  - evening reflection prompt (20:00)
//  - weekly review nudge (Monday 09:00)
//
// This is honest client-side scheduling: it works while the app is
// open, and the settings page says exactly that. No fake promises.
// ------------------------------------------------------------
function sameMinute(target, now) {
    const [h, m] = target.split(":").map(Number);
    return now.getHours() === h && now.getMinutes() === m;
}

export default function useReminders(settings, toast, user) {
    const firedRef = useRef({}); // key: "daily-2026-09-17" etc.

    useEffect(() => {
        if (!user || !settings) return undefined;

        // ask for browser notification permission once when reminders are on
        if (settings.notifications?.dailyReminder && notifSupported() && Notification.permission === "default") {
            Notification.requestPermission().catch(() => {});
        }

        const tick = () => {
            const now = new Date();
            const dayKey = now.toISOString().slice(0, 10);
            const n = settings.notifications || {};

            const fire = (key, message, useBrowser) => {
                const id = `${key}-${dayKey}`;
                if (firedRef.current[id]) return;
                firedRef.current[id] = true;
                if (useBrowser && notifSupported() && Notification.permission === "granted") {
                    try {
                        new Notification("ASCEND", { body: message });
                    } catch {
                        toast(message);
                    }
                } else {
                    toast(message);
                }
            };

            if (n.dailyReminder && n.dailyReminderTime && sameMinute(n.dailyReminderTime, now)) {
                fire("daily", "Time to ascend — check in with today's habits.", true);
            }
            if (n.eveningReflection && sameMinute("20:00", now)) {
                fire("evening", "Evening reflection — how was your day?", false);
            }
            if (n.weeklyReview && now.getDay() === 1 && sameMinute("09:00", now)) {
                fire("weekly", "New week. Set the tone — review last week in Analytics.", false);
            }
        };

        const interval = setInterval(tick, 30000); // check every 30s
        return () => clearInterval(interval);
    }, [settings, toast, user]);
}

function notifSupported() {
    return typeof window !== "undefined" && "Notification" in window;
}
