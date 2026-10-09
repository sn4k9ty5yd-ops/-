/* ALBUM: 通知を受け取る（Service Worker） */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "ALBUM", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "ALBUM", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || undefined, data: { url: d.url || "/home" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/home";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ("focus" in c) {
        // 開いている画面を、通知の先へ移す（iPhoneは navigate が効かないことがあるので、画面に頼んで移ってもらう）
        const full = new URL(url, self.location.origin).href;
        c.postMessage({ type: "go", url: full });
        return c.focus().then((f) => (f && f.navigate ? f.navigate(full).catch(() => {}) : undefined)).catch(() => {});
      }
    }
    return self.clients.openWindow(url);
  }));
});
