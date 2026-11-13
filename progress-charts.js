// Progress overview: the same charts in the member app (Profile → My progress) and in the workspace (client chart →
// Progress). Plain inline SVG, no library and no outside service, so a member's numbers never leave MD Fit.
//
// Data shape (GET /api/me/progress and GET /api/admin/clients/:id/progress, built by one function on the server):
//   { range: { days, from, to, maxDays, member, capped },
//     headline: { workoutsThisMonth, activeDays30, streak, painChange: { area, first, last, delta } | null },
//     weeks: [{ week, workouts, minutes, activeDays }],
//     pain: { areas: [{ area, points: [{ date, level }] }] },
//     programs: [{ id, title, label: "Recommended" | "Saved", done, total, pct }],
//     vitals: { weight: [{ date, value }], restingHr: [...], sleep: [...] } }
//
// Charts follow the practice's data-viz rules: one axis per chart (body measures are small multiples, never a second
// y-axis), thin marks, a hover tooltip on every mark, a table view for every chart, a legend plus direct labels when a
// chart has more than one line, colours from a palette checked for colour-blind separation in both themes, and text
// in the page's own ink colours, never the series colour.
//
//   MDFitProgress.mount(el, { load: (days) => Promise<data>, admin: false, upgradeHref: "#premium" })
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (iso) => { const [y, m, d] = String(iso || "").split("-").map(Number); return y ? `${MON[m - 1]} ${d}` : ""; };
  const dayLong = (iso) => { const [y, m, d] = String(iso || "").split("-").map(Number); return y ? `${MON[m - 1]} ${d}, ${y}` : ""; };
  const ms = (iso) => Date.parse(String(iso) + "T12:00:00Z");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const cap = (s) => String(s || "").replace(/^./, (c) => c.toUpperCase());
  const RANGES = [[30, "30 days"], [90, "90 days"], [365, "12 months"]];
  const VITALS = [["weight", "Body weight", "lb"], ["restingHr", "Resting heart rate", "bpm"], ["sleep", "Sleep", "hours"]];

  // A nice round top for a 0-based axis, and 3-5 ticks under it
  function ticks(max, n = 4) { const step = max / n; return Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 100) / 100); }
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString("en-US");

  // ---------- one chart card: title, optional legend, plot, tooltip, "Show as table" ----------
  function card(root, { title, sub, legend, table, draw, empty }) {
    const box = document.createElement("section");
    box.className = "pg-card";
    box.innerHTML = `<div class="pg-head"><div><h3 class="pg-title">${esc(title)}</h3>${sub ? `<p class="pg-sub">${esc(sub)}</p>` : ""}</div>${table ? `<button type="button" class="pg-tbtn" aria-pressed="false">Show as table</button>` : ""}</div>
      ${legend && legend.length > 1 ? `<ul class="pg-legend">${legend.map((l) => `<li><i class="pg-key ${l.cls}"></i>${esc(l.label)}</li>`).join("")}</ul>` : ""}
      <div class="pg-plot"></div><div class="pg-table" hidden></div>`;
    root.appendChild(box);
    const plot = box.querySelector(".pg-plot"), tbl = box.querySelector(".pg-table");
    if (empty) { plot.innerHTML = `<p class="pg-empty">${esc(empty)}</p>`; const b = box.querySelector(".pg-tbtn"); if (b) b.remove(); return box; }
    const tip = document.createElement("div"); tip.className = "pg-tip"; tip.hidden = true; plot.appendChild(tip);
    const paint = () => { [...plot.querySelectorAll("svg")].forEach((s) => s.remove()); draw(plot, Math.max(260, Math.round(plot.clientWidth || 320)), tip); };
    paint();
    if (window.ResizeObserver) { let w = plot.clientWidth; new ResizeObserver(() => { if (Math.abs(plot.clientWidth - w) > 8 && !plot.hidden) { w = plot.clientWidth; paint(); } }).observe(plot); }
    if (table) {
      const [head, rows] = table();
      tbl.innerHTML = `<div class="pg-tscroll"><table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
      const b = box.querySelector(".pg-tbtn");
      b.addEventListener("click", () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "Show as chart" : "Show as table"; plot.hidden = on; tbl.hidden = !on; if (!on) paint(); });
    }
    return box;
  }
  function showTip(tip, plot, x, y, html) {
    tip.innerHTML = html; tip.hidden = false;
    const pw = plot.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(0, Math.min(pw - tw, x - tw / 2)) + "px";
    tip.style.top = Math.max(0, y - th - 10) + "px";
  }
  const hideTip = (tip) => { tip.hidden = true; };

  // ---------- vertical bars over weeks (one series) ----------
  function bars(plot, W, tip, { items, value, max, label, tipHtml, yLabel }) {
    const H = 170, L = 30, R = 6, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
    // whole-number ticks: counts are never fractional
    const peak = Math.max(1, ...items.map(value)), step = max ? 2 : Math.max(1, Math.ceil(peak / 4)), top = max || step * Math.ceil(peak / step);
    const tk = []; for (let t = 0; t <= top; t += step) tk.push(t); // (a top that is not on a step, like 7 days, gets the frame line only)
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": yLabel, class: "pg-svg" }, null);
    for (const t of tk) { const y = T + ih - (t / top) * ih; el("line", { x1: L, x2: W - R, y1: y, y2: y, class: "pg-gl" }, svg); el("text", { x: L - 6, y: y + 4, class: "pg-axis", "text-anchor": "end" }, svg).textContent = fmt(t); }
    const n = items.length, slot = iw / Math.max(n, 1), bw = Math.max(3, Math.min(28, slot - 2)); // 2px surface gap between bars
    const every = Math.ceil(n / Math.max(1, Math.floor(iw / 46)));
    items.forEach((it, i) => {
      const v = value(it), h = (v / top) * ih, x = L + i * slot + (slot - bw) / 2, y = T + ih - h, r = Math.min(4, bw / 2, h);
      if (v > 0) {
        // rounded at the data end only, square on the baseline
        el("path", { d: `M${x},${T + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${T + ih} Z`, class: "pg-bar s1" }, svg);
      }
      // a label every few weeks, plus the last one; a regular label too close to the last is dropped
      if ((i % every === 0 && (n - 1 - i) * slot >= 44) || i === n - 1) el("text", { x: x + bw / 2, y: H - 8, class: "pg-axis", "text-anchor": i === n - 1 && n > 1 ? "end" : "middle" }, svg).textContent = label(it);
      // hit target: the whole column, bigger than the bar
      const hit = el("rect", { x: L + i * slot, y: T, width: slot, height: ih, class: "pg-hit", tabindex: 0, "aria-label": tipHtml(it).replace(/<[^>]+>/g, " ") }, svg);
      const on = () => showTip(tip, plot, x + bw / 2, y, tipHtml(it));
      hit.addEventListener("mouseenter", on); hit.addEventListener("focus", on); hit.addEventListener("mouseleave", () => hideTip(tip)); hit.addEventListener("blur", () => hideTip(tip));
    });
    el("line", { x1: L, x2: W - R, y1: T + ih, y2: T + ih, class: "pg-base" }, svg);
    if (tk[tk.length - 1] !== top) el("line", { x1: L, x2: W - R, y1: T, y2: T, class: "pg-gl" }, svg);
    plot.insertBefore(svg, tip);
  }

  // ---------- lines over dates (one or more series, one shared axis) ----------
  function lines(plot, W, tip, { series, from, to, min = 0, max, unit, yLabel, labels }) {
    const H = 180, T = 12, B = 26, L = 30, R = labels ? 64 : 10, iw = W - L - R, ih = H - T - B;
    const all = series.flatMap((s) => s.points.map((p) => p.value));
    let lo = min, hi = max;
    let tk;
    if (hi === undefined) { // round steps (1, 2, 2.5, 5 × 10ⁿ) around the data, about four of them
      const a = Math.min(...all), b = Math.max(...all), raw = (b - a || Math.max(1, Math.abs(b) * 0.05)) / 4, p10 = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p10;
      const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p10;
      lo = Math.floor(a / step) * step; hi = Math.ceil(b / step) * step; if (hi === lo) hi = lo + step;
      tk = []; for (let t = lo; t <= hi + step / 2; t += step) tk.push(Math.round(t * 100) / 100);
    } else tk = max === 10 && min === 0 ? [0, 2, 4, 6, 8, 10] : ticks(hi - lo, 4).map((t) => Math.round((lo + t) * 10) / 10);
    const t0 = ms(from), t1 = Math.max(ms(to), t0 + 864e5), X = (d) => L + ((ms(d) - t0) / (t1 - t0)) * iw, Y = (v) => T + ih - ((v - lo) / (hi - lo)) * ih;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": yLabel, class: "pg-svg" }, null);
    for (const t of tk) { const y = Y(t); el("line", { x1: L, x2: L + iw, y1: y, y2: y, class: "pg-gl" }, svg); el("text", { x: L - 6, y: y + 4, class: "pg-axis", "text-anchor": "end" }, svg).textContent = fmt(t); }
    // date labels: start, middle, end
    [[from, "start"], [new Date((t0 + t1) / 2).toISOString().slice(0, 10), "middle"], [to, "end"]].forEach(([d, a]) => { el("text", { x: a === "start" ? L : a === "end" ? L + iw : X(d), y: H - 8, class: "pg-axis", "text-anchor": a }, svg).textContent = day(d); });
    const ends = [];
    series.forEach((s) => {
      const pts = s.points.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
      if (!pts.length) return;
      if (pts.length > 1) el("polyline", { points: pts.map((p) => `${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" "), class: `pg-line ${s.cls}` }, svg);
      // markers: every point when sparse (12 or fewer), otherwise only the last; a 2px surface ring keeps overlaps readable
      (pts.length <= 12 ? pts : [pts[pts.length - 1]]).forEach((p) => el("circle", { cx: X(p.date), cy: Y(p.value), r: 4, class: `pg-dot ${s.cls}` }, svg));
      const last = pts[pts.length - 1];
      ends.push({ y: Y(last.value), x: X(last.date), text: s.label });
    });
    if (labels) { // direct labels at the right edge, nudged apart so they never sit on each other
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
      ends.forEach((e) => { el("text", { x: L + iw + 8, y: Math.min(H - B, e.y + 4), class: "pg-dlabel" }, svg).textContent = e.text.length > 10 ? e.text.slice(0, 9) + "…" : e.text; });
    }
    // crosshair: nearest date that has any reading
    const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const cross = el("line", { x1: 0, x2: 0, y1: T, y2: T + ih, class: "pg-cross" }, svg); cross.style.display = "none";
    const hit = el("rect", { x: L, y: T, width: iw, height: ih, class: "pg-hit", tabindex: 0, "aria-label": yLabel }, svg);
    const at = (px) => { let best = dates[0], bd = Infinity; for (const d of dates) { const dd = Math.abs(X(d) - px); if (dd < bd) { bd = dd; best = d; } } return best; };
    const showAt = (d) => {
      const x = X(d); cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.style.display = "";
      const rows = series.map((s) => { const p = s.points.find((q) => q.date === d); return p ? `<div class="pg-trow"><i class="pg-key ${s.cls}"></i><span>${esc(s.label)}</span><b>${fmt(p.value)}${unit ? " " + esc(unit) : ""}</b></div>` : ""; }).join("");
      const ys = series.map((s) => s.points.find((q) => q.date === d)).filter(Boolean).map((p) => Y(p.value));
      showTip(tip, plot, x, Math.min(...ys), `<div class="pg-tdate">${dayLong(d)}</div>${rows}`);
    };
    let k = dates.length - 1;
    hit.addEventListener("mousemove", (e) => { const r = svg.getBoundingClientRect(); showAt(at(((e.clientX - r.left) / r.width) * W)); });
    hit.addEventListener("mouseleave", () => { cross.style.display = "none"; hideTip(tip); });
    hit.addEventListener("focus", () => { k = dates.length - 1; showAt(dates[k]); });
    hit.addEventListener("blur", () => { cross.style.display = "none"; hideTip(tip); });
    hit.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); k = Math.max(0, Math.min(dates.length - 1, k + (e.key === "ArrowLeft" ? -1 : 1))); showAt(dates[k]); } });
    plot.insertBefore(svg, tip);
  }

  // ---------- the whole overview ----------
  function render(root, d, opts) {
    root.innerHTML = "";
    const h = d.headline || {}, weeks = d.weeks || [], areas = ((d.pain && d.pain.areas) || []).filter((a) => a.points && a.points.length), progs = d.programs || [], vit = d.vitals || {};
    const nothing = !weeks.some((w) => w.workouts || w.activeDays) && !areas.length && !progs.length && !VITALS.some(([k]) => (vit[k] || []).length);
    // headline tiles
    const pc = h.painChange;
    const painText = !pc ? ["—", "Log two pain check-ins to see a change"] : pc.delta < 0 ? [`↓ ${Math.abs(pc.delta)}`, `points less pain in your ${pc.area}`] : pc.delta > 0 ? [`↑ ${pc.delta}`, `points more pain in your ${pc.area}`] : ["Same", `pain level in your ${pc.area}`];
    const tiles = document.createElement("div"); tiles.className = "pg-tiles";
    const who = opts.admin ? "" : "your ";
    tiles.innerHTML = [
      [h.workoutsThisMonth || 0, "workouts this month"],
      [h.activeDays30 || 0, "active days, last 30"],
      [h.streak || 0, h.streak === 1 ? "day streak" : "day streak"],
      [painText[0], opts.admin ? painText[1].replace("your ", "") : painText[1].replace("your ", who)]
    ].map(([v, l], i) => `<div class="pg-tile${i === 3 && pc && pc.delta < 0 ? " good" : ""}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
    root.appendChild(tiles);
    if (nothing) {
      const p = document.createElement("p"); p.className = "pg-empty big";
      p.textContent = opts.admin ? "Nothing logged yet. Workouts, pain check-ins and body measures will show here as they are logged." : "Log a workout or a pain check-in to see your progress here.";
      root.appendChild(p); return;
    }
    const grid = document.createElement("div"); grid.className = "pg-grid"; root.appendChild(grid);
    const wkLabel = (w) => day(w.week);
    // workouts per week
    card(grid, {
      title: "Workouts per week", sub: `Week starting ${day(weeks[0] && weeks[0].week)} to now`,
      empty: weeks.some((w) => w.workouts) ? "" : "No workouts logged in this period yet.",
      draw: (plot, W, tip) => bars(plot, W, tip, { items: weeks, value: (w) => w.workouts, label: wkLabel, yLabel: "Workouts per week",
        tipHtml: (w) => `<div class="pg-tdate">Week of ${dayLong(w.week)}</div><div class="pg-trow"><span>Workouts</span><b>${w.workouts}</b></div><div class="pg-trow"><span>Minutes</span><b>${fmt(w.minutes || 0)}</b></div>` }),
      table: () => [["Week of", "Workouts", "Minutes"], weeks.map((w) => [dayLong(w.week), String(w.workouts), fmt(w.minutes || 0)])]
    });
    // active days per week
    card(grid, {
      title: "Active days per week", sub: "Days with a workout, a check-in or a daily habit, out of 7",
      empty: weeks.some((w) => w.activeDays) ? "" : "No active days in this period yet.",
      draw: (plot, W, tip) => bars(plot, W, tip, { items: weeks, value: (w) => w.activeDays, max: 7, label: wkLabel, yLabel: "Active days per week",
        tipHtml: (w) => `<div class="pg-tdate">Week of ${dayLong(w.week)}</div><div class="pg-trow"><span>Active days</span><b>${w.activeDays} of 7</b></div>` }),
      table: () => [["Week of", "Active days"], weeks.map((w) => [dayLong(w.week), `${w.activeDays} of 7`])]
    });
    // pain over time: up to four areas get a line (most check-ins first); colour follows the area by name
    if (areas.length) {
      const shown = areas.slice().sort((a, b) => b.points.length - a.points.length).slice(0, 4).sort((a, b) => (a.area < b.area ? -1 : 1));
      const series = shown.map((a, i) => ({ label: cap(a.area), cls: "s" + (i + 1), points: a.points.map((p) => ({ date: p.date, value: Number(p.level) || 0 })) }));
      const rest = areas.length - shown.length;
      card(grid, {
        title: "Pain over time", sub: `0 to 10, lower is better${rest ? ` · ${plural(rest, "more area")} in the table` : ""}`,
        legend: series.map((s) => ({ label: s.label, cls: s.cls })),
        draw: (plot, W, tip) => lines(plot, W, tip, { series, from: d.range.from, to: d.range.to, min: 0, max: 10, yLabel: "Pain level over time, 0 to 10", labels: series.length > 1 }),
        table: () => [["Date", "Area", "Pain (0–10)"], areas.flatMap((a) => a.points.map((p) => [p.date, cap(a.area), String(p.level)])).sort((x, y) => (x[0] < y[0] ? 1 : -1)).map((r) => [dayLong(r[0]), r[1], r[2]])]
      });
    }
    // programs
    if (progs.length) {
      const c = card(grid, { title: "Program progress", sub: "Recommended by Dr. Jared, and programs saved to Home", draw: () => {}, table: null });
      const plot = c.querySelector(".pg-plot");
      plot.innerHTML = `<ul class="pg-progs">${progs.map((p) => `<li><div class="pg-prow"><span class="pg-ptitle">${esc(p.title)}</span><span class="pg-tag ${p.label === "Recommended" ? "rec" : ""}">${esc(p.label)}</span></div>
        <div class="pg-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct || 0)}" aria-label="${esc(p.title)}: ${Math.round(p.pct || 0)}% done"><i style="width:${Math.max(0, Math.min(100, p.pct || 0))}%"></i></div>
        <span class="pg-pnum">${p.total ? `${p.done} of ${plural(p.total, "session")}` : "Not started"} · ${Math.round(p.pct || 0)}%</span></li>`).join("")}</ul>`;
    }
    // body measures: one small chart each, never two measures on one axis
    VITALS.forEach(([k, title, unit]) => {
      const pts = (vit[k] || []).filter((p) => p && p.date && Number.isFinite(Number(p.value)));
      if (!pts.length) return;
      const series = [{ label: title, cls: "s1", points: pts.map((p) => ({ date: p.date, value: Number(p.value) })) }];
      const first = series[0].points[0].value, last = series[0].points[series[0].points.length - 1].value;
      card(grid, {
        title, sub: pts.length > 1 ? `${fmt(first)} → ${fmt(last)} ${unit}` : `${fmt(last)} ${unit}`,
        draw: (plot, W, tip) => lines(plot, W, tip, { series, from: d.range.from, to: d.range.to, unit, yLabel: `${title} over time, ${unit}` }),
        table: () => [["Date", `${title} (${unit})`], pts.slice().reverse().map((p) => [dayLong(p.date), fmt(Number(p.value))])]
      });
    });
  }

  function mount(root, opts) {
    opts = opts || {};
    root.classList.add("pg-root");
    let days = opts.days || 90, member = true;
    root.innerHTML = `<div class="pg-range" role="group" aria-label="Time range">${RANGES.map(([n, l]) => `<button type="button" class="pg-chip" data-days="${n}" aria-pressed="${n === days}">${l}</button>`).join("")}</div>
      <p class="pg-upsell" hidden>${opts.admin ? "" : `You're seeing your last 30 days. <a href="${esc(opts.upgradeHref || "#premium")}">See your whole journey with Membership</a>`}</p>
      <div class="pg-body"><p class="pg-empty">Loading your progress…</p></div>`;
    const body = root.querySelector(".pg-body"), up = root.querySelector(".pg-upsell");
    const chips = () => root.querySelectorAll(".pg-chip").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days)));
    async function go(n) {
      days = n; chips();
      try {
        const d = await opts.load(n);
        if (!d || !d.range) throw new Error("empty");
        member = !!d.range.member || !!opts.admin;
        if (!opts.admin) { up.hidden = !d.range.capped; if (d.range.capped) { days = d.range.days; chips(); } }
        render(body, d, opts);
      } catch (e) { body.innerHTML = `<p class="pg-empty">${opts.admin ? "Couldn't load progress right now." : "Couldn't load your progress right now. Pull down to try again."}</p>`; }
    }
    root.querySelector(".pg-range").addEventListener("click", (e) => {
      const b = e.target.closest(".pg-chip"); if (!b) return;
      const n = Number(b.dataset.days);
      if (!opts.admin && !member && n > 30) { up.hidden = false; up.classList.remove("pulse"); void up.offsetWidth; up.classList.add("pulse"); return; }
      go(n);
    });
    go(days);
    return { reload: () => go(days) };
  }

  window.MDFitProgress = { mount, render };
})();
