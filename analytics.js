(function () {
  "use strict";
  // Vercel Web Analytics (loaded after this file): page views only, and never a URL that carries an appointment
  // token or a signed-in screen. The queue stub must exist before the insights script runs.
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va("beforeSend", function (ev) {
    try {
      var u = new URL(ev.url, location.origin);
      if (/^\/(admin|intake|cancel|account)/.test(u.pathname)) return null;
      u.search = ""; u.hash = "";
      return Object.assign({}, ev, { url: u.toString() });
    } catch (e) { return null; }
  });

  var API = (window.MDFIT_CONFIG || {}).apiUrl;
  if (!API) return;
  API = API.replace(/\/+$/, "");
  try {
    var q = new URLSearchParams(location.search);
    // Same-origin referrers can carry ?token= from the intake or cancel page: keep the path only
    var ref = "";
    try { var r = document.referrer ? new URL(document.referrer) : null; ref = r ? r.origin + r.pathname : ""; } catch (e) {}
    var body = JSON.stringify({ page: location.pathname, referrer: ref, utm: q.get("utm_source") || q.get("ref_src") || "", w: window.innerWidth || 0 });
    (navigator.sendBeacon || function (u, d) { fetch(u, { method: "POST", body: d, headers: { "Content-Type": "application/json" }, keepalive: true }); })
      .call(navigator, API + "/api/hit", new Blob([body], { type: "application/json" }));
  } catch (e) {}
})();
