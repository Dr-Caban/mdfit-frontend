// MD Fit member app: daily activities (Home "Daily activities" card) + the Progress month calendar of goal days.
// Talks to /api/me/habits/*. The server decides everything (XP, once a day, streak, repairs); this file only draws
// what it returns, so a refresh or a second device always shows the same numbers. Checking one off reloads the
// rewards (gem card, XP toast) through window.MDFitApp.
(() => {
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const { $, esc, apiAuth, fmtDate } = M;
  let data = null, busy = new Set(), month = null, monthData = null, showAll = false;

  function toast(msg) {
    if (window.MDFitApp) return window.MDFitApp.toast(msg);
    const t = $("#toast"); if (!t) return;
    t.textContent = msg; t.hidden = false; t.classList.remove("celebrate");
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }
  const rewardsChanged = () => { if (window.MDFitApp) window.MDFitApp.loadRewards(true); };

  // ---------- Home card ----------
  const home = $("#view-home .col-main");
  const card = document.createElement("section");
  card.className = "card hb-card"; card.id = "habits-card"; card.setAttribute("aria-labelledby", "hb-title");
  card.innerHTML = `<button type="button" class="hb-head hb-toggle" aria-expanded="false" aria-controls="hb-body"><span><b class="label accent" id="hb-title">Daily activities</b><span class="hb-sub" id="hb-sub">Extra XP · each once a day</span></span><span class="hb-chev" aria-hidden="true">▾</span></button>
    <div class="hb-body" id="hb-body" hidden><p class="muted">Loading…</p></div>`;
  let open = false;
  const setOpen = (v) => { open = v; $(".hb-toggle", card).setAttribute("aria-expanded", String(v)); $(".hb-body", card).hidden = !v; card.classList.toggle("open", v); };
  document.addEventListener("mdfit:habits-open", () => setOpen(true));
  if (home) { const after = $("#challenges-card", home) || $("#gem-card", home); after ? after.after(card) : home.prepend(card); }

  const FIRST = 8; // on a phone the list starts short; "Show all" opens the rest (done ones always show)
  function render() {
    const d = data; if (!d) return;
    const s = d.streak, rep = d.repairs, wr = d.workoutRules || {};
    const manual = d.habits.filter((h) => !h.auto), auto = d.habits.filter((h) => h.auto);
    const short = !showAll && manual.length > FIRST;
    const shown = short ? manual.filter((h, i) => i < FIRST || h.done) : manual;
    const streakTxt = `<span class="hb-streak" title="Days in a row with ${d.goal}+ XP from activities and workouts">${s.current ? `${s.current}-day streak` : "Start a streak today"}</span>` +
      (rep.available ? `<span class="hb-rep" title="A repair covers one missed day in your streak. Earn one every 3 days in a row.">${rep.available} repair${rep.available === 1 ? "" : "s"}</span>` : "");
    const doneN = manual.filter((h) => h.done).length;
    $("#hb-sub", card).textContent = `${doneN} of ${manual.length} done · +${d.points} XP today`;
    document.dispatchEvent(new CustomEvent("mdfit:habits", { detail: d }));
    $(".hb-body", card).innerHTML = `
      ${d.goalLevels ? `<div class="hb-norm" role="radiogroup" aria-label="My daily XP goal">${Object.entries(d.goalLevels).map(([k, v]) => `<button type="button" role="radio" data-goal-level="${k}" aria-checked="${d.goalLevel === k}">${k === "pro" ? "Pro / Elite" : k[0].toUpperCase() + k.slice(1)} <small>${v} XP</small></button>`).join("")}</div>` : ""}
      <div class="hb-sumrow"><p class="hb-today"><b>+${d.points}</b> XP from activities today</p><p class="hb-meta">${d.qualifying ? `<b class="hb-ok">Goal met (${d.goal} XP).</b>` : `${d.remaining} XP to today's goal of ${d.goal}`} · ${streakTxt}</p></div>
      <div class="hb-list">${shown.map(item).join("")}</div>
      ${short ? `<button type="button" class="link-sm hb-more" data-hb-all>Show all ${manual.length} activities</button>` : ""}
      <p class="hb-foot muted">Workouts: <b>${wr.normal || 30} XP</b> a day · <b>${wr.custom || 35}</b> when you built it yourself · <b>${wr.program || 50}</b> for a Dr. Jared program or pain track · challenges: <b>+${wr.challengeSent || 5}</b> for sending, <b>+${wr.challengeBonus || 10}</b> for doing one. <button type="button" class="link-sm" data-build-workout>Build a workout</button></p>`;
  }
  function item(h) {
    const sub = h.how;
    return `<button type="button" class="hb-item${h.done ? " on" : ""}${h.auto ? " auto" : ""}" data-habit="${esc(h.id)}" aria-pressed="${h.done}"${h.auto || busy.has(h.id) ? " aria-disabled=\"true\"" : ""}>
      <span class="hb-box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <span class="hb-txt"><b>${esc(h.name)}${h.auto ? ` <i class="hb-tag">Auto</i>` : ""}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
      <span class="hb-pts">+${h.points}</span></button>`;
  }

  async function load() {
    try { data = await apiAuth("GET", "/api/me/habits/today"); render(); }
    catch (e) { $(".hb-body", card).innerHTML = `<p class="muted">Couldn't load today's activities. <button type="button" class="link-sm" id="hb-retry">Try again</button></p>`; }
  }

  card.addEventListener("click", async (e) => {
    if (e.target.closest(".hb-toggle")) { setOpen(!open); return; }
    if (e.target.id === "hb-retry") return load();
    if (e.target.closest("[data-hb-all]")) { showAll = true; render(); return; }
    // Daily XP norm: Beginner 50 / Intermediate 75 / Pro 100 (applies from today)
    const gl = e.target.closest("[data-goal-level]");
    if (gl) {
      if (gl.getAttribute("aria-checked") === "true") return;
      try { data = await apiAuth("PUT", "/api/me/habits/goal", { level: gl.dataset.goalLevel }); render(); toast(`Daily goal: ${data.goal} XP.`); } catch (err) { toast(err.message); }
      return;
    }
    const b = e.target.closest("[data-habit]"); if (!b || b.getAttribute("aria-disabled") === "true") return;
    const id = b.dataset.habit, on = b.getAttribute("aria-pressed") !== "true";
    busy.add(id); b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on); b.setAttribute("aria-disabled", "true");
    const before = data && data.qualifying;
    try {
      data = on ? await apiAuth("POST", "/api/me/habits/checkin", { habitId: id }) : await apiAuth("DELETE", `/api/me/habits/checkin/${encodeURIComponent(id)}`);
      if (!before && data.qualifying) toast("Daily goal met. Today counts toward your streak.");
      monthCache.clear();
      rewardsChanged();
    } catch (err) { toast(err.message); await load().catch(() => {}); }
    finally { busy.delete(id); render(); }
  });

  // ---------- Progress: goal days painted onto the one Calendar (owner: one calendar, not two) ----------
  // Gold = daily goal reached, dashed gold = missed but repaired in the streak, pale = missed. The summary line and key
  // sit under the calendar; the calendar's own arrows change the month.
  const mainCal = $("#cal"), calCard = mainCal && mainCal.closest(".card");
  let sum = null;
  if (calCard) {
    sum = document.createElement("div"); sum.className = "hbc-under";
    sum.innerHTML = `<p class="hbc-sum" id="hbc-sum"></p><p class="hbc-key muted"><i class="k q"></i>Goal reached <i class="k r"></i>Repaired <i class="k m"></i>Missed</p>`;
    mainCal.after(sum);
  }
  const monthCache = new Map();
  async function loadMonth(m) {
    month = m || month || M.todayInTz().slice(0, 7);
    if (!mainCal) return;
    try {
      if (!monthCache.has(month)) monthCache.set(month, await apiAuth("GET", `/api/me/habits/history?month=${month}`));
      monthData = monthCache.get(month); paint();
    } catch { if (sum) $("#hbc-sum").textContent = ""; }
  }
  function paint() {
    const d = monthData; if (!d || !mainCal) return;
    for (const day of d.days) {
      const el = mainCal.querySelector(`[data-day="${day.date}"]`); if (!el) continue;
      el.classList.remove("goal-q", "goal-r", "goal-m");
      const cls = day.future ? "" : day.qualifying ? "goal-q" : day.repaired ? "goal-r" : day.missed ? "goal-m" : "";
      if (cls) el.classList.add(cls);
      const what = day.future ? "" : day.qualifying ? `daily goal reached, ${day.points} XP` : day.repaired ? "missed, repaired in your streak" : day.missed ? `goal missed, ${day.points} XP` : day.today ? `today, ${day.points} XP so far` : "";
      if (what) el.title = what;
    }
    $("#hbc-sum").innerHTML = `<b>${d.qualifyingDays}</b> goal day${d.qualifyingDays === 1 ? "" : "s"} this month · best streak ${d.streak.best} · ${d.streak.lifetimeQualifying} all time`;
  }
  document.addEventListener("mdfit:calendar", (e) => loadMonth(e.detail.month));

  // Refresh when Home or Progress is shown and when the app comes back to the front (a workout may have been logged,
  // or the day may have rolled over).
  // account.js switches tabs with pushState (no hashchange), so watch the views' hidden attribute instead.
  const visible = (sel) => { const v = $(sel); return !!v && !v.hidden; };
  const refresh = () => { if (visible("#view-home")) load(); if (visible("#view-progress")) { monthCache.clear(); loadMonth(); } };
  const mo = new MutationObserver((list) => { for (const m of list) if (!m.target.hidden) { if (m.target.id === "view-home") load(); else { monthCache.clear(); loadMonth(); } } });
  ["#view-home", "#view-progress"].forEach((sel) => { const v = $(sel); if (v) mo.observe(v, { attributes: true, attributeFilter: ["hidden"] }); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  load().then(() => { if (visible("#view-progress")) loadMonth(); });
  window.MDFitHabits = { reload: refresh };
})();
