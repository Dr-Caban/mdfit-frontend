// /shared?s=<key>: one saved program or saved workout a member shared by link.
// /shared?p=<program id> and /shared?m=<muscle id>: one of Dr. Jared's library programs or pain-tool protocols that a
//   member shared from the app (see "Share a library program" in account.js). These are the practice's own catalog,
//   already public (/api/content, /data/protocols, musclereports.js), so no key is needed: the page shows a preview
//   (what it is for, the weeks or phases, each exercise and its dose; no videos) and a way into the app. The link
//   carries the sharer's ?ref= code, which common.js keeps on this device so the sign-up that follows is credited.
//
// - Anyone with the link may read it: no account, no token, no membership. The page asks the public route
//   GET /api/shares/:key and shows the name, who shared it and the exercises with their sets and reps.
// - A signed-in member (free membership included) gets "Save to my workouts", which keeps a copy on their
//   account under "Shared with me". A signed-out visitor is invited to log in or open a free account, with
//   this link carried in ?next= so they come straight back here.
// - 404 and 429 are shown with the server's own words.
// Exercise names come from window.MDFIT_EXERCISES (app/exercises.js). An id this build doesn't know is skipped
// and counted, so a newer plan still reads sensibly on an older page.
(() => {
  "use strict";
  const M = window.MDFit || {};
  const $ = (s) => document.querySelector(s);
  const esc = M.esc || ((s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const API = String(M.API || "").replace(/\/+$/, "");
  const NAMES = new Map((window.MDFIT_EXERCISES || []).map((e) => [e.id, e.name]));
  const KEY = new URLSearchParams(location.search).get("s") || "";
  // The link this page was opened with, carried through the login screen so the visitor lands back here.
  const here = "/shared?s=" + encodeURIComponent(KEY);
  const loginHref = (signup) => "/login?" + (signup ? "signup=1&" : "") + "next=" + encodeURIComponent(here);
  // Storage can be switched off (private mode, some web views): then there is simply no session.
  const session = () => { try { return (M.auth && M.auth.get()) || null; } catch { return null; } };

  const SAVE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M9 3v6h6V3"/><path d="M8 14h8"/></svg>';
  const OPEN_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';

  // ---- Dates in the viewer's own locale
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" }); };

  let toastT = 0;
  function toast(msg, sub) {
    const t = $("#toast");
    t.innerHTML = esc(msg) + (sub ? `<small>${esc(sub)}</small>` : "");
    t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200);
  }

  // ---- The server. Errors carry the server's own plain-English text (404 "This link no longer works.", 429, 400).
  async function call(method, path, token) {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    let r;
    try { r = await fetch(API + path, { method, headers, cache: "no-store" }); }
    catch { throw Object.assign(new Error("Couldn't reach the server. Check your connection and try again."), { status: 0 }); }
    let d = null; try { d = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error((d && typeof d.error === "string" && d.error) || "Something went wrong. Please try again."), { status: r.status });
    return d || {};
  }

  // ---- What is in a snapshot: a workout is { name, exercises: [...] }, a saved program is { name, workout: {...} }
  const list = (a) => (Array.isArray(a) ? a : []);
  function blocks(snap) {
    const w = snap && snap.workout;
    if (w && typeof w === "object") {
      return [["Warm-up", list(w.warmup)], ["Circuit", list(w.circuit)], ["Cool-down", list(w.cooldown)]].filter(([, a]) => a.length);
    }
    return [["", list(snap && snap.exercises)]];
  }
  // An entry carries sets and either a rep count (My workouts) or sets already written out (the generator's programs)
  function detail(x) {
    const reps = Number(x && x.reps) > 0 ? Number(x.reps) : 0, sets = x && x.sets;
    if (reps && Number(sets) > 0) return `${Number(sets)} × ${reps} reps`;
    if (reps) return `${reps} reps`;
    if (typeof sets === "string" && sets.trim()) return sets.trim();
    if (Number(sets) > 0) return `${Number(sets)} ${Number(sets) === 1 ? "set" : "sets"}`;
    return "";
  }
  function facts(share) {
    const snap = share.snapshot || {}, w = snap.workout, out = [];
    if (w && typeof w === "object") {
      if (w.goal) out.push(String(w.goal));
      const circuit = list(w.circuit).length, rounds = Number(w.rounds) > 0 ? Number(w.rounds) : 0;
      if (circuit && rounds) out.push(`${circuit} × ${rounds} rounds`);
      if (Number(w.minutes) > 0) out.push(`about ${Number(w.minutes)} min`);
    } else {
      const n = list(snap.exercises).length;
      if (n) out.push(`${n} ${n === 1 ? "exercise" : "exercises"}`);
    }
    return out;
  }

  function render(share) {
    const snap = share.snapshot || {};
    const title = snap.name || (snap.workout && snap.workout.title) || share.title || "A workout";
    const kind = share.kind === "program" ? "Shared program" : "Shared workout";
    const groups = blocks(snap);
    let skipped = 0, n = 0;
    const body = groups.map(([label, items]) => {
      const rows = items.map((x) => {
        const name = NAMES.get(x && x.id);
        if (!name) { skipped++; return ""; }        // an exercise this build doesn't know: left out, counted below
        n++;
        const d = detail(x);
        return `<li><span class="n" aria-hidden="true">${n}</span><div><b>${esc(name)}</b>${d ? `<span>${esc(d)}</span>` : ""}</div></li>`;
      }).join("");
      if (!rows) return "";
      return (groups.length > 1 && label ? `<h2 class="block">${esc(label)}</h2>` : "") + `<ul class="ex">${rows}</ul>`;
    }).join("");
    const fx = facts(share);
    $("#state").innerHTML = `<section class="card">
      <p class="kicker">${esc(kind)}</p>
      <h1>${esc(title)}</h1>
      <p class="by">Shared by <b>${esc(share.by || "an MD Fit member")}</b>${share.createdAt && when(share.createdAt) ? ` · ${esc(when(share.createdAt))}` : ""}</p>
      ${fx.length ? `<ul class="facts">${fx.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${body || '<p class="note">This plan has no exercises this version of the app can show yet.</p>'}
      ${skipped ? `<p class="note">${skipped} ${skipped === 1 ? "movement isn't" : "movements aren't"} in this version of the library yet.</p>` : ""}
    </section>`;
    renderAct(share, title);
  }

  function renderAct(share, title) {
    const act = $("#act"), sess = session();
    if (sess && sess.token) {
      act.innerHTML = `<h2 id="act-h">Keep a copy</h2>
        <p>Save it to your account and it waits for you in the MD Fit app, under “Shared with me”.</p>
        <div class="row"><button type="button" class="btn" id="save">${SAVE_IC} Save to my workouts</button></div>`;
      $("#save").addEventListener("click", () => saveCopy(share, title));
    } else {
      act.innerHTML = `<h2 id="act-h">Want to keep it?</h2>
        <p>Anyone can read this page. Log in, or open a free MD Fit account, and this ${share.kind === "program" ? "program" : "workout"} is saved under “Shared with me” so you can do it any time.</p>
        <div class="row"><a class="btn" href="${esc(loginHref(true))}">Create a free account</a><a class="btn ghost" href="${esc(loginHref(false))}">I already have an account</a></div>`;
    }
    act.hidden = false;
  }

  async function saveCopy(share, title) {
    const sess = session(), b = $("#save");
    if (!sess || !sess.token) return renderAct(share, title);     // the session ran out while the page was open
    b.disabled = true;
    try {
      await call("POST", `/api/me/shares/${encodeURIComponent(KEY)}/save`, sess.token);
      $("#act").innerHTML = `<h2 id="act-h">Saved</h2>
        <p class="done">“${esc(title)}” is on your account, under “Shared with me”.</p>
        <div class="row"><a class="btn" href="/account">Open the MD Fit app ${OPEN_IC}</a></div>`;
      toast("Saved to your account");
    } catch (e) {
      b.disabled = false;
      toast(e.message);
      if (e.status === 401) renderAct(Object.assign({}, share, {}), title);   // signed out: show the invitation
    }
  }

  // ---- Library programs and pain-tool protocols (?p= / ?m=)
  const Q = new URLSearchParams(location.search);
  const PROG = (Q.get("p") || "").trim(), MUSC = (Q.get("m") || "").trim();
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const loadScript = (src) => new Promise((ok, no) => { const t = document.createElement("script"); t.src = src; t.onload = ok; t.onerror = no; document.head.appendChild(t); });
  const getJson = async (url) => { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw Object.assign(new Error("Not found"), { status: r.status }); return r.json(); };
  const doseOf = (d = {}) => [d.sets && `${d.sets} sets`, d.reps, d.hold && `hold ${d.hold}`].filter(Boolean).join(" × ").slice(0, 60);
  const exList = (items) => `<ul class="ex">${items.map((x, i) => `<li><span class="n" aria-hidden="true">${i + 1}</span><div><b>${esc(x.name)}</b>${x.dose ? `<span>${esc(x.dose)}</span>` : ""}</div></li>`).join("")}</ul>`;
  const LEVEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

  // Into the app: a member goes straight there; anyone else signs up (or logs in) and lands on it after.
  // The login page only follows a "next" it recognises: /account with a #route made of a-z, 0-9, "/" and "-".
  function renderOpen(route, what) {
    const act = $("#act"), sess = session(), dest = "/account#" + route;
    const login = (signup) => "/login?" + (signup ? "signup=1&" : "") + "next=" + encodeURIComponent(dest);
    let invited = ""; try { invited = M.refCode ? M.refCode() : ""; } catch {}
    if (sess && sess.token) {
      act.innerHTML = `<h2 id="act-h">Do it in MD Fit</h2>
        <p>Open it in the app to follow along with Dr. Jared's videos and track your progress.</p>
        <div class="row"><a class="btn" href="${esc(dest)}">Open in MD Fit ${OPEN_IC}</a></div>`;
    } else {
      act.innerHTML = `<h2 id="act-h">Start this ${esc(what)}</h2>
        <p>Join MD Fit to follow it with Dr. Jared's videos, guided sessions and progress tracking. You land right on it after you sign up.</p>
        ${invited ? `<p class="note">You were invited by a friend: their code <b>${esc(invited)}</b> is applied when you sign up.</p>` : ""}
        <div class="row"><a class="btn" href="${esc(login(true))}">Join MD Fit</a><a class="btn ghost" href="${esc(login(false))}">I already have an account</a></div>`;
    }
    act.hidden = false;
  }

  async function startProgram() {
    const d = await getJson(API + "/api/content");
    const p = ((d && d.programs) || []).find((x) => x && x.id === PROG);
    if (!p) throw new Error("This program isn't available anymore.");
    document.title = `${p.title} | MD Fit`;
    let pr = null;
    try { const ix = await getJson("/data/protocols/index.json"); if ((ix.ids || []).includes(p.id)) pr = await getJson(`/data/protocols/${encodeURIComponent(p.id)}.json`); } catch {}
    const weeks = pr && Array.isArray(pr.weeks) ? pr.weeks : [];
    const fx = [p.category, LEVEL[p.level], weeks.length ? `${weeks.length} ${weeks.length === 1 ? "part" : "parts"}, week by week` : p.weeks ? `${p.weeks} weeks` : "", p.location === "home" ? "At home" : p.location === "gym" ? "In the gym" : ""].filter(Boolean);
    const body = weeks.length
      ? weeks.map((w) => `<h2 class="block">${esc(w.label || "")}</h2>${w.focus ? `<p class="note">${esc(w.focus)}</p>` : ""}${exList((w.exercises || []).filter((x) => x && x.name).map((x) => ({ name: x.name, dose: doseOf(x.dosage) })))}`).join("")
      : (p.days || []).length ? `<h2 class="block">Sessions</h2>${exList(p.days.map((x) => ({ name: x.name, dose: x.length ? `about ${x.length} min` : "" })))}` : "";
    $("#state").innerHTML = `<section class="card">
      <p class="kicker">Dr. Jared's program</p>
      ${p.image && /^assets\/[\w\/.-]+$/.test(p.image) ? `<img class="poster" src="/${esc(p.image)}" alt="" loading="lazy">` : ""}
      <h1>${esc(p.title)}</h1>
      ${p.summary ? `<p class="by">${esc(p.summary)}</p>` : ""}
      ${fx.length ? `<ul class="facts">${fx.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${pr && pr.goal ? `<p class="note"><b>The goal:</b> ${esc(pr.goal)}</p>` : ""}
      ${body}
    </section>`;
    renderOpen("programs/" + p.id, "program");
  }

  const PHASES = [["calm", "Phase 1 · Calm it down", "Days 1 to 7"], ["restore", "Phase 2 · Restore", "Weeks 2 to 3"], ["strengthen", "Phase 3 · Strengthen", "Weeks 3 to 6"]];
  async function startMuscle() {
    await loadScript("/painmuscles.js"); await loadScript("/musclereports.js");
    const m = window.MDFitMuscles && window.MDFitMuscles.MUSCLES[MUSC], r = (window.MDFIT_MUSCLE_REPORTS || {})[MUSC];
    if (!m || !r || !r.protocol) throw new Error("This protocol isn't available anymore.");
    document.title = `${m.name} protocol | MD Fit`;
    const phases = PHASES.filter(([k]) => (r.protocol[k] || []).length);
    $("#state").innerHTML = `<section class="card">
      <p class="kicker">Dr. Jared's pain protocol</p>
      <h1>${esc(m.name)}</h1>
      ${m.refers ? `<p class="by"><b>Where it sends pain:</b> ${esc(m.refers)}</p>` : ""}
      <ul class="facts"><li>3 phases</li><li>About 6 weeks</li><li>At home</li></ul>
      ${phases.map(([k, t, when]) => `<h2 class="block">${esc(t)} <small>${esc(when)}</small></h2>${exList(r.protocol[k].filter((x) => x && x.name).map((x) => ({ name: x.name, dose: x.dose || "" })))}`).join("")}
      ${r.expect ? `<p class="note"><b>What to expect:</b> ${esc(r.expect)}</p>` : ""}
      <p class="note">Educational, not a diagnosis. If pain is severe, getting worse or comes with numbness or weakness, book an evaluation.</p>
    </section>`;
    renderOpen("pain/muscle/" + MUSC, "protocol");
  }

  async function start() {
    if (PROG || MUSC) {
      const id = PROG || MUSC;
      if (!ID_RE.test(id)) { gone("This link is incomplete. Ask for it again."); return; }
      try { await (PROG ? startProgram() : startMuscle()); }
      catch (e) { gone(e && e.status ? "Couldn't load this right now. Please try again." : (e && e.message) || "Couldn't load this right now. Please try again."); }
      return;
    }
    if (!KEY) { gone("This link is incomplete. Ask for it again."); return; }
    try {
      const d = await call("GET", "/api/shares/" + encodeURIComponent(KEY));
      if (!d.share) throw Object.assign(new Error("This link no longer works."), { status: 404 });
      render(d.share);
    } catch (e) { gone(e.message); }
  }
  function gone(msg) {
    $("#act").hidden = true;
    $("#state").innerHTML = `<section class="card gone"><h1>${esc(msg)}</h1>
      <p class="note">MD Fit builds and shares workouts, rehab programs and daily plans.</p>
      <div class="row"><a class="btn" href="/">Go to MD Fit</a></div></section>`;
  }
  start();
})();
