import { useEffect } from "react";
import api from "../services/api";

// ------------------------------------------------------------
// Web Push subscription lifecycle (client half).
//
// When the user has reminders enabled AND the server reports a
// configured VAPID key, this hook ensures the browser's push
// subscription is registered server-side. Delivery then happens
// from the server scheduler (see server/services/pushService.js) —
// notifications arrive while the app is backgrounded or closed.
//
// When VAPID is not configured the server says so via /push/status
// and this hook does nothing: no fake subscriptions, no broken UI.
// The service worker handles display (public/push-handler.js).
// ------------------------------------------------------------

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
}

export default function usePushSubscription({ settings, user }) {
    const remindersOn = !!(settings?.notifications?.dailyReminder || settings?.notifications?.eveningReflection);

    useEffect(() => {
        if (!user || !remindersOn) return undefined;

        let cancelled = false;

        (async () => {
            try {
                const statusRes = await api.get("/push/status");
                const status = statusRes.data || {};
                if (cancelled || !status.vapidConfigured || !status.publicKey) return;

                if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

                const permission = await Notification.requestPermission();
                if (cancelled || permission !== "granted") return;

                const reg = await navigator.serviceWorker.ready;
                let sub = await reg.pushManager.getSubscription();
                if (!sub) {
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(status.publicKey)
                    });
                }
                if (cancelled) return;

                const json = sub.toJSON();
                await api.post("/push/subscribe", {
                    endpoint: json.endpoint,
                    keys: json.keys,
                    timezoneOffset: new Date().getTimezoneOffset()
                });
            } catch {
                // Subscription is best-effort: in-app reminders + server-side
                // Notification documents still work without it.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user, remindersOn, settings?.notifications?.dailyReminder, settings?.notifications?.eveningReflection]);
}
