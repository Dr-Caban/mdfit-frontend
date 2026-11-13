// MD Fit member app: sharing a saved program or a saved workout by link.
//
//   - Every saved program (My programs) and saved workout (My workouts) carries a share button. It asks the server
//     for the item's link — POST /api/me/shares is idempotent, so the same item always gets the same key — and then
//     hands it to the phone's share sheet, or the clipboard, or shows it in a toast.
//   - "Links you've shared" lists every link that is live, copies one again, and stops sharing (DELETE).
//   - "Shared with me" holds the copies this member saved from someone else's link: open one in the player, or remove it.
// Anyone with a link can read it at /shared?s=<key>, signed in or not, free membership or paid. The server decides
// what a link shows and who may save a copy; this file only asks.
(() => {
  "use strict";
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const A = window.MDFitApp; if (!A) return;
  const { $, esc, apiAuth } = M;
  const byId = A.byId || new Map((window.MDFIT_EXERCISES || []).map((e) => [e.id, e]));

  // A link must work for whoever it is sent to, so it always names the live site — never a preview host.
  const SITE = "https://www.mymdfit.com";
  const linkFor = (key) => `${SITE}/shared?s=${encodeURIComponent(key)}`;
  const KINDS = { program: "program", workout: "workout" };

  const SHARE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true" class="ic-line"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const LINK_IC = '<svg viewBox="0 0 24 24" aria-hidden="true" class="ic-line"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';
  const PLAY_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
  const TRASH_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>';
  const CLOSE_IC = '<button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>';

  let shares = [], items = [];

  // ---- Dates in the viewer's own locale
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // ---- Which saved item a live link belongs to. The server may name the item it was made from; when it does not,
  // the title it stored is the only handle there is, so both are tried before a button is called "not shared".
  const srcId = (s) => (s && (s.id != null ? s.id : s.itemId != null ? s.itemId : s.sourceId != null ? s.sourceId : null));
  function shareOf(kind, id, title) {
    const same = shares.filter((s) => s && s.kind === kind);
    return same.find((s) => srcId(s) != null && String(srcId(s)) === String(id)) ||
      (title ? same.find((s) => String(s.title || "") === String(title)) : null) || null;
  }
  function keep(share) {
    if (!share || !share.key) return;
    const n = shares.findIndex((s) => s.key === share.key);
    if (n >= 0) shares[n] = share; else shares.push(share);
  }

  // ---- The button on each saved item. Its markup is written by account.js (programs) and account-xp.js (workouts);
  // this paints the state on, after every one of their re-draws.
  function paint() {
    document.querySelectorAll("[data-share-item]").forEach((b) => {
      const on = !!shareOf(b.dataset.shareKind, b.dataset.shareItem, b.dataset.shareTitle);
      const name = b.dataset.shareTitle || "this " + (KINDS[b.dataset.shareKind] || "workout");
      // The lists leave the button empty and hidden, so an app that never loaded this file shows no dead control.
      if (!b.firstChild) b.innerHTML = SHARE_IC;
      b.classList.add("ready");
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("on", on);
      b.setAttribute("aria-label", on ? `Shared. Send the link to ${name} again` : `Share ${name} by link`);
      b.title = on ? "Shared · send the link again" : "Share by link";
    });
    renderCard();
  }

  async function offer(btn) {
    const kind = btn.dataset.shareKind, id = btn.dataset.shareItem, title = btn.dataset.shareTitle || "";
    if (!KINDS[kind] || !id) return;
    let sh = shareOf(kind, id, title);
    if (!sh) {
      btn.disabled = true;
      try { sh = (await apiAuth("POST", "/api/me/shares", { kind, id })).share; keep(sh); }
      catch (e) { A.toast(e.message); return; }
      finally { btn.disabled = false; }
    }
    if (!sh || !sh.key) { A.toast("Couldn't make a link for that. Please try again."); return; }
    paint();
    const url = linkFor(sh.key), label = sh.title || title || "a workout";
    if (navigator.share) {
      try { await navigator.share({ title: `MD Fit: ${label}`, text: `${label} — on MD Fit`, url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); A.toast("Link copied. Anyone with it can see this workout."); }
    catch { A.toast("Copy this link: " + url); }
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-share-item]");
    if (b && !b.disabled) { e.preventDefault(); e.stopPropagation(); offer(b); }
  });

  // ================= The card: what you saved from a link, and the links you handed out =================
  const card = document.createElement("section");
  card.className = "card shared-card"; card.id = "shared-card"; card.hidden = true;
  card.setAttribute("aria-label", "Shared workouts");
  (function place() {
    const home = $("#view-home .col-main"); if (!home) return;
    const anchor = $("#home-my-workouts", home) || $("#today-card", home);
    anchor ? anchor.after(card) : home.appendChild(card);
  })();

  function renderCard() {
    const rows = items.map((it) => {
      const n = countOf(it);
      return `<li class="sh-item" data-shared="${esc(it.id)}">
        <div class="sh-txt"><b>${esc(nameOf(it))}</b><span>From ${esc(it.by || "another member")}${n ? ` · ${esc(plural(n, "exercise"))}` : ""}${it.savedAt && when(it.savedAt) ? ` · saved ${esc(when(it.savedAt))}` : ""}</span></div>
        <div class="sh-acts"><button type="button" class="btn-blue sm" data-shared-open>${PLAY_IC} Start</button>
          <button type="button" class="icon-btn sh-del" data-shared-del aria-label="Remove ${esc(nameOf(it))} from Shared with me">${TRASH_IC}</button></div></li>`;
    }).join("");
    const mine = shares.length
      ? `<button type="button" class="link-sm sh-links" data-shared-links>${LINK_IC} ${esc(plural(shares.length, "link"))} you've shared</button>` : "";
    card.hidden = !(items.length || shares.length);
    if (card.hidden) return;
    card.innerHTML = `<div class="card-head"><span class="label accent">Shared with me</span></div>` +
      (items.length ? `<ul class="sh-list">${rows}</ul>`
        : `<p class="muted small sh-intro">Nothing shared with you yet. When someone sends you an MD Fit link, saving it puts it here.</p>`) + mine;
  }
  const nameOf = (it) => (it.snapshot && it.snapshot.name) || it.title || "A workout";
  const countOf = (it) => {
    const s = it.snapshot || {}, w = s.workout;
    const len = (a) => (Array.isArray(a) ? a.length : 0);
    return w && typeof w === "object" ? len(w.warmup) + len(w.circuit) + len(w.cooldown) : len(s.exercises);
  };

  // ---- A saved copy, as the workout player expects it. An exercise this build doesn't know is left out.
  const repsOf = (x) => (Number(x.reps) > 0 ? Number(x.reps) : Math.max(5, Math.min(100, Math.round((Number(x.seconds) || 30) / 3))));
  function setsText(x) {
    const reps = Number(x.reps) > 0 ? Number(x.reps) : 0, sets = x.sets;
    if (reps && Number(sets) > 0) return `${Number(sets)} × ${reps} reps`;
    if (typeof sets === "string" && sets.trim()) return sets.trim();
    if (Number(sets) > 0) return `${Number(sets)} × ${repsOf(x)} reps`;
    return "1 set";
  }
  const minutesOf = (arr) => Math.max(1, Math.round((Array.isArray(arr) ? arr : []).reduce((n, x) => n + (Number(x.sets) || 3) * (repsOf(x) * 3 + 30), 0) / 60));
  function playerFor(it) {
    const snap = it.snapshot || {}, w = snap.workout;
    const ex = (arr, block) => (Array.isArray(arr) ? arr : []).map((x) => { const e = byId.get(x && x.id); return e ? { ...e, sets: setsText(x), block } : null; }).filter(Boolean);
    const title = String(nameOf(it)).slice(0, 80);
    if (w && typeof w === "object") {
      const warmup = ex(w.warmup, "Warm-up"), circuit = ex(w.circuit, "Circuit"), cooldown = ex(w.cooldown, "Cool-down");
      return { ...w, key: "shared-" + it.id, title, goal: w.goal || "Shared with me", warmup, circuit, cooldown,
        exercises: [...warmup, ...circuit, ...cooldown], perRound: circuit.length };
    }
    const circuit = ex(snap.exercises, "Circuit");
    return { title, goal: "Shared with me", goalId: "custom", location: "any", level: "", levelLabel: "Shared with me",
      rounds: 1, restEx: 0, restRound: 0, minutes: minutesOf(snap.exercises), warmup: [], cooldown: [],
      circuit, exercises: circuit, perRound: circuit.length, key: "shared-" + it.id, noRest: true };
  }

  card.addEventListener("click", async (e) => {
    if (e.target.closest("[data-shared-links]")) return openLinks();
    const li = e.target.closest("[data-shared]"); if (!li) return;
    const it = items.find((x) => String(x.id) === li.dataset.shared); if (!it) return;
    if (e.target.closest("[data-shared-open]")) {
      const w = playerFor(it);
      if (!w.exercises.length) return A.toast("None of these exercises are in the app yet.");
      return A.startPlayer(w);
    }
    const del = e.target.closest("[data-shared-del]");
    if (del) {
      if (!confirm(`Remove "${nameOf(it)}" from Shared with me?`)) return;
      del.disabled = true;
      try { const d = await apiAuth("DELETE", `/api/me/shared-with-me/${encodeURIComponent(it.id)}`); items = (d && d.items) || items.filter((x) => x !== it); renderCard(); A.toast("Removed."); }
      catch (err) { del.disabled = false; A.toast(err.message); }
    }
  });

  // ================= "Links you've shared": copy one again, or stop sharing =================
  const dlg = document.createElement("dialog");
  dlg.className = "sheet sh-sheet"; dlg.id = "shared-links"; dlg.setAttribute("aria-label", "Links you've shared");
  dlg.innerHTML = `<div class="sheet-head"><b>Links you've shared</b>${CLOSE_IC}</div>
    <ul class="sh-link-list" id="sh-link-list"></ul>
    <p class="muted small">Anyone with one of these links can see that workout, signed in or not. Stop sharing and the link stops working.</p>`;
  document.body.appendChild(dlg);
  $("[data-close]", dlg).addEventListener("click", () => dlg.close());

  function renderLinks() {
    $("#sh-link-list").innerHTML = shares.length ? shares.map((s) => `<li data-key="${esc(s.key)}">
      <div class="sh-txt"><b>${esc(s.title || (s.snapshot && s.snapshot.name) || "A workout")}</b><span>${esc(KINDS[s.kind] || "workout")}${s.createdAt && when(s.createdAt) ? ` · shared ${esc(when(s.createdAt))}` : ""}</span></div>
      <div class="sh-acts"><button type="button" class="btn-ghost sm" data-copy>${LINK_IC} Copy link</button>
        <button type="button" class="link-sm sh-stop" data-stop>Stop sharing</button></div></li>`).join("")
      : `<li class="muted small">You haven't shared anything yet.</li>`;
  }
  function openLinks() { renderLinks(); if (!dlg.open) dlg.showModal(); }

  dlg.addEventListener("click", async (e) => {
    const li = e.target.closest("[data-key]"); if (!li) return;
    const key = li.dataset.key, s = shares.find((x) => x.key === key); if (!s) return;
    if (e.target.closest("[data-copy]")) {
      const url = linkFor(key);
      if (navigator.share) { try { await navigator.share({ title: `MD Fit: ${s.title || "a workout"}`, url }); return; } catch (err) { if (err && err.name === "AbortError") return; } }
      try { await navigator.clipboard.writeText(url); A.toast("Link copied."); } catch { A.toast("Copy this link: " + url); }
      return;
    }
    const stop = e.target.closest("[data-stop]");
    if (stop) {
      if (!confirm(`Stop sharing "${s.title || "this workout"}"? The link will stop working.`)) return;
      stop.disabled = true;
      try {
        await apiAuth("DELETE", `/api/me/shares/${encodeURIComponent(key)}`);
        shares = shares.filter((x) => x.key !== key);
        renderLinks(); paint(); A.toast("Stopped sharing. That link no longer works.");
        if (!shares.length) dlg.close();
      } catch (err) { stop.disabled = false; A.toast(err.message); }
    }
  });

  // ================= Load =================
  async function loadShares() {
    try { const d = await apiAuth("GET", "/api/me/shares"); shares = Array.isArray(d.shares) ? d.shares : []; }
    catch { /* a miss is silent: the buttons simply offer to share again, which the server answers with the same key */ }
    paint();
  }
  async function loadMine() {
    try { const d = await apiAuth("GET", "/api/me/shared-with-me"); items = Array.isArray(d.items) ? d.items : []; }
    catch {}
    renderCard();
  }
  function reload() { loadShares(); loadMine(); }
  // Coming back to the app (or back from /shared, where a copy may just have been saved) picks up what changed.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reload(); });

  window.MDFitShare = { paint, reload };
  reload();
})();
