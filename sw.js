// Minimal service worker so MD Fit installs as an app. Caches the app shell; API calls always go to the network.
const CACHE = "mdfit-4deff95993";
const SHELL = ["/account","/nozoom.js","/app/app.css","/account.css","/guides.css","/app-theme.css","/mdfit-guide.css","/app-theme.js","/config.js","/analytics.js","/realtime.js","/common.js","/search.js","/app/exercises.js","/app/library.js","/app/generator.js","/painmuscles.js","/painpatterns.js","/paintracks.js","/painmap.js","/musclereports.js","/guides.js","/stripe-checkout.js","/account.js","/account-xp.js","/account-share.js","/account-habits.js","/mdfit-guide.js","/assets/logo.webp"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first so updates show right away; fall back to the cache when offline.
// Pages come back without the Content-Disposition header the host adds to clean URLs (inline; filename="login"):
// when a service worker hands Safari a navigation response carrying that header, Safari asks to "allow downloads"
// instead of showing the page.
const clean = (res) => {
  if (!/text\/html/i.test(res.headers.get("content-type") || "") || !res.headers.has("content-disposition")) return res;
  const h = new Headers(res.headers); h.delete("content-disposition");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
    res = clean(res);
    if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => (hit ? clean(hit) : hit))));
});
