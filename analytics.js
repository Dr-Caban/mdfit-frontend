(function () {
  "use strict";
  var API = (window.MDFIT_CONFIG || {}).apiUrl;
  if (!API) return;
  API = API.replace(/\/+$/, "");
  try {
    var q = new URLSearchParams(location.search);
    var body = JSON.stringify({ page: location.pathname, referrer: document.referrer || "", utm: q.get("utm_source") || q.get("ref_src") || "", w: window.innerWidth || 0 });
    (navigator.sendBeacon || function (u, d) { fetch(u, { method: "POST", body: d, headers: { "Content-Type": "application/json" }, keepalive: true }); })
      .call(navigator, API + "/api/hit", new Blob([body], { type: "application/json" }));
  } catch (e) {}
})();
