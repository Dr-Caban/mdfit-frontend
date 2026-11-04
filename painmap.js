// Pain map: front/back anatomy with gold-glowing regions. Works on homepage (#pain-map) and account page ([data-painmap="app"]).
(() => {
  const { $, $$, esc } = window.MDFit;

  const MUS = window.MDFitMuscles, TK = window.MDFitTracks;
  const W = 1182, H = 1073;
  const REGIONS = MUS.BODY_REGIONS;
  const smooth = (p) => p.map((pt, i) => {
    const p0 = p[(i - 1 + p.length) % p.length], p1 = pt, p2 = p[(i + 1) % p.length], p3 = p[(i + 2) % p.length];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    return `${i ? "" : `M${p1[0]} ${p1[1]}`}C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }).join("") + "Z";
  const PATH = Object.fromEntries(REGIONS.map((r) => [r.id, smooth(r.pts)]));
  const PP = window.MDFitPatterns;
  const sideWord = (r) => (r.side === "center" ? "" : ` (${r.side} side)`);

  const svgMarkup = (filterId) => `<svg class="pm-regions" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Body regions">
    <defs><filter id="${filterId}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b"/><feFlood flood-color="#F2CF7A" flood-opacity=".95"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter><mask id="${filterId}-body" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><image href="/assets/pain/body-mask.png" width="${W}" height="${H}"/></mask></defs>
    <g mask="url(#${filterId}-body)">${REGIONS.map((r, i) => `<path class="pm-region" d="${PATH[r.id]}" data-region="${r.id}" tabindex="0" role="button" aria-pressed="false" aria-label="Region ${i + 1}, ${r.view} of body${sideWord(r)}"/>`).join("")}</g></svg>`;

  function initMap(root, ctx) {
    const isApp = ctx === "app";
    const filterId = isApp ? "pm-glow-app" : "pm-glow";

    const hotspot = $(".hotspots", root);
    if (hotspot) hotspot.outerHTML = svgMarkup(filterId);
    else if (!$(".pm-regions", root)) {
      const wrap = document.createElement("div");
      wrap.innerHTML = svgMarkup(filterId);
      $(".pm-stage", root).appendChild(wrap.firstElementChild);
    }

    const stage = $(".pm-stage", root);
    // Touch feedback (iOS doesn't apply :active to SVG paths reliably)
    stage.addEventListener("pointerdown", (e) => { const r = e.target.closest(".pm-region"); if (r) { r.classList.add("touching"); setTimeout(() => r.classList.remove("touching"), 450); } });
    function setView(v) {
      stage.dataset.pmside = v;
      $$(".pm-toggle [data-pmview]", root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.pmview === v));
    }
    $$(".pm-toggle [data-pmview]", root).forEach((b) => b.addEventListener("click", () => setView(b.dataset.pmview)));
    setView("front");

    let sheet;
    function ensureSheet() {
      if (sheet) return sheet;
      sheet = document.createElement("dialog");
      sheet.className = "pm-sheet";
      sheet.innerHTML = `<button type="button" class="pm-sheet-close" aria-label="Close">&times;</button><div class="pm-sheet-body"></div>`;
      document.body.appendChild(sheet);
      sheet.addEventListener("click", (e) => {
        if (e.target === sheet || e.target.closest(".pm-sheet-close")) return sheet.close();
        const c = e.target.closest("[data-track]");
        if (c) {
          // iOS Safari can leave a closed dialog's dark backdrop on screen: remove the sheet entirely, then start
          if (isApp) { const t = c.dataset.track; sheet.close(); sheet.remove(); sheet = null; setTimeout(() => { location.hash = "pain/track/" + t; }, 60); return; }
          else TK.open(c.dataset.track, { startLabel: "Do this track in the free MD Fit app →", onStart: (t) => { location.href = `/account#pain/track/${t.id}`; } });
        }
        if (e.target.closest("a[href^='#']")) sheet.close();
      });
      sheet.addEventListener("close", () => $$(".pm-region", root).forEach((b) => b.setAttribute("aria-pressed", "false")));
      return sheet;
    }

    function showArea(areaId) {
      const p = REGIONS.find((x) => x.id === areaId);
      if (!p) return;
      $$(".pm-region", root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.region === areaId));
      let tracks = (p.tracks || []).map((id) => TK.TRACKS.find((t) => t.id === id)).filter(Boolean);
      if (!tracks.length) tracks = [...new Set(MUS.rank(p.spots).slice(0, 6).flatMap((m) => TK.forPoint(m.id)))].slice(0, 6);
      const d = ensureSheet();
      $(".pm-sheet-body", d).innerHTML = `
        <header class="pm-sheet-head pm-sheet-head--minimal">
          <h2>Tap the pattern that matches your pain</h2>
        </header>
        ${tracks.length ? `<div class="pm-choices pm-choices--clean">${tracks.map((t) => `<button type="button" class="pm-choice pm-choice--img-only ${PP && PP.has(t.id) && PP.PATTERNS[t.id].length > 1 ? "two" : ""}" data-track="${t.id}">
            ${PP && PP.has(t.id) ? PP.html(t.id, "") : `<div class="pp"><img src="${TK.img(t.img[0], 800)}" alt="" referrerpolicy="no-referrer"></div>`}
          </button>`).join("")}</div>` : `<p class="muted">We don't have a self-guided track for this area yet. Dr. Jared can find the source in one visit.</p>`}
        <div class="pm-none"><span>None of these look right?</span><a href="${isApp ? "#book" : "/book"}" class="btn btn-sm">Book an evaluation</a></div>`;
      if (!d.open) d.showModal();
      $(".pm-sheet-body", d).scrollTop = 0;
    }

    const regions = $(".pm-regions", root);
    regions.addEventListener("click", (e) => {
      const r = e.target.closest("[data-region]");
      if (r) showArea(r.dataset.region);
    });
    regions.addEventListener("keydown", (e) => {
      const r = e.target.closest("[data-region]");
      if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showArea(r.dataset.region); }
    });
  }

  // Homepage: auto-init if #pain-map exists
  const homeRoot = $("#pain-map");
  if (homeRoot) {
    initMap(homeRoot, "home");
  }

  // Expose for account page lazy init
  window.MDFitPainMap = { init: (root) => initMap(root, "app") };
})();
