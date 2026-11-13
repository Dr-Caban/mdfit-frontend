// /testimonials: shows the practice's current Google reviews from the same feed the homepage uses (/api/reviews).
// The page already carries one stored review and a link to every review on Google, so it reads fine if this fails.
(function () {
  var box = document.getElementById("live-reviews");
  if (!box || !window.fetch) return;
  var api = ((window.MDFIT_CONFIG || {}).apiUrl || "").replace(/\/+$/, "");
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  fetch(api + "/api/reviews").then(function (r) { return r.ok ? r.json() : null; }).then(function (g) {
    if (!g || !g.reviews || !g.reviews.length) return;
    box.innerHTML = g.reviews.map(function (r) {
      var stars = new Array(Math.max(1, Math.min(5, Math.round(r.rating || 5))) + 1).join("★");
      return '<blockquote class="cd-review"><p>&ldquo;' + esc(r.text) + '&rdquo;</p><cite>&mdash; ' + esc(r.author) + ", Google review" +
        ' <span aria-label="' + esc(r.rating) + ' out of 5 stars">' + stars + "</span>" + (r.relativeTime ? " &middot; " + esc(r.relativeTime) : "") + "</cite></blockquote>";
    }).join("");
  }).catch(function () {});
})();
