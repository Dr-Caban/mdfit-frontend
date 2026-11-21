// MD Fit member app: training on your own, with a trainer, or with a clinician (server: mdfit-backend lib/pros.js).
//
//   - Home: "Your trainer" / "Your clinician" card with what they assigned (Dr. Jared's programs, Pain Tool
//     protocols, workouts from the library) and how far you are; or, until you choose, "How do you want to train?".
//   - Profile: "Training with" shows the choice and changes it. With a clinician you decide, with a switch you can turn
//     off at any time, whether they see your pain check-ins. Trainers never see health information.
//   - Dr. Caban's own practice is listed first among clinicians.
// Pros apply and work from /pro. Nothing here reaches the practice's records.
(() => {
  "use strict";
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const A = window.MDFitApp; if (!A) return;
  const { $, esc, apiAuth } = M;
  const byId = A.byId instanceof Map ? A.byId : new Map((window.MDFIT_EXERCISES || []).map((e) => [e.id, e]));
  const KIND = { program: "Program", protocol: "Pain protocol", workout: "Workout" };
  const ROLE = { trainer: "trainer", clinician: "clinician" };
  const CLOSE = '<button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>';
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
  let coach = null;

  const fmt = (d) => { const x = new Date(d + "T12:00:00"); return isNaN(x) ? d : x.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const perSet = (x) => (Array.isArray(x.repsBySet) && x.repsBySet.length === x.sets ? x.repsBySet : null);
  const rx = (x) => (perSet(x) ? `${x.sets} sets: ${perSet(x).join(", ")} reps` : `${x.sets} × ${x.reps || 10} reps`);

  // ---- The Home card --------------------------------------------------------------------------------------------
  const card = document.createElement("section");
  card.className = "card coach-card"; card.id = "coach-card"; card.hidden = true;
  (function place() { const home = $("#view-home .col-main"); if (!home) return; const t = $("#today-card", home); t ? t.after(card) : home.prepend(card); })();

  function progressText(a) {
    if (!a.sessions) return "Not started yet";
    return `${a.sessions} ${a.sessions === 1 ? "session" : "sessions"}${a.last ? ` · last ${fmt(a.last)}` : ""}`;
  }
  function renderHome() {
    if (!coach) return;
    const { mode, pro } = coach;
    if (!mode) {
      card.hidden = false;
      card.innerHTML = `<div class="card-head"><span class="label accent">How do you want to train?</span></div>
        <div class="coach-modes"><button type="button" class="btn-ghost sm" data-coach-mode="independent">On my own</button>
        <button type="button" class="btn-ghost sm" data-coach-mode="trainer">With a trainer</button>
        <button type="button" class="btn-ghost sm" data-coach-mode="clinician">With a clinician</button></div>`;
      return;
    }
    if (mode === "independent") { card.hidden = true; return; }
    card.hidden = false;
    if (!pro) {
      card.innerHTML = `<div class="card-head"><span class="label accent">Your ${ROLE[mode]}</span></div>
        <p class="small">You chose to train with a ${ROLE[mode]}. Pick one and what they send you shows up here.</p>
        <button type="button" class="btn-blue sm" data-coach-pick="${mode}">Choose your ${ROLE[mode]}</button>`;
      return;
    }
    const list = coach.assignments || [];
    card.innerHTML = `<div class="card-head"><span class="label accent">Your ${ROLE[mode]}</span></div>
      <div class="coach-who"><b>${esc(pro.name)}</b>${pro.specialty ? `<span>${esc(pro.specialty)}</span>` : ""}</div>
      ${pro.practice ? `<p class="muted small">You're with Dr. Caban's practice. Book a visit or message the team any time.</p>`
        : list.length ? `<ul class="coach-list">${list.map((a) => `<li data-assign="${esc(a.id)}"><div><span class="coach-kind">${esc(KIND[a.kind] || "")}</span><b>${esc(a.title)}</b>
            ${a.note ? `<p class="coach-note">“${esc(a.note)}”</p>` : ""}<span class="muted small">${esc(progressText(a))}</span></div>
            <button type="button" class="btn-blue sm" data-assign-go>${PLAY} ${a.kind === "workout" ? "Start" : "Open"}</button></li>`).join("")}</ul>`
        : `<p class="muted small">Nothing assigned yet. ${esc(pro.name)} will send you programs and workouts from MD Fit.</p>`}`;
  }

  // ---- Profile: "Training with" ---------------------------------------------------------------------------------
  const pcard = document.createElement("div");
  pcard.className = "card coach-profile"; pcard.id = "coach-profile";
  (function place() { const head = $("#view-profile .profile-head"); if (head) head.after(pcard); })();
  function renderProfile() {
    if (!coach) return;
    const { mode, pro, shareHealth } = coach;
    const now = !mode ? "Not chosen yet" : mode === "independent" ? "On my own" : pro ? `${pro.name} (${ROLE[mode]})` : `A ${ROLE[mode]}, not picked yet`;
    pcard.innerHTML = `<div class="card-head"><span class="label">Training with</span></div>
      <p class="coach-now"><b>${esc(now)}</b></p>
      ${mode === "clinician" && pro && !pro.practice ? `<label class="coach-share"><input type="checkbox" id="coach-share"${shareHealth ? " checked" : ""}>
        <span>Let ${esc(pro.name)} see my pain check-ins<small>Only your pain check-ins (date, area, level, your note), never anything else. Turn it off any time and they stop seeing them at once.</small></span></label>` : ""}
      ${mode === "trainer" && pro ? `<p class="muted small">Trainers see what they assigned you and whether you did it. Never your pain check-ins or health information.</p>` : ""}
      <div class="coach-modes"><button type="button" class="btn-ghost sm" data-coach-mode="independent"${mode === "independent" ? " disabled" : ""}>On my own</button>
        <button type="button" class="btn-ghost sm" data-coach-pick="trainer">${mode === "trainer" && pro ? "Change trainer" : "With a trainer"}</button>
        <button type="button" class="btn-ghost sm" data-coach-pick="clinician">${mode === "clinician" && pro ? "Change clinician" : "With a clinician"}</button></div>
      <p class="muted small coach-pro-link">Are you a trainer or clinician? <a href="/pro">Apply to coach on MD Fit</a></p>`;
  }

  // ---- The picker sheet -----------------------------------------------------------------------------------------
  const dlg = document.createElement("dialog");
  dlg.className = "sheet coach-sheet"; dlg.id = "coach-sheet"; dlg.setAttribute("aria-label", "Choose who you train with");
  document.body.appendChild(dlg);
  async function openPicker(type) {
    dlg.innerHTML = `<div class="sheet-head"><b>Choose your ${ROLE[type]}</b>${CLOSE}</div><p class="muted small">Loading…</p>`;
    if (!dlg.open) dlg.showModal();
    let pros = [];
    try { pros = (await apiAuth("GET", `/api/me/pros?type=${type}`)).pros || []; } catch (e) { dlg.querySelector("p").textContent = e.message; return; }
    dlg.innerHTML = `<div class="sheet-head"><b>Choose your ${ROLE[type]}</b>${CLOSE}</div>
      ${pros.length ? `<ul class="coach-dir">${pros.map((p) => `<li><div><b>${esc(p.name)}</b>${p.specialty ? `<span>${esc(p.specialty)}</span>` : ""}${p.city ? `<span class="muted">${esc(p.city)}</span>` : ""}
          ${p.bio ? `<p class="small">${esc(p.bio)}</p>` : ""}</div><button type="button" class="btn-blue sm" data-choose="${esc(p.id)}" data-practice="${p.practice ? 1 : ""}" data-name="${esc(p.name)}">Choose</button></li>`).join("")}</ul>`
        : `<p class="small">No ${ROLE[type]}s are listed yet. Check back soon, or train on your own for now.</p>`}
      ${type === "clinician" ? `<label class="coach-share"><input type="checkbox" id="coach-share-new"><span>Let them see my pain check-ins<small>Optional. Only your pain check-ins, never anything else, and you can turn it off any time in Profile.</small></span></label>` : ""}
      <p class="form-msg" role="alert"></p>`;
    dlg.dataset.type = type;
  }
  dlg.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]") || e.target === dlg) { dlg.close(); return; }
    const b = e.target.closest("[data-choose]"); if (!b) return;
    const type = dlg.dataset.type, share = !b.dataset.practice && !!($("#coach-share-new", dlg) || {}).checked;
    b.disabled = true;
    try {
      coach = (await apiAuth("PUT", "/api/me/coach", { mode: type, proId: b.dataset.choose, shareHealth: share })).coach;
      dlg.close(); render(); A.toast(`You're training with ${b.dataset.name}.`);
    } catch (err) { b.disabled = false; const m = dlg.querySelector(".form-msg"); if (m) m.textContent = err.message; }
  });

  async function setMode(mode) {
    try { coach = (await apiAuth("PUT", "/api/me/coach", { mode })).coach; render(); if (mode === "independent") A.toast("You're training on your own."); }
    catch (e) { A.toast(e.message); }
  }
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-coach-mode]");
    if (m) { const v = m.dataset.coachMode; if (v === "independent") setMode("independent"); else openPicker(v); return; }
    const p = e.target.closest("[data-coach-pick]");
    if (p) { openPicker(p.dataset.coachPick); return; }
    const go = e.target.closest("[data-assign-go]");
    if (go) start((coach.assignments || []).find((a) => a.id === go.closest("[data-assign]").dataset.assign));
  });
  document.addEventListener("change", async (e) => {
    if (e.target.id !== "coach-share" || !coach || !coach.pro) return;
    const on = e.target.checked;
    try { coach = (await apiAuth("PUT", "/api/me/coach", { mode: coach.mode, proId: coach.pro.id, shareHealth: on })).coach; render(); A.toast(on ? `${coach.pro.name} can see your pain check-ins.` : "Your pain check-ins are private again."); }
    catch (err) { e.target.checked = !on; A.toast(err.message); }
  });

  // ---- Doing what was assigned ----------------------------------------------------------------------------------
  function start(a) {
    if (!a) return;
    if (a.kind === "program") { location.hash = "#programs/" + a.ref; return; }
    if (a.kind === "protocol") { location.hash = "#pain/muscle/" + a.ref; return; }
    const list = ((a.workout && a.workout.exercises) || []).map((x) => { const ex = byId.get(x.id); return ex ? { ...ex, sets: rx(x), block: "Circuit" } : null; }).filter(Boolean);
    if (!list.length) { A.toast("This workout has no exercises this version of the app knows."); return; }
    const minutes = Math.max(1, Math.round(a.workout.exercises.reduce((n, x) => n + (perSet(x) ? perSet(x).reduce((s, r) => s + r, 0) : x.sets * (x.reps || 10)) * 3 + x.sets * 30, 0) / 60));
    A.startPlayer({ title: a.title, goal: "From your " + (ROLE[coach.mode] || "coach"), goalId: "custom", location: "any", level: "", levelLabel: "Assigned", rounds: 1, restEx: 0, restRound: 0,
      minutes, warmup: [], cooldown: [], circuit: list, exercises: list, perRound: list.length, key: "assign-" + a.id, noRest: true });
  }

  function render() { renderHome(); renderProfile(); }
  async function load() { try { coach = (await apiAuth("GET", "/api/me/coach")).coach; render(); } catch {} }
  load();
  // Back from a session: the counts move
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  window.MDFitCoach = { reload: load };
})();
