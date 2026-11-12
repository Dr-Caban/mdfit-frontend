// /chat: a private notes board for two people, the owner (Jared) and the developer.
//
// - A passcode wall comes first. The code is never in this file: whatever is typed goes to the server, which answers
//   with a token (kept on the device) or with the reason it said no.
// - "Who's on this device?" only decides whose name goes on what is written. Both people can do the same things.
// - Three kinds: a note (a small thread the other person can reply to and either can mark done), an objective (a line
//   on the shared checklist) and done (finished work, logged). Three lists: Notes, Objectives, Done.
// - A note stays shaded for whoever has not opened it since the last thing was written on it, and the person who
//   wrote that last thing is told when it has been seen.
// - /chat?n=<key> shows one shared entry, read-only, with no passcode. The board itself stays behind the wall.
// - The list is fetched again every 8 seconds while the tab is visible, on focus and after every write, without
//   disturbing a box someone is typing in or closing a thread they have open.
(() => {
  "use strict";
  const $ = (q) => document.querySelector(q);
  const API = ((window.MDFIT_CONFIG && window.MDFIT_CONFIG.apiUrl) || "").replace(/\/+$/, "");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NAME = { jared: "Jared", dev: "Developer" }, other = (w) => (w === "jared" ? "dev" : "jared");
  const name = (w) => NAME[w] || String(w || "Someone");
  const KINDS = { note: "Note", objective: "Objective", done: "Done" };
  const TAB = { note: "note", objective: "obj", done: "done" };
  const REFRESH_MS = 8000;

  const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V20H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-2.59a6 6 0 0 0 5-5.91Z"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
  const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const ARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>';
  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

  // ---- Dates, in the viewer's own locale
  const date = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d; };
  const fmt = (iso, how, opts) => { const d = date(iso); return d ? d[how]([], opts) : ""; };
  const fmtTime = (iso) => fmt(iso, "toLocaleTimeString", { hour: "numeric", minute: "2-digit" });
  const fmtDay = (iso) => fmt(iso, "toLocaleDateString", { weekday: "long", month: "long", day: "numeric" });
  const fmtShort = (iso) => fmt(iso, "toLocaleDateString", { month: "short", day: "numeric" });
  const stamp = (iso) => `${esc(fmtShort(iso))}, ${esc(fmtTime(iso))}`;
  const dayKey = (iso) => { const d = date(iso); return d ? d.toDateString() : ""; };
  const ms = (iso) => { const d = date(iso); return d ? d.getTime() : 0; };

  // ---- What the device remembers. Storage can be switched off (private mode, some web views): the page then
  // simply keeps things for as long as it stays open.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  const K_SESSION = "mdfit_board", K_WHO = "mdfit_board_who";
  let session = (() => {
    try { const s = JSON.parse(store.get(K_SESSION) || "null"); return s && typeof s.token === "string" && s.token && !(Date.parse(s.expiresAt) <= Date.now()) ? s : null; }
    catch { return null; }
  })();
  let me = (() => { const w = store.get(K_WHO); return NAME[w] ? w : null; })();

  // ---- State
  let items = [], loaded = false, loadError = "";
  let tab = "note", draftKind = "note", showArch = false, saving = false;
  const openNotes = new Set();      // threads the person has open: kept open across refreshes
  const drafts = new Map();         // reply text being typed, by note id: kept across re-renders
  const busy = new Set();           // ids with a write in flight: their buttons stay disabled
  const pendingSeen = new Map();    // notes just opened, until the server has confirmed it
  let gen = 0;                      // bumped around every write, so an older list fetched meanwhile is not shown
  let shownSig = null, dirty = false, pressing = false;

  // ---- Screens
  const SCREENS = ["wall", "whoami", "view", "app"];
  let screen = "";
  function show(id) { screen = id; SCREENS.forEach((s) => { $("#" + s).hidden = s !== id; }); }

  let toastT = 0;
  function toast(msg, sub) {
    const t = $("#toast"); t.innerHTML = esc(msg) + (sub ? `<small>${esc(sub)}</small>` : ""); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, sub && /^https?:/.test(sub) ? 12000 : 3600);
  }

  // ---- The server. Errors carry the server's own plain-English text.
  async function api(method, path, body, auth) {
    const headers = {}, sent = session;
    if (body) headers["Content-Type"] = "application/json";
    if (auth && sent) headers.Authorization = "Bearer " + sent.token;
    let r;
    try { r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }); }
    catch { const e = new Error("Couldn't reach the server. Check your connection and try again."); e.status = 0; throw e; }
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok) {
      const e = new Error((data && typeof data.error === "string" && data.error) || "Something went wrong. Please try again.");
      e.status = r.status;
      if (auth && r.status === 401) { e.expired = true; if (session === sent) expire(); }
      throw e;
    }
    return data || {};
  }
  const authed = (method, path, body) => api(method, path, body, true);
  const fail = (e) => { if (!e || !e.expired) toast((e && e.message) || "Something went wrong. Please try again."); };
  // The token ran out (or was never good): forget it and ask for the passcode again. Anything typed stays in place.
  function expire() {
    session = null; store.del(K_SESSION); stopMic();
    show("wall"); $("#wall-msg").textContent = "Please enter the passcode again."; $("#code").value = ""; $("#code").focus();
  }

  // ---- 1. The wall
  $("#wall-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = $("#code"), go = $("#wall-go"), msg = $("#wall-msg"), code = inp.value.trim();
    if (!code) { inp.focus(); return; }
    if (go.disabled) return;
    go.disabled = true; msg.textContent = "";
    try {
      const d = await api("POST", "/api/board/enter", { code }, false);
      if (!d.token) throw new Error("Something went wrong. Please try again.");
      session = { token: d.token, expiresAt: d.expiresAt };
      store.set(K_SESSION, JSON.stringify(session));
      inp.value = "";
      me ? enter() : show("whoami");
    } catch (err) { msg.textContent = err.message; inp.value = ""; inp.focus(); }
    finally { go.disabled = false; }
  });

  // ---- 2. Who you are
  document.querySelectorAll("[data-me]").forEach((b) => b.addEventListener("click", () => { me = b.dataset.me; store.set(K_WHO, me); enter(); }));
  $("#me-btn").addEventListener("click", () => { stopMic(); show("whoami"); });
  function enter() {
    show("app");
    $("#me-btn").textContent = "You: " + name(me) + " · change";
    composerText(); render(); load();
  }

  // ---- Composer: the same for both people. Talk or type, pick what it is, save. It is dated by the server.
  const PH = { note: () => `An idea, a question, or something you need from ${name(other(me))}`, objective: () => "Something we are working toward", done: () => "What got finished?" };
  const SAVE = { note: "Save note", objective: "Add objective", done: "Add to Done" };
  const syncSave = () => { $("#save").disabled = saving || !$("#body").value.trim(); };
  function composerText() {
    document.querySelectorAll("#composer [data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === draftKind)));
    $("#body").placeholder = PH[draftKind](); $("#save").textContent = SAVE[draftKind]; syncSave();
  }
  $("#body").addEventListener("input", syncSave);
  document.querySelectorAll("#composer [data-kind]").forEach((b) => b.addEventListener("click", () => { stopMic(); draftKind = b.dataset.kind; composerText(); }));
  $("#save").addEventListener("click", async () => {
    const ta = $("#body"), body = ta.value.trim(), kind = draftKind;
    if (!body || saving) return;
    stopMic(); saving = true; ta.readOnly = true; syncSave(); gen++;
    try {
      const d = await authed("POST", "/api/board", { who: me, kind, body });
      if (d.item) put(d.item);
      ta.value = ""; tab = TAB[kind];
    } catch (e) { fail(e); }   // the typed text stays where it is
    finally { saving = false; ta.readOnly = false; syncSave(); gen++; render(); load(); }
  });

  // ---- Dictation: the browser's own speech recognition. Where there is none (the phone apps' web views, Firefox),
  // the keyboard's microphone still works, and the page says so.
  let rec = null;
  function stopMic() { if (rec) { try { rec.stop(); } catch {} rec = null; } }
  (function wireMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $("#mic");
    mic.innerHTML = MIC;
    if (!SR) {
      $("#mic-title").textContent = "Use the microphone on your keyboard";
      $("#mic-sub").textContent = "This browser can't dictate here. Tap the box below, then the microphone key.";
      mic.disabled = true; mic.classList.add("none"); return;
    }
    mic.addEventListener("click", () => {
      if (rec) return stopMic();
      const ta = $("#body"), base = ta.value ? ta.value.replace(/\s*$/, " ") : "";
      const mine = rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
      rec.onresult = (e) => { let t = ""; for (const r of e.results) t += r[0].transcript; ta.value = base + t; ta.dispatchEvent(new Event("input")); };
      const off = () => {
        if (rec === mine) rec = null;
        mic.classList.remove("on"); mic.innerHTML = MIC; mic.setAttribute("aria-pressed", "false"); mic.setAttribute("aria-label", "Start dictating");
        $("#mic-title").textContent = "Tap the microphone and talk";
      };
      rec.onend = off;
      rec.onerror = (e) => { off(); if (e.error === "not-allowed" || e.error === "service-not-allowed") $("#mic-sub").textContent = "The microphone is blocked for this page. Allow it in the browser, or type instead."; };
      try { rec.start(); } catch { rec = null; return; }
      mic.classList.add("on"); mic.innerHTML = STOP; mic.setAttribute("aria-pressed", "true"); mic.setAttribute("aria-label", "Stop dictating");
      $("#mic-title").textContent = "Listening… tap to stop";
    });
  })();

  // ---- Keeping in step with the server
  const find = (id) => items.find((x) => String(x.id) === String(id));
  function put(item) { const n = items.findIndex((x) => String(x.id) === String(item.id)); if (n >= 0) items[n] = item; else items.unshift(item); }
  let loading = false, again = false;
  async function load() {
    if (!session || !me || screen !== "app") return;
    if (loading) { again = true; return; }
    loading = true; const g = gen;
    try {
      const d = await authed("GET", "/api/board?who=" + encodeURIComponent(me));
      if (g !== gen) again = true;                 // something was written while this was on its way: ask again
      else if (Array.isArray(d.items)) {
        // a note opened a moment ago stays opened, even if this list left the server before it heard
        items = d.items.map((i) => { const t = pendingSeen.get(String(i.id)); return t && !(i.seen && i.seen[me]) ? Object.assign({}, i, { seen: Object.assign({}, i.seen, { [me]: t }) }) : i; });
        const first = !loaded; loaded = true; loadError = "";
        if (first) render(); else refresh();
      }
    } catch (e) { if (!loaded && !e.expired) { loadError = e.message; render(); } }   // later misses are silent: the next try is seconds away
    finally { loading = false; if (again) { again = false; load(); } }
  }
  // A background refresh never touches the page while someone is typing a reply or has a finger down on a button,
  // and does nothing at all when nothing changed.
  let composing = false;
  function refresh() {
    if (screen !== "app") return;
    if (!dirty && JSON.stringify(items) === shownSig) return;
    if (pressing || composing) { dirty = true; return; }
    // A reply box with words in it and the cursor in it is left exactly as it is: the rest of the list is brought
    // up to date around it, and that one note catches up once the person leaves the box.
    const a = document.activeElement, mid = a && a.matches && a.matches("[data-reply-in]") && a.value ? a.dataset.replyIn : null;
    render(mid);
  }
  setInterval(() => { if (document.visibilityState === "visible") { if (dirty) refresh(); load(); } }, REFRESH_MS);
  window.addEventListener("focus", load);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  const list = $("#list");
  list.addEventListener("pointerdown", () => { pressing = true; });
  ["pointerup", "pointercancel"].forEach((ev) => window.addEventListener(ev, () => { setTimeout(() => { pressing = false; }, 0); }));
  list.addEventListener("compositionstart", () => { composing = true; });
  list.addEventListener("compositionend", () => { composing = false; });
  list.addEventListener("focusout", () => { setTimeout(() => { if (dirty) refresh(); }, 600); });

  // ---- Lists. Notes: open threads. Objectives: the shared checklist. Done: finished notes, ticked objectives, logged work.
  let blocks = null;   // what is on screen in the Notes / Done list, piece by piece, so only what changed is replaced
  function render(keepId) {
    shownSig = JSON.stringify(items); dirty = false;
    const live = items.filter((i) => showArch || !i.archived);
    const notes = live.filter((i) => i.kind === "note" && !i.doneAt), objs = items.filter((i) => i.kind === "objective");
    const done = live.filter((i) => i.kind === "done" || ((i.kind === "note" || i.kind === "objective") && i.doneAt));
    $("#c-note").textContent = loaded ? notes.length : ""; $("#c-done").textContent = loaded ? done.length : ""; $("#c-obj").textContent = loaded ? objs.filter((i) => !i.doneAt).length : "";
    document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    list.setAttribute("aria-labelledby", "t-" + tab);
    $("#arch-wrap").hidden = tab === "obj";
    if (!loaded) {
      $("#summary").textContent = "";
      blocks = null;
      list.innerHTML = loadError ? `<p class="empty">${esc(loadError)}<br><button type="button" class="btn ghost" data-retry>Try again</button></p>` : '<p class="empty">Loading…</p>';
      return;
    }
    // remember where the person is typing, so re-drawing the list does not lose their place
    const a = document.activeElement, focusId = a && a.matches && a.matches("[data-reply-in]") ? a.dataset.replyIn : null;
    const sel = focusId ? [a.selectionStart, a.selectionEnd] : null;
    if (tab === "obj") { blocks = null; renderObjectives(objs); } else renderItems(notes, done, keepId);
    list.querySelectorAll("[data-reply-in]").forEach((inp) => {
      inp.value = drafts.get(inp.dataset.replyIn) || "";
      if (inp.dataset.replyIn === focusId) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(sel[0], sel[1]); } catch {} }
    });
  }
  const replyHtml = (r) => `<div class="rep"><div class="meta"><b>${esc(name(r.by))}</b><span>${stamp(r.at)}</span></div><p>${esc(r.body)}</p></div>`;
  function renderItems(notes, done, keepId) {
    const when = (i) => (tab === "done" && i.doneAt) || i.at;
    const shown = (tab === "note" ? notes : done).slice().sort((x, y) => ms(when(y)) - ms(when(x)));
    const fresh = notes.filter((i) => !(i.seen && i.seen[me])).length;
    $("#summary").textContent = tab === "note" ? `${notes.length} open${fresh ? ` · ${fresh} new for you` : ""}` : `${done.length} finished`;
    if (!shown.length) { blocks = null; list.innerHTML = `<p class="empty">${tab === "note" ? "No open notes." : "Nothing finished yet."}</p>`; return; }
    const next = []; let day = null;
    for (const i of shown) {
      if (dayKey(when(i)) !== day) { day = dayKey(when(i)); next.push({ id: null, html: `<h3 class="day">${esc(fmtDay(when(i)))}</h3>` }); }
      const id = esc(i.id), isNote = i.kind === "note", o = other(me), reps = Array.isArray(i.replies) ? i.replies : [];
      const unseen = isNote && !i.doneAt && !(i.seen && i.seen[me]), isOpen = isNote && openNotes.has(String(i.id));
      const lastBy = reps.length ? reps[reps.length - 1].by : i.by, theirs = i.seen && i.seen[o];
      const off = busy.has(String(i.id)) ? " disabled" : "";
      const seenLine = !isNote || i.doneAt || lastBy !== me ? "" : theirs ? `<p class="seen yes">${EYE}Seen by ${esc(name(o))} · ${stamp(theirs)}</p>` : `<p class="seen">${EYE}${esc(name(o))} hasn't opened this yet</p>`;
      const acts = !isNote ? "" : i.doneAt ? `<button type="button" class="btn ghost" data-reopen="${id}"${off}>Reopen</button>` : `<button type="button" class="btn ghost" data-close="${id}"${off}>Mark done</button>`;
      const thread = !isNote ? "" : !isOpen ? `<button type="button" class="more" data-toggle aria-expanded="false">${reps.length ? `${reps.length} ${reps.length === 1 ? "reply" : "replies"} · tap to open` : "Tap to reply"}</button><div class="acts">${acts}</div>` : `<div class="thread">
          ${reps.map(replyHtml).join("")}
          <div class="replybox"><input type="text" data-reply-in="${id}" placeholder="Reply to this idea" aria-label="Reply" autocomplete="off"><button type="button" class="btn ghost" data-reply="${id}"${off}>Reply</button></div>
          <div class="acts">${acts}</div></div>`;
      const pill = i.doneAt ? `<span class="pill ok">Done ${esc(fmtShort(i.doneAt))}${i.doneBy ? " · " + esc(name(i.doneBy)) : ""}</span>` : "";
      next.push({ id: String(i.id), html: `<article class="item${i.doneAt ? " fin" : ""}${unseen ? " unseen" : ""}${i.archived ? " arch" : ""}" data-id="${id}"${isNote ? ` data-note="${id}"` : ""}>
        <div class="meta"><b>${esc(name(i.by))}</b>${unseen ? '<span class="newtag">New</span>' : ""}${i.archived ? '<span class="tag">Archived</span>' : ""}${tab === "done" ? `<span class="tag">${esc(KINDS[i.kind] || i.kind)}</span>` : ""}<span>${stamp(i.at)}</span>${pill}<button type="button" class="share" data-share="${id}" aria-label="Share a link to this entry" title="Share a link"${off}>${SHARE}</button><button type="button" class="share" data-arch="${id}" aria-label="${i.archived ? "Bring back from the archive" : "Archive"}" title="${i.archived ? "Bring back" : "Archive"}"${off}>${ARCH}</button></div>
        <p class="txt">${esc(i.body)}</p>
        ${seenLine}${thread}
      </article>` });
    }
    const old = blocks, same = old && old.length === next.length && list.children.length === next.length && next.every((b, n) => b.id === old[n].id);
    if (keepId && !same) { dirty = true; return; }   // the list changed shape under a half-written reply: wait until the person leaves the box
    if (same) next.forEach((b, n) => {
      if (b.html === old[n].html) return;
      if (keepId && b.id === keepId) { b.html = old[n].html; dirty = true; } else list.children[n].outerHTML = b.html;
    });
    else list.innerHTML = next.map((b) => b.html).join("");
    blocks = next;
  }
  // One shared checklist: either person adds a line, either ticks it, and the tick says who and when
  function renderObjectives(objs) {
    const n = objs.filter((i) => i.doneAt).length;
    $("#summary").textContent = `${n} of ${objs.length} done`;
    if (!objs.length) { list.innerHTML = '<p class="empty">No objectives yet. Add the first one above.</p>'; return; }
    const order = objs.slice().sort((a, b) => (!!a.doneAt - !!b.doneAt) || ms(a.at) - ms(b.at));
    list.innerHTML = `<div class="bar" role="img" aria-label="${n} of ${objs.length} objectives done"><i></i></div>` +
      order.map((i) => `<div class="obj${i.doneAt ? " fin" : ""}"><input type="checkbox" id="o-${esc(i.id)}" data-obj="${esc(i.id)}"${i.doneAt ? " checked" : ""}${busy.has(String(i.id)) ? " disabled" : ""}>
        <div><label for="o-${esc(i.id)}">${esc(i.body)}</label><small>Added by ${esc(name(i.by))}, ${esc(fmtShort(i.at))}${i.doneAt ? ` · checked by ${esc(name(i.doneBy))}, ${esc(fmtShort(i.doneAt))} ${esc(fmtTime(i.doneAt))}` : ""}</small></div></div>`).join("");
    list.querySelector(".bar i").style.width = Math.round(n / objs.length * 100) + "%";   // set from script, not an inline style attribute
  }

  // ---- Writes. One at a time per entry: its buttons are off while the request is out and come back if it fails.
  async function write(id, path, body, after) {
    id = String(id);
    if (busy.has(id)) return false;
    busy.add(id); gen++; render();
    let ok = false;
    try {
      const d = await authed("POST", `/api/board/${encodeURIComponent(id)}/${path}`, Object.assign({ who: me }, body));
      if (d.item) put(d.item);
      ok = true; if (after) after(d);
    } catch (e) { fail(e); }
    finally { busy.delete(id); gen++; render(); load(); }
    return ok;
  }
  function reply(id) {
    id = String(id);
    const body = (drafts.get(id) || "").trim();
    if (!body) { const inp = [...list.querySelectorAll("[data-reply-in]")].find((x) => x.dataset.replyIn === id); if (inp) inp.focus(); return; }
    write(id, "reply", { body }, () => { if ((drafts.get(id) || "").trim() === body) drafts.delete(id); });   // on failure the text stays in the box
  }
  // Opening a note you have not seen counts as seeing it: the shading goes at once, then the server's copy takes over
  function markSeen(i) {
    const id = String(i.id), now = new Date().toISOString();
    i.seen = Object.assign({}, i.seen, { [me]: now }); pendingSeen.set(id, now); gen++;
    authed("POST", `/api/board/${encodeURIComponent(id)}/seen`, { who: me })
      .then((d) => { if (d.item) put(d.item); }).catch(() => {})
      .then(() => { pendingSeen.delete(id); gen++; refresh(); });
  }
  const linkFor = (key) => location.origin + "/chat?n=" + encodeURIComponent(key);
  async function share(i) {
    const id = String(i.id);
    let key = i.shareKey;
    if (!key) {
      if (busy.has(id)) return;
      busy.add(id); render();
      try { key = (await authed("POST", `/api/board/${encodeURIComponent(id)}/share`, { who: me })).key; const cur = find(id); if (cur && key) cur.shareKey = key; }
      catch (e) { fail(e); }
      finally { busy.delete(id); render(); }
      if (!key) return;
    }
    const url = linkFor(key), title = `MD Fit ${i.kind}: ${String(i.body || "").slice(0, 60)}`;
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); toast("Link copied", "Anyone with this link can read this one entry."); }
    catch { toast("Copy this link", url); }
  }

  list.addEventListener("input", (e) => { if (e.target.matches("[data-reply-in]")) drafts.set(e.target.dataset.replyIn, e.target.value); });
  list.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-reply-in]")) { e.preventDefault(); reply(e.target.dataset.replyIn); } });
  list.addEventListener("change", (e) => {
    const o = e.target.closest("[data-obj]"); if (!o) return;
    write(o.dataset.obj, "done", { done: o.checked });   // a failed tick is put back by the re-draw
  });
  list.addEventListener("click", (e) => {
    const hit = (attr) => { const el = e.target.closest(`[${attr}]`); return el && !el.disabled ? el.getAttribute(attr) : null; };
    if (e.target.closest("[data-retry]")) { loadError = ""; render(); return load(); }
    let id;
    if ((id = hit("data-share")) != null) { const i = find(id); return i && share(i); }
    if ((id = hit("data-close")) != null) return write(id, "done", { done: true }, () => toast("Marked done", "It's in the Done list now."));
    if ((id = hit("data-reopen")) != null) return write(id, "done", { done: false }, () => { tab = "note"; });
    if ((id = hit("data-arch")) != null) {
      const i = find(id); if (!i) return;
      const to = !i.archived;
      return write(id, "archive", { archived: to }, () => toast(to ? "Archived" : "Brought back", to ? "Nothing is deleted. Tick Show archived to see it." : ""));
    }
    if ((id = hit("data-reply")) != null) return reply(id);
    const nt = e.target.closest("[data-note]");
    if (nt && (e.target.closest("[data-toggle]") || !e.target.closest("button, input, a, label, .thread"))) {
      if (!e.target.closest("[data-toggle]") && String(window.getSelection && window.getSelection()) !== "") return;   // selecting text is not a tap
      const i = find(nt.dataset.note); if (!i) return;
      const key = String(i.id), unseen = !i.doneAt && !(i.seen && i.seen[me]);
      // Tapping a note you have not seen always opens it and counts as seeing it; otherwise the tap opens or closes it
      if (unseen || !openNotes.has(key)) { openNotes.add(key); if (unseen) markSeen(i); } else openNotes.delete(key);
      render();
    }
  });
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
  $("#show-arch").addEventListener("change", (e) => { showArch = e.target.checked; render(); });

  // ---- 3. A shared link shows that one entry, read-only, without the passcode
  async function showView(key) {
    show("view");
    const box = $("#view-body"); box.innerHTML = '<p class="empty">Loading…</p>';
    try {
      const i = (await api("GET", "/api/board/shared/" + encodeURIComponent(key), null, false)).item;
      if (!i) throw Object.assign(new Error(""), { status: 404 });
      const reps = Array.isArray(i.replies) ? i.replies : [];
      box.innerHTML = `<article class="item">
        <div class="meta"><b>${esc(name(i.by))}</b><span class="tag">${esc(KINDS[i.kind] || i.kind)}</span><span>${esc(fmtDay(i.at))}, ${esc(fmtTime(i.at))}</span>${i.kind === "note" || i.kind === "objective" ? (i.doneAt ? `<span class="pill ok">Done ${esc(fmtShort(i.doneAt))}</span>` : '<span class="pill">Open</span>') : ""}</div>
        <p class="txt">${esc(i.body)}</p>
        ${reps.length ? `<div class="thread">${reps.map(replyHtml).join("")}</div>` : ""}</article>`;
    } catch (e) { box.innerHTML = `<p class="empty">${e.status === 404 ? "This link no longer works." : esc(e.message || "Something went wrong. Please try again.")}</p>`; }
  }

  // ---- Start
  const shared = new URLSearchParams(location.search).get("n");
  if (shared) showView(shared);
  else if (!session) { show("wall"); $("#code").focus(); }
  else if (!me) show("whoami");
  else enter();
})();
