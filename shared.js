// /shared?s=<key>: one saved program or saved workout a member shared by link.
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

  async function start() {
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
