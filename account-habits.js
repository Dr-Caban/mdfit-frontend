// MD Fit member app: healthy habits and daily points (Home "Today's points" card + Progress month calendar).
// Talks to /api/me/habits/*. The server decides everything (goal, points, caps, streak, repairs); this file only
// draws what it returns, so a refresh or a second device always shows the same numbers.
(() => {
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const { $, esc, apiAuth, fmtDate } = M;
  const LEVELS = [["beginner", "Beginner"], ["advanced", "Advanced"], ["elite", "Elite"]];
  let data = null, busy = new Set(), month = null, monthData = null;

  function toast(msg) {
    const t = $("#toast"); if (!t) return;
    t.textContent = msg; t.hidden = false; t.classList.remove("celebrate");
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }

  // ---------- Home card ----------
  const home = $("#view-home .col-main");
  const card = document.createElement("section");
  card.className = "card hb-card"; card.id = "habits-card"; card.setAttribute("aria-labelledby", "hb-title");
  card.innerHTML = `<div class="hb-head"><h2 class="label accent" id="hb-title">Today's points</h2>
    <label class="hb-level">Level <select id="hb-level" aria-label="Your current level">${LEVELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label></div>
    <div class="hb-body"><p class="muted">Loading…</p></div>`;
  if (home) home.prepend(card);

  // Progress ring: SVG circle with a dash offset (no layout cost, crisp on retina)
  const ring = (pts, goal) => {
    const r = 42, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, goal ? pts / goal : 0));
    return `<svg class="hb-ring${pct >= 1 ? " done" : ""}" viewBox="0 0 100 100" role="img" aria-label="${pts} of ${goal} points">
      <circle cx="50" cy="50" r="${r}" class="hb-ring-bg"/><circle cx="50" cy="50" r="${r}" class="hb-ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}"/>
      <text x="50" y="49" text-anchor="middle" class="hb-ring-n">${pts}</text><text x="50" y="66" text-anchor="middle" class="hb-ring-of">of ${goal}</text></svg>`;
  };

  function render() {
    const d = data; if (!d) return;
    $("#hb-level").value = d.chosenLevel || d.level;
    const done = d.qualifying;
    const status = done ? `<b class="hb-ok">Goal reached. Today counts${d.recoveryOnly ? " (recovery day)" : ""}.</b>` : `<b>${d.remaining} to go</b>`;
    const s = d.streak, rep = d.repairs;
    const streakTxt = `<span class="hb-streak" title="Days in a row you reached your goal">🔥 ${s.current ? `${s.current}-day streak` : "Start a streak today"}</span>` +
      (rep.available ? `<span class="hb-rep" title="A repair covers one missed day in your streak. Earn one every 3 days in a row.">🛠 ${rep.available} repair${rep.available === 1 ? "" : "s"}</span>` : "");
    const cats = new Map(d.categories.map((c) => [c.id, c]));
    const groups = [];
    for (const h of d.habits) { let g = groups.find((x) => x.id === h.category); if (!g) groups.push(g = { id: h.category, label: h.categoryLabel, items: [] }); g.items.push(h); }
    $(".hb-body", card).innerHTML = `
      <div class="hb-top">${ring(d.points, d.goal)}
        <div class="hb-sum"><p class="hb-status">${status}</p><p class="hb-goal">Goal ${d.goal} · ${d.points} earned</p>${streakTxt ? `<p class="hb-meta">${streakTxt}</p>` : ""}
          ${d.reentry || d.reason ? `<p class="hb-reason">${esc(d.reason)}</p>` : ""}</div></div>
      <div class="hb-list">${groups.map((g) => {
        const c = cats.get(g.id) || {};
        return `<div class="hb-group"><p class="hb-cat">${esc(g.label)}${c.cap !== undefined ? ` <small>${c.earned}/${c.cap} max</small>` : ""}</p>${g.items.map(item).join("")}</div>`;
      }).join("")}</div>
      <p class="hb-foot muted">Workouts and rehab sessions you finish in the app count by themselves. Optional habits are never needed to reach your goal.</p>`;
  }
  function item(h) {
    const fromLog = h.source === "workout log";
    const sub = fromLog ? "Counted from your session today" : h.optional ? `Optional. Safer option: ${h.alternative}` : h.how;
    return `<button type="button" class="hb-item${h.done ? " on" : ""}${h.optional ? " opt" : ""}" data-habit="${esc(h.id)}" aria-pressed="${h.done}"${fromLog || busy.has(h.id) ? " aria-disabled=\"true\"" : ""}>
      <span class="hb-box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <span class="hb-txt"><b>${esc(h.name)}${h.optional ? ` <i class="hb-tag">Optional</i>` : ""}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
      <span class="hb-pts">${h.done && h.earned < h.points ? `+${h.earned}<s>${h.points}</s>` : `+${h.points}`}</span></button>`;
  }

  async function load() {
    try { data = await apiAuth("GET", "/api/me/habits/today"); render(); }
    catch (e) { $(".hb-body", card).innerHTML = `<p class="muted">Couldn't load today's points. <button type="button" class="link-btn" id="hb-retry">Try again</button></p>`; }
  }

  card.addEventListener("click", async (e) => {
    if (e.target.id === "hb-retry") return load();
    const b = e.target.closest("[data-habit]"); if (!b || b.getAttribute("aria-disabled") === "true") return;
    const id = b.dataset.habit, on = b.getAttribute("aria-pressed") !== "true";
    busy.add(id); b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on); b.setAttribute("aria-disabled", "true");
    const before = data && data.qualifying;
    try {
      data = on ? await apiAuth("POST", "/api/me/habits/checkin", { habitId: id }) : await apiAuth("DELETE", `/api/me/habits/checkin/${encodeURIComponent(id)}`);
      if (data.checked && data.checked.note) toast(data.checked.note);
      else if (!before && data.qualifying) toast("Goal reached. Today counts toward your streak 🎉");
      monthData = null;
    } catch (err) { toast(err.message); await load().catch(() => {}); }
    finally { busy.delete(id); render(); }
  });
  $("#hb-level").addEventListener("change", async (e) => {
    try { data = await apiAuth("PUT", "/api/me/habits/level", { level: e.target.value }); render(); toast(data.note || "Level saved."); }
    catch (err) { toast(err.message); load(); }
  });

  // ---------- Progress: month calendar of qualifying days ----------
  const prog = $("#view-progress .col-main");
  const cal = document.createElement("section");
  cal.className = "card hb-cal"; cal.id = "habits-cal"; cal.setAttribute("aria-labelledby", "hbc-title");
  cal.innerHTML = `<div class="hb-head"><h2 class="label accent" id="hbc-title">Qualifying days</h2>
    <div class="hbc-nav"><button type="button" class="icon-btn" data-m="-1" aria-label="Previous month">‹</button><b id="hbc-month"></b><button type="button" class="icon-btn" data-m="1" aria-label="Next month">›</button></div></div>
    <div class="hbc-grid" id="hbc-grid"></div>
    <p class="hbc-sum" id="hbc-sum"></p>
    <p class="hbc-key muted"><i class="k q"></i>Goal reached <i class="k r"></i>Repaired <i class="k m"></i>Missed</p>`;
  if (prog) prog.prepend(cal);
  const shiftMonth = (m, n) => { const [y, mo] = m.split("-").map(Number), d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  async function loadMonth() {
    if (!month) month = (data && data.date ? data.date : M.todayInTz()).slice(0, 7);
    try { monthData = await apiAuth("GET", `/api/me/habits/history?month=${month}`); renderMonth(); }
    catch { $("#hbc-grid").innerHTML = `<p class="muted">Couldn't load your calendar.</p>`; }
  }
  function renderMonth() {
    const d = monthData; if (!d) return;
    $("#hbc-month").textContent = fmtDate(d.month + "-15", { month: "long", year: "numeric" });
    $("[data-m='1']", cal).disabled = d.month >= d.today.slice(0, 7);
    const lead = (new Date(d.month + "-01T12:00:00Z").getUTCDay() + 6) % 7; // Monday first
    const cells = ["M", "T", "W", "T", "F", "S", "S"].map((x) => `<span class="hbc-dow" aria-hidden="true">${x}</span>`);
    for (let i = 0; i < lead; i++) cells.push(`<span></span>`);
    for (const day of d.days) {
      const n = Number(day.date.slice(8));
      const cls = day.future ? "fut" : day.qualifying ? "q" : day.repaired ? "r" : day.missed ? "m" : "";
      const what = day.future ? "" : day.qualifying ? `goal reached, ${day.points} points` : day.repaired ? "missed, repaired in your streak" : day.missed ? `missed, ${day.points} points` : day.today ? `today, ${day.points} points so far` : "";
      cells.push(`<span class="hbc-d ${cls}${day.today ? " today" : ""}" title="${esc(what)}" aria-label="${esc(fmtDate(day.date, { month: "long", day: "numeric" }))}${what ? ": " + esc(what) : ""}">${n}</span>`);
    }
    $("#hbc-grid").innerHTML = cells.join("");
    $("#hbc-sum").innerHTML = `<b>${d.qualifyingDays}</b> qualifying day${d.qualifyingDays === 1 ? "" : "s"} this month · best streak ${d.streak.best} · ${d.streak.lifetimeQualifying} all time`;
  }
  cal.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b || b.disabled) return; month = shiftMonth(month, Number(b.dataset.m)); loadMonth(); });

  // Refresh when Home or Progress is shown and when the app comes back to the front (a workout may have been logged,
  // or the day may have rolled over).
  // account.js switches tabs with pushState (no hashchange), so watch the views' hidden attribute instead.
  const visible = (sel) => { const v = $(sel); return !!v && !v.hidden; };
  const refresh = () => { if (visible("#view-home")) load(); if (visible("#view-progress")) { monthData = null; loadMonth(); } };
  const mo = new MutationObserver((list) => { for (const m of list) if (!m.target.hidden) { if (m.target.id === "view-home") load(); else { monthData = null; loadMonth(); } } });
  ["#view-home", "#view-progress"].forEach((sel) => { const v = $(sel); if (v) mo.observe(v, { attributes: true, attributeFilter: ["hidden"] }); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  load().then(() => { if (visible("#view-progress")) loadMonth(); });
  window.MDFitHabits = { reload: refresh };
})();
