// MD Fit member app: XP add-ons (owner's Nov 2026 rewards upgrade).
//   - Home gem card: gem, lifetime XP, "#N overall" (links to the overall leaderboard), progress to the next gem,
//     today's XP, and links to the daily activities and the workout builder. Profile shows the gem and rank too.
//   - Workout builder ("My workouts"): pick exercises from the library (search, region, category), sets with reps or
//     time, order, name, save on the account, start in the workout player (logged as "custom-<id>": 35 XP).
//   - Challenges: send a saved workout to a member from the ranking pool (+5 XP once a day); challenges sent to you
//     show on Home and play in the player (logged as "challenge-<id>": 30 + 10 XP).
// Uses window.MDFitApp (account.js) for the player, navigation, toasts and the rewards reload. The server decides all XP.
(() => {
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const A = window.MDFitApp; if (!A) return;
  const { $, $$, esc, apiAuth } = M;
  const EX = window.MDFIT_EXERCISES || [];
  const byId = A.byId || new Map(EX.map((e) => [e.id, e]));
  const gem = (color, size) => A.gemIcon(color, size);
  let reward = A.rewards(), mine = [], ch = { open: [], done: [], sent: [] };

  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const rx = (x) => (x.seconds ? `${x.sets} × ${x.seconds} sec` : `${x.sets} × ${x.reps} reps`);
  // About 3 s a rep or the set time, plus 30 s between sets
  const minutesOf = (w) => Math.max(1, Math.round(w.exercises.reduce((n, x) => n + x.sets * ((x.seconds || (x.reps || 10) * 3) + 30), 0) / 60));
  // A saved workout (or a challenge's copy) as the player expects it
  function playerWorkout(w, key) {
    const list = w.exercises.map((x) => { const e = byId.get(x.id); return e ? { ...e, sets: rx(x), block: "Circuit" } : null; }).filter(Boolean);
    return { title: w.name, goal: "My workout", goalId: "custom", location: "any", level: "", levelLabel: "My workout", rounds: 1, restEx: 0, restRound: 0,
      minutes: minutesOf(w), warmup: [], cooldown: [], circuit: list, exercises: list, perRound: list.length, key, noRest: true };
  }

  // ================= Gem card (Home) + gem and rank on Profile =================
  const home = $("#view-home .col-main");
  const gemCard = document.createElement("section");
  gemCard.className = "card gem-card"; gemCard.id = "gem-card"; gemCard.setAttribute("aria-label", "Your gem and XP");
  gemCard.innerHTML = `<p class="muted">Loading your XP…</p>`;
  if (home) { const anchor = $(".streak", home); anchor ? home.insertBefore(gemCard, anchor) : home.prepend(gemCard); }

  const prof = $("#view-profile .profile-head");
  const profGem = document.createElement("div");
  profGem.className = "prof-gem"; profGem.id = "prof-gem";
  if (prof) prof.appendChild(profGem);

  const rankText = (o) => (o ? `#${o.rank}` : "—");
  // Today at a glance: XP today, the streak (days in a row at the daily goal) and the goal itself, in one row.
  // The streak/goal come from the daily activities module (mdfit:habits); before it answers, XP today shows alone.
  let hab = null;
  document.addEventListener("mdfit:habits", (e) => { hab = e.detail; renderGem(); });
  function todayRow(r) {
    const h = hab, goal = h ? h.goal : 0, total = h ? h.total : r.todayXp, pct = goal ? Math.min(100, Math.round((total / goal) * 100)) : 0;
    return `<div class="gc-today" aria-label="Today">
        <div><b>${r.todayXp}</b><span>XP today</span></div>
        <div><b>${h ? `🔥 ${h.streak.current}` : "—"}</b><span>day streak</span></div>
        <div><b>${h ? `${Math.min(total, goal)}/${goal}` : "—"}</b><span>${h && h.qualifying ? "goal met ✓" : "daily goal"}</span></div>
      </div>
      ${h ? `<div class="gc-goal" role="progressbar" aria-label="Today's goal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>` : ""}`;
  }
  function renderGem() {
    const r = reward; if (!r || !r.rank) return;
    const cur = r.rank.current, next = r.rank.next, o = r.overall, tp = r.todayParts || { workouts: 0, activities: 0, other: 0 };
    const pct = Math.round((r.rank.progress || 0) * 100);
    gemCard.style.setProperty("--gem", cur.color);
    gemCard.innerHTML = `
      <div class="gc-top">
        <span class="gc-gem">${gem(cur.color, 58)}</span>
        <div class="gc-id"><span class="gc-kicker">Your gem · level ${r.level} of ${r.gems.length}</span><b class="gc-name">${esc(cur.name)}</b><span class="gc-xp"><b>${r.xp.toLocaleString()}</b> XP total</span></div>
        <button type="button" class="gc-rank" data-overall aria-label="${o ? `You're number ${o.rank} overall. Open the leaderboard` : "Open the leaderboard"}"><b>${rankText(o)}</b><small>overall</small></button>
      </div>
      <div class="gc-bar" role="progressbar" aria-label="Progress to ${next ? esc(next.name) : "the top gem"}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <p class="gc-next">${next ? `<b>${r.rank.xpToNext.toLocaleString()} XP</b> to ${gem(next.color, 14)} ${esc(next.name)}` : `<b>Top gem reached.</b> Platinum is forever.`}</p>
      ${todayRow(r)}
      <ol class="gc-ladder" aria-label="Gem levels">${r.gems.map((g) => `<li class="${g.id === cur.id ? "cur" : r.xp >= g.xp ? "done" : ""}" title="${esc(g.name)}: ${g.xp.toLocaleString()}+ XP">${gem(r.xp >= g.xp ? g.color : "#3a4a62", 18)}<small>${esc(g.name)}</small></li>`).join("")}</ol>
      <div class="gc-actions"><button type="button" class="btn-gold sm" data-activities>Daily activities: extra XP</button><button type="button" class="btn-outline-light sm" data-build-workout>Build a workout</button></div>
      ${o && o.hidden ? `<p class="gc-hidden">You're hidden from the leaderboard; only you see your rank.</p>` : ""}`;
    profGem.innerHTML = `<span class="pg-gem">${gem(cur.color, 30)}</span><div><b>${esc(cur.name)}</b><small>${r.xp.toLocaleString()} XP</small></div>
      <button type="button" class="pg-rank" data-overall><b>${rankText(o)}</b> overall</button>`;
  }
  document.addEventListener("mdfit:rewards", (e) => { reward = e.detail; renderGem(); });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-overall]")) { A.showBoard("all", "all"); return; }
    if (e.target.closest("[data-activities]")) {
      const c = $("#habits-card"); if (!c) return;
      if ($("#view-home").hidden) A.go("home");
      document.dispatchEvent(new CustomEvent("mdfit:habits-open"));
      setTimeout(() => c.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }
    if (e.target.closest("[data-build-workout]")) openBuilder();
  });
  renderGem();

  // ================= My workouts (Home + Workout tab) =================
  function myCard(id, where) {
    const c = document.createElement("section");
    c.className = "card my-workouts"; c.id = id;
    c.innerHTML = `<div class="card-head"><span class="label accent">My workouts</span><button type="button" class="btn-blue sm" data-build-workout><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg> Build a workout</button></div><div class="mw-body"></div>`;
    where(c);
    return c;
  }
  const homeMy = home ? myCard("home-my-workouts", (c) => { const t = $("#today-card", home); t ? t.after(c) : home.appendChild(c); }) : null;
  const gen = $("#view-generate");
  const genMy = gen ? myCard("gen-my-workouts", (c) => { const anchor = $("#my-programs", gen) || $(".gen-layout", gen); anchor ? anchor.before(c) : gen.appendChild(c); }) : null;

  function renderMine() {
    const sentBy = new Map(); for (const s of ch.sent) if (!sentBy.has(s.workout.name)) sentBy.set(s.workout.name, s);
    const rows = mine.map((w) => `<li class="mw-item" data-mw="${esc(w.id)}">
        <div class="mw-txt"><b>${esc(w.name)}</b><span>${plural(w.exercises.length, "exercise")} · about ${minutesOf(w)} min · <em>+35 XP</em></span></div>
        <div class="mw-acts"><button type="button" class="btn-blue sm" data-mw-start>Start</button><button type="button" class="btn-ghost sm" data-mw-send>Send as challenge</button>
          <button type="button" class="link-sm" data-mw-edit>Edit</button><button type="button" class="link-sm mw-del" data-mw-del>Delete</button></div></li>`).join("");
    const intro = `<p class="muted small mw-intro">Pick exercises from Dr. Jared's library, set your sets and reps, and save it. Doing your own workout is worth <b>35 XP</b> (30 + 5), and you can send it to another member as a challenge.</p>`;
    const sent = ch.sent.slice(0, 4).map((s) => `<li>${esc(s.workout.name)} → ${esc(s.to)} <span class="${s.status === "done" ? "mw-ok" : "muted"}">${s.status === "done" ? "done ✓" : "waiting"}</span></li>`).join("");
    for (const card of [homeMy, genMy]) {
      if (!card) continue;
      $(".mw-body", card).innerHTML = (mine.length ? `<ul class="mw-list">${rows}</ul>` : intro) + (sent ? `<p class="label mw-sent-h">Challenges you sent</p><ul class="mw-sent small">${sent}</ul>` : "");
    }
  }
  async function loadMine() {
    try { mine = (await apiAuth("GET", "/api/me/custom-workouts")).workouts || []; } catch {}
    renderMine();
  }
  document.addEventListener("click", async (e) => {
    const li = e.target.closest("[data-mw]"); if (!li) return;
    const w = mine.find((x) => x.id === li.dataset.mw); if (!w) return;
    if (e.target.closest("[data-mw-start]")) A.startPlayer(playerWorkout(w, "custom-" + w.id));
    else if (e.target.closest("[data-mw-edit]")) openBuilder(w);
    else if (e.target.closest("[data-mw-send]")) openSend(w);
    else if (e.target.closest("[data-mw-del]")) {
      if (!confirm(`Delete "${w.name}"?`)) return;
      try { mine = (await apiAuth("DELETE", `/api/me/custom-workouts/${encodeURIComponent(w.id)}`)).workouts; renderMine(); A.toast("Deleted."); } catch (err) { A.toast(err.message); }
    }
  });

  // ================= Builder =================
  const CLOSE = `<button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>`;
  const dlg = document.createElement("dialog");
  dlg.className = "sheet sheet-wide bw-sheet"; dlg.id = "builder"; dlg.setAttribute("aria-label", "Build a workout");
  const regions = [...new Set(EX.map((e) => e.region).filter(Boolean))].sort();
  const cats = [...new Set(EX.map((e) => e.cat).filter(Boolean))].sort();
  dlg.innerHTML = `<div class="sheet-head"><b id="bw-title">Build a workout</b>${CLOSE}</div>
    <label class="bw-name">Workout name<input id="bw-name" maxlength="60" placeholder="e.g. Monday legs" autocomplete="off"></label>
    <div class="bw-grid">
      <section class="bw-pick" aria-label="Exercise library">
        <p class="label">1. Add exercises</p>
        <input type="search" id="bw-q" placeholder="Search ${EX.length} exercises" aria-label="Search exercises" autocomplete="off">
        <div class="bw-filters"><select id="bw-region" aria-label="Body region"><option value="">All regions</option>${regions.map((r) => `<option>${esc(r)}</option>`).join("")}</select>
          <select id="bw-cat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
        <ul class="bw-results" id="bw-results"></ul>
      </section>
      <section class="bw-mine" aria-label="Your workout">
        <p class="label">2. Your workout <span id="bw-count"></span></p>
        <ol class="bw-list" id="bw-list"></ol>
        <p class="muted small" id="bw-est"></p>
      </section>
    </div>
    <p class="form-msg err" id="bw-msg" role="status"></p>
    <div class="bw-foot"><button type="button" class="btn-ghost" id="bw-save">Save</button><button type="button" class="btn-blue" id="bw-save-start"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg> Save &amp; start</button></div>`;
  document.body.appendChild(dlg);
  $("[data-close]", dlg).addEventListener("click", () => dlg.close());
  const B = { id: null, items: [] };

  function renderResults() {
    const q = $("#bw-q").value.trim().toLowerCase(), rg = $("#bw-region").value, ct = $("#bw-cat").value;
    const inList = new Set(B.items.map((x) => x.id));
    const hits = EX.filter((e) => (!rg || e.region === rg) && (!ct || e.cat === ct) && (!q || `${e.name} ${e.region} ${e.cat}`.toLowerCase().includes(q))).slice(0, 60);
    $("#bw-results").innerHTML = hits.length ? hits.map((e) => `<li><div><b>${esc(e.name)}</b><small>${esc(A.exMeta(e))}</small></div>
      <button type="button" class="bw-add${inList.has(e.id) ? " on" : ""}" data-add="${esc(e.id)}" aria-label="Add ${esc(e.name)}">${inList.has(e.id) ? "Added" : "+ Add"}</button></li>`).join("")
      : `<li class="muted small">No exercises match. Try another word or clear the filters.</li>`;
  }
  function renderList() {
    $("#bw-count").textContent = B.items.length ? `(${B.items.length})` : "";
    $("#bw-list").innerHTML = B.items.length ? B.items.map((x, i) => { const e = byId.get(x.id) || { name: "Exercise" }; return `<li data-i="${i}">
      <div class="bw-row1"><b>${i + 1}. ${esc(e.name)}</b>
        <span class="bw-move"><button type="button" class="bw-ib" data-up aria-label="Move ${esc(e.name)} up"${i ? "" : " disabled"}>↑</button><button type="button" class="bw-ib" data-down aria-label="Move ${esc(e.name)} down"${i < B.items.length - 1 ? "" : " disabled"}>↓</button><button type="button" class="bw-ib" data-rm aria-label="Remove ${esc(e.name)}">×</button></span></div>
      <div class="bw-row2"><label>Sets<input type="number" inputmode="numeric" min="1" max="10" data-f="sets" value="${x.sets}"></label>
        <label>By<select data-f="mode"><option value="reps"${x.seconds ? "" : " selected"}>Reps</option><option value="time"${x.seconds ? " selected" : ""}>Time</option></select></label>
        ${x.seconds ? `<label>Seconds<input type="number" inputmode="numeric" min="5" max="600" data-f="seconds" value="${x.seconds}"></label>` : `<label>Reps<input type="number" inputmode="numeric" min="1" max="100" data-f="reps" value="${x.reps}"></label>`}</div></li>`; }).join("")
      : `<li class="bw-empty muted small">Nothing yet. Add exercises from the library${matchMedia("(min-width: 900px)").matches ? " on the left" : " above"}.</li>`;
    $("#bw-est").textContent = B.items.length ? `About ${minutesOf({ exercises: B.items })} minutes · worth 35 XP when you finish it` : "";
  }
  function openBuilder(w) {
    B.id = w ? w.id : null;
    B.items = w ? w.exercises.map((x) => ({ ...x })) : [];
    $("#bw-title").textContent = w ? "Edit workout" : "Build a workout";
    $("#bw-name").value = w ? w.name : "";
    $("#bw-q").value = ""; $("#bw-region").value = ""; $("#bw-cat").value = ""; $("#bw-msg").textContent = "";
    renderResults(); renderList();
    if (!dlg.open) dlg.showModal();
  }
  ["#bw-q", "#bw-region", "#bw-cat"].forEach((s) => $(s, dlg).addEventListener("input", renderResults));
  $("#bw-results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    if (B.items.length >= 30) { $("#bw-msg").textContent = "Up to 30 exercises."; return; }
    const ex = byId.get(b.dataset.add);
    const timed = ex && /stretch|hold|plank|breath|release/i.test(ex.name + " " + (ex.cat || ""));
    B.items.push(timed ? { id: b.dataset.add, sets: 2, seconds: 30 } : { id: b.dataset.add, sets: 3, reps: 10 });
    renderList(); renderResults();
  });
  $("#bw-list").addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]"); if (!li) return; const i = Number(li.dataset.i);
    if (e.target.closest("[data-up]") && i > 0) [B.items[i - 1], B.items[i]] = [B.items[i], B.items[i - 1]];
    else if (e.target.closest("[data-down]") && i < B.items.length - 1) [B.items[i + 1], B.items[i]] = [B.items[i], B.items[i + 1]];
    else if (e.target.closest("[data-rm]")) B.items.splice(i, 1);
    else return;
    renderList(); renderResults();
  });
  $("#bw-list").addEventListener("change", (e) => {
    const li = e.target.closest("[data-i]"), f = e.target.dataset.f; if (!li || !f) return;
    const x = B.items[Number(li.dataset.i)], n = Math.round(Number(e.target.value));
    const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    if (f === "mode") { if (e.target.value === "time") { delete x.reps; x.seconds = 30; } else { delete x.seconds; x.reps = 10; } renderList(); return; }
    if (f === "sets") x.sets = clamp(n, 1, 10, 3);
    if (f === "reps") x.reps = clamp(n, 1, 100, 10);
    if (f === "seconds") x.seconds = clamp(n, 5, 600, 30);
    e.target.value = x[f];
    $("#bw-est").textContent = `About ${minutesOf({ exercises: B.items })} minutes · worth 35 XP when you finish it`;
  });
  async function save(start) {
    const name = $("#bw-name").value.trim();
    if (!name) { $("#bw-msg").textContent = "Give your workout a name."; $("#bw-name").focus(); return; }
    if (!B.items.length) { $("#bw-msg").textContent = "Add at least one exercise."; return; }
    const btns = [$("#bw-save"), $("#bw-save-start")]; btns.forEach((b) => (b.disabled = true));
    try {
      const body = { name, exercises: B.items };
      const r = B.id ? await apiAuth("PUT", `/api/me/custom-workouts/${encodeURIComponent(B.id)}`, body) : await apiAuth("POST", "/api/me/custom-workouts", body);
      mine = r.workouts; renderMine(); dlg.close();
      if (start) A.startPlayer(playerWorkout(r.saved, "custom-" + r.saved.id));
      else A.toast(`Saved to My workouts. Finish it for 35 XP.`);
    } catch (err) { $("#bw-msg").textContent = err.message; }
    finally { btns.forEach((b) => (b.disabled = false)); }
  }
  $("#bw-save").addEventListener("click", () => save(false));
  $("#bw-save-start").addEventListener("click", () => save(true));

  // ================= Send as challenge =================
  const sd = document.createElement("dialog");
  sd.className = "sheet ch-sheet"; sd.id = "send-challenge"; sd.setAttribute("aria-label", "Send as a challenge");
  sd.innerHTML = `<div class="sheet-head"><b>Send as a challenge</b>${CLOSE}</div>
    <p class="small" id="sc-what"></p>
    <input type="search" id="sc-q" placeholder="Find a member" aria-label="Find a member" autocomplete="off">
    <ul class="sc-list" id="sc-list"><li class="muted small">Loading…</li></ul>
    <p class="muted small">Only members on the leaderboard can get challenges (anyone can hide in Leaderboard settings). They see your first name, last initial and the workout. Nothing else.</p>`;
  document.body.appendChild(sd);
  $("[data-close]", sd).addEventListener("click", () => sd.close());
  let members = [], sending = null;
  function renderMembers() {
    const q = $("#sc-q").value.trim().toLowerCase();
    const list = members.filter((m) => !q || m.name.toLowerCase().includes(q));
    $("#sc-list").innerHTML = list.length ? list.map((m) => `<li><span class="sc-gem">${m.gem ? gem(m.gem.color, 18) : ""}</span><b>${esc(m.name)}</b><button type="button" class="btn-blue sm" data-to="${esc(m.id)}">Send</button></li>`).join("")
      : `<li class="muted small">${members.length ? "No one matches." : "No other members on the leaderboard yet."}</li>`;
  }
  async function openSend(w) {
    sending = w;
    $("#sc-what").innerHTML = `<b>${esc(w.name)}</b> · ${plural(w.exercises.length, "exercise")}. You earn <b>+5 XP</b> for sending (once a day); they earn <b>40 XP</b> for doing it.`;
    $("#sc-q").value = ""; $("#sc-list").innerHTML = `<li class="muted small">Loading…</li>`;
    sd.showModal();
    try { members = (await apiAuth("GET", "/api/me/challenges/members")).members || []; } catch (err) { members = []; }
    renderMembers();
  }
  $("#sc-q", sd).addEventListener("input", renderMembers);
  $("#sc-list", sd).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-to]"); if (!b || !sending) return;
    b.disabled = true;
    try {
      const r = await apiAuth("POST", "/api/me/challenges", { workoutId: sending.id, toId: b.dataset.to });
      sd.close();
      A.toast(`Challenge sent to ${r.challenge.to}.${r.xpEarned ? ` +${r.xpEarned} XP` : ""}`);
      A.loadRewards(true); loadChallenges();
    } catch (err) { A.toast(err.message); b.disabled = false; }
  });

  // ================= Challenges for you (Home) =================
  const chCard = document.createElement("section");
  chCard.className = "card ch-card"; chCard.id = "challenges-card"; chCard.hidden = true;
  if (home) gemCard.after(chCard);
  function renderChallenges() {
    renderMine();
    chCard.hidden = !ch.open.length;
    if (!ch.open.length) return;
    chCard.innerHTML = `<div class="card-head"><span class="label accent">Challenges for you</span><span class="ch-xp">+40 XP each</span></div>
      <ul class="ch-list">${ch.open.map((c) => `<li data-ch="${esc(c.id)}"><span class="ch-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg></span>
        <div><b>${esc(c.from)} challenged you</b><span>${esc(c.workout.name)} · ${plural(c.workout.exercises.length, "exercise")} · about ${minutesOf(c.workout)} min</span></div>
        <button type="button" class="btn-blue sm" data-ch-start>Start</button></li>`).join("")}</ul>`;
  }
  chCard.addEventListener("click", (e) => {
    const li = e.target.closest("[data-ch]"); if (!li || !e.target.closest("[data-ch-start]")) return;
    const c = ch.open.find((x) => x.id === li.dataset.ch); if (!c) return;
    A.startPlayer(playerWorkout({ name: `${c.from}'s challenge: ${c.workout.name}`.slice(0, 80), exercises: c.workout.exercises }, "challenge-" + c.id));
  });
  async function loadChallenges() {
    try { ch = await apiAuth("GET", "/api/me/challenges"); } catch {}
    renderChallenges();
  }
  document.addEventListener("mdfit:workout", () => { loadChallenges(); if (window.MDFitHabits) window.MDFitHabits.reload(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadChallenges(); });

  loadMine(); loadChallenges();
})();
