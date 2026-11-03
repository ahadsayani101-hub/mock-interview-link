// Makes Callback installable and quick to open. Pages and files always come fresh from the
// network when there is one (so updates show up right away); the saved copy is only used
// offline. The API is never cached.
const CACHE = "callback-v1";
const SHELL = ["/", "/style.css", "/app.js", "/ui.js", "/interview.js", "/install.js", "/vendor/qrcode.js", "/manifest.webmanifest", "/icon-192.png", "/favicon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          // Every interview page (/i/...) is the same app page, so keep one copy of it.
          caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req.mode === "navigate" ? "/" : req)) || Response.error())
  );
});
