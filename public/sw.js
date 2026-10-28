// Household Garage service worker: shows maintenance reminders and opens the app when one is tapped.
// It does not cache pages; the app always loads fresh from the server.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Household Garage", {
    body: data.body || "Open Garage to see what's due.",
    tag: data.tag || "maintenance-reminder",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/maintenance" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/maintenance", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      // Focus first: browsers only allow it briefly after the tap.
      const focused = await client.focus();
      try { if ("navigate" in focused) await focused.navigate(url); } catch { /* already open; leave it where it is */ }
      return focused;
    }
    return self.clients.openWindow(url);
  })());
});
