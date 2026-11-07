// Minimal service worker so MD Fit installs as an app. Caches the app shell; API calls always go to the network.
const CACHE = "mdfit-8f1a06fe2d";
const SHELL = ["/account","/nozoom.js","/app/app.css","/account.css","/guides.css","/config.js","/analytics.js","/realtime.js","/common.js","/search.js","/app/exercises.js","/app/library.js","/app/generator.js","/painmuscles.js","/painpatterns.js","/paintracks.js","/painmap.js","/musclereports.js","/guides.js","/stripe-checkout.js","/account.js","/account-xp.js","/account-habits.js","/assets/logo.webp"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first so updates show right away; fall back to the cache when offline
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
    if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
