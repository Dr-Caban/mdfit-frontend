// /pro: the trainer and clinician portal (server: mdfit-backend lib/pros.js).
//
//   - Not signed in: sign in with your MD Fit member account. Not a pro yet: apply (trainer terms, or for clinicians a
//     license and the business associate agreement). Waiting: shows the status. Approved: your members.
//   - For each member: what you assigned and how far they are (sessions done, last date). Assign more, but only MD Fit
//     content: one of Dr. Jared's programs, a Pain Tool protocol, or a workout built from the video library (sets and
//     reps, a count per set if you want). A clinician whose member said yes also sees that member's pain check-ins;
//     each opening is recorded in the practice's audit ledger. Trainers never see health information.
(() => {
  "use strict";
  const M = window.MDFit || {};
  const $ = (s, r = document) => r.querySelector(s);
  const esc = M.esc || ((s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const API = String(M.API || "").replace(/\/+$/, "");
  const EX = window.MDFIT_EXERCISES || [], EXBY = new Map(EX.map((e) => [e.id, e]));
  const session = () => { try { return (M.auth && M.auth.get()) || null; } catch { return null; } };
  const KIND = { program: "Program", protocol: "Pain protocol", workout: "Workout" };
  let toastT = 0;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200); }

  async function call(method, path, body) {
    const s = session(); const headers = { "content-type": "application/json" };
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    let r; try { r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" }); }
    catch { throw Object.assign(new Error("Couldn't reach the server. Check your connection and try again."), { status: 0 }); }
    let d = null; try { d = await r.json(); } catch {}
    if (r.status === 401) { try { M.auth.clear(); } catch {} signedOut(); throw Object.assign(new Error("Please sign in again."), { status: 401 }); }
    if (!r.ok) throw Object.assign(new Error((d && d.error) || "Something went wrong. Please try again."), { status: r.status, data: d });
    return d || {};
  }
  const state = $("#state");
  const fmt = (d) => { const x = new Date(String(d).slice(0, 10) + "T12:00:00"); return isNaN(x) ? "" : x.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); };

  function signedOut() {
    state.innerHTML = `<section class="card"><p class="kicker">Trainers &amp; clinicians</p><h1>Coach on MD Fit</h1>
      <p>Guide members through Dr. Jared's programs, pain protocols and exercise library. Sign in with your MD Fit account, or create one, then apply here.</p>
      <div class="row"><a class="btn" href="/login?next=%2Fpro">Sign in</a><a class="btn ghost" href="/login?signup=1&amp;next=%2Fpro">Create an account</a></div></section>`;
  }

  // ---- Apply -------------------------------------------------------------------------------------------------------
  function applyForm(prev) {
    const t = (prev && prev.type) || "trainer";
    state.innerHTML = `<section class="card">
      <p class="kicker">Apply to coach</p><h1>${prev && prev.status === "rejected" ? "Apply again" : "Join as a trainer or clinician"}</h1>
      ${prev && prev.status === "rejected" && prev.reason ? `<p class="note">Last time: ${esc(prev.reason)}</p>` : ""}
      <p class="by">Dr. Caban reviews each application before you're listed. Members then choose you in their app.</p>
      <form id="apply" class="form">
        <fieldset class="seg"><legend>I am a</legend>
          <label><input type="radio" name="type" value="trainer"${t === "trainer" ? " checked" : ""}> Personal trainer</label>
          <label><input type="radio" name="type" value="clinician"${t === "clinician" ? " checked" : ""}> Clinician (pain and rehab)</label></fieldset>
        <label>Name members will see<input name="displayName" maxlength="60" required value="${esc((prev && prev.displayName) || "")}"></label>
        <label>Specialty<input name="specialty" maxlength="80" placeholder="e.g. Strength and conditioning, Pain rehab" value="${esc((prev && prev.specialty) || "")}"></label>
        <label>City<input name="city" maxlength="60" value="${esc((prev && prev.city) || "")}"></label>
        <label>About you<textarea name="bio" maxlength="600" rows="4">${esc((prev && prev.bio) || "")}</textarea></label>
        <div class="cl-only"><div class="two"><label>License number<input name="license" maxlength="40"></label><label>License state<input name="licenseState" maxlength="20" placeholder="FL"></label></div>
          <label class="check"><input type="checkbox" name="acceptBaa"><span>I accept the <b>business associate agreement</b>: MD Fit keeps the pain check-ins my patients choose to share with me secure and private, uses them only to show them to me, and tells me of any breach; I use them only for my patients' care.</span></label></div>
        <div class="tr-only"><label class="check"><input type="checkbox" name="acceptTerms"><span>I accept the <b>trainer terms</b>: I'm not giving medical advice, I assign only MD Fit content, and I refer members with pain or injury to a clinician.</span></label></div>
        <p class="form-msg" role="alert"></p>
        <button class="btn" type="submit">Send application</button>
      </form></section>`;
    const f = $("#apply"), sync = () => { const cl = f.type.value === "clinician"; f.querySelector(".cl-only").hidden = !cl; f.querySelector(".tr-only").hidden = cl; };
    f.addEventListener("change", sync); sync();
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); const b = f.querySelector("button[type=submit]"); b.disabled = true;
      const v = Object.fromEntries(new FormData(f).entries());
      try {
        await call("POST", "/api/me/pro/apply", { ...v, acceptBaa: !!f.acceptBaa.checked, acceptTerms: !!f.acceptTerms.checked });
        start();
      } catch (err) { b.disabled = false; f.querySelector(".form-msg").textContent = err.message; }
    });
  }

  // ---- Members -----------------------------------------------------------------------------------------------------
  let me = null, members = [], open = null, catalog = null;
  async function loadCatalog() {
    if (catalog) return catalog;
    const d = await call("GET", "/api/content").catch(() => ({ programs: [] }));
    const programs = (d.programs || []).map((p) => ({ id: p.id, title: p.title, category: p.category }));
    let protocols = [];
    try {
      await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/painmuscles.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "/musclereports.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      const MU = (window.MDFitMuscles || {}).MUSCLES || {}, R = window.MDFIT_MUSCLE_REPORTS || {};
      protocols = Object.keys(R).filter((id) => R[id] && R[id].protocol && MU[id]).map((id) => ({ id, title: `${MU[id].name} protocol` })).sort((a, b) => a.title.localeCompare(b.title));
    } catch {}
    return (catalog = { programs, protocols });
  }

  async function home() {
    const d = await call("GET", "/api/me/pro/members");
    me = d.pro; members = d.members || [];
    const isCl = me.type === "clinician";
    state.innerHTML = `<section class="card"><p class="kicker">${isCl ? "Clinician" : "Trainer"} · approved</p><h1>${esc(me.displayName)}</h1>
      <p class="by">${members.length ? `${members.length} ${members.length === 1 ? "member" : "members"} train with you.` : "No members yet. Members choose you in their MD Fit app."}</p></section>
      ${members.map((m) => `<section class="card mem" data-m="${esc(m.id)}">
        <div class="mem-head"><div><b>${esc(m.name)}</b><span class="by">Since ${esc(fmt(m.since))}${isCl ? ` · ${m.sharesHealth ? "shares pain check-ins with you" : "hasn't shared pain check-ins"}` : ""}</span></div>
          <button type="button" class="btn sm" data-toggle>${open === m.id ? "Close" : "Open"}</button></div>
        ${open === m.id ? memberBody(m, isCl) : summary(m)}</section>`).join("")}
      <p class="note">${isCl ? "You see a member's pain check-ins only while they choose to share them; each time you open them it's recorded. You never see their records with Dr. Caban's practice." : "You see what you assigned and whether it was done. Members' health information is never shown to trainers."}</p>`;
  }
  const progress = (a) => (a.sessions ? `${a.sessions} ${a.sessions === 1 ? "session" : "sessions"}${a.last ? ` · last ${fmt(a.last)}` : ""}` : "Not started");
  const summary = (m) => `<p class="by">${m.assignments.length ? `${m.assignments.length} assigned · ${m.assignments.filter((a) => a.sessions).length} started` : "Nothing assigned yet."}</p>`;
  function memberBody(m, isCl) {
    return `<ul class="asg">${m.assignments.map((a) => `<li><div><span class="kind">${esc(KIND[a.kind])}</span><b>${esc(a.title)}</b>${a.note ? `<span class="by">“${esc(a.note)}”</span>` : ""}<span class="by">Assigned ${esc(fmt(a.assignedOn))} · ${esc(progress(a))}</span></div>
        <button type="button" class="btn ghost sm" data-unassign="${esc(a.id)}">Remove</button></li>`).join("") || `<li class="by">Nothing assigned yet.</li>`}</ul>
      <div class="row"><button type="button" class="btn sm" data-assign>Assign from MD Fit</button>
        ${isCl && m.sharesHealth ? `<button type="button" class="btn ghost sm" data-pain>Pain check-ins</button>` : ""}
        <button type="button" class="btn ghost sm" data-release>Stop coaching</button></div>
      <div class="pain" hidden></div><div class="assign" hidden></div>`;
  }

  // ---- Assign: MD Fit content only ----------------------------------------------------------------------------------
  async function assignForm(box, m) {
    const c = await loadCatalog();
    box.hidden = false;
    box.innerHTML = `<form class="form af">
      <fieldset class="seg"><legend>Assign</legend>
        <label><input type="radio" name="kind" value="program" checked> A program</label>
        <label><input type="radio" name="kind" value="protocol"> A pain protocol</label>
        <label><input type="radio" name="kind" value="workout"> A workout</label></fieldset>
      <label class="k-program">Program<select name="program">${c.programs.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} · ${esc(p.category)}</option>`).join("")}</select></label>
      <label class="k-protocol" hidden>Pain protocol<select name="protocol">${c.protocols.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("")}</select></label>
      <div class="k-workout" hidden>
        <label>Workout name<input name="title" maxlength="60" placeholder="e.g. Lower body, week 1"></label>
        <label>Add from the MD Fit library<input name="q" placeholder="Search exercises" autocomplete="off"></label>
        <ul class="lib"></ul><ol class="picked"></ol></div>
      <label>Note for ${esc(m.name.split(" ")[0])} <span class="by">(optional)</span><input name="note" maxlength="300"></label>
      <p class="form-msg" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Assign</button><button class="btn ghost" type="button" data-cancel>Cancel</button></div></form>`;
    const f = $("form", box), items = [];
    const show = () => { const k = f.kind.value; f.querySelector(".k-program").hidden = k !== "program"; f.querySelector(".k-protocol").hidden = k !== "protocol"; f.querySelector(".k-workout").hidden = k !== "workout"; };
    const drawLib = () => { const q = f.q.value.trim().toLowerCase(); f.querySelector(".lib").innerHTML = q ? EX.filter((e) => `${e.name} ${e.region} ${e.cat}`.toLowerCase().includes(q)).slice(0, 12).map((e) => `<li><span>${esc(e.name)} <small class="by">${esc(e.region)} · ${esc(e.cat)}</small></span><button type="button" class="btn ghost sm" data-add="${esc(e.id)}">Add</button></li>`).join("") || `<li class="by">No exercises match.</li>` : ""; };
    const drawPicked = () => { f.querySelector(".picked").innerHTML = items.map((x, i) => `<li data-i="${i}"><b>${esc((EXBY.get(x.id) || {}).name || "Exercise")}</b>
        <span class="two"><label>Sets<input type="number" min="1" max="10" value="${x.sets}" data-f="sets"></label>${x.repsBySet ? "" : `<label>Reps<input type="number" min="1" max="100" value="${x.reps}" data-f="reps"></label>`}</span>
        <button type="button" class="link" data-each>${x.repsBySet ? "Same reps every set" : "Reps for each set"}</button>
        ${x.repsBySet ? `<span class="sets">${x.repsBySet.map((r, k) => `<label>Set ${k + 1}<input type="number" min="1" max="100" value="${r}" data-set="${k}"></label>`).join("")}</span>` : ""}
        <button type="button" class="link" data-rm>Remove</button></li>`).join(""); };
    f.addEventListener("change", (e) => {
      if (e.target.name === "kind") return show();
      const li = e.target.closest("[data-i]"); if (!li) return; const x = items[Number(li.dataset.i)], n = Math.max(1, Math.round(Number(e.target.value) || 1));
      if (e.target.dataset.f === "sets") { x.sets = Math.min(10, n); if (x.repsBySet) x.repsBySet = Array.from({ length: x.sets }, (_, k) => x.repsBySet[k] || x.repsBySet[x.repsBySet.length - 1]); setTimeout(drawPicked); }
      else if (e.target.dataset.f === "reps") x.reps = Math.min(100, n);
      else if (e.target.dataset.set !== undefined) { x.repsBySet[Number(e.target.dataset.set)] = Math.min(100, n); x.reps = x.repsBySet[0]; }
    });
    f.q.addEventListener("input", drawLib);
    f.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]"); if (add) { items.push({ id: add.dataset.add, sets: 3, reps: 10 }); drawPicked(); return; }
      const li = e.target.closest("[data-i]"); if (!li) return; const i = Number(li.dataset.i), x = items[i];
      if (e.target.closest("[data-rm]")) { items.splice(i, 1); drawPicked(); }
      else if (e.target.closest("[data-each]")) { if (x.repsBySet) { x.reps = x.repsBySet[0]; delete x.repsBySet; } else x.repsBySet = Array.from({ length: x.sets }, () => x.reps); drawPicked(); }
    });
    f.querySelector("[data-cancel]").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); const k = f.kind.value, msg = f.querySelector(".form-msg"), b = f.querySelector("button[type=submit]");
      const body = { clientId: m.id, kind: k, note: f.note.value };
      if (k === "program") body.ref = f.program.value;
      if (k === "protocol") { body.ref = f.protocol.value; body.title = f.protocol.selectedOptions[0].textContent; }
      if (k === "workout") { if (!items.length) { msg.textContent = "Add at least one exercise."; return; } body.title = f.title.value.trim(); body.exercises = items; }
      b.disabled = true;
      try { await call("POST", "/api/me/pro/assignments", body); toast("Assigned."); await home(); }
      catch (err) { b.disabled = false; msg.textContent = err.message; }
    });
  }

  async function pain(box, m) {
    box.hidden = false; box.innerHTML = `<p class="by">Loading…</p>`;
    try {
      const d = await call("GET", `/api/me/pro/members/${encodeURIComponent(m.id)}/pain`);
      box.innerHTML = d.pain.length ? `<table class="ptab"><thead><tr><th>Date</th><th>Area</th><th>Level</th><th>Note</th></tr></thead><tbody>${d.pain.map((x) => `<tr><td>${esc(fmt(x.date))}</td><td>${esc(x.area)}</td><td>${x.level}/10</td><td>${esc(x.note)}</td></tr>`).join("")}</tbody></table>
        <p class="by">The last 90 days. Shared by ${esc(m.name)}; they can stop sharing at any time.</p>` : `<p class="by">No pain check-ins in the last 90 days.</p>`;
    } catch (err) { box.innerHTML = `<p class="note">${esc(err.message)}</p>`; }
  }

  state.addEventListener("click", async (e) => {
    const sec = e.target.closest("[data-m]"); if (!sec) return;
    const m = members.find((x) => x.id === sec.dataset.m); if (!m) return;
    if (e.target.closest("[data-toggle]")) { open = open === m.id ? null : m.id; return home(); }
    if (e.target.closest("[data-assign]")) return assignForm($(".assign", sec), m);
    if (e.target.closest("[data-pain]")) return pain($(".pain", sec), m);
    const un = e.target.closest("[data-unassign]");
    if (un) { if (!confirm("Remove this assignment from their app?")) return; try { await call("DELETE", `/api/me/pro/assignments/${encodeURIComponent(un.dataset.unassign)}`); await home(); } catch (err) { toast(err.message); } return; }
    if (e.target.closest("[data-release]")) {
      if (!confirm(`Stop coaching ${m.name}? They'll train on their own, and anything they shared with you stops.`)) return;
      try { await call("POST", `/api/me/pro/members/${encodeURIComponent(m.id)}/release`); open = null; await home(); } catch (err) { toast(err.message); }
    }
  });

  async function start() {
    if (!(session() || {}).token) return signedOut();
    try {
      const { pro } = await call("GET", "/api/me/pro");
      if (!pro || pro.status === "rejected") return applyForm(pro);
      if (pro.status === "pending") {
        state.innerHTML = `<section class="card"><p class="kicker">Application sent</p><h1>Thanks, ${esc(pro.displayName)}</h1>
          <p>Dr. Caban reviews every ${pro.type} before they're listed. You'll be able to use this page as soon as you're approved.</p>
          <p class="by">Applied ${esc(fmt(pro.appliedAt))} as a ${esc(pro.type)}.</p></section>`;
        return;
      }
      if (pro.status === "suspended") { state.innerHTML = `<section class="card"><h1>Your listing is paused</h1><p>${esc(pro.reason || "Contact MD Fit at 941-313-0562.")}</p></section>`; return; }
      await home();
    } catch (err) { if (err.status !== 401) state.innerHTML = `<section class="card"><h1>${esc(err.message)}</h1></section>`; }
  }
  start();
})();
