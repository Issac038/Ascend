/* ASCEND push handler — imported by the generated service worker.
 *
 * The workbox build (vite-plugin-pwa generateSW) imports this file via
 * workbox.importScripts, so these listeners run inside the app's real
 * service worker. That is what makes notifications arrive while the app
 * is in the background or fully closed — browser timers are never used.
 */

self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { title: "ASCEND", body: event.data ? event.data.text() : "" };
    }
    const title = data.title || "ASCEND";
    const body = data.body || "";
    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: "/icons/pwa-icon-192.png",
            badge: "/icons/pwa-icon-192.png",
            tag: data.type || "ascend",
            renotify: false,
            data: { url: "/" }
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ("focus" in client) return client.focus();
            }
            return self.clients.openWindow((event.notification.data && event.notification.data.url) || "/");
        })
    );
});
