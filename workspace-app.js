// MD Fit practice workspace. Signs in as the practice owner and reads and writes through the same /api/admin/*
// endpoints as /admin. Everything printed from the server goes through esc(); nothing clinical is kept in
// localStorage; sign-out and 15 idle minutes both empty the page.
(() => {
  "use strict";
  const API = window.MDFIT_CONFIG.apiUrl.replace(/\/+$/, "");
  const EXERCISES = window.MDFIT_EXERCISES || [];
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  const fmtDate = (d) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "—";
  const fmtTime = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const none = (t) => `<p class="muted" style="margin:0">${t}</p>`;
  const noneRow = (n, t) => `<tr><td colspan="${n}" class="muted">${t}</td></tr>`;
  const initials = (n) => String(n || "?").replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  const avatar = (name, size = 32) => `<span class="avatar" style="background:#8FA3B8;width:${size}px;height:${size}px">${esc(initials(name))}</span>`;
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const notYours = (what) => `<div class="card">${none(`${what} is not available for your role.`)}</div>`;
  const notBuilt = (what) => `<div class="card">${none(`${what} is not connected yet: the server has nothing for it.`)}</div>`;

  // ---------------------------------------------------------------- session
  const KEY = "mdfit_ws_token";
  const store = { get: () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } }, set: (t) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch {} } };
  let token = store.get();
  const state = { chartClient: null, chartTab: "overview", thread: null, calWeek: 0, clientQ: "", insTab: "analytics", cpTab: "checklist", insDays: 30, picked: new Set() };
  const cache = { clients: null, unread: 0, waiting: 0, me: null };

  // ---- What the screens have loaded is kept in this page's memory (never in browser storage), so a screen that has
  // been loaded before is drawn at once from what is already here, and is then checked against the server in the
  // background: if the server has something different, the screen is redrawn. Three rules keep that honest.
  // 1. Any change made from this page throws every copy away, so nothing older than your own last change is shown.
  // 2. An answer that was asked for before a change, or before a different sign-in, is not kept.
  // 3. Signing out, or 15 idle minutes, empties it with the rest of the page.
  const mem = new Map(), flying = new Map(), FRESH_MS = 20000;
  let epoch = 0, pending = 0, shownBusy = 0, netT = 0;
  const forget = () => { epoch++; flying.clear(); };
  // A thin line at the top of the page whenever the server is being asked for something that takes a moment
  function netBar(d) {
    shownBusy = Math.max(0, shownBusy + d); const b = $("#netbar"); if (!b) return;
    if (shownBusy) { if (!netT) netT = setTimeout(() => b.classList.add("on"), 180); } else { clearTimeout(netT); netT = 0; b.classList.remove("on"); }
  }
  async function api(method, path, body) {
    const write = method !== "GET" && path !== "/api/admin/login";
    if (write) forget();
    // the line at the top is for work the person is waiting on: a screen on its way, or a change being saved.
    // Loading ahead and checking in the background stay out of sight.
    const seen = method !== "GET" || seq !== done;
    pending++; if (seen) netBar(1);
    try {
      const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token, "X-Idle-Seconds": String(Math.round(idleFor() / 1000)) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.status === 401 && path !== "/api/admin/login") { signOut(); throw new Error("Session expired. Sign in again."); }
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
      if (!res.ok) { const err = new Error((data && data.error) || "Request failed."); if (data && data.need) err.need = data.need; throw err; }
      return data;
    } finally { pending = Math.max(0, pending - 1); if (seen) netBar(-1); if (write) { forget(); rewarm(method, path); } }
  }
  // get: always asks the server (what the buttons use). load: what the screens use, described above.
  const get = (p) => { const at = epoch, tk = token; return api("GET", "/api/admin" + p).then((data) => { if (at === epoch && tk === token) mem.set(p, { raw: JSON.stringify(data), at: Date.now(), epoch: at }); return data; }); };
  function pull(p) {
    const f = flying.get(p); if (f) return f;
    const at = epoch, tk = token;
    const run = api("GET", "/api/admin" + p).then((data) => {
      const raw = JSON.stringify(data);
      if (at === epoch && tk === token) { const was = mem.get(p); mem.set(p, { raw, at: Date.now(), epoch: at }); if (was && was.raw !== raw) changed(); }
      return raw;
    }).finally(() => { if (flying.get(p) === run) flying.delete(p); });
    flying.set(p, run); return run;
  }
  // For the slow part of a screen that the rest does not depend on (reading Google Calendar can take seconds): what
  // is in memory if it is there; otherwise undefined at once, and the screen is redrawn when the answer arrives.
  // null means it was asked and could not be read.
  const soft = (p) => {
    const e = mem.get(p);
    if (e && e.epoch === epoch) { if (Date.now() - e.at > FRESH_MS) pull(p).catch(() => {}); return JSON.parse(e.raw); }
    const at = epoch;
    pull(p).then(() => changed(), () => { if (at === epoch) { mem.set(p, { raw: "null", at: Date.now(), epoch: at }); changed(); } });
    return undefined;
  };
  let lagSaid = 0;
  async function load(p) {
    const e = mem.get(p);
    if (e && e.epoch === epoch) {
      // every reader gets its own copy, so one screen cannot alter what the next one is given
      if (Date.now() - e.at > FRESH_MS) pull(p).catch(() => { if (token && !warming && Date.now() - lagSaid > 30000) { lagSaid = Date.now(); toast(`Couldn't check for anything newer. Showing what was loaded at ${new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`); } });
      return JSON.parse(e.raw);
    }
    return JSON.parse(await pull(p));
  }

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600); }
  function modal(html) { $("#modal").classList.remove("wide"); $("#modal").innerHTML = html; $("#modalBack").classList.add("open"); $("#modal").querySelector("button,input,select,textarea")?.focus(); }
  function closeModal() { $("#modalBack").classList.remove("open"); $("#modal").innerHTML = ""; $("#modal").classList.remove("wide"); }
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

  // Signing out empties everything that was drawn, so names and notes do not stay on a shared screen.
  function signOut() {
    if (token) { try { fetch(API + "/api/admin/logout", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: "{}" }).catch(() => {}); } catch {} } // the session ends on the server too
    token = ""; store.set(""); if (window.MDFitRT) { if (teleIn()) MDFitRT.emit("tele_end"); MDFitRT.disconnect(); } teleDrop(); stopDictation();
    for (const k of Object.keys(cache)) cache[k] = (k === "unread" || k === "waiting") ? 0 : null; // every cached list, the open chart included
    mem.clear(); forget(); freshAsk = null; shown = ""; shownHtml = ""; visited.length = 0; clearTimeout(warmT); clearTimeout(repaintT); warmRun++;
    qaClose(); gClose(); try { impReset(); } catch {} state.picked.clear(); state.igPeople = []; state.insList = ""; state.ecoOpen = ""; state.genAll = false; state.layDraft = null;
    state.guideAiErr = ""; state.chartClient = null; state.thread = null; state.clientQ = ""; state.formsQ = ""; state.formsShow = ""; state.scribeText = ""; tele.transcript = ""; noteReset(null);
    mustChange = false; $("#qa").hidden = false; $("#globalSearch").disabled = false;
    $("#view").innerHTML = ""; $("#nav").innerHTML = ""; $("#nav").dataset.sig = ""; $("#whoami").textContent = ""; $("#globalSearch").value = ""; closeModal();
    $("#app").hidden = true; $("#signin").hidden = false; clearTimeout(idleTimer);
    // /admin shares this tab: signing out here signs out there as well
    try { for (const k of ["mdfit_token", "mdfit_manager", "mdfit_dev", ACTIVE_KEY]) sessionStorage.removeItem(k); } catch {}
  }
  // A new sign-in for the same person (the server gives one when they change their own password, and refuses the
  // old one from then on) takes the old one's place everywhere this tab keeps it: here, for /admin-classic and in the
  // copies the consoles hold. The live connection signs in again with it.
  function carryToken(t, expiresAt) {
    token = t; store.set(t);
    try {
      if (sessionStorage.getItem("mdfit_token")) sessionStorage.setItem("mdfit_token", t);
      for (const k of ["mdfit_manager", "mdfit_dev"]) if (sessionStorage.getItem(k)) sessionStorage.setItem(k, JSON.stringify({ token: t, expiresAt: expiresAt || new Date(Date.now() + 11 * 3600e3).toISOString() }));
    } catch {}
    if (window.MDFitRT) { MDFitRT.disconnect(); goLive(); }
  }
  // The time of the last input is kept in the tab's session storage and shared with /admin, so the 15 minutes
  // follow the person across both pages and are not restarted by a reload, Back, or a sleeping laptop.
  let idleTimer, lastStamp = 0;
  const IDLE_MS = 15 * 60 * 1000, ACTIVE_KEY = "mdfit_staff_active";
  const idleStamp = () => { lastStamp = Date.now(); try { sessionStorage.setItem(ACTIVE_KEY, String(lastStamp)); } catch {} };
  const idleFor = () => { try { const t = Number(sessionStorage.getItem(ACTIVE_KEY)); return t ? Date.now() - t : 0; } catch { return 0; } };
  const idleOut = () => { signOut(); $("#siMsg").textContent = "Signed out after 15 minutes without activity."; };
  function idleArm() { clearTimeout(idleTimer); if (token) idleTimer = setTimeout(() => (idleFor() >= IDLE_MS ? idleOut() : idleArm()), Math.max(1000, IDLE_MS - idleFor())); }
  function idleBump() { if (!token) return; if (Date.now() - lastStamp > 5000) idleStamp(); idleArm(); }
  const idleCheck = () => { if (token && (!store.get() || idleFor() >= IDLE_MS)) idleOut(); };
  ["pointerdown", "keydown", "scroll"].forEach((ev) => window.addEventListener(ev, idleBump, { passive: true, capture: true }));
  // The server ends a session that goes 15 minutes without a request. Someone reading a chart or on a video visit is
  // working without making one, so while there has been input in the last few minutes the page says so.
  setInterval(() => { if (token && idleFor() < 4 * 60 * 1000) fetch(API + "/api/admin/me", { headers: { Authorization: "Bearer " + token, "X-Idle-Seconds": String(Math.round(idleFor() / 1000)) } }).then((r) => { if (r.status === 401 && token) idleOut(); }).catch(() => {}); }, 4 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) idleCheck(); });
  window.addEventListener("pageshow", idleCheck); window.addEventListener("focus", idleCheck);

  // Sign in with Google (owner and staff). Google proves the address; the emailed code still applies when it's on.
  let gCred = "";
  async function googleIn(code) {
    const msg = $("#siMsg"), f = $("#signinForm");
    try {
      const out = await api("POST", "/api/admin/login/google", { credential: gCred, ...(code ? { code } : {}) });
      gCred = ""; token = out.token; store.set(token); idleStamp();
      try { sessionStorage.setItem("mdfit_token", token); } catch {}
      f.reset(); $("#siCodeRow").hidden = true; msg.textContent = ""; start();
    } catch (err) {
      if (/code/i.test(err.message)) { $("#siCodeRow").hidden = false; f.code.focus(); } else gCred = "";
      msg.textContent = err.message;
    }
  }
  fetch(API + "/api/app/config").then((r) => r.json()).then((c) => {
    if (!c || !c.googleClientId) return;
    const sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client"; sc.async = true;
    sc.onload = () => {
      google.accounts.id.initialize({ client_id: c.googleClientId, callback: (resp) => { gCred = resp.credential; googleIn(""); } });
      $("#siGoogleWrap").hidden = false;
      google.accounts.id.renderButton($("#siGoogle"), { theme: "outline", size: "large", width: 300, text: "signin_with" });
    };
    document.head.appendChild(sc);
  }).catch(() => {});

  $("#signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#siMsg"); msg.textContent = "";
    if (gCred && !f.password.value && f.code.value.trim()) return googleIn(f.code.value.trim()); // finishing a Google sign-in with the emailed code
    try {
      const body = { email: f.email.value.trim(), password: f.password.value }; if (f.code.value.trim()) body.code = f.code.value.trim();
      const out = await api("POST", "/api/admin/login", body);
      token = out.token; store.set(token); idleStamp();
      // the earlier admin (/admin-classic) opens signed in from this tab
      try { sessionStorage.setItem("mdfit_token", token); } catch {}
      f.reset(); $("#siCodeRow").hidden = true; start();
    } catch (err) {
      if (/code/i.test(err.message)) { $("#siCodeRow").hidden = false; f.code.focus(); }
      msg.textContent = err.message;
    }
  });
  $("#signOut").addEventListener("click", signOut);

  // ---------------------------------------------------------------- navigation
  // Small line icons for buttons and labels. SVG only: no emoji or text glyphs anywhere in the workspace.
  const UI = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
    spark: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>', next: '<path d="M9 5l7 7-7 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z" fill="currentColor"/>',
    camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    phoneOff: '<path d="M4 15c5-5 11-5 16 0l-2.5 2.5-3-1.5v-2.5a8 8 0 0 0-5 0V16l-3 1.5z" fill="currentColor"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    broadcast: '<path d="M3 10v4h3l6 4V6l-6 4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
    board: '<path d="M3 4h18v12H3zM12 16v4M8 20h8"/><path d="M7 12l3-3 2 2 4-4"/>',
    blur: '<circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="3"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    carry: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v5h5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.300-5.600"/><path d="M20 4v4h-4"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 4.3-1"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
  };
  const ui = (name, size = 16) => `<svg class="ui-ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name]}</svg>`;
  const ICON = {
    dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clients: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 20c0-3-2-5-5-5"/>',
    chart: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    leads: '<path d="M4 4h16v12H7l-3 3z"/><path d="M8 9h8M8 12h5"/>',
    notes: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    messages: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    telehealth: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-4v12l-6-4"/>',
    forms: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    programs: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    nutrition: '<path d="M12 21c-5 0-8-4-8-9 0-4 3-6 6-6 1 0 2 .5 2 .5s1-.5 2-.5c3 0 6 2 6 6 0 5-3 9-8 9z"/><path d="M12 6c0-2 1-3 3-4"/>',
    fitness: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
    payments: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    affiliates: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="17" r="3"/><path d="M10.5 10.5l4 4M17 3v6M14 6h6"/>',
    revshare: '<path d="M12 3v18"/><path d="M12 12 4.5 7.5M12 12l7.5-4.5"/><circle cx="12" cy="12" r="9"/>',
    newsletter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    insights: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    team: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    feedback: '<path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.8 6.5 19.5l1-6.3L3 8.9 9 8z"/>',
    security: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    compliance: '<path d="M9 5h6a1 1 0 0 1 1 1v1H8V6a1 1 0 0 1 1-1z"/><path d="M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2"/><path d="M9 14l2 2 4-4"/>',
    import: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    portal: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    economics: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.700 0-3 .8-3 2s1.300 1.800 3 2 3 .8 3 2-1.300 2-3 2c-1.400 0-2.500-.5-3-1.500M12 6v2M12 16v2"/>',
    booking: '<path d="M3 9h18M7 3v4M17 3v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="m9 15 2 2 4-4"/>',
    guide: '<path d="M7 18.500a4.500 4.500 0 0 1-.700-8.950A6 6 0 0 1 17.900 10.600 4 4 0 0 1 17.500 18.500z"/><path d="M9 14.500h.01M12 14.500h.01M15 14.500h.01"/>'
  };
  // The one permission this file knows by name: patient records, marked out wherever it appears.
  const PHI = "charts";
  // ---- What the signed-in person may do. The server decides; this only keeps the page from offering what it
  // would refuse. Until /me has answered, nothing is hidden (the server is still the boundary).
  const myPerms = () => new Set(((cache.me && cache.me.permissions) || []));
  const iAmOwner = () => !!(cache.me && cache.me.isOwner);
  // An older API (or one rolled back) answers /me without `permissions` at all. That is not "no permissions", it is
  // "this server doesn't do permissions": hide nothing, exactly as before this screen existed. The server is the
  // boundary either way, so the worst case is a menu entry that answers 403 -- never a workspace with no menu.
  const knowsPerms = () => Array.isArray(cache.me && cache.me.permissions);
  const can = (key) => !key || !knowsPerms() || iAmOwner() || myPerms().has(key);
  // One part of a screen. A part this sign-in may not read is not asked for and comes back as null, so the screen is
  // drawn from the parts it may read instead of failing as a whole (a refusal that was not foreseen counts the same).
  const refused = (err) => { if (err && err.need) return null; throw err; };
  const part = (p, key) => (can(key) ? load(p).catch(refused) : Promise.resolve(null));
  const partClients = () => (can("clients") ? clients().catch(refused) : Promise.resolve(null));
  // Which permission each screen in the menu belongs to. Empty means everyone who can sign in sees it.
  // Where a screen could belong to more than one, the stricter one is used: a screen that puts a patient's record
  // on the glass (the chart, notes, intake forms, a video visit) sits behind patient-record access.
  // A screen that cannot be drawn without a second permission lists both, and "owner" is the owner alone: the menu
  // only ever shows a screen this sign-in can load (the server's map is lib/staff.js ROUTE_PERMISSIONS).
  const NAV_PERM = {
    dashboard: "", calendar: "scheduling", clients: "clients", chart: [PHI, "clients"], leads: "clients", messages: "messages",
    telehealth: [PHI, "scheduling"], notes: [PHI, "clients"], forms: [PHI, "clients"], programs: "content", nutrition: "content", fitness: "content",
    payments: "billing", affiliates: "payouts", revshare: "owner", newsletter: "messages", team: "staff", feedback: "reviews", security: "security", compliance: "security", import: "owner",
    settings: "settings", insights: "insights", economics: ["insights", "billing"], guide: ["insights", "content"], portal: "", booking: "scheduling"
  };
  const navOk = (id) => [].concat(NAV_PERM[id]).every(can);
  const navSig = () => (cache.me ? `${iAmOwner()}|${[...myPerms()].sort().join(",")}` : "unknown");
  const navLabel = (id) => { for (const g of NAV) for (const [k, l] of g.items) if (k === id) return l; return id; };
  const NAV = [
    { g: "Practice", items: [["dashboard", "Dashboard"], ["calendar", "Calendar"], ["clients", "Clients"], ["chart", "Client chart"], ["leads", "Leads"], ["messages", "Messages"], ["telehealth", "Telehealth"]] },
    { g: "Clinical", items: [["notes", "Notes & AI scribe"], ["forms", "Forms & intake"], ["programs", "Programs"], ["nutrition", "Nutrition"], ["fitness", "Fitness"]] },
    { g: "Business", items: [["payments", "Payments"], ["affiliates", "Affiliates"], ["revshare", "Revenue share"], ["newsletter", "Newsletter"]] },
    { g: "Admin", items: [["team", "Team & roles"], ["feedback", "Reviews & feedback"], ["security", "Security & audit"], ["compliance", "Compliance"], ["import", "Import records"], ["settings", "Modules & settings"], ["insights", "Insights"], ["economics", "System economics"], ["guide", "Solomon"]] },
    { g: "Client-facing", items: [["portal", "Client app"], ["booking", "Booking page"]] }
  ];
  function renderNav(active) {
    const nav = $("#nav"), count = (id) => (id === "messages" ? cache.unread : id === "clients" ? cache.waiting : 0) || 0;
    // The menu is built once, and again if who is signed in (or what they may do) has changed.
    if (!nav.querySelector(".brand") || nav.dataset.sig !== navSig()) {
      nav.dataset.sig = navSig();
      nav.innerHTML = `<div class="brand"><div class="logo"><img src="assets/logo.webp" alt="" width="160" height="160"></div><div><b>MD Fit</b><div class="muted" style="font-size:12px">Physical Rehab &amp; Fitness</div></div></div>` +
        NAV.map((g) => { const items = g.items.filter(([id]) => navOk(id)); return items.length ? `<div class="nav-group"><span>${g.g}</span>${items.map(([id, label]) => `<a href="#${id}" data-nav="${id}"><svg viewBox="0 0 24 24">${ICON[id]}</svg>${label}</a>`).join("")}</div>` : ""; }).join("") +
        (can("settings") ? `<div class="nav-group"><a href="/admin-classic" class="muted" style="font-size:12.5px">Earlier admin screens</a></div>` : "");
    }
    for (const a of nav.querySelectorAll("a[data-nav]")) {
      const id = a.dataset.nav, n = count(id); let b = a.querySelector(".badge");
      if (active !== undefined) a.classList.toggle("active", id === active); // a screen loading in the background only updates the counts
      if (n && !b) { b = document.createElement("span"); b.className = "badge"; a.appendChild(b); }
      if (b) { if (n) { if (b.textContent !== String(n)) b.textContent = n; } else b.remove(); }
    }
  }
  async function clients(fresh) { return (cache.clients = await (fresh ? get : load)("/clients")); }
  // For a search box: the list in memory, unless it holds no match, in which case the server is asked once (someone
  // who signed up a minute ago is found without a refresh).
  let askedFresh = 0, freshAsk = null;
  // When the list in memory is being checked against the server at that moment, the box is asked again once the
  // answer is in, so the results on screen are never left a step behind.
  async function clientsHit(has, box) {
    let list = await clients();
    // (two searches at once share the one question to the server, so a slower stale answer can never land on top)
    if (!has(list)) { if (!freshAsk || Date.now() - askedFresh > 8000) { askedFresh = Date.now(); freshAsk = clients(true); } list = await freshAsk.catch(() => list); }
    // someone searching wants the newest list: if the copy is more than a few seconds old it is checked now
    const held = mem.get("/clients"); if (held && held.epoch === epoch && Date.now() - held.at > 4000 && !flying.get("/clients")) pull("/clients").catch(() => {});
    const f = flying.get("/clients");
    if (f && box && !box._again) { box._again = true; const done = () => { box._again = false; }; f.then(() => { done(); if (box.isConnected && box.value.trim()) box.dispatchEvent(new Event("input", { bubbles: true })); }, done); }
    return list;
  }
  const byEmail = (list, email) => list.find((c) => c.email && email && c.email.toLowerCase() === String(email).toLowerCase());
  function openChart(id) { state.chartClient = id; state.chartTab = "overview"; if (location.hash === "#chart") render(); else location.hash = "chart"; }

  // ---------------------------------------------------------------- screens
  const V = {};
  const kpi = (label, val, sub, kind) => `<div class="card kpi"><span class="muted">${label}</span><b class="num">${val}</b><small class="${kind ? "pill " + kind : "muted"}">${sub}</small></div>`;
  // A visit someone paid for after the time they were holding had gone to someone else. The server keeps the payment
  // as a visit credit and marks the visit cancelled with slotLost, so it needs a new time. It stops being listed once
  // that person has a visit booked after it.
  const paidNoTime = (list) => (list || []).filter((a) => a.slotLost && a.payment === "paid" && !list.some((b) => b.id !== a.id && b.email === a.email && b.status !== "cancelled" && b.status !== "hold" && (b.createdAt || "") > (a.updatedAt || a.createdAt || "")));
  const LOST = "Paid, time was taken: reschedule";
  const lostPill = () => `<span class="pill warn" style="display:inline-flex;align-items:center;gap:4px">${ui("alert", 12)}${LOST}</span>`;
  const lostRow = (a, list) => { const c = byEmail(list || [], a.email);
    return `<div class="list-item" data-lost="${esc(a.id)}"><span style="color:var(--warn);display:inline-flex">${ui("alert", 16)}</span><span style="flex:1;min-width:0"><b>${LOST}</b><div class="muted" style="font-size:12px">${esc(a.name)} paid for ${esc(a.typeName || "a visit")} on ${fmtDate(a.date)} at ${fmtTime(a.time)}. The payment is kept as a visit credit.</div></span><button class="btn sm" data-act="appt" data-id="${esc(a.id)}">Details</button>${c && navOk("chart") ? `<button class="btn sm primary" data-act="chart" data-id="${esc(c.id)}">Chart</button>` : ""}</div>`; };
  const statusPill = (s) => `<span class="pill ${s === "completed" ? "ok" : s === "cancelled" || s === "no-show" ? "bad" : ""}">${esc(s || "booked")}</span>`;
  function apptRow(a, list) {
    const c = byEmail(list, a.email);
    return `<div class="list-item"><span class="num muted" style="width:150px">${fmtDate(a.date)} · ${fmtTime(a.time)}</span><span class="dot" style="background:var(--body)"></span>
      <div style="flex:1;min-width:0"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.typeName || a.typeId)} · ${a.minutes || "—"} min</div></div>
      ${statusPill(a.status)}<button class="btn sm" data-act="appt" data-id="${esc(a.id)}">Details</button>${c ? `<button class="btn sm" data-act="chart" data-id="${esc(c.id)}">Chart</button>` : ""}</div>`;
  }

  V.dashboard = async () => {
    const todayIso = isoDay(new Date()), weekEnd = isoDay(new Date(Date.now() + 6 * 864e5));
    const [st0, msgs, emr, list0, diaryAll] = await Promise.all([part("/stats", "insights"), part("/messages", "messages"), part("/emr", PHI), partClients(), part("/appointments?all=1", "scheduling")]);
    // Without the practice's numbers (Insights), whoever keeps the diary still gets their day from the diary itself
    const diary = st0 ? null : diaryAll;
    const live = (diary || []).filter((a) => a.status === "booked" && a.date >= todayIso).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    const st = st0 || { appointmentsToday: live.filter((a) => a.date === todayIso).length, appointmentsWeek: live.filter((a) => a.date <= weekEnd).length, today: live.filter((a) => a.date === todayIso), nextAppointments: live.slice(0, 8) };
    const list = list0 || [], diaryOk = !!(st0 || diary) || can("scheduling");
    const sync = can("scheduling") ? soft(`/busy?from=${todayIso}&days=7`) : null; // the screen does not wait for Google
    // Your day is what is on your calendar, not only what was booked through MD Fit: the events on the connected
    // calendars are counted and listed here too (MD Fit's own bookings are not counted twice).
    const outside = ((sync && sync.busy) || []).filter((b) => !b.allDay).sort((a, b) => (a.date + String(a.start).padStart(5, "0") < b.date + String(b.start).padStart(5, "0") ? -1 : 1));
    const outToday = outside.filter((b) => b.date === todayIso), outLater = outside.filter((b) => b.date > todayIso);
    const clock = (min) => fmtTime(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
    const outRow = (b, day) => `<div class="list-item"><span class="muted num" style="flex:0 0 ${day ? 150 : 84}px;font-size:12.5px">${day ? fmtDate(b.date) + " · " : ""}${clock(b.start)}</span><span style="flex:1;min-width:0"><b>${esc(b.title || "Busy")}</b><div class="muted" style="font-size:12px">until ${clock(b.end)} · ${b.source === "simplepractice" ? "SimplePractice" : "Google Calendar"}</div></span></div>`;
    const nToday = st.appointmentsToday + outToday.length, nWeek = st.appointmentsWeek + outside.length;
    cache.unread = (msgs && msgs.unread) || 0; cache.waiting = emr ? emr.waiting.length : 0; renderNav();
    const h = new Date().getHours(), hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const paidWaiting = emr ? emr.patients.concat(emr.waiting).reduce((n, p) => n + (p.paidVisits || 0), 0) : 0;
    const attention = [
      emr && emr.waiting.length ? [`${plural(emr.waiting.length, "member")} finished documents and can be made a patient`, "clients"] : null,
      st.leadsNew ? [`${plural(st.leadsNew, "new request")} from the website`, "leads"] : null,
      cache.unread ? [`${plural(cache.unread, "unread message")}`, "messages"] : null,
      paidWaiting ? [`${plural(paidWaiting, "paid video visit")} still need a time`, "clients"] : null
    ].filter(Boolean);
    return `
    <div class="view-head"><div><h1>${hello}</h1><p class="muted">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${diaryOk ? ` · ${nToday} on your calendar today` : ""}</p></div>
    <div class="row">${navOk("calendar") ? `<a class="btn" href="#calendar">Open calendar</a>` : ""}${navOk("clients") ? `<a class="btn primary" href="#clients">Clients</a>` : ""}</div></div>
    <div class="grid g4" style="margin-bottom:16px">
      ${diaryOk ? kpi("Today", nToday, sync ? `${st.appointmentsToday} booked here · ${outToday.length} on your calendar` : sync === undefined ? "booked here · reading your calendar…" : can("scheduling") ? "booked here (your other calendar could not be read)" : "booked here") + kpi("Next 7 days", nWeek, sync ? `${st.appointmentsWeek} booked here · ${outside.length} on your calendar` : "booked here") : ""}
      ${st0 ? kpi("New requests", st.leadsNew, `${st.leads30d} in the last 30 days`, st.leadsNew ? "warn" : "") : ""}${msgs ? kpi("Unread messages", cache.unread, "from members", cache.unread ? "warn" : "") : ""}
    </div>
    <div class="grid g-side">
      <div class="stack">${!diaryOk ? notYours("Your schedule") : `
        <div class="card"><div class="card-head"><h2>Today's schedule</h2><span class="muted" style="font-size:12px">${nToday ? plural(nToday, "item") : ""}</span></div>${(st.today || []).map((a) => apptRow(a, list)).join("") + outToday.map((b) => outRow(b, false)).join("") || none("Nothing on your calendar today.")}</div>
        <div class="card"><div class="card-head"><h2>Coming up</h2><span class="muted" style="font-size:12px">Next 7 days</span></div>${(st.nextAppointments || []).map((a) => apptRow(a, list)).join("") + outLater.slice(0, 12).map((b) => outRow(b, true)).join("") || none("Nothing in the next week.")}${outLater.length > 12 ? `<p class="muted" style="margin:8px 0 0;font-size:12.5px">${outLater.length - 12} more on the <a href="#calendar">calendar</a>.</p>` : ""}</div>`}
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Needs attention</h2></div>
          ${paidNoTime(diaryAll).map((a) => lostRow(a, list)).join("") + attention.map(([t, to]) => `<div class="list-item"><span class="dot" style="background:var(--warn)"></span><span style="flex:1">${t}</span>${navOk(to) ? `<a class="btn sm" href="#${to}">Open</a>` : ""}</div>`).join("") || none("Nothing needs attention.")}</div>${!st0 ? "" : `
        <div class="card"><div class="card-head"><h2>Classes this week</h2></div>
          ${(st.upcoming || []).map((c) => `<div class="list-item"><span style="flex:1"><b>${esc(c.title)}</b><div class="muted" style="font-size:12px">${esc(c.dayName)} ${fmtTime(c.time)} · ${esc(c.coach || "")}</div></span><span class="pill">${c.capacity - c.spotsLeft}/${c.capacity} booked</span></div>`).join("") || none("No classes scheduled.")}</div>`}
      </div>
    </div>`;
  };

  // Week grid, Monday to Sunday, 6 AM to 8 PM. 56px per hour.
  V.calendar = async () => {
    const now = new Date(), mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + state.calWeek * 7);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
    // The practice's other calendars (SimplePractice, Google Calendar) for the week on screen, drawn behind MD Fit's
    // own visits. Google events carry their titles (shown here only, never stored); anything else is a "Busy" block.
    const [appts, classes, bookings, sync] = await Promise.all([load("/appointments?all=1"), load("/classes"), load("/bookings"),
      Promise.resolve(soft(`/busy?from=${isoDay(mon)}&days=7`))]);
    cache.appts = appts; cache.classes = classes;
    const lost = paidNoTime(appts);
    const busy = (sync && sync.busy) || [], srcName = (x) => (x === "simplepractice" ? "SimplePractice" : "Google Calendar");
    const START = 6, END = 20, top = (t) => { const [h, m] = t.split(":").map(Number); return (h + m / 60 - START) * 56; };
    const hhmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
    const cols = days.map((d) => {
      const key = isoDay(d), dow = d.getDay();
      const ev = appts.filter((a) => a.date === key && a.status !== "cancelled").map((a) => `<div class="appt" style="--c:var(--${a.status === "completed" ? "ok" : "body"});top:${top(a.time) + 2}px;height:${Math.max(26, (a.minutes || 60) / 60 * 56 - 4)}px" data-act="appt" data-id="${esc(a.id)}"><b>${esc(a.name)}</b>${fmtTime(a.time)} · ${esc(a.typeName || "")}</div>`);
      const cl = classes.filter((c) => c.active !== false && c.day === dow).map((c) => `<div class="appt" style="--c:var(--fit);top:${top(c.time) + 2}px;height:${Math.max(26, (c.durationMin || 60) / 60 * 56 - 4)}px;opacity:.85"><b>${esc(c.title)}</b>${fmtTime(c.time)} · class</div>`);
      const bz = busy.filter((b) => b.date === key && !b.allDay).map((b) => {
        const s = Math.max(b.start, START * 60), e = Math.min(b.end, END * 60); if (e <= s) return "";
        return `<div class="appt busy" style="top:${(s / 60 - START) * 56 + 2}px;height:${Math.max(20, (e - s) / 60 * 56 - 4)}px" title="${esc(b.title || "Busy")} · ${srcName(b.source)}, ${fmtTime(hhmm(b.start))} to ${fmtTime(hhmm(b.end))}"><b>${esc(b.title || "Busy")}</b>${fmtTime(hhmm(b.start))} to ${fmtTime(hhmm(b.end))} · ${srcName(b.source)}</div>`;
      });
      return `<div class="cal-col" style="grid-row:2">${bz.concat(ev, cl).join("")}</div>`;
    }).join("");
    const today = isoDay(now);
    return `
    <div class="view-head"><div><h1>Calendar</h1><p class="muted">Week of ${mon.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</p></div>
    <div class="row"><button class="btn sm" data-act="calWeek" data-d="-1" aria-label="Previous week">${ui("prev", 14)}</button><button class="btn sm" data-act="calWeek" data-d="0">Today</button><button class="btn sm" data-act="calWeek" data-d="1" aria-label="Next week">${ui("next", 14)}</button>
    <button type="button" class="btn sm primary" data-act="calAdd" aria-label="Add an event to your calendar">${ui("plus", 14)} Add</button></div></div>
    <div class="row" style="margin-bottom:12px"><span class="pill"><span class="dot" style="background:var(--body)"></span>Booked</span><span class="pill"><span class="dot" style="background:var(--ok)"></span>Completed</span><span class="pill"><span class="dot" style="background:var(--fit)"></span>Class</span><span class="pill"><span class="dot" style="background:var(--muted)"></span>Your other calendars</span>
    <span class="muted" style="font-size:12.5px">${sync === undefined ? "Reading your Google Calendar…" : !sync ? "Your other calendars could not be read just now." : sync.simplepractice === "off" && sync.google === "off" ? "No outside calendar is connected, so only MD Fit bookings show." : `Showing ${[sync.simplepractice !== "off" && "SimplePractice", sync.google !== "off" && "Google Calendar"].filter(Boolean).join(" and ")}${sync.titles ? " events, shown only on this screen" : " busy times (times only)"}${sync.lastError ? ". Last sync reported a problem" : ""}.`}</span></div>
    ${lost.length ? `<div class="card" id="calLost" style="margin-bottom:12px"><div class="card-head"><h2>Needs a new time</h2><span class="muted" style="font-size:12px">paid, but the time went to someone else before the payment arrived</span></div>${lost.map((a) => lostRow(a, cache.clients)).join("")}</div>` : ""}
    <div class="table-wrap"><div class="cal">
      <div style="border-bottom:1px solid var(--line)"></div>${days.map((d) => `<div class="cal-h ${isoDay(d) === today ? "today" : ""}">${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getDate()}${((all) => all.slice(0, 1).map((b) => ` <span class="pill" style="font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom" title="${esc(all.map((x) => x.title || "Busy").join(", "))} · all day on ${srcName(b.source)}">${esc(b.title || "Busy all day")}${all.length > 1 ? ` +${all.length - 1}` : ""}</span>`).join(""))(busy.filter((b) => b.allDay && b.date === isoDay(d)))}</div>`).join("")}
      <div class="cal-times" style="grid-row:2">${Array.from({ length: 28 }, (_, i) => `<div>${i % 2 === 0 ? fmtTime(`${START + i / 2}:00`).replace(":00", "") : ""}</div>`).join("")}</div>
      ${cols}
    </div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Weekly classes</h2><button class="btn sm primary" data-act="classEdit">${ui("plus", 14)} Class</button></div>
        ${classes.map((c) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(c.title)}</b>${c.active === false ? ` <span class="pill warn">Closed</span>` : ""}<div class="muted" style="font-size:12px">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][c.day]} ${fmtTime(c.time)} · ${c.durationMin} min${c.coach ? " · " + esc(c.coach) : ""}</div></span><span class="pill">${c.capacity} spots</span><button class="btn sm" data-act="classEdit" data-id="${esc(c.id)}">Edit</button></div>`).join("") || none("No classes set up.")}</div>
      <div class="card"><div class="card-head"><h2>Class bookings</h2></div>
        ${bookings.map((b) => `<div class="list-item"><span style="flex:1"><b>${esc(b.name)}</b><div class="muted" style="font-size:12px">${esc(b.title)} · ${fmtDate(b.date)} ${fmtTime(b.time)}</div></span><button class="btn sm danger" data-act="cancelBooking" data-id="${esc(b.id)}">Cancel</button></div>`).join("") || none("No upcoming class bookings.")}</div>
    </div>`;
  };

  V.clients = async () => {
    const drawn = seq; // only the pass that reaches the page keeps its list for "show more" (a background load must not replace it)
    const [list, emr] = await Promise.all([clients(), part("/emr", PHI), content()]);
    cache.waiting = emr ? emr.waiting.length : 0; renderNav();
    const patients = emr ? new Set(emr.patients.map((p) => p.id)) : null, waiting = emr ? new Set(emr.waiting.map((p) => p.id)) : null;
    const q = state.clientQ.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((c) => q.every((w) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(w)));
    if (drawn === seq || !cache.clientView) cache.clientView = { rows: shown, patients, waiting };
    return `
    <div class="view-head"><div><h1>Clients</h1><p class="muted">${plural(list.length, "account")}${emr ? ` · ${plural(patients.size, "active patient")} · ${waiting.size} waiting to be converted` : ""}</p></div>
    <div class="row"><input class="input" id="clientQ" style="width:240px" placeholder="Filter by name, email or phone" value="${esc(state.clientQ)}" aria-label="Filter clients">${can("security") ? `<button class="btn" data-act="exportAsk" id="exportBtn">${ui("download", 14)} <span id="exportLabel">${state.picked.size ? `Export ${state.picked.size} selected` : "Export all"}</span></button>` : ""}<button class="btn danger" data-act="trashPicked" id="trashPicked"${state.picked.size ? "" : " hidden"}>${ui("trash", 14)} <span id="trashPickedLabel">Delete ${state.picked.size} selected</span></button><button class="btn" data-act="trashOpen">${ui("restore", 14)} View trash</button><button class="btn primary" data-act="clientAdd">${ui("plus", 14)} Add client</button></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th style="width:34px"><input type="checkbox" data-change="pickAll" aria-label="Select everyone shown"${shown.length && shown.every((c) => state.picked.has(c.id)) ? " checked" : ""}></th><th>Client</th><th>Status</th><th>Documents</th><th>Next visit</th><th>Membership</th><th>Last sign-in</th></tr></thead>
      <tbody id="clientRows">${clientRows(shown.slice(0, ROWS_FIRST), patients, waiting) || noneRow(7, list.length ? "No one matches." : "No clients yet.")}</tbody>
    </table></div>${moreRows(shown.length, ROWS_FIRST)}</div>`;
  };
  // A long list is drawn a screenful at a time: the first rows at once, the rest as the bottom comes into view (or on
  // the button). Building every row of a few hundred people was the slowest thing in the workspace.
  const ROWS_FIRST = 40, ROWS_MORE = 80;
  const moreRows = (total, drawn) => total > drawn ? `<div id="rowsMore" style="padding:12px 16px;display:flex;gap:10px;align-items:center"><span class="muted" style="font-size:12.5px" id="rowsMoreText">Showing ${drawn} of ${total}</span><button type="button" class="btn sm" data-act="rowsMore">Show more</button></div>` : "";
  let rowsWatch = null;
  function rowsMoreNow() {
    const v = cache.clientView, body = $("#clientRows"), more = $("#rowsMore"); if (!v || !body || !more) return;
    const have = body.querySelectorAll("tr[data-id]").length, next = v.rows.slice(have, have + ROWS_MORE);
    if (next.length) body.insertAdjacentHTML("beforeend", clientRows(next, v.patients, v.waiting));
    const now = have + next.length;
    if (now >= v.rows.length) { if (rowsWatch) rowsWatch.disconnect(); more.remove(); } else $("#rowsMoreText").textContent = `Showing ${now} of ${v.rows.length}`;
  }
  function rowsArm() {
    if (rowsWatch) rowsWatch.disconnect();
    const more = $("#rowsMore"); if (!more || !("IntersectionObserver" in window)) return;
    rowsWatch = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) rowsMoreNow(); }, { root: $("#view"), rootMargin: "600px 0px" });
    rowsWatch.observe(more);
  }
  function clientRows(list, patients, waiting) {
    return list.map((c) => `<tr class="click" data-act="chart" data-id="${esc(c.id)}">
      <td data-act="stop"><input type="checkbox" data-change="pickOne" data-id="${esc(c.id)}" aria-label="Select ${esc(c.name)}"${state.picked.has(c.id) ? " checked" : ""}></td>
      <td><div class="row" style="flex-wrap:nowrap">${avatar(c.name)}<div style="min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email)}${c.phone ? " · " + esc(c.phone) : ""}</div></div></div></td>
      <td data-act="stop"><div class="seg" role="group" aria-label="Client type for ${esc(c.name)}" title="Subscription exempt clients get the full MD Fit app free, and their visits are not charged."><button type="button" data-act="typeSet" data-type="inpatient" data-id="${esc(c.id)}" data-name="${esc(c.name)}" aria-pressed="${c.clientType === "inpatient"}">Exempt</button><button type="button" data-act="typeSet" data-type="outpatient" data-id="${esc(c.id)}" data-name="${esc(c.name)}" aria-pressed="${c.clientType !== "inpatient"}">Standard</button></div>
        <div class="muted" style="font-size:12px;margin-top:4px">${!patients ? "" : patients.has(c.id) ? "Active patient" : waiting.has(c.id) ? "Documents done, not yet converted" : "Member"}</div></td>
      <td>${c.documents ? (c.documents.complete ? `<span class="pill ok">Complete</span>` : `${c.documents.done} of ${c.documents.total}`) : "—"}</td>
      <td class="num">${c.next ? `${fmtDate(c.next.date)} · ${fmtTime(c.next.time)}` : `<span class="muted">Not booked</span>`}</td>
      <td data-act="stop"><select class="input tier-pick${c.membership ? " on" : ""}" data-change="rowTier" data-id="${esc(c.id)}" data-name="${esc(c.name)}" aria-label="Membership type for ${esc(c.name)}">${tierOptions((c.membership && c.membership.tier) || "")}</select></td>
      <td class="muted">${when(c.lastLoginAt)}</td></tr>`).join("");
  }

  // ---- Client chart. Every sub-tab is worked from here: nothing is handed off to another screen to edit.
  const usd = (c) => (c < 0 ? "-" : "") + "$" + (Math.abs(Number(c) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sizeOf = (n) => (n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const tiers = () => (cache.content && cache.content.tiers) || [];
  const tierName = (id) => (tiers().find((x) => x.id === id) || {}).name || id || "";
  const tierOptions = (cur) => `<option value="">No membership</option>${tiers().map((t) => `<option value="${esc(t.id)}"${cur === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}`;
  const content = async () => (cache.content = await load("/content").catch(() => ({ programs: [], tiers: [] })));
  const chartPills = () => { const { d } = cache.chart; return `${d.patient ? `<span class="pill ok">Active patient${d.since ? " since " + when(d.since) : ""}</span>` : `<span class="pill warn">Not yet a patient</span>`}${(d.allergies || []).map((a) => `<span class="pill bad" title="${esc(a.reaction || "Allergy or alert")}">${ui("alert", 12)} ${esc(a.name)}</span>`).join("")}${(d.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join("")}`; };
  // A small line chart for one measure over time (oldest on the left)
  function trend(points, unit) {
    const W = 320, H = 110, p = 20, vs = points.map((x) => x.value), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1, step = (W - 2 * p) / Math.max(points.length - 1, 1);
    const xy = points.map((pt, i) => [p + i * step, H - p - ((pt.value - lo) / span) * (H - 2 * p)]);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(points.map((x) => `${x.date}: ${x.value}${unit ? " " + unit : ""}`).join(", "))}" style="max-width:420px;display:block"><polyline fill="none" stroke="var(--accent-text)" stroke-width="2" points="${xy.map((q) => q.map((n) => n.toFixed(1)).join(",")).join(" ")}"/>${xy.map((q, i) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.5" fill="var(--accent-text)"><title>${esc(points[i].date)}: ${esc(points[i].value)}</title></circle>`).join("")}</svg>`;
  }

  V.chart = async () => {
    const id = state.chartClient;
    if (!id) {
      const emr = await load("/emr");
      const pick = (p) => `<div class="list-item"><span style="flex:1"><b>${esc(p.name)}</b> <span class="muted">${esc(p.email)}</span></span><button class="btn sm" data-act="chart" data-id="${esc(p.id)}">Open chart</button></div>`;
      return `<div class="view-head"><div><h1>Client chart</h1><p class="muted">Pick a client to open their chart</p></div><a class="btn" href="#clients">All clients</a></div>
      <div class="grid g2"><div class="card"><div class="card-head"><h2>Active patients</h2></div>${emr.patients.map(pick).join("") || none("No active patients yet.")}</div>
      <div class="card"><div class="card-head"><h2>Waiting to be converted</h2></div>${emr.waiting.map(pick).join("") || none("Nobody is waiting.")}</div></div>`;
    }
    const [d, c, cn] = await Promise.all([load(`/emr/${id}`), load(`/clients/${id}`), load(`/notes?clientId=${id}`).catch(() => ({ notes: [] })), content()]);
    // (the Billing tab's own list is only dropped when the chart is for someone else: this function also runs in the
    // background to check for anything newer, and must not blank what the buttons on that tab work from)
    cache.chart = { d, c, cn: cn.notes || [] }; if (cache.billingFor !== id) cache.billing = null;
    const tabs = [["overview", "Overview"], ["progress", "Progress"], ["notes", "Clinical notes"], ["plans", "Plans & protocols"], ["measures", "Measures"], ["meds", "Meds & allergies"], ["files", "Files"], ["billing", "Billing"], ["consent", "Sharing & consent"]];
    const tier = (c.membership && c.membership.tier) || "";
    return `
    <div class="view-head"><div class="row" style="gap:14px">${avatar(d.name, 52)}<div style="min-width:0"><h1>${esc(d.name)}</h1>
      <p class="muted">${esc(d.email)}${d.phone ? " · " + esc(d.phone) : ""} · Next: ${d.nextVisit ? `${fmtDate(d.nextVisit.date)} ${fmtTime(d.nextVisit.time)}` : "nothing booked"}</p>
      <div class="row" style="margin-top:6px" id="chartPills">${chartPills()}</div></div></div>
      <div class="row"><button class="btn ${d.patient ? "" : "primary"}" data-act="convert" data-on="${d.patient ? "0" : "1"}">${d.patient ? "Mark as not a patient" : "Convert to active patient"}</button>
      <button class="btn" data-act="thread" data-id="${esc(id)}">Message</button><button class="btn" data-act="clientLoginLink" data-id="${esc(id)}" title="Email them the sign-in address">Email sign-in link</button><button class="btn" data-act="book">Book</button><button class="btn ${d.patient ? "primary" : ""}" data-act="chartNewNote">${ui("plus", 14)} Note</button><a class="btn" href="#chart" data-act="chartClose">Other client</a><button class="btn danger" data-act="clientTrash" data-id="${esc(id)}" data-name="${esc(d.name)}">${ui("trash", 14)} Delete</button></div></div>
    <div class="row chart-types"><label for="chTier">Membership</label><select id="chTier" class="input" data-change="chartTier">${tierOptions(tier)}</select>
      <label for="chType">Client type</label><select id="chType" class="input" data-change="chartType"><option value="outpatient"${d.clientType !== "inpatient" ? " selected" : ""}>Standard</option><option value="inpatient"${d.clientType === "inpatient" ? " selected" : ""}>Subscription exempt (visits not charged)</option></select>
      <span class="muted" style="font-size:12px">Subscription exempt clients get the full MD Fit app free.</span></div>
    <div class="tabs" role="tablist">${tabs.map(([t, l]) => `<button class="tab ${state.chartTab === t ? "active" : ""}" role="tab" data-act="chartTab" data-tab="${t}">${l}</button>`).join("")}</div>
    <div id="chartBody">${chartTab()}</div>`;
  };
  const REC = { joined: "Joined", documents: "Documents", patient: "Patient", note: "Note", movement: "Movement", payment: "Paid", scheduled: "Scheduled", visit: "Visit", cancelled: "Cancelled", lapsed: "Unfinished", removed: "Removed" };
  const rm = (kind, id, label) => `<button type="button" class="btn sm ghost" data-act="rmItem" data-kind="${kind}" data-id="${esc(id)}" aria-label="${esc(label)}">${ui("x", 14)}</button>`;
  function chartTab() {
    const { d, c, cn } = cache.chart, t = state.chartTab, first = esc(String(d.name).split(" ")[0]), today = isoDay(new Date());
    const plan = c.plan || { guides: [], exercises: [], notes: "" };
    if (t === "overview") return `
      <div class="grid g4" style="margin-bottom:16px">${kpi("Documents", `${d.documents.done}/${d.documents.total}`, d.documents.complete ? "complete" : "in progress")}${kpi("Clinical notes", cn.length, `${cn.filter((n) => n.status !== "draft").length} signed`)}${kpi("Movements", d.movements.length, "prescribed")}${kpi("Paid visits", d.paidVisits.length, "need a time", d.paidVisits.length ? "warn" : "")}</div>
      <div class="grid g-side"><div class="stack">
        <div class="card stack"><div class="card-head"><h2>Care summary</h2><span class="pill">Staff only</span></div>
          <form class="stack" data-form="summary"><textarea name="summary" class="input" rows="3" maxlength="2000" placeholder="Where ${first} is in care, in a few lines" aria-label="Care summary">${esc(d.summary || "")}</textarea>
          <div class="field"><label for="sumTags">Tags (comma separated, up to 8)</label><input id="sumTags" name="tags" class="input" maxlength="260" value="${esc((d.tags || []).join(", "))}" placeholder="Runner, Post-op knee"></div>
          <div class="row"><button class="btn primary">Save summary</button></div></form></div>
        <div class="card"><div class="card-head"><h2>Record</h2><span class="muted" style="font-size:12px">Newest first</span></div>
        ${(d.record || []).map((e) => `<div class="rec"><span class="muted num" style="font-size:12px">${when(e.at)}</span><span class="pill">${esc(REC[e.kind] || e.kind)}</span><span><b>${esc(e.title)}</b>${e.detail ? ` <span class="muted">${esc(e.detail)}</span>` : ""}</span></div>`).join("") || none("Nothing on the record yet.")}</div></div>
      <div class="stack"><div class="card"><h2 style="margin-bottom:10px">Contact</h2><dl class="kv"><dt>Email</dt><dd>${esc(d.email)}</dd><dt>Phone</dt><dd>${esc(d.phone || "—")}</dd><dt>Last sign-in</dt><dd>${when(d.lastLoginAt)}</dd><dt>Joined</dt><dd>${when(d.createdAt)}</dd></dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Next visit</h2>${d.nextVisit ? `<b>${fmtDate(d.nextVisit.date)} · ${fmtTime(d.nextVisit.time)}</b><div class="muted">${esc(d.nextVisit.typeName || "")}</div>` : none("Nothing booked.")}<div class="row" style="margin-top:10px"><button class="btn sm" data-act="book">Book</button></div></div>
      <div class="card"><h2 style="margin-bottom:10px">Allergies &amp; alerts</h2>${(d.allergies || []).map((a) => `<div class="list-item"><span class="pill bad">${ui("alert", 12)}</span><span style="flex:1"><b>${esc(a.name)}</b>${a.reaction ? ` <span class="muted">${esc(a.reaction)}</span>` : ""}</span></div>`).join("") || none("None recorded.")}</div></div></div>`;
    // The same graphs the client sees in the app (Profile → My progress), drawn once the tab is on screen (chartAfter)
    if (t === "progress") return `<div class="card"><div class="card-head"><h2>Progress</h2><span class="muted" style="font-size:12px">What ${first} sees in the app, from what they log</span></div><div id="wsProgress"></div></div>`;
    if (t === "notes") return `
      <div class="card"><div class="card-head"><h2>Clinical notes</h2><div class="row"><span class="pill">Staff only</span><button class="btn sm primary" data-act="chartNewNote">${ui("plus", 14)} New note</button></div></div>
        ${cn.map((n) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(TEMPLATES[n.template] || "Note")}</b><div class="muted" style="font-size:12px">${n.status === "draft" ? "Last saved " + when(n.updatedAt) : "Signed " + when(n.signedAt) + (n.signedBy ? " by " + esc(n.signedBy) : "")}${n.addenda ? ` · ${n.addenda} addend${n.addenda === 1 ? "um" : "a"}` : ""}</div></span>
          ${n.tier && n.tier !== "T1" ? `<span class="pill">${esc(n.tier)}</span>` : ""}<span class="pill ${n.status === "draft" ? "warn" : "ok"}">${n.status === "draft" ? "Draft" : "Signed &amp; locked"}</span><button class="btn sm" data-act="chartNote" data-id="${esc(n.id)}" data-draft="${n.status === "draft" ? "1" : ""}">${n.status === "draft" ? "Continue" : "Open"}</button></div>`).join("") || none("No clinical notes yet.")}</div>
      <div class="card stack" style="margin-top:16px"><div class="card-head"><h2>Notes for ${first}</h2><span class="pill warn">${first} reads these in the app</span></div>
        <form class="stack" data-form="note"><div class="row" style="justify-content:space-between"><label class="muted" for="noteText" style="font-size:12px">New note to the patient</label><button type="button" class="btn sm mic" data-act="dictate" data-for="noteText" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div><textarea id="noteText" name="text" class="input" rows="3" maxlength="4000" required placeholder="What ${first} should know or do next"></textarea>
        <div class="row"><button class="btn primary">Add note</button></div></form>
        ${d.notes.map((n) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><span class="muted" style="font-size:12px">${when(n.at)}</span><p class="note-text" style="margin:2px 0 0">${esc(n.text)}</p></span><button class="btn sm danger" data-act="rmNote" data-id="${esc(n.id)}">Remove</button></div>`).join("") || none("No notes to the patient yet.")}</div>`;
    if (t === "plans") { const progs = (cache.content && cache.content.programs) || [], mine = new Set((c.assignedPrograms || []).map((p) => p.id)); return `
      <div class="grid g2"><div class="card stack"><div class="card-head"><h2>Treatment plan</h2><span class="pill warn">${first} reads this in the app</span></div>
          <form class="stack" data-form="planNotes"><div class="row" style="justify-content:flex-end"><button type="button" class="btn sm mic" data-act="dictate" data-for="planText" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div>
          <textarea id="planText" name="notes" class="input" rows="6" maxlength="3000" placeholder="Goals, how often, and when you will review" aria-label="Treatment plan">${esc(plan.notes || "")}</textarea>
          <div class="row"><button class="btn primary">Save treatment plan</button>${plan.updatedAt ? `<span class="muted" style="font-size:12px">Updated ${when(plan.updatedAt)}</span>` : ""}</div></form></div>
        <div class="card stack"><div class="card-head"><h2>Protocols for ${first}</h2><span class="muted" style="font-size:12px">Search and add, or type a new one</span></div>
          <form class="stack" data-form="protocol"><div class="field"><label for="prName">Protocol</label><input id="prName" name="name" class="input" type="search" maxlength="80" required placeholder="Search every protocol, pain track and program, or type a new one" autocomplete="off" aria-controls="prFound">
            <div id="prFound" hidden></div></div>
          <div class="field"><div class="row" style="justify-content:space-between"><label for="prDetail">What to do</label><button type="button" class="btn sm mic" data-act="dictate" data-for="prDetail" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div><textarea id="prDetail" name="detail" class="input" rows="4" maxlength="1000" placeholder="Steps, sets and reps, how often, what to avoid"></textarea></div>
          <div class="row"><button class="btn primary">Add to ${first}'s program</button></div></form>
          ${(plan.exercises || []).map((x, i) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(x.name)}</b>${x.detail ? `<div class="muted note-text" style="font-size:12.5px">${esc(x.detail)}</div>` : ""}</span><button class="btn sm danger" data-act="prRemove" data-i="${i}">Remove</button></div>`).join("") || none(`Nothing written in ${first}'s program yet.`)}
          <h3 style="margin:14px 0 4px">Pain rehab on ${first}'s dashboard</h3><p class="muted" style="font-size:12px;margin:0 0 6px">Pain tracks and Pain Tool protocols: what you prescribed, what ${first} put on their road, and what they've done</p>
          <div id="painOn">${none("Loading…")}</div></div></div>
      <div class="card stack" style="margin-top:16px"><div class="card-head"><h2>Pain tracks &amp; Pain Tool protocols</h2><span class="muted" style="font-size:12px">Everything in the MD Fit app. Adding one puts it on ${first}'s dashboard (a track goes on their road too)</span></div>
        <input class="input" id="ptSearch" type="search" placeholder="Search tracks and protocols (e.g. levator, shoulder blade, plantar)" aria-label="Search pain tracks and protocols" autocomplete="off">
        <div id="ptList">${none("Loading…")}</div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><div class="card-head"><h2>All protocols</h2><span class="muted" style="font-size:12px">Everything you have written, most used first</span></div><div id="prPool">${none("Loading…")}</div></div>
        <div class="card" id="chartPrograms"><div class="card-head"><h2>All programs</h2><span class="muted" style="font-size:12px">${plural(progs.length, "program")} in the library</span></div>
          ${progs.map((p) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(p.title)}</b><div class="muted" style="font-size:12px">${[p.category, p.level, p.weeks ? p.weeks + " weeks" : ""].filter(Boolean).map(esc).join(" · ")}</div></span>${mine.has(p.id) ? `<span class="pill ok">Assigned</span><button class="btn sm danger" data-act="prUnassign" data-id="${esc(p.id)}">Remove</button>` : `<button class="btn sm" data-act="prAssign" data-id="${esc(p.id)}">Add to ${first}'s program</button>`}</div>`).join("") || none("No programs in the library.")}</div></div>
      <div class="card stack" style="margin-top:16px"><div class="card-head"><h2>Movements for ${first}</h2><span class="muted" style="font-size:12px">Each one plays its video in the app</span></div>
        <div id="mvPool"></div>
        <input class="input" id="mvSearch" type="search" placeholder="Search the video library (e.g. hip hinge, calf, dead bug)" aria-label="Search movements" autocomplete="off">
        <div id="mvResults"></div>
        <form class="stack" data-form="movement" id="mvForm" hidden><p style="margin:0"><b id="mvName"></b> <span class="muted" id="mvMeta"></span></p><input type="hidden" name="videoId"><input type="hidden" name="name">
          <div class="grid g2"><div class="field"><label for="mvDose">Sets × reps</label><input id="mvDose" name="dose" class="input" maxlength="120" placeholder="3 × 12"></div><div class="field"><label for="mvCue">Cue (optional)</label><input id="mvCue" name="cue" class="input" maxlength="300"></div></div>
          <div class="row"><button class="btn primary">Add to ${first}'s plan</button><button type="button" class="btn" data-act="mvCancel">Cancel</button></div></form></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Prescribed</h2></div>
        ${d.movements.map((m) => `<div class="list-item"><img class="mv-thumb" src="https://drive.google.com/thumbnail?id=${encodeURIComponent(m.videoId)}&sz=w160" alt="" loading="lazy" referrerpolicy="no-referrer"><span style="flex:1;min-width:0"><b>${esc(m.name)}</b>${m.dose ? ` <span class="pill">${esc(m.dose)}</span>` : ""}<div class="muted" style="font-size:12px">${m.cue ? esc(m.cue) + " · " : ""}added ${when(m.at)}</div></span><button class="btn sm danger" data-act="rmMove" data-id="${esc(m.id)}">Remove</button></div>`).join("") || none("No movements prescribed yet.")}</div>`; }
    if (t === "measures") {
      const pain = (c.painLog || []).slice().reverse().slice(0, 50), by = new Map();
      for (const m of (d.measures || []).slice().reverse()) { const k = m.name.toLowerCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
      const areas = new Map(); for (const e of (c.painLog || [])) { if (!areas.has(e.area)) areas.set(e.area, []); areas.get(e.area).push({ date: e.date, value: Number(e.level) || 0 }); }
      return `
      <div class="card stack"><div class="card-head"><h2>Record a measure</h2><span class="pill">Staff only</span></div>
        <form data-form="measure" class="stack"><div class="grid g4"><div class="field"><label for="msName">Measure</label><input id="msName" name="name" class="input" maxlength="80" required list="msNames" placeholder="Knee flexion" autocomplete="off"><datalist id="msNames">${[...new Set([...(d.measures || []).map((m) => m.name), "Knee flexion", "Knee extension", "Shoulder flexion", "Hip flexion", "Grip strength", "Single-leg balance", "LEFS", "QuickDASH", "Oswestry (ODI)", "Neck Disability Index"])].map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
          <div class="field"><label for="msVal">Result</label><input id="msVal" name="value" class="input" type="number" step="any" required inputmode="decimal"></div>
          <div class="field"><label for="msUnit">Unit</label><input id="msUnit" name="unit" class="input" maxlength="20" placeholder="deg, lb, sec, /80"></div>
          <div class="field"><label for="msDate">Date</label><input id="msDate" name="date" class="input" type="date" value="${today}" max="${today}"></div></div>
          <div class="field"><label for="msNote">Note (optional)</label><input id="msNote" name="note" class="input" maxlength="200"></div>
          <div class="row"><button class="btn primary">Add measure</button></div></form></div>
      <div class="grid g2" style="margin-top:16px">${[...by.values()].map((list) => { const last = list[list.length - 1], firstM = list[0], diff = last.value - firstM.value; return `<div class="card"><div class="card-head"><h2>${esc(last.name)}</h2><b class="num">${esc(last.value)}${last.unit ? " " + esc(last.unit) : ""}</b></div>
          ${list.length > 1 ? trend(list, last.unit) + `<p class="muted" style="margin:4px 0 8px;font-size:12.5px">${diff === 0 ? "No change" : (diff > 0 ? "Up " : "Down ") + Math.abs(Math.round(diff * 100) / 100)}${last.unit ? " " + esc(last.unit) : ""} since ${fmtDate(firstM.date)}</p>` : ""}
          ${list.slice().reverse().map((m) => `<div class="list-item"><span class="muted num" style="font-size:12px">${fmtDate(m.date)}</span><span style="flex:1"><b class="num">${esc(m.value)}${m.unit ? " " + esc(m.unit) : ""}</b>${m.note ? ` <span class="muted">${esc(m.note)}</span>` : ""}</span>${rm("measures", m.id, "Remove this result")}</div>`).join("")}</div>`; }).join("") || `<div class="card">${none("No measures recorded yet.")}</div>`}</div>
      ${[...areas.entries()].filter(([, v]) => v.length > 1).slice(0, 4).length ? `<div class="grid g2" style="margin-top:16px">${[...areas.entries()].filter(([, v]) => v.length > 1).slice(0, 4).map(([a, v]) => `<div class="card"><div class="card-head"><h2>Pain: ${esc(a)}</h2><b class="num">${v[v.length - 1].value}/10</b></div>${trend(v.slice(-20), "/10")}</div>`).join("")}</div>` : ""}
      <div class="card" style="padding:0;margin-top:16px"><div class="card-head" style="padding:14px 16px 0"><h2>Pain log</h2><span class="muted" style="font-size:12px">Logged by ${first} in the app</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Area</th><th class="num">Pain</th><th>Note</th></tr></thead><tbody>
      ${pain.map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.area)}</td><td class="num">${esc(e.level)}/10</td><td>${esc(e.note || "")}</td></tr>`).join("") || noneRow(4, "No entries yet.")}</tbody></table></div></div>
      <div class="grid g3" style="margin-top:16px">${kpi("Workouts", (c.stats && c.stats.workouts) || 0, "logged")}${kpi("Streak", (c.stats && c.stats.streak) || 0, "days")}${kpi("Level", (c.rewards && c.rewards.level) || 1, esc((c.rewards && c.rewards.title) || ""))}</div>`; }
    if (t === "meds") return `
      <div class="grid g2"><div class="card stack"><div class="card-head"><h2>Medications</h2><span class="pill">Staff only</span></div>
          ${(d.meds || []).map((m) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(m.name)}</b>${m.dose ? ` <span class="muted">${esc(m.dose)}</span>` : ""}${m.note ? `<div class="muted" style="font-size:12px">${esc(m.note)}</div>` : ""}</span><span class="muted" style="font-size:12px">${when(m.at)}</span>${rm("meds", m.id, "Remove " + m.name)}</div>`).join("") || none("None recorded.")}
          <form class="stack" data-form="med"><div class="grid g2"><div class="field"><label for="mdName">Medication or supplement</label><input id="mdName" name="name" class="input" maxlength="120" required></div><div class="field"><label for="mdDose">Dose and how often</label><input id="mdDose" name="dose" class="input" maxlength="120" placeholder="400 mg as needed"></div></div>
          <div class="field"><label for="mdNote">Note (optional)</label><input id="mdNote" name="note" class="input" maxlength="300" placeholder="Prescribed by, reason, started"></div>
          <div class="row"><button class="btn primary">Add medication</button></div></form></div>
        <div class="card stack"><div class="card-head"><h2>Allergies &amp; alerts</h2><span class="muted" style="font-size:12px">Shown at the top of the chart</span></div>
          ${(d.allergies || []).map((a) => `<div class="list-item"><span class="pill bad">${ui("alert", 12)}</span><span style="flex:1;min-width:0"><b>${esc(a.name)}</b>${a.reaction ? ` <span class="muted">${esc(a.reaction)}</span>` : ""}</span>${rm("allergies", a.id, "Remove " + a.name)}</div>`).join("") || none("None recorded.")}
          <form class="stack" data-form="allergy"><div class="grid g2"><div class="field"><label for="alName">Allergy or alert</label><input id="alName" name="name" class="input" maxlength="120" required placeholder="Penicillin, latex, fall risk"></div><div class="field"><label for="alRx">Reaction or detail</label><input id="alRx" name="reaction" class="input" maxlength="200"></div></div>
          <div class="row"><button class="btn primary">Add alert</button></div></form></div></div>`;
    if (t === "files") return `
      <div class="card"><div class="card-head"><h2>Files</h2><label class="btn sm primary">${ui("upload", 14)} Upload<input type="file" hidden data-change="chartFile" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,application/pdf,image/*,text/plain"></label></div>
        <p class="muted" style="margin:0 0 8px;font-size:12.5px">PDF, pictures or plain text, up to 4 MB each. Each file is encrypted before it is stored, and every download is logged.</p>
        ${(d.files || []).map((f) => `<div class="list-item"><span style="flex:1;min-width:0;overflow-wrap:anywhere">${ui("file", 14)} <b>${esc(f.name)}</b><div class="muted" style="font-size:12px">${when(f.at)} · ${sizeOf(f.size)}</div></span><span class="pill ok">${ui("lock", 12)} Encrypted</span><button class="btn sm" data-act="fileGet" data-id="${esc(f.id)}" data-name="${esc(f.name)}">${ui("download", 14)} Download</button>${rm("files", f.id, "Remove " + f.name)}</div>`).join("") || none("No files yet.")}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>New patient documents</h2><span class="pill ${d.documents.complete ? "ok" : ""}">${d.documents.done} of ${d.documents.total}</span></div>
        ${d.documents.done ? `<button class="btn" data-act="docs">View documents</button><div id="docsBox" style="margin-top:12px"></div>` : none("None on file yet.")}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Documents issued</h2><span class="muted" style="font-size:12px">Superbills and Good Faith Estimates</span></div>
        ${(d.docs || []).map((x) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(x.title)}</b><div class="muted" style="font-size:12px">${when(x.at)}</div></span><button class="btn sm" data-act="docView" data-id="${esc(x.id)}">View or print</button>${rm("docs", x.id, "Remove " + x.title)}</div>`).join("") || none("None issued yet. They are made from the Billing tab.")}</div>`;
    if (t === "billing") return `
      <div class="grid g-side"><div class="stack">
        <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Invoices and payments</h2></div><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Description</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody id="billRows">${noneRow(6, "Loading…")}</tbody></table></div></div>
        <div class="card stack"><div class="card-head"><h2>New invoice</h2><span class="muted" style="font-size:12px">For anything outside the usual online checkout</span></div>
          <form class="stack" data-form="invoice"><div class="field"><label for="ivDesc">What it is for</label><input id="ivDesc" name="description" class="input" maxlength="200" required placeholder="Kinesiology tape, late cancellation, custom package"></div>
          <div class="grid g3"><div class="field"><label for="ivAmt">Amount ($)</label><input id="ivAmt" name="amount" class="input" type="number" min="0.01" max="20000" step="0.01" required inputmode="decimal"></div>
            <div class="field"><label for="ivDate">Date</label><input id="ivDate" name="date" class="input" type="date" value="${today}"></div>
            <div class="field"><label for="ivPaid">Paid already?</label><select id="ivPaid" name="method" class="input"><option value="">Not yet</option><option value="cash">Yes, cash</option><option value="check">Yes, check</option><option value="card">Yes, card in person</option><option value="other">Yes, another way</option></select></div></div>
          <div class="row"><button class="btn primary" name="go" value="send">Create and send to ${first}</button><button class="btn" name="go" value="save">Create without sending</button></div>
          <p class="muted" style="margin:0;font-size:12.5px">Sending emails ${first} the amount and a secure card payment page. You write the subject and message before it goes.</p></form></div>
        <div class="card"><div class="card-head"><h2>Video visits</h2><button class="btn sm" data-act="book">Schedule</button></div>
          ${d.paidVisits.map((v) => `<div class="list-item"><span style="flex:1"><b>${esc(v.name || v.service)}</b><div class="muted" style="font-size:12px">paid ${when(v.paidAt)}${v.amount != null ? ` · ${usd(v.amount)}` : ""}</div></span><span class="pill warn">Needs a time</span></div>`).join("")}
          ${d.visits.map((v) => `<div class="list-item"><span style="flex:1"><b>${esc(v.typeName)}</b><div class="muted" style="font-size:12px">${fmtDate(v.date)} ${fmtTime(v.time)} · ${v.minutes} min</div></span>${v.payment === "paid" ? `<span class="pill ok">Paid</span>` : v.payment === "exempt" ? `<span class="pill">Subscription exempt</span>` : ""}</div>`).join("")}
          ${d.paidVisits.length || d.visits.length ? "" : none("No video visits.")}</div></div>
      <div class="stack"><div class="card stack"><h2>Payment</h2><div id="billPay">${none("Loading…")}</div>
          <button class="btn" data-act="superbill">Generate superbill</button><button class="btn" data-act="gfe">Good Faith Estimate</button></div>
        <div class="card stack"><h2>Membership</h2>
          <form class="stack" data-form="membership"><div class="field"><label for="mbTier">Membership type</label><select id="mbTier" name="tier" class="input">${tierOptions((c.membership && c.membership.tier) || "")}</select></div>
          <div class="field"><label for="mbUntil">Paid through (blank for no end date)</label><input id="mbUntil" name="until" type="date" class="input" value="${esc((c.membership && c.membership.until) || "")}"></div>
          <div class="row"><button class="btn primary">Save membership</button></div>${c.membership && c.membership.since ? `<p class="muted" style="margin:0;font-size:12px">Member since ${esc(c.membership.since)}</p>` : ""}</form></div></div></div>`;
    if (t === "consent") { const live = (x) => !x.removedAt && (!x.expires || x.expires >= today); return `
      <div class="card"><div class="card-head"><h2>New patient consents</h2><span class="pill ${d.documents.complete ? "ok" : "warn"}">${d.documents.complete ? "Signed" : `${d.documents.done} of ${d.documents.total} documents`}</span></div>
        <p class="muted" style="margin:0 0 8px">Consent to treatment, the privacy notice and the financial policy are signed by ${first} as part of the new patient documents.</p>
        ${d.documents.done ? `<button class="btn sm" data-act="docsModal" data-id="${esc(d.id)}">View what was signed</button>` : none(`${first} has not filled these out yet.`)}</div>
      <div class="card stack" style="margin-top:16px"><div class="card-head"><h2>Consents on file</h2><span class="muted" style="font-size:12px">Releases and permissions ${first} has signed</span></div>
        ${(d.consents || []).map((x) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(x.title)}</b><div class="muted" style="font-size:12px">${x.detail ? esc(x.detail) + " · " : ""}signed ${fmtDate(x.signedOn)} (${esc(x.how)})${x.expires ? " · expires " + fmtDate(x.expires) : ""}${x.removedAt ? " · revoked " + when(x.removedAt) : ""}</div></span><span class="pill ${live(x) ? "ok" : ""}">${x.removedAt ? "Revoked" : live(x) ? "Active" : "Expired"}</span>${x.removedAt ? "" : `<button class="btn sm danger" data-act="rmItem" data-kind="consents" data-id="${esc(x.id)}" data-word="Revoke this consent? It stays on the record as revoked.">Revoke</button>`}</div>`).join("") || none("None recorded yet.")}
        <div class="row" style="margin-bottom:4px"><button type="button" class="btn" data-act="privacyOpen" data-id="${esc(d.id)}">Privacy, record copy and corrections</button></div>
        <form class="stack" data-form="consent"><div class="grid g2"><div class="field"><label for="csTitle">Consent</label><input id="csTitle" name="title" class="input" maxlength="120" required list="csTitles" placeholder="Release of records" autocomplete="off"><datalist id="csTitles">${["Release of records to another provider", "Telehealth consent", "Photo and video consent", "Email and text message consent", "Sharing with a family member or caregiver"].map((n) => `<option value="${n}">`).join("")}</datalist></div>
          <div class="field"><label for="csDetail">Who or what it covers</label><input id="csDetail" name="detail" class="input" maxlength="500" placeholder="Dr. Lee, orthopedics: visit notes"></div></div>
          <div class="grid g3"><div class="field"><label for="csOn">Signed on</label><input id="csOn" name="signedOn" type="date" class="input" value="${today}" max="${today}"></div><div class="field"><label for="csExp">Expires (optional)</label><input id="csExp" name="expires" type="date" class="input" min="${today}"></div>
            <div class="field"><label for="csHow">How it was given</label><select id="csHow" name="how" class="input"><option value="in person">Signed in person</option><option value="electronic">Signed electronically</option><option value="verbal">Verbal, noted by staff</option></select></div></div>
          <div class="row"><button class="btn primary">Record consent</button></div></form></div>`; }
    return "";
  }
  // What a tab needs once it is on screen
  function chartAfter() {
    if (state.chartTab === "plans") { loadPool(); loadProtocols(); loadPainRehab(); }
    if (state.chartTab === "billing") loadBilling();
    if (state.chartTab === "progress" && $("#wsProgress") && window.MDFitProgress) {
      const id = state.chartClient;
      window.MDFitProgress.mount($("#wsProgress"), { admin: true, load: (days) => api("GET", `/api/admin/clients/${encodeURIComponent(id)}/progress?days=${days}`) });
    }
  }
  // ---- Pain tracks and Pain Tool protocols (the member app's own: paintracks.js, painmuscles.js + musclereports.js),
  // loaded once on demand. The chart shows what is on the client's dashboard (server: painWork) and prescribes more
  // (PUT /api/admin/clients/:id/pain-plan).
  let painCat = null;
  const addScript = (src) => new Promise((ok, no) => { if (document.querySelector(`script[data-src="${src}"]`)) return ok(); const s = document.createElement("script"); s.src = src; s.dataset.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  async function painCatalog() {
    if (painCat) return painCat;
    await Promise.all([addScript("/paintracks.js"), addScript("/painmuscles.js"), addScript("/musclereports.js")]);
    try { await window.MDFitTracks.ready; } catch {}
    const T = (window.MDFitTracks && window.MDFitTracks.TRACKS) || [], MU = (window.MDFitMuscles || {}).MUSCLES || {}, R = window.MDFIT_MUSCLE_REPORTS || {};
    const tracks = T.map((t) => ({ kind: "track", id: t.id, title: t.title, sub: `Pain track · ${t.region} · ${t.levels.length} level${t.levels.length === 1 ? "" : "s"}` }));
    const protocols = Object.keys(R).filter((id) => R[id] && R[id].protocol && MU[id]).map((id) => ({ kind: "protocol", id, title: `${MU[id].name} protocol`, sub: "Pain Tool protocol · 3 phases" }));
    painCat = { all: [...tracks.sort((a, b) => a.title.localeCompare(b.title)), ...protocols.sort((a, b) => a.title.localeCompare(b.title))] };
    painCat.by = new Map(painCat.all.map((x) => [`${x.kind}:${x.id}`, x]));
    return painCat;
  }
  async function loadPainRehab() {
    const id = state.chartClient, box = $("#painOn"); if (!box) return;
    let cat; try { cat = await painCatalog(); } catch { box.innerHTML = none("Couldn't load the pain tracks."); return; }
    if (state.chartClient !== id || !$("#painOn")) return;
    const c = cache.chart.c, first = esc(String(cache.chart.d.name).split(" ")[0]), pw = c.painWork || { items: [], savedProtocols: [] };
    const name = (x) => (cat.by.get(`${x.kind}:${x.id}`) || { title: x.id }).title;
    const tags = (x) => [x.prescribed ? `<span class="pill ok">Prescribed${x.assignedAt ? " " + esc(fmtDate(x.assignedAt.slice(0, 10))) : ""}</span>` : "", x.onRoad ? `<span class="pill">On their road</span>` : "", !x.prescribed && !x.onRoad ? `<span class="pill">Done before · not on their dashboard</span>` : "",
      `<span class="pill ${x.sessions ? "" : "warn"}">${x.sessions ? `${plural(x.sessions, "session")}${x.last ? " · last " + esc(fmtDate(x.last)) : ""}` : "Not started"}</span>`].join(" ");
    box.innerHTML = (pw.items || []).map((x) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(name(x))}</b> <span class="muted" style="font-size:12px">${x.kind === "track" ? "Pain track" : "Pain Tool protocol"}</span>
        <div class="row" style="gap:6px;margin-top:4px">${tags(x)}</div>${x.note ? `<div class="muted note-text" style="font-size:12.5px">${esc(x.note)}</div>` : ""}</span>
        <span class="row" style="gap:6px;flex-wrap:nowrap">${x.prescribed ? "" : `<button class="btn sm" data-act="painAdd" data-kind="${x.kind}" data-id="${esc(x.id)}">Prescribe</button>`}
        ${x.prescribed || x.onRoad ? `<button class="btn sm danger" data-act="painRm" data-kind="${x.kind}" data-id="${esc(x.id)}" data-pres="${x.prescribed ? 1 : ""}" data-road="${x.onRoad ? 1 : ""}">Remove</button>` : ""}</span></div>`).join("")
      + ((pw.savedProtocols || []).length ? `<div class="muted" style="font-size:12px;margin-top:6px">Saved to their My Programs: ${pw.savedProtocols.map((p) => esc(p.name)).join(", ")}</div>` : "")
      || none(`No pain tracks or protocols on ${first}'s dashboard yet.`);
    drawPainList(); drawProtoSearch();
  }
  function drawPainList() {
    const list = $("#ptList"); if (!list || !painCat) return;
    const q = String(($("#ptSearch") || {}).value || "").trim().toLowerCase(), c = cache.chart.c, first = esc(String(cache.chart.d.name).split(" ")[0]);
    const on = new Set((c.assignedPain || []).map((x) => `${x.kind}:${x.id}`));
    const hits = painCat.all.filter((x) => !q || `${x.title} ${x.sub}`.toLowerCase().includes(q));
    list.innerHTML = hits.slice(0, 40).map((x) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(x.title)}</b><div class="muted" style="font-size:12px">${esc(x.sub)}</div></span>
      ${on.has(`${x.kind}:${x.id}`) ? `<span class="pill ok">Prescribed</span>` : `<button class="btn sm" data-act="painAdd" data-kind="${x.kind}" data-id="${esc(x.id)}">Add to ${first}'s program</button>`}</div>`).join("")
      + (hits.length > 40 ? `<p class="muted" style="font-size:12px">${hits.length - 40} more. Search to narrow the list.</p>` : "") || none("Nothing matches. Try another word.");
  }
  async function savePain(items) {
    const id = state.chartClient;
    const r = await api("PUT", `/api/admin/clients/${encodeURIComponent(id)}/pain-plan`, { items });
    if (state.chartClient !== id) return;
    cache.chart.c = { ...cache.chart.c, assignedPain: r.assignedPain, painWork: r.painWork };
    await loadPainRehab();
  }
  document.addEventListener("input", (e) => { if (e.target && e.target.id === "ptSearch") drawPainList(); });
  async function loadProtocols() {
    const r = await load("/emr/protocols").catch(() => ({ protocols: [] })), box = $("#prPool"); if (!box) return;
    cache.protocols = r.protocols || [];
    const mine = new Set(((cache.chart.c.plan || {}).exercises || []).map((x) => String(x.name).toLowerCase())), first = esc(String(cache.chart.d.name).split(" ")[0]);
    box.innerHTML = cache.protocols.map((p, i) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(p.name)}</b> <span class="muted" style="font-size:12px">used ${p.uses}×</span>${p.detail ? `<div class="muted note-text" style="font-size:12.5px">${esc(p.detail)}</div>` : ""}</span>${mine.has(p.name.toLowerCase()) ? `<span class="pill ok">In program</span>` : `<button class="btn sm" data-act="prPick" data-i="${i}">Add to ${first}'s program</button>`}</div>`).join("") || none("Nothing written yet. Type the first one above.");
    drawProtoSearch();
  }
  // The Protocol box is a search over everything that can go in a client's program: the protocols already written,
  // every pain track and Pain Tool protocol in the app, and the library programs. Each match has its own Add button
  // (the same actions as the lists below); a name that matches nothing is a new protocol, written in "What to do".
  function drawProtoSearch() {
    const box = $("#prFound"), inp = $("#prName"); if (!box || !inp) return;
    const q = inp.value.trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    const c = cache.chart.c, first = esc(String(cache.chart.d.name).split(" ")[0]), words = q.split(/\s+/);
    const hit = (t) => { const s = String(t || "").toLowerCase(); return words.every((w) => s.includes(w)); };
    const inPlan = new Set(((c.plan || {}).exercises || []).map((x) => String(x.name).toLowerCase()));
    const pres = new Set((c.assignedPain || []).map((x) => `${x.kind}:${x.id}`)), mineP = new Set((c.assignedPrograms || []).map((x) => x.id));
    const row = (title, sub, on, btn) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(title)}</b><div class="muted" style="font-size:12px">${esc(sub)}</div></span>${on ? `<span class="pill ok">${on}</span>` : btn}</div>`;
    const add = (attrs) => `<button type="button" class="btn sm" ${attrs}>Add to ${first}'s program</button>`;
    const rows = [
      ...(cache.protocols || []).map((p, i) => hit(`${p.name} ${p.detail || ""}`) && row(p.name, `Written protocol · used ${p.uses}×`, inPlan.has(p.name.toLowerCase()) && "In program", add(`data-act="prPick" data-i="${i}"`))),
      ...((painCat && painCat.all) || []).map((x) => hit(`${x.title} ${x.sub}`) && row(x.title, x.sub, pres.has(`${x.kind}:${x.id}`) && "Prescribed", add(`data-act="painAdd" data-kind="${x.kind}" data-id="${esc(x.id)}"`))),
      ...((cache.content && cache.content.programs) || []).map((p) => hit(`${p.title} ${p.category}`) && row(p.title, `Program · ${[p.category, p.weeks ? p.weeks + " weeks" : ""].filter(Boolean).join(" · ")}`, mineP.has(p.id) && "Assigned", add(`data-act="prAssign" data-id="${esc(p.id)}"`)))
    ].filter(Boolean);
    box.hidden = false;
    box.innerHTML = rows.slice(0, 12).join("") + (rows.length > 12 ? `<p class="muted" style="font-size:12px;margin:6px 0 0">${rows.length - 12} more. Keep typing to narrow it.</p>` : "")
      + `<p class="muted" style="font-size:12px;margin:6px 0 0">${rows.length ? "Not what you want?" : "No match."} Write it in "What to do" below to add "${esc(inp.value.trim())}" as a new protocol.</p>`;
  }
  document.addEventListener("input", (e) => { if (e.target && e.target.id === "prName") drawProtoSearch(); });
  const STATUS = { paid: "ok", unpaid: "warn", void: "", failed: "bad", refunded: "", pending: "warn" };
  async function loadBilling() {
    const id = state.chartClient, b = await load(`/emr/${id}/billing`).catch((e) => ({ error: e.message, invoices: [] }));
    if (state.chartClient !== id || !$("#billRows")) return;
    cache.billing = b; cache.billingFor = id;
    $("#billRows").innerHTML = b.error ? noneRow(6, esc(b.error)) : b.invoices.map((x) => `<tr><td>${esc(x.number || "—")}</td><td>${x.date ? fmtDate(x.date) : "—"}</td><td>${esc(x.description || "")}</td><td class="num">${x.amount == null ? "—" : usd(x.amount)}</td>
      <td><span class="pill ${STATUS[x.status] ?? "ok"}">${esc(x.status === "paid" && x.method ? `Paid · ${x.method}` : x.status.charAt(0).toUpperCase() + x.status.slice(1))}</span>${x.refunded && x.status !== "refunded" ? `<div class="muted" style="font-size:12px;margin-top:3px">${usd(x.refunded)} refunded</div>` : ""}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap;justify-content:flex-end">${x.custom && x.status === "unpaid" ? `<button class="btn sm primary" data-act="invSend" data-id="${esc(x.id)}">Send invoice</button><button class="btn sm" data-act="invPay" data-id="${esc(x.id)}">Mark paid</button><button class="btn sm ghost" data-act="invVoid" data-id="${esc(x.id)}" aria-label="Void invoice ${esc(x.number)}">${ui("x", 14)}</button>` : x.custom && !x.online && (x.status === "paid" || x.status === "void") ? `<button class="btn sm" data-act="invUnpaid" data-id="${esc(x.id)}">Mark unpaid</button>` : x.receiptUrl ? `<a class="btn sm" href="${esc(x.receiptUrl)}" target="_blank" rel="noopener noreferrer">Receipt</a>` : ""}${refundBtn(x, x.custom ? "invoice" : "charge")}</div></td></tr>`).join("") || noneRow(6, "No invoices or payments yet.");
    $("#billPay").innerHTML = `<div class="list-item"><span style="flex:1">Card on file${b.card && b.card.exp ? `<div class="muted" style="font-size:12px">expires ${esc(b.card.exp)}</div>` : ""}</span><b>${b.card ? `${esc(b.card.brand.charAt(0).toUpperCase() + b.card.brand.slice(1))} ••${esc(b.card.last4)}` : "None"}</b><button type="button" class="btn sm${b.card ? "" : " primary"}" data-act="cardAdd">${b.card ? "Replace" : "Add card"}</button></div>
      <div class="list-item"><span style="flex:1">Autopay</span><span class="pill ${b.autopay ? "ok" : ""}">${b.autopay ? "On" : "Off"}</span></div>
      <div class="list-item"><span style="flex:1">Balance</span><b class="num">${usd(b.balance || 0)}</b></div>`;
  }

  V.leads = async () => {
    const list = await load("/leads");
    const STAT = ["new", "contacted", "booked", "client", "closed"];
    return `<div class="view-head"><div><h1>Leads</h1><p class="muted">Requests from the website · ${plural(list.filter((l) => l.status === "new").length, "new request")}</p></div></div>
    <div class="stack">${list.map((l) => `<div class="card" data-lead="${esc(l.id)}"><div class="card-head"><div style="min-width:0"><h2>${esc(l.name)}</h2><span class="muted">${esc(l.email)}${l.phone ? " · " + esc(l.phone) : ""} · ${when(l.createdAt)}</span></div>
      <select class="input" style="width:auto" data-change="leadStatus" aria-label="Status">${STAT.map((s) => `<option${s === l.status ? " selected" : ""}>${s}</option>`).join("")}</select></div>
      <dl class="kv">${l.service ? `<dt>Service</dt><dd>${esc(l.service)}</dd>` : ""}${l.goal ? `<dt>Goal</dt><dd>${esc(l.goal)}</dd>` : ""}${(l.areas || []).length ? `<dt>Areas</dt><dd>${esc(l.areas.join(", "))}</dd>` : ""}${l.painLevel != null ? `<dt>Pain</dt><dd>${esc(l.painLevel)}/10</dd>` : ""}${l.duration ? `<dt>How long</dt><dd>${esc(l.duration)}</dd>` : ""}${l.message ? `<dt>Message</dt><dd>${esc(l.message)}</dd>` : ""}</dl>
      <div class="field" style="margin-top:10px"><label>Your notes<textarea class="input" rows="2" data-lead-notes>${esc(l.notes || "")}</textarea></label></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="leadSave">Save notes</button><button class="btn sm danger" data-act="leadDelete">Delete</button></div></div>`).join("") || `<div class="card">${none("No requests yet.")}</div>`}</div>`;
  };

  V.messages = async () => {
    const t = await load("/messages"); cache.unread = t.unread || 0;
    // someone who has never been written to has no conversation in the list yet: they are shown at the top of it
    const fresh = state.thread && !t.threads.find((x) => x.clientId === state.thread) ? (await clients().catch(() => [])).find((c) => c.id === state.thread) : null;
    if (fresh) t.threads = [{ clientId: fresh.id, name: fresh.name, unread: 0, last: null }, ...t.threads];
    if (!t.threads.find((x) => x.clientId === state.thread)) state.thread = t.threads[0] ? t.threads[0].clientId : null;
    // The list of people is drawn at once. A conversation that is not in memory yet follows as soon as it arrives:
    // it is never loaded ahead of time, because opening one marks its messages as read.
    // (A conversation already on the screen is simply waited for, so sending a message never blanks it.)
    const tid = state.thread, held = tid && mem.get(`/messages/${tid}`), open = shown === "messages" && cache.msgShown === tid && !!$("#msgList");
    const th = tid && ((held && held.epoch === epoch) || open) ? await load(`/messages/${tid}`) : null; cache.msgShown = th ? tid : null;
    if (tid && !th) load(`/messages/${tid}`).then(() => { if (token && routeNow() === "messages" && state.thread === tid) render(); }, (err) => { if (token && routeNow() === "messages" && state.thread === tid) { const box = $(".msgs"); if (box) box.innerHTML = `<p class="muted" style="padding:16px;margin:0">This conversation could not be loaded: ${esc(err.message)}</p>`; } });
    renderNav();
    return `<div class="view-head"><div><h1>Messages</h1><p class="muted">Conversations with members · stored encrypted on the server</p></div><button type="button" class="btn" data-act="broadcast">${ui("broadcast", 15)}Broadcast</button></div>
    <div class="card chat" style="padding:0">
      <div class="threads">${t.threads.map((x) => `<div class="thread ${x.clientId === state.thread ? "active" : ""}" data-act="thread" data-id="${esc(x.clientId)}">${avatar(x.name, 36)}<div style="flex:1;min-width:0"><div class="row" style="justify-content:space-between"><b>${esc(x.name)}</b>${x.unread ? `<span class="badge">${x.unread}</span>` : ""}</div><div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x.last ? (x.last.from === "doctor" ? "You: " : "") + esc(x.last.body) : "No messages yet"}</div></div></div>`).join("") || `<p class="muted" style="padding:16px;margin:0">No messages yet.</p>`}</div>
      <div class="msgs">${th ? `<div style="padding:12px 16px;border-bottom:1px solid var(--line)" class="row"><b>${esc(th.client.name)}</b><span class="muted" style="font-size:12px">${esc(th.client.email)}</span><button class="btn sm" style="margin-left:auto" data-act="chart" data-id="${esc(th.client.id)}">Chart</button></div>
        <div class="msg-list" id="msgList">${th.messages.map((m) => `<div class="bubble ${m.from === "doctor" ? "me" : ""}">${esc(m.body)}<div class="muted" style="font-size:11px;margin-top:2px">${when(m.at)}</div></div>`).join("")}</div>
        <form class="composer" data-form="message"><input name="body" class="input" placeholder="Write a message" autocomplete="off" maxlength="4000" aria-label="Message" required><button class="btn primary">Send</button></form>` : `<p class="muted" style="padding:16px;margin:0">${tid ? "Opening the conversation…" : "Pick a conversation."}</p>`}</div>
    </div>`;
  };

  V.telehealth = async () => {
    const [appts, settings, devices] = await Promise.all([load("/appointments?all=1"), part("/settings", "settings"), load("/telehealth/devices").catch(() => ({}))]); cache.devices = devices || {};
    const today = isoDay(new Date());
    const room = (settings && settings.booking && settings.booking.telehealthUrl) || "", own = location.origin + "/visit", usingOwn = room === own;
    const video = appts.filter((a) => a.date >= today && a.status === "booked" && (a.meetingLink || /remote|video|online|call/i.test(`${a.typeId} ${a.typeName}`)));
    const vb = (id, act, icon, label, on) => `<button type="button" class="vbtn${on ? " on" : ""}" id="${id}" data-act="${act}" aria-pressed="${on ? "true" : "false"}" aria-label="${label}" title="${label}">${ui(icon, 18)}</button>`;
    return `<div class="view-head"><div><h1>Telehealth</h1><p class="muted">Built-in video · encrypted browser to browser · never recorded · nothing to install</p></div>
      <button type="button" class="btn" data-act="copyRoom" data-url="${esc(own)}">${ui("copy", 15)}Copy session link</button></div>
    <div class="grid g-side">
      <div>
        <div class="tele-stage" id="teleStage">
          <div class="tele-avatar" aria-hidden="true">${ui("person", 46)}<span id="teleAvatarName"></span></div>
          <div class="tele-grid" id="teleGrid"></div>
          <canvas id="teleBoard" hidden aria-label="Shared whiteboard"></canvas>
          <video id="teleLocal" autoplay playsinline muted></video>
          <span class="tele-timer" id="teleTimer">00:00</span>
          <span class="tele-who" id="teleWho"></span>
          <button type="button" class="btn sm tele-clear" id="teleClear" data-act="teleClear" hidden>Clear board</button>
          <div class="tele-idle" id="teleIdle"><b>No visit in progress</b><span>Admit a patient from the waiting room to start. Your camera turns on when you admit.</span></div>
        </div>
        <div class="vcontrols" id="teleControls" hidden>
          ${vb("teleMic", "teleMic", "mic", "Microphone", true)}${vb("teleCam", "teleCam", "camera", "Camera", true)}${vb("teleShare", "teleShare", "screen", "Share your screen")}${vb("teleBoardBtn", "teleBoard", "board", "Open the whiteboard")}${vb("teleBlurBtn", "teleBlur", "blur", "Blur your background")}
          <span class="vwrap">${vb("teleChatBtn", "teleChat", "chat", "Open chat")}<i class="vdot" id="teleChatDot" hidden></i></span>${vb("teleScribeBtn", "teleScribeBtn", "spark", "Transcribe for the AI scribe")}
          <button type="button" class="vbtn end" data-act="teleEnd" aria-label="End visit" title="End visit">End</button>
        </div>
        <p class="muted" id="teleStatus" role="status" style="font-size:12.5px;text-align:center;margin:8px 0 0;min-height:1.4em"></p>
        <div class="card tele-chat" id="teleChatBox" hidden><div class="card-head"><h2>Chat</h2><span class="pill">Not saved</span></div>
          <div class="tele-chat-list" id="teleChatList" aria-live="polite"></div>
          <form class="composer" data-form="teleChat" style="padding:0;border:0"><input name="body" class="input" placeholder="Write to the patient" autocomplete="off" maxlength="1000" aria-label="Chat message" required><button class="btn primary">Send</button></form></div>
      </div>
      <div class="stack">
        <div class="card stack"><div class="card-head"><h2>Invite a client</h2><span class="muted" style="font-size:12px">App notice and email</span></div>
          <input class="input" id="teleInviteQ" type="search" placeholder="Search by name or email" aria-label="Search for a client to invite" autocomplete="off"><div id="teleInviteRes"></div></div>
        <div class="card"><div class="card-head"><h2>Waiting room</h2><div class="row" style="gap:6px"><span class="pill" id="teleCount">Empty</span><button type="button" class="btn sm ghost" data-act="refresh" aria-label="Refresh the waiting room" title="Refresh">${ui("refresh", 14)}</button></div></div><div id="teleWaiting"></div><div id="telePending"></div></div>
        <div class="card" id="teleRoomCard" hidden><div class="card-head"><h2>In the room</h2><span class="pill" id="teleRoomCount"></span></div><div id="teleRoom"></div></div>
        <div class="card"><div class="card-head"><h2>Session tools</h2></div>
          <div class="list-item"><span style="flex:1;min-width:0">Live room<div class="muted" style="font-size:12px" id="telePeople">One to one · private</div></span><label class="toggle"><input type="checkbox" id="teleGroupSw" data-change="teleGroup" aria-label="Live room: admit several people as viewers"><span></span></label></div>
          <div class="list-item"><span style="flex:1;min-width:0">Live transcription → AI scribe<div class="muted" style="font-size:12px" id="teleWords">Starts with a visit</div></span><label class="toggle"><input type="checkbox" id="teleScribeSw" data-change="teleScribe" aria-label="Live transcription" disabled><span></span></label></div>
          <div class="list-item"><span style="flex:1;min-width:0">Pain check-in<div class="muted" style="font-size:12px" id="telePain"></div></span><button type="button" class="btn sm" id="telePainBtn" data-act="telePain" disabled>Send</button></div>
          <div class="list-item"><span style="flex:1">Encryption</span><span class="pill ok">DTLS-SRTP</span></div>
          <div class="list-item"><span style="flex:1">Recording</span><span class="pill">Never recorded</span></div></div>
        <div class="card stack"><div class="card-head"><h2>Session link</h2>${settings ? `<span class="pill ${usingOwn ? "ok" : "warn"}">${usingOwn ? "Sent with video bookings" : room ? "Another link is in use" : "Not sent yet"}</span>` : ""}</div>
          <p class="muted" style="margin:0;font-size:13px;overflow-wrap:anywhere">${esc(own)}</p>
          <p class="muted" style="margin:0;font-size:12px">Patients sign in, check their camera and wait here until you admit them. ${!settings ? "Which link video bookings are sent is not available for your role: it is kept in Settings." : usingOwn ? "Every video booking is sent this link." : room ? `Video bookings are currently sent ${esc(room)}.` : "Video bookings are not sent a link yet."}</p>
          ${usingOwn || !settings ? "" : `<div class="row"><button type="button" class="btn sm primary" data-act="useOwnRoom">Send this link with every video booking</button></div>`}
          ${!settings ? "" : `<details><summary class="muted" style="font-size:12px;cursor:pointer">Use a different video service instead</summary>
            <form class="row" data-form="roomLink" style="align-items:flex-end;margin-top:8px"><div class="field" style="flex:1;min-width:200px;margin:0"><label for="roomUrl">Room link</label><input id="roomUrl" name="url" class="input" type="url" inputmode="url" placeholder="https://" value="${esc(usingOwn ? "" : room)}" maxlength="500"></div><button class="btn sm">Save</button></form></details>`}</div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Upcoming video visits</h2></div>
      ${video.map((a) => `<div class="list-item"><span style="flex:1"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${fmtDate(a.date)} · ${fmtTime(a.time)} · ${esc(a.typeName || "")}</div></span>${a.meetingLink && a.meetingLink !== own ? `<a class="btn sm" href="${/^https:\/\//i.test(a.meetingLink) ? esc(a.meetingLink) : "#"}" target="_blank" rel="noopener">Open their link</a>` : a.meetingLink ? `<span class="pill ok">Built-in room</span>` : `<span class="pill warn">No link yet</span>`}</div>`).join("") || none("No video visits booked. Schedule one from a client's chart, under Billing.")}</div>`;
  };

  // ---- Clinical notes. Staff only: drafts autosave, signing locks the note, later information goes in an addendum.
  // The "For the patient" box is separate: what is written there is what the patient reads in their app.
  const TEMPLATES = { soap: "SOAP note", evaluation: "Initial evaluation", followup: "Follow-up visit", discharge: "Discharge summary", free: "Free note" };
  const TIERS = { T1: "T1 · Standard clinical", T2: "T2 · Sensitive", T3: "T3 · Restricted" };
  const QUICK = ["Soft tissue work", "Assisted stretching", "Corrective exercise", "Medical massage", "Home program given", "Improving", "No change", "Flare-up"];
  const note = { id: null, clientId: null, template: "soap", tier: "T1", tags: [], dirty: false, savedAt: null, timer: 0, saving: null, has: false };
  const noteReset = (clientId) => { clearTimeout(note.timer); Object.assign(note, { id: null, clientId: clientId || null, template: "soap", tier: "T1", tags: [], dirty: false, savedAt: null, timer: 0, saving: null, has: false }); };
  const noteStamp = () => { const el = $("#nSaved"); if (el) el.textContent = note.saving ? "Saving…" : note.savedAt ? `Autosaved ${new Date(note.savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · encrypted` : note.dirty ? "Not saved yet" : "Nothing to save yet"; };
  // One save at a time; the first save creates the draft, later ones update it
  function noteSave(quiet) {
    clearTimeout(note.timer);
    const box = $("#nBody"); if (!box || !note.clientId) return Promise.resolve(null);
    const body = { text: box.value, template: note.template, tier: note.tier, tags: note.tags };
    if (!note.id && !box.value.trim()) return Promise.resolve(null);
    const run = async () => {
      const r = note.id ? await api("PUT", `/api/admin/notes/${note.id}`, body) : await api("POST", "/api/admin/notes", { clientId: note.clientId, ...body });
      note.id = r.id; note.dirty = false; note.savedAt = Date.now(); note.has = true; return r;
    };
    note.saving = (note.saving || Promise.resolve()).catch(() => {}).then(run).finally(() => { note.saving = null; noteStamp(); });
    noteStamp();
    return quiet ? note.saving.catch((err) => { toast("Autosave failed: " + err.message); return null; }) : note.saving;
  }
  const noteTouch = () => { note.dirty = true; noteStamp(); clearTimeout(note.timer); note.timer = setTimeout(() => noteSave(true), 5000); };
  // Moving the note screen to another client: the Client select and the client search above it both come through here.
  // A draft with unsaved words is saved first, while its box is still on the page.
  const noteClientSwitch = async (id) => { if (note.dirty) await noteSave(true); stopDictation(); state.chartClient = id; noteReset(id); return render(); };
  const qWords = (s) => String(s || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const noteClientFind = (list, q) => list.filter((c) => q.every((w) => `${c.name || ""} ${c.email || ""}`.toLowerCase().includes(w))).slice(0, 8);
  // The client search on the note screen: up to 8 clients whose name or email holds every word typed
  function noteClientType(el) {
    const q = qWords(el.value), box = $("#nClientRes"); if (!box) return;
    if (!q.length) { box.innerHTML = ""; return; }
    clients().then((list) => { const now = $("#nClientQ"), out = $("#nClientRes"); if (!now || !out || qWords(now.value).join(" ") !== q.join(" ")) return;
      out.innerHTML = noteClientFind(list, q).map((c) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email)}</div></span>${c.id === note.clientId ? `<span class="pill ok">Selected</span>` : `<button type="button" class="btn sm" data-act="noteClientPick" data-id="${esc(c.id)}" aria-label="Choose ${esc(c.name)}">Choose</button>`}</div>`).join("") || none("No client matches.");
    }).catch(() => {});
  }
  // Notes on file. Each row is kept as it is drawn, next to the words it can be found by: template, status, tier, tags,
  // the date as shown, and the text for a note whose text the list carries. A withheld note (T2, T3) is found by its
  // details only; its text is never searched or printed here, even when the open draft's text was fetched for the editor.
  const noteRow = (n) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(TEMPLATES[n.template] || "Note")}</b> <span class="pill ${n.status === "signed" ? "ok" : "warn"}">${n.status === "signed" ? "Signed" : "Draft"}</span>${n.tier !== "T1" ? ` <span class="pill">${esc(n.tier)}</span>` : ""}${n.addenda ? ` <span class="pill">${n.addenda} addend${n.addenda === 1 ? "um" : "a"}</span>` : ""}
          <div class="muted" style="font-size:12px">${when(n.signedAt || n.updatedAt)}${n.withheld ? " · open to read" : n.text ? " · " + esc(n.text.slice(0, 80)) + (n.text.length > 80 ? "…" : "") : ""}</div></span>
          ${n.status === "draft" ? `<button type="button" class="btn sm ghost" data-act="noteDiscard" data-id="${esc(n.id)}" aria-label="Discard this draft">${ui("x", 14)}</button>` : ""}<button type="button" class="btn sm" data-act="noteOpen" data-id="${esc(n.id)}">${n.status === "draft" ? "Continue" : "Open"}</button></div>`;
  const noteHay = (n) => [TEMPLATES[n.template] || "Note", n.status === "signed" ? "signed" : "draft", n.tier !== "T1" ? n.tier : "", (n.tags || []).join(" "), when(n.signedAt || n.updatedAt), !n.withheld && n.tier === "T1" && n.text ? n.text : ""].join(" ").toLowerCase();
  const noteFiledShow = (f) => { const q = qWords(f.q), hit = f.rows.filter((r) => q.every((w) => r.hay.includes(w))); return { on: q.length > 0, n: hit.length, html: hit.map((r) => r.html).join("") }; };
  // The search over the notes on file filters what the screen already loaded: nothing is requested
  function noteFiledType(el) {
    const f = cache.noteFiled, box = $("#nFiledList"); if (!f || !box || box.dataset.cid !== String(f.cid || "")) return;
    f.q = el.value; const s = noteFiledShow(f), count = $("#nFiledCount");
    box.innerHTML = s.html || none("No note matches."); if (count) count.textContent = s.on ? `${s.n} of ${f.rows.length}` : f.rows.length;
  }
  // What the AI assist reads: clinical content only. Names, contact details, birth date and signatures are left out
  // here, and the server strips names, emails, phone numbers and calendar dates again before anything is sent.
  async function noteBundle(cid) {
    const [c, emr, intake, notes] = await Promise.all([get(`/clients/${cid}`).catch(() => ({})), get(`/emr/${cid}`).catch(() => ({})), get(`/clients/${cid}/intake`).catch(() => ({ docs: [] })), get(`/notes?clientId=${cid}`).catch(() => ({ notes: [] }))]);
    const idf = /name|birth|dob|address|street|city|zip|phone|email|emergency|signature|contact|reach you/i, out = [];
    for (const d of intake.docs || []) { if (/information|consent|polic/i.test(d.title || "")) continue; const rows = (d.fields || []).filter((f) => !idf.test(f.label || "") && f.value !== "" && f.value != null && f.value !== false).map((f) => `- ${f.label}: ${Array.isArray(f.value) ? f.value.join(", ") : f.value === true ? "Yes" : f.value}`); if (rows.length) out.push(`INTAKE, ${d.title}:\n${rows.join("\n")}`); }
    const pain = (c.painLog || []).slice(-12).map((p) => `- ${p.area}: ${p.level}/10${p.note ? " (" + p.note + ")" : ""}`); if (pain.length) out.push("PAIN LOG, oldest to newest:\n" + pain.join("\n"));
    if (c.plan && (c.plan.notes || (c.plan.exercises || []).length)) out.push("CURRENT PLAN:\n" + [c.plan.notes, ...(c.plan.exercises || []).map((e) => `- ${e.name}${e.detail ? ": " + e.detail : ""}`)].filter(Boolean).join("\n"));
    const mv = (emr.movements || []).map((m) => `- ${m.name}${m.dose ? ", " + m.dose : ""}${m.cue ? " (" + m.cue + ")" : ""}`); if (mv.length) out.push("PRESCRIBED MOVEMENTS:\n" + mv.join("\n"));
    const pn = (emr.notes || []).slice(0, 6).reverse().map((n) => "- " + n.text); if (pn.length) out.push("NOTES GIVEN TO THE PATIENT, oldest to newest:\n" + pn.join("\n"));
    const cn = (notes.notes || []).filter((n) => n.status === "signed" && n.text).slice(0, 5).reverse().map((n) => `${TEMPLATES[n.template] || "Note"}:\n${n.text}`); if (cn.length) out.push("SIGNED CLINICAL NOTES, oldest to newest:\n" + cn.join("\n\n"));
    const visits = (c.appointments || []).filter((a) => a.status === "completed").length; if (visits) out.push(`VISITS COMPLETED: ${visits}`);
    return { text: out.join("\n\n").slice(0, 18000), intake, notes: notes.notes || [], client: c };
  }
  V.notes = async () => {
    const drawn = seq; // this render's number: only the render that reaches the page may keep its list for the search
    const [list, scribe] = await Promise.all([clients(), load("/scribe").catch(() => ({ enabled: false }))]);
    const heard = state.scribeText || ""; state.scribeText = "";
    const cid = list.find((c) => c.id === state.chartClient) ? state.chartClient : (list[0] ? list[0].id : null);
    if (note.clientId !== cid) noteReset(cid);
    const onFile = cid ? (await get(`/notes?clientId=${cid}`).catch(() => ({ notes: [], missing: true }))) : { notes: [] };
    const built = !onFile.missing, cur = note.id ? (onFile.notes || []).find((n) => n.id === note.id && n.status === "draft") : null;
    if (note.id && !cur) noteReset(cid);
    if (cur && cur.withheld) { const f = await get(`/notes/${cur.id}`).catch(() => null); if (f) cur.text = f.text; }
    const text = cur ? cur.text || "" : "", kinds = scribe.kinds || [], ai = scribe.enabled && kinds.includes("soap");
    const filed = { cid, q: cache.noteFiled && cache.noteFiled.cid === cid ? cache.noteFiled.q : "", rows: (onFile.notes || []).map((n) => ({ hay: noteHay(n), html: noteRow(n) })) }, shown = noteFiledShow(filed);
    if (drawn === seq) cache.noteFiled = filed;
    const sel = (id, name, map, val) => `<select id="${id}" class="input" data-change="${name}">${Object.entries(map).map(([k, v]) => `<option value="${k}"${k === val ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
    return `<div class="view-head"><div><h1>New note</h1><p class="muted">Rehab templates · AI drafts are reviewed and signed by you · clinical notes are staff only</p></div>
      <div class="row"><button type="button" class="btn" data-act="noteSave"${built && cid ? "" : " disabled"}>Save draft</button><button type="button" class="btn primary" data-act="noteSign"${built && cid ? "" : " disabled"}>Sign &amp; lock</button></div></div>
    ${built ? "" : `<div class="card" style="margin-bottom:16px">${none("Clinical notes are not available on the server yet. Deploy the latest backend to turn this screen on.")}</div>`}
    <div class="grid g-side"><div class="stack">
      <div class="card stack">
        <div><div class="search in">${ui("search", 14)}<input id="nClientQ" type="search" placeholder="Find a client by name or email" aria-label="Find a client for this note, by name or email" autocomplete="off"></div><div id="nClientRes"></div></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
          <div class="field" style="margin:0"><label for="nClient">Client</label><select id="nClient" class="input" data-change="noteClient">${list.map((c) => `<option value="${esc(c.id)}"${c.id === cid ? " selected" : ""}>${esc(c.name)}</option>`).join("") || `<option value="">No clients yet</option>`}</select></div>
          <div class="field" style="margin:0"><label for="nTemplate">Template</label>${sel("nTemplate", "noteTemplate", TEMPLATES, note.template)}</div>
          <div class="field" style="margin:0"><label for="nTier">Sensitivity</label>${sel("nTier", "noteTier", TIERS, note.tier)}</div>
        </div>
        <div><div class="row" style="gap:6px">${QUICK.map((q) => `<button type="button" class="chip${note.tags.includes(q) ? " on" : ""}" data-act="noteTag" data-tag="${esc(q)}" aria-pressed="${note.tags.includes(q)}">${esc(q)}</button>`).join("")}</div><div class="muted" style="font-size:12px;margin-top:4px">Quick picks</div></div>
        <div class="field" style="margin:0"><div class="row" style="justify-content:space-between"><label for="nBody" id="nBodyLabel">${esc(TEMPLATES[note.template])}</label><button type="button" class="btn sm mic" data-act="dictate" data-for="nBody" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div>
          <textarea id="nBody" class="input" style="min-height:300px" maxlength="20000" data-input="note" placeholder="Start typing, or use the AI scribe to draft from the session…"${built && cid ? "" : " disabled"}>${esc(text)}</textarea></div>
        <div class="row" style="justify-content:space-between"><div class="row"><button type="button" class="btn sm" data-act="noteCarry"${built && cid ? "" : " disabled"}>${ui("carry", 14)}Carry forward last plan</button><button type="button" class="btn sm" data-act="noteGoal"${built && cid ? "" : " disabled"}>${ui("plus", 14)}Link treatment goal</button></div><span class="muted" style="font-size:12px" id="nSaved" role="status"></span></div>
      </div>
      <div class="card stack"><div class="card-head"><h2>For the patient</h2><span class="pill">Optional</span></div>
        <div class="field" style="margin:0"><div class="row" style="justify-content:space-between"><label for="nPatient">What the patient reads in their app</label><span class="row" style="gap:6px"><button type="button" class="btn sm" data-act="notePatientDraft"${ai ? "" : " disabled"}>${ui("spark", 14)}Draft from the note</button><button type="button" class="btn sm mic" data-act="dictate" data-for="nPatient" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></span></div>
          <textarea id="nPatient" class="input" style="min-height:110px" maxlength="4000" placeholder="Plain words: what was worked on and what to do before next time"${cid ? "" : " disabled"}></textarea></div>
        <div class="row"><button type="button" class="btn" data-act="notePatientSend"${cid ? "" : " disabled"}>Share with the patient now</button><span class="muted" style="font-size:12px">Also shared when you sign the note, if this box has text. The clinical note itself is never shown to the patient.</span></div>
      </div>
      <div class="card"><div class="card-head"><h2>Notes on file</h2><span class="pill" id="nFiledCount">${shown.on ? `${shown.n} of ${filed.rows.length}` : filed.rows.length}</span></div>
        ${filed.rows.length ? `<div class="search in">${ui("search", 14)}<input id="nFiledQ" type="search" placeholder="Search these notes" aria-label="Search this client's notes on file" autocomplete="off" value="${esc(filed.q)}"></div>` : ""}
        <div id="nFiledList" data-cid="${esc(cid || "")}">${filed.rows.length ? shown.html || none("No note matches.") : none(cid ? "No clinical notes for this client yet." : "Pick a client.")}</div></div>
    </div>
    <div class="stack">
      <div class="card stack"><div class="card-head"><h2 class="row" style="gap:6px">${ui("spark", 18)}AI scribe</h2><span class="pill ${ai ? "ok" : ""}">${ai ? "On" : "Off"}</span></div>
        ${scribe.model || scribe.host ? `<div class="row" style="justify-content:space-between;font-size:12.5px"><span class="muted" style="overflow-wrap:anywhere">Model: <b id="sModel">${esc(scribe.model || "none chosen")}</b>${(scribe.backups || []).length ? ` · backup: ${scribe.backups.map((b) => esc(b.model)).join(", ")}` : ""}</span><button type="button" class="btn sm" data-act="scribeModels">Change model</button></div>` : ""}
        <div class="row"><button type="button" class="btn sm mic" data-act="dictate" data-for="sText" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button><button type="button" class="btn sm" disabled title="Needs a speech-to-text service with a signed agreement. None is connected.">${ui("upload", 14)}Upload audio</button></div>
        <div class="field" style="margin:0"><label for="sText">Or paste a summary or transcript</label><textarea id="sText" class="input" style="min-height:130px" maxlength="20000" placeholder="Right knee 3 weeks post-op, swelling down, soft tissue on the quad, heel slides 2x10 twice a day, back in a week.">${esc(heard)}</textarea></div>
        <button type="button" class="btn primary" data-act="noteScribe" style="justify-content:center"${ai && cid ? "" : " disabled"}>Draft <span id="sKind" style="margin:0 .3em">${esc(TEMPLATES[note.template])}</span></button>
        <p class="muted" style="font-size:12px;margin:0" id="sMsg" role="status">${ai ? `Writes in your template from what you give it, using ${esc(scribe.model)}. Names, emails, phone numbers and dates are removed before the text is sent. Nothing is saved until you save or sign.` : "Turns on once a language model is connected on the server."}</p></div>
      <div class="card"><div class="card-head"><h2>AI assist</h2></div>
        ${[["intake-summary", "Intake summary"], ["prep-brief", "Session prep brief"], ["client-summary", "Client summary"], ["treatment-plan", "Draft treatment plan"]].map(([k, l]) => `<div class="list-item"><span style="flex:1">${l}</span><button type="button" class="btn sm" data-act="noteAssist" data-kind="${k}" data-label="${l}"${ai && cid ? "" : " disabled"}>Generate</button></div>`).join("")}
        <p class="muted" style="font-size:12px;margin:8px 0 0">Reads this client's clinical record only, with identity fields left out. You review everything it writes.</p></div>
    </div></div>`;
  };

  V.forms = async () => {
    const list = await clients();
    const q = state.formsQ || "", todo = list.filter((c) => c.documents && !c.documents.complete).length;
    return `<div class="view-head"><div><h1>Forms & intake</h1><p class="muted">New patient documents: client information, pain assessment, history and consent</p></div></div>
    <div class="row" style="margin-bottom:12px;gap:10px"><div class="search" style="position:relative;flex:1 1 280px;max-width:440px"><input id="formsQ" class="input" type="search" autocomplete="off" placeholder="Search this list by name or email" aria-label="Search forms and intake by name or email" value="${esc(q)}"></div>
      <div class="seg" role="group" aria-label="Which clients to show"><button type="button" data-act="formsShow" data-show="" aria-pressed="${!state.formsShow}">All</button><button type="button" data-act="formsShow" data-show="todo" aria-pressed="${state.formsShow === "todo"}">Not finished (${todo})</button><button type="button" data-act="formsShow" data-show="done" aria-pressed="${state.formsShow === "done"}">Complete</button></div>
      <span class="muted" id="formsCount" style="font-size:12.5px" role="status"></span></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Client</th><th>Documents</th><th></th></tr></thead><tbody id="formsRows">
      ${list.map((c) => `<tr data-hay="${esc(`${c.name} ${c.email}`.toLowerCase())}" data-st="${c.documents && c.documents.complete ? "done" : c.documents ? "todo" : ""}"><td><b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.email)}</div></td><td>${c.documents ? (c.documents.complete ? `<span class="pill ok">Complete</span>` : `<span class="pill">${c.documents.done} of ${c.documents.total}</span>`) : "—"}</td><td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">${c.documents && !c.documents.complete ? `<button class="btn sm primary" data-act="intakeRemind" data-id="${esc(c.id)}" data-name="${esc(c.name)}">Notify to sign</button>` : ""}${c.documents && c.documents.done ? `<button class="btn sm" data-act="docsModal" data-id="${esc(c.id)}">View</button>` : ""}</div></td></tr>`).join("") || noneRow(3, "No clients yet.")}<tr id="formsNone" hidden><td colspan="3"><p class="muted" style="margin:0">No client matches.</p></td></tr></tbody></table></div></div>`;
  };
  // Forms & intake: the search box and the three buttons narrow the list that is already on the screen (nothing is
  // fetched, so it answers as you type)
  function formsFilter() {
    const box = $("#formsRows"); if (!box) return;
    const words = (state.formsQ || "").trim().toLowerCase().split(/\s+/).filter(Boolean), show = state.formsShow || "";
    let n = 0, all = 0;
    for (const tr of box.querySelectorAll("tr[data-hay]")) { all++; const on = words.every((w) => tr.dataset.hay.includes(w)) && (!show || tr.dataset.st === show); tr.hidden = !on; if (on) n++; }
    const none = $("#formsNone"); if (none) none.hidden = n > 0 || !all;
    const c = $("#formsCount"); if (c) c.textContent = words.length || show ? `${n} of ${all}` : `${all} clients`;
  }

  // ---- Small form pieces shared by the editing screens
  const fld = (id, name, label, val, o = {}) => `<div class="field"><label for="${id}">${label}</label>${o.area ? `<textarea id="${id}" name="${name}" class="input" rows="${o.rows || 3}" maxlength="${o.max || 500}" ${o.attrs || ""}>${esc(val ?? "")}</textarea>` : `<input id="${id}" name="${name}" class="input" type="${o.type || "text"}" value="${esc(val ?? "")}" ${o.max ? `maxlength="${o.max}"` : ""} ${o.attrs || ""}>`}</div>`;
  const sel = (id, name, label, opts, cur) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}" class="input">${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`; }).join("")}</select></div>`;
  const slugOf = (t) => (String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "item") + "-" + Math.random().toString(36).slice(2, 6);
  const xBtn = `<button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button>`;
  const DAYN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  V.programs = async () => {
    const c = cache.content = await load("/content");
    return `<div class="view-head"><div><h1>Programs</h1><p class="muted">${plural(c.programs.length, "program")} · ${plural((c.lectures || []).length, "lecture")} · what members see in the app</p></div><button class="btn primary" data-act="lectureEdit">${ui("plus", 14)} Lecture</button></div>
    <div class="grid g3">${c.programs.map((p) => `<div class="card stack"><div class="card-head"><h2>${esc(p.title)}</h2></div><div class="row" style="gap:6px"><span class="pill">${esc(p.category || "")}</span><span class="pill">${esc(p.level || "")}</span><span class="pill">${p.weeks} weeks</span><span class="pill ${p.access === "free" ? "ok" : ""}">${esc(p.access || "")}</span></div><p class="muted" style="margin:0">${esc(String(p.summary || "").slice(0, 160))}</p>
      <div class="row" style="margin-top:auto"><button class="btn sm" data-act="progEdit" data-id="${esc(p.id)}">Edit</button><button class="btn sm" data-act="progCopy" data-id="${esc(p.id)}">Duplicate</button><button class="btn sm danger" data-act="progDelete" data-id="${esc(p.id)}">Delete</button></div></div>`).join("") || `<div class="card">${none("No programs.")}</div>`}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Lectures</h2></div>${(c.lectures || []).map((l) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(l.title)}</b><div class="muted" style="font-size:12px">${esc(l.topic || "")} · ${l.minutes} min</div></span><span class="pill">${esc(l.access || "")}</span><button class="btn sm" data-act="lectureEdit" data-id="${esc(l.id)}">Edit</button><button class="btn sm ghost" data-act="lectureDelete" data-id="${esc(l.id)}" aria-label="Delete ${esc(l.title)}">${ui("x", 14)}</button></div>`).join("") || none("No lectures.")}</div>`;
  };

  V.nutrition = async () => {
    const c = cache.content = await load("/content"), recs = (c.recommendations || []);
    return `<div class="view-head"><div><h1>Nutrition</h1><p class="muted">Recommendations members see in the app</p></div><button class="btn primary" data-act="recEdit">${ui("plus", 14)} Recommendation</button></div>
    <div class="stack">${recs.map((r) => `<div class="card"><div class="card-head"><h2>${esc(r.title)}</h2><div class="row"><span class="pill">${esc(r.area || "")}</span><button class="btn sm" data-act="recEdit" data-id="${esc(r.id)}">Edit</button><button class="btn sm ghost" data-act="recDelete" data-id="${esc(r.id)}" aria-label="Delete ${esc(r.title)}">${ui("x", 14)}</button></div></div><p class="note-text muted">${esc(String(r.body || "").slice(0, 400))}</p></div>`).join("") || `<div class="card">${none("No recommendations.")}</div>`}</div>`;
  };

  V.fitness = async () => {
    const got = await part("/emr/pool", PHI), pool = (got && got.pool) || [], by = {};
    EXERCISES.forEach((e) => { by[e.region] = (by[e.region] || 0) + 1; });
    return `<div class="view-head"><div><h1>Fitness</h1><p class="muted">${plural(EXERCISES.length, "video")} in the movement library</p></div></div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Movements you prescribe most</h2></div>${pool.map((m) => `<div class="list-item"><span style="flex:1"><b>${esc(m.name)}</b>${m.dose ? ` <span class="pill">${esc(m.dose)}</span>` : ""}</span><span class="muted">${plural(m.uses, "time")}</span></div>`).join("") || none(got ? "Nothing prescribed yet. Add movements from a client's chart, under Plans." : "What is prescribed is part of the patient records, so it is not available for your role.")}</div>
    <div class="card"><div class="card-head"><h2>Library by body region</h2></div>${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<div class="list-item"><span style="flex:1">${esc(r)}</span><b class="num">${n}</b></div>`).join("") || none("No videos.")}</div></div>`;
  };

  V.payments = async () => {
    const [p, members, s, c, , gen] = await Promise.all([load("/payments"), part("/members", "clients"), part("/settings", "settings"), part("/content", "content"), partClients(), load("/invoices").catch(() => null)]);
    if (c) cache.content = c; if (s) cache.settings = s; cache.gen = gen;
    const sent = (gen && gen.invoices) || [], unpaid = sent.filter((x) => x.status === "unpaid");
    const stPill = (x) => (x.status === "paid" ? `<span class="pill ok">Paid${x.method ? " · " + esc(x.method) : ""}</span>` : x.status === "refunded" ? `<span class="pill">Refunded</span>` : x.status === "void" ? `<span class="pill">Void</span>` : `<span class="pill warn">Unpaid</span>`) + (x.refunded && x.status === "paid" ? ` <span class="muted" style="font-size:12px">${usd(x.refunded)} refunded</span>` : "");
    const genRow = (x) => `<tr><td><b>${esc(x.number)}</b><div class="muted" style="font-size:12px">${when(x.createdAt)}</div></td>
      <td><b>${esc(x.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(x.email)}${x.clientId ? "" : " · no account"}</div></td>
      <td style="max-width:260px;overflow-wrap:anywhere">${esc(x.description)}</td><td class="num" style="text-align:right"><b>${usd(x.amount)}</b></td>
      <td>${stPill(x)}${x.afterVoid ? ` <span class="pill bad">paid after void</span>` : ""}${(x.extra || []).map((e) => (e.refunded >= e.amount ? ` <span class="pill">Second payment refunded</span>` : ` <span class="pill bad">Paid twice</span> <span class="muted" style="font-size:12px">${usd(e.amount - (e.refunded || 0))} extra</span>`)).join("")}<div class="muted" style="font-size:12px;margin-top:3px">${x.status === "paid" && x.paidAt ? "paid " + when(x.paidAt) : x.emailedAt ? "emailed " + when(x.emailedAt) : "not emailed"}</div></td>
      <td><div class="row" style="gap:6px;justify-content:flex-end">${x.status === "unpaid" ? `<button type="button" class="btn sm primary" data-act="igSend" data-id="${esc(x.id)}">${x.emailedAt ? "Send again" : "Send"}</button><button type="button" class="btn sm" data-act="igCopy" data-id="${esc(x.id)}">${ui("copy", 13)}Link</button><button type="button" class="btn sm" data-act="igPaid" data-id="${esc(x.id)}">Mark paid</button><button type="button" class="btn sm ghost" data-act="igVoid" data-id="${esc(x.id)}" aria-label="Void invoice ${esc(x.number)}">${ui("x", 13)}</button>` : ""}${refundBtn(x, "link")}${(x.extra || []).filter((e) => e.amount > (e.refunded || 0)).map((e) => `<button type="button" class="btn sm danger" data-act="refundAsk" data-kind="extra" data-id="${esc(x.id)}" data-session="${esc(e.sessionId)}" data-left="${e.amount - (e.refunded || 0)}" data-what="the second payment on ${esc(x.number)}">Refund the second payment</button>`).join("")}${x.clientId ? `<button type="button" class="btn sm" data-act="chartBilling" data-id="${esc(x.clientId)}">Billing</button>` : ""}</div></td></tr>`;
    return `<div class="view-head"><div><h1>Payments</h1><p class="muted">Self-pay only · card payments through Stripe · send an invoice from here, or write one on a client's chart</p></div>${navOk("settings") ? `<a class="btn" href="#settings">Services &amp; fees</a>` : ""}</div>
    <div class="grid g3" style="margin-bottom:16px">${kpi("Card payments", p.enabled ? "On" : "Off", p.enabled ? "Stripe connected" : "Stripe not set up", p.enabled ? "ok" : "warn")}${kpi("Payment confirmations", p.webhook ? "On" : "Off", "from Stripe", p.webhook ? "ok" : "warn")}${members ? kpi("Members and requests", members.length, "people") : ""}</div>
    <div class="card" style="margin-bottom:16px" id="genCard"><div class="card-head"><div><h2>Invoices</h2><p class="muted" style="margin:2px 0 0;font-size:12.5px">Draft one invoice, send it to one person or many. Each gets their own, with a link to pay by card.${unpaid.length ? ` <b>${plural(unpaid.length, "invoice")} unpaid: ${usd(unpaid.reduce((n, x) => n + x.amount, 0))}.</b>` : ""}</p></div>
        <button type="button" class="btn primary" data-act="igNew">${ui("plus", 14)} New invoice</button></div>
      ${!gen ? none("Invoices could not be loaded.") : sent.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>To</th><th>For</th><th style="text-align:right">Amount</th><th>Status</th><th></th></tr></thead><tbody>${sent.slice(0, state.genAll ? 300 : 12).map(genRow).join("")}</tbody></table></div>${sent.length > 12 && !state.genAll ? `<p style="margin:10px 0 0"><button type="button" class="btn sm" data-act="igAll">Show all ${sent.length}</button></p>` : ""}` : none("No invoices sent from here yet.")}
      ${gen && !gen.payments ? `<p class="muted" style="margin:10px 0 0;font-size:12.5px">Card payments are not switched on, so invoices can be written and marked paid by hand but not emailed with a payment link.</p>` : gen && !gen.email ? `<p class="muted" style="margin:10px 0 0;font-size:12.5px">Email is not switched on for the server: create invoices and copy their links.</p>` : ""}</div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Members and requests</h2><span class="muted" style="font-size:12px">Change a membership type here</span></div>${!members ? none("The member list is not available for your role.") : members.map((m) => `<div class="list-item member-row"><span class="who"><b>${esc(m.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(m.email)}</div>${m.request && !m.membership ? `<div class="muted" style="font-size:12px">Asked for ${esc(tierName(m.request.tier))}</div>` : ""}</span><select class="input tier-pick${m.membership ? " on" : ""}" data-change="rowTier" data-id="${esc(m.id)}" data-name="${esc(m.name)}" aria-label="Membership type for ${esc(m.name)}">${tierOptions((m.membership && m.membership.tier) || "")}</select><button class="btn sm" data-act="chart" data-id="${esc(m.id)}">Chart</button></div>`).join("") || none("No members or requests yet.")}</div>
    <div class="card stack"><div class="card-head"><h2>Membership types</h2><span class="muted" style="font-size:12px">What members can sign up for</span></div>
      ${!c ? none("Membership types are not available for your role.") : `<form class="stack" data-form="setTiers">${(c.tiers || []).map((t, i) => `<div class="stack" style="border-bottom:1px solid var(--line);padding-bottom:12px"><div class="grid g2">${fld("tn" + i, "name" + i, "Name", t.name, { max: 60 })}${fld("tp" + i, "price" + i, "Price per month ($)", t.price, { type: "number", attrs: 'min="0" step="0.01"' })}</div>
        <div class="grid g2">${fld("tm" + i, "meetings" + i, "1-on-1 calls per month", t.meetings || 0, { type: "number", attrs: 'min="0" max="31"' })}${fld("tl" + i, "minutes" + i, "Minutes per call", t.meetingMinutes || 0, { type: "number", attrs: 'min="0" max="180"' })}</div>
        ${fld("tk" + i, "perks" + i, "What it includes (one per line)", (t.perks || []).join("\n"), { area: true, rows: 3, max: 1300 })}
        <label class="row" for="td${i}" style="gap:8px;flex-wrap:nowrap"><input type="checkbox" id="td${i}" name="direct${i}"${t.directMessages ? " checked" : ""}><span>Can message Dr. Jared directly</span></label></div>`).join("")}
      <div class="row"><button class="btn primary">Save membership types</button></div><p class="muted" style="margin:0;font-size:12.5px">A price change applies to people who join from now on. Current members keep what their card is already charged.</p></form>`}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Clients with payments</h2></div>${(p.clients || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name || x.email || "")}</b></span><button class="btn sm" data-act="chartBilling" data-id="${esc(x.id)}">Billing</button></div>`).join("") || none("No payments recorded.")}</div>`;
  };

  V.newsletter = async () => {
    const list = await load("/subscribers");
    return `<div class="view-head"><div><h1>Newsletter</h1><p class="muted">${plural(list.length, "subscriber")}</p></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Email</th><th>Joined</th><th></th></tr></thead><tbody>
    ${list.map((s) => `<tr><td>${esc(s.email)}</td><td class="muted">${when(s.createdAt)}</td><td><button class="btn sm danger" data-act="unsubscribe" data-email="${esc(s.email)}">Remove</button></td></tr>`).join("") || noneRow(3, "No subscribers yet.")}</tbody></table></div></div>`;
  };

  // Insights: the admin portal's Insights section. Analytics (website traffic, search, email alerts) and Audit.
  const ledgerTable = (a) => `<div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Audit ledger</h2><span class="muted" style="font-size:12px">Newest ${Math.min(100, a.entries.length)} entries</span></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>Who</th><th>Action</th><th>Subject</th></tr></thead><tbody>
    ${a.entries.slice(0, 100).map((e) => `<tr><td class="num muted">${e.seq}</td><td class="num">${when(e.ts)}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td class="muted">${esc(e.subject || "")}</td></tr>`).join("") || noneRow(5, "No entries.")}</tbody></table></div></div>`;
  const mixCard = (title, rows) => `<div class="card"><h2 style="margin-bottom:10px">${title}</h2>${(rows || []).length ? rows.map((r) => `<div style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><span>${esc(r.name)}</span><span class="num muted">${esc(r.pct)}% · ${esc(r.views)}</span></div><div class="bar"><i style="width:${Math.max(2, Math.min(100, Number(r.pct) || 0))}%"></i></div></div>`).join("") : none("No data yet.")}</div>`;
  // The people behind one of the counts on Insights: who they are, and a button to each chart
  function insPeople() {
    const g = state.insList && cache.insGroups && cache.insGroups[state.insList]; if (!g) return "";
    const [title, list] = g, rows = list.slice().sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? 1 : -1));
    return `<div class="card" style="margin-bottom:16px;padding-bottom:6px"><div class="card-head"><h2>${esc(title)} <span class="muted" style="font-weight:500">(${rows.length})</span></h2><button type="button" class="btn sm ghost" data-act="insList" data-key="${esc(state.insList)}" aria-label="Close this list">${ui("x", 14)}</button></div>
      <div style="max-height:440px;overflow:auto">${rows.map((c) => `<div class="list-item">${avatar(c.name, 28)}<span style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email)} · joined ${when(c.createdAt)}${c.membership ? ` · ${esc(tierName(c.membership.tier))}${c.membership.until ? ", paid through " + esc(c.membership.until) : ""}` : ""}</div></span><button type="button" class="btn sm" data-act="chart" data-id="${esc(c.id)}">Chart</button></div>`).join("") || none("Nobody in this group.")}</div></div>`;
  }
  // Which app settings members chose (server: GET /analytics/looks). Counts only, most changed first.
  const LOOK_WORDS = { full: "Full", simple: "Simple", white: "White", black: "Black", comfortable: "Comfortable", compact: "Compact", on: "On", off: "Off", all: "All", streaks: "Streaks only" };
  // What members do once inside the app (server: GET /analytics/members). Counts only.
  function insideCard(mi) {
    if (!mi) return "";
    const n = mi.members || 0, pct = (a, b) => (b ? Math.round((a / b) * 100) : 0), of = (a, b) => `${a} of ${b}`;
    const a = mi.active, cb = mi.cameBack, dr = mi.dropOff, pd = mi.paid, ac = mi.actions, top = (mi.screens || [])[0];
    const line = (label, x) => `<div class="list-item"><span style="flex:1">${label}</span><span class="num"><b>${x.count}</b> <span class="muted" style="font-size:12px">by ${x.people} ${x.people === 1 ? "member" : "members"}</span></span></div>`;
    return `<div class="view-head" style="margin:8px 0 10px"><div><h2 style="margin:0">Inside the app</h2><p class="muted" style="margin:2px 0 0">What members do after they sign in. Counts only, from the app itself.</p></div></div>
    <div class="grid g4" style="margin-bottom:16px">${kpi("Active today", a.today, `${pct(a.today, n)}% of ${n} accounts`)}${kpi("Active this week", a.week, `${pct(a.week, n)}% of accounts`)}${kpi("Active this month", a.month, `${pct(a.month, n)}% of accounts`)}${kpi("Came back after week one", cb.eligible ? pct(cb.returned, cb.eligible) + "%" : "–", cb.eligible ? of(cb.returned, cb.eligible) + " accounts a week old or more" : "no account is a week old yet")}</div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h2>What gets used (${mi.days}d)</h2><span class="muted" style="font-size:12px">${top ? `Most opened: ${esc(top.label)}` : ""}</span></div>
        ${(mi.screens || []).map((x) => `<div style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><span>${esc(x.label)}</span><span class="num muted">${x.people} ${x.people === 1 ? "member" : "members"} · ${x.minutes} min</span></div><div class="bar"><i style="width:${Math.max(2, pct(x.people, (top || {}).people || 1))}%"></i></div></div>`).join("") || none("Nobody has opened the app in this period.")}</div>
      <div>
        <div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:6px">What gets done (${mi.days}d)</h2>${line("Workouts logged", ac.workouts)}${line("Pain check-ins", ac.pain)}${line("Daily habit checks", ac.checks)}${line("Things sent to another member", ac.sends)}</div>
        <div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:6px">Free to paid</h2>
          <div class="list-item"><span style="flex:1">Sign-ups in the last ${mi.days} days now paying by card</span><span class="num"><b>${pd.signups ? pct(pd.paying, pd.signups) + "%" : "–"}</b> <span class="muted" style="font-size:12px">${of(pd.paying, pd.signups)}</span></span></div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">${(pd.before || []).length ? `Before paying, the ${pd.payingAll} paying ${pd.payingAll === 1 ? "member" : "members"} had opened: ${pd.before.map((x) => `${esc(x.label)} (${x.people})`).join(", ")}.` : "Once someone pays by card, the screens they opened beforehand are listed here."}</p></div>
        <div class="card"><h2 style="margin-bottom:6px">Drop-off</h2>
          <div class="list-item"><span style="flex:1">Never came back after the day they joined</span><span class="num"><b>${dr.eligible ? pct(dr.neverReturned, dr.eligible) + "%" : "–"}</b> <span class="muted" style="font-size:12px">${of(dr.neverReturned, dr.eligible)}</span></span></div>
          <div class="list-item"><span style="flex:1">Used the app, then quiet for 14 days</span><span class="num"><b>${dr.eligible ? pct(dr.wentQuiet, dr.eligible) + "%" : "–"}</b> <span class="muted" style="font-size:12px">${of(dr.wentQuiet, dr.eligible)}</span></span></div></div>
      </div>
    </div>`;
  }
  function looksCard(lk) {
    if (!lk || !(lk.looks || []).length) return "";
    const total = lk.members || 0, top = lk.looks[0];
    return `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>App settings members chose</h2><span class="muted" style="font-size:12px">${top.changed ? `Most changed: ${esc(top.label)}` : "Nobody has changed a setting yet"}</span></div>
      ${lk.looks.map((l) => { const pct = total ? Math.round((l.changed / total) * 100) : 0; return `<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><span><b>${esc(l.label)}</b> <span class="muted" style="font-size:12px">${Object.entries(l.counts).map(([k, n]) => `${esc(LOOK_WORDS[k] || k)} ${n}`).join(" · ")}</span></span><span class="num muted">${pct}% changed it · moved ${l.moves} ${l.moves === 1 ? "time" : "times"}</span></div><div class="bar"><i style="width:${Math.max(2, pct)}%"></i></div></div>`; }).join("")}
      <p class="muted" style="font-size:12px;margin:0">Out of ${total} ${total === 1 ? "account" : "accounts"}. "Changed it" means the setting is off its starting choice now; "moved" counts every switch from today on.</p></div>`;
  }
  V.insights = async () => {
    const tabs = `<div class="tabs" role="tablist">${[["analytics", "Analytics"], ["audit", "Audit"]].filter(([t]) => t !== "audit" || can("security")).map(([t, l]) => `<button class="tab ${(state.insTab === "audit" && can("security") ? "audit" : "analytics") === t ? "active" : ""}" role="tab" data-act="insTab" data-tab="${t}">${l}</button>`).join("")}</div>`;
    if (state.insTab === "audit" && can("security")) {
      const a = await load("/audit");
      return `<div class="view-head"><div><h1>Insights</h1><p class="muted">Every sign-in, every look at a record and every change</p></div><button class="btn primary" data-act="auditVerify">Verify the ledger</button></div>${tabs}
      <div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:10px">Ledger check</h2><div id="auditResult">${none("Not checked in this session. Press Verify.")}</div></div>${ledgerTable(a)}`;
    }
    const days = state.insDays;
    const [d, sa, mail, people0, , rf, lg, lk, mi] = await Promise.all([load(`/analytics?days=${days}`), load(`/search-analytics?days=${days}`).catch(() => null), load("/email-log").catch(() => null), partClients(), content(),
      load(`/referrals?days=${days}`).catch(() => null), load(`/logs/summary?days=${Math.min(days, 90)}`).catch(() => null), load("/analytics/looks").catch(() => null), load(`/analytics/members?days=${days}`).catch(() => null)]);
    // Sign-ups and members, counted from the accounts themselves. "Paying" means a card subscription is running;
    // a membership set by hand (no card on a schedule) is counted separately so the two are never confused.
    const people = people0 || [], since = Date.now() - days * 864e5, fresh = people.filter((c) => c.createdAt && Date.parse(c.createdAt) >= since).length;
    const paying = people.filter((c) => c.membership && c.membership.stripeSubscriptionId), byHand = people.filter((c) => c.membership && !c.membership.stripeSubscriptionId);
    const tierRows = tiers().map((t) => ({ id: t.id, name: t.name, price: t.price, pay: paying.filter((c) => c.membership.tier === t.id).length, hand: byHand.filter((c) => c.membership.tier === t.id).length })).filter((r) => r.pay || r.hand);
    const monthly = tierRows.reduce((n, r) => n + r.pay * (Number(r.price) || 0), 0);
    // Every count on this screen opens the list of people behind it, each with a button to their chart
    const groups = { all: ["All sign-ups", people], fresh: [`New sign-ups in the last ${days} days`, people.filter((c) => c.createdAt && Date.parse(c.createdAt) >= since)], paying: ["Paying members", paying], hand: ["Members set by hand", byHand] };
    for (const t of tiers()) { groups["paying:" + t.id] = [`${t.name}: paying`, paying.filter((c) => c.membership.tier === t.id)]; groups["hand:" + t.id] = [`${t.name}: set by hand`, byHand.filter((c) => c.membership.tier === t.id)]; }
    cache.insGroups = groups;
    const tile = (key, label, val, sub, kind) => `<button type="button" class="card kpi kpi-btn" data-act="insList" data-key="${key}" aria-expanded="${state.insList === key}" aria-controls="insPeople"><span class="muted">${label}</span><b class="num">${val}</b><small class="${kind ? "pill " + kind : "muted"}">${sub}</small><span class="kpi-more">${ui("next", 12)} See the list</span></button>`;
    const s = d.summary, m = d.mix || {}, st = (sa && sa.totals) || {};
    const qRows = (list) => (list || []).slice(0, 10).map((r) => `<tr><td>${esc(r.q)}</td><td class="num">${esc(r.impressions)}</td><td class="num">${esc(r.clicks)}</td><td class="num">${esc(r.ctr)}%</td></tr>`).join("") || noneRow(4, "No data yet.");
    return `<div class="view-head"><div><h1>Insights</h1><p class="muted">Sign-ups, members, website traffic, search and alerts</p></div>
      <select class="input" style="width:auto" data-change="insDays" aria-label="Period">${[7, 30, 90].map((n) => `<option value="${n}"${n === days ? " selected" : ""}>Last ${n} days</option>`).join("")}</select></div>${tabs}
    ${!people0 ? `<div style="margin-bottom:16px">${notYours("Sign-ups and members")}</div>` : `<div class="grid g4" style="margin-bottom:16px">${tile("all", "Total sign-ups", people.length, "accounts, all time")}${tile("fresh", `New sign-ups (${days}d)`, fresh, "accounts created")}${tile("paying", "Paying members", paying.length, "card subscription running", paying.length ? "ok" : "")}${tile("hand", "Members set by hand", byHand.length, "no card subscription")}</div>
    <div id="insPeople">${insPeople()}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Members by type</h2><span class="muted" style="font-size:12px">${paying.length ? `About ${money(Math.round(monthly))} a month from card subscriptions, before discounts` : "No card subscriptions running"}</span></div>
      ${tierRows.map((r) => `<div class="list-item"><span style="flex:1"><b>${esc(r.name)}</b></span><button type="button" class="pill pill-btn ${r.pay ? "ok" : ""}" data-act="insList" data-key="paying:${esc(r.id)}"${r.pay ? "" : " disabled"}>${r.pay} paying</button>${r.hand ? `<button type="button" class="pill pill-btn" data-act="insList" data-key="hand:${esc(r.id)}">${r.hand} set by hand</button>` : ""}</div>`).join("") || none("Nobody has a membership yet.")}</div>`}
    ${insideCard(mi)}${looksCard(lk)}
    <div class="grid g4" style="margin-bottom:16px">${kpi("Views today", s.todayViews, "page views")}${kpi("Visitors today", s.todayUnique, "people")}${kpi(`Views (${d.rangeDays || days}d)`, s.totalViews, "page views")}${kpi(`Visitors (${d.rangeDays || days}d)`, s.totalUnique, "people")}</div>
    <div class="grid g2">
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>By day</h2></div><div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Views</th><th class="num">Visitors</th></tr></thead><tbody>${(d.days || []).slice().reverse().slice(0, 31).map((r) => `<tr><td>${fmtDate(r.date)}</td><td class="num">${r.views}</td><td class="num">${r.unique}</td></tr>`).join("") || noneRow(3, "No data yet.")}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Top pages</h2></div><div class="table-wrap"><table><thead><tr><th>Page</th><th class="num">Views</th></tr></thead><tbody>${(d.pages || []).slice(0, 15).map((r) => `<tr><td>${esc(r.page)}</td><td class="num">${r.views}</td></tr>`).join("") || noneRow(2, "No data yet.")}</tbody></table></div></div>
    </div>
    <div class="grid g3" style="margin-top:16px">${mixCard("Device", m.devices)}${mixCard("Where they came from", m.sources)}${mixCard("Location", m.places)}${mixCard("Operating system", m.os)}${mixCard("Browser", m.browsers)}${mixCard("Country", m.countries)}</div>
    <div class="card" style="padding:0;margin-top:16px"><div class="card-head" style="padding:14px 16px 0"><h2>Referring sites</h2></div><div class="table-wrap"><table><thead><tr><th>Source</th><th class="num">Views</th></tr></thead><tbody>${(d.referrers || []).map((r) => `<tr><td>${esc(r.source)}</td><td class="num">${r.views}</td></tr>`).join("") || noneRow(2, "No referral traffic yet.")}</tbody></table></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Site search: top queries</h2><span class="muted" style="font-size:12px">${st.searches != null ? st.searches : (st.events || 0)} searches · ${st.uniqueQueries || 0} different${st.ctr != null ? ` · ${st.ctr}% clicked` : ""}</span></div><div class="table-wrap"><table><thead><tr><th>Query</th><th class="num">Searches</th><th class="num">Clicks</th><th class="num">CTR</th></tr></thead><tbody>${qRows(sa && sa.top)}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Site search: nothing found</h2></div><div class="table-wrap"><table><thead><tr><th>Query</th><th class="num">Searches</th><th class="num">Clicks</th><th class="num">CTR</th></tr></thead><tbody>${qRows(sa && sa.zeroResult)}</tbody></table></div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Referral sign-ups</h2><span class="muted" style="font-size:12px">${rf ? `${(rf.totals || {}).referred || 0} in ${days} days · ${(rf.totals || {}).referredAllTime || 0} all time · ${(rf.totals || {}).share || 0}% of new accounts` : "Not available yet"}</span></div><div class="table-wrap" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>Referred by</th><th class="num">In range</th><th class="num">All time</th><th>Latest</th></tr></thead><tbody>${((rf && rf.topReferrers) || []).map((r) => `<tr><td>${esc(r.referrer)}</td><td class="num">${esc(r.inRange)}</td><td class="num">${esc(r.total)}</td><td>${esc(when(r.lastAt))}</td></tr>`).join("") || noneRow(4, "No referral sign-ups yet.")}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>All referred accounts</h2></div><div class="table-wrap" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>New account</th><th>Referred by</th><th>How</th><th>Signed up</th><th>Member</th></tr></thead><tbody>${((rf && rf.recent) || []).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.referrer)}</td><td>${esc(({ email: "Email sign-up", google: "Google", apple: "Apple", claim: "Added after joining" })[r.via] || "Before tracking")}</td><td>${esc(when(r.at))}</td><td>${r.member ? "Yes" : "No"}</td></tr>`).join("") || noneRow(5, "No data yet.")}</tbody></table></div></div>
      ${(() => { const ev = (rf && rf.events) || null, t = (ev && ev.totals) || {}; return `<div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Referral sharing</h2><span class="muted" style="font-size:12px">${ev ? `${t.copies || 0} code copies · ${t.linkCopies || 0} link copies · ${t.shares || 0} link shares · ${t.linkVisits || 0} link visits · ${t.claims || 0} codes added after joining in ${days} days${ev.since ? ` · recorded since ${esc(when(ev.since))}` : ""}` : "Not available yet"}</span></div><div class="table-wrap" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>Member</th><th class="num">Copied code</th><th class="num">Copied link</th><th class="num">Shared link</th><th class="num">Link opened</th><th>Last</th></tr></thead><tbody>${((ev && ev.members) || []).map((m) => `<tr><td>${esc(m.member)}</td><td class="num">${esc(m.copies)}</td><td class="num">${esc(m.linkCopies || 0)}</td><td class="num">${esc(m.shares)}</td><td class="num">${esc(m.linkVisits)}</td><td>${esc(when(m.lastAt))}</td></tr>`).join("") || noneRow(6, "No Copy or Share presses recorded yet.")}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Codes that matched nobody</h2><span class="muted" style="font-size:12px">${ev ? `${t.unmatchedCodes || 0} in ${days} days · mistyped or old codes; the referrer got no credit` : "Not available yet"}</span></div><div class="table-wrap" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>Code typed</th><th>Account</th><th>How</th><th>When</th></tr></thead><tbody>${((ev && ev.unmatched) || []).map((u) => `<tr><td><code>${esc(u.code)}</code></td><td>${esc(u.name)}</td><td>${esc(({ email: "Email sign-up", google: "Google", apple: "Apple", claim: "Added after joining" })[u.via] || "")}</td><td>${esc(when(u.at))}</td></tr>`).join("") || noneRow(4, "None.")}</tbody></table></div></div>`; })()}
    </div>
    <div class="card" style="padding:0;margin-top:16px"><div class="card-head" style="padding:14px 16px 0"><h2>Server activity log</h2><span class="muted" style="font-size:12px">${lg ? `${(lg.totals || {}).requests || 0} requests · ${(lg.totals || {}).s5xx || 0} failed · ${(lg.totals || {}).restarts || 0} restarts · kept 90 days` : "Not available yet"}</span></div><div class="table-wrap"><table><thead><tr><th>Day</th><th class="num">Requests</th><th class="num">Failed</th><th class="num">Warnings</th><th class="num">Errors</th><th class="num">Restarts</th></tr></thead><tbody>${((lg && lg.perDay) || []).slice().reverse().slice(0, 21).map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td class="num">${esc(r.requests)}</td><td class="num">${esc(r.s5xx)}</td><td class="num">${esc(r.warn)}</td><td class="num">${esc(r.error)}</td><td class="num">${esc(r.restarts)}</td></tr>`).join("") || noneRow(6, "Recording starts when the backend update is live.")}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Email alerts</h2><span class="pill ${mail && mail.enabled ? "ok" : "warn"}">${mail && mail.enabled ? "On" : "Off"}</span></div>
      ${mail ? `<p class="muted" style="margin:0">Alerts go to ${esc((mail.alertsTo || []).join(", ") || "nobody yet")}. ${plural((mail.failures || []).length, "failed send")} on record.</p>` : none("Email log unavailable.")}</div>`;
  };

  // ---- System economics: what the system takes in, what it costs to run, and what is left. Every figure is read
  // from a record (Stripe's balance history, the invoices on the charts, the member list, the calendar); the running
  // costs are the owner's own entries. Where a source cannot be read the screen says so and leaves the figure out.
  const monthName = (ym, long) => new Date(ym + "-15T12:00:00Z").toLocaleDateString("en-US", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  const ECO_USES = ["Railway (server)", "Vercel (website)", "Bunny (video)", "Resend (email)", "AI scribe"];
  // Revenue, expenses and system cost side by side, month by month. Columns share one dollar axis; the same numbers
  // are in the table underneath, and resting on (or tabbing to) a month shows them all.
  function ecoChart(rows) {
    const top = Math.max(1, ...rows.flatMap((r) => [r.revenue, r.expenses, r.system]));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * 10 ** Math.floor(Math.log10(top / 4))).find((x) => x * 4 >= top) || top / 4, max = step * 4;
    const tick = (c) => { const d = c / 100; return "$" + (max >= 1000000 ? (d / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K" : d.toLocaleString("en-US", { maximumFractionDigits: d < 10 && d % 1 ? 2 : 0 })); };
    const col = (v, k) => `<span class="eco-bar s${k}" style="height:${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2)}%"></span>`;
    const key = (k, label) => `<span class="eco-key"><i class="s${k}"></i>${label}</span>`;
    return `<div class="eco-chart" role="group" aria-label="Revenue, expenses and system cost by month. The same figures are in the table below.">
      <div class="eco-legend">${key(1, "Revenue")}${key(2, "Expenses")}${key(3, "System cost")}</div>
      <div class="eco-plot"><div class="eco-y" aria-hidden="true">${[4, 3, 2, 1, 0].map((k) => `<span>${tick(step * k)}</span>`).join("")}</div>
        <div class="eco-area">${[0, 1, 2, 3, 4].map((k) => `<i class="eco-grid" style="bottom:${k * 25}%"></i>`).join("")}
          ${rows.map((r, n) => `<div class="eco-g${n > rows.length / 2 ? " late" : ""}" tabindex="0" role="button" data-act="ecoOpen" data-m="${r.m}" aria-expanded="${state.ecoOpen === r.m}" aria-controls="ecoDetail" aria-label="${esc(monthName(r.m, true))}${r.partial ? " so far" : ""}: revenue ${usd(r.revenue)}, expenses ${usd(r.expenses)}, system cost ${usd(r.system)}, left ${usd(r.left)}">
            <div class="eco-cols">${col(r.revenue, 1)}${col(r.expenses, 2)}${col(r.system, 3)}</div>
            <div class="eco-m" aria-hidden="true">${monthName(r.m).replace(/ \d+$/, "")}${r.m.slice(5) === "01" || r === rows[0] ? `<small>${r.m.slice(0, 4)}</small>` : ""}</div>
            <div class="eco-tip" aria-hidden="true"><b>${monthName(r.m, true)}${r.partial ? " · so far" : ""}</b>
              <span><i class="s1"></i><b class="num">${usd(r.revenue)}</b> Revenue</span><span><i class="s2"></i><b class="num">${usd(r.expenses)}</b> Expenses</span><span><i class="s3"></i><b class="num">${usd(r.system)}</b> System cost</span>
              <span class="eco-left"><b class="num">${usd(r.left)}</b> Left</span><span class="eco-hint">Click for the detail</span></div></div>`).join("")}</div></div>
</div>`;
  }
  V.economics = async () => {
    const n = state.ecoMonths || 6, e = await load(`/economics?months=${n}`); cache.eco = e;
    const S = e.stripe, read = S.on && !S.error, cur = e.currentMonth, last = e.months[e.months.length - 2], M = e.members;
    // Revenue: card payments and invoices settled another way, less refunds. Expenses: Stripe's fees (and anything it
    // clawed back) plus the expenses kept here. System cost: what the software costs to run. Left: revenue less both.
    const rows = e.months.map((m) => { const s = S.byMonth[m] || {}, out = e.outside[m] || 0, fees = (s.fees || 0) - Math.min(0, s.other || 0);
      const revenue = (s.gross || 0) + out - (s.refunds || 0) + Math.max(0, s.other || 0), expenses = fees + e.expensesMonthly, system = e.systemMonthly;
      return { m, partial: m === cur, card: s.gross || 0, out, refunds: s.refunds || 0, fees, payments: s.payments || 0, revenue, expenses, system, left: revenue - expenses - system }; });
    const now = rows[rows.length - 1], prev = rows[rows.length - 2];
    const avg = M.paying ? M.listMonthly / M.paying : 0, need = avg ? Math.ceil(e.costsMonthly / avg) : null;
    const right = 'style="text-align:right"', line = (label, val, sub) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${label}</b>${sub ? `<div class="muted" style="font-size:12px">${sub}</div>` : ""}</span><b class="num">${val}</b></div>`;
    const lines = e.costs, more = lines.length < 40 ? [{ id: "", name: "", kind: "system", monthly: "" }] : [];
    if (state.ecoOpen && !e.months.includes(state.ecoOpen)) state.ecoOpen = "";
    // Every tile opens what it is made of: a month's payments line by line, or the list the figure comes from
    const tile = (label, val, sub, kind, m, more) => `<button type="button" class="card kpi kpi-btn" data-act="ecoOpen" ${m ? `data-m="${m}" aria-expanded="${state.ecoOpen === m}" aria-controls="ecoDetail"` : `data-to="costs"`}><span class="muted">${label}</span><b class="num">${val}</b><small class="${kind ? "pill " + kind : "muted"}">${sub}</small><span class="kpi-more">${ui("next", 12)} ${more}</span></button>`;
    const missing = ECO_USES.filter((u) => !lines.some((x) => x.name.toLowerCase().includes(u.split(" ")[0].toLowerCase())));
    return `<div class="view-head"><div><h1>System economics</h1><p class="muted">Revenue against expenses and what the system costs to run · totals only, read from Stripe, the invoices on the charts and the member list</p></div>
      <div class="field" style="margin:0"><label for="ecoMonths" class="muted" style="font-size:12px">Months shown</label><select id="ecoMonths" class="input" data-change="ecoMonths" style="width:auto">${[3, 6, 12].map((x) => `<option value="${x}"${x === n ? " selected" : ""}>${x} months</option>`).join("")}</select></div></div>
    ${!S.on ? `<div class="card" style="margin-bottom:16px">${none("Stripe is not connected on the server, so card revenue cannot be read. Everything else on this screen is still from your records.")}</div>` : S.error ? `<div class="card" style="margin-bottom:16px"><b>Card revenue could not be read.</b><p class="muted" style="margin:6px 0 0">${esc(S.error)}</p></div>` : !S.fees ? `<div class="card" style="margin-bottom:16px">${none("This Stripe key can read charges and refunds but not Stripe's fees, so fees are missing from Expenses. Giving the key read access to Balance transactions adds them.")}</div>` : ""}
    <div class="grid g4" style="margin-bottom:16px">
      ${tile(`Revenue, ${monthName(cur)} so far`, usd(now.revenue), read ? `${plural(now.payments, "card payment")} · ${usd(now.out)} outside Stripe` : `${usd(now.out)} outside Stripe · card revenue not read`, "", cur, "See each payment")}
      ${tile("Expenses, per month", usd(e.expensesMonthly), `plus Stripe's fees${read && S.fees && prev ? `: ${usd(prev.fees)} in ${monthName(prev.m)}` : ""}`, "", "", "See and edit the lines")}
      ${tile("System cost, per month", usd(e.systemMonthly), lines.some((x) => x.kind === "system") ? plural(lines.filter((x) => x.kind === "system").length, "line") : "none entered yet", lines.some((x) => x.kind === "system") ? "" : "warn", "", "See and edit the lines")}
      ${tile(`Left, ${monthName(last)}`, usd(prev.left), read ? "after expenses and system cost" : "card revenue not read", prev.left < 0 ? "bad" : prev.left > 0 ? "ok" : "", last, "See how it adds up")}
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Revenue vs expenses vs system cost</h2><span class="muted" style="font-size:12px">${read && S.checkedAt ? `Stripe read ${when(S.checkedAt)}` : ""}</span></div>
      ${ecoChart(rows)}
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Month</th><th ${right}>Card payments</th><th ${right}>Outside Stripe</th><th ${right}>Refunds</th><th ${right}>Revenue</th><th ${right}>Expenses</th><th ${right}>System cost</th><th ${right}>Left</th><th ${right}>Sign-ups</th><th ${right}>Visits</th></tr></thead><tbody>
      ${[...rows].reverse().map((r) => `<tr class="eco-tr" data-act="ecoOpen" data-m="${r.m}" tabindex="0" aria-expanded="${state.ecoOpen === r.m}" aria-controls="ecoDetail"><td><b>${monthName(r.m)}</b>${r.partial ? ` <span class="pill">so far</span>` : ""}</td><td class="num" ${right}>${read ? usd(r.card) : "—"}</td><td class="num" ${right}>${usd(r.out)}</td><td class="num" ${right}>${read ? usd(r.refunds) : "—"}</td><td class="num" ${right}><b>${usd(r.revenue)}</b></td><td class="num" ${right}>${usd(r.expenses)}</td><td class="num" ${right}>${usd(r.system)}</td><td class="num" ${right}><b>${usd(r.left)}</b></td><td class="num" ${right}>${e.people.signups[r.m] || 0}</td><td class="num" ${right}>${e.visits[r.m] || 0}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted" style="margin:10px 0 0;font-size:12.5px">Click a month, in the graph or the table, to see every payment in it. <b>Revenue</b> is card payments recorded by Stripe plus invoices you marked paid by cash, check or another way, less refunds. <b>Expenses</b> is Stripe's fees plus the expenses you keep below. <b>System cost</b> is what the software costs to run, from the list below. <b>Left</b> is revenue less both. Expenses and system cost use today's list for every month, and the current month is charged the whole amount. Payouts to your bank are not revenue and are not counted.${S.truncated ? " Stripe holds more entries than were read for this period: the oldest months may be short." : ""}${e.unreadableCharts ? ` ${plural(e.unreadableCharts, "chart")} could not be opened with the server's keys, so any invoices on ${e.unreadableCharts === 1 ? "it" : "them"} are not counted.` : ""}</p></div>
    <div id="ecoDetail" aria-live="polite"></div>
    <div class="grid g2">
      <div class="card stack" id="ecoCostsCard"><div class="card-head"><h2>Expenses and system cost</h2><span class="muted" style="font-size:12px">${usd(e.costsMonthly)} a month</span></div>
        <form class="stack" data-form="ecoCosts">${[...lines, ...more].map((x, i) => `<div class="set-row eco-row"><input type="hidden" name="id${i}" value="${esc(x.id)}"><input name="name${i}" class="input" value="${esc(x.name)}" maxlength="60" placeholder="${x.id ? "Name" : "Add a line"}" aria-label="Line ${i + 1} name"><select name="kind${i}" class="input" aria-label="Line ${i + 1} is a"><option value="system"${x.kind !== "expense" ? " selected" : ""}>System cost</option><option value="expense"${x.kind === "expense" ? " selected" : ""}>Expense</option></select><input name="monthly${i}" class="input" type="number" min="0" max="1000000" step="0.01" value="${x.id ? (x.monthly / 100).toFixed(2) : ""}" placeholder="$ a month" aria-label="Line ${i + 1} dollars a month"></div>`).join("")}
          ${missing.length && more.length ? `<div class="row" style="gap:6px"><span class="muted" style="font-size:12.5px">This system runs on:</span>${missing.map((u) => `<button type="button" class="btn sm" data-act="ecoUse" data-name="${esc(u)}">${ui("plus", 12)}${esc(u)}</button>`).join("")}</div>` : ""}
          <p class="muted" style="margin:0;font-size:12.5px">System cost is what you pay each month for the software: the server, the website, video, email, the AI scribe. Expense is anything else the practice pays monthly, such as rent or insurance. These bills cannot be read from here, so the amounts are yours to enter. Clear a name to remove a line. Stripe's fees are read from Stripe and do not belong here.</p>
          <div class="row"><button class="btn primary">Save</button></div></form></div>
      <div class="card"><div class="card-head"><h2>Per member</h2><span class="muted" style="font-size:12px">${plural(e.people.total, "account")} · ${M.paying} paying · ${M.byHand} set by hand</span></div>
        ${line("Memberships, per month", usd(M.listMonthly), `${plural(M.paying, "card membership")} running, at list price before discounts`)}
        ${line("Average membership", M.paying ? usd(avg) + " a month" : "—", M.paying ? "" : "no card memberships running")}
        ${line("System cost per paying member", M.paying && e.systemMonthly ? usd(e.systemMonthly / M.paying) + " a month" : "—", e.systemMonthly ? "" : "enter the system cost to see this")}
        ${line("System cost per account", e.people.total && e.systemMonthly ? usd(e.systemMonthly / e.people.total) + " a month" : "—", "every sign-up, paying or not")}
        ${line("Paying members needed to cover expenses and system cost", need === null || !lines.length ? "—" : String(need), need !== null && lines.length ? (M.paying >= need ? `you have ${M.paying}: covered by memberships alone` : `you have ${M.paying}: ${need - M.paying} short on memberships alone`) : "")}
        ${line("Stripe's share of card payments", read && S.fees && prev.card ? ((prev.fees / prev.card) * 100).toFixed(1) + "%" : "—", read && S.fees && prev.card ? `${monthName(last, true)}: ${usd(prev.fees)} of ${usd(prev.card)}` : `no card payments with fees in ${monthName(last, true)}`)}
        ${line("Invoices still owed to you", usd(e.owed.total), e.owed.count ? `${plural(e.owed.count, "unpaid invoice")} across the charts` : "nothing outstanding")}
        <h3 style="margin:14px 0 4px">Membership types</h3>
        ${M.kinds.map((k) => line(esc(k.name), usd(k.price * k.paying) + " a month", `${usd(k.price)} · ${k.paying} paying${k.byHand ? ` · ${k.byHand} set by hand (not charged)` : ""}`)).join("") || none("No membership types.")}</div>
    </div>`;
  };
  // One month opened: every card payment (who, what kind, amount, Stripe's fee), refunds, invoices settled another
  // way, and the cost lines, ending in the same sum the overview shows.
  async function ecoDetail() {
    const box = $("#ecoDetail"), m = state.ecoOpen; if (!box) return;
    if (!m) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="card" style="margin-bottom:16px"><p class="spin" style="padding:0;margin:0">Loading ${monthName(m, true)}…</p></div>`;
    let d; try { d = await load(`/economics/month?m=${m}`); } catch (err) { if (state.ecoOpen === m && $("#ecoDetail")) $("#ecoDetail").innerHTML = `<div class="card" style="margin-bottom:16px"><b>${monthName(m, true)} could not be loaded.</b><p class="muted" style="margin:6px 0 0">${esc(err.message)}</p></div>`; return; }
    const out = $("#ecoDetail"); if (!out || state.ecoOpen !== m) return;
    const S = d.stripe, right = 'style="text-align:right"', who = (x) => x.name ? esc(x.name) : `<span class="muted">Not matched to a client</span>`;
    const chartBtn = (x, billing) => x.clientId ? `<button type="button" class="btn sm" data-act="${billing ? "chartBilling" : "chart"}" data-id="${esc(x.clientId)}">${billing ? "Billing" : "Chart"}</button>` : "";
    const pays = S.lines.filter((x) => x.kind === "charge"), rest = S.lines.filter((x) => x.kind !== "charge");
    const card = pays.reduce((n, x) => n + x.amount, 0), refunds = rest.filter((x) => x.kind === "refund").reduce((n, x) => n + x.amount, 0);
    const fees = S.lines.reduce((n, x) => n + (x.fee || 0) + (x.kind === "fee" ? x.amount : 0), 0), outside = d.outside.reduce((n, x) => n + x.amount, 0);
    const revenue = card + outside - refunds, expenses = fees + d.expensesMonthly, left = revenue - expenses - d.systemMonthly;
    const sum = (label, val, strong) => `<div class="list-item"><span style="flex:1">${strong ? `<b>${label}</b>` : label}</span><${strong ? "b" : "span"} class="num">${val}</${strong ? "b" : "span"}></div>`;
    const cost = (kind) => d.costs.filter((x) => x.kind === kind).map((x) => sum(esc(x.name), usd(x.monthly))).join("");
    out.innerHTML = `<div class="card" style="margin-bottom:16px" id="ecoMonthCard"><div class="card-head"><h2>${monthName(m, true)} in detail</h2><button type="button" class="btn sm ghost" data-act="ecoOpen" data-m="${m}" aria-label="Close the detail">${ui("x", 14)}</button></div>
      ${!S.on ? none("Stripe is not connected on the server, so card payments cannot be listed.") : S.error ? `<p class="muted" style="margin:0">${esc(S.error)}</p>` : `<h3 style="margin:4px 0 6px">Card payments <span class="muted" style="font-weight:400;font-size:12.5px">${pays.length ? `${pays.length} · ${usd(card)}` : ""}</span></h3>
      ${pays.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Who</th><th>What</th><th ${right}>Amount</th><th ${right}>Stripe fee</th><th ${right}>You keep</th><th></th></tr></thead><tbody>${pays.map((x) => `<tr><td class="num">${when(x.at)}</td><td>${who(x)}</td><td>${esc(x.what || "Card payment")}</td><td class="num" ${right}>${usd(x.amount)}</td><td class="num" ${right}>${S.fees ? usd(x.fee) : "—"}</td><td class="num" ${right}><b>${S.fees ? usd(x.amount - x.fee) : "—"}</b></td><td ${right}>${chartBtn(x, true)}</td></tr>`).join("")}</tbody></table></div>` : none("No card payments in this month.")}
      ${rest.length ? `<h3 style="margin:14px 0 6px">Refunds and Stripe charges</h3><div class="table-wrap"><table><tbody>${rest.map((x) => `<tr><td class="num">${when(x.at)}</td><td>${x.kind === "refund" ? "Refund" : x.kind === "fee" ? "Stripe charge" : "Adjustment"}</td><td class="num" ${right}>-${usd(x.amount)}</td></tr>`).join("")}</tbody></table></div>` : ""}`}
      <h3 style="margin:14px 0 6px">Paid another way <span class="muted" style="font-weight:400;font-size:12.5px">${d.outside.length ? `${d.outside.length} · ${usd(outside)}` : ""}</span></h3>
      ${d.outside.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Who</th><th>Invoice</th><th>How</th><th ${right}>Amount</th><th></th></tr></thead><tbody>${d.outside.map((x) => `<tr><td class="num">${x.at ? when(x.at) : "—"}</td><td>${esc(x.name)}</td><td>${esc(x.number)}</td><td>${esc(x.method || "")}</td><td class="num" ${right}>${usd(x.amount)}</td><td ${right}>${chartBtn(x, true)}</td></tr>`).join("")}</tbody></table></div>` : none("No invoices were marked paid by cash, check or another way in this month.")}
      <div class="grid g2" style="margin-top:14px"><div><h3 style="margin:0 0 4px">Expenses</h3>${S.on && !S.error && S.fees ? sum("Stripe's fees", usd(fees)) : ""}${cost("expense")}${!cost("expense") && !(S.on && !S.error && S.fees) ? none("No expense lines entered.") : ""}</div>
        <div><h3 style="margin:0 0 4px">System cost</h3>${cost("system") || none("No system cost lines entered.")}</div></div>
      <h3 style="margin:14px 0 4px">How it adds up</h3>
      ${sum("Card payments", usd(card))}${sum("Paid another way", usd(outside))}${refunds ? sum("Refunds", "-" + usd(refunds)) : ""}${sum("Revenue", usd(revenue), true)}${sum("Expenses", "-" + usd(expenses))}${sum("System cost", "-" + usd(d.systemMonthly))}${sum("Left", usd(left), true)}
      ${S.truncated ? `<p class="muted" style="margin:8px 0 0;font-size:12.5px">Stripe holds more entries than were read for this month.</p>` : ""}</div>`;
  }

  // ---- Solomon in numbers: who opened it, how many answers it gave, who used up the free
  // plan's daily tokens and who upgraded after that. Counts only: nothing anyone typed to it is kept or shown here.
  const GUIDE_DAYS = [7, 30, 90];
  const dayName = (d, long) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(long ? { weekday: "short" } : {}) });
  // One row a day up to a month, one a week beyond that, so a column is never too thin to read. A day the server
  // did not list had nothing happen on it.
  function guideRows(byDay, days) {
    const got = new Map((byDay || []).map((x) => [x.date, x])), last = [...got.keys()].sort().pop() || isoDay(new Date()), list = [];
    for (let i = days - 1; i >= 0; i--) { const date = new Date(Date.parse(last + "T12:00:00Z") - i * 864e5).toISOString().slice(0, 10), x = got.get(date) || {}; list.push({ date, opens: Number(x.opens) || 0, answers: Number(x.answers) || 0, limitHits: Number(x.limitHits) || 0, upgradeTaps: Number(x.upgradeTaps) || 0 }); }
    if (days <= 31) return list.map((x) => ({ ...x, label: dayName(x.date), long: dayName(x.date, true) }));
    const out = [], sum = (w, k) => w.reduce((n, x) => n + x[k], 0);
    for (let i = list.length % 7; i < list.length; i += 7) { const w = list.slice(i, i + 7); out.push({ date: w[0].date, label: dayName(w[0].date), long: `${dayName(w[0].date)} to ${dayName(w[w.length - 1].date)}`, opens: sum(w, "opens"), answers: sum(w, "answers"), limitHits: sum(w, "limitHits"), upgradeTaps: sum(w, "upgradeTaps") }); }
    if (list.length % 7) { const w = list.slice(0, list.length % 7); out.unshift({ date: w[0].date, label: dayName(w[0].date), long: `${dayName(w[0].date)} to ${dayName(w[w.length - 1].date)}`, opens: sum(w, "opens"), answers: sum(w, "answers"), limitHits: sum(w, "limitHits"), upgradeTaps: sum(w, "upgradeTaps") }); }
    return out;
  }
  // Answers given and times the limit was reached, side by side on one count axis. Resting on (or tabbing to) a
  // column shows its numbers; the Table view holds the same figures.
  function guideChart(rows, byWeek) {
    const top = Math.max(1, ...rows.flatMap((r) => [r.answers, r.limitHits]));
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].find((x) => x * 4 >= top) || Math.ceil(top / 4), max = step * 4;
    const col = (v, k) => `<span class="eco-bar s${k}" style="height:${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2)}%"></span>`;
    const key = (k, label) => `<span class="eco-key"><i class="s${k}"></i>${label}</span>`, every = Math.ceil(rows.length / 7);
    return `<div class="eco-chart${rows.length > 14 ? " dense" : ""}" id="guideChart" role="group" aria-label="Answers given and times the daily limit was reached, by ${byWeek ? "week" : "day"}. The same figures are in the table view.">
      <div class="eco-legend">${key(1, "Answers given")}${key(2, "Reached the daily limit")}</div>
      <div class="eco-plot"><div class="eco-y" aria-hidden="true">${[4, 3, 2, 1, 0].map((k) => `<span>${(step * k).toLocaleString("en-US")}</span>`).join("")}</div>
        <div class="eco-area">${[0, 1, 2, 3, 4].map((k) => `<i class="eco-grid" style="bottom:${k * 25}%"></i>`).join("")}
          ${rows.map((r, n) => `<div class="eco-g${n > rows.length / 2 ? " late" : ""}" tabindex="0" role="img" aria-label="${esc(r.long)}: ${plural(r.answers, "answer")} given, the daily limit reached ${plural(r.limitHits, "time")}, ${plural(r.opens, "open")}, ${plural(r.upgradeTaps, "upgrade tap")}">
            <div class="eco-cols">${col(r.answers, 1)}${col(r.limitHits, 2)}</div>
            ${(rows.length - 1 - n) % every === 0 ? `<div class="eco-m${(rows.length - 1 - n) % (every * 2) ? " thin" : ""}" aria-hidden="true">${r.label}</div>` : ""}
            <div class="eco-tip" aria-hidden="true" style="--f:${((n + 0.5) / rows.length).toFixed(3)}"><b>${esc(r.long)}</b>
              <span><i class="s1"></i><b class="num">${r.answers}</b> Answers given</span><span><i class="s2"></i><b class="num">${r.limitHits}</b> Reached the daily limit</span>
              <span class="eco-left"><b class="num">${r.opens}</b> ${r.opens === 1 ? "open" : "opens"} · <b class="num">${r.upgradeTaps}</b> upgrade ${r.upgradeTaps === 1 ? "tap" : "taps"}</span></div></div>`).join("")}</div></div>
</div>`;
  }
  // A read that failed is kept the way a good one is: shown at once on the next visit and asked again behind the
  // screen, so this item in the menu never waits on the server just to say the same thing again.
  const guideBad = new Map();
  async function guideStats(days) {
    const p = `/guide/stats?days=${days}`, bad = guideBad.get(days);
    if (bad && bad.epoch === epoch) {
      if (Date.now() - bad.at > FRESH_MS) { bad.at = Date.now(); pull(p).then(() => { guideBad.delete(days); changed(); }, (err) => { bad.why = err.message; }); }
      throw new Error(bad.why);
    }
    try { const g = await load(p); guideBad.delete(days); return g; } catch (err) { guideBad.set(days, { why: err.message, at: Date.now(), epoch }); throw err; }
  }
  // ---- Affiliates (Business): members earn a share of what friends they refer pay for subscriptions or subscription
  // add-ons. The owner sets the rate and the rules here; the server keeps clinical tiers out whatever is sent.
  const affPill = (s) => `<span class="pill ${s === "active" ? "ok" : s === "removed" ? "bad" : "warn"}">${esc({ active: "Active", paused: "Paused", removed: "Removed", left: "Left" }[s] || s)}</span>`;
  const affStatus = (s) => `<span class="pill ${s === "paid" ? "ok" : s === "reversed" ? "bad" : s === "ready" ? "" : "warn"}">${esc({ pending: "Pending", ready: "Payout ready", paid: "Paid", reversed: "Reversed" }[s] || s)}</span>`;
  V.affiliates = async () => {
    const d = await load("/affiliates");
    if (!d) return `<div class="view-head"><div><h1>Affiliates</h1></div></div>${none("Couldn't load the affiliate programme.")}`;
    const S = d.settings, T = d.totals || {}, lp = d.lastPayout;
    const tile = (label, val, sub) => `<div class="card kpi"><span class="muted">${label}</span><b class="num">${val}</b>${sub ? `<small class="muted">${sub}</small>` : ""}</div>`;
    // Every Recurring Membership can earn (Agreement 4.3, Exhibit A). What never earns is care itself: clinic visits and
    // one-time remote clinical services are not subscriptions and never reach the programme.
    const tiers = (d.tiers || []).map((t) => `<label class="row" style="gap:8px;flex-wrap:nowrap"><input type="checkbox" name="tier" value="${esc(t.id)}"${t.eligible ? " checked" : ""}><span><b>${esc(t.name)}</b>${t.price ? ` <span class="muted">· $${esc(t.price)}/month</span>` : ""}</span></label>`).join("")
      + `<p class="muted" style="margin:6px 0 0;font-size:12.5px">Commissions are paid on recurring memberships only: access to MD Fit Online, member discounts at the rehab clinic, and partner gyms and studios. Clinic visits and one-time remote clinical services never earn one, and a commission never depends on whether a member uses the clinic.</p>`;
    const affRows = (d.affiliates || []).map((a) => `<tr><td><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.email)}</div></td><td>${affPill(a.status)}</td>
      <td>${a.stripe.payoutsEnabled ? '<span class="pill ok">Payouts on</span>' : a.stripe.connected ? '<span class="pill warn">Checking</span>' : '<span class="pill">Not set up</span>'}</td>
      <td class="num">${a.referred}</td><td class="num">${usd(a.pendingCents)}</td><td class="num">${usd(a.readyCents)}</td><td class="num">${usd(a.paidCents)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap">${a.status === "active" ? `<button type="button" class="btn sm" data-act="affStatus" data-id="${esc(a.clientId)}" data-s="paused">Pause</button>` : a.status === "paused" ? `<button type="button" class="btn sm" data-act="affStatus" data-id="${esc(a.clientId)}" data-s="active">Resume</button>` : ""}
        ${a.status !== "removed" ? `<button type="button" class="btn sm" data-act="affStatus" data-id="${esc(a.clientId)}" data-s="removed">Remove</button>` : ""}<button type="button" class="btn sm ghost" data-act="affAdjust" data-id="${esc(a.clientId)}" data-name="${esc(a.name)}">Adjust</button></div></td></tr>`).join("");
    const recent = (d.recent || []).slice(0, 100).map((r) => `<tr><td>${esc(when(r.ts))}</td><td>${esc(r.kind === "commission" ? "Commission" : r.kind === "clawback" ? "Refund taken back" : "Adjustment")}</td><td>${esc(r.affiliate)}</td>
      <td>${esc(r.kind === "adjustment" ? r.reason || "" : r.referred)}</td><td>${esc(r.label || "")}</td><td class="num">${usd(r.cents)}</td><td>${affStatus(r.status)}</td></tr>`).join("");
    return `<div class="view-head"><div><h1>Affiliates</h1><p class="muted">Members earn a share of what friends they refer pay for subscriptions or subscription add-ons. Nothing clinical ever earns a commission.</p></div>
        <button type="button" class="btn" data-act="affExport">Export CSV</button></div>
      <div class="card stack" style="margin-bottom:16px"><div class="card-head"><h2>Affiliate programme</h2><button type="button" class="switch" role="switch" aria-checked="${S.enabled}" aria-label="Affiliate programme" data-act="affEnabled"></button></div>
        <p style="margin:0">${S.enabled ? "<b>Open:</b> members see Refer a friend → Earn on referrals on their Profile and can turn on affiliate commission." : "<b>Closed:</b> members see only their referral code. Have your attorney review the programme and the affiliate terms before opening it."}</p>
        ${d.stripe ? "" : '<p class="muted" style="margin:0">Stripe isn\'t configured on the API, so payouts can\'t run yet.</p>'}
        <p class="muted" style="margin:0;font-size:12.5px">Payouts are Stripe transfers to each affiliate's Stripe Express account. Stripe Connect must be on for the account, and a Connect webhook (account.updated) set to the API's /api/stripe/webhook with its signing secret in STRIPE_CONNECT_WEBHOOK_SECRET.</p></div>
      <div class="grid g4" style="margin-bottom:16px">${tile("Active affiliates", T.affiliates || 0)}${tile("Pending", usd(T.pendingCents), `held ${S.holdDays} days`)}${tile("Payout ready", usd(T.readyCents), `paid on the 1st from ${usd(S.minPayoutCents)}`)}${tile("Paid all time", usd(T.paidCents), lp ? `last run ${esc(when(lp.lastRunAt))}` : "no payouts yet")}</div>
      <div class="grid g2" style="margin-bottom:16px;align-items:start">
        <form class="card stack" data-form="affSettings"><div class="card-head"><h2>Commission settings</h2></div>
          <div class="grid g2"><div class="field"><label for="affRate">Commission rate (%, up to 15: the Partner Allowance)</label><input id="affRate" name="ratePct" class="input" type="number" min="0" max="15" step="0.01" value="${esc(S.ratePct)}" required></div>
            <div class="field"><label for="affHold">Hold before payout ready (days)</label><input id="affHold" name="holdDays" class="input" type="number" min="0" max="60" step="1" value="${esc(S.holdDays)}" required></div>
            <div class="field"><label for="affMin">Payout minimum ($)</label><input id="affMin" name="minPayout" class="input" type="number" min="1" max="1000" step="0.01" value="${esc((S.minPayoutCents / 100).toFixed(2))}" required></div>
            <div class="field"><label for="affDur">Earning window (months, 0 = as long as they stay)</label><input id="affDur" name="durationMonths" class="input" type="number" min="0" max="120" step="1" value="${esc(S.durationMonths)}" required></div></div>
          <fieldset class="stack" style="border:0;padding:0;margin:0"><legend style="font-weight:700;margin-bottom:6px">Subscriptions that earn</legend>${tiers}</fieldset>
          <div class="field"><label for="affAddOns">Subscription add-ons that earn (Stripe price lookup keys or price ids, comma separated)</label><input id="affAddOns" name="addOns" class="input" maxlength="2000" value="${esc((S.eligibleAddOns || []).join(", "))}" placeholder="e.g. sunny_unlimited"></div>
          <label class="row" style="gap:8px;flex-wrap:nowrap"><input type="checkbox" name="freeMonth"${S.freeMonthReward ? " checked" : ""}><span>Also give the referrer 1 free month of membership for each sign-up</span></label>
          <p class="muted" style="margin:0;font-size:12.5px">A new rate applies to payments from now on; commissions already recorded keep their rate. Every change is recorded in the audit ledger.</p>
          <div class="row"><button class="btn primary">Save settings</button></div></form>
        <div class="card stack"><div class="card-head"><h2>Run now</h2></div>
          <p style="margin:0">Holds end on their own every hour, and payouts run on the 1st of each month. Run either one now if you need to.</p>
          <div class="row"><button type="button" class="btn" data-act="affRun" data-job="clear">End due holds</button><button type="button" class="btn primary" data-act="affRun" data-job="payout">Pay out now</button></div>
          ${lp ? `<p class="muted" style="margin:0;font-size:12.5px">Last payout run ${esc(when(lp.lastRunAt))} (${esc(lp.by)}): ${lp.paid} paid, ${lp.failed} failed.</p>` : ""}</div></div>
      <div class="card" style="padding:0;margin-bottom:16px"><div class="card-head" style="padding:14px 16px 0"><h2>Affiliates</h2></div><div class="table-wrap"><table><thead><tr><th>Member</th><th>Status</th><th>Stripe</th><th class="num">Referred</th><th class="num">Pending</th><th class="num">Ready</th><th class="num">Paid</th><th></th></tr></thead><tbody>${affRows || noneRow(8, "No one has turned on affiliate commission yet.")}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Recent commissions</h2></div><div class="table-wrap" style="max-height:480px;overflow-y:auto"><table><thead><tr><th>When</th><th>Kind</th><th>Affiliate</th><th>Referred member</th><th>Subscription</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${recent || noneRow(7, "No commissions yet.")}</tbody></table></div></div>`;
  };
  // ---- Revenue share (Business): the manager's share under the partnership agreement, owner only. The manager's own
  // console is /manager; this is where the owner names the manager, sets the terms, switches automatic payouts on,
  // classifies payments the code couldn't place, and acknowledges or disputes partner registrations.
  V.revshare = async () => {
    const d = await load("/partner-share"), patf = await load("/partner-share/patf").catch(() => null);
    if (!d) return `<div class="view-head"><div><h1>Revenue share</h1></div></div>${none("Couldn't load the revenue share.")}`;
    const S = d.settings, v = d.view, st = d.statement, b = v.balances;
    const tile = (label, val, sub) => `<div class="card kpi"><span class="muted">${label}</span><b class="num">${val}</b>${sub ? `<small class="muted">${sub}</small>` : ""}</div>`;
    const mgrOpts = `<option value="">Nobody yet</option>${(d.managers || []).filter((m) => m.active).map((m) => `<option value="${esc(m.id)}"${m.id === S.managerStaffId ? " selected" : ""}>${esc(m.name)} (${esc(m.email)})</option>`).join("")}`;
    const unc = (d.unclassified || []).map((r) => `<tr><td>${esc(when(r.ts))}</td><td>${esc(r.product)}<div class="muted" style="font-size:12px">${esc(r.kind)}</div></td><td class="num">${usd(r.grossCents)}</td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap"><button type="button" class="btn sm" data-act="rsClassify" data-id="${esc(r.id)}" data-c="online">MD Fit Online</button><button type="button" class="btn sm" data-act="rsClassify" data-id="${esc(r.id)}" data-c="clinic">In-Clinic</button></div></td></tr>`).join("");
    const parts = ((patf && patf.partners) || []).map((p) => `<tr><td><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(p.type)}${p.originatedByManager ? " · originated by the manager" : ""} · <code>${esc(p.code)}</code></div></td><td class="num">${esc(p.ratePct)}%</td>
      <td class="num">${p.clicks}</td><td class="num">${p.signups}</td><td class="num">${p.payingNow}</td><td class="num">${usd(p.commissionDueCents)}</td>
      <td><span class="pill ${p.state === "disputed" ? "bad" : p.state === "awaiting acknowledgment" ? "warn" : "ok"}">${esc(p.state)}</span>${p.state === "awaiting acknowledgment" ? `<div class="muted" style="font-size:12px">by ${esc(when(p.ackDueAt))}</div>` : ""}</td>
      <td>${p.state === "awaiting acknowledgment" ? `<div class="row" style="gap:6px;flex-wrap:nowrap"><button type="button" class="btn sm" data-act="rsAck" data-id="${esc(p.id)}">Acknowledge</button><button type="button" class="btn sm ghost" data-act="rsDispute" data-id="${esc(p.id)}" data-name="${esc(p.name)}">Dispute</button></div>` : ""}</td></tr>`).join("");
    return `<div class="view-head"><div><h1>Revenue share</h1><p class="muted">The manager's share of MD Fit Online Net Revenue under the Junior Partnership, Platform &amp; EMR Agreement (Revision 2). In-Clinic revenue stays 100% the Clinic's. The manager's own console is <a href="/manager" target="_blank" rel="noopener">/manager</a>.</p></div></div>
      <div class="grid g4" style="margin-bottom:16px">${tile("Pending", usd(b.pendingCents), "until Stripe clears")}${tile("Payout ready", usd(b.readyCents), S.autoPay ? "paid automatically" : "you pay it")}${tile("Paid", usd(b.paidCents), "to the manager")}${tile("MD Fit Online net this month", usd(st.categories.online.netCents), `${st.categories.online.payments} payments · In-Clinic ${usd(st.categories.clinic.grossCents)}`)}</div>
      <div class="grid g2" style="margin-bottom:16px;align-items:start">
        <form class="card stack" data-form="rsSettings"><div class="card-head"><h2>Terms</h2><button type="button" class="switch" role="switch" aria-checked="${S.enabled}" aria-label="Revenue share on" data-act="rsEnabled"></button></div>
          <div class="field"><label for="rsMgr">Manager (a staff account with the Manager role)</label><select id="rsMgr" name="managerStaffId" class="input">${mgrOpts}</select></div>
          <div class="grid g2"><div class="field"><label for="rsStatus">Status</label><select id="rsStatus" name="status" class="input"><option value="active"${S.status === "active" ? " selected" : ""}>Active (Section 4.2)</option><option value="continuing"${S.status === "continuing" ? " selected" : ""}>Continuing (Section 9.2)</option></select></div>
            <div class="field"><label for="rsHold">Extra hold after Stripe clears (days)</label><input id="rsHold" name="holdDays" class="input" type="number" min="0" max="60" step="1" value="${esc(S.holdDays)}"></div>
            <div class="field"><label for="rsActive">Active share (%) · fixed by Section 4.2</label><input id="rsActive" name="activePct" class="input" type="number" value="${esc(S.activePct)}" readonly aria-readonly="true" title="Set by the agreement. It changes only by a signed amendment (Section 12.5)."></div>
            <div class="field"><label for="rsCont">Continuing share (%) · Sections 9.2 and 8.2</label><select id="rsCont" name="continuingPct" class="input"><option value="5"${Number(S.continuingPct) === 5 ? " selected" : ""}>5% (Section 9.2)</option><option value="10"${Number(S.continuingPct) === 10 ? " selected" : ""}>10% (Section 8.2 remedy)</option></select></div></div>
          <p class="muted" style="margin:0;font-size:12.5px">A change applies to payments from now on. Every change is recorded in the audit ledger.</p>
          <div class="row"><button class="btn primary">Save terms</button></div></form>
        <div class="card stack"><div class="card-head"><h2>Automatic payouts</h2><button type="button" class="switch" role="switch" aria-checked="${S.autoPay}" aria-label="Automatic payouts" data-act="rsAutoPay"></button></div>
          <p style="margin:0">${S.autoPay ? `<b>On</b> since ${esc(when(S.autoPayOnAt))} (by ${esc(S.autoPayOnBy || "")}): each share is transferred to the manager's Stripe account as soon as its payment clears, with a payment notice.` : "<b>Off:</b> shares become payout ready as payments clear, and you pay them here. The agreement says monthly, within 15 days (Section 4.8); switching this on pays as each payment clears instead, and is recorded as your decision."}</p>
          <p class="muted" style="margin:0;font-size:12.5px">The manager's Stripe account: ${v.stripe.payoutsEnabled ? "ready for payouts" : v.stripe.connected ? "Stripe is checking their details" : "not set up yet"}.</p>
          <div class="row"><button type="button" class="btn" data-act="rsRun" data-job="clear">Check what has cleared</button><button type="button" class="btn primary" data-act="rsRun" data-job="payout">Pay what's ready now</button></div></div></div>
      <div class="card" style="padding:0;margin-bottom:16px"><div class="card-head" style="padding:14px 16px 0"><h2>Payments to classify</h2><span class="muted" style="font-size:12px">Section 4.7: anything the code can't place earns nothing until you classify it</span></div><div class="table-wrap"><table><thead><tr><th>When</th><th>Payment</th><th class="num">Amount</th><th></th></tr></thead><tbody>${unc || noneRow(4, "Nothing to classify.")}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Partners (PATF)</h2><span class="muted" style="font-size:12px">Section 7.2: acknowledge or dispute a registration within five business days</span></div><div class="table-wrap"><table><thead><tr><th>Partner</th><th class="num">Rate</th><th class="num">Clicks</th><th class="num">Sign-ups</th><th class="num">Paying</th><th class="num">Commission due</th><th>Registration</th><th></th></tr></thead><tbody>${parts || noneRow(8, "No partners registered.")}</tbody></table></div></div>`;
  };
  V.guide = async () => {
    const days = GUIDE_DAYS.includes(state.guideDays) ? state.guideDays : 30; let g = null, why = "";
    try { g = await guideStats(days); } catch (err) { why = err.message; }
    cache.guide = g;
    const head = `<div class="view-head"><div><h1>Solomon</h1><p class="muted">How members use Solomon in the app, and who upgrades after using up the free daily tokens · counts only, nothing anyone typed is kept</p></div>
      <div class="seg" role="group" aria-label="Days shown">${GUIDE_DAYS.map((d) => `<button type="button" data-act="guideDays" data-d="${d}" aria-pressed="${d === days}">${d} days</button>`).join("")}</div></div>`;
    if (!g) return `${head}<div class="card" id="guideErr"><b>Solomon's numbers could not be loaded.</b><p class="muted" style="margin:6px 0 0">${esc(why)}</p></div>`;
    // Solomon's daily nudges (server: lib/nudges.js): counts only, no names
    let nd = null; try { nd = await load(`/guide/nudges?days=${days}`); } catch {}
    const T = g.totals || {}, n = (k) => Number(T[k]) || 0, S = g.settings || {};
    const any = ["opens", "people", "answers", "limitHits", "limitPeople", "upgradeTaps", "upgraded"].some((k) => n(k) > 0);
    const reached = n("limitPeople"), up = n("upgraded"), byWeek = days > 31, rows = guideRows(g.byDay, days), table = state.guideView === "table";
    const right = 'style="text-align:right"';
    const numbers = !any ? `<div class="card" id="guideNone" style="margin-bottom:16px"><b>No Solomon activity yet</b><p class="muted" style="margin:6px 0 0">Nobody opened Solomon in the last ${days} days. The numbers appear here as members use it in the app.</p></div>` : `
    <div class="grid" id="guideTiles" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:16px">
      ${kpi("People who opened it", n("people"), `${plural(n("opens"), "open")} in ${days} days`)}
      ${kpi("Answers given", n("answers"), n("people") ? `${(n("answers") / n("people")).toFixed(1)} per person` : "")}
      ${kpi("People who reached the limit", reached, `${plural(n("limitHits"), "time")} in all`)}
      ${kpi("Upgrade taps", n("upgradeTaps"), "taps on Upgrade in Solomon")}
      ${kpi("Upgraded after the limit", up, "started a membership after reaching it")}
    </div>
    <div class="card" id="guideRate" style="margin-bottom:16px"><div class="card-head"><h2>Conversion</h2><span class="muted" style="font-size:12px">last ${days} days</span></div>
      ${reached ? `<p style="margin:0;font-size:17px"><b class="num">${up} of ${reached}</b> who reached the limit upgraded</p><p class="muted" style="margin:4px 0 0">That is ${Math.round((up / reached) * 100)}% of the ${reached === 1 ? "1 person" : reached + " people"} who reached it.</p>`
        : `<p style="margin:0"><b>Not enough data yet.</b></p><p class="muted" style="margin:4px 0 0">Nobody reached the daily limit in the last ${days} days, so there is no conversion rate to show.</p>`}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Answers and limit, by ${byWeek ? "week" : "day"}</h2>
        <div class="seg" role="group" aria-label="Show as"><button type="button" data-act="guideView" data-v="chart" aria-pressed="${!table}">Chart</button><button type="button" data-act="guideView" data-v="table" aria-pressed="${table}">Table</button></div></div>
      ${table ? `<div class="table-wrap" id="guideTable" style="max-height:420px;overflow-y:auto"><table><thead><tr><th>${byWeek ? "Week" : "Day"}</th><th ${right}>Opens</th><th ${right}>Answers given</th><th ${right}>Reached the limit</th><th ${right}>Upgrade taps</th></tr></thead><tbody>
        ${[...rows].reverse().map((r) => `<tr><td>${esc(r.long)}</td><td class="num" ${right}>${r.opens}</td><td class="num" ${right}>${r.answers}</td><td class="num" ${right}>${r.limitHits}</td><td class="num" ${right}>${r.upgradeTaps}</td></tr>`).join("")}</tbody></table></div>` : guideChart(rows, byWeek)}</div>`;
    const ai = !!S.ai, canAi = !!S.aiReady, hasAi = "ai" in S || "aiReady" in S;
    return `${head}${numbers}
    <div class="grid g2">
      <div class="card stack"><div class="card-head"><h2>Free tokens a day</h2><span class="muted" style="font-size:12px">members are unlimited</span></div>
        <form class="row" data-form="guideLimit" style="align-items:flex-end"><div class="field" style="margin:0;width:230px;max-width:100%"><label for="guideFree">Tokens a day on the free plan</label><input id="guideFree" name="freeTokensPerDay" class="input num" type="number" min="1000" max="1000000" step="1000" required value="${esc(S.freeTokensPerDay ?? 50000)}"></div><button class="btn primary">Save</button></form>
        <p class="muted" style="margin:0;font-size:12.5px">One AI answer uses about 3,000 tokens; an answer found on the device uses 300. The default, 50,000, is about 15 AI answers a day.</p>
        <p class="muted" style="margin:0;font-size:12.5px">Any whole number from 1,000 to 1,000,000. Opening the pain tool, booking and calling the clinic never use tokens.</p></div>
      ${hasAi ? `<div class="card stack" id="guideAiCard"><div class="card-head"><h2>AI answers</h2><button type="button" class="switch" id="guideAi" role="switch" aria-checked="${ai}" aria-label="AI answers" data-act="guideAi"${!ai && !canAi ? " disabled" : ""}></button></div>
        <p style="margin:0" id="guideAiState">${ai ? `<b>On:</b> members' messages are read by ${esc(S.aiModel || "the AI model")} at ${esc(S.aiHost || "the AI service")} to find the right place and suggest programs, videos, your guides and general tips, which are added to the member's Home. Their activity in the app (programs, check-ins, workouts) is read to personalize it; their name and contact details are never sent, and nothing typed is saved.` : `<b>Off:</b> Solomon understands messages on the member's own device, nothing they type leaves it, and Solomon suggests nothing.`}</p>
        ${!canAi ? `<p class="muted" style="margin:0;font-size:12.5px" id="guideAiWhy">${ai ? "The AI service is not ready" : "It cannot be turned on"}: ${esc(S.aiWhy || "no AI service is connected on the server.")}</p>` : ""}
        ${state.guideAiErr ? `<p style="margin:0;color:var(--bad)" id="guideAiErr" role="alert">Not changed: ${esc(state.guideAiErr)}</p>` : ""}</div>` : ""}
    </div>
    ${nudgeCard(nd, days)}`;
  };
  const NUDGE_KINDS = { streak: ["Streak saver", "the evening one, when a streak is about to break"], comeback: ["Comeback", "2, 7, 14 and 30 days after someone was last active"],
    picks: ["New picks", "Solomon suggested something since they last opened the app"], morning: ["Morning", "the Sarasota-sunlight line on a clear morning, otherwise a friendly one"] };
  function nudgeCard(nd, days) {
    const rows = (nd && Array.isArray(nd.kinds) ? nd.kinds : []).filter((k) => NUDGE_KINDS[k.kind]);
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–"), right = 'style="text-align:right"';
    const sent = rows.reduce((t, k) => t + (Number(k.sent) || 0), 0);
    return `<div class="card" id="guideNudges" style="margin-top:16px"><div class="card-head"><h2>Daily nudges</h2><span class="muted" style="font-size:12px">last ${days} days · at most one a day per member</span></div>
      ${!nd ? `<p class="muted" style="margin:0">The nudge numbers could not be loaded.</p>`
        : !sent ? `<p class="muted" style="margin:0">No nudges sent in the last ${days} days. They go to members who have the app on their phone with notifications on.</p>`
        : `<div class="table-wrap"><table><thead><tr><th>Nudge</th><th ${right}>Sent</th><th ${right}>Opened within 6 hours</th><th ${right}>Came back within 2 days</th></tr></thead><tbody>
          ${rows.map((k) => `<tr><td><b>${esc(NUDGE_KINDS[k.kind][0])}</b><div class="muted" style="font-size:12px">${esc(NUDGE_KINDS[k.kind][1])}</div></td><td class="num" ${right}>${Number(k.sent) || 0}</td><td class="num" ${right}>${Number(k.opened) || 0} <span class="muted">(${pct(Number(k.opened) || 0, Number(k.sent) || 0)})</span></td><td class="num" ${right}>${k.kind === "comeback" ? `${Number(k.comebacks) || 0} <span class="muted">(${pct(Number(k.comebacks) || 0, Number(k.sent) || 0)})</span>` : "–"}</td></tr>`).join("")}</tbody></table></div>`}
      <p class="muted" style="margin:8px 0 0;font-size:12.5px">Members choose All, Streaks only or Off in their Profile. Nothing about anyone's health is ever shown on a lock screen: only their first name.</p></div>`;
  }
  // ---------------------------------------------------------------- Team & roles
  // Who can sign in, what each person may do, and the first-sign-in password change.
  // Everything about roles and permissions comes from the server: the role names, what each role turns on, and
  // every permission's own label and description. Nothing of that is written down in here, so a role added on the
  // server appears here by itself. The one thing this file knows is which permission holds patient records, because
  // that one is marked out on screen wherever it appears.
  // Permissions are grouped only so the list reads well; a key the server sends that is not in a group below still
  // appears, under "Other".
  const PERM_GROUPS = [
    { title: "Patient records", note: "Protected health information. Give this only to the people who treat patients.", keys: [PHI] },
    { title: "Day to day", keys: ["clients", "scheduling", "messages", "billing"] },
    { title: "Website and content", keys: ["content", "reviews"] },
    { title: "Practice administration", keys: ["insights", "settings", "security", "staff"] },
    { title: "Money and the partnership", note: "The manager's revenue share and affiliate payouts. Patient records never come with these.", keys: ["partner", "payouts"] }
  ];
  const permGroups = (list) => {
    const left = new Map((list || []).map((p) => [p.key, p])), out = [];
    for (const g of PERM_GROUPS) {
      const items = g.keys.map((k) => left.get(k)).filter(Boolean);
      g.keys.forEach((k) => left.delete(k));
      if (items.length) out.push({ ...g, items });
    }
    if (left.size) out.push({ title: "Other", items: [...left.values()] });
    return out;
  };
  const permLabel = (data, k) => (((data && data.permissions) || []).find((p) => p.key === k) || {}).label || k;
  const roleLabel = (data, r) => (((data && data.roles) || {})[r] || {}).label || r || "—";
  // Patient-record access never looks like the others, in any list on this screen
  const permPill = (k, data) => k === PHI
    ? `<span class="pill phi">${ui("lock", 12)}${esc(permLabel(data, k))} · patient records</span>`
    : `<span class="pill">${esc(permLabel(data, k))}</span>`;
  const permPills = (keys, data, all) => all
    ? `<span class="pill accent">Everything, including patient records</span>`
    : ((keys || []).length ? [...keys].sort((a, b) => (a === PHI ? -1 : b === PHI ? 1 : 0)).map((k) => permPill(k, data)).join("") : `<span class="muted" style="font-size:12.5px">Nothing yet</span>`);
  const isMe = (s) => !!(cache.me && s && s.email && String(s.email).toLowerCase() === String(cache.me.email).toLowerCase());
  const formMsg = (f, text) => { const m = f.querySelector("[data-msg]"); if (m) m.textContent = text; };
  const errText = (err) => err.message + (err.need ? ` (it needs the ${err.need} permission)` : "");
  const picks = (f) => [...f.querySelectorAll("input[name=perm]:checked")].map((x) => x.value);

  // The tick list. A permission the signed-in person does not hold themselves cannot be ticked here: the server
  // refuses to pass on what you do not have, so the box is shown but switched off, with the reason next to it.
  function permEditor(data, role, chosen, lock) {
    const mine = myPerms(), owner = iAmOwner(), on = new Set([].concat(role || []).flatMap((k) => (((data.roles || {})[k]) || {}).permissions || [])), picked = new Set(chosen || []);
    return `<div class="perm-groups" data-perms>
      <p class="muted" data-rolesum style="margin:0;font-size:12.5px"></p>
      ${permGroups(data.permissions).map((g) => `<div class="perm-g"><h3>${esc(g.title)}</h3>${g.note ? `<p class="muted" style="margin:0 0 6px;font-size:12px">${esc(g.note)}</p>` : ""}
        <div class="perm-list">${g.items.map((p) => {
          const phi = p.key === PHI, mayGive = owner || mine.has(p.key), dis = lock || !mayGive;
          return `<label class="perm${phi ? " phi" : ""}${on.has(p.key) ? " in-role" : ""}${dis ? " off" : ""}" data-perm="${esc(p.key)}">
            <input type="checkbox" name="perm" value="${esc(p.key)}"${picked.has(p.key) ? " checked" : ""}${dis ? " disabled" : ""}>
            <span class="perm-t">${phi ? ui("lock", 14) : ""}${esc(p.label || p.key)}${phi ? `<span class="pill phi">Patient records (PHI)</span>` : ""}</span>
            <span class="perm-d muted">${esc(p.description || "")}</span>
            <span class="perm-role" data-rolein${on.has(p.key) ? "" : " hidden"}>Part of this role</span>
            ${!mayGive && !lock ? `<span class="perm-d muted" data-cant>You do not have this yourself, so you cannot give it to anyone.</span>` : ""}
          </label>`;
        }).join("")}</div></div>`).join("")}
    </div>`;
  }
  // Picking a role shows what that role means before anything is saved, and ticks its permissions.
  function permRoleSync(f, data, tick) {
    if (!f || !f.isConnected) return;
    const boxes = [...f.querySelectorAll("input[name=role]")];
    const picked = boxes.length && !boxes[0].disabled ? boxes.filter((b) => b.checked).map((b) => b.value) : (f.dataset.roles || "").split(",").filter(Boolean);
    const R = (k) => ((data.roles || {})[k]) || {}, role = picked.join(", ");
    const on = new Set(picked.flatMap((k) => R(k).permissions || []));
    const neverBy = new Map(); picked.forEach((k) => (R(k).never || []).forEach((p) => { if (!neverBy.has(p)) neverBy.set(p, k); }));
    const r = { never: [...neverBy.keys()] };
    // A role that can't sit beside the ones already ticked is switched off, with the reason
    const clash = (a, b) => (R(a).permissions || []).find((p) => (R(b).never || []).includes(p));
    for (const b of boxes) {
      if (b.dataset.baseDis === undefined) b.dataset.baseDis = b.disabled ? "1" : "";
      const why = !b.checked && picked.map((k) => { const c = clash(b.value, k) || clash(k, b.value); return c ? `${R(b.value).label || b.value} can't be combined with ${R(k).label || k}` : ""; }).find(Boolean);
      b.disabled = b.dataset.baseDis === "1" || !!why;
      const lab = b.closest("label"); if (lab) { lab.classList.toggle("off", b.disabled); lab.title = why || ""; const n = lab.querySelector("[data-clash]"); if (n) n.textContent = why ? why + "." : ""; }
    }
    for (const el of f.querySelectorAll(".perm")) {
      const k = el.dataset.perm, box = el.querySelector("input[name=perm]");
      // What this role may never hold (the Manager and Developer roles never reach patient records): switched off
      const never = (r.never || []).includes(k), cantTag = el.querySelector("[data-never]");
      if (box) {
        if (box.dataset.baseDis === undefined) box.dataset.baseDis = box.disabled ? "1" : ""; // switched off for its own reason (locked, or not yours to give)
        box.disabled = never || box.dataset.baseDis === "1";
        if (never) box.checked = false;
        el.classList.toggle("off", box.disabled);
      }
      if (cantTag) cantTag.remove();
      if (never) el.insertAdjacentHTML("beforeend", `<span class="perm-d muted" data-never>A ${esc(roleLabel(data, neverBy.get(k)))} account can never have this.</span>`);
      el.classList.toggle("in-role", on.has(k));
      const tag = el.querySelector("[data-rolein]"); if (tag) tag.hidden = !on.has(k);
      if (tick && box && !box.disabled) box.checked = on.has(k);
    }
    const sum = f.querySelector("[data-rolesum]");
    const names = picked.map((k) => roleLabel(data, k)).join(" + ");
    if (sum) sum.textContent = !picked.length ? "Tick at least one role above."
      : on.size ? `${names} turn${picked.length === 1 ? "s" : ""} on: ${[...on].map((k) => permLabel(data, k)).join(", ")}. Tick or untick below to change it for this person only.`
      : `${names} turn${picked.length === 1 ? "s" : ""} nothing on by itself. Tick what this person needs.`;
  }

  // Roles as tick boxes: a person can hold several, and gets what all of them turn on
  const rolesOfStaff = (s) => (Array.isArray(s.roles) && s.roles.length ? s.roles : s.role ? [s.role] : []);
  const rolePicker = (roles, chosen, locked) => `<fieldset class="field role-pick" style="border:0;padding:0;margin:0"><legend style="font-weight:600;font-size:13px;margin-bottom:6px">Roles <span class="muted" style="font-weight:400">(tick one or more)</span></legend>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px">${roles.map(([k, r]) => `<label class="perm" style="padding:8px 10px"><input type="checkbox" name="role" value="${esc(k)}" data-change="staffRole"${chosen.includes(k) ? " checked" : ""}${locked ? " disabled" : ""}>
      <span class="perm-t">${esc(r.label || k)}</span><span class="perm-d muted" data-clash></span></label>`).join("")}</div></fieldset>`;
  function staffRow(s, data) {
    const owner = s.role === "owner", self = isMe(s), off = s.active === false;
    const why = owner ? "The owner's sign-in is set in the host's variables, so it is not changed from here and cannot be switched off."
      : self ? "This is you. Your own role, permissions and access are locked, so nobody can lock themselves out or give themselves more." : "";
    const no = (stop, reason) => stop ? ` disabled aria-disabled="true" title="${esc(reason)}"` : "";
    const nm = esc(s.name || s.email || "");
    return `<li class="staff-row${off ? " off" : ""}" data-staff="${esc(s.id)}">
      <div class="staff-who">${avatar(s.name || s.email, 36)}<span style="min-width:0"><b>${nm}</b><span class="muted" style="display:block;font-size:12.5px;overflow-wrap:anywhere">${esc(s.email || "")}</span></span></div>
      <div class="staff-meta">
        ${rolesOfStaff(s).map((k) => `<span class="pill accent">${esc(roleLabel(data, k))}</span>`).join("")}
        <span class="pill ${off ? "warn" : "ok"}">${off ? "Deactivated" : "Can sign in"}</span>
        ${self ? `<span class="pill">You</span>` : ""}
        <span class="muted" style="font-size:12.5px">${off ? `Deactivated ${when(s.deactivatedAt)}` : `Last sign-in ${when(s.lastLoginAt)}`}</span>
      </div>
      <div class="staff-perms" data-perms-of="${esc(s.id)}">${permPills(s.permissions, data, owner)}</div>
      ${why ? `<p class="staff-why muted">${ui("lock", 14)}<span>${esc(why)}</span></p>` : ""}
      <div class="staff-acts">
        <button type="button" class="btn" data-act="staffEdit" data-id="${esc(s.id)}"${no(owner, "The owner is not edited here.")}>Edit</button>
        <button type="button" class="btn" data-act="staffPw" data-id="${esc(s.id)}" data-name="${nm}"${no(owner, "The owner's password is changed in the host's variables.")}>Reset password</button>
        ${off
          ? `<button type="button" class="btn primary" data-act="staffOn" data-id="${esc(s.id)}" data-name="${nm}"${no(owner || self, owner ? "The owner is always able to sign in." : "You cannot switch your own access on or off.")}>Let them sign in again</button>`
          : `<button type="button" class="btn danger" data-act="staffOff" data-id="${esc(s.id)}" data-name="${nm}"${no(owner || self, owner ? "The owner cannot be switched off." : "You cannot switch off your own access.")}>Deactivate</button>`}
      </div></li>`;
  }

  V.team = async () => {
    const me = await load("/me"); cache.me = me;
    const mfa = await load("/mfa").catch(() => null);
    const mayManage = can("staff");
    const head = `<div class="view-head"><div><h1>Team &amp; roles</h1><p class="muted">Who can sign in to this workspace, and what each of them may do</p></div>
      ${mayManage ? `<button type="button" class="btn primary" data-act="staffAdd">${ui("plus", 14)} Add a person</button>` : ""}</div>`;
    const you = `<div class="card stack" id="teamYou" style="margin-bottom:16px">
      <div class="card-head"><h2>Your account</h2><span class="pill accent">${esc(me.isOwner ? "Owner" : roleLabel(null, me.role))}</span></div>
      <p style="margin:0"><b>${esc(me.name || me.email)}</b><span class="muted" style="display:block;font-size:12.5px;overflow-wrap:anywhere">${esc(me.email)}</span></p>
      <div class="staff-perms">${permPills(me.permissions, null, me.isOwner)}</div>
      ${mfa ? `<p class="muted" style="margin:0;font-size:12.5px">Two-step sign-in: ${mfa.enabled ? "on" : "off"} · <a href="#security">Sign-in security</a></p>` : ""}
      <div class="row"><button type="button" class="btn" data-act="mePw">Change my password</button></div></div>`;
    if (!mayManage) return `${head}${you}
      <div class="card" id="teamNoAccess"><div class="card-head"><h2>Managing the team</h2></div>
      <p style="margin:0">You do not have the Team &amp; roles permission, so adding people, changing what they may do and switching access on or off are not yours to do. Everything else you can reach is in the menu. If you need this, ask the practice owner or anyone else who holds it.</p></div>`;
    const data = await load("/staff");
    const list = data.staff || [], live = list.filter((s) => s.active !== false);
    return `${head}${you}
    <div class="card" id="teamList" style="margin-bottom:16px"><div class="card-head"><h2>Who can sign in</h2>
      <span class="muted" style="font-size:12px">${plural(live.length, "person")} of ${list.length} ${list.length === 1 ? "is" : "are"} active</span></div>
      <ul class="staff-list">${list.map((s) => staffRow(s, data)).join("") || `<li>${none("Nobody has been added yet.")}</li>`}</ul>
      <p class="muted" style="margin:12px 0 0;font-size:12.5px">Deactivating is reversible and deletes nothing: the person's record, and everything they did, stays. It only stops them signing in, until you let them again.</p></div>
    <div class="card" id="teamRoles"><div class="card-head"><h2>What the roles mean</h2></div>
      <ul class="staff-list">${Object.entries(data.roles || {}).map(([k, r]) => `<li class="staff-row" data-role="${esc(k)}">
        <div class="staff-who"><span><b>${esc(r.label || k)}</b><span class="muted" style="display:block;font-size:12.5px">${k === "owner" ? "Everything. Set in the host's variables, not here." : plural((r.permissions || []).length, "permission")}</span></span></div>
        <div class="staff-perms">${permPills(r.permissions, data, k === "owner")}</div></li>`).join("")}</ul>
      <p class="muted" style="margin:12px 0 0;font-size:12.5px">A role is a starting point. When you add or edit someone you can tick anything on or off for them alone.</p></div>`;
  };

  V.feedback = async () => {
    const [reviews, rep] = await Promise.all([load("/feedback"), load("/feedback-reports")]);
    return `<div class="view-head"><div><h1>Reviews & feedback</h1><p class="muted">${plural(reviews.length, "review")} · ${plural(rep.open || 0, "open report")}</p></div></div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Reviews from the website</h2></div>
      ${reviews.map((f) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(f.name)}</b> <span class="stars" role="img" aria-label="${Math.max(0, Math.min(5, f.rating || 0))} out of 5 stars">${ui("star", 13).repeat(Math.max(0, Math.min(5, f.rating || 0)))}</span> <span class="pill">${esc(f.status)}</span><p class="note-text">${esc(f.text)}</p></span>
        ${f.status !== "hidden" ? `<button class="btn sm" data-act="review" data-id="${esc(f.id)}" data-st="hidden">Hide</button>` : `<button class="btn sm" data-act="review" data-id="${esc(f.id)}" data-st="pending">Restore</button>`}${f.publish && f.status !== "approved" ? `<button class="btn sm primary" data-act="review" data-id="${esc(f.id)}" data-st="approved">Show on website</button>` : ""}</div>`).join("") || none("No reviews yet.")}</div>
    <div class="card"><div class="card-head"><h2>Bug reports and ideas</h2></div>
      ${rep.reports.map((r) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(r.title)}</b> <span class="pill">${r.kind === "bug" ? "Bug" : "Suggestion"}</span> <span class="pill">${esc(r.status)}</span><p class="note-text">${esc(r.body)}</p><span class="muted" style="font-size:12px">${esc(r.clientName || "")} · ${when(r.createdAt)}</span></span>
        ${r.status !== "resolved" ? `<button class="btn sm" data-act="report" data-id="${esc(r.id)}" data-st="resolved">Mark resolved</button>` : ""}</div>`).join("") || none("No reports.")}</div></div>`;
  };

  V.security = async () => {
    const [a, mfa] = await Promise.all([load("/audit"), part("/mfa", "owner")]);
    return `<div class="view-head"><div><h1>Security & audit</h1><p class="muted">Every sign-in, every look at a record and every change, in a ledger that detects tampering</p></div><button class="btn primary" data-act="auditVerify">Verify the ledger</button></div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><h2 style="margin-bottom:10px">Ledger check</h2><div id="auditResult">${none("Not checked in this session. Press Verify.")}</div></div>
      <div class="card"><h2 style="margin-bottom:10px">Sign-in</h2>
        ${!mfa ? `<div class="list-item"><span style="flex:1">Two-step sign-in by email code<div class="muted" style="font-size:12px">Switched on and off by the practice owner.</div></span></div>` : `<div class="list-item"><span style="flex:1">Two-step sign-in by email code<div class="muted" style="font-size:12px">${mfa.forcedOff ? "Switched off by a server setting." : mfa.emailReady ? `The code goes to ${esc(mfa.sendsTo || "your email")}.` : "Email is not connected on the server, so codes cannot be sent."}</div></span><span class="pill ${mfa.enabled ? "ok" : "warn"}">${mfa.enabled ? "On" : "Off"}</span>${mfa.forcedOff ? "" : `<button class="btn sm ${mfa.enabled ? "" : "primary"}" data-act="${mfa.enabled ? "mfaOff" : "mfaOn"}">${mfa.enabled ? "Turn off" : "Turn on"}</button>`}</div>`}
        <div class="list-item"><span style="flex:1">Signs out when idle</span><span class="pill ok">15 minutes</span></div></div>
    </div>
    ${ledgerTable(a)}`;
  };

  // Hours are typed the way they are said: "09:00-12:00, 13:00-17:00". Blank means closed that day.
  const hoursText = (day) => (day || []).map((w) => `${w[0]}-${w[1]}`).join(", ");
  V.settings = async () => {
    const [s, cal, me] = await Promise.all([load("/settings"), part("/calsync", "scheduling"), load("/me")]);
    cache.settings = s;
    const b = s.business || {}, sc = s.scheduling || {}, pl = s.plans || {}, bk = s.booking || {};
    return `<div class="view-head"><div><h1>Settings</h1><p class="muted">Practice details, booking hours, visit types, fees and connections</p></div><a class="btn" href="#security">Sign-in security</a></div>
    <div class="grid g2">
      <div class="card stack"><h2>Practice</h2><form class="stack" data-form="setBusiness">
        <div class="grid g2">${fld("sbName", "name", "Name", b.name, { max: 60, attrs: "required" })}${fld("sbPhone", "phone", "Phone", b.phone, { max: 30 })}</div>
        ${fld("sbTag", "tagline", "Tagline", b.tagline, { max: 160 })}${fld("sbEmail", "email", "Contact email", b.email, { type: "email", max: 120 })}${fld("sbAddr", "address", "Address", b.address, { max: 200 })}
        ${fld("sbHours", "hours", "Hours as shown on the website", b.hours, { area: true, rows: 2, max: 300 })}${fld("sbNote", "bookingNote", "Note on the booking page", b.bookingNote, { area: true, rows: 2, max: 300 })}
        <div class="row"><button class="btn primary">Save practice details</button></div></form></div>
      <div class="card stack" id="hours"><h2>Hours people can book</h2><form class="stack" data-form="setHours">
        ${DAYN.map((d, i) => `<div class="row" style="flex-wrap:nowrap"><label for="hr${i}" style="flex:0 0 96px">${d}</label><input id="hr${i}" name="h${i}" class="input" style="flex:1;min-width:0" value="${esc(hoursText((sc.hours || [])[i]))}" placeholder="Closed" maxlength="60" autocomplete="off"></div>`).join("")}
        <p class="muted" style="margin:0;font-size:12.5px">Type times like 09:00-12:00, 13:00-17:00. Leave a day blank to close it.</p>
        <div class="grid g2">${sel("hrStep", "slotStepMin", "Offer a start time every", [[10, "10 minutes"], [15, "15 minutes"], [20, "20 minutes"], [30, "30 minutes"], [60, "60 minutes"]], sc.slotStepMin)}${fld("hrLast", "lastStart", "Latest start time (optional)", sc.lastStart, { type: "time" })}</div>
        <div class="grid g2">${fld("hrNotice", "minNoticeHours", "Shortest notice (hours)", sc.minNoticeHours, { type: "number", attrs: 'min="0" max="168"' })}${fld("hrAhead", "daysAhead", "How far ahead (days)", sc.daysAhead, { type: "number", attrs: 'min="1" max="90"' })}</div>
        ${fld("hrBlock", "blockedDates", "Days off (dates like 2026-12-25, separated by commas)", (sc.blockedDates || []).join(", "), { area: true, rows: 2, max: 2400 })}
        <div class="row"><button class="btn primary">Save booking hours</button></div></form></div>
      <div class="card stack"><h2>Visit types</h2><form class="stack" data-form="setTypes">
        ${[...(s.appointmentTypes || []), ...((s.appointmentTypes || []).length < 8 ? [{ id: "", name: "", minutes: 60, description: "" }] : [])].map((t, i) => `<div class="set-row"><input name="name${i}" class="input" value="${esc(t.name)}" maxlength="60" placeholder="${t.id ? "Name" : "Add a visit type"}" aria-label="Visit type ${i + 1} name"><input name="minutes${i}" class="input" type="number" min="10" max="240" value="${esc(t.minutes)}" aria-label="Visit type ${i + 1} minutes"><label class="row" style="gap:6px;flex-wrap:nowrap"><input type="checkbox" name="remote${i}"${t.remote ? " checked" : ""}> Video</label><input name="description${i}" class="input wide" value="${esc(t.description || "")}" maxlength="200" placeholder="Short description" aria-label="Visit type ${i + 1} description"></div>`).join("")}
        <p class="muted" style="margin:0;font-size:12.5px">Name, length in minutes, whether it is on video. Clear a name to remove that type${(s.appointmentTypes || []).length < 8 ? "; fill the last row to add one" : ". Eight is the most there can be"}.</p>
        <div class="row"><button class="btn primary">Save visit types</button></div></form></div>
      <div class="card stack"><h2>Services &amp; fees</h2><form class="stack" data-form="setServices">
        ${[...(s.services || []), ...((s.services || []).length < 12 ? [{ id: "", name: "", rate: "", unit: "visit", description: "" }] : [])].map((x, i) => `<div class="set-row"><input name="name${i}" class="input" value="${esc(x.name)}" maxlength="60" placeholder="${x.id ? "Name" : "Add a service"}" aria-label="Service ${i + 1} name"><input name="rate${i}" class="input" type="number" min="0" max="10000" step="1" value="${esc(x.rate)}" placeholder="$" aria-label="Service ${i + 1} price in dollars"><input name="unit${i}" class="input" value="${esc(x.unit || "visit")}" maxlength="20" aria-label="Service ${i + 1} unit"><input name="description${i}" class="input wide" value="${esc(x.description || "")}" maxlength="300" placeholder="Short description" aria-label="Service ${i + 1} description"></div>`).join("")}
        <p class="muted" style="margin:0;font-size:12.5px">Name, price in whole dollars, per what. Clear a name to remove a service. Prices on the website and at checkout follow these.</p>
        <div class="row"><button class="btn primary">Save services &amp; fees</button></div></form></div>
      <div class="card stack"><h2>Care plan pricing</h2><form class="stack" data-form="setPlans">
        <div class="grid g2">${fld("plGold", "gold", "Paid in full: % off", pl.gold, { type: "number", attrs: 'min="0" max="50"' })}${fld("plSilver", "silver", "Monthly payments: % off", pl.silver, { type: "number", attrs: 'min="0" max="50"' })}</div>
        <div class="grid g2">${fld("plSp", "silverPayments", "Monthly payments: how many", pl.silverPayments, { type: "number", attrs: 'min="2" max="12"' })}${fld("plRev", "reviewDiscountPct", "Review reward: % off", pl.reviewDiscountPct, { type: "number", attrs: 'min="0" max="100"' })}</div>
        <div class="grid g2">${fld("plE12", "ext12", "Spread over 12 months: % added", pl.ext12, { type: "number", attrs: 'min="0" max="50"' })}${fld("plE24", "ext24", "Spread over 24 months: % added", pl.ext24, { type: "number", attrs: 'min="0" max="50"' })}</div>
        <div class="row"><button class="btn primary">Save pricing</button></div></form></div>
      <div class="card stack"><h2>Calendars and video</h2>
        ${!cal ? `<p class="muted" style="margin:0">The calendar connections are not available for your role.</p>` : `<div class="list-item"><span style="flex:1">Google Calendar${cal.serviceAccountEmail && cal.google !== "off" ? `<div class="muted" style="font-size:12px;overflow-wrap:anywhere">Shared with ${esc(cal.serviceAccountEmail)}${cal.calendars > 1 ? ` · ${cal.calendars} calendars` : ""}</div>` : ""}</span><span class="pill ${cal.google !== "off" ? "ok" : ""}">${cal.google !== "off" ? "Connected" : "Off"}</span></div>
        <div class="list-item"><span style="flex:1">SimplePractice calendar${cal.simplePracticeUrl ? `<div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(cal.simplePracticeUrl)}</div>` : ""}</span><span class="pill ${cal.simplepractice !== "off" ? "ok" : ""}">${cal.simplepractice !== "off" ? "Connected" : "Off"}</span></div>`}
        <div class="list-item"><span style="flex:1">Email alerts to you</span><span class="pill ${me.emailNotifications ? "ok" : ""}">${me.emailNotifications ? "On" : "Off"}</span></div>
        ${cal && cal.lastError ? `<p class="muted" style="margin:0">Last calendar problem: ${esc(cal.lastError)}</p>` : ""}
        ${!cal ? "" : `<form class="stack" data-form="setIcs">${fld("icsUrl", "icsUrl", "SimplePractice calendar link (paste a new one to change it; blank disconnects)", "", { type: "url", max: 500, attrs: 'placeholder="https://… or webcal://…" autocomplete="off"' })}
          <div class="row"><button class="btn">Save calendar link</button><button type="button" class="btn" data-act="calTest">Check the calendars now</button></div><div id="calTestOut" class="muted" style="font-size:12.5px"></div></form>`}
        <form class="stack" data-form="setVideo" style="border-top:1px solid var(--line);padding-top:12px">${fld("tvUrl", "telehealthUrl", "Outside video room link (optional; the built-in Telehealth room needs none)", bk.telehealthUrl, { type: "url", max: 300, attrs: 'placeholder="https://"' })}
          <div class="row"><button class="btn">Save video link</button></div></form></div>
    </div>`;
  };

  // Client app: what members can do, and the editor for their Home screen (which cards show, in what order, and how many
  // of Solomon's suggestions before "Show more"). Changes are a draft until Save; members see them on their next load.
  V.portal = async () => {
    const c = can("content") ? await load("/content").catch(() => null) : null;
    if (c) cache.content = c;
    return `<div class="view-head"><div><h1>Client app</h1><p class="muted">What members use on their phone and on the web</p></div><a class="btn primary" href="/account" target="_blank" rel="noopener">Open the client app</a></div>
    ${c && c.home ? homeEditor(c) : ""}
    <div class="card"><h2 style="margin-bottom:10px">What members can do today</h2>${["Read notes from you and play their prescribed movements", "Book and pay for video visits", "Fill out new patient documents", "Message you", "Log pain and workouts", "Follow programs and earn rewards"].map((x) => `<div class="list-item">${x}</div>`).join("")}</div>`;
  };
  // Home and Profile in the member app: every card in priority order (top first), each Open, Folded (one line on a
  // phone that opens on a tap) or Hidden. A draft until Save; members see it the next time the app loads. Members can
  // also arrange their own inside this (a card hidden here stays hidden for them).
  const layTab = () => (state.layTab === "profile" ? "profile" : "home");
  const layDraft = (w = layTab()) => { state.layDraft = state.layDraft || {}; return state.layDraft[w] || (state.layDraft[w] = JSON.parse(JSON.stringify(cache.content[w]))); };
  const layState = (x) => x.state || (x.show === false ? "hidden" : "open");
  const LAY_STATES = [["open", "Open"], ["folded", "Folded"], ["hidden", "Hidden"]];
  function homeEditor(c) {
    const w = layTab(), d = layDraft(w), defs = ((c.options && c.options.layouts) || {})[w] || (w === "home" ? (c.options && c.options.homeSections) || [] : []);
    const labels = new Map(defs.map((x) => [x.id, x.label]));
    const dirty = JSON.stringify(d) !== JSON.stringify(c[w]), n = (st) => d.sections.filter((x) => layState(x) === st).length;
    const row = (x, i) => { const st = layState(x); return `<div class="list-item" style="gap:10px;${st === "hidden" ? "opacity:.55" : ""}">
        <span style="width:22px;text-align:right" class="muted num">${i + 1}</span>
        <span style="flex:1;min-width:0"><b>${esc(labels.get(x.id) || x.id)}</b></span>
        <span class="row" role="group" aria-label="${esc(labels.get(x.id) || x.id)}" style="gap:4px">${LAY_STATES.map(([v, l]) => `<button type="button" class="btn sm${st === v ? " primary" : ""}" data-act="layState" data-i="${i}" data-v="${v}" aria-pressed="${st === v}">${ui(v === "hidden" ? "eyeOff" : v === "folded" ? "down" : "eye", 14)} ${l}</button>`).join("")}</span>
        <button type="button" class="btn sm" data-act="layMove" data-i="${i}" data-by="-1" aria-label="Move up" ${i ? "" : "disabled"}>${ui("up", 14)}</button>
        <button type="button" class="btn sm" data-act="layMove" data-i="${i}" data-by="1" aria-label="Move down" ${i < d.sections.length - 1 ? "" : "disabled"}>${ui("down", 14)}</button></div>`; };
    const tab = (v, l) => `<button type="button" class="btn sm${w === v ? " primary" : ""}" data-act="layTab" data-v="${v}" aria-pressed="${w === v}">${l}</button>`;
    return `<div class="card" style="margin-bottom:16px" id="homeCard"><div class="card-head"><div><h2>Home and Profile pages</h2><p class="muted" style="margin:2px 0 0;font-size:12.5px">What members see, top to bottom by priority. ${n("open")} open, ${n("folded")} folded to one line on a phone, ${n("hidden")} hidden. Members can rearrange their own, but never see a card hidden here.</p></div><div class="row" style="gap:6px">${tab("home", "Home")}${tab("profile", "Profile")}</div></div>
      ${d.sections.map(row).join("")}
      <form class="row" data-form="homeSave" novalidate style="margin-top:14px;gap:10px;align-items:flex-end;flex-wrap:wrap">
        ${w === "home" ? fld("homeSug", "suggestions", "Solomon's suggestions shown before \u201cShow more\u201d (0 hides them)", d.suggestions, { type: "number", attrs: 'min="0" max="20" required style="max-width:110px"' }) : ""}
        <button class="btn primary">Save ${w === "home" ? "Home" : "Profile"}</button>
        <button type="button" class="btn" data-act="homeReset"${dirty ? "" : " disabled"}>Undo changes</button>
        <p role="alert" data-msg style="margin:0;color:var(--bad);flex-basis:100%;min-height:1.2em"></p>
      </form></div>`;
  }

  V.booking = async () => {
    const s = await part("/settings", "settings"), url = location.origin + "/book";
    return `<div class="view-head"><div><h1>Booking page</h1><p class="muted">The public page where people book with you</p></div><a class="btn primary" href="/book" target="_blank" rel="noopener">Open booking page</a></div>
    <div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Booking link</h2><div class="row"><input class="input" id="bookUrl" readonly value="${esc(url)}" aria-label="Booking link" style="flex:1"><button class="btn" data-act="copyBook">Copy</button></div>${b_note(s)}</div>
    <div class="card"><div class="card-head"><h2>What people can book</h2>${navOk("settings") ? `<a class="btn sm" href="#settings">Hours and fees</a>` : ""}</div>${!s ? none("The list of services is not available for your role.") : (s.services || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.unit || "")}</div></span><b class="num">${money(x.rate)}</b></div>`).join("") || none("No services.")}</div></div>`;
  };
  const b_note = (s) => s && s.business && s.business.bookingNote ? `<p class="muted" style="margin:10px 0 0">${esc(s.business.bookingNote)}</p>` : "";

  // ---------------------------------------------------------------- actions
  const reChart = async () => { const id = state.chartClient; const [d, c] = await Promise.all([get(`/emr/${id}`), get(`/clients/${id}`)]); cache.chart = { ...cache.chart, d, c }; const box = $("#chartBody"); if (box) box.innerHTML = chartTab(); };
  const showDocs = (d) => (d.docs || []).map((doc) => `<div class="card" style="box-shadow:none;margin-top:10px"><h3 style="margin:0 0 2px">${esc(doc.title)}</h3><p class="muted" style="margin:0 0 8px;font-size:12px">Completed ${when(doc.createdAt)}</p><dl class="doc-qa">${(doc.fields || []).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(Array.isArray(f.value) ? f.value.join(", ") : f.value === true ? "Yes" : f.value === false ? "No" : f.value == null || f.value === "" ? "—" : f.value)}</dd></div>`).join("")}</dl></div>`).join("") || none("No documents received yet.");
  const ACT = {
    painAdd: async (el) => {
      const c = cache.chart.c, first = String(cache.chart.d.name).split(" ")[0], x = (painCat && painCat.by.get(`${el.dataset.kind}:${el.dataset.id}`)) || { title: el.dataset.id };
      const note = prompt(`Add "${x.title}" to ${first}'s program. Optional note for ${first}:`, "");
      if (note === null) return;
      const items = (c.assignedPain || []).filter((y) => !(y.kind === el.dataset.kind && y.id === el.dataset.id)).map(({ kind, id, note: n }) => ({ kind, id, note: n }));
      await savePain([...items, { kind: el.dataset.kind, id: el.dataset.id, note }]); toast(`Added to ${first}'s program.`);
    },
    // Remove from the client's dashboard: the prescription (if any) and, for a track, its place on their road.
    // Sessions they already did stay in their history.
    painRm: async (el) => {
      const c = cache.chart.c, first = String(cache.chart.d.name).split(" ")[0], k = el.dataset.kind, tid = el.dataset.id;
      const x = (painCat && painCat.by.get(`${k}:${tid}`)) || { title: tid };
      if (!confirm(`Remove "${x.title}" from ${first}'s dashboard? Sessions ${first} already did stay in their history.`)) return;
      if (el.dataset.pres) await savePain((c.assignedPain || []).filter((y) => !(y.kind === k && y.id === tid)).map(({ kind, id, note }) => ({ kind, id, note })));
      if (k === "track" && el.dataset.road) {
        try { const r = await api("DELETE", `/api/admin/clients/${encodeURIComponent(state.chartClient)}/road-tracks/${encodeURIComponent(tid)}`); cache.chart.c = { ...cache.chart.c, assignedPain: r.assignedPain, painWork: r.painWork }; await loadPainRehab(); }
        catch (e) { if (!/isn't on their road/.test(e.message)) throw e; }
      }
      toast("Removed.");
    },
    chart: (el) => openChart(el.dataset.id),
    chartClose: (el, e) => { e.preventDefault(); state.chartClient = null; render(); },
    chartTab: (el) => { state.chartTab = el.dataset.tab; document.querySelectorAll(".tabs .tab").forEach((b) => b.classList.toggle("active", b === el)); $("#chartBody").innerHTML = chartTab(); chartAfter(); },
    // ---- clinical notes
    noteSave: async () => { const r = await noteSave(false); toast(r ? "Draft saved." : "Write something first."); },
    noteSign: async () => {
      const box = $("#nBody"), forPatient = $("#nPatient").value.trim();
      if (!box.value.trim()) { toast("Write the note before signing it."); return; }
      if (!confirm(`Sign and lock this note? It cannot be changed afterwards; later information goes in an addendum.${forPatient ? "\n\nThe text under \"For the patient\" will be shared with the patient." : ""}`)) return;
      await noteSave(false);
      await api("POST", `/api/admin/notes/${note.id}/sign`, {});
      if (forPatient) await api("POST", `/api/admin/emr/${note.clientId}/notes`, { text: forPatient });
      noteReset(note.clientId); stopDictation();
      toast(forPatient ? "Signed and locked. The patient's note was shared." : "Signed and locked."); await render();
    },
    noteTag: (el) => { const t = el.dataset.tag, i = note.tags.indexOf(t); if (i < 0) note.tags.push(t); else note.tags.splice(i, 1); el.classList.toggle("on", i < 0); el.setAttribute("aria-pressed", String(i < 0)); noteTouch(); },
    noteCarry: async () => {
      const r = await get(`/notes?clientId=${note.clientId}`), last = (r.notes || []).find((n) => n.status === "signed" && n.text);
      const m = last && last.text.match(/(?:^|\n)[ \t]*Plan[^\n:]*:[ \t]*([\s\S]*?)(?=\n[ \t]*[A-Z][A-Za-z ,'/-]{2,40}:[ \t]*(?:\n|$)|$)/);
      let plan = m ? m[1].trim() : "";
      if (!plan) { const c = await get(`/clients/${note.clientId}`); plan = ((c.plan && c.plan.notes) || "").trim(); }
      if (!plan) { toast("There is no earlier plan on file for this client."); return; }
      noteAppend("Plan carried forward from the last visit:\n" + plan);
    },
    noteGoal: async () => {
      const d = await get(`/clients/${note.clientId}/intake`).catch(() => ({ docs: [] }));
      const f = (d.docs || []).flatMap((x) => x.fields || []).find((x) => /goal|get back to/i.test(x.label || "") && x.value);
      if (!f) { toast("This client has not written a goal in their intake documents."); return; }
      noteAppend("Patient's stated goal: " + (Array.isArray(f.value) ? f.value.join(", ") : f.value));
    },
    noteScribe: async (el) => {
      const text = $("#sText").value.trim(), box = $("#nBody"), msg = $("#sMsg");
      if (text.length < 20) { msg.textContent = "Dictate or paste a few sentences about the visit first."; return; }
      if (box.value.trim() && !confirm("Replace what is in the note with the draft?")) return;
      el.disabled = true; msg.textContent = "Drafting…";
      try {
        const r = await api("POST", "/api/admin/scribe/draft", { clientId: note.clientId, text, kind: note.template });
        box.value = r.draft; box.focus(); box.setSelectionRange(0, 0); box.scrollTop = 0; noteTouch();
        msg.textContent = `Draft ready. Read it and edit before you sign.${r.removed ? ` ${r.removed} name, contact or date ${r.removed === 1 ? "detail was" : "details were"} removed before sending.` : ""}${r.backup ? ` The first AI service could not answer, so the backup (${r.host}, ${r.model}) drafted this.` : ""}`;
      } catch (err) { msg.textContent = err.message; }
      finally { el.disabled = false; }
    },
    notePatientDraft: async (el) => {
      const src = ($("#nBody").value.trim() || $("#sText").value.trim()), box = $("#nPatient");
      if (src.length < 20) { toast("Write the clinical note first; the patient's version is drafted from it."); return; }
      el.disabled = true;
      try { const r = await api("POST", "/api/admin/scribe/draft", { clientId: note.clientId, text: src, kind: "patient" }); box.value = r.draft; box.focus(); toast("Patient version drafted. Read it before sharing."); }
      catch (err) { toast(err.message); }
      finally { el.disabled = false; }
    },
    notePatientSend: async () => {
      const box = $("#nPatient"), text = box.value.trim(); if (!text) { toast("Write the patient's note first."); return; }
      if (!confirm("Share this with the patient now? They will see it in their app.")) return;
      await api("POST", `/api/admin/emr/${note.clientId}/notes`, { text }); box.value = ""; toast("Shared. The patient can see it now.");
    },
    noteAssist: async (el) => {
      el.disabled = true; const label = el.dataset.label;
      try {
        const b = await noteBundle(note.clientId);
        if (b.text.length < 20) { toast("There is nothing on this client's record to work from yet."); return; }
        const r = await api("POST", "/api/admin/scribe/draft", { clientId: note.clientId, text: b.text, kind: el.dataset.kind });
        modal(`<div class="card-head"><h2 class="row" style="gap:6px">${ui("spark", 18)}${esc(label)}</h2><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div>
          <p class="muted" style="margin:0 0 8px;font-size:12.5px">A draft for you to check against the record. Nothing has been saved.</p>
          <textarea id="assistOut" class="input" style="min-height:260px" readonly>${esc(r.draft)}</textarea>
          <div class="row" style="margin-top:10px"><button type="button" class="btn primary" data-act="noteInsert">Add to the note</button><button type="button" class="btn" data-act="assistCopy">${ui("copy", 14)}Copy</button></div>`);
      } catch (err) { toast(err.message); }
      finally { el.disabled = false; }
    },
    noteInsert: () => { const t = $("#assistOut").value; closeModal(); noteAppend(t); },
    assistCopy: async () => { try { await navigator.clipboard.writeText($("#assistOut").value); toast("Copied."); } catch { toast("Couldn't copy. Select the text and copy it."); } },
    noteOpen: async (el) => {
      const n = await get(`/notes/${el.dataset.id}`);
      if (n.status === "draft") { if (note.dirty) await noteSave(true); Object.assign(note, { id: n.id, clientId: n.clientId, template: n.template, tier: n.tier, tags: n.tags || [], dirty: false, savedAt: null }); await render(); const box = $("#nBody"); if (box) box.focus(); return; }
      modal(`<div class="card-head"><h2>${esc(TEMPLATES[n.template] || "Note")} <span class="pill ok">Signed</span>${n.tier !== "T1" ? ` <span class="pill">${esc(n.tier)}</span>` : ""}</h2><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div>
        <p class="muted" style="margin:0 0 8px;font-size:12.5px">Signed ${when(n.signedAt)} by ${esc(n.signedBy || "")} · locked${(n.tags || []).length ? " · " + n.tags.map(esc).join(", ") : ""}</p>
        ${n.unreadable ? none("This note can't be opened with the server's current keys. Nothing has been changed.") : `<div class="note-text" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(n.text)}</div>`}
        ${(n.addendaList || []).map((a) => `<div class="card" style="box-shadow:none;margin-top:10px"><div class="muted" style="font-size:12px">Addendum · ${when(a.at)} · ${esc(a.by || "")}</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(a.text)}</div></div>`).join("")}
        ${n.unreadable ? "" : `<form class="stack" data-form="noteAddendum" data-id="${esc(n.id)}" style="margin-top:12px"><div class="field" style="margin:0"><label for="addText">Add an addendum</label><textarea id="addText" name="text" class="input" rows="3" maxlength="20000" required placeholder="New information. The signed note above stays as it is."></textarea></div><div class="row"><button class="btn primary">Add addendum</button></div></form>`}`);
    },
    // A client chosen in the note screen's search. Choosing the client already selected only empties the search:
    // a switch would close the draft being written.
    noteClientPick: async (el) => {
      const id = el.dataset.id;
      if (id === note.clientId) { const q = $("#nClientQ"), r = $("#nClientRes"); if (q) q.value = ""; if (r) r.innerHTML = ""; toast("That client is already selected."); return; }
      await noteClientSwitch(id); const s = $("#nClient"); if (s && route() === "notes") s.focus();
    },
    noteDiscard: async (el) => { if (!confirm("Discard this draft? This cannot be undone.")) return; await api("DELETE", `/api/admin/notes/${el.dataset.id}`); if (note.id === el.dataset.id) noteReset(note.clientId); toast("Draft discarded."); await render(); },
    dictate: (el) => dictate(el),
    // Broadcast: one message to many people. It lands in each person's own private thread; nobody sees who else got it.
    broadcast: async () => {
      const [list, past] = await Promise.all([clients(), get("/messages/broadcasts").catch(() => [])]);
      modal(`<div class="card-head"><h2 class="row" style="gap:6px">${ui("broadcast", 18)}Broadcast</h2><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div>
        <form class="stack" data-form="broadcast">
          <p class="muted" style="margin:0;font-size:13px">One message to many people. Each person gets it in their own private thread and cannot see who else received it.</p>
          <div class="field"><label for="bcTo">Send to</label><select id="bcTo" name="to" class="input" data-change="bcTo"><option value="all">Everyone (${list.length})</option><option value="members">Paying members</option><option value="selected">People I pick</option></select></div>
          <div class="field" id="bcPick" hidden><label>Pick people</label><div class="bc-list">${list.map((c) => `<label class="row" style="gap:8px"><input type="checkbox" name="who" value="${esc(c.id)}"><span>${esc(c.name)} <span class="muted" style="font-size:12px">${esc(c.email)}</span></span></label>`).join("") || none("No clients yet.")}</div></div>
          <div class="field"><div class="row" style="justify-content:space-between"><label for="bcBody">Message</label><button type="button" class="btn sm mic" data-act="dictate" data-for="bcBody" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div><textarea id="bcBody" name="body" class="input" style="min-height:140px" maxlength="4000" required placeholder="Keep health details out of a message that goes to many people"></textarea></div>
          <label class="row" style="gap:8px"><input type="checkbox" name="email" checked><span>Also email each person that a new message is waiting (the email never contains the message)</span></label>
          <div class="row"><button class="btn primary">Send broadcast</button><span class="muted" id="bcMsg" role="status" style="font-size:12.5px"></span></div>
        </form>
        ${past.length ? `<h3 style="margin:14px 0 4px">Recent broadcasts</h3>${past.slice(0, 5).map((b) => `<div class="list-item"><span style="flex:1;min-width:0"><div class="muted" style="font-size:12px">${when(b.at)}${b.sending ? " · emails still going out" : ""}</div><div style="overflow-wrap:anywhere">${esc(b.preview)}${b.preview && b.preview.length >= 120 ? "…" : ""}</div></span><span class="pill">${b.read}/${b.recipients} read</span></div>`).join("")}` : ""}`);
    },
    teleRole: (el) => { const p = tele.peers.get(el.dataset.id); if (!p) return; p.byHost = el.dataset.role === "speaker" && !p.asking; MDFitRT.emit("tele_role", { clientId: p.id, role: el.dataset.role }); if (el.dataset.role === "speaker") toast(p.asking ? `${firstName(p.name)} is coming on screen.` : `${firstName(p.name)} was asked to speak. Their camera turns on once they agree.`); },
    teleKick: (el) => { const p = tele.peers.get(el.dataset.id); if (p && confirm(`Remove ${p.name} from the room? They cannot come back into this session.`)) MDFitRT.emit("tele_end", { clientId: p.id }); },
    teleAdmit: async (el) => {
      // Letting a second person into a private visit opens it as a live room: the one already in it becomes a viewer first
      if (teleIn() && !tele.group) { const cur = [...tele.peers.values()][0]; if (!confirm(`Open this visit to more people? ${cur ? firstName(cur.name) + "'s" : "Their"} camera and microphone turn off until you make them a speaker again and they agree. Everyone you admit comes in as a viewer.`)) return; MDFitRT.emit("tele_group", { on: true }); }
      // Someone already on screen will be seen and heard by whoever comes in next: say so before it happens
      const on = [...tele.peers.values()].filter((p) => p.role === "speaker" && p.remote.getTracks().some((t) => !t.muted && t.readyState === "live")).map((p) => firstName(p.name));
      const who = (tele.waiting.find((p) => p.clientId === el.dataset.id) || {}).name || "this person";
      if (tele.group && on.length && !confirm(`${on.join(" and ")} ${on.length === 1 ? "is" : "are"} on screen as a speaker. Admit ${who}? They will see and hear ${on.join(" and ")}.`)) return;
      el.disabled = true; try { await teleMedia(); teleMount(); MDFitRT.emit("tele_admit", { clientId: el.dataset.id }); } catch (err) { el.disabled = false; toast(err.message); }
    },
    teleDecline: (el) => { if (confirm("Turn this person away from the waiting room?")) MDFitRT.emit("tele_decline", { clientId: el.dataset.id }); },
    teleMic: () => { if (!tele.local) return; tele.micOff = !tele.micOff; tele.local.getAudioTracks().forEach((t) => { t.enabled = !tele.micOff; }); teleMount(); },
    teleCam: () => { if (!tele.cam) return; tele.camOff = !tele.camOff; tele.cam.enabled = !tele.camOff; teleMount(); },
    teleShare: () => teleShare(),
    teleEnd: () => { if (teleIn() && confirm("End this video visit?")) teleFinish(); },
    teleBoard: () => { if (!teleIn()) return; tele.board = !tele.board; teleSend({ t: "board", on: tele.board }); teleMount(); },
    teleClear: () => { boardClear($("#teleBoard")); teleSend({ t: "clear" }); },
    teleBlur: () => teleBlur(),
    teleChat: () => { tele.chatOpen = !tele.chatOpen; if (tele.chatOpen) tele.unread = 0; teleMount(); if (tele.chatOpen) { const i = $("#teleChatBox input"); if (i) i.focus(); } },
    teleScribeBtn: () => teleScribe(!tele.scribing),
    telePain: () => { if (teleSend({ t: "pain?" })) { tele.pain = null; tele.painAsked = true; teleMount(); toast("Pain check-in sent to the patient's screen."); } },
    useOwnRoom: async () => { await api("PUT", "/api/admin/settings", { booking: { telehealthUrl: location.origin + "/visit" } }); toast("Done. Video bookings now get the built-in room link."); await render(); },
    copyRoom: async (el) => { try { await navigator.clipboard.writeText(el.dataset.url); toast("Room link copied."); } catch { toast("Couldn't copy. Select the link and copy it."); } },
    thread: (el) => { state.thread = el.dataset.id; if (location.hash === "#messages") render(); else location.hash = "messages"; },
    insTab: (el) => { state.insTab = el.dataset.tab; render(); },
    // Open (or close) the list of people behind a count on Insights
    insList: (el) => {
      state.insList = state.insList === el.dataset.key ? "" : el.dataset.key;
      document.querySelectorAll('[data-act="insList"][aria-expanded]').forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.key === state.insList)));
      const box = $("#insPeople"); if (!box) return; box.innerHTML = insPeople();
      if (state.insList) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    calWeek: (el) => { const d = Number(el.dataset.d); state.calWeek = d ? state.calWeek + d : 0; render(); },
    convert: async (el) => { const r = await api("PUT", `/api/admin/emr/${state.chartClient}/patient`, { active: el.dataset.on === "1" }); toast(r.patient ? "Now an active patient." : "No longer marked as a patient."); render(); },
    rmNote: async (el) => { if (!confirm("Remove this note? The patient will no longer see it.")) return; await api("DELETE", `/api/admin/emr/${state.chartClient}/notes/${el.dataset.id}`); toast("Note removed."); await reChart(); },
    rmMove: async (el) => { if (!confirm("Remove this movement from the plan?")) return; await api("DELETE", `/api/admin/emr/${state.chartClient}/movements/${el.dataset.id}`); toast("Movement removed."); await reChart(); loadPool(); },
    mvPick: (el) => { const ex = EXERCISES.find((x) => x.id === el.dataset.id); if (!ex) return; const f = $("#mvForm"); f.videoId.value = ex.id; f.name.value = ex.name; $("#mvName").textContent = ex.name; $("#mvMeta").textContent = `${ex.region} · ${ex.cat} · level ${ex.level}`; $("#mvResults").innerHTML = ""; f.hidden = false; f.dose.focus(); },
    mvCancel: () => { const f = $("#mvForm"); f.reset(); f.hidden = true; },
    mvPool: async (el) => { await api("POST", `/api/admin/emr/${state.chartClient}/movements`, { videoId: el.dataset.id, name: el.dataset.name, dose: el.dataset.dose, cue: el.dataset.cue }); toast("Added to the plan."); await reChart(); loadPool(); },
    docs: async () => { $("#docsBox").innerHTML = showDocs(await get(`/clients/${state.chartClient}/intake`)); },
    docsModal: async (el) => { const d = await get(`/clients/${el.dataset.id}/intake`); modal(`<div class="card-head"><h2>New patient documents</h2><button class="btn sm" data-act="closeModal">Close</button></div>${showDocs(d)}`); },
    closeModal: () => { stopDictation(); closeModal(); },
    appt: async (el) => {
      const list = cache.appts || (cache.appts = await get("/appointments?all=1")), a = list.find((x) => x.id === el.dataset.id) || (await get("/appointments?all=1")).find((x) => x.id === el.dataset.id);
      if (!a) return toast("That appointment is no longer there.");
      modal(`<div class="card-head"><h2>${esc(a.name)}</h2><span class="row" style="gap:6px">${a.slotLost && a.payment === "paid" ? lostPill() : ""}${statusPill(a.status)}</span></div>
        <p class="muted">${fmtDate(a.date)} · ${fmtTime(a.time)} · ${esc(a.typeName || a.typeId)} · ${a.minutes || "—"} min<br>${esc(a.email)}${a.phone ? " · " + esc(a.phone) : ""}</p>
        ${a.notes ? `<p class="note-text"><b>From the client:</b> ${esc(a.notes)}</p>` : ""}
        <form class="stack" data-form="apptSave" data-id="${esc(a.id)}" style="margin-top:12px"><div class="field"><label for="apSt">Status</label><select id="apSt" name="status" class="input">${["booked", "completed", "no-show", "cancelled"].map((s) => `<option${s === a.status ? " selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="field"><label for="apNotes">Your notes</label><textarea id="apNotes" name="adminNotes" class="input" rows="3" maxlength="2000">${esc(a.adminNotes || "")}</textarea></div>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Close</button><button class="btn primary">Save</button></div></form>`);
    },
    cancelBooking: async (el) => { if (!confirm("Cancel this class booking?")) return; await api("DELETE", `/api/admin/bookings/${el.dataset.id}`); toast("Booking cancelled."); render(); },
    leadSave: async (el) => { const card = el.closest("[data-lead]"); await api("PATCH", `/api/admin/leads/${card.dataset.lead}`, { status: $("[data-change=leadStatus]", card).value, notes: $("[data-lead-notes]", card).value }); toast("Saved."); },
    leadDelete: async (el) => { const card = el.closest("[data-lead]"); if (!confirm("Delete this request?")) return; await api("DELETE", `/api/admin/leads/${card.dataset.lead}`); toast("Deleted."); render(); },
    unsubscribe: async (el) => { if (!confirm("Remove this subscriber?")) return; await api("DELETE", `/api/admin/subscribers/${encodeURIComponent(el.dataset.email)}`); toast("Removed."); render(); },
    review: async (el) => { await api("PATCH", `/api/admin/feedback/${el.dataset.id}`, { status: el.dataset.st }); toast("Updated."); render(); },
    report: async (el) => { await api("PATCH", `/api/admin/feedback-reports/${el.dataset.id}`, { status: el.dataset.st }); toast("Updated."); render(); },
    auditVerify: async () => { const r = await get("/audit/verify"); $("#auditResult").innerHTML = r.ok ? `<span class="pill ok">Intact</span><p class="muted" style="margin:8px 0 0">${plural(r.entries, "entry")} checked. Every one links to the one before and carries a valid signature.</p>` : `<span class="pill bad">Problem found</span><p style="margin:8px 0 0">${esc(r.error || "The ledger did not verify.")}</p>`; },
    // ---- Team & roles. Nothing here ever puts a password on the screen or into a message: a typed password is
    // read from its box, sent, and the box is emptied.
    staffAdd: async () => {
      const data = await load("/staff");
      const roles = Object.entries(data.roles || {}).filter(([k]) => k !== "owner");
      if (!roles.length) return toast("The server offers no role to give anyone.");
      const first = roles[0][0];
      modal(`<div class="card-head"><h2>Add a person</h2>${xBtn}</div>
        <form class="stack" data-form="staffNew" autocomplete="off">
          ${fld("sfName", "name", "Full name", "", { max: 80, attrs: 'required autocomplete="off"' })}
          ${fld("sfEmail", "email", "Email they sign in with", "", { type: "email", max: 120, attrs: 'required autocomplete="off"' })}
          ${rolePicker(roles, [first], false)}
          ${fld("sfPass", "password", "First password", "", { type: "password", max: 72, attrs: 'required minlength="10" autocomplete="new-password"' })}
          <p class="muted" style="margin:0;font-size:12.5px">At least 10 characters. Say it to them in person or by phone, not in an email; they are asked to change it the first time they sign in.</p>
          <h3 style="margin:4px 0 0">What they may do</h3>
          ${permEditor(data, first, (((data.roles || {})[first]) || {}).permissions || [], false)}
          <p role="alert" data-msg style="margin:0;color:var(--bad);min-height:1.2em"></p>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Add this person</button></div>
        </form>`);
      permRoleSync($('[data-form="staffNew"]'), data, false);
    },
    staffEdit: async (el) => {
      const data = await load("/staff"), s = (data.staff || []).find((x) => x.id === el.dataset.id);
      if (!s) return toast("That person is no longer there.");
      if (s.role === "owner") return toast("The owner's sign-in is set in the host's variables and is not changed from here.");
      const self = isMe(s), roles = Object.entries(data.roles || {}).filter(([k]) => k !== "owner");
      modal(`<div class="card-head"><h2>${esc(s.name || s.email)}</h2>${xBtn}</div>
        <form class="stack" data-form="staffSave" data-id="${esc(s.id)}" data-self="${self ? "1" : ""}" data-roles="${esc(rolesOfStaff(s).join(","))}" autocomplete="off">
          <p class="muted" style="margin:0;overflow-wrap:anywhere">${esc(s.email)}</p>
          ${fld("seName", "name", "Full name", s.name, { max: 80, attrs: "required" })}
          ${rolePicker(roles, rolesOfStaff(s), self)}
          ${self ? `<p class="muted" id="seSelf" style="margin:0;font-size:12.5px;display:flex;gap:6px;align-items:flex-start">${ui("lock", 14)}<span>This is you. Your own role, permissions and access are locked here, so nobody can lock themselves out or give themselves more. Ask the owner, or anyone else with the Team &amp; roles permission, to change them.</span></p>` : ""}
          <label class="perm" data-perm="active"><input type="checkbox" name="active" id="seActive"${s.active === false ? "" : " checked"}${self ? " disabled" : ""}>
            <span class="perm-t">Can sign in</span>
            <span class="perm-d muted">Turning this off is reversible and deletes nothing: it only stops them signing in until you turn it back on.</span></label>
          <h3 style="margin:4px 0 0">What they may do</h3>
          ${permEditor(data, rolesOfStaff(s), s.permissions || [], self)}
          <p role="alert" data-msg style="margin:0;color:var(--bad);min-height:1.2em"></p>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Save changes</button></div>
        </form>`);
      permRoleSync($('[data-form="staffSave"]'), data, false);
    },
    staffPw: (el) => modal(`<div class="card-head"><h2>Reset a password</h2>${xBtn}</div>
      <form class="stack" data-form="staffPass" data-id="${esc(el.dataset.id)}" data-name="${esc(el.dataset.name || "")}" autocomplete="off">
        <p style="margin:0">A new password for <b>${esc(el.dataset.name || "this person")}</b>. Say it to them in person or by phone, not in an email.</p>
        ${fld("spPass", "password", "New password", "", { type: "password", max: 72, attrs: 'required minlength="10" autocomplete="new-password"' })}
        <p class="muted" style="margin:0;font-size:12.5px">At least 10 characters. They are asked to change it the next time they sign in.</p>
        <p role="alert" data-msg style="margin:0;color:var(--bad);min-height:1.2em"></p>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Set this password</button></div></form>`),
    staffOff: async (el) => {
      const nm = el.dataset.name || "this person";
      if (!confirm(`Deactivate ${nm}? They will not be able to sign in. Nothing is deleted and you can let them sign in again here at any time.`)) return;
      await api("DELETE", `/api/admin/staff/${el.dataset.id}`);
      toast(`${nm} can no longer sign in. You can turn this back on whenever you like.`); await render();
    },
    staffOn: async (el) => {
      const nm = el.dataset.name || "this person";
      await api("PUT", `/api/admin/staff/${el.dataset.id}`, { active: true });
      toast(`${nm} can sign in again.`); await render();
    },
    mePw: () => modal(`<div class="card-head"><h2>Change your password</h2>${xBtn}</div><form class="stack" data-form="mePassword" autocomplete="off">${pwFields()}
      <p role="alert" data-msg style="margin:0;color:var(--bad);min-height:1.2em"></p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Change it</button></div></form>`),
    copyBook: async () => { const i = $("#bookUrl"); try { await navigator.clipboard.writeText(i.value); toast("Link copied."); } catch { i.select(); toast("Press Ctrl+C to copy."); } }
  };
  const FORMS = {
    teleChat: async (f) => { const body = f.body.value.trim(); if (!body) return; if (!teleSend({ t: "chat", body })) { toast("Chat isn't connected yet."); return; } tele.chat.push({ me: true, body, at: Date.now() }); f.body.value = ""; teleMount(); }, // in a live room this goes to everyone in it
    broadcast: async (f) => {
      const to = f.to.value, body = f.body.value.trim(), ids = [...f.querySelectorAll("[name=who]:checked")].map((x) => x.value), msg = $("#bcMsg");
      if (!body) return;
      if (to === "selected" && !ids.length) { msg.textContent = "Pick at least one person."; return; }
      if (!confirm(to === "selected" ? `Send this to ${ids.length} ${ids.length === 1 ? "person" : "people"}?` : to === "members" ? "Send this to every paying member?" : "Send this to everyone?")) return;
      const btn = f.querySelector("button.primary"); btn.disabled = true; msg.textContent = "Sending…";
      try {
        const r = await api("POST", "/api/admin/messages/broadcast", { to, body, email: f.email.checked, ...(to === "selected" ? { clientIds: ids } : {}) });
        stopDictation(); closeModal(); toast(`Broadcast sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}${r.emailing ? `. Emailing ${r.emailing} a notice.` : "."}`);
        if (route() === "messages") await render();
      } catch (err) { msg.textContent = err.message; btn.disabled = false; }
    },
    noteAddendum: async (f) => { const text = f.text.value.trim(); if (!text) return; await api("POST", `/api/admin/notes/${f.dataset.id}/addendum`, { text }); toast("Addendum added."); await ACT.noteOpen({ dataset: { id: f.dataset.id } }); if (route() === "notes") render(); },
    roomLink: async (f) => {
      const url = f.url.value.trim();
      if (url && !/^https:\/\//i.test(url)) { toast("The room link must start with https://"); return; }
      await api("PUT", "/api/admin/settings", { booking: { telehealthUrl: url } });
      toast(url ? "Room link saved. New video bookings get this link." : "Room link removed."); await render();
    },
    // AI scribe: the draft goes into the Note box and nowhere else; the clinician edits it and adds it himself
    scribe: async (f) => {
      const text = f.text.value.trim(), box = $("#nBody"), who = $("#nClient"), btn = f.querySelector("button"), msg = $("#sMsg");
      if (text.length < 20) { msg.textContent = "Write a few sentences about the visit first."; return; }
      if (box.value.trim() && !confirm("Replace what is in the Note box with the draft?")) return;
      btn.disabled = true; msg.textContent = "Drafting…";
      try {
        const r = await api("POST", "/api/admin/scribe/draft", { clientId: who && who.value ? who.value : undefined, text });
        box.value = r.draft; box.focus(); box.setSelectionRange(0, 0); box.scrollTop = 0;
        msg.textContent = `Draft ready. Read it and edit before adding.${r.removed ? ` ${r.removed} name or contact ${r.removed === 1 ? "detail was" : "details were"} removed before sending.` : ""}`;
      } catch (err) { msg.textContent = err.message; }
      finally { btn.disabled = false; }
    },
    note: async (f) => { const text = f.text.value.trim(); if (!text) return; await api("POST", `/api/admin/emr/${state.chartClient}/notes`, { text }); toast("Note added. The patient can see it now."); await reChart(); },
    noteFor: async (f) => { const text = f.text.value.trim(); if (!f.id.value || !text) return; await api("POST", `/api/admin/emr/${f.id.value}/notes`, { text }); f.text.value = ""; toast("Note added. The patient can see it now."); },
    movement: async (f) => { await api("POST", `/api/admin/emr/${state.chartClient}/movements`, { videoId: f.videoId.value, name: f.name.value, dose: f.dose.value.trim(), cue: f.cue.value.trim() }); toast("Added to the plan."); await reChart(); loadPool(); },
    consult: async (f) => { formMsg(f, ""); let a; try { a = await api("POST", `/api/admin/clients/${state.chartClient}/consult`, { date: f.date.value, time: f.time.value, minutes: Number(f.minutes.value), title: f.title.value.trim(), meetingLink: f.meetingLink.value.trim(), message: "" }); } catch (err) { formMsg(f, err.message); return; } // the server's own words stay next to the form (a time someone is paying for, a clash)
      closeModal(); toast(`Scheduled ${fmtDate(a.date)} at ${fmtTime(a.time)}.`); render(); },
    // The message shows at once as "Sending…" and the box clears, so typing the next one never waits on the server
    message: async (f) => {
      const body = f.body.value.trim(); if (!body) return;
      const l = $("#msgList"); f.body.value = "";
      if (l) { l.insertAdjacentHTML("beforeend", `<div class="bubble me" data-pending style="opacity:.6">${esc(body)}<div class="muted" style="font-size:11px;margin-top:2px">Sending…</div></div>`); l.scrollTop = l.scrollHeight; }
      try { await api("POST", `/api/admin/messages/${state.thread}`, { body }); }
      catch (err) { const p = $("[data-pending]"); if (p) p.remove(); const box = $(".composer input[name=body]"); if (box && !box.value) box.value = body; throw err; }
      await refreshMessages(true);
    },
    staffNew: async (f) => {
      const name = f.elements.name.value.trim(), email = f.elements.email.value.trim();
      if (!name || !email) return formMsg(f, "A name and an email are both needed.");
      if (f.elements.password.value.length < 10) return formMsg(f, "The first password needs at least 10 characters.");
      formMsg(f, "");
      try {
        const roles = [...f.querySelectorAll("input[name=role]:checked")].map((x) => x.value);
        if (!roles.length) { formMsg(f, "Tick at least one role."); return; }
        await api("POST", "/api/admin/staff", { name, email, roles, permissions: picks(f), password: f.elements.password.value });
        f.elements.password.value = ""; closeModal(); toast(`${name} can sign in now.`); await render();
      } catch (err) { f.elements.password.value = ""; formMsg(f, errText(err)); toast(errText(err)); }
    },
    staffSave: async (f) => {
      const self = f.dataset.self === "1", body = { name: f.elements.name.value.trim() };
      if (!body.name) return formMsg(f, "A name is needed.");
      // Your own role, permissions and access are never sent: the server refuses them, and the form has them locked.
      if (!self) {
        body.roles = [...f.querySelectorAll("input[name=role]:checked")].map((x) => x.value);
        if (!body.roles.length) { formMsg(f, "Tick at least one role."); return; }
        body.permissions = picks(f); body.active = !!(f.elements.active && f.elements.active.checked);
      }
      formMsg(f, "");
      try { await api("PUT", `/api/admin/staff/${f.dataset.id}`, body); closeModal(); toast("Saved."); await render(); }
      catch (err) { formMsg(f, errText(err)); toast(errText(err)); }
    },
    staffPass: async (f) => {
      const pw = f.elements.password.value;
      if (pw.length < 10) return formMsg(f, "A password needs at least 10 characters.");
      formMsg(f, "");
      try { await api("POST", `/api/admin/staff/${f.dataset.id}/password`, { password: pw }); f.elements.password.value = ""; closeModal(); toast(`New password set for ${f.dataset.name || "them"}.`); }
      catch (err) { f.elements.password.value = ""; formMsg(f, errText(err)); toast(errText(err)); }
    },
    mePassword: async (f) => {
      const current = f.elements.current.value, pw = f.elements.password.value, again = f.elements.confirm.value;
      if (pw.length < 10) return formMsg(f, "Your new password needs at least 10 characters.");
      if (pw !== again) return formMsg(f, "The two new passwords are not the same.");
      formMsg(f, "");
      let fresh; try { fresh = await api("POST", "/api/admin/me/password", { current, password: pw }); }
      catch (err) { f.elements.current.value = f.elements.password.value = f.elements.confirm.value = ""; formMsg(f, errText(err)); return; }
      if (fresh && fresh.token) carryToken(fresh.token, fresh.expiresAt);
      f.elements.current.value = f.elements.password.value = f.elements.confirm.value = "";
      try { cache.me = await get("/me"); } catch {}
      mustChange = !!(cache.me && cache.me.mustChangePassword);
      if (!mustChange) { $("#qa").hidden = !qaMine().length; $("#globalSearch").disabled = !can("clients"); closeModal(); toast("Password changed."); await render(); }
    },
    apptSave: async (f) => { await api("PATCH", `/api/admin/appointments/${f.dataset.id}`, { status: f.status.value, adminNotes: f.adminNotes.value }); cache.appts = null; closeModal(); toast("Appointment updated."); render(); }
  };
  const typeTurn = {};
  // Refund: only for money that came in by card (an invoice paid online, or a card payment), and only what is left of it
  const refundBtn = (x, kind) => { const left = (x.amount || 0) - (x.refunded || 0), byCard = kind === "charge" ? /^(ch|py)_/.test(x.id || "") && (x.status === "paid" || x.status === "part refunded") : x.online && x.status === "paid";
    return byCard && left > 0 ? `<button type="button" class="btn sm" data-act="refundAsk" data-kind="${kind}" data-id="${esc(x.id)}" data-left="${left}" data-what="${esc(x.number || x.description || "this payment")}">Refund</button>` : ""; };
  // What a member last opened MD Fit with, and whether they can be seen and heard on it
  const devLine = (d, always) => d ? `<div class="muted" style="font-size:12px;display:flex;gap:5px;align-items:flex-start">${ui("phone", 13)}<span><b style="font-weight:600;color:${d.speak === false ? "var(--warn)" : "inherit"}">${esc(d.label)}</b>: ${esc(d.note)}</span></div>` : always ? `<div class="muted" style="font-size:12px">Has not opened MD Fit since devices started being recorded</div>` : "";
  // The people picked for a new invoice, shown as removable chips
  function igDraw() { const box = $("#igPeople"); if (box) box.innerHTML = state.igPeople.map((p) => `<span class="pill accent" style="display:inline-flex;align-items:center;gap:4px">${esc(p.name)}<button type="button" class="btn sm ghost" style="padding:0 2px;min-height:0" data-act="igDrop" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">${ui("x", 12)}</button></span>`).join(""); const n = $("#igCount"); if (n) n.textContent = state.igPeople.length ? `${plural(state.igPeople.length, "client")} picked` : ""; }
  // ---- Client chart: what the buttons do
  const cid = () => state.chartClient;
  const firstOf = () => String(cache.chart.d.name).split(" ")[0];
  const putPlan = (patch) => { const p = cache.chart.c.plan || {}; return api("PUT", `/api/admin/clients/${cid()}/plan`, { guides: p.guides || [], exercises: p.exercises || [], notes: p.notes || "", ...patch }); };
  const setPrograms = (ids) => api("PUT", `/api/admin/clients/${cid()}/programs`, { programs: ids.map((id) => ({ id })) });
  // After a change: fresh data, the same tab, and the alerts and tags in the header
  const chartRedo = async () => { await reChart(); const p = $("#chartPills"); if (p) p.innerHTML = chartPills(); chartAfter(); };
  async function setMembership(id, tier, until, name) {
    const cur = (cache.clients || await clients()).find((x) => x.id === id), was = cur && cur.membership;
    if (was && was.stripeSubscriptionId && !confirm(`${name} pays for this membership by card each month. Changing it here changes what they can use, not what their card is charged. Continue?`)) return false;
    await api("PUT", `/api/admin/clients/${id}/membership`, tier ? { tier, until: until || "" } : { tier: "" });
    cache.clients = null; return tier ? `${name}: ${tierName(tier)}.` : `${name}: membership ended.`;
  }
  // Practice details for superbills and estimates are typed once and remembered on this device (they are not patient data)
  const PRACTICE_KEY = "mdfit_ws_practice";
  // Starts from what is saved in Settings (practice name, address, phone, the provider's name and title). Nothing is
  // assumed: a field with no saved value starts empty.
  const practice = () => {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(PRACTICE_KEY) || "{}") || {}; } catch {}
    const st = cache.settings || {}, b = st.business || {}, co = st.coach || {};
    const base = { name: b.name || "", address: b.address || "", phone: b.phone || "", provider: [co.name, co.title].filter(Boolean).join(", ") };
    return { ...base, ...Object.fromEntries(Object.entries(saved).filter(([, v]) => v)) };
  };
  const practiceFields = () => { const p = practice(); const f = (n, l, ph = "") => `<div class="field"><label for="pf_${n}">${l}</label><input id="pf_${n}" name="p_${n}" class="input" maxlength="160" value="${esc(p[n] || "")}" placeholder="${ph}"></div>`;
    return `<div class="grid g2">${f("name", "Practice name")}${f("provider", "Provider name and credentials")}${f("address", "Practice address")}${f("phone", "Practice phone")}${f("npi", "NPI")}${f("ein", "Tax ID (EIN)")}</div>`; };
  const practiceFrom = (f) => { const p = {}; for (const n of ["name", "provider", "address", "phone", "npi", "ein"]) p[n] = f["p_" + n].value.trim(); try { localStorage.setItem(PRACTICE_KEY, JSON.stringify(p)); } catch {} return p; };
  const lineRows = (n, cols) => Array.from({ length: n }, (_, i) => `<div class="doc-line">${cols.map(([k, ph, type, extra = ""]) => `<input name="${k}${i}" class="input" placeholder="${ph}" aria-label="${ph}, line ${i + 1}" ${type ? `type="${type}"` : ""} ${extra}>`).join("")}</div>`).join("");
  const GFE_NOTICE = [
    "This Good Faith Estimate shows the costs of items and services that are reasonably expected for your health care needs for an item or service. The estimate is based on information known at the time the estimate was created.",
    "The Good Faith Estimate does not include any unknown or unexpected costs that may arise during treatment. You could be charged more if complications or special circumstances occur. If this happens, federal law allows you to dispute (appeal) the bill.",
    "If you are billed for $400 or more above this Good Faith Estimate, you have the right to dispute the bill. You may contact the health care provider or facility listed to let them know the billed charges are higher than the Good Faith Estimate. You can ask them to update the bill to match the Good Faith Estimate, ask to negotiate the bill, or ask if there is financial assistance available.",
    "You may also start a dispute resolution process with the U.S. Department of Health and Human Services (HHS). If you choose to use the dispute resolution process, you must start the dispute process within 120 calendar days (about 4 months) of the date on the original bill. There is a fee to use the dispute process. If the agency reviewing your dispute agrees with you, you will have to pay the price on this Good Faith Estimate. If the agency disagrees with you and agrees with the health care provider or facility, you will have to pay the higher amount.",
    "To learn more and get a form to start the process, go to www.cms.gov/nosurprises or call 1-800-985-3059. This Good Faith Estimate is not a contract and does not require you to obtain the items or services from the provider listed. Keep a copy of this Good Faith Estimate in a safe place. You may need it if you are billed a higher amount."];
  // A superbill or estimate as a printable page. Everything is escaped: these are typed by staff.
  function docHtml(kind, o) {
    const P = o.practice || {}, gfe = kind === "gfe", lines = o.lines || [], total = lines.reduce((n, l) => n + (Number(l.fee) || 0) * (gfe ? Number(l.qty) || 1 : 1), 0), m = (n) => "$" + (Number(n) || 0).toFixed(2);
    return `<div class="doc"><div class="doc-top"><div><b style="font-size:18px">${esc(P.name || "MD Fit")}</b><div>${esc(P.address || "")}</div><div>${esc(P.phone || "")}</div><div>${esc(P.provider || "")}</div><div>${P.npi ? "NPI " + esc(P.npi) : ""}${P.npi && P.ein ? " · " : ""}${P.ein ? "Tax ID " + esc(P.ein) : ""}</div></div>
      <div style="text-align:right"><b style="font-size:18px">${gfe ? "Good Faith Estimate" : "Superbill"}</b><div>Issued ${esc(o.issued || "")}</div></div></div>
      <table class="doc-t"><tbody><tr><th>Patient</th><td>${esc(o.patient || "")}</td><th>Date of birth</th><td>${esc(o.dob || "")}</td></tr>${o.address ? `<tr><th>Address</th><td colspan="3">${esc(o.address)}</td></tr>` : ""}
      ${gfe ? `<tr><th>Primary service</th><td colspan="3">${esc(o.reason || "")}</td></tr><tr><th>Expected</th><td colspan="3">${esc(o.period || "")}</td></tr>` : ""}<tr><th>Diagnosis codes (ICD-10)</th><td colspan="3">${esc((o.dx || []).join(", ") || (gfe ? "Not yet determined" : ""))}</td></tr></tbody></table>
      <table class="doc-t"><thead><tr>${gfe ? "<th>Service</th><th>Code</th><th>Quantity</th><th>Each</th><th>Expected charge</th>" : "<th>Date of service</th><th>CPT</th><th>Description</th><th>Fee</th>"}</tr></thead><tbody>
      ${lines.map((l) => gfe ? `<tr><td>${esc(l.desc)}</td><td>${esc(l.code || "")}</td><td>${esc(l.qty || 1)}</td><td>${m(l.fee)}</td><td>${m((Number(l.fee) || 0) * (Number(l.qty) || 1))}</td></tr>` : `<tr><td>${esc(l.date)}</td><td>${esc(l.code || "")}</td><td>${esc(l.desc)}</td><td>${m(l.fee)}</td></tr>`).join("")}
      <tr><th colspan="${gfe ? 4 : 3}" style="text-align:right">${gfe ? "Total estimated charges" : "Total charges"}</th><th>${m(total)}</th></tr>${gfe ? "" : `<tr><th colspan="3" style="text-align:right">Paid by patient</th><th>${m(o.paid)}</th></tr><tr><th colspan="3" style="text-align:right">Balance</th><th>${m(total - (Number(o.paid) || 0))}</th></tr>`}</tbody></table>
      ${gfe ? `<div class="doc-fine"><b>Disclaimer</b>${GFE_NOTICE.map((p) => `<p>${p}</p>`).join("")}</div>` : `<p class="doc-fine">This statement is for you to submit to your insurance plan for possible out-of-network reimbursement. MD Fit is a self-pay practice and does not bill insurance. Payment was due at the time of service.</p><p style="margin-top:28px">Provider signature: ______________________________ &nbsp; Date: ______________</p>`}</div>`;
  }
  function showDoc(kind, o, title) { modal(`<div class="card-head"><h2>${esc(title)}</h2><div class="row"><button type="button" class="btn sm primary" data-act="docPrint">Print or save as PDF</button><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div></div><div id="docShown">${docHtml(kind, o)}</div>`); $("#modal").classList.add("wide"); }
  const docForm = (kind) => {
    const { d } = cache.chart, gfe = kind === "gfe", today = isoDay(new Date());
    modal(`<div class="card-head"><h2>${gfe ? "Good Faith Estimate" : "Superbill"} for ${esc(firstOf())}</h2><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div>
      <form class="stack" data-form="${gfe ? "gfe" : "superbill"}">${practiceFields()}
      <div class="grid g2"><div class="field"><label for="dfName">Patient name</label><input id="dfName" name="patient" class="input" maxlength="120" required value="${esc(d.name)}"></div><div class="field"><label for="dfDob">Date of birth</label><input id="dfDob" name="dob" type="date" class="input" max="${today}"></div></div>
      ${gfe ? `<div class="grid g2"><div class="field"><label for="dfReason">Primary service or reason for care</label><input id="dfReason" name="reason" class="input" maxlength="200" required placeholder="Physical rehabilitation for knee pain"></div><div class="field"><label for="dfPeriod">Expected when</label><input id="dfPeriod" name="period" class="input" maxlength="120" placeholder="8 visits over 6 weeks, starting Nov 18"></div></div>` : `<div class="field"><label for="dfAddr">Patient address (optional)</label><input id="dfAddr" name="address" class="input" maxlength="200"></div>`}
      <div class="field"><label for="dfDx">Diagnosis codes, ICD-10 (comma separated${gfe ? ", if known" : ""})</label><input id="dfDx" name="dx" class="input" maxlength="200" placeholder="M25.561, M62.81"></div>
      <div><label class="muted" style="font-size:12px">${gfe ? "Services expected: name, code, how many, price each" : "Services: date, CPT code, description, fee"}</label>
        ${gfe ? lineRows(4, [["desc", "Service", "", 'list="svcNames" data-svc="1"'], ["code", "Code"], ["qty", "Qty", "number", 'min="1" max="200" step="1"'], ["fee", "Each ($)", "number", 'min="0" step="0.01"']]) : lineRows(4, [["date", "Date", "date", `max="${today}"`], ["code", "CPT"], ["desc", "Description"], ["fee", "Fee ($)", "number", 'min="0" step="0.01"']])}
        <datalist id="svcNames">${((cache.settings && cache.settings.services) || []).map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist></div>
      ${gfe ? "" : `<div class="field"><label for="dfPaid">Paid by the patient ($)</label><input id="dfPaid" name="paid" class="input" type="number" min="0" step="0.01" value="0"></div>`}
      <p class="muted" style="margin:0;font-size:12.5px">${gfe ? "Uses the notice wording from the federal model form. Have your attorney or compliance advisor confirm it fits your practice before relying on it." : "Check the codes before you hand this over: nothing here is filled in for you."} A copy is kept in this chart under Files.</p>
      <div class="row"><button class="btn primary">Create ${gfe ? "estimate" : "superbill"}</button></div></form>`);
    $("#modal").classList.add("wide");
  };
  async function docSubmit(kind, f) {
    const gfe = kind === "gfe", lines = [];
    for (let i = 0; i < 4; i++) { const desc = f["desc" + i].value.trim(), fee = Number(f["fee" + i].value); if (!desc && !f["code" + i].value.trim()) continue; lines.push(gfe ? { desc, code: f["code" + i].value.trim(), qty: Math.max(1, Number(f["qty" + i].value) || 1), fee: fee || 0 } : { date: f["date" + i].value, code: f["code" + i].value.trim(), desc, fee: fee || 0 }); }
    if (!lines.length) { toast("Add at least one service line."); return; }
    const o = { practice: practiceFrom(f), patient: f.patient.value.trim(), dob: f.dob.value, dx: f.dx.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12), lines, issued: isoDay(new Date()),
      ...(gfe ? { reason: f.reason.value.trim(), period: f.period.value.trim() } : { address: f.address.value.trim(), paid: Number(f.paid.value) || 0 }) };
    const title = `${gfe ? "Good Faith Estimate" : "Superbill"} ${o.issued}`;
    await api("POST", `/api/admin/emr/${cid()}/docs`, { kind, title, body: JSON.stringify(o) });
    showDoc(kind, o, title); toast("Created. A copy is in this chart under Files."); reChart();
  }
  Object.assign(ACT, {
    // The AI scribe's model: the list comes from the connected service, for the key the server holds
    scribeModels: async () => {
      const r = await get("/scribe/models");
      modal(`<div class="card-head"><h2>AI scribe model</h2>${xBtn}</div><p class="muted" style="margin:0 0 12px">These are the models ${esc(r.host || "the AI service")} offers your key. Pick the one drafts should use.</p>
        <form class="stack" data-form="scribeModel">${(r.models || []).length > 12 ? `<div class="field"><label for="smFind">Find a model (${r.models.length} offered)</label><input id="smFind" class="input" type="search" placeholder="Type part of a name, e.g. kimi or free" autocomplete="off"></div>` : ""}
        <div class="field"><label for="smPick">Model</label><select id="smPick" name="model" class="input"${(r.models || []).length > 12 ? ' size="8" style="height:auto"' : ""}>${(r.models || []).map((m) => `<option${m === r.current ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
        ${(r.models || []).includes(r.current) ? "" : `<p class="muted" style="margin:0;font-size:12.5px">The one set now, ${esc(r.current || "none")}, is not on this list, which is why drafts fail.</p>`}
        <div class="row"><button class="btn primary"${(r.models || []).length ? "" : " disabled"}>Use this model</button></div></form>`);
    },
    stop: () => {},
    rowsMore: () => rowsMoreNow(),
    formsShow: (el) => { state.formsShow = el.dataset.show; for (const b of el.parentElement.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === el)); formsFilter(); },
    // Refund: asks how much and for the owner's password; the server checks the password and sends the money back
    refundAsk: (el) => { const left = Number(el.dataset.left) || 0, extra = el.dataset.kind === "extra"; // a second payment goes back whole
      modal(`<div class="card-head"><h2>Refund ${esc(el.dataset.what)}</h2>${xBtn}</div>
        <form class="stack" data-form="refund" data-kind="${esc(el.dataset.kind)}" data-id="${esc(el.dataset.id)}" data-session="${esc(el.dataset.session || "")}" data-left="${left}" autocomplete="off">
          <p class="muted" style="margin:0">The money goes back to the card it was paid with, through Stripe. This cannot be undone. ${extra ? `This invoice was paid twice: the second payment, ${usd(left)}, goes back and the invoice stays paid.` : `Up to ${usd(left)} can be refunded.`}</p>
          ${extra ? "" : fld("rfAmt", "amount", "Amount to refund ($)", (left / 100).toFixed(2), { type: "number", attrs: `required min="0.01" max="${(left / 100).toFixed(2)}" step="0.01"` })}
          <div class="field"><label for="rfPass">Owner password</label><input id="rfPass" name="password" class="input" type="password" required autocomplete="current-password"><p class="muted" style="margin:4px 0 0;font-size:12.5px">Asked for every refund, even though you are signed in.</p></div>
          <div class="row"><button class="btn primary">Refund to the card</button><span class="muted" id="rfMsg" role="status" style="font-size:12.5px"></span></div></form>`); },
    // ---- Solomon (Insights): the range, chart or table, and the AI switch
    guideDays: (el) => { state.guideDays = Number(el.dataset.d) || 30; return render(); },
    guideView: (el) => { state.guideView = el.dataset.v === "table" ? "table" : "chart"; return render(); },
    // Off is one click. On asks first, in the page: members type health details, so the service must have signed.
    guideAi: async () => {
      const S = (cache.guide && cache.guide.settings) || {}; state.guideAiErr = "";
      if (S.ai) {
        try { await api("PUT", "/api/admin/guide/settings", { ai: false }); } catch (err) { state.guideAiErr = err.message; await render(); return; }
        await render(); toast("AI answers are off. Messages are understood on the member's own device again."); return;
      }
      modal(`<div class="card-head"><h2>Turn on AI answers</h2>${xBtn}</div>
        <form class="stack" data-form="guideAiOn">
          <p style="margin:0">Members often type health details. Turn this on only if ${esc(S.aiHost || "the AI service")} has signed a business associate agreement with MD Fit and does not keep or train on what it is sent.</p>
          <label class="row" for="gaSigned" style="gap:8px;flex-wrap:nowrap"><input type="checkbox" id="gaSigned" name="signed"><span>They have signed one</span></label>
          <div class="row"><button class="btn primary" id="gaGo" disabled>Turn on AI answers</button><button type="button" class="btn" data-act="closeModal">Cancel</button></div></form>`);
    },
    // ---- Invoice generator (Payments): draft once, pick the people, write the email, send
    igAll: () => { state.genAll = true; render(); },
    igNew: () => { state.igPeople = []; const g = cache.gen || {};
      modal(`<div class="card-head"><h2>New invoice</h2>${xBtn}</div>
        <form class="stack" data-form="igCreate">
          <div class="grid g-side" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">${fld("igDesc", "description", "What it is for", "", { max: 200, attrs: 'required placeholder="Workshop seat, custom package, supplies"' })}${fld("igAmt", "amount", "Amount each ($)", "", { type: "number", attrs: 'required min="0.5" max="20000" step="0.01"' })}</div>
          <p class="muted" style="margin:-6px 0 0;font-size:12.5px">What it is for stays in your records and on the client's chart. It is not put in the email and is not sent to Stripe: say what you want the person to read in the message below.</p>
          <div class="field" style="margin:0"><label for="igFind">Send to: clients</label><div class="search" style="position:relative"><input id="igFind" class="input" autocomplete="off" placeholder="Search by name or email, then add"></div><div id="igRes"></div><div id="igPeople" class="row" style="gap:6px;margin-top:6px"></div></div>
          ${fld("igTyped", "typed", "Send to: someone without an account (Name, Email, one per line)", "", { area: true, rows: 2, max: 4000, attrs: 'placeholder="Jordan Lee, jordan@example.com"' })}
          ${fld("igSubject", "subject", "Email subject", "", { max: 120, attrs: 'placeholder="MD Fit invoice (its number is added if you leave this empty)"' })}
          ${fld("igMsg", "message", "Message", "", { area: true, rows: 4, max: 600, attrs: 'placeholder="A few words of your own. The invoice number, the amount and the payment link are added underneath."' })}
          <div class="row"><button class="btn primary" name="how" value="send"${g.payments && g.email ? "" : " disabled"}>Email the invoice</button><button class="btn" name="how" value="save">Create without sending</button><span class="muted" id="igCount" style="font-size:12.5px"></span></div>
          ${g.payments && g.email ? "" : `<p class="muted" style="margin:0;font-size:12.5px">${g.payments ? "Email is not switched on for the server" : "Card payments are not switched on"}, so the invoice can be created here but not emailed with a payment link.</p>`}
        </form>`); $("#modal").classList.add("wide"); },
    igAdd: (el) => { const c = (cache.clients || []).find((x) => x.id === el.dataset.id); if (!c || state.igPeople.some((p) => p.id === c.id)) return; state.igPeople.push({ id: c.id, name: c.name, email: c.email }); igDraw(); const q = $("#igFind"); if (q) { q.value = ""; q.focus(); } $("#igRes").innerHTML = ""; },
    igDrop: (el) => { state.igPeople = state.igPeople.filter((p) => p.id !== el.dataset.id); igDraw(); },
    igSend: (el) => { const x = ((cache.gen || {}).invoices || []).find((y) => y.id === el.dataset.id); if (!x) return;
      modal(`<div class="card-head"><h2>Send invoice ${esc(x.number)}</h2>${xBtn}</div>
        <form class="stack" data-form="igSend" data-id="${esc(x.id)}"><p class="muted" style="margin:0">To ${esc(x.name)} · ${esc(x.email)} · ${usd(x.amount)}</p>
          ${fld("igsSubject", "subject", "Email subject", "", { max: 120, attrs: `placeholder="MD Fit invoice ${esc(x.number)}"` })}
          ${fld("igsMsg", "message", "Message", x.message || "", { area: true, rows: 4, max: 600 })}
          <p class="muted" style="margin:0;font-size:12.5px">The invoice number, the amount and the payment link are added underneath your message. The link keeps working until the invoice is paid or voided.</p>
          <div class="row"><button class="btn primary">Send invoice</button></div></form>`); },
    igCopy: async (el) => { const x = ((cache.gen || {}).invoices || []).find((y) => y.id === el.dataset.id); if (!x) return; try { await navigator.clipboard.writeText(x.url); toast("Payment link copied. It works until the invoice is paid or voided."); } catch { prompt("Copy this payment link:", x.url); } },
    igPaid: (el) => { const x = ((cache.gen || {}).invoices || []).find((y) => y.id === el.dataset.id); if (!x) return;
      modal(`<div class="card-head"><h2>Mark ${esc(x.number)} paid</h2>${xBtn}</div><form class="stack" data-form="igPaid" data-id="${esc(x.id)}"><p class="muted" style="margin:0">${esc(x.name)} · ${usd(x.amount)}</p>${sel("igpHow", "method", "How it was paid", [["cash", "Cash"], ["check", "Check"], ["card", "Card, taken another way"], ["other", "Other"]], "cash")}<div class="row"><button class="btn primary">Mark paid</button></div></form>`); },
    igVoid: async (el) => { const x = ((cache.gen || {}).invoices || []).find((y) => y.id === el.dataset.id); if (!x || !confirm(`Void invoice ${x.number} for ${x.name}? Its payment link stops working.`)) return; await api("POST", `/api/admin/invoices/${x.id}/status`, { status: "void" }); await render(); toast(`Invoice ${x.number} voided.`); },
    // Refresh: no reload. Throw away what is in memory, check the live connection really answers (and bring it back if
    // it does not), ask it for the waiting room again, and draw the screen from the server.
    refresh: async () => {
      const b = $("#refreshBtn"); if (b) b.classList.add("spin");
      forget();
      let ms = null, live = !!window.MDFitRT;
      if (live) { if (!MDFitRT.connected()) await MDFitRT.connect({ namespace: "/admin", token }); else ms = await MDFitRT.ping(3000); if (ms === null && MDFitRT.connected()) ms = await MDFitRT.revive(); MDFitRT.emit("tele_list"); }
      await render(); liveDot();
      toast(!live ? "Up to date." : ms !== null ? `Up to date. Live connection answered in ${ms} ms.` : MDFitRT.connected() ? "Up to date. Live connection is back." : "Up to date. The live connection is reconnecting…");
      setTimeout(() => { if (b) b.classList.remove("spin"); }, 600);
    },
    // System economics: open a month's detail (the same month again closes it), or go to the list a tile is made of
    ecoOpen: async (el) => {
      if (el.dataset.to === "costs") { const c = $("#ecoCostsCard"); if (c) { c.scrollIntoView({ block: "start", behavior: "smooth" }); const i = c.querySelector("input.input"); if (i) i.focus({ preventScroll: true }); } return; }
      state.ecoOpen = state.ecoOpen === el.dataset.m ? "" : el.dataset.m;
      document.querySelectorAll('[data-act="ecoOpen"][data-m]').forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.m === state.ecoOpen)));
      await ecoDetail();
      const card = $("#ecoMonthCard"); if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    // System economics: put a vendor this system uses into the empty cost line, ready for its amount
    ecoUse: (el) => { const f = $('[data-form="ecoCosts"]'); if (!f) return; const rows = [...f.querySelectorAll(".set-row")], row = rows[rows.length - 1], name = row && row.querySelector('[name^="name"]'); if (!name) return; if (name.value.trim()) { toast("Save the line you are adding first."); return; } name.value = el.dataset.name; el.remove(); row.querySelector('[name^="monthly"]').focus(); },
    // Calendar: add an event straight onto the connected Google Calendar
    calAdd: () => { const today = isoDay(new Date());
      modal(`<div class="card-head"><h2>Add to your calendar</h2>${xBtn}</div>
        <form class="stack" data-form="calEvent">${fld("ceTitle", "title", "What is it?", "", { max: 120, attrs: 'required placeholder="Follow-up, meeting, time off"' })}
        <div class="grid g3">${fld("ceDate", "date", "Date", today, { type: "date", attrs: "required" })}${fld("ceTime", "time", "Starts", "09:00", { type: "time", attrs: 'required step="300"' })}${sel("ceLen", "minutes", "Length", [[15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"], [480, "8 hours"]], 60)}</div>
        ${fld("ceNote", "note", "Note (optional)", "", { max: 500 })}
        <p class="muted" style="margin:0;font-size:12.5px">This goes on your Google Calendar and blocks that time for online booking. To book a client's visit with a reminder and a video link, use Book on their chart.</p>
        <div class="row"><button class="btn primary">Add to calendar</button></div></form>`); },
    // Clients list: one click switches a person between in-patient and out-patient
    typeSet: async (el) => {
      if (el.getAttribute("aria-pressed") === "true") return;
      const type = el.dataset.type, id = el.dataset.id, pair = [...el.parentElement.querySelectorAll("[data-act=typeSet]")], before = pair.map((b) => b.getAttribute("aria-pressed"));
      pair.forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      // one person's changes go to the server in the order they were pressed
      const turn = typeTurn[id] = (typeTurn[id] || Promise.resolve()).catch(() => {}).then(() => api("PUT", `/api/admin/clients/${id}/type`, { type }));
      try { await turn; const c = (cache.clients || []).find((x) => x.id === id); if (c) c.clientType = type; toast(`${String(el.dataset.name).split(" ")[0]} is now ${type === "inpatient" ? "subscription exempt: visits are not charged" : "standard"}.`); }
      catch (err) { if (typeTurn[id] === turn) pair.forEach((b, i) => b.setAttribute("aria-pressed", before[i])); throw err; }
    },
    // Forms & intake: ask someone to finish and sign their new patient documents (app notice, push and email)
    intakeRemind: async (el) => {
      el.disabled = true;
      try { const r = await api("POST", `/api/admin/clients/${el.dataset.id}/intake/remind`, {}); el.textContent = "Notified"; el.classList.remove("primary"); toast(`${String(el.dataset.name).split(" ")[0]} was notified in the app${r.emailed ? " and by email" : ""} to finish their documents (${r.done} of ${r.total} done).`); }
      catch (err) { el.disabled = false; throw err; }
    },
    // Export: the people ticked on the Clients list, or everyone when nobody is ticked
    // ---- the trash: Delete sets a client aside for 30 days; Restore puts them back as they were
    clientTrash: async (el) => {
      const name = el.dataset.name || "this client";
      if (!confirm(`Move ${name} to the trash?\n\nThey disappear from every list and can't sign in. You have 30 days to restore them from Clients → View trash, exactly as they were.\n\nAfter 30 days the trash empties: a client with a chart is kept as a "Closed account" with the chart, anyone else is removed. A membership keeps billing until then, so cancel it first if it should stop now.`)) return;
      const r = await api("DELETE", `/api/admin/clients/${encodeURIComponent(el.dataset.id)}`);
      cache.clients = null; cache.emr = null; cache.chart = null; state.chartClient = null; state.picked.delete(el.dataset.id);
      toast(`${name} is in the trash for ${r.daysLeft} days.`);
      if (location.hash === "#clients") render(); else location.hash = "clients";
    },
    // The clients ticked in the list, moved to the trash together (the same 30 days and Restore as deleting one)
    trashPicked: async () => {
      const ids = [...state.picked]; if (!ids.length) return;
      const all = await clients(), names = ids.map((id) => (all.find((c) => c.id === id) || {}).name || "A client"), n = ids.length;
      const who = n === 1 ? names[0] : `${n} clients`, list = n === 1 ? "" : `\n\n${names.slice(0, 8).join("\n")}${n > 8 ? `\nand ${n - 8} more` : ""}`;
      if (!confirm(`Move ${who} to the trash?${list}\n\nThey disappear from every list and can't sign in. You have 30 days to restore them from Clients → View trash, exactly as they were.\n\nAfter 30 days the trash empties: a client with a chart is kept as a "Closed account" with the chart, anyone else is removed. A membership keeps billing until then, so cancel it first if it should stop now.`)) return;
      let done = 0, days = 30; const failed = [];
      for (let i = 0; i < ids.length; i++) { try { const r = await api("DELETE", `/api/admin/clients/${encodeURIComponent(ids[i])}`); done++; days = r.daysLeft || days; state.picked.delete(ids[i]); } catch (e) { failed.push(`${names[i]}: ${e.message}`); } }
      cache.clients = null; cache.emr = null; cache.chart = null; state.chartClient = null;
      toast(failed.length ? `${done} moved to the trash. Not moved: ${failed.join("; ")}` : n === 1 ? `${names[0]} is in the trash for ${days} days.` : `${done} clients are in the trash for ${days} days.`);
      render();
    },
    trashOpen: async () => {
      const r = await get("/clients/trash/list");
      const rows = (r.trash || []).map((x) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(x.name)}</b> <span class="muted">${esc(x.email)}</span>
          <div class="muted" style="font-size:12px">Deleted ${when(x.trashedAt)}${x.trashedBy ? ` by ${esc(x.trashedBy)}` : ""} · empties ${fmtDate(x.emptiesOn)} (${x.daysLeft} day${x.daysLeft === 1 ? "" : "s"} left)</div>
          <div class="muted" style="font-size:12px">${x.keepsChart ? "Has a record: the chart will be kept as a closed account." : "No record: will be removed completely."}${x.membership ? " Membership still billing." : ""}</div></span>
          <button class="btn sm" data-act="trashRestore" data-id="${esc(x.id)}" data-name="${esc(x.name)}">${ui("restore", 14)} Restore</button></div>`).join("");
      modal(`<div class="card-head"><h2>Trash</h2><button class="btn sm" data-act="closeModal">Close</button></div>
        <p class="muted" style="margin:0 0 10px">Deleted clients wait here for ${r.days || 30} days. Restore puts a client back exactly as they were; they sign in again with the same password.</p>
        ${rows || none("The trash is empty.")}`);
    },
    trashRestore: async (el) => {
      await api("POST", `/api/admin/clients/${encodeURIComponent(el.dataset.id)}/restore`, {});
      cache.clients = null; cache.emr = null;
      toast(`${el.dataset.name || "Client"} is restored.`);
      closeModal(); render();
    },
    exportAsk: async () => {
      const n = state.picked.size, all = !n, total = (await clients()).length;
      modal(`<div class="card-head"><h2>Export ${all ? `all ${total} clients` : plural(n, "selected client")}</h2>${xBtn}</div>
        <div class="stack"><button type="button" class="btn primary" data-act="exportGo" data-kind="csv">Spreadsheet (CSV)</button><p class="muted" style="margin:0;font-size:12.5px">One row per client: name, email, phone, status, membership, visit dates, tags, alerts and what is owed. Opens in Excel, Numbers or Google Sheets.</p>
        ${can(PHI) ? `<button type="button" class="btn" data-act="exportGo" data-kind="records">Full records (JSON)</button><p class="muted" style="margin:0;font-size:12.5px">Everything in each chart: plan and protocols, measures, medications, alerts, consents, invoices, notes to the patient, new patient documents, visits and clinical notes. Restricted notes are listed without their text. For a patient's request for their record, or for moving to another system.</p>` : `<p class="muted" id="exportNoRecords" style="margin:0;font-size:12.5px;display:flex;gap:6px;align-items:flex-start">${ui("lock", 14)}<span>Full records (everything in each chart) are not offered to your sign-in: they hold the charts, and reading charts needs the patient records permission, which you do not have. Ask the practice owner if you need a full record.</span></p>`}
        <p class="muted" style="margin:0;font-size:12.5px">The file holds patient information: keep it only where patient records may be kept. Every export is recorded in the audit ledger.</p></div>`);
    },
    exportGo: async (el) => {
      const ids = [...state.picked], kind = el.dataset.kind;
      el.disabled = true;
      const res = await fetch(`${API}/api/admin/export/clients`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(ids.length ? { ids, kind } : { all: true, kind }) });
      if (!res.ok) { el.disabled = false; const d = await res.json().catch(() => null); throw new Error((d && d.error) || "The export could not be made."); }
      const name = ((res.headers.get("content-disposition") || "").match(/filename="?([^";]+)"?/) || [])[1] || (kind === "csv" ? "mdfit-clients.csv" : "mdfit-client-records.json");
      const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      closeModal(); toast(`Exported ${ids.length ? plural(ids.length, "client") : "all clients"}. The file is in your downloads.`);
    },
    teleInvite: (el) => { if (!(window.MDFitRT && MDFitRT.connected())) { toast("Not connected to the live service. Reload the page."); return; } MDFitRT.emit("tele_invite", { clientId: el.dataset.id }); const q = $("#teleInviteQ"); if (q) q.value = ""; const r = $("#teleInviteRes"); if (r) r.innerHTML = ""; },
    teleUninvite: (el) => { MDFitRT.emit("tele_uninvite", { clientId: el.dataset.id }); },
    chartNewNote: () => { location.hash = "notes"; },
    chartNote: async (el) => {
      if (!el.dataset.draft) return ACT.noteOpen(el);
      const n = await get(`/notes/${el.dataset.id}`);
      Object.assign(note, { id: n.id, clientId: n.clientId, template: n.template, tier: n.tier, tags: n.tags || [], dirty: false, savedAt: null }); location.hash = "notes";
    },
    book: async () => {
      const today = isoDay(new Date()), s = cache.settings || (cache.settings = await get("/settings").catch(() => ({})));
      modal(`<div class="card-head"><h2>Book ${esc(firstOf())}</h2><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div>
        <form class="stack" data-form="consult"><b>Schedule a video visit yourself</b><div class="grid g2"><div class="field"><label for="cvDate">Date</label><input id="cvDate" name="date" type="date" class="input" min="${today}" required></div><div class="field"><label for="cvTime">Time</label><input id="cvTime" name="time" type="time" step="900" class="input" required></div></div>
        <div class="grid g2"><div class="field"><label for="cvMin">Length</label><select id="cvMin" name="minutes" class="input"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>60 min</option><option value="90">90 min</option></select></div><div class="field"><label for="cvTitle">Title</label><input id="cvTitle" name="title" class="input" maxlength="80" value="Video visit"></div></div>
        <div class="field"><label for="cvLink">Video link (blank uses the built-in room)</label><input id="cvLink" name="meetingLink" type="url" class="input" placeholder="https://"></div>
        <p role="alert" data-msg style="margin:0;color:var(--bad)"></p><div class="row"><button class="btn primary">Schedule</button></div></form>
        <form class="stack" data-form="bookLink" style="border-top:1px solid var(--line);margin-top:14px;padding-top:14px"><b>Or email ${esc(firstOf())} a link to pick a time</b>
        <div class="field"><label for="blType">Visit type</label><select id="blType" name="typeId" class="input" required>${(s.appointmentTypes || []).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="blMsg">A line from you (optional)</label><input id="blMsg" name="message" class="input" maxlength="500"></div>
        <div class="row"><button class="btn">Email booking link</button></div></form>`);
    },
    rmItem: async (el) => { if (!confirm(el.dataset.word || "Remove this? It stays on the record as removed.")) return; await api("DELETE", `/api/admin/emr/${cid()}/${el.dataset.kind}/${el.dataset.id}`); await chartRedo(); toast(el.dataset.kind === "consents" ? "Consent revoked." : "Removed."); },
    prAssign: async (el) => { await setPrograms([...(cache.chart.c.assignedPrograms || []).map((p) => p.id), el.dataset.id]); await chartRedo(); toast(`Added to ${firstOf()}'s program. They are notified in the app.`); },
    prUnassign: async (el) => { await setPrograms((cache.chart.c.assignedPrograms || []).map((p) => p.id).filter((x) => x !== el.dataset.id)); await chartRedo(); toast("Program removed."); },
    prPick: async (el) => { const p = (cache.protocols || [])[Number(el.dataset.i)]; if (!p) return; await putPlan({ exercises: [...((cache.chart.c.plan || {}).exercises || []), { name: p.name, detail: p.detail || "" }] }); await chartRedo(); toast(`Added to ${firstOf()}'s program.`); },
    prRemove: async (el) => { if (!confirm("Remove this protocol from the program?")) return; const list = ((cache.chart.c.plan || {}).exercises || []).slice(); list.splice(Number(el.dataset.i), 1); await putPlan({ exercises: list }); await chartRedo(); toast("Protocol removed."); },
    fileGet: async (el) => {
      const res = await fetch(`${API}/api/admin/emr/${cid()}/files/${el.dataset.id}`, { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error(res.status === 401 ? "Session expired. Sign in again." : "That file could not be opened.");
      const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
      a.href = url; a.download = el.dataset.name || "file"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
    docView: (el) => { const x = (cache.chart.d.docs || []).find((y) => y.id === el.dataset.id); if (!x) return; let o = {}; try { o = JSON.parse(x.body); } catch {} showDoc(x.kind, o, x.title); },
    docPrint: () => { const box = $("#printDoc"), src = $("#docShown"); if (!box || !src) return; box.innerHTML = src.innerHTML; window.print(); setTimeout(() => { box.innerHTML = ""; }, 500); },
    superbill: async () => { if (!cache.settings) cache.settings = await get("/settings").catch(() => ({})); docForm("superbill"); },
    gfe: async () => { if (!cache.settings) cache.settings = await get("/settings").catch(() => ({})); docForm("gfe"); },
    invPay: (el) => { const x = ((cache.billing || {}).invoices || []).find((y) => y.id === el.dataset.id); if (!x) return;
      modal(`<div class="card-head"><h2>Mark ${esc(x.number)} paid</h2><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div><p style="margin:0 0 12px">${esc(x.description)} · <b>${usd(x.amount)}</b></p>
        <form class="stack" data-form="invPaid" data-id="${esc(x.id)}"><div class="field"><label for="ipHow">How was it paid?</label><select id="ipHow" name="method" class="input"><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card in person</option><option value="other">Another way</option></select></div><div class="row"><button class="btn primary">Mark paid</button></div></form>`); },
    // A card on file is typed on the card processor's own page, never into MD Fit
    cardAdd: () => modal(`<div class="card-head"><h2>Card on file for ${esc(firstOf())}</h2>${xBtn}</div>
      <p style="margin:0 0 12px">The card is entered on Stripe's secure page, not here: MD Fit never sees or stores the card number. Afterwards this tab shows the card's brand and last four digits.</p>
      <div class="stack"><button type="button" class="btn primary" data-act="cardOpen">Open the secure card page now</button><p class="muted" style="margin:0;font-size:12.5px">Use this with ${esc(firstOf())} in front of you, or reading you the card by phone.</p>
      <button type="button" class="btn" data-act="cardEmail">Email ${esc(firstOf())} a link to add it themselves</button><p class="muted" style="margin:0;font-size:12.5px">The link works for 24 hours.</p></div>`),
    cardOpen: async () => {
      const w = window.open("", "_blank"); // opened first so the browser does not treat it as a pop-up
      try { const r = await api("POST", `/api/admin/emr/${cid()}/card-link`, {}); if (w) { w.opener = null; w.location.href = r.url; } else location.href = r.url; closeModal(); toast("When the card is saved, come back and reopen Billing to see it."); }
      catch (e) { if (w) w.close(); throw e; }
    },
    cardEmail: async () => { await api("POST", `/api/admin/emr/${cid()}/card-link`, { send: true }); closeModal(); toast(`Emailed ${firstOf()} a secure link to add a card.`); },
    invUnpaid: async (el) => { await api("PUT", `/api/admin/emr/${cid()}/invoices/${el.dataset.id}`, { status: "unpaid" }); await loadBilling(); toast("Marked unpaid. You can send it now."); },
    invVoid: async (el) => { if (!confirm("Void this invoice? It stays on the record as void.")) return; await api("PUT", `/api/admin/emr/${cid()}/invoices/${el.dataset.id}`, { status: "void" }); toast("Invoice voided."); loadBilling(); },
    invSend: (el) => { const x = ((cache.billing || {}).invoices || []).find((y) => y.id === el.dataset.id); if (!x) return;
      modal(`<div class="card-head"><h2>Send ${esc(x.number)} to ${esc(firstOf())}</h2><button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button></div>
        <p class="muted" style="margin:0 0 12px">${esc(firstOf())} gets an email with the amount (<b>${usd(x.amount)}</b>) and a secure card payment page. The invoice is marked paid here on its own once the payment goes through.</p>
        <form class="stack" data-form="invEmail" data-id="${esc(x.id)}"><div class="field"><label for="ieSub">Subject</label><input id="ieSub" name="subject" class="input" maxlength="120" value="MD Fit invoice ${esc(x.number)}"></div>
        <div class="field"><label for="ieMsg">Your message (optional)</label><textarea id="ieMsg" name="message" class="input" rows="3" maxlength="600" placeholder="Thanks for coming in today."></textarea></div>
        <p class="muted" style="margin:0;font-size:12.5px">Email is not private. Leave health details out of the subject and the message: what the invoice is for is not included in the email or sent to the card processor.</p>
        <div class="row"><button class="btn primary">Send invoice</button><button type="button" class="btn" data-act="invLink" data-id="${esc(x.id)}">Copy payment link instead</button></div></form>`); },
    invLink: async (el) => { const r = await api("POST", `/api/admin/emr/${cid()}/invoices/${el.dataset.id}/paylink`, {}); try { await navigator.clipboard.writeText(r.url); toast("Payment link copied. It works for 24 hours."); } catch { prompt("Copy this payment link (works for 24 hours):", r.url); } },
  });
  Object.assign(FORMS, {
    scribeModel: async (f) => { const r = await api("PUT", "/api/admin/scribe/model", { model: f.model.value }); closeModal(); await render(); toast(`AI scribe now uses ${r.model}.`); },
    refund: async (f) => {
      const kind = f.dataset.kind, left = Number(f.dataset.left) / 100, dollars = kind === "extra" ? left : Number(f.amount.value), msg = $("#rfMsg");
      if (!(dollars > 0) || dollars > left + 0.001) { msg.textContent = `Enter an amount up to $${left.toFixed(2)}.`; return; }
      if (!confirm(`Refund $${dollars.toFixed(2)} to the card? This cannot be undone.`)) return;
      const body = kind === "extra" ? { linkId: f.dataset.id, sessionId: f.dataset.session, password: f.password.value } : { password: f.password.value, amount: dollars, ...(kind === "link" ? { linkId: f.dataset.id } : { clientId: cid(), ...(kind === "invoice" ? { invoiceId: f.dataset.id } : { chargeId: f.dataset.id }) }) };
      msg.textContent = "Sending the refund…";
      let r; try { r = await api("POST", "/api/admin/refunds", body); } catch (err) { msg.textContent = err.message; f.password.value = ""; f.password.focus(); return; }
      closeModal(); if (kind === "link" || kind === "extra") await render(); else await loadBilling();
      toast(`${usd(r.amount)} refunded to the card.${r.left ? ` ${usd(r.left)} of the payment remains.` : ""}`);
    },
    guideLimit: async (f) => {
      const n = Number(f.freeTokensPerDay.value);
      if (!Number.isInteger(n) || n < 1000 || n > 1000000) { toast("Enter a whole number from 1,000 to 1,000,000."); f.freeTokensPerDay.focus(); return; }
      await api("PUT", "/api/admin/guide/settings", { freeTokensPerDay: n }); await render();
      toast(`Saved. People on the free plan get ${n.toLocaleString("en-US")} Solomon tokens a day.`);
    },
    guideAiOn: async (f) => {
      if (!f.signed.checked) return;
      try { await api("PUT", "/api/admin/guide/settings", { ai: true }); } catch (err) { closeModal(); state.guideAiErr = err.message; await render(); return; }
      closeModal(); await render(); toast("AI answers are on.");
    },
    igCreate: async (f, e) => {
      const send = !!(e && e.submitter && e.submitter.value === "send"), typed = [];
      for (const raw of f.typed.value.split("\n").map((x) => x.trim()).filter(Boolean)) { const at = raw.lastIndexOf(","), name = at > 0 ? raw.slice(0, at).trim() : "", email = at > 0 ? raw.slice(at + 1).trim() : ""; if (!name || !/^\S+@\S+\.\S+$/.test(email)) { toast(`"${raw}" needs a name, a comma, then an email address.`); f.typed.focus(); return; } typed.push({ name, email }); }
      const recipients = [...state.igPeople.map((p) => ({ clientId: p.id })), ...typed];
      if (!recipients.length) { toast("Add at least one person to send it to."); $("#igFind").focus(); return; }
      if (send && recipients.length > 1 && !confirm(`Email this invoice to ${recipients.length} people? Each gets their own invoice for $${Number(f.amount.value).toFixed(2)}.`)) return;
      const r = await api("POST", "/api/admin/invoices", { description: f.description.value.trim(), amount: Number(f.amount.value), recipients, subject: f.subject.value.trim(), message: f.message.value.trim(), send });
      state.igPeople = []; closeModal(); await render(); toast(`${plural(r.created, "invoice")} created${r.sent ? " and emailed. Clients with the MD Fit app are notified there too" : ". Nothing was emailed: use Send or copy the link"}.`);
    },
    igSend: async (f) => { await api("POST", `/api/admin/invoices/${f.dataset.id}/send`, { subject: f.subject.value.trim(), message: f.message.value.trim() }); closeModal(); await render(); toast("Invoice emailed."); },
    igPaid: async (f) => { await api("POST", `/api/admin/invoices/${f.dataset.id}/status`, { status: "paid", method: f.method.value }); closeModal(); await render(); toast("Marked paid."); },
    ecoCosts: async (f) => {
      const rows = rowsOf(f, ["id", "name", "kind", "monthly"]).filter((r) => r.name);
      for (const r of rows) if (r.monthly === "" || !(Number(r.monthly) >= 0)) { toast(`Enter what ${r.name} costs a month.`); f["monthly" + r.i].focus(); return; }
      await api("PUT", "/api/admin/economics/costs", { costs: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, kind: r.kind, monthly: Number(r.monthly) })) });
      await render(); toast("Saved.");
    },
    calEvent: async (f) => { await api("POST", "/api/admin/calendar/events", { title: f.title.value.trim(), date: f.date.value, time: f.time.value, minutes: Number(f.minutes.value), note: f.note.value.trim() }); closeModal(); await render(); toast("Added to your Google Calendar."); },
    summary: async (f) => { await api("PUT", `/api/admin/emr/${cid()}/summary`, { summary: f.summary.value.trim(), tags: f.tags.value.split(",").map((x) => x.trim()).filter(Boolean) }); await chartRedo(); toast("Summary saved."); },
    planNotes: async (f) => { stopDictation(); await putPlan({ notes: f.notes.value.trim() }); await chartRedo(); toast(`Treatment plan saved. ${firstOf()} can see it in the app.`); },
    protocol: async (f) => { stopDictation(); const name = f.name.value.trim(); if (!name) return; let detail = f.detail.value.trim(); if (!detail) { const known = (cache.protocols || []).find((p) => p.name.toLowerCase() === name.toLowerCase()); if (known) detail = known.detail || ""; }
      await putPlan({ exercises: [...((cache.chart.c.plan || {}).exercises || []), { name, detail }] }); await chartRedo(); toast(`Added to ${firstOf()}'s program. They are notified in the app.`); },
    measure: async (f) => { await api("POST", `/api/admin/emr/${cid()}/measures`, { name: f.name.value.trim(), value: f.value.value, unit: f.unit.value.trim(), date: f.date.value, note: f.note.value.trim() }); await chartRedo(); toast("Measure added."); },
    med: async (f) => { await api("POST", `/api/admin/emr/${cid()}/meds`, { name: f.name.value.trim(), dose: f.dose.value.trim(), note: f.note.value.trim() }); await chartRedo(); toast("Medication added."); },
    allergy: async (f) => { await api("POST", `/api/admin/emr/${cid()}/allergies`, { name: f.name.value.trim(), reaction: f.reaction.value.trim() }); await chartRedo(); toast("Alert added. It shows at the top of the chart."); },
    consent: async (f) => { await api("POST", `/api/admin/emr/${cid()}/consents`, { title: f.title.value.trim(), detail: f.detail.value.trim(), signedOn: f.signedOn.value, expires: f.expires.value, how: f.how.value }); await chartRedo(); toast("Consent recorded."); },
    invoice: async (f, e) => {
      const send = !!(e && e.submitter && e.submitter.value === "send") && !f.method.value;
      const inv = await api("POST", `/api/admin/emr/${cid()}/invoices`, { description: f.description.value.trim(), amount: Number(f.amount.value), date: f.date.value, method: f.method.value });
      f.reset(); await loadBilling(); toast(`${inv.number} created${inv.status === "paid" ? " and marked paid" : ""}.`);
      if (send) ACT.invSend({ dataset: { id: inv.id } });
    },
    invPaid: async (f) => { await api("PUT", `/api/admin/emr/${cid()}/invoices/${f.dataset.id}`, { status: "paid", method: f.method.value }); closeModal(); toast("Marked paid."); loadBilling(); },
    invEmail: async (f) => { await api("POST", `/api/admin/emr/${cid()}/invoices/${f.dataset.id}/paylink`, { send: true, subject: f.subject.value.trim(), message: f.message.value.trim() }); closeModal(); toast(`Invoice emailed to ${firstOf()}.`); },
    membership: async (f) => { const said = await setMembership(cid(), f.tier.value, f.until.value, firstOf()); if (said) { await render(); toast(said); } },
    bookLink: async (f) => { const r = await api("POST", `/api/admin/clients/${cid()}/send-booking-link`, { typeId: f.typeId.value, message: f.message.value.trim() }); closeModal(); toast(r.message || "Booking link sent."); },
    superbill: (f) => docSubmit("superbill", f),
    gfe: (f) => docSubmit("gfe", f),
  });
  // Uploading a file to the chart: sent as it is, sealed by the server before it is stored
  async function chartUpload(input) {
    const file = input.files && input.files[0]; input.value = ""; if (!file) return;
    const types = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", txt: "text/plain" };
    const type = types[(file.name.split(".").pop() || "").toLowerCase()];
    if (!type) { toast("Files can be PDF, PNG, JPG, WEBP, HEIC or plain text."); return; }
    if (file.size > 4 * 1024 * 1024) { toast("That file is larger than 4 MB."); return; }
    toast("Uploading…");
    const res = await fetch(`${API}/api/admin/emr/${cid()}/files`, { method: "POST", headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(file.name), Authorization: "Bearer " + token }, body: file });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || (res.status === 413 ? "That file is too large." : "The upload did not go through."));
    forget(); await chartRedo(); toast("Encrypted and saved to the chart.");
  }

  // ---- Editing the practice's own settings and content, all from the workspace
  const putSettings = async (patch, said) => { cache.settings = await api("PUT", "/api/admin/settings", patch); await render(); toast(said); };
  const putContent = async (patch, said) => { cache.content = await api("PUT", "/api/admin/content", patch); closeModal(); await render(); toast(said); };
  const optsOf = () => (cache.content && cache.content.options) || {};
  const rowsOf = (f, keys) => { const out = []; for (let i = 0; f["name" + i]; i++) { const r = { i }; for (const k of keys) { const el = f[k + i]; r[k] = el ? (el.type === "checkbox" ? el.checked : el.value.trim()) : ""; } out.push(r); } return out; };
  function progForm(p, isNew) {
    const o = optsOf(), days = [...(p.days || []), { name: "", goal: "full", length: 30 }];
    modal(`<div class="card-head"><h2>${isNew ? "New program" : "Edit program"}</h2>${xBtn}</div>
      <form class="stack" data-form="progSave" data-id="${esc(p.id)}" data-new="${isNew ? "1" : ""}">${fld("pgTitle", "title", "Title", p.title, { max: 80, attrs: "required" })}
      <div class="grid g3">${sel("pgCat", "category", "Category", o.categories || [p.category], p.category)}${sel("pgLevel", "level", "Level", o.levels || [p.level], p.level)}${sel("pgLoc", "location", "Where", o.locations || [p.location], p.location)}</div>
      <div class="grid g2">${fld("pgWeeks", "weeks", "Weeks", p.weeks, { type: "number", attrs: 'min="1" max="52" required' })}${sel("pgAccess", "access", "Who can open it", o.access || [p.access], p.access || "free")}</div>
      ${fld("pgSum", "summary", "Summary", p.summary, { area: true, rows: 2, max: 400 })}${fld("pgNotes", "notes", "Notes for the member", p.notes, { area: true, rows: 3, max: 1000 })}
      <div><label class="muted" style="font-size:12px">Training days: name, focus, minutes. Clear a name to remove a day; fill the last row to add one (up to 7).</label>
      ${days.slice(0, 7).map((d, i) => `<div class="set-row three"><input name="name${i}" class="input" value="${esc(d.name)}" maxlength="40" placeholder="${d.name ? "Day name" : "Add a day"}" aria-label="Day ${i + 1} name"><select name="goal${i}" class="input" aria-label="Day ${i + 1} focus">${(o.goals || [d.goal]).map((g) => `<option${g === d.goal ? " selected" : ""}>${esc(g)}</option>`).join("")}</select><select name="length${i}" class="input" aria-label="Day ${i + 1} minutes">${[15, 20, 25, 30, 45, 60, 90].map((n) => `<option${n === Number(d.length) ? " selected" : ""}>${n}</option>`).join("")}</select></div>`).join("")}</div>
      <div class="row"><button class="btn primary">${isNew ? "Create program" : "Save program"}</button></div></form>`);
    $("#modal").classList.add("wide");
  }
  Object.assign(ACT, {
    chartBilling: (el) => { state.chartClient = el.dataset.id; state.chartTab = "billing"; if (location.hash === "#chart") render(); else location.hash = "chart"; },
    layTab: (el) => { state.layTab = el.dataset.v; render(); },
    layState: (el) => { const x = layDraft().sections[Number(el.dataset.i)]; if (x) { x.state = el.dataset.v; delete x.show; render(); } },
    layMove: (el) => { const d = layDraft(), i = Number(el.dataset.i), j = i + Number(el.dataset.by); if (j < 0 || j >= d.sections.length) return; [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]]; render(); },
    homeReset: () => { if (state.layDraft) delete state.layDraft[layTab()]; render(); },
    progEdit: (el) => { const p = (cache.content.programs || []).find((x) => x.id === el.dataset.id); if (p) progForm(p, false); },
    progCopy: (el) => { const p = (cache.content.programs || []).find((x) => x.id === el.dataset.id); if (p) progForm({ ...p, id: p.id, title: p.title + " (copy)" }, true); },
    progDelete: async (el) => { const p = (cache.content.programs || []).find((x) => x.id === el.dataset.id); if (!p || !confirm(`Delete "${p.title}"? Members who were assigned it will no longer see it.`)) return; await putContent({ programs: cache.content.programs.filter((x) => x.id !== p.id) }, "Program deleted."); },
    lectureEdit: (el) => { const l = (cache.content.lectures || []).find((x) => x.id === el.dataset.id) || { id: "", title: "", topic: (optsOf().topics || ["Health"])[0], minutes: 10, access: "free" }, o = optsOf();
      modal(`<div class="card-head"><h2>${l.id ? "Edit lecture" : "New lecture"}</h2>${xBtn}</div><form class="stack" data-form="lectureSave" data-id="${esc(l.id)}">${fld("lcTitle", "title", "Title", l.title, { max: 120, attrs: "required" })}
        <div class="grid g3">${sel("lcTopic", "topic", "Topic", o.topics || [l.topic], l.topic)}${fld("lcMin", "minutes", "Minutes", l.minutes, { type: "number", attrs: 'min="0" max="600"' })}${sel("lcAccess", "access", "Who can open it", o.access || [l.access], l.access)}</div>
        ${fld("lcUrl", "url", "Video link", l.url, { type: "url", max: 500 })}${fld("lcDl", "downloadUrl", "Download link (optional)", l.downloadUrl, { type: "url", max: 500 })}${fld("lcSum", "summary", "Summary", l.summary, { area: true, rows: 3, max: 500 })}
        <div class="row"><button class="btn primary">Save lecture</button></div></form>`); },
    lectureDelete: async (el) => { if (!confirm("Delete this lecture?")) return; await putContent({ lectures: cache.content.lectures.filter((x) => x.id !== el.dataset.id) }, "Lecture deleted."); },
    recEdit: (el) => { const r = (cache.content.recommendations || []).find((x) => x.id === el.dataset.id) || { id: "", area: "", title: "", body: "", link: "" };
      modal(`<div class="card-head"><h2>${r.id ? "Edit recommendation" : "New recommendation"}</h2>${xBtn}</div><form class="stack" data-form="recSave" data-id="${esc(r.id)}"><div class="grid g2">${fld("rcTitle", "title", "Title", r.title, { max: 120, attrs: "required" })}${fld("rcArea", "area", "Area (e.g. Protein, Sleep)", r.area, { max: 40, attrs: "required" })}</div>
        ${fld("rcBody", "body", "What members read", r.body, { area: true, rows: 8, max: 2000, attrs: "required" })}${fld("rcLink", "link", "Link (optional)", r.link, { type: "url", max: 500 })}
        <div class="row"><button class="btn primary">Save recommendation</button></div></form>`); $("#modal").classList.add("wide"); },
    recDelete: async (el) => { if (!confirm("Delete this recommendation?")) return; await putContent({ recommendations: cache.content.recommendations.filter((x) => x.id !== el.dataset.id) }, "Recommendation deleted."); },
    classEdit: (el) => { const c = (cache.classes || []).find((x) => x.id === el.dataset.id) || { id: "", title: "", day: 1, time: "09:00", durationMin: 60, capacity: 10, coach: "", location: "", description: "" };
      modal(`<div class="card-head"><h2>${c.id ? "Edit class" : "New class"}</h2>${xBtn}</div><form class="stack" data-form="classSave" data-id="${esc(c.id)}">${fld("clTitle", "title", "Class name", c.title, { max: 80, attrs: "required" })}
        <div class="grid g2">${sel("clDay", "day", "Day", DAYN.map((d, i) => [i, d]), c.day)}${fld("clTime", "time", "Start time", c.time, { type: "time", attrs: "required" })}</div>
        <div class="grid g2">${fld("clLen", "durationMin", "Length (minutes)", c.durationMin, { type: "number", attrs: 'min="15" max="240"' })}${fld("clCap", "capacity", "Spots", c.capacity, { type: "number", attrs: 'min="1" max="100"' })}</div>
        <div class="grid g2">${fld("clCoach", "coach", "Coach", c.coach, { max: 80 })}${fld("clLoc", "location", "Where", c.location, { max: 120 })}</div>${fld("clDesc", "description", "Description", c.description, { area: true, rows: 3, max: 500 })}
        ${c.id ? `<label class="row" style="gap:8px"><input type="checkbox" name="active"${c.active !== false ? " checked" : ""}> Open for booking</label>` : ""}
        <div class="row"><button class="btn primary">Save class</button>${c.id ? `<button type="button" class="btn danger" data-act="classDelete" data-id="${esc(c.id)}">Delete class</button>` : ""}</div></form>`); },
    classDelete: async (el) => { if (!confirm("Delete this class? Its upcoming bookings are cancelled too.")) return; await api("DELETE", `/api/admin/classes/${el.dataset.id}`); closeModal(); await render(); toast("Class deleted."); },
    calTest: async () => { const out = $("#calTestOut"); out.textContent = "Checking…"; const r = await api("POST", "/api/admin/calsync/test", {}).catch((e) => ({ error: e.message })); out.textContent = r.error ? r.error : `Read ${r.busyNext14Days || 0} busy times for the next two weeks.${r.lastError ? " Problem: " + r.lastError : " No problems."}`; },
    mfaOn: async () => { const r = await api("POST", "/api/admin/mfa/start", {}); modal(`<div class="card-head"><h2>Turn on two-step sign-in</h2>${xBtn}</div><p style="margin:0 0 12px">A 6-digit code was emailed to ${esc(r.to || "you")}. Type it here to finish.</p><form class="stack" data-form="mfaConfirm">${fld("mfCode", "code", "Code", "", { max: 8, attrs: 'inputmode="numeric" autocomplete="one-time-code" required' })}<div class="row"><button class="btn primary">Turn on</button></div></form>`); },
    mfaOff: () => modal(`<div class="card-head"><h2>Turn off two-step sign-in</h2>${xBtn}</div><p style="margin:0 0 12px">Signing in will need only the password. Type your password to confirm.</p><form class="stack" data-form="mfaDisable">${fld("mfPass", "password", "Password", "", { type: "password", attrs: 'autocomplete="current-password" required' })}<div class="row"><button class="btn danger">Turn off</button></div></form>`),
  });
  Object.assign(FORMS, {
    setBusiness: (f) => putSettings({ business: { name: f.name.value.trim(), phone: f.phone.value.trim(), tagline: f.tagline.value.trim(), email: f.email.value.trim(), address: f.address.value.trim(), hours: f.hours.value.trim(), bookingNote: f.bookingNote.value.trim() } }, "Practice details saved."),
    setHours: (f) => {
      const hours = DAYN.map((d, i) => f["h" + i].value.split(",").map((x) => x.trim()).filter(Boolean).map((w) => { const m = w.match(/^(\d{1,2}):?(\d{2})?\s*(?:-|to)\s*(\d{1,2}):?(\d{2})?$/i); if (!m) throw new Error(`${d}: "${w}" is not a time window. Type it like 09:00-17:00.`); return [`${m[1].padStart(2, "0")}:${m[2] || "00"}`, `${m[3].padStart(2, "0")}:${m[4] || "00"}`]; }));
      return putSettings({ scheduling: { hours, slotStepMin: Number(f.slotStepMin.value), lastStart: f.lastStart.value, minNoticeHours: Number(f.minNoticeHours.value), daysAhead: Number(f.daysAhead.value), blockedDates: f.blockedDates.value.split(/[\s,]+/).filter(Boolean) } }, "Booking hours saved.");
    },
    setTypes: (f) => { const cur = cache.settings.appointmentTypes || []; return putSettings({ appointmentTypes: rowsOf(f, ["name", "minutes", "remote", "description"]).filter((r) => r.name).map((r) => ({ id: (cur[r.i] && cur[r.i].id) || slugOf(r.name), name: r.name, minutes: Number(r.minutes), description: r.description, remote: r.remote })) }, "Visit types saved."); },
    setServices: (f) => { const cur = cache.settings.services || []; return putSettings({ services: rowsOf(f, ["name", "rate", "unit", "description"]).filter((r) => r.name).map((r) => ({ ...(cur[r.i] || {}), id: (cur[r.i] && cur[r.i].id) || slugOf(r.name), name: r.name, rate: Number(r.rate), unit: r.unit || "visit", description: r.description })) }, "Services and fees saved."); },
    setPlans: (f) => putSettings({ plans: Object.fromEntries(["gold", "silver", "silverPayments", "reviewDiscountPct", "ext12", "ext24"].map((k) => [k, Number(f[k].value)])) }, "Pricing saved."),
    setVideo: (f) => putSettings({ booking: { telehealthUrl: f.telehealthUrl.value.trim() } }, "Video link saved."),
    setIcs: async (f) => { const v = f.icsUrl.value.trim(); if (!v && !confirm("Disconnect the SimplePractice calendar? Its busy times will stop blocking bookings.")) return; await api("PUT", "/api/admin/calsync", { icsUrl: v }); await render(); toast(v ? "Calendar link saved." : "SimplePractice calendar disconnected."); },
    homeSave: async (f) => {
      const w = layTab(), d = layDraft(w), body = { sections: d.sections.map((x) => ({ id: x.id, state: layState(x) })) };
      if (w === "home") {
        const raw = f.suggestions.value.trim(), shown = Number(raw);
        if (raw === "" || !Number.isInteger(shown) || shown < 0 || shown > 20) { formMsg(f, "Suggestions shown: 0 to 20."); f.suggestions.focus(); return; }
        body.suggestions = shown;
      }
      formMsg(f, "");
      let c; try { c = await api("PUT", "/api/admin/content", { [w]: body }); } catch (err) { formMsg(f, err.message); return; } // the draft stays as arranged
      cache.content = c; delete state.layDraft[w]; await render(); toast(`${w === "home" ? "Home" : "Profile"} saved. Members see it the next time the app loads.`);
    },
    setTiers: (f) => putContent({ tiers: (cache.content.tiers || []).map((t, i) => ({ ...t, name: f["name" + i].value.trim(), price: Number(f["price" + i].value), meetings: Number(f["meetings" + i].value), meetingMinutes: Number(f["minutes" + i].value), directMessages: !!f["direct" + i].checked, perks: f["perks" + i].value.split("\n").map((x) => x.trim()).filter(Boolean) })) }, "Membership types saved."),
    progSave: (f) => {
      const all = cache.content.programs || [], src = all.find((x) => x.id === f.dataset.id) || {}, isNew = !!f.dataset.new;
      const days = rowsOf(f, ["name", "goal", "length"]).filter((r) => r.name).map((r) => ({ ...((src.days || [])[r.i] || {}), name: r.name, goal: r.goal, length: Number(r.length) }));
      if (!days.length) throw new Error("A program needs at least one training day.");
      const p = { ...src, id: isNew ? slugOf(f.title.value) : src.id, title: f.title.value.trim(), category: f.category.value, level: f.level.value, location: f.location.value, weeks: Number(f.weeks.value), access: f.access.value, summary: f.summary.value.trim(), notes: f.notes.value.trim(), days };
      if (isNew) delete p.perWeek;
      return putContent({ programs: isNew ? [...all, p] : all.map((x) => (x.id === p.id ? p : x)) }, isNew ? "Program created." : "Program saved.");
    },
    lectureSave: (f) => { const all = cache.content.lectures || [], id = f.dataset.id, l = { ...(all.find((x) => x.id === id) || {}), id: id || slugOf(f.title.value), title: f.title.value.trim(), topic: f.topic.value, minutes: Number(f.minutes.value), access: f.access.value, url: f.url.value.trim(), downloadUrl: f.downloadUrl.value.trim(), summary: f.summary.value.trim() };
      return putContent({ lectures: id ? all.map((x) => (x.id === id ? l : x)) : [...all, l] }, "Lecture saved."); },
    recSave: (f) => { const all = cache.content.recommendations || [], id = f.dataset.id, r = { ...(all.find((x) => x.id === id) || {}), id: id || slugOf(f.title.value), title: f.title.value.trim(), area: f.area.value.trim(), body: f.body.value.trim(), link: f.link.value.trim() };
      return putContent({ recommendations: id ? all.map((x) => (x.id === id ? r : x)) : [...all, r] }, "Recommendation saved."); },
    classSave: async (f) => { const body = { title: f.title.value.trim(), day: Number(f.day.value), time: f.time.value, durationMin: Number(f.durationMin.value), capacity: Number(f.capacity.value), coach: f.coach.value.trim(), location: f.location.value.trim(), description: f.description.value.trim() };
      if (f.dataset.id) await api("PUT", `/api/admin/classes/${f.dataset.id}`, { ...body, ...(f.active ? { active: f.active.checked } : {}) }); else await api("POST", "/api/admin/classes", body);
      closeModal(); await render(); toast("Class saved."); },
    mfaConfirm: async (f) => { await api("POST", "/api/admin/mfa/confirm", { code: f.code.value.trim() }); closeModal(); await render(); toast("Two-step sign-in is on."); },
    mfaDisable: async (f) => { await api("POST", "/api/admin/mfa/disable", { password: f.password.value }); closeModal(); await render(); toast("Two-step sign-in is off."); },
  });

  async function loadPool() {
    const box = $("#mvPool"); if (!box) return;
    const pool = ((await get("/emr/pool").catch(() => ({ pool: [] }))).pool || []).slice(0, 12);
    if ($("#mvPool")) $("#mvPool").innerHTML = pool.length ? `<p class="muted" style="margin:0 0 6px;font-size:12px">Prescribed most often. One tap adds it with the same dose.</p><div class="row">${pool.map((m) => `<button type="button" class="btn sm" data-act="mvPool" data-id="${esc(m.videoId)}" data-name="${esc(m.name)}" data-dose="${esc(m.dose || "")}" data-cue="${esc(m.cue || "")}">${esc(m.name)}${m.dose ? ` <span class="muted">${esc(m.dose)}</span>` : ""}</button>`).join("")}</div>` : "";
  }

  // A button only names what should happen (data-act) and the table above does it. The press shows on the button at
  // once and stays until the work is finished; a form whose first send is still on its way is not sent a second time.
  const going = new WeakSet(), RESEND = new Set(["message", "teleChat"]);
  const press = (el, run) => { going.add(el); el.setAttribute("aria-busy", "true"); const off = () => { going.delete(el); el.removeAttribute("aria-busy"); }; run.then(off, off); };
  // Carry this tab's sign-in across to a console (same token; the server still decides what it may open)
  // Which half of the workspace is showing: the client-management screens, or the rest of it (Admin)
  const CMP_SCREENS = ["clients", "leads", "messages"];
  function markSide() {
    const r = (location.hash || "#dashboard").slice(1), only = document.querySelector("#portals [data-only]");
    const here = only || CMP_SCREENS.includes(r) ? "cmp" : "admin";
    document.querySelectorAll("#portals [data-side]").forEach((a) => { if (a.dataset.side === here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  window.addEventListener("hashchange", markSide);
  document.addEventListener("click", (e) => { if (e.target.closest("#portals [data-only]")) { e.preventDefault(); return; } const a = e.target.closest("[data-portal]"); if (!a || !token) return; try { sessionStorage.setItem(a.dataset.portal, JSON.stringify({ token, expiresAt: new Date(Date.now() + 11 * 3600e3).toISOString() })); } catch {} });
  document.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || !token) return; const fn = ACT[el.dataset.act]; if (fn) press(el, guard(fn)(el, e)); });
  document.addEventListener("submit", (e) => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault(); const fn = FORMS[f.dataset.form]; if (!fn || !token) return; if (going.has(f) && !RESEND.has(f.dataset.form)) return; press(f, guard(fn)(f, e)); });
  // Things that act as buttons without being one (a month in the graph, a row in a table) answer Enter and Space too
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-act][tabindex]:not(button):not(a):not(input)")) { e.preventDefault(); e.target.click(); } });
  // Getting ahead of the click: resting the pointer on a link to a screen, or pressing down on it, starts loading that
  // screen, and pressing down on a client starts loading their chart. Only screens that are safe to load unseen.
  let hoverT = 0;
  const ahead = (e, wait) => {
    if (!token || !e.target.closest) return;
    const a = e.target.closest('a[href^="#"]'), r = a ? a.getAttribute("href").slice(1) : "";
    clearTimeout(hoverT);
    if (r && r !== shown && navOk(r) && (WARM.includes(r) || AHEAD[r])) hoverT = setTimeout(() => { if (token) early(r).catch(() => {}); }, wait);
  };
  document.addEventListener("pointerover", (e) => { if (e.pointerType === "mouse") ahead(e, 90); });
  // The menu answers the press itself: the highlight moves at once, and the screen follows from memory.
  document.addEventListener("pointerdown", (e) => { const a = token && e.target.closest && e.target.closest("#nav a[data-nav]"); if (a && e.button === 0) { lastTouch = Date.now(); for (const x of $("#nav").querySelectorAll("a[data-nav]")) x.classList.toggle("active", x === a); } }, true);
  document.addEventListener("pointerdown", (e) => {
    ahead(e, 0);
    const el = token && e.target.closest && e.target.closest("[data-act]");
    if (el && (el.dataset.act === "chart" || el.dataset.act === "searchOpen") && el.dataset.id && el.dataset.id !== state.chartClient) for (const p of [`/emr/${el.dataset.id}`, `/clients/${el.dataset.id}`, `/notes?clientId=${el.dataset.id}`]) load(p).catch(() => {});
  }, true);
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-change=staffRole]")) { const f = e.target.closest("form"); load("/staff").then((d) => permRoleSync(f, d, true)).catch(() => {}); }
    if (e.target.matches("[data-change=leadStatus]")) guard(ACT.leadSave)(e.target);
    if (e.target.matches("[data-change=chartFile]")) guard(chartUpload)(e.target);
    if (e.target.matches("[data-change=impChoice]")) ACT.impChoice(e.target);
    if (e.target.matches("[data-change=impPick]")) ACT.impPick(e.target);
    if (e.target.matches("[data-change=pickOne], [data-change=pickAll]")) {
      // "everyone shown" is everyone the filter matches, including rows not drawn yet
      if (e.target.matches("[data-change=pickAll]")) for (const c of ((cache.clientView || {}).rows || [])) { if (e.target.checked) state.picked.add(c.id); else state.picked.delete(c.id); }
      if (e.target.matches("[data-change=pickAll]")) document.querySelectorAll("[data-change=pickOne]").forEach((b) => { b.checked = e.target.checked; if (b.checked) state.picked.add(b.dataset.id); else state.picked.delete(b.dataset.id); });
      else if (e.target.checked) state.picked.add(e.target.dataset.id); else state.picked.delete(e.target.dataset.id);
      const l = $("#exportLabel"); if (l) l.textContent = state.picked.size ? `Export ${state.picked.size} selected` : "Export all";
      const tp = $("#trashPicked"), tl = $("#trashPickedLabel"); if (tp) { tp.hidden = !state.picked.size; if (tl) tl.textContent = `Delete ${state.picked.size} selected`; }
    }
    if (e.target.matches("[data-change=rowTier]")) guard(async (el) => { const was = ((cache.clients || await clients()).find((x) => x.id === el.dataset.id) || {}).membership; const said = await setMembership(el.dataset.id, el.value, was && was.tier === el.value ? was.until : "", el.dataset.name); if (said) { await clients(true); toast(said); } else el.value = (was && was.tier) || ""; el.classList.toggle("on", !!el.value); })(e.target);
    if (e.target.matches("[data-change=chartTier]")) guard(async (el) => { const was = cache.chart.c.membership, said = await setMembership(cid(), el.value, "", firstOf()); if (said) { await render(); toast(said); } else el.value = (was && was.tier) || ""; })(e.target);
    if (e.target.matches("[data-change=chartType]")) guard(async (el) => { await api("PUT", `/api/admin/clients/${cid()}/type`, { type: el.value }); cache.clients = null; const type = el.value; await render(); toast(`${firstOf()} is now ${type === "inpatient" ? "subscription exempt: visits are not charged" : "standard"}.`); })(e.target);
    if (e.target.matches("[data-change=teleScribe]")) teleScribe(e.target.checked);
    if (e.target.matches("[data-change=teleGroup]")) {
      const cur = [...tele.peers.values()][0];
      if (!(window.MDFitRT && MDFitRT.connected())) { e.target.checked = tele.group; toast("Not connected to the live service. Reload the page."); }
      else if (e.target.checked && cur && !confirm(`Open this visit to more people? ${firstName(cur.name)}'s camera and microphone turn off until you make them a speaker again and they agree.`)) e.target.checked = false;
      else MDFitRT.emit("tele_group", { on: e.target.checked });
    }
    if (e.target.matches("[data-change=noteClient]")) noteClientSwitch(e.target.value);
    if (e.target.matches("[data-change=noteTemplate]")) { note.template = e.target.value; $("#nBodyLabel").textContent = TEMPLATES[note.template]; $("#sKind").textContent = TEMPLATES[note.template]; if (note.id || $("#nBody").value.trim()) noteTouch(); }
    if (e.target.matches("[data-change=noteTier]")) { note.tier = e.target.value; if (note.id || $("#nBody").value.trim()) noteTouch(); }
    if (e.target.matches("[data-change=bcTo]")) { const p = $("#bcPick"); if (p) p.hidden = e.target.value !== "selected"; }
    if (e.target.matches("[data-change=insDays]")) { state.insDays = Number(e.target.value) || 30; render(); }
    if (e.target.matches("[data-change=ecoMonths]")) { state.ecoMonths = Number(e.target.value) || 6; render(); }
    if (e.target.id === "gaSigned") { const go = $("#gaGo"); if (go) go.disabled = !e.target.checked; }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "mvSearch") {
      const q = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean), box = $("#mvResults");
      box.innerHTML = q.length ? (EXERCISES.filter((x) => q.every((w) => `${x.name} ${x.region} ${x.cat}`.toLowerCase().includes(w))).slice(0, 10).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.region)} · ${esc(x.cat)} · level ${x.level}</div></span><button type="button" class="btn sm" data-act="mvPick" data-id="${esc(x.id)}">Choose</button></div>`).join("") || none("No movement matches.")) : "";
    }
    if (e.target.dataset && e.target.dataset.svc) { const sv = ((cache.settings && cache.settings.services) || []).find((x) => x.name === e.target.value), fee = e.target.parentElement.querySelector('[name^="fee"]'); if (sv && fee && !fee.value) fee.value = sv.rate; }
    if (e.target.id === "smFind") { const words = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean), pick = $("#smPick"); let first = null; for (const o of pick.options) { o.hidden = !words.every((w) => o.value.toLowerCase().includes(w)); if (!o.hidden && !first) first = o; } if (first && (pick.selectedOptions[0] || {}).hidden) first.selected = true; }
    if (e.target.id === "teleInviteQ") {
      const q = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean), box = $("#teleInviteRes");
      if (!q.length) { box.innerHTML = ""; return; }
      // what each person is using may have changed since this screen was drawn (they may have just opened the app)
      if (Date.now() - (cache.devAt || 0) > 8000) { cache.devAt = Date.now(); get("/telehealth/devices").then((d) => { cache.devices = d || {}; const b = $("#teleInviteQ"); if (b && b.value.trim()) b.dispatchEvent(new Event("input", { bubbles: true })); }).catch(() => {}); }
      clientsHit((l) => l.some((c) => q.every((w) => `${c.name} ${c.email}`.toLowerCase().includes(w))), e.target).then((list) => { if (!$("#teleInviteQ") || $("#teleInviteQ").value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ") !== q.join(" ")) return;
        const here = new Set([...tele.peers.keys(), ...tele.waiting.map((p) => p.clientId)]), asked = new Set(tele.invited.map((p) => p.clientId));
        box.innerHTML = list.filter((c) => q.every((w) => `${c.name} ${c.email}`.toLowerCase().includes(w))).slice(0, 8).map((c) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email)}</div>${devLine((cache.devices || {})[c.id], true)}</span>${here.has(c.id) ? `<span class="pill ok">Here</span>` : `<button type="button" class="btn sm primary" data-act="teleInvite" data-id="${esc(c.id)}">${asked.has(c.id) ? "Invite again" : "Invite to telehealth"}</button>`}</div>`).join("") || none("No client matches.");
      }).catch(() => {});
    }
    if (e.target.id === "formsQ") { state.formsQ = e.target.value; formsFilter(); }
    if (e.target.id === "igFind") {
      const q = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean), box = $("#igRes");
      if (!q.length) { box.innerHTML = ""; return; }
      clientsHit((l) => l.some((c) => q.every((w) => `${c.name} ${c.email}`.toLowerCase().includes(w))), e.target).then((list) => { const now = $("#igFind"); if (!now || now.value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ") !== q.join(" ")) return;
        const have = new Set(state.igPeople.map((p) => p.id));
        box.innerHTML = list.filter((c) => !have.has(c.id) && q.every((w) => `${c.name} ${c.email}`.toLowerCase().includes(w))).slice(0, 8).map((c) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email)}</div></span><button type="button" class="btn sm primary" data-act="igAdd" data-id="${esc(c.id)}">Add</button></div>`).join("") || none("No client matches.");
      }).catch(() => {});
    }
    if (e.target.id === "nClientQ") noteClientType(e.target);
    if (e.target.id === "nFiledQ") noteFiledType(e.target);
    if (e.target.id === "clientQ") { state.clientQ = e.target.value; clearTimeout(e.target._t); e.target._t = setTimeout(async () => { const pos = e.target.selectionStart; await render(); const i = $("#clientQ"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 250); }
  });
  // Keys in the two search fields on the note screen: Escape empties the field, Enter in the client search picks the first match
  document.addEventListener("keydown", (e) => {
    const id = e.target && e.target.id; if ((id !== "nClientQ" && id !== "nFiledQ") || e.isComposing) return;
    if (e.key === "Escape") { if (!e.target.value) return; e.preventDefault(); e.target.value = ""; (id === "nClientQ" ? noteClientType : noteFiledType)(e.target); return; }
    if (e.key !== "Enter") return;
    e.preventDefault(); const q = qWords(e.target.value); if (id !== "nClientQ" || !q.length || !token) return;
    guard(async () => { const c = noteClientFind(await clients(), q)[0]; if (c) await ACT.noteClientPick({ dataset: { id: c.id } }); else toast("No client matches that."); })();
  });

  // ---------------------------------------------------------------- router and start
  // ---- First sign-in. A password someone else chose is not the person's own, so until they have chosen one the
  // workspace shows nothing else: no menu, no screens, no quick actions.
  let mustChange = false;
  const pwFields = () => `${fld("pwNow", "current", "The password you signed in with", "", { type: "password", max: 72, attrs: 'required autocomplete="current-password"' })}
    ${fld("pwNew", "password", "New password", "", { type: "password", max: 72, attrs: 'required minlength="10" autocomplete="new-password"' })}
    ${fld("pwAgain", "confirm", "New password again", "", { type: "password", max: 72, attrs: 'required minlength="10" autocomplete="new-password"' })}
    <p class="muted" style="margin:0;font-size:12.5px">At least 10 characters. What you type here is sent and nothing is kept on this device.</p>`;
  function renderGate() {
    const nav = $("#nav"); nav.innerHTML = ""; nav.dataset.sig = ""; nav.classList.remove("open");
    $("#qa").hidden = true; $("#globalSearch").disabled = true; closeModal();
    shown = ""; shownHtml = "";
    $("#view").innerHTML = `<div class="card stack" id="pwGate" style="max-width:480px;margin:0 auto">
      <div class="card-head"><h2>Choose your own password</h2>${ui("lock", 16)}</div>
      <p style="margin:0">This sign-in still uses a password someone else set for you. Choose your own now: nothing else in the workspace opens until you have.</p>
      <form class="stack" data-form="mePassword" autocomplete="off">${pwFields()}
        <p role="alert" data-msg style="margin:0;color:var(--bad);min-height:1.2em"></p>
        <div class="row"><button class="btn primary">Save my new password</button></div></form></div>`;
    const first = $("#pwGate input"); if (first) first.focus();
  }
  let seq = 0, done = 0, shown = "", shownHtml = "", late = false, repaintT = 0;
  const routeNow = () => { let r = (location.hash || "#dashboard").slice(1); if (r === "reports") r = "insights"; return V[r] ? r : "dashboard"; };
  function paint(r, html, again) {
    const view = $("#view"); view.innerHTML = html; shown = r; shownHtml = html;
    qaSeat(r);
    if (r === "chart" && state.chartClient) chartAfter();
    if (r === "telehealth") { if (window.MDFitRT) MDFitRT.emit("tele_list"); teleMount(); }
    if (r === "economics" && state.ecoOpen) ecoDetail();
    if (r === "forms") formsFilter();
    if (r === "clients") rowsArm();
    if (r === "messages") { fitChat(); if (!again) { const l = $("#msgList"); if (l) l.scrollTop = l.scrollHeight; } } // a conversation opens at its newest message
  }
  // The conversation card ends where the window ends, whatever is above it, so the box to write in is always on screen
  function fitChat() { const c = $(".chat"); if (c) c.style.height = Math.max(300, window.innerHeight - c.getBoundingClientRect().top - 16) + "px"; }
  window.addEventListener("resize", fitChat);
  // Nobody is in the middle of anything on the screen: nothing open on top of it, nothing typed, ticked or picked
  // that has not been sent, no text selected, no visit or dictation running.
  function calm() {
    if ($("#modalBack").classList.contains("open") || dict.on || teleIn() || note.dirty || document.hidden) return false;
    const view = $("#view"), a = document.activeElement;
    if (a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
    const picked = window.getSelection && window.getSelection(); if (picked && !picked.isCollapsed && picked.anchorNode && view.contains(picked.anchorNode)) return false;
    for (const f of view.querySelectorAll("input,textarea,select")) {
      if (f.tagName === "SELECT") { const d = [...f.options].findIndex((o) => o.defaultSelected); if (f.selectedIndex !== (d < 0 ? 0 : d)) return false; }
      else if (f.type === "checkbox" || f.type === "radio") { if (f.checked !== f.defaultChecked) return false; }
      else if (f.type === "file" ? f.files.length : f.value !== f.defaultValue) return false;
    }
    return true;
  }
  const NO_REPAINT = new Set(["notes", "telehealth"]); // a note being written and a visit in progress are never redrawn underneath you
  function changed() { late = true; clearTimeout(repaintT); repaintT = setTimeout(repaint, 60); }
  async function repaint() {
    if (!token || seq !== done) return; // a screen is on its way: it comes back here when it lands
    late = false;
    const r = routeNow(); if (r !== shown || NO_REPAINT.has(r) || !calm()) return;
    const my = seq; let html;
    try { html = await V[r](); } catch { return; }
    if (my !== seq || !token || html === shownHtml || !calm()) return;
    const view = $("#view"), at = [view, ...view.querySelectorAll("[id]")].filter((x) => x.scrollTop > 0).map((x) => [x.id, x.scrollTop]);
    const focus = document.activeElement && view.contains(document.activeElement) ? document.activeElement.id : "";
    paint(r, html, true);
    for (const [id, y] of at) { const x = document.getElementById(id); if (x) x.scrollTop = y; }
    if (focus) { const x = document.getElementById(focus); if (x) x.focus({ preventScroll: true }); }
  }
  // Loading the screens ahead of time, quietly and one after another: all of them once after sign-in, and after a
  // change the ones opened most recently. Only screens that show the same thing whoever is looking and that change
  // nothing by being loaded: not a chart, a conversation (opening one marks it read), the note editor or a visit.
  const WARM = ["dashboard", "calendar", "clients", "leads", "forms", "payments", "programs", "nutrition", "fitness", "newsletter", "insights", "team", "feedback", "security", "settings", "booking"];
  // The screens left out of that list still get everything they can have ahead of time: the list of conversations,
  // the scribe's status for the note screen, what the telehealth screen and an empty chart screen show, the money totals.
  const AHEAD = {
    messages: () => load("/messages"), notes: () => Promise.all([clients(), load("/scribe")]), telehealth: () => Promise.all([load("/appointments?all=1"), load("/settings"), load("/telehealth/devices")]),
    chart: () => Promise.all([load("/emr"), content()]), economics: () => load(`/economics?months=${state.ecoMonths || 6}`),
    guide: () => guideStats(GUIDE_DAYS.includes(state.guideDays) ? state.guideDays : 30)
  };
  const early = (r) => (WARM.includes(r) ? V[r]() : AHEAD[r] ? AHEAD[r]() : Promise.resolve());
  const visited = []; let warmT = 0, warmRun = 0, warmedAt = 0, warming = false, lastTouch = 0;
  const quietNow = async () => { for (let i = 0; i < 200 && (seq !== done || pending > 0 || Date.now() - lastTouch < 1500); i++) await new Promise((go) => setTimeout(go, 150)); };
  async function warm(list) {
    const my = ++warmRun, tk = token; warming = true;
    try {
      for (const r of list) {
        if (my !== warmRun || !token || tk !== token) return;
        if (r === shown || document.hidden || !navOk(r)) continue; // never load ahead a screen this sign-in may not open
        await quietNow(); // the person's own clicks always go first
        if (my !== warmRun || !token || tk !== token) return;
        try { await early(r); } catch {}
        await new Promise((go) => setTimeout(go, 120));
      }
    } finally { if (my === warmRun) warming = false; }
  }
  function rewarm(method, path) {
    if (!token || (method !== "DELETE" && /^\/api\/admin\/notes(\/[^/]+)?$/.test(path))) return; // a draft saving itself as you type is not a reason to reload the other screens
    clearTimeout(warmT);
    warmT = setTimeout(() => { if (!token) return; warmedAt = Date.now(); warm(visited.filter((r) => WARM.includes(r) || AHEAD[r]).slice(0, 3)); }, Math.max(1500, warmedAt + 8000 - Date.now()));
  }
  const noteAppend = (text) => { const box = $("#nBody"); if (!box) return; box.value = (box.value.trimEnd() ? box.value.trimEnd() + "\n\n" : "") + text; noteTouch(); box.focus(); box.scrollTop = box.scrollHeight; };
  document.addEventListener("input", (e) => { if (e.target.matches && e.target.matches("[data-input=note]")) noteTouch(); });
  async function render() {
    if (note.dirty && token && $("#nBody")) await noteSave(true);
    if (dict.on && !(dict.box && dict.box.isConnected && route() === dict.route)) stopDictation();
    if (!token) return;
    if (mustChange) { renderGate(); return; }
    let r = (location.hash || "#dashboard").slice(1); if (r === "reports") r = "insights"; if (!V[r]) r = "dashboard";
    renderNav(r); $("#nav").classList.remove("open");
    // Team & roles says for itself what someone without it may and may not do, so it is never turned away here.
    if (r !== "team" && !navOk(r)) {
      const html = `<div class="view-head"><div><h1>${esc(navLabel(r))}</h1></div></div><div class="card" id="noAccess"><b>This screen is not open to your sign-in.</b><p class="muted" style="margin:6px 0 0">It needs a permission you do not have. Ask the practice owner, or anyone with Team &amp; roles, if you need it.</p></div>`;
      $("#view").innerHTML = html; shown = r; shownHtml = html; return;
    }
    const my = ++seq, view = $("#view");
    if (!view.innerHTML) view.innerHTML = `<p class="spin">Loading…</p>`;
    const was = visited.indexOf(r); if (was >= 0) visited.splice(was, 1); visited.unshift(r);
    try { const html = await V[r](); if (my !== seq || !token) return; paint(r, html); }
    catch (err) { if (my !== seq || !token) return; shown = ""; shownHtml = ""; view.innerHTML = `<div class="card"><b>This screen could not be loaded.</b><p class="muted" style="margin:6px 0 0">${esc(err.message)}</p></div>`; }
    finally { if (my === seq) { done = my; if (late) changed(); } }
  }
  // ---- Voice dictation into a note box. It uses the browser's own speech recognition: on this device when the
  // browser offers that, otherwise through the browser maker's speech service (Google in Chrome, Apple in Safari).
  // The button says which. Nothing is recorded or kept by this page; only the words land in the box.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const dict = { on: false, rec: null, btn: null, box: null, base: "", said: "", restarts: 0 };
  const micLabel = (btn, on) => { if (!btn || !btn.isConnected) return; btn.classList.toggle("rec", on); btn.setAttribute("aria-pressed", String(on)); btn.innerHTML = ui(on ? "stop" : "mic", 14) + `<span>${on ? "Stop" : "Dictate"}</span>`; };
  function stopDictation(why) {
    if (!dict.on && !dict.rec) return;
    dict.on = false;
    const r = dict.rec; dict.rec = null;
    if (r) { r.onend = null; r.onerror = null; r.onresult = null; try { r.stop(); } catch {} }
    if (dict.box && dict.box.isConnected) dict.box.value = (dict.base + dict.said).replace(/\s+$/, "");
    micLabel(dict.btn, false);
    if (why) toast(why);
  }
  // One listening stretch. Browsers end a stretch after a few seconds of silence or about a minute of speech, so
  // while the button is on, the next stretch starts by itself and the words keep adding to the same box.
  function listen(onDevice) {
    const r = new SR(); dict.rec = r;
    r.lang = "en-US"; r.continuous = true; r.interimResults = true;
    if (onDevice) { try { r.processLocally = true; } catch {} }
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) dict.said += t; else interim += t; }
      if (dict.box.isConnected) { dict.box.value = dict.base + dict.said + interim; dict.box.scrollTop = dict.box.scrollHeight; dict.box.dispatchEvent(new Event("input", { bubbles: true })); /* dictated words autosave like typed ones */ }
      dict.restarts = 0; idleBump(); // speaking counts as activity
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // a pause: onend restarts the stretch
      stopDictation(e.error === "not-allowed" || e.error === "service-not-allowed" ? "The microphone is blocked for this site. Click the lock icon in the address bar, allow the microphone, and press Dictate again."
        : e.error === "audio-capture" ? "No microphone was found. Plug one in or check your sound settings."
        : e.error === "network" ? "This browser's speech service could not be reached. Dictation works in Chrome, Edge and Safari; otherwise use your computer's own dictation key."
        : e.error === "language-not-supported" ? "This browser cannot dictate in English here." : "Dictation stopped (" + e.error + ").");
    };
    r.onend = () => {
      if (!dict.on || dict.rec !== r) return;
      if (!dict.box.isConnected) { stopDictation(); return; }            // the screen changed
      if (++dict.restarts > 40) { stopDictation("Dictation paused after a long silence. Press Dictate to continue."); return; }
      dict.base = (dict.base + dict.said).replace(/\s*$/, " "); dict.said = "";
      setTimeout(() => { if (dict.on) { try { listen(onDevice); } catch { stopDictation("Dictation could not restart. Press Dictate again."); } } }, 250);
    };
    r.start();
  }
  async function dictate(btn) {
    if (dict.on) { const same = dict.btn === btn; stopDictation(); if (same) return; }
    const box = $("#" + btn.dataset.for); if (!box) return;
    if (!SR) { toast("This browser has no voice dictation. Use Chrome, Edge or Safari, or your computer's own dictation key (on a Mac: press the microphone key or Fn twice)."); return; }
    btn.disabled = true;
    try {
      // Ask for the microphone up front, so the browser's permission prompt shows and a refusal is reported plainly
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); }
        catch (err) { toast(err && err.name === "NotFoundError" ? "No microphone was found. Plug one in or check your sound settings." : "The microphone is blocked for this site. Click the lock icon in the address bar, allow the microphone, and press Dictate again."); return; }
      }
      let onDevice = false;
      try { if (typeof SR.available === "function") onDevice = (await SR.available({ langs: ["en-US"], processLocally: true })) === "available"; } catch {}
      Object.assign(dict, { route: route(), on: true, btn, box, base: box.value ? box.value.replace(/\s*$/, " ") : "", said: "", restarts: 0 });
      micLabel(btn, true);
      btn.title = onDevice ? "Listening. Speech is turned into text on this device." : "Listening. Your browser sends the audio to its maker's speech service to turn it into text.";
      listen(onDevice);
      toast(onDevice ? "Listening (on this device). Press Stop when done." : "Listening. Press Stop when done.");
    } catch (err) { stopDictation("Dictation could not start in this browser."); }
    finally { btn.disabled = false; }
  }

  // ---- Built-in video visits and the live room. People knock from /visit; Dr. Jared admits them here.
  // One to one (default): one patient, camera and microphone both ways.
  // Live room: several people. Everyone arrives as a VIEWER (camera and microphone off, sees and hears the host).
  // Bringing someone "into the dock" makes them a SPEAKER: after they agree on their own screen, their camera and
  // microphone turn on and the room sees and hears them. They can be sent back to the audience or removed at any time.
  // Every connection is browser to browser and encrypted by the browsers (WebRTC). This screen holds one connection
  // per person and passes a speaker's picture on to the others itself; the server only carries set-up messages.
  // Chat, the whiteboard and the pain check-in ride private data channels on those same connections.
  const TELE0 = () => ({ call: null, peers: new Map(), local: null, cam: null, screen: null, micOff: false, camOff: false, blur: false, status: "", tick: 0,
    chat: [], chatOpen: false, unread: 0, pain: null, painAsked: false, board: false, scribing: false, scribeRec: null });
  const tele = { waiting: [], invited: [], ice: null, transcript: "", group: false, ...TELE0() };
  const teleIn = () => tele.peers.size > 0;
  const teleSay = (t) => { tele.status = t; const el = $("#teleStatus"); if (el) el.textContent = t; };
  const dcSend = (p, m) => { try { if (p.dc && p.dc.readyState === "open") { p.dc.send(JSON.stringify(m)); return true; } } catch {} return false; };
  const teleSend = (m) => { let n = 0; for (const p of tele.peers.values()) if (dcSend(p, m)) n++; return n > 0; };
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Guest";
  async function teleMedia() {
    if (tele.local) return tele.local;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser cannot use a camera or microphone here.");
    try { tele.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw new Error("Camera and microphone are blocked. Allow them for this site and try again.");
      try { tele.local = await navigator.mediaDevices.getUserMedia({ audio: true }); tele.camOff = true; toast("No camera found. Joining with sound only."); }
      catch { throw new Error("No microphone or camera could be started."); }
    }
    tele.cam = tele.local.getVideoTracks()[0] || null;
    return tele.local;
  }
  function teleScribeStop() { tele.scribing = false; const r = tele.scribeRec; tele.scribeRec = null; if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.stop(); } catch {} } }
  function peerClose(p) { clearTimeout(p.retry); try { if (p.dc) p.dc.close(); } catch {} try { p.pc.close(); } catch {} }
  function teleDrop() {
    clearInterval(tele.tick); teleScribeStop();
    for (const p of tele.peers.values()) peerClose(p);
    for (const s of [tele.local, tele.screen]) if (s) s.getTracks().forEach((t) => t.stop());
    Object.assign(tele, TELE0()); // chat, whiteboard and pain answers go with the visit; a transcript waits for Notes
  }
  function teleOver(msg) { const was = teleIn() || !!tele.call; teleDrop(); teleSay(""); if (was && msg) toast(msg); if (route() === "telehealth") teleMount(); }
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  function teleClock() { const el = $("#teleTimer"); if (!el) return; const s = tele.call ? Math.floor((Date.now() - tele.call.since) / 1000) : 0; el.textContent = mmss(s) + (tele.call && tele.call.minutes && !tele.group ? ` / ${mmss(tele.call.minutes * 60)}` : ""); }

  // What arrives over a person's private channel
  function teleData(m, p) {
    if (!m || typeof m !== "object") return;
    if (m.t === "chat" && typeof m.body === "string") { tele.chat.push({ me: false, name: p.name, body: m.body.slice(0, 1000), at: Date.now() }); if (!tele.chatOpen || route() !== "telehealth") { tele.unread++; toast(`Chat from ${firstName(p.name)}`); } teleMount(); }
    else if (m.t === "pain") { const n = Math.round(Number(m.level)); if (n >= 0 && n <= 10) { tele.pain = tele.peers.size > 1 ? `${firstName(p.name)}: ${n} out of 10` : `${n} out of 10`; toast(`${p.name} reports pain ${n} out of 10`); teleMount(); } }
    else if (m.t === "draw") boardLine($("#teleBoard"), m, "#F0A55B");
    else if (m.t === "reneg") teleOffer(p);                                   // they turned their camera on or off
    else if (m.t === "declined") { toast(`${firstName(p.name)} chose to stay a viewer.`); MDFitRT.emit("tele_role", { clientId: p.id, role: "viewer" }); }
  }
  // Shared whiteboard: lines are sent as fractions of the board's size, so every screen shows the same drawing
  function boardFit(cv) { if (!cv) return; const r = cv.getBoundingClientRect(); if (r.width && (cv.width !== Math.round(r.width) || cv.height !== Math.round(r.height))) { const old = cv.width ? cv.toDataURL() : null; cv.width = Math.round(r.width); cv.height = Math.round(r.height); if (old) { const im = new Image(); im.onload = () => cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); im.src = old; } } }
  function boardLine(cv, m, color) { if (!cv || !Array.isArray(m.a) || !Array.isArray(m.b)) return; boardFit(cv); const g = cv.getContext("2d"); g.strokeStyle = color; g.lineWidth = 3; g.lineCap = "round"; g.beginPath(); g.moveTo(m.a[0] * cv.width, m.a[1] * cv.height); g.lineTo(m.b[0] * cv.width, m.b[1] * cv.height); g.stroke(); }
  function boardClear(cv) { if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); }
  function boardWire(cv) {
    if (!cv || cv.dataset.wired) return; cv.dataset.wired = "1"; let last = null;
    const at = (e) => { const r = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    cv.addEventListener("pointerdown", (e) => { last = at(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener("pointermove", (e) => { if (!last) return; const p = at(e), m = { t: "draw", a: last, b: p }; boardLine(cv, m, "#7AAFD7"); teleSend(m); last = p; });
    const up = () => { last = null; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  }
  // Live transcription: the browser turns Dr. Jared's own speech into text ON THIS DEVICE (never a cloud service),
  // and the text waits here until the visit ends, when it is offered to the AI scribe on the Notes screen.
  async function teleScribe(on) {
    if (!on) { teleScribeStop(); teleMount(); return; }
    if (!SR) { toast("This browser has no speech recognition. Use Chrome, Edge or Safari for live transcription."); teleMount(); return; }
    // First choice: recognition that runs on this computer, so no sound leaves it. Some browsers have to fetch a
    // language pack for that once.
    let state = "unavailable";
    try { if (typeof SR.available === "function") state = await SR.available({ langs: ["en-US"], processLocally: true }); } catch {}
    if ((state === "downloadable" || state === "downloading") && typeof SR.install === "function") {
      toast("Getting this browser's on-device speech pack (one time). Transcription starts when it is ready.");
      try { if (await SR.install({ langs: ["en-US"], processLocally: true })) state = "available"; } catch {}
    }
    let local = state === "available";
    // Otherwise the browser's own speech service can do it, but that sends the microphone's sound to the browser's
    // maker. That is the owner's call, asked every time, never assumed.
    if (!local && !confirm("This browser cannot transcribe on this computer.\n\nUse the browser's speech service instead? The sound from YOUR microphone is sent to the browser's maker (Google for Chrome, Apple for Safari) to be turned into text. MD Fit has no privacy agreement with them. The patient's side of the call is not sent.\n\nPress Cancel to leave transcription off.")) { toast("Transcription was left off. No audio left this computer."); teleMount(); return; }
    if (!teleIn()) { teleMount(); return; }
    tele.scribing = true; tele.scribeLocal = local;
    const go = () => {
      if (!tele.scribing || !teleIn()) return;
      const r = new SR(); tele.scribeRec = r; r.lang = "en-US"; r.continuous = true; r.interimResults = false;
      if (tele.scribeLocal) { try { r.processLocally = true; } catch {} }
      r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) tele.transcript += e.results[i][0].transcript.trim() + " "; const n = $("#teleWords"); if (n) n.textContent = `${tele.transcript.trim().split(/\s+/).filter(Boolean).length} words so far`; };
      r.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") { teleScribeStop(); toast("Live transcription stopped (" + e.error + ")."); teleMount(); } };
      r.onend = () => { if (tele.scribing && tele.scribeRec === r) setTimeout(go, 250); };
      try { r.start(); } catch { teleScribeStop(); }
    };
    go(); teleMount();
  }
  async function teleBlur() {
    const t = tele.cam; if (!t) return;
    const cap = t.getCapabilities ? t.getCapabilities() : {};
    if (!cap.backgroundBlur || !cap.backgroundBlur.includes(true) || !cap.backgroundBlur.includes(false)) { toast(cap.backgroundBlur && cap.backgroundBlur.includes(true) ? "Background blur is controlled by your computer's camera settings on this device." : "Background blur is not available with this camera or browser."); return; }
    try { await t.applyConstraints({ backgroundBlur: !tele.blur }); tele.blur = !tele.blur; teleMount(); } catch { toast("Background blur could not be changed."); }
  }
  // This side makes every offer, the first one and any later one (a speaker's picture added or taken away, a path
  // being found again). If one is already under way, the next waits for it to finish.
  async function teleOffer(p) {
    if (!tele.peers.has(p.id)) return;
    if (p.offering || p.pc.signalingState !== "stable") { p.again = true; return; }
    p.offering = true; p.again = false;
    try { await p.pc.setLocalDescription(await p.pc.createOffer()); MDFitRT.emit("tele_signal", { to: p.id, sdp: p.pc.localDescription }); }
    catch (err) { teleSay("Set-up problem: " + err.message); }
    finally { p.offering = false; }
  }
  // Who sees whom. In a live room every person is sent the pictures of the speakers in the dock (never their own,
  // never a viewer's). One to one, nothing is passed on. Then each person is told who is in the dock.
  function teleRelay() {
    const speakers = tele.group ? [...tele.peers.values()].filter((s) => s.role === "speaker") : [];
    for (const p of tele.peers.values()) {
      const want = new Map();
      for (const s of speakers) if (s !== p) for (const t of s.remote.getTracks()) want.set(t.id, [t, s.remote]);
      for (const [tid, sender] of p.fwd) if (!want.has(tid)) { try { p.pc.removeTrack(sender); } catch {} p.fwd.delete(tid); }
      for (const [tid, [t, st]] of want) if (!p.fwd.has(tid)) { try { p.fwd.set(tid, p.pc.addTrack(t, st)); } catch {} }
      dcSend(p, { t: "room", group: tele.group, role: p.role, watching: tele.peers.size, dock: speakers.filter((s) => s !== p).map((s) => ({ sid: s.remote.id, name: firstName(s.name) })) });
    }
  }
  function teleState() {
    const all = [...tele.peers.values()], up = all.filter((p) => p.state === "connected").length;
    if (!all.length) return teleSay("");
    if (all.length === 1) { const s = all[0].state; return teleSay(s === "connected" ? "Connected, encrypted browser to browser" : s === "disconnected" ? "Connection interrupted. Trying to recover…" : s === "retry" ? "Connection lost. Reconnecting…" : s === "failed" ? "Could not connect: one of the two networks blocks direct video. Ask the patient to try another network." : "Connecting…"); }
    const bad = all.filter((p) => p.state === "failed").map((p) => firstName(p.name));
    teleSay(`${up} of ${all.length} connected, each encrypted browser to browser${bad.length ? ". Could not reach: " + bad.join(", ") : ""}`);
  }
  async function teleBegin(ev) {
    try {
      if (!tele.ice) tele.ice = (await get("/telehealth/ice")).iceServers || [];
      const stream = await teleMedia();
      if (!tele.call) {
        tele.call = { since: Date.now(), minutes: Number(ev.minutes) || 0 }; tele.transcript = "";
        clearInterval(tele.tick); tele.tick = setInterval(() => { teleClock(); idleBump(); /* a visit counts as activity */ }, 1000);
      }
      const pc = new RTCPeerConnection({ iceServers: tele.ice });
      const p = { id: ev.clientId, name: ev.name || "Patient", visit: ev.visit || "", role: ev.role === "viewer" ? "viewer" : "speaker", pc, dc: null, remote: new MediaStream(), queue: [], fwd: new Map(), camSender: null, state: "connecting", offering: false, again: false, retry: 0, tries: 0 };
      tele.peers.set(p.id, p);
      const dc = pc.createDataChannel("visit"); p.dc = dc;
      dc.onmessage = (e) => { try { teleData(JSON.parse(e.data), p); } catch {} };
      dc.onopen = () => { teleRelay(); if (tele.board) dcSend(p, { t: "board", on: true }); teleMount(); }; dc.onclose = () => teleMount();
      stream.getTracks().forEach((t) => { const s = pc.addTrack(t, stream); if (t.kind === "video") p.camSender = s; });
      if (tele.screen && p.camSender) p.camSender.replaceTrack(tele.screen.getVideoTracks()[0]).catch(() => {});
      pc.ontrack = (e) => { if (!p.remote.getTracks().includes(e.track)) p.remote.addTrack(e.track); e.track.onunmute = () => { teleRelay(); teleMount(); }; e.track.onmute = () => teleMount(); teleRelay(); teleMount(); };
      pc.onicecandidate = (e) => { if (e.candidate) MDFitRT.emit("tele_signal", { to: p.id, candidate: e.candidate }); };
      pc.onnegotiationneeded = () => teleOffer(p);
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState; clearTimeout(p.retry);
        if (s === "connected") { p.tries = 0; p.state = "connected"; }
        else if (s === "connecting") p.state = "connecting";
        else if (s === "disconnected") { p.state = "disconnected"; p.retry = setTimeout(() => { if (tele.peers.get(p.id) === p && pc.connectionState === "disconnected") { try { pc.restartIce(); } catch {} } }, 4000); }
        else if (s === "failed") { if (p.tries++ < 2) { p.state = "retry"; try { pc.restartIce(); } catch {} } else p.state = "failed"; }
        teleState(); teleMount();
      };
      teleState();
      if (route() === "telehealth") teleMount(); else toast(`${p.name} joined the video visit. Open Telehealth to see it.`);
    } catch (err) { MDFitRT.emit("tele_end", tele.peers.size > 1 ? { clientId: ev.clientId } : undefined); if (tele.peers.size <= 1) teleOver(""); toast(err.message); }
  }
  async function teleSignal(d) {
    if (!d) return;
    const p = d.from !== undefined ? tele.peers.get(String(d.from)) : (tele.peers.size === 1 ? [...tele.peers.values()][0] : null);
    if (!p) return;
    try {
      if (d.sdp) { await p.pc.setRemoteDescription(d.sdp); for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {}); if (p.again) teleOffer(p); }
      else if (d.candidate) { if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.candidate).catch(() => {}); else p.queue.push(d.candidate); }
    } catch (err) { teleSay("Set-up problem: " + err.message); }
  }
  // Someone left or was removed; the room carries on for the others
  function teleLeft(ev) {
    const p = ev && tele.peers.get(String(ev.clientId)); if (!p) return;
    peerClose(p); tele.peers.delete(p.id);
    if (tele.peers.size) { toast(ev.why === "removed" ? `${firstName(p.name)} was removed.` : `${firstName(p.name)} left.`); teleRelay(); teleState(); teleMount(); }
  }
  async function teleShare() {
    if (!teleIn()) return;
    const senders = [...tele.peers.values()].map((p) => p.camSender).filter(Boolean);
    if (tele.screen) { tele.screen.getTracks().forEach((t) => t.stop()); tele.screen = null; if (tele.cam) for (const s of senders) await s.replaceTrack(tele.cam).catch(() => {}); teleMount(); return; }
    if (!senders.length) { toast("Screen sharing needs a camera connection in this visit."); return; }
    try {
      tele.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = tele.screen.getVideoTracks()[0];
      track.onended = () => { if (tele.screen) teleShare(); };
      for (const s of senders) await s.replaceTrack(track).catch(() => {});
      teleMount();
    } catch { tele.screen = null; }
  }
  // Ending a visit: if words were transcribed, they go to the Notes screen for the scribe (held in this page only)
  function teleFinish() {
    const text = tele.transcript.trim(), only = tele.peers.size === 1 ? [...tele.peers.keys()][0] : null;
    MDFitRT.emit("tele_end"); teleOver("");
    if (text) { state.scribeText = text; tele.transcript = ""; if (only) state.chartClient = only; toast("Visit ended. Your transcript is on the Notes screen."); location.hash = "notes"; }
    else toast("Visit ended.");
  }
  // Puts the current state on the Telehealth screen without redrawing it (the videos must not be torn down)
  function teleMount() {
    const stage = $("#teleStage"); if (!stage) return;
    const all = [...tele.peers.values()], shown = all.filter((p) => !tele.group || p.role === "speaker");
    const grid = $("#teleGrid"), key = shown.map((p) => p.id).join(",");
    if (grid.dataset.key !== key) {
      grid.dataset.key = key; grid.style.setProperty("--n", String(Math.max(1, Math.ceil(Math.sqrt(shown.length)))));
      grid.innerHTML = shown.map((p) => `<div class="tile" data-peer="${esc(p.id)}"><video autoplay playsinline></video>${shown.length > 1 || tele.group ? `<span>${esc(p.name)}</span>` : ""}</div>`).join("");
    }
    shown.forEach((p) => { const v = grid.querySelector(`[data-peer="${p.id.replace(/[^\w-]/g, "")}"] video`); if (v && v.srcObject !== p.remote) v.srcObject = p.remote; });
    const l = $("#teleLocal"), mine = tele.screen || tele.local; if (l && l.srcObject !== mine) l.srcObject = mine;
    const live = shown.some((p) => p.remote.getVideoTracks().some((t) => !t.muted) || p.state === "connected");
    stage.classList.toggle("live", teleIn()); stage.classList.toggle("room", tele.group && teleIn()); stage.classList.toggle("has-remote", shown.length > 0 && live); stage.classList.toggle("boarding", tele.board);
    const one = all.length === 1 && !tele.group ? all[0] : null;
    $("#teleWho").textContent = one ? `${one.name}${one.visit ? " · " + one.visit : ""}` : teleIn() ? `Live room · ${all.length} ${all.length === 1 ? "person" : "people"} · ${all.filter((p) => p.role === "speaker").length} in the dock` : "";
    $("#teleAvatarName").textContent = one ? one.name : teleIn() ? `${all.length} watching · nobody in the dock yet` : "";
    $("#teleIdle").hidden = teleIn(); $("#teleControls").hidden = !teleIn();
    // Round icon buttons, filled while the thing is on
    const set = (id, on, labelOn, labelOff) => { const el = $(id); if (el) { el.classList.toggle("on", on); el.setAttribute("aria-pressed", String(on)); el.setAttribute("aria-label", on ? labelOn : labelOff); el.title = on ? labelOn : labelOff; } };
    set("#teleMic", !tele.micOff, "Microphone on. Press to mute", "Muted. Press to unmute");
    set("#teleCam", !!tele.cam && !tele.camOff, "Camera on. Press to turn off", "Camera off. Press to turn on");
    set("#teleShare", !!tele.screen, "Sharing your screen. Press to stop", "Share your screen");
    set("#teleBoardBtn", tele.board, "Whiteboard open. Press to close", "Open the whiteboard");
    set("#teleBlurBtn", tele.blur, "Background blurred. Press to show it", "Blur your background");
    set("#teleChatBtn", tele.chatOpen, "Chat open. Press to close", tele.unread ? `Open chat, ${tele.unread} new` : "Open chat");
    set("#teleScribeBtn", tele.scribing, tele.scribeLocal ? "Transcribing on this device. Press to stop" : "Transcribing your microphone with the browser's speech service. Press to stop", "Transcribe for the AI scribe");
    const dot = $("#teleChatDot"); if (dot) dot.hidden = !tele.unread;
    const sw = $("#teleScribeSw"); if (sw) { sw.checked = tele.scribing; sw.disabled = !teleIn(); }
    const words = $("#teleWords"); if (words) words.textContent = tele.scribing ? `${tele.transcript.trim().split(/\s+/).filter(Boolean).length} words so far · ${tele.scribeLocal ? "on this device" : "your microphone, via the browser's speech service"}` : teleIn() ? "Off" : "Starts with a visit";
    for (const id of ["#teleCam", "#teleBlurBtn"]) if ($(id)) $(id).disabled = !tele.cam;
    const open = all.some((p) => p.dc && p.dc.readyState === "open");
    for (const id of ["#teleBoardBtn", "#teleChatBtn", "#telePainBtn"]) if ($(id)) $(id).disabled = !open;
    const pain = $("#telePain"); if (pain) pain.textContent = tele.pain !== null ? tele.pain : tele.painAsked ? "Asked, waiting" : "";
    const gs = $("#teleGroupSw"); if (gs) { gs.checked = tele.group; gs.disabled = tele.group && all.length > 0; }
    const ppl = $("#telePeople"); if (ppl) ppl.textContent = tele.group ? "Live room: people join as viewers, camera and microphone off, until you make them a speaker" : "One to one · private";
    const cv = $("#teleBoard"); if (cv) { cv.hidden = !tele.board; if (tele.board) { boardFit(cv); boardWire(cv); } }
    const clr = $("#teleClear"); if (clr) clr.hidden = !tele.board;
    const box = $("#teleChatBox");
    if (box) {
      box.hidden = !(tele.chatOpen && teleIn());
      const list = $("#teleChatList"), stick = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.innerHTML = tele.chat.map((m) => `<div class="bubble ${m.me ? "me" : ""}">${!m.me && all.length > 1 ? `<b style="font-size:11.5px;display:block">${esc(firstName(m.name))}</b>` : ""}${esc(m.body)}</div>`).join("") || `<p class="muted" style="margin:0;font-size:12.5px">${tele.group ? "What you write goes to everyone in the room. What a person writes comes only to you. Nothing is saved." : "Messages here go straight between the two of you and disappear when the visit ends."}</p>`;
      if (stick) list.scrollTop = list.scrollHeight;
    }
    // Who is in the room, and the dock controls
    const rm = $("#teleRoomCard"), rl = $("#teleRoom");
    if (rm) {
      rm.hidden = !teleIn();
      rl.innerHTML = all.map((p) => `<div class="list-item" style="flex-wrap:wrap;row-gap:6px"><span style="flex:1 1 120px;min-width:0;overflow-wrap:anywhere"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${p.state === "connected" ? "Connected" : p.state === "failed" ? "Could not connect" : "Connecting…"}</div>${devLine((cache.devices || {})[p.id])}</span>
        <span class="pill ${p.role === "speaker" ? "ok" : p.asking ? "warn" : ""}">${!tele.group ? "In the visit" : p.role !== "speaker" ? (p.asking ? "Asks to speak" : "Viewer") : p.remote.getTracks().some((t) => !t.muted && t.readyState === "live") ? "Speaker" : p.byHost ? "Invited to speak" : "Coming on screen"}</span>
        ${tele.group ? `<button type="button" class="btn sm${p.role === "speaker" ? "" : " primary"}" data-act="teleRole" data-id="${esc(p.id)}" data-role="${p.role === "speaker" ? "viewer" : "speaker"}">${p.role === "speaker" ? "Make viewer" : p.asking ? `${ui("broadcast", 14)}Admit` : "Make speaker"}</button>${p.asking && p.role !== "speaker" ? `<button type="button" class="btn sm" data-act="teleRole" data-id="${esc(p.id)}" data-role="viewer">Not now</button>` : ""}` : ""}
        ${all.length > 1 || tele.group ? `<button type="button" class="btn sm ghost" data-act="teleKick" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from the room">${ui("x", 14)}</button>` : ""}</div>`).join("");
      const rc = $("#teleRoomCount"); if (rc) rc.textContent = tele.group ? `${all.length} in the room` : "One to one";
    }
    teleSay(tele.status); teleClock();
    const w = $("#teleWaiting"), canAdmit = true; // in a private visit, Admit asks before opening it to more people
    if (w) w.innerHTML = tele.waiting.map((p) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(p.visit || "No video visit booked today")} · waiting ${Math.max(0, Math.round((Date.now() - p.since) / 60000))} min</div>${devLine(p.device || (cache.devices || {})[p.clientId])}</span><button class="btn sm primary" data-act="teleAdmit" data-id="${esc(p.clientId)}"${canAdmit ? "" : " disabled"}>Admit</button><button class="btn sm ghost" data-act="teleDecline" data-id="${esc(p.clientId)}" aria-label="Turn away ${esc(p.name)}">${ui("x", 14)}</button></div>`).join("") || none(MDFitRT && MDFitRT.connected() ? "Nobody is waiting. People appear here when they open the session link." : "Not connected to the live service. Reload the page.");
    const pend = $("#telePending"); if (pend) pend.innerHTML = tele.invited.map((p) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">invited ${Math.max(0, Math.round((Date.now() - p.at) / 60000))} min ago · let in on arrival</div></span><span class="pill warn">Pending</span><button class="btn sm ghost" data-act="teleUninvite" data-id="${esc(p.clientId)}" aria-label="Withdraw the invitation to ${esc(p.name)}">${ui("x", 14)}</button></div>`).join("");
    const n = $("#teleCount"); if (n) { n.textContent = tele.waiting.length ? `${tele.waiting.length} waiting` : tele.invited.length ? `${tele.invited.length} pending` : "Empty"; n.className = "pill" + (tele.waiting.length ? " ok" : tele.invited.length ? " warn" : ""); }
  }

  // ---- Install app: the workspace as its own app window. Nothing about patients is kept by installing; the app
  // still asks for the sign-in and still signs out after 15 idle minutes.
  {
    const btn = $("#installBtn"); let offer = null;
    const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); offer = e; if (!standalone()) btn.hidden = false; });
    window.addEventListener("appinstalled", () => { offer = null; btn.hidden = true; toast("MD Fit Admin is installed."); });
    if (ios && !standalone()) btn.hidden = false;
    btn.addEventListener("click", async () => {
      if (offer) { offer.prompt(); const r = await offer.userChoice.catch(() => null); offer = null; if (r && r.outcome === "accepted") btn.hidden = true; return; }
      toast(ios ? "To install: tap the Share button, then \"Add to Home Screen\"." : "To install: open your browser's menu and choose \"Install MD Fit Admin\" or \"Add to Home Screen\".");
    });
  }

  // ---- Live updates. The server pushes "new_message" the moment a member writes, so the Messages screen and the
  // unread badge update without a reload. If the live connection is down, the open Messages screen checks every 15 s.
  async function refreshMessages(toBottom) {
    const box = $(".composer input[name=body]"), draft = box ? box.value : "", focused = !!box && document.activeElement === box;
    const l0 = $("#msgList"), wasAtBottom = !l0 || l0.scrollHeight - l0.scrollTop - l0.clientHeight < 60;
    await render();
    const box2 = $(".composer input[name=body]"); if (box2) { if (draft) box2.value = draft; if (focused) box2.focus(); }
    const l = $("#msgList"); if (l && (toBottom || wasAtBottom)) l.scrollTop = l.scrollHeight;
  }
  const route = () => (location.hash || "#dashboard").slice(1);
  let liveWired = false;
  function goLive() {
    if (!window.MDFitRT) return;
    MDFitRT.connect({ namespace: "/admin", token });
    if (liveWired) return; liveWired = true;
    MDFitRT.on("new_message", (ev) => {
      if (!token) return;
      forget();
      if (route() === "messages" && !$("#modalBack").classList.contains("open")) refreshMessages();
      else { cache.unread = (cache.unread || 0) + 1; renderNav(route()); toast(`New message from ${(ev && ev.clientName) || "a member"}`); }
    });
    MDFitRT.on("message_reaction", (ev) => { forget(); if (token && route() === "messages" && ev && ev.clientId === state.thread) refreshMessages(); });
    MDFitRT.on("tele_waiting", (ev) => {
      const had = new Set(tele.waiting.map((p) => p.clientId)); tele.waiting = (ev && ev.waiting) || []; tele.invited = (ev && ev.invited) || [];
      const fresh = tele.waiting.find((p) => !had.has(p.clientId));
      // the server is the record of the room's mode and of who is a viewer or a speaker
      tele.group = !!(ev && ev.group); let moved = false;
      tele.roomIds = new Set(((ev && ev.room) || []).map((m) => m.clientId));
      for (const m of (ev && ev.room) || []) { const p = tele.peers.get(m.clientId); if (!p) continue; if (p.role !== m.role) { p.role = m.role; moved = true; }
        if (m.asking && !p.asking && token) toast(`${firstName(p.name)} asks to speak. ${route() === "telehealth" ? "Press Admit to bring them on screen." : "Open Telehealth to admit them."}`); p.asking = !!m.asking; }
      if (moved) teleRelay();
      if (route() === "telehealth") teleMount(); else if (fresh && token) toast(`${fresh.name} is in the video waiting room`);
    });
    MDFitRT.on("tele_started", (ev) => { if (token) teleBegin(ev || {}); });
    MDFitRT.on("tele_signal", (d) => teleSignal(d));
    MDFitRT.on("tele_left", (ev) => teleLeft(ev));
    MDFitRT.on("tele_ended", (ev) => teleOver(ev && ev.why === "patient_left" ? "The patient left the visit." : ev && ev.why === "staff_left" ? "The visit ended: this page lost its connection." : "Visit ended."));
    MDFitRT.on("tele_error", (ev) => { if (ev && ev.error) toast(ev.error); });
    // The connection to the server came back during a visit (a restart, or a network blip). Sound and picture go
    // browser to browser, so the visit is still running: tell the server who it is with so it can pick the room back
    // up. Anyone the server has not put back after half a minute is treated as gone.
    document.addEventListener("mdfit:connected", () => {
      if (!token || !teleIn()) return;
      MDFitRT.emit("tele_resume", { group: tele.group, people: [...tele.peers.values()].map((p) => ({ clientId: p.id, role: p.role })) });
      clearTimeout(tele.resumeT);
      tele.resumeT = setTimeout(() => { for (const p of [...tele.peers.values()]) if (!(tele.roomIds && tele.roomIds.has(p.id))) { toast(`The connection dropped and ${firstName(p.name)}'s visit could not be picked back up. They can rejoin from the waiting room.`); if (tele.peers.size === 1) teleOver(""); else teleLeft({ clientId: p.id, why: "lost" }); } }, 30000);
    });
    // The dot on the refresh button: green while the live connection is up, amber while it is not. When it comes
    // back after being down, anything that happened meanwhile was missed, so what is in memory is thrown away and
    // the screen is redrawn from the server (never underneath something being typed).
    let wasDown = false, liveSaid = "";
    document.addEventListener("mdfit:disconnected", () => { wasDown = true; liveDot(); });
    document.addEventListener("mdfit:connected", () => { liveDot(); if (wasDown && token) { wasDown = false; forget(); changed(); MDFitRT.emit("tele_list"); } });
    document.addEventListener("mdfit:rt-error", (e) => { liveDot(); if (!token || liveSaid === token || !/token|admin|log in/i.test((e.detail && e.detail.message) || "")) return; liveSaid = token;
      // The owner's sign-in is always accepted, so a refusal means it has gone stale. For staff it can mean live updates are not open to staff sign-ins on this server.
      load("/me").catch(() => null).then((me) => { if (token) toast(me && me.isOwner ? "The live connection was refused. Sign out and in again to restore live updates." : "Live updates are not running for this sign-in. The screens still load: press Refresh to see what is new."); }); });
    MDFitRT.on("tele_invited", (ev) => { if (ev) toast(`${firstName(ev.name || "They")} was invited: ${ev.emailed ? "emailed and " : ""}notified in the app. They are let in when they arrive.`); });
    // A patient paid after the time they were holding went to someone else (the owner is told; nothing is booked over)
    MDFitRT.on("activity", (ev) => {
      if (!token || !ev || ev.type !== "visit_paid_time_taken") return;
      forget(); toast(`${LOST}${ev.when ? " (" + ev.when + ")" : ""}. It is on the dashboard.`);
      if (["dashboard", "calendar"].includes(route()) && !$("#modalBack").classList.contains("open")) render();
    });
    // The server ended this sign-in (the account was switched off, what it may do was changed, or it ran out)
    MDFitRT.on("signed_out", () => { if (!token) return; signOut(); $("#siMsg").textContent = "You were signed out: this sign-in ended, or what it may do was changed. Sign in again."; });
    MDFitRT.on("calendar_changed", () => { forget(); if (token && route() === "calendar" && !$("#modalBack").classList.contains("open")) render(); });
    setInterval(() => { if (token && route() === "messages" && !document.hidden && !MDFitRT.connected() && !$("#modalBack").classList.contains("open")) { forget(); refreshMessages(); } }, 15000);
  }
  function liveDot() { const d = $("#liveDot"), up = !!(window.MDFitRT && MDFitRT.connected()); if (d) d.classList.toggle("off", !up); const b = $("#refreshBtn"); if (b) { const t = up ? "Refresh · live connection on" : "Refresh · live connection is reconnecting"; b.title = t; b.setAttribute("aria-label", t); } }
  $("#refreshBtn").addEventListener("click", () => { if (token) guard(ACT.refresh)(); });
  setInterval(liveDot, 5000);
  async function start() {
    $("#signin").hidden = true; $("#app").hidden = false; idleArm(); goLive();
    const tk = token;
    // Who is signed in and what they may do is known before the first screen is drawn, so the menu never shows a
    // screen this person cannot open and a password that is not theirs yet stops everything else.
    try { cache.me = await get("/me"); } catch { cache.me = null; }
    if (!token || tk !== token) return;
    if (cache.me) $("#whoami").textContent = cache.me.email;
    { // Manager and Developer staff (and the owner) can step across to their console without signing in again
      const roles = (cache.me && (cache.me.roles || [cache.me.role])) || [], owner = !!(cache.me && cache.me.isOwner);
      const links = [[["manager"], "/manager", "mdfit_manager", "Manager"], [["manager", "developer"], "/dev", "mdfit_dev", "Developer"]].filter(([need, , key]) => owner || (need.some((r) => roles.includes(r)) && (key !== "mdfit_manager" || can("partner"))));
      const full = owner || roles.includes("admin");   // Admin is the whole workspace; Client portal is its client-management screens
      const box = $("#portals");
      if (box) { box.innerHTML = links.length ? `<nav class="pseg" aria-label="Switch console">${full ? `<a href="#dashboard" data-side="admin">Admin</a>` : ""}${links.map(([, href, key, label]) => `<a href="${href}" data-portal="${key}">${label}</a>`).join("")}<a href="#clients" data-side="cmp"${full ? "" : " data-only"}>Client portal</a></nav>` : ""; box.hidden = !links.length; markSide(); }
    }
    mustChange = !!(cache.me && cache.me.mustChangePassword);
    if (mustChange) { renderGate(); return; }
    $("#qa").hidden = !qaMine().length; $("#globalSearch").disabled = !can("clients");
    render().then(() => setTimeout(() => { if (token && tk === token) { warmedAt = Date.now(); warm(["clients", "calendar", "dashboard", "messages", "chart", "telehealth", "notes", "leads", "forms", "payments", ...WARM.filter((r) => !["clients", "calendar", "dashboard", "leads", "forms", "payments"].includes(r)), "economics", "guide"]); } }, 600));
  }
  window.addEventListener("pointerdown", () => { lastTouch = Date.now(); }, true);
  window.addEventListener("keydown", () => { lastTouch = Date.now(); }, true);
  window.addEventListener("hashchange", () => { if (location.hash !== "#chart") {} render(); });
  $("#navToggle").addEventListener("click", () => $("#nav").classList.toggle("open"));
  // Light is the default on every device; dark is a choice, remembered on this device (a display setting, no patient data)
  const THEME_KEY = "workspace-theme";
  try { if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark"; } catch {}
  $("#themeBtn").addEventListener("click", () => { const r = document.documentElement, next = r.dataset.theme === "dark" ? "light" : "dark"; r.dataset.theme = next; try { localStorage.setItem(THEME_KEY, next); } catch {} });
  $("#modalBack").addEventListener("click", (e) => { if (e.target.id === "modalBack") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  // Top search: every match is listed as you type (all the people with that name, not only the first), newest
  // sign-in first among equals. Enter or a click opens the chart; the arrow keys move; Escape clears.
  const gRes = $("#globalRes"); let gList = [], gAt = 0, gMore = 0;
  const gWords = (v) => v.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const gClose = () => { gRes.hidden = true; gRes.innerHTML = ""; gList = []; gAt = 0; $("#globalSearch").setAttribute("aria-expanded", "false"); };
  const gDraw = () => {
    gRes.innerHTML = gList.map((c, i) => `<button type="button" role="option" aria-selected="${i === gAt}" class="${i === gAt ? "on" : ""}" data-act="searchOpen" data-id="${esc(c.id)}">${avatar(c.name, 28)}<span style="min-width:0;flex:1"><b>${esc(c.name)}</b><span class="muted" style="display:block;font-size:12px;overflow-wrap:anywhere">${esc(c.email)}${c.phone ? " · " + esc(c.phone) : ""}</span></span></button>`).join("")
      + (gList.length ? (gMore ? `<p class="muted" style="margin:6px 10px;font-size:12px">${gMore} more. Keep typing to narrow it down.</p>` : "") : `<p class="muted" style="margin:8px 10px">No client matches.</p>`);
    gRes.hidden = false; $("#globalSearch").setAttribute("aria-expanded", "true");
  };
  $("#globalSearch").addEventListener("input", guard(async (e) => {
    if (!token) return;
    const words = gWords(e.target.value); if (!words.length) return gClose();
    const list = await clientsHit((l) => l.some((c) => words.every((w) => `${c.name} ${c.email} ${c.phone || ""}`.toLowerCase().includes(w))), e.target);
    if (gWords($("#globalSearch").value).join(" ") !== words.join(" ")) return; // they kept typing while the list loaded
    const hit = list.filter((c) => words.every((w) => `${c.name} ${c.email} ${c.phone || ""}`.toLowerCase().includes(w)));
    const starts = (c) => (String(c.name || "").toLowerCase().split(/\s+/).some((part) => part.startsWith(words[0])) ? 0 : 1);
    hit.sort((a, b) => starts(a) - starts(b) || String(a.name).localeCompare(String(b.name)));
    gMore = Math.max(0, hit.length - 30); gList = hit.slice(0, 30); gAt = 0; gDraw();
  }));
  $("#globalSearch").addEventListener("keydown", guard(async (e) => {
    if (!token) return;
    if (e.key === "Escape") { e.target.value = ""; return gClose(); }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && gList.length) { e.preventDefault(); gAt = (gAt + (e.key === "ArrowDown" ? 1 : gList.length - 1)) % gList.length; gDraw(); const on = gRes.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" }); return; }
    if (e.key !== "Enter") return;
    const words = gWords(e.target.value); if (!words.length) return;
    const c = gList[gAt] || (await clients()).find((x) => words.every((w) => `${x.name} ${x.email}`.toLowerCase().includes(w)));
    if (c) { e.target.value = ""; gClose(); openChart(c.id); } else toast("No client matches that.");
  }));
  $("#globalSearch").addEventListener("focus", (e) => { if (gWords(e.target.value).length && gRes.hidden) e.target.dispatchEvent(new Event("input")); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) gClose(); });
  ACT.searchOpen = (el) => { $("#globalSearch").value = ""; gClose(); openChart(el.dataset.id); };
  // ---- Revenue share (owner)
  // The manager's terms are preset by the agreement. Changing any of them asks for the owner password each time,
  // the way a subscription asks you to sign in again before you change it. The password is sent with that one
  // request and kept nowhere.
  function askOwnerPassword(what) {
    return new Promise((resolve) => {
      modal(`<div class="card-head"><h2>Owner password</h2><button type="button" class="btn sm" data-pw="cancel">Cancel</button></div>
        <p class="muted" style="margin:0 0 10px">${esc(what)} These terms are set by the agreement, so changing them needs the owner password.</p>
        <form id="pwAsk" class="stack"><div class="field"><label for="pwAskIn">Owner password</label><input id="pwAskIn" class="input" type="password" autocomplete="current-password" required></div>
        <div class="row"><button class="btn primary">Confirm change</button></div></form>`);
      const done = (v) => { closeModal(); resolve(v); };
      $("#pwAsk").addEventListener("submit", (e) => { e.preventDefault(); e.stopPropagation(); const v = $("#pwAskIn").value; done(v || null); });
      $('[data-pw="cancel"]').addEventListener("click", () => done(null));
      $("#pwAskIn").focus();
    });
  }
  async function rsChange(what, body) {
    const password = await askOwnerPassword(what);
    if (!password) { toast("Nothing was changed."); return false; }
    await api("PUT", "/api/admin/partner-share/settings", { ...body, password });
    return true;
  }
  // ===================== Compliance (45 CFR Part 164 and Florida): DO NOT TOUCH after compliancy is set =====================
  // The checklist is worked out by the server from what the system is doing right now (lib/compliance.js); this
  // screen shows it and holds the records behind it. See README.md before changing anything here.
  const CP_TABS = [["checklist", "Checklist"], ["requests", "Patient requests"], ["incidents", "Incidents"], ["registers", "Registers"], ["review", "Audit review"], ["settings", "Settings"]];
  const cpPill = (s) => (s === "met" ? `<span class="pill ok">Met</span>` : s === "action" ? `<span class="pill warn">Needs you</span>` : `<span class="pill bad">Not met</span>`);
  const cpDate = (d) => (d ? esc(String(d).slice(0, 10)) : "—");
  const cpTable = (head, rows, empty) => (rows.length ? `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : `<div style="padding:14px 16px">${none(empty)}</div>`);
  const cpCard = (title, inner, side = "") => `<div class="card" style="padding:0;margin-bottom:16px"><div class="card-head" style="padding:14px 16px 0"><h2>${title}</h2>${side}</div>${inner}</div>`;
  V.compliance = async () => {
    const tab = CP_TABS.some(([t]) => t === state.cpTab) ? state.cpTab : "checklist";
    const tabs = `<div class="tabs" role="tablist">${CP_TABS.map(([t, l]) => `<button class="tab ${tab === t ? "active" : ""}" role="tab" data-act="cpTab" data-tab="${t}">${l}</button>`).join("")}</div>`;
    const head = `<div class="view-head"><div><h1>Compliance</h1><p class="muted">HIPAA and Florida requirements, each checked against what the system is doing right now</p></div></div>${tabs}`;
    if (tab === "checklist") {
      const c = await load("/compliance/checklist"), s = c.summary;
      const tile = (n, label, cls) => `<div class="card"><div class="muted" style="font-size:12px">${label}</div><div style="font-size:26px;font-weight:700" class="${cls}">${n}</div></div>`;
      return `${head}<div class="grid g3" style="margin-bottom:16px">${tile(`${s.met} of ${s.total}`, "Met", "")}${tile(s.action, "Need you", "")}${tile(s.notmet, "Not met", "")}</div>
        ${cpCard("Requirements", cpTable(["Status", "Requirement", "Where it stands", ""], c.rows.map((r) => `<tr data-cp-row="${esc(r.id)}"><td>${cpPill(r.status)}</td><td><b>${esc(r.title)}</b><div class="muted" style="font-size:12px">${esc(r.rule)}</div></td>
          <td>${esc(r.detail)}${r.todo ? `<div style="margin-top:4px"><b>To do:</b> ${esc(r.todo)}</div>` : ""}</td><td>${r.go && r.status !== "met" ? `<button class="btn sm" data-act="cpGo" data-go="${esc(r.go)}">Open</button>` : ""}</td></tr>`), "Nothing to show."),
          `<span class="muted" style="font-size:12px">Checked ${esc(new Date(c.generatedAt).toLocaleString())}</span>`)}
        <p class="muted" style="font-size:12.5px">This list covers what the software can check or hold a record of. It is not legal advice, and it does not replace your own written policies or your attorney's review.</p>`;
    }
    if (tab === "requests") {
      const [am, dis, npp] = await Promise.all([load("/amendments"), load("/disclosures"), load("/compliance/npp")]);
      const amRow = (a) => `<tr><td><b>${esc(a.clientName)}</b><div class="muted" style="font-size:12px">${cpDate(a.createdAt)}</div></td><td>${esc(a.record)}<div class="muted" style="font-size:12px">${esc(a.request)}</div></td>
        <td>${a.status === "pending" ? (a.overdue ? `<span class="pill bad">Overdue since ${cpDate(a.dueAt)}</span>` : `<span class="pill warn">Due ${cpDate(a.dueAt)} (${a.daysLeft} days)</span>`) : `<span class="pill ${a.status === "accepted" ? "ok" : ""}">${a.status === "accepted" ? "Accepted" : "Denied"} ${cpDate(a.decidedAt)}</span>`}</td>
        <td>${a.status === "pending" ? `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" data-act="cpAmend" data-id="${esc(a.id)}" data-s="accepted">Accept</button><button class="btn sm" data-act="cpAmend" data-id="${esc(a.id)}" data-s="denied">Deny</button>${a.extendedAt ? "" : `<button class="btn sm" data-act="cpAmendExtend" data-id="${esc(a.id)}">30 more days</button>`}</div>` : esc(a.decisionReason || "")}</td></tr>`;
      return `${head}${cpCard("Requests to correct a record", cpTable(["Patient", "Record and request", "Deadline", ""], am.map(amRow), "No correction requests. A patient can ask from the app, or you can log one from their chart (Consent tab)."), `<span class="muted" style="font-size:12px">60 days to answer, one 30-day extension</span>`)}
        ${cpCard("Accounting of disclosures", cpTable(["Date", "Patient", "Who received it", "Purpose", "Recorded by"], dis.map((d) => `<tr><td>${cpDate(d.date)}</td><td>${esc(d.clientName)}</td><td>${esc(d.recipient)}</td><td>${esc(d.purpose)}</td><td>${esc(d.recordedBy || "")}</td></tr>`), "No disclosures recorded. Record one from the patient's chart (Consent tab) whenever records go to someone outside treatment, payment or running the practice."))}
        ${cpCard("Notice of Privacy Practices", `<div style="padding:14px 16px">${npp.acknowledged} of ${npp.total} accounts have acknowledged the notice.${npp.missing.length ? `<div class="muted" style="font-size:12.5px;margin-top:6px">Not yet: ${npp.missing.slice(0, 40).map((m) => `<button class="btn ghost sm" data-act="chart" data-id="${esc(m.id)}">${esc(m.name)}</button>`).join(" ")}${npp.missing.length > 40 ? ` and ${npp.missing.length - 40} more` : ""}</div>` : ""}</div>`)}`;
    }
    if (tab === "incidents") {
      const list = await load("/incidents");
      const dl = (i) => { const d = i.deadlines || {}, n = i.notifications || {}; const line = (label, x, done) => (x && x.required !== false ? `<div>${label}: ${done ? `<span class="pill ok">Sent ${cpDate(done)}</span>` : `by <b>${cpDate(x.by)}</b>`}</div>` : ""); return `${line("Patients", d.individuals, n.individualsAt)}${line("HHS", d.hhs, n.hhsAt)}${line("Florida residents (30 days)", d.floridaIndividuals, n.floridaAt)}${line("Florida Attorney General", d.floridaAttorneyGeneral, n.floridaAttorneyGeneralAt)}${line("Media", d.media, n.mediaAt)}`; };
      return `${head}${cpCard("Security incidents and breaches", cpTable(["Discovered", "What happened", "People", "Deadlines", ""], list.map((i) => `<tr><td>${cpDate(i.discoveredAt)}<div>${i.status === "closed" ? `<span class="pill">Closed</span>` : `<span class="pill warn">Open</span>`}</div></td><td><b>${esc(i.title)}</b><div class="muted" style="font-size:12px">${esc(i.description || "")}</div><div class="muted" style="font-size:12px">Conclusion: ${esc((i.riskAssessment && i.riskAssessment.conclusion) || "pending")}</div></td><td>${i.affectedCount}</td><td style="font-size:12.5px">${dl(i)}</td><td><button class="btn sm" data-act="cpIncidentEdit" data-id="${esc(i.id)}">Update</button></td></tr>`), "No incidents logged. Log anything that might have exposed patient information, even if it turns out not to be a breach."),
        `<button class="btn primary sm" data-act="cpIncidentNew">Log an incident</button>`)}
        <p class="muted" style="font-size:12.5px">Deadlines run from the day of discovery: HIPAA allows up to 60 days, Florida 30 days. Notify without unreasonable delay; the dates here are the outer limits.</p>`;
    }
    if (tab === "registers") {
      const r = await load("/compliance/registers");
      const hint = { baa: `Expected when in use: ${r.vendors.map((v) => esc(v.name)).join("; ")}.`, policy: `Expected: ${r.policies.map(esc).join("; ")}.`, training: "One entry per person per year, with their sign-in email as the staff member.", device: "Every computer, tablet and phone that opens the EMR: disk encryption on, screen lock on.",
        risk: "A written risk analysis, yearly and after any big change.", restore: "Open a weekly backup file with the passphrase and confirm the records are there.", review: "Added when you sign off the Audit review tab." };
      return `${head}${Object.keys(r.types).map((t) => cpCard(esc(r.types[t].label), `<div class="muted" style="font-size:12.5px;padding:0 16px 8px">${hint[t] || ""}</div>` + cpTable(["Date", "Title", esc(r.types[t].party), "Status", ""], r.registers[t].map((e) => `<tr${e.retiredAt ? ' style="opacity:.55"' : ""}><td>${cpDate(e.date)}</td><td><b>${esc(e.title)}</b>${e.notes ? `<div class="muted" style="font-size:12px">${esc(e.notes)}</div>` : ""}</td><td>${esc(e.party || "")}</td>
        <td>${e.retiredAt ? `<span class="pill">Retired</span>` : e.status ? `<span class="pill ${["signed", "secured", "adopted", "not-needed"].includes(e.status) ? "ok" : "warn"}">${esc(e.status)}</span>` : ""}${e.reviewBy ? `<div class="muted" style="font-size:12px">Review by ${cpDate(e.reviewBy)}</div>` : ""}</td>
        <td>${t === "review" ? "" : `<button class="btn sm" data-act="cpRegEdit" data-type="${t}" data-id="${esc(e.id)}">Edit</button>`}</td></tr>`), "Nothing recorded yet."),
        t === "review" ? "" : `<button class="btn sm" data-act="cpRegNew" data-type="${t}">Add</button>`)).join("")}
        <p class="muted" style="font-size:12.5px">Entries are retired, never deleted: compliance records are kept six years.</p>`;
    }
    if (tab === "review") {
      const a = await load("/compliance/audit-review");
      return `${head}<div class="grid g3" style="margin-bottom:16px"><div class="card"><div class="muted" style="font-size:12px">Ledger</div><div>${a.chainOk ? `<span class="pill ok">Intact</span>` : `<span class="pill bad">Failed verification</span>`}</div><div class="muted" style="font-size:12px;margin-top:4px">${a.total} entries in ${a.days} days</div></div>
        <div class="card"><div class="muted" style="font-size:12px">Refused attempts</div><div style="font-size:22px;font-weight:700">${a.denied}</div><div class="muted" style="font-size:12px">wrong owner password on locked settings</div></div>
        <div class="card"><div class="muted" style="font-size:12px">Changes</div><div style="font-size:13.5px">${a.staffChanges} to staff accounts<br>${a.settingsChanges} to settings<br>${a.exports} record exports</div></div></div>
        ${cpCard("Who did what", cpTable(["Person", "Actions", "Chart activity", "Patients", "Exports", "Outside 6am–10pm", "Last active"], a.people.map((p) => `<tr><td>${esc(p.who)}</td><td>${p.total}</td><td>${p.chartViews}</td><td>${p.patients}</td><td>${p.exports}</td><td>${p.afterHours ? `<span class="pill warn">${p.afterHours}</span>` : "0"}</td><td>${p.last ? esc(new Date(p.last).toLocaleString()) : "—"}</td></tr>`), "No staff activity in this period."))}
        <div class="card"><h2 style="margin-bottom:8px">Sign off this review</h2><p class="muted" style="margin:0 0 10px;font-size:13px">${a.lastReview ? `Last signed off ${cpDate(a.lastReview.date)} by ${esc(a.lastReview.party)}.` : "Never signed off."} Do this monthly. Look for people opening more charts than their work needs, activity at odd hours, and exports you did not expect. The full ledger is under Security & audit.</p>
          <form class="stack" data-form="cpReview">${fld("cpRvNotes", "notes", "What you found (optional)", "", { area: true, max: 2000 })}<div class="row"><button class="btn primary">I have reviewed this</button></div></form></div>`;
    }
    const [c, ret] = await Promise.all([load("/compliance"), load("/compliance/retention")]), S = c.settings;
    return `${head}<div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:10px">Officers, notice and retention</h2>
      <form class="stack" data-form="cpSettings"><div class="grid g2">${fld("cpPO", "privacyOfficer", "Privacy officer", S.privacyOfficer, { max: 120 })}${fld("cpSO", "securityOfficer", "Security officer (can be the same person)", S.securityOfficer, { max: 120 })}
        ${fld("cpNV", "nppVersion", "Notice of Privacy Practices: version", S.nppVersion, { max: 40 })}${fld("cpND", "nppUpdatedAt", "Notice last updated", S.nppUpdatedAt, { type: "date" })}
        ${fld("cpRY", "retentionYears", "Keep clinical records (years)", S.retentionYears, { type: "number", attrs: 'min="1" max="50"' })}${fld("cpAY", "auditRetentionYears", "Keep the audit log (years)", S.auditRetentionYears, { type: "number", attrs: 'min="6" max="50"' })}</div>
        <label class="row" style="gap:8px"><input type="checkbox" name="includeVisitNotesInMemberExport"${S.includeVisitNotesInMemberExport ? " checked" : ""}> Include visit notes in the copy a patient downloads themselves</label>
        <div class="row"><button class="btn primary">Save</button></div></form></div>
      ${cpCard("Retention report", cpTable(["Records", "Total", `Older than ${ret.retentionYears} years`], ret.groups.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.total}</td><td>${g.eligible}</td></tr>`), "Nothing stored."), `<span class="muted" style="font-size:12px">Report only: nothing is deleted</span>`)}`;
  };
  ACT.cpTab = (el) => { state.cpTab = el.dataset.tab; render(); };
  ACT.cpGo = (el) => { const [where] = String(el.dataset.go || "").split(":"); if (where === "team" || where === "security") { location.hash = where; return; } state.cpTab = where; render(); };
  const cpSaved = async (msg) => { closeModal(); await render(); toast(msg); };
  // ---- registers
  const cpRegForm = (types, statuses, type, e = {}) => `<div class="card-head"><h2>${e.id ? "Edit" : "Add"}: ${esc(types[type].label)}</h2><button type="button" class="btn sm" data-act="closeModal">Close</button></div>
    <form class="stack" data-form="cpReg" data-type="${type}" data-id="${esc(e.id || "")}">${fld("cpRT", "title", "Title", e.title, { max: 160, attrs: "required" })}${fld("cpRP", "party", esc(types[type].party), e.party, { max: 160 })}
      <div class="grid g2">${fld("cpRD", "date", type === "device" ? "Date checked" : "Date", e.date || new Date().toISOString().slice(0, 10), { type: "date" })}${fld("cpRB", "reviewBy", "Review by (optional)", e.reviewBy, { type: "date" })}</div>
      ${statuses[type] ? sel("cpRS", "status", "Status", statuses[type], e.status || statuses[type][0]) : ""}${fld("cpRN", "notes", "Notes (where the document is kept, what was covered)", e.notes, { area: true, max: 2000 })}
      ${e.id ? `<label class="row" style="gap:8px"><input type="checkbox" name="retired"${e.retiredAt ? " checked" : ""}> Retired (kept on the register, no longer counted)</label>` : ""}
      <p class="muted" data-msg style="margin:0;font-size:12.5px"></p><div class="row"><button class="btn primary">Save</button></div></form>`;
  ACT.cpRegNew = async (el) => { const r = await load("/compliance/registers"); modal(cpRegForm(r.types, r.statuses, el.dataset.type)); };
  ACT.cpRegEdit = async (el) => { const r = await load("/compliance/registers"), e = (r.registers[el.dataset.type] || []).find((x) => x.id === el.dataset.id); if (e) modal(cpRegForm(r.types, r.statuses, el.dataset.type, e)); };
  FORMS.cpReg = async (f) => {
    const b = { title: f.title.value.trim(), party: f.party.value.trim(), date: f.date.value, reviewBy: f.reviewBy.value, notes: f.notes.value.trim(), ...(f.status ? { status: f.status.value } : {}), ...(f.retired ? { retired: f.retired.checked } : {}) };
    try { await api(f.dataset.id ? "PATCH" : "POST", `/api/admin/compliance/registers/${f.dataset.type}${f.dataset.id ? "/" + encodeURIComponent(f.dataset.id) : ""}`, b); } catch (err) { return formMsg(f, err.message); }
    await cpSaved("Saved to the register.");
  };
  FORMS.cpReview = async (f) => { await api("POST", "/api/admin/compliance/audit-review", { notes: f.notes.value.trim() }); await render(); toast("Review signed off and recorded."); };
  FORMS.cpSettings = async (f) => {
    await api("PUT", "/api/admin/compliance/settings", { privacyOfficer: f.privacyOfficer.value.trim(), securityOfficer: f.securityOfficer.value.trim(), nppVersion: f.nppVersion.value.trim(), nppUpdatedAt: f.nppUpdatedAt.value,
      retentionYears: Number(f.retentionYears.value), auditRetentionYears: Number(f.auditRetentionYears.value), includeVisitNotesInMemberExport: f.includeVisitNotesInMemberExport.checked });
    await render(); toast("Compliance settings saved.");
  };
  // ---- correction requests
  ACT.cpAmend = (el) => { const deny = el.dataset.s === "denied";
    modal(`<div class="card-head"><h2>${deny ? "Deny" : "Accept"} this correction</h2><button type="button" class="btn sm" data-act="closeModal">Close</button></div>
      <form class="stack" data-form="cpAmendSave" data-id="${esc(el.dataset.id)}" data-s="${deny ? "denied" : "accepted"}">${fld("cpAR", "reason", deny ? "Reason, in plain language (the patient reads this)" : "Note to the patient (optional)", "", { area: true, max: 2000, attrs: deny ? "required" : "" })}
      <p class="muted" data-msg style="margin:0;font-size:12.5px">${deny ? "A denial must say why, and the patient may file a statement of disagreement." : "Make the correction in the chart as well; this records your answer."}</p><div class="row"><button class="btn primary">${deny ? "Deny" : "Accept"}</button></div></form>`); };
  FORMS.cpAmendSave = async (f) => { try { await api("PATCH", `/api/admin/amendments/${encodeURIComponent(f.dataset.id)}`, { status: f.dataset.s, reason: f.reason.value.trim() }); } catch (err) { return formMsg(f, err.message); } await cpSaved("Answer recorded. The patient is told to sign in to read it."); };
  ACT.cpAmendExtend = async (el) => { if (!confirm("Take 30 more days to answer? HIPAA allows this once, and the patient is told.")) return; await api("POST", `/api/admin/amendments/${encodeURIComponent(el.dataset.id)}/extend`, {}); await render(); toast("Extended by 30 days."); };
  // ---- incidents
  const cpIncForm = (i = {}) => { const n = i.notifications || {}, fl = ((i.states || []).find((s) => s.state === "FL") || {}).count || 0;
    return `<div class="card-head"><h2>${i.id ? "Update incident" : "Log an incident"}</h2><button type="button" class="btn sm" data-act="closeModal">Close</button></div>
    <form class="stack" data-form="cpIncident" data-id="${esc(i.id || "")}">${fld("cpIT", "title", "What happened, in a few words", i.title, { max: 200, attrs: "required" })}${fld("cpIX", "description", "Details", i.description, { area: true, max: 4000, rows: 4 })}
      <div class="grid g2">${fld("cpID", "discoveredAt", "Date discovered", i.discoveredAt || new Date().toISOString().slice(0, 10), { type: "date", attrs: "required" })}${fld("cpIO", "occurredAt", "Date it happened (if known)", i.occurredAt, { type: "date" })}
        ${fld("cpIA", "affectedCount", "People affected", i.affectedCount || 0, { type: "number", attrs: 'min="0"' })}${fld("cpIF", "fl", "Of those, Florida residents", fl, { type: "number", attrs: 'min="0"' })}</div>
      ${i.id ? `${sel("cpIC", "conclusion", "Risk assessment conclusion", [["pending", "Still assessing"], ["breach", "Breach: notify"], ["not-a-breach", "Low probability of compromise: not a breach"]], (i.riskAssessment && i.riskAssessment.conclusion) || "pending")}
        ${fld("cpIM", "mitigation", "What was done to limit the harm", i.riskAssessment && i.riskAssessment.mitigation, { area: true, max: 1000 })}
        <div class="grid g2">${fld("cpN1", "individualsAt", "Patients notified on", n.individualsAt, { type: "date" })}${fld("cpN2", "hhsAt", "HHS notified on", n.hhsAt, { type: "date" })}${fld("cpN3", "floridaAt", "Florida residents notified on", n.floridaAt, { type: "date" })}${sel("cpIS", "status", "Status", [["open", "Open"], ["closed", "Closed"]], i.status || "open")}</div>` : ""}
      <p class="muted" data-msg style="margin:0;font-size:12.5px"></p><div class="row"><button class="btn primary">Save</button></div></form>`; };
  ACT.cpIncidentNew = () => modal(cpIncForm());
  ACT.cpIncidentEdit = async (el) => { const i = (await load("/incidents")).find((x) => x.id === el.dataset.id); if (i) modal(cpIncForm(i)); };
  FORMS.cpIncident = async (f) => {
    const b = { title: f.title.value.trim(), description: f.description.value.trim(), discoveredAt: f.discoveredAt.value, occurredAt: f.occurredAt.value, affectedCount: Number(f.affectedCount.value || 0), states: Number(f.fl.value || 0) > 0 ? [{ state: "FL", count: Number(f.fl.value) }] : [] };
    if (f.dataset.id) Object.assign(b, { status: f.status.value, riskAssessment: { conclusion: f.conclusion.value, mitigation: f.mitigation.value.trim() }, notifications: { individualsAt: f.individualsAt.value, hhsAt: f.hhsAt.value, floridaAt: f.floridaAt.value } });
    try { await api(f.dataset.id ? "PATCH" : "POST", `/api/admin/incidents${f.dataset.id ? "/" + encodeURIComponent(f.dataset.id) : ""}`, b); } catch (err) { return formMsg(f, err.message); }
    await cpSaved(f.dataset.id ? "Incident updated." : "Incident logged. The deadlines are on the list.");
  };
  // ---- one patient: how to reach them, the privacy notice, a copy of the record, corrections, disclosures (chart, Consent tab)
  ACT.privacyOpen = async (el) => {
    const id = el.dataset.id, p = await get(`/clients/${encodeURIComponent(id)}/privacy`), pr = p.preferences, charts = can("charts");
    const d = charts ? await get(`/clients/${encodeURIComponent(id)}/disclosures`) : { disclosures: [] };
    modal(`<div class="card-head"><h2>Privacy and records</h2><button type="button" class="btn sm" data-act="closeModal">Close</button></div>
      <div class="list-item"><span style="flex:1">Notice of Privacy Practices</span>${p.npp.acknowledged ? `<span class="pill ok">Acknowledged ${cpDate(p.npp.at)}</span>` : `<button class="btn sm" data-act="privacyAck" data-id="${esc(id)}">Record a signed paper copy</button>`}</div>
      <form class="stack" data-form="privacySave" data-id="${esc(id)}" style="margin-top:12px"><h3 style="margin:0">How they asked to be contacted</h3>
        ${sel("pvBy", "contactBy", "Reach them by", [["", "No preference"], ["email", "Email only"], ["text", "Text"], ["phone", "Phone"]], pr.contactBy)}
        <label class="row" style="gap:8px"><input type="checkbox" name="noVoicemail"${pr.noVoicemail ? " checked" : ""}> Do not leave voicemail</label><label class="row" style="gap:8px"><input type="checkbox" name="noText"${pr.noText ? " checked" : ""}> Do not text</label>
        ${fld("pvR", "restrictions", "Other restriction they asked for", pr.restrictions, { area: true, max: 1000 })}<p class="muted" data-msg style="margin:0;font-size:12.5px"></p><div class="row"><button class="btn primary">Save preferences</button></div></form>
      ${charts ? `<h3 style="margin:16px 0 8px">Their record</h3><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-act="privacyRecord" data-id="${esc(id)}">Download the full record</button><button class="btn" data-act="privacyAmendNew" data-id="${esc(id)}">Log a correction request</button><button class="btn" data-act="privacyDiscNew" data-id="${esc(id)}">Record a disclosure</button></div>
        <div class="muted" style="font-size:12.5px;margin-top:8px">${d.disclosures.length ? `${plural(d.disclosures.length, "disclosure")} on their accounting; the latest was ${cpDate(d.disclosures[0].date)} to ${esc(d.disclosures[0].recipient)}.` : "No disclosures on their accounting."} A patient is owed a copy within 30 days of asking.</div>` : ""}`);
  };
  ACT.privacyAck = async (el) => { await api("POST", `/api/admin/clients/${encodeURIComponent(el.dataset.id)}/privacy/acknowledge`, {}); closeModal(); toast("Acknowledgment recorded."); };
  FORMS.privacySave = async (f) => { try { await api("PUT", `/api/admin/clients/${encodeURIComponent(f.dataset.id)}/privacy`, { contactBy: f.contactBy.value, noVoicemail: f.noVoicemail.checked, noText: f.noText.checked, restrictions: f.restrictions.value.trim() }); } catch (err) { return formMsg(f, err.message); } closeModal(); toast("Contact preferences saved."); };
  ACT.privacyRecord = async (el) => {
    const rec = await api("GET", `/api/admin/clients/${encodeURIComponent(el.dataset.id)}/records`);
    const a = document.createElement("a"), url = URL.createObjectURL(new Blob([JSON.stringify(rec, null, 2)], { type: "application/json" }));
    a.href = url; a.download = `mdfit-record-${String(rec.exportedAt || "").slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Record downloaded. This export is in the audit ledger.");
  };
  ACT.privacyAmendNew = (el) => modal(`<div class="card-head"><h2>Log a correction request</h2><button type="button" class="btn sm" data-act="closeModal">Close</button></div>
    <form class="stack" data-form="privacyAmend" data-id="${esc(el.dataset.id)}">${fld("paR", "record", "Which record", "", { max: 200, attrs: "required" })}${fld("paQ", "request", "What they want changed", "", { area: true, max: 2000, attrs: "required" })}${fld("paW", "reason", "Why (optional)", "", { area: true, max: 1000 })}
    <p class="muted" data-msg style="margin:0;font-size:12.5px">The 60-day clock starts today. Answer it under Compliance, Patient requests.</p><div class="row"><button class="btn primary">Log the request</button></div></form>`);
  FORMS.privacyAmend = async (f) => { try { await api("POST", `/api/admin/clients/${encodeURIComponent(f.dataset.id)}/amendments`, { record: f.record.value.trim(), request: f.request.value.trim(), reason: f.reason.value.trim() }); } catch (err) { return formMsg(f, err.message); } closeModal(); toast("Correction request logged. It is due in 60 days."); };
  ACT.privacyDiscNew = (el) => modal(`<div class="card-head"><h2>Record a disclosure</h2><button type="button" class="btn sm" data-act="closeModal">Close</button></div>
    <form class="stack" data-form="privacyDisc" data-id="${esc(el.dataset.id)}"><div class="grid g2">${fld("pdD", "date", "Date", new Date().toISOString().slice(0, 10), { type: "date" })}${fld("pdB", "basis", "Legal basis (optional)", "", { max: 100, attrs: 'placeholder="Authorization, subpoena, public health"' })}</div>
    ${fld("pdW", "recipient", "Who received it", "", { max: 200, attrs: "required" })}${fld("pdP", "purpose", "Purpose", "", { max: 300, attrs: "required" })}${fld("pdX", "description", "What was disclosed", "", { area: true, max: 2000, attrs: "required" })}
    <p class="muted" data-msg style="margin:0;font-size:12.5px">For records sent to anyone outside treatment, payment or running the practice. Kept six years; it cannot be edited afterwards.</p><div class="row"><button class="btn primary">Record it</button></div></form>`);
  FORMS.privacyDisc = async (f) => { try { await api("POST", `/api/admin/clients/${encodeURIComponent(f.dataset.id)}/disclosures`, { date: f.date.value, basis: f.basis.value.trim(), recipient: f.recipient.value.trim(), purpose: f.purpose.value.trim(), description: f.description.value.trim() }); } catch (err) { return formMsg(f, err.message); } closeModal(); toast("Disclosure recorded on their accounting."); };
  // ===================== end of Compliance =====================

  // ---- Add a client by hand, and email a client the sign-in address (mymdfit.com/login)
  ACT.clientAdd = () => modal(`<div class="card-head"><h2>Add a client</h2><button type="button" class="btn sm" data-act="closeModal">Close</button></div>
    <form class="stack" data-form="clientAdd">${fld("caName", "name", "Full name", "", { max: 100, attrs: 'required minlength="2" autocomplete="off"' })}
      ${fld("caEmail", "email", "Email (required: it is how they sign in)", "", { type: "email", max: 200, attrs: 'required autocomplete="off"' })}${fld("caPhone", "phone", "Phone (optional)", "", { type: "tel", max: 30, attrs: 'autocomplete="off"' })}
      <p class="muted" data-msg style="margin:0;font-size:12.5px">When you save, they are emailed that the account was created, with the sign-in link (mymdfit.com/login) and a temporary password. It lasts 3 days and they must choose their own the first time they sign in.</p><div class="row"><button class="btn primary">Add client</button></div></form>
    <div style="border-top:1px solid var(--line);margin-top:16px;padding-top:14px"><h3 style="margin:0 0 4px">Or just send the sign-up link</h3><p class="muted" style="margin:0 0 10px;font-size:12.5px">Emails mymdfit.com/login so they create their own account. Nothing is added to your client list until they do.</p>
      <form class="row" data-form="clientInvite" style="gap:8px;align-items:flex-end;flex-wrap:wrap"><div class="field" style="flex:1 1 220px;margin:0"><label for="ciEmail">Their email</label><input id="ciEmail" name="email" class="input" type="email" maxlength="200" required autocomplete="off"></div><button class="btn">Send sign-up link</button></form>
      <p class="muted" id="ciMsg" role="status" style="margin:8px 0 0;font-size:12.5px"></p></div>`);
  FORMS.clientAdd = async (f) => {
    const email = f.email.value.trim();
    if (!email) return formMsg(f, "An email address is required.");
    let r; try { r = await api("POST", "/api/admin/clients", { name: f.name.value.trim(), email, phone: f.phone.value.trim() }); } catch (err) { return formMsg(f, err.message); }
    closeModal(); await render();
    toast(`${r.client.name} added. ${r.emailed ? "Their account email, with a temporary password, is on its way." : "The email could not be sent, so no temporary password was made. They can set one with Forgot password? on the sign-in page."}`);
  };
  FORMS.clientInvite = async (f) => {
    const m = $("#ciMsg"); m.textContent = "Sending…";
    try { const r = await api("POST", "/api/admin/clients/invite", { email: f.email.value.trim() }); m.textContent = r.existing ? `${r.to} already has an account, so the sign-in link was sent instead.` : `Sign-up link sent to ${r.to}.`; f.reset(); }
    catch (err) { m.textContent = err.message; }
  };
  ACT.clientLoginLink = async (el) => { if (!confirm("Email this client the sign-in link (mymdfit.com/login)?")) return; const r = await api("POST", `/api/admin/clients/${encodeURIComponent(el.dataset.id)}/login-link`, {}); toast(r.temporaryPassword ? `Sent to ${r.to}, with a new temporary password (they have not signed in yet).` : `Sign-in link sent to ${r.to}.`); };

  // ===================== Import from SimplePractice (owner only) =====================
  // The owner picks the zip files SimplePractice exports (Contacts, Medical Records, Billing Documents, Administrative,
  // Secure messages). They are unpacked here in the browser: nothing is uploaded until the owner has seen the plan and
  // pressed Import. Then each person's account is made or matched, and each document goes onto their chart one by one.
  // What is read stays in this tab's memory only, and is dropped when the import ends or the person signs out.
  const impPick = {}; // shared name -> the contact card the owner chose for those records
  const imp = { stage: "pick", contacts: [], items: [], rows: [], plan: {}, choice: {}, progress: { done: 0, total: 0, errors: [] }, result: null, batches: null, msg: "" };
  const impReset = () => { for (const k of Object.keys(impPick)) delete impPick[k]; imp.dupes = new Map(); Object.assign(imp, { stage: "pick", contacts: [], items: [], rows: [], plan: {}, choice: {}, progress: { done: 0, total: 0, errors: [] }, result: null, msg: "" }); };
  const impNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  async function unzip(file) {
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer), td = new TextDecoder();
    let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error(`${file.name} is not a zip file.`);
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error(`${file.name} could not be read.`);
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(buf.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + elen + clen;
      if (name.endsWith("/") || name.split("/").includes("..") || name.startsWith("/") || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue;
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), raw = buf.subarray(start, start + csize);
      out.push({ name, read: async () => method === 0 ? raw.slice() : method === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) : (() => { throw new Error(`${name}: unsupported compression.`); })() });
    }
    return out;
  }
  function vcards(text) {
    const t = text.replace(/\r?\n[ \t]/g, ""), cards = [];
    for (const block of t.split(/BEGIN:VCARD/i).slice(1)) {
      const d = {};
      for (const line of block.split(/\r?\n/)) { const i = line.indexOf(":"); if (i < 1) continue; const k = line.slice(0, i).split(";")[0].toUpperCase().replace(/^ITEM\d+\./, ""); if (!(k in d)) d[k] = line.slice(i + 1).replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim(); }
      const [last = "", first = ""] = (d.N || "").split(";"), b = (d.BDAY || "").replace(/-/g, "");
      cards.push({ name: d.FN || `${first} ${last}`.trim(), first, last, email: (d.EMAIL || "").toLowerCase(), phone: d.TEL || "", dob: /^\d{8}$/.test(b) ? `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}` : "", address: (d.ADR || "").split(";").filter(Boolean).join(", ") });
    }
    return cards;
  }
  const IMP_KIND = { "medical records": "record", "billing documents": "invoice", "administrative": "admin", "secure messages": "message" };
  async function impRead(files) {
    const contacts = [], items = [];
    for (const f of files) for (const e of await unzip(f)) {
      const parts = e.name.split("/"), top = impNorm(parts[0]), base = parts[parts.length - 1];
      if (/\.vcf$/i.test(base)) { for (const c of vcards(new TextDecoder().decode(await e.read()))) if (c.name) contacts.push({ ...c, key: `c${contacts.length}` }); continue; }
      const kind = IMP_KIND[top]; if (!kind) continue;
      const holder = kind === "message" ? base.replace(/-Jared-Caban-CONV.*$/i, "").replace(/-/g, " ") : parts.length >= 3 ? parts[1] : "";
      const type = /\.pdf$/i.test(base) ? "application/pdf" : /\.txt$/i.test(base) ? "text/plain" : /\.png$/i.test(base) ? "image/png" : /\.jpe?g$/i.test(base) ? "image/jpeg" : "";
      if (!holder || !type) continue;
      items.push({ kind, holder, name: base, type, date: (base.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "", read: e.read });
    }
    return { contacts, items };
  }
  // Who each document belongs to: the contact card with that exact name; a name on two cards is left for the owner
  function impHolders() {
    const byName = new Map(); for (const c of imp.contacts) byName.set(impNorm(c.name), (byName.get(impNorm(c.name)) || []).concat([c]));
    const holders = new Map();
    for (const it of imp.items) { const k = impNorm(it.holder); if (!holders.has(k)) holders.set(k, { name: it.holder, items: [], cards: byName.get(k) || [] }); holders.get(k).items.push(it); }
    for (const [k, h] of holders) if (h.cards.length > 1) { const pick = h.cards.find((c) => c.key === impPick[k]); if (pick) h.cards = [pick, ...h.cards.filter((c) => c !== pick)]; }
    for (const h of holders.values()) if (!h.cards.length) { const c = { key: `h${imp.contacts.length}`, name: h.name, first: "", last: "", email: "", phone: "", dob: "", address: "", fromRecords: true }; imp.contacts.push(c); h.cards = [c]; }
    return holders;
  }
  // Duplicate contact cards: SimplePractice often holds the same person twice (same name and phone, the birth date the
  // same or missing on one). The fuller card is kept and gets the records; the other is left out by default and marked.
  const impDigits = (p) => String(p || "").replace(/\D/g, "").slice(-10);
  function impDupes() {
    const groups = new Map();
    for (const c of imp.contacts) { const k = impNorm(c.name); if (!c.fromRecords) groups.set(k, (groups.get(k) || []).concat([c])); }
    const dupes = new Map(); // key of a left-out card -> key of the card kept
    for (const [name, cards] of groups) {
      if (cards.length < 2) continue;
      const score = (c) => (c.email ? 2 : 0) + (c.dob ? 2 : 0) + (c.phone ? 1 : 0) + (c.address ? 1 : 0);
      const kept = [...cards].sort((a, b) => score(b) - score(a))[0];
      for (const c of cards) if (c !== kept && impDigits(c.phone) && impDigits(c.phone) === impDigits(kept.phone) && (!c.dob || !kept.dob || c.dob === kept.dob)) dupes.set(c.key, kept.key);
      if (cards.some((c) => dupes.has(c.key)) && impPick[name] === undefined) impPick[name] = kept.key;
    }
    return dupes;
  }
  // Per contact: how many documents and invoices, and the earliest record date (when they became a patient)
  function impRows() {
    const holders = impHolders(), stats = new Map(imp.contacts.map((c) => [c.key, { records: 0, invoices: 0, first: "", shared: "" }]));
    for (const [k, h] of holders) { const s = stats.get(h.cards[0].key); for (const it of h.items) { if (it.kind === "invoice") s.invoices++; else s.records++; if (it.kind === "record" && it.date && (!s.first || it.date < s.first)) s.first = it.date; } if (h.cards.length > 1) for (const x of h.cards) stats.get(x.key).shared = k; }
    imp.rows = imp.contacts.map((c) => ({ ...c, ...stats.get(c.key) })).sort((a, b) => (b.records + b.invoices) - (a.records + a.invoices) || a.name.localeCompare(b.name));
  }
  V.import = async () => {
    const head = `<div class="view-head"><div><h1>Import from SimplePractice</h1><p class="muted">Bring the old EMR's clients, records and invoices into MD Fit</p></div></div>`;
    if (imp.batches === null) { try { imp.batches = await get("/import/sp/batches"); } catch { imp.batches = []; } }
    const past = imp.batches.length ? `<div class="card" style="padding:0;margin-top:16px"><div class="card-head" style="padding:14px 16px 0"><h2>Earlier imports</h2></div><div class="table-wrap"><table><thead><tr><th>When</th><th>New clients</th><th>Matched</th><th>Documents</th><th>Invoices</th><th></th></tr></thead><tbody>${imp.batches.map((b) => `<tr><td>${esc(new Date(b.at).toLocaleString())}</td><td>${b.created}</td><td>${b.linked}</td><td>${b.files}</td><td>${b.invoices}</td><td>${b.undoneAt ? `<span class="pill">Undone</span>` : `<button class="btn sm" data-act="impUndo" data-id="${esc(b.id)}">Undo</button>`}</td></tr>`).join("")}</tbody></table></div></div>` : "";
    if (imp.stage === "pick") return `${head}<div class="card"><h2 style="margin-bottom:6px">1. Choose the export files</h2>
      <p class="muted" style="margin:0 0 12px">Pick every zip file SimplePractice gave you (Contacts, Medical Records, Billing Documents, Administrative, Secure messages). They are read here on this computer; nothing is sent until you have checked the plan and pressed Import.</p>
      <form class="stack" data-form="impPick"><input class="input" type="file" name="files" accept=".zip,application/zip" multiple required><p class="muted" data-msg style="margin:0;font-size:12.5px">${esc(imp.msg)}</p><div class="row"><button class="btn primary">Read the files</button></div></form></div>${past}`;
    if (imp.stage === "preview") {
      const withRec = imp.rows.filter((r) => r.records), noEmail = imp.rows.filter((r) => !r.email && imp.choice[r.key] === "new").length;
      const toConfirm = imp.rows.filter((r) => (imp.plan[r.key] || {}).action === "confirm" && imp.choice[r.key] === "skip").length;
      const lbl = (m) => `Same as ${m.name}${m.email ? ` (${m.email})` : m.phone ? ` (${m.phone})` : ""}`;
      const opt = (r) => { const p = imp.plan[r.key] || {}, cur = imp.choice[r.key], confirm = p.action === "confirm";
        const cands = p.match ? [[`link:${p.match.id}`, lbl(p.match)]] : (p.candidates || []).map((m) => [`link:${m.id}`, lbl(m)]);
        const o = confirm ? [["skip", "Leave out for now"], ...cands, ["new", "New client (not the same person)"]] : [["new", "New client"], ...cands, ["skip", "Leave out"]];
        const why = confirm ? (p.candidates || []).map((m) => m.why).filter(Boolean)[0] : "";
        return `<select class="input${confirm ? " tier-pick on" : ""}" data-change="impChoice" data-key="${esc(r.key)}" aria-label="What to do with ${esc(r.name)}">${o.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>${confirm ? `<div class="muted" style="font-size:12px;color:var(--warn)">Possible match — confirm${why ? ": " + esc(why) : ""}. Left out until you choose.</div>` : ""}${p.how === "ambiguous" ? `<div class="muted" style="font-size:12px;color:var(--warn)">Two accounts have this name: pick one</div>` : ""}${imp.dupes && imp.dupes.has(r.key) ? `<div class="muted" style="font-size:12px;margin-top:4px">Duplicate card in SimplePractice (same name and phone): left out, the other card is kept</div>` : ""}${r.shared ? `<label class="row muted" style="gap:6px;font-size:12px;margin-top:4px"><input type="radio" name="pick-${esc(r.shared)}" data-change="impPick" data-name="${esc(r.shared)}" data-key="${esc(r.key)}"${r.records + r.invoices ? " checked" : ""}> Two contact cards have this name: the records belong to this one</label>` : ""}`; };
      const count = (k) => imp.rows.filter((r) => imp.choice[r.key] === k || (k === "link" && String(imp.choice[r.key]).startsWith("link:"))).length;
      const files = imp.rows.filter((r) => imp.choice[r.key] !== "skip").reduce((n, r) => n + r.records + r.invoices, 0);
      return `${head}<div class="grid g3" style="margin-bottom:16px"><div class="card"><div class="muted" style="font-size:12px">New clients</div><div style="font-size:24px;font-weight:700">${count("new")}</div><div class="muted" style="font-size:12px">${noEmail} without an email address</div></div>
        <div class="card"${toConfirm ? ' style="border-color:var(--warn)"' : ""}><div class="muted" style="font-size:12px">Matched to an MD Fit account</div><div style="font-size:24px;font-weight:700">${count("link")}</div><div class="muted" style="font-size:12px">${toConfirm ? `<b style="color:var(--warn)">${toConfirm} possible match${toConfirm === 1 ? "" : "es"} to confirm</b>` : "only empty details are filled in"}</div></div>
        <div class="card"><div class="muted" style="font-size:12px">Documents to file</div><div style="font-size:24px;font-weight:700">${files}</div><div class="muted" style="font-size:12px">${withRec.length} people with records become patients</div></div></div>
        <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>2. Check the plan</h2><div class="row" style="gap:8px"><button class="btn" data-act="impBack">Start over</button><button class="btn primary" data-act="impGo">Import ${count("new") + count("link")} clients and ${files} documents</button></div></div>
        <p class="muted" style="margin:0;padding:6px 16px 10px;font-size:12.5px">Nobody is emailed and no passwords are made. Clients without an email can't sign in until one is added. Paid invoices are added to revenue in the month they were issued; they are clinic revenue and never part of the revenue share.</p>
        <div class="table-wrap" style="max-height:60vh;overflow:auto"><table><thead><tr><th>Name</th><th>Email</th><th>Records</th><th>Invoices</th><th>In MD Fit</th></tr></thead><tbody>
        ${imp.rows.map((r) => `<tr><td><b>${esc(r.name)}</b>${r.dob ? `<div class="muted" style="font-size:12px">Born ${esc(r.dob)}</div>` : ""}</td><td>${r.email ? esc(r.email) : `<span class="muted">none</span>`}</td><td>${r.records || ""}</td><td>${r.invoices || ""}</td><td>${opt(r)}</td></tr>`).join("")}</tbody></table></div></div>`;
    }
    if (imp.stage === "running") { const p = imp.progress; return `${head}<div class="card"><h2 style="margin-bottom:8px">Importing…</h2><p style="margin:0 0 8px">${esc(imp.msg)}</p><div style="height:10px;border-radius:6px;background:var(--line);overflow:hidden"><div style="height:100%;width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%;background:var(--accent)"></div></div><p class="muted" style="margin:8px 0 0;font-size:12.5px">${p.done} of ${p.total} documents. Keep this tab open.</p></div>`; }
    const r = imp.result || {};
    return `${head}<div class="card"><h2 style="margin-bottom:8px">Import finished</h2>
      <div class="list-item"><span style="flex:1">New clients</span><b>${r.created || 0}</b></div><div class="list-item"><span style="flex:1">Matched to existing accounts</span><b>${r.linked || 0}</b></div>
      <div class="list-item"><span style="flex:1">Made active patients</span><b>${r.patients || 0}</b></div><div class="list-item"><span style="flex:1">Documents filed on charts</span><b>${r.files || 0}</b>${r.dupes ? `<span class="muted" style="font-size:12px;margin-left:6px">(${r.dupes} already there)</span>` : ""}</div>
      <div class="list-item"><span style="flex:1">Invoices entered in billing</span><b>${r.invoices || 0}</b><span class="muted" style="font-size:12px;margin-left:6px">${impMoney(r.paidCents || 0)} paid${r.owedCents ? `, ${impMoney(r.owedCents)} still owed` : ""}</span></div>
      ${(r.notes || []).length ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">${r.notes.map(esc).join("<br>")}</p>` : ""}
      ${imp.progress.errors.length ? `<p style="color:var(--bad);font-size:13px;margin:10px 0 0">${imp.progress.errors.length} document(s) could not be filed:<br>${imp.progress.errors.slice(0, 20).map(esc).join("<br>")}</p>` : ""}
      <div class="row" style="gap:8px;margin-top:14px"><a class="btn primary" href="#clients">Open Clients</a><a class="btn" href="#economics">See revenue</a><button class="btn" data-act="impBack">Import more</button></div></div>${past}`;
  };
  const impMoney = (c) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  FORMS.impPick = async (f) => {
    const files = [...f.files.files]; if (!files.length) return formMsg(f, "Pick the zip files first.");
    formMsg(f, "Reading the files…");
    try {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open zip files. Use a current Chrome, Safari, Edge or Firefox.");
      const { contacts, items } = await impRead(files);
      if (!contacts.length && !items.length) throw new Error("No SimplePractice contacts or records were found in those files.");
      Object.assign(imp, { contacts, items });
      imp.dupes = impDupes();
      impRows();
      const plan = await api("POST", "/api/admin/import/sp/plan", { contacts: imp.contacts.map(({ key, name, first, last, email, phone, dob, address }) => ({ key, name, first, last, email, phone, dob, address })) });
      imp.plan = Object.fromEntries(plan.rows.map((x) => [x.key, x])); imp.batches = plan.batches;
      for (const r of imp.rows) { const p = imp.plan[r.key] || {}; imp.choice[r.key] = (imp.dupes.has(r.key) || p.action === "confirm") ? "skip" : p.action === "link" ? `link:${p.clientId}` : "new"; }
      imp.stage = "preview"; imp.msg = ""; await render();
    } catch (err) { formMsg(f, err.message); }
  };
  ACT.impChoice = (el) => { imp.choice[el.dataset.key] = el.value; render(); };
  ACT.impPick = (el) => { impPick[el.dataset.name] = el.dataset.key; impRows(); render(); };
  ACT.impBack = () => { impReset(); imp.batches = null; render(); };
  ACT.impGo = async () => {
    const rows = imp.rows.filter((r) => imp.choice[r.key] !== "skip");
    const unsure = imp.rows.filter((r) => (imp.plan[r.key] || {}).action === "confirm" && imp.choice[r.key] === "skip").length;
    if (!confirm(`Import ${rows.length} clients and their documents into MD Fit?${unsure ? `\n\n${unsure} possible match${unsure === 1 ? " is" : "es are"} left out because you have not confirmed ${unsure === 1 ? "it" : "them"}. Those people are not imported.` : ""}\n\nNobody is emailed. You can undo the whole import afterwards.`)) return;
    imp.stage = "running"; imp.msg = "Creating and matching client accounts…"; await render();
    const out = { created: 0, linked: 0, patients: 0, files: 0, dupes: 0, invoices: 0, paidCents: 0, owedCents: 0, notes: [] };
    try {
      const body = rows.map((r) => { const ch = String(imp.choice[r.key]); return { key: r.key, name: r.name, first: r.first, last: r.last, email: r.email, phone: r.phone, dob: r.dob, address: r.address, action: ch.startsWith("link:") ? "link" : "new", clientId: ch.startsWith("link:") ? ch.slice(5) : "", patientSince: r.records ? (r.first || new Date().toISOString().slice(0, 10)) : "" }; });
      const made = await api("POST", "/api/admin/import/sp/clients", { rows: body });
      Object.assign(out, { created: made.created, linked: made.linked, patients: made.patients });
      const keyOf = new Map(); for (const h of impHolders().values()) keyOf.set(impNorm(h.name), h.cards[0].key);
      const todo = imp.items.filter((it) => made.map[keyOf.get(impNorm(it.holder))]);
      imp.progress = { done: 0, total: todo.length, errors: [] };
      for (const it of todo) {
        imp.msg = `Filing ${it.kind === "invoice" ? "invoices" : "records"}…`;
        const q = new URLSearchParams({ batch: made.batch, client: made.map[keyOf.get(impNorm(it.holder))], kind: it.kind, date: it.date });
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const res = await fetch(`${API}/api/admin/import/sp/file?${q}`, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": it.type, "X-File-Name": encodeURIComponent(it.name), "X-Idle-Seconds": "0" }, body: new Blob([await it.read()], { type: it.type }) });
            if (res.status === 401) { signOut(); return; }
            const data = await res.json().catch(() => ({}));
            if (res.status === 429) { await new Promise((go) => setTimeout(go, 3000 * (attempt + 1))); continue; }
            if (!res.ok) { imp.progress.errors.push(`${it.holder}: ${it.name}: ${data.error || "could not be filed"}`); break; }
            ok = true; data.duplicate ? out.dupes++ : out.files++;
            if (data.invoice && !data.invoice.duplicate) { out.invoices++; if (data.invoice.status === "paid") out.paidCents += data.invoice.amount; else out.owedCents += data.invoice.amount; }
            if (data.note) out.notes.push(`${it.holder}: ${data.note}`);
          } catch (err) { if (attempt === 2) imp.progress.errors.push(`${it.holder}: ${it.name}: ${err.message}`); else await new Promise((go) => setTimeout(go, 1500)); }
        }
        imp.progress.done++;
        if (imp.progress.done % 5 === 0 || imp.progress.done === imp.progress.total) { const bar = document.querySelector("#view"); if (bar && routeNow() === "import") await render(); }
        await new Promise((go) => setTimeout(go, 120)); // gentle on the server's rate limits
      }
    } catch (err) { imp.progress.errors.push(err.message); }
    const keep = { result: out, progress: imp.progress };
    impReset(); Object.assign(imp, keep, { stage: "done", batches: null }); forget();
    await render(); toast("Import finished.");
  };
  ACT.impUndo = async (el) => {
    if (!confirm("Undo this import? The client accounts it created (unless they have signed in since), the documents it filed and the invoices it entered are removed. Anything written in MD Fit since is kept.")) return;
    const r = await api("POST", `/api/admin/import/sp/batches/${encodeURIComponent(el.dataset.id)}/undo`, {});
    imp.batches = null; forget(); await render(); toast(`Import undone. ${r.removedAccounts} account(s) removed.`);
  };
  // ===================== end of Import =====================

  ACT.rsEnabled = async (el) => { const on = el.getAttribute("aria-checked") !== "true"; if (!(await rsChange(on ? "Switch the revenue share on." : "Switch the revenue share off.", { enabled: on }))) return; await render(); toast(on ? "The revenue share is on." : "The revenue share is off. Nothing new is earned."); };
  ACT.rsAutoPay = async (el) => {
    const on = el.getAttribute("aria-checked") !== "true";
    if (on && !confirm("Switch on automatic payouts? Each share is then transferred to the manager's Stripe account as soon as its payment clears, instead of monthly (Section 4.8). This is recorded as your decision.")) return;
    if (!(await rsChange(on ? "Switch automatic payouts on." : "Switch automatic payouts off.", { autoPay: on }))) return; await render(); toast(on ? "Automatic payouts are on." : "Automatic payouts are off. You pay shares from here.");
  };
  ACT.rsClassify = async (el) => { await api("POST", "/api/admin/partner-share/classify", { revenueId: el.dataset.id, category: el.dataset.c }); await render(); toast("Classified."); };
  ACT.rsAck = async (el) => { await api("PUT", `/api/admin/partner-share/partners/${encodeURIComponent(el.dataset.id)}`, { acknowledge: true }); await render(); toast("Partner acknowledged."); };
  ACT.rsDispute = async (el) => { const why = prompt(`Why is the registration of ${el.dataset.name} disputed? (sent in writing, Section 7.2)`); if (!why) return; await api("PUT", `/api/admin/partner-share/partners/${encodeURIComponent(el.dataset.id)}`, { dispute: why }); await render(); toast("Registration disputed."); };
  ACT.rsRun = async (el) => {
    const job = el.dataset.job;
    if (job === "payout" && !confirm("Transfer everything that is payout ready to the manager's Stripe account now?")) return;
    const r = await api("POST", "/api/admin/partner-share/run", { job });
    await render();
    if (job === "clear") { toast(r.cleared ? `${plural(r.cleared, "share")} cleared.` : "Nothing new has cleared in Stripe."); return; }
    toast(r.paid ? `${usd(r.paid.cents)} sent to the manager. A payment notice went to them.` : r.skipped || "Nothing to pay.");
  };
  FORMS.rsSettings = async (f) => {
    if (!(await rsChange("Change the manager's terms.", { managerStaffId: f.managerStaffId.value, status: f.status.value, holdDays: Number(f.holdDays.value), activePct: Number(f.activePct.value), continuingPct: Number(f.continuingPct.value) }))) return;
    await render(); toast("Terms saved.");
  };
  // ---- Affiliates
  ACT.affEnabled = async (el) => {
    const on = el.getAttribute("aria-checked") !== "true";
    if (on && !confirm("Open the affiliate programme? Members will be able to earn commission on referrals. Do this only after your attorney has reviewed the programme and the affiliate terms.")) return;
    const password = await askOwnerPassword(on ? "Switch the affiliate programme on." : "Switch the affiliate programme off."); if (!password) { toast("Nothing was changed."); return; }
    await api("PUT", "/api/admin/affiliates/settings", { enabled: on, password });
    await render(); toast(on ? "The affiliate programme is open." : "The affiliate programme is closed. Nothing new is earned; what's owed is still paid.");
  };
  ACT.affStatus = async (el) => {
    const s = el.dataset.s, msg = { paused: "Pause this affiliate? No new commissions and no payouts until you resume.", removed: "Remove this affiliate? No new commissions, and what is payout ready is not paid out.", active: "Resume this affiliate?" }[s];
    if (!confirm(msg)) return;
    await api("PUT", `/api/admin/affiliates/${encodeURIComponent(el.dataset.id)}`, { status: s });
    await render(); toast("Saved.");
  };
  ACT.affAdjust = (el) => modal(`<div class="card-head"><h2>Adjust ${esc(el.dataset.name)}</h2>${xBtn}</div>
    <form class="stack" data-form="affAdjust"><input type="hidden" name="id" value="${esc(el.dataset.id)}">
      <div class="field"><label for="adjAmt">Amount ($, negative to take off)</label><input id="adjAmt" name="amount" class="input" type="number" step="0.01" min="-1000" max="1000" required></div>
      <div class="field"><label for="adjWhy">Reason (the affiliate sees this)</label><input id="adjWhy" name="reason" class="input" minlength="3" maxlength="200" required></div>
      <div class="row"><button class="btn primary">Add adjustment</button><button type="button" class="btn" data-act="closeModal">Cancel</button></div></form>`);
  ACT.affRun = async (el) => {
    const job = el.dataset.job;
    if (job === "payout" && !confirm("Pay out every affiliate whose payout-ready balance is over the minimum, now? This sends Stripe transfers.")) return;
    const r = await api("POST", "/api/admin/affiliates/run", { job });
    await render();
    if (job === "clear") { const n = Object.keys(r.moved || {}).length; toast(n ? `Holds ended for ${plural(n, "affiliate")}.` : "No holds were due."); return; }
    if (r.error) throw new Error(r.error);
    const why = [...new Set(r.skipped.map((x) => x.why))].join("; ");
    toast(`${r.paid.length} paid, ${r.skipped.length} skipped${why ? " (" + why + ")" : ""}, ${r.failed.length} failed${r.failed.length ? ": " + r.failed.map((f) => f.error).join("; ") : ""}.`);
  };
  ACT.affExport = async () => {
    const res = await fetch(`${API}/api/admin/affiliates/export`, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("The export could not be made.");
    const name = ((res.headers.get("content-disposition") || "").match(/filename="?([^";]+)"?/) || [])[1] || "mdfit-affiliate-commissions.csv";
    const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast("Exported. The file is in your downloads.");
  };
  FORMS.affSettings = async (f) => {
    const body = { ratePct: Number(f.ratePct.value), holdDays: Number(f.holdDays.value), minPayoutCents: Math.round(Number(f.minPayout.value) * 100), durationMonths: Number(f.durationMonths.value),
      eligibleTiers: [...f.querySelectorAll("[name=tier]:checked")].map((x) => x.value), eligibleAddOns: f.addOns.value.split(",").map((x) => x.trim()).filter(Boolean), freeMonthReward: f.freeMonth.checked };
    const password = await askOwnerPassword("Change the commission settings."); if (!password) { toast("Nothing was changed."); return; }
    await api("PUT", "/api/admin/affiliates/settings", { ...body, password });
    await render(); toast("Commission settings saved.");
  };
  FORMS.affAdjust = async (f) => {
    const cents = Math.round(Number(f.amount.value) * 100);
    await api("POST", "/api/admin/affiliates/adjust", { clientId: f.id.value, cents, reason: f.reason.value.trim() });
    closeModal(); await render(); toast("Adjustment added.");
  };

  // ---------------------------------------------------------------- "+" quick actions
  // One round button in reach on every screen: pick what to send or open, then who it is for (the open chart's
  // client is offered first), and it lands in the screen or form that already does that job. Nothing here talks to
  // the server by a route of its own, so what the client is sent is exactly what those screens send.
  const QA = [
    ["newclient", "New client", "clients", "Add a client, or email someone the sign-up link"],
    ["invoice", "Invoice", "payments", "Emails a pay link and notifies their app"],
    ["tele", "Telehealth invite", "telehealth", "Emails the join link and notifies their app"],
    ["book", "Booking link", "booking", "Emails a link to pick a time and notifies their app"],
    ["note", "Note", "notes", "Opens a new clinical note. The client is not notified"],
    ["forms", "Forms to sign", "forms", "Notifies their app and emails them to finish their documents"],
    ["program", "Program", "programs", "Add one on their chart. They are notified in the app and by email"],
    ["message", "Message", "messages", "Opens your conversation. They are notified when you send"]
  ];
  const QA_NEED = { newclient: "clients", invoice: "payments", tele: "telehealth", book: "chart", note: "notes", forms: "forms", program: "chart", message: "messages" }; // the screen each one lands in
  const qaMine = () => QA.filter(([k]) => navOk(QA_NEED[k]) && can("clients"));
  const QA_DOCK = new Set(["messages", "telehealth"]); // where a button in the corner would sit on the box to write in or the visit's controls
  const qa = { open: false, act: "", other: false, list: [], at: 0 };
  const qaHas = (words) => (c) => words.every((w) => `${c.name} ${c.email} ${c.phone || ""}`.toLowerCase().includes(w));
  // The client the menu acts on without asking: the one whose chart is on the screen
  const qaWho = () => (qa.other || shown !== "chart" || !state.chartClient ? null : (cache.clients || []).find((c) => c.id === state.chartClient) || (cache.chart && cache.chart.d && cache.chart.d.name ? { id: state.chartClient, name: cache.chart.d.name, email: cache.chart.d.email || "" } : null));
  function qaPlace() {
    const m = $("#qaMenu"), b = $("#qaBtn"); if (!m || !b || m.hidden) return;
    const r = b.getBoundingClientRect();
    m.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    if (b.classList.contains("docked")) { m.style.top = r.bottom + 8 + "px"; m.style.bottom = "auto"; m.style.maxHeight = `calc(100vh - ${Math.round(r.bottom + 24)}px)`; }
    else { m.style.bottom = window.innerHeight - r.top + 10 + "px"; m.style.top = "auto"; m.style.maxHeight = `${Math.max(200, Math.round(r.top - 26))}px`; }
  }
  // In the corner, except on the two screens where that corner is in use: there it moves into the bar at the top
  function qaSeat(r) {
    const b = $("#qaBtn"), top = $(".top"), corner = $("#qa"), view = $("#view"); if (!b || !top || !corner) return;
    const dock = QA_DOCK.has(r);
    if (dock && b.parentElement !== top) { top.insertBefore(b, $("#refreshBtn")); b.classList.add("docked"); }
    else if (!dock && b.parentElement !== corner) { corner.appendChild(b); b.classList.remove("docked"); }
    if (view) view.classList.toggle("fab-pad", !dock);
    qaPlace();
  }
  function qaList() {
    const res = $("#qaRes"); if (!res) return;
    res.innerHTML = qa.list.map((c, i) => `<button type="button" role="option" aria-selected="${i === qa.at}" class="qa-opt${i === qa.at ? " on" : ""}" data-act="qaPick" data-id="${esc(c.id)}">${avatar(c.name, 28)}<span><b>${esc(c.name)}</b><small>${esc(c.email)}</small></span></button>`).join("") || `<p class="qa-note">No client matches.</p>`;
  }
  // Results come from the list already in memory, so they are there as the key goes down; the server is only asked
  // when nothing in memory matches (someone who signed up a minute ago).
  function qaFill() {
    const box = $("#qaFind"); if (!box) return;
    const words = gWords(box.value), has = qaHas(words);
    const show = (list) => {
      const now = $("#qaFind"); if (!now || gWords(now.value).join(" ") !== words.join(" ")) return;
      const hit = (list || []).filter(has);
      if (words.length) { const starts = (c) => (String(c.name || "").toLowerCase().split(/\s+/).some((p) => p.startsWith(words[0])) ? 0 : 1); hit.sort((a, b) => starts(a) - starts(b) || String(a.name).localeCompare(String(b.name))); }
      else hit.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      qa.list = hit.slice(0, 8); qa.at = 0; qaList();
      const lab = $("#qaResLabel"); if (lab) lab.textContent = words.length ? "" : qa.list.length ? "Newest clients" : "";
    };
    if (cache.clients) show(cache.clients);
    (words.length ? clientsHit((l) => l.some(has), box) : clients()).then(show).catch(() => {});
  }
  function qaDraw(focus) {
    const m = $("#qaMenu"); if (!m) return;
    if (qa.act) {
      const a = QA.find((x) => x[0] === qa.act);
      m.innerHTML = `<div class="qa-head"><button type="button" class="btn sm ghost" data-act="qaBack" aria-label="Back to the actions">${ui("prev", 14)}</button><b style="flex:1">${a[1]} for</b></div>
        <div class="search in qa-find">${ui("search", 15)}<input id="qaFind" type="search" autocomplete="off" placeholder="Name or email" aria-label="Find the client for this ${a[1].toLowerCase()}" role="combobox" aria-controls="qaRes" aria-expanded="true"></div>
        <p class="qa-note" id="qaResLabel"></p><div id="qaRes" role="listbox" aria-label="Clients"></div>`;
      qaFill(); if (focus !== false) $("#qaFind").focus();
    } else {
      const who = qaWho();
      m.innerHTML = `<div class="qa-head" id="qaFor">${who ? `<span class="who">For <b>${esc(who.name)}</b></span><button type="button" class="btn sm" data-act="qaOther">Someone else</button>` : `<b>Quick actions</b><span class="muted" style="font-size:12px">Pick one, then the client</span>`}</div>
        ${qaMine().map(([k, label, icon, sub]) => `<button type="button" class="qa-row" data-act="qaDo" data-k="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[icon]}</svg><span><b>${label}</b><small>${sub}</small></span></button>`).join("")}`;
      if (focus !== false) { const first = m.querySelector(".qa-row"); if (first) first.focus(); }
    }
    qaPlace();
  }
  function qaOpen() { const m = $("#qaMenu"), b = $("#qaBtn"); qa.open = true; qa.act = ""; qa.other = false; m.hidden = false; b.setAttribute("aria-expanded", "true"); qaDraw(); clients().catch(() => {}); }
  function qaClose(back) { const m = $("#qaMenu"), b = $("#qaBtn"); if (!qa.open) return; qa.open = false; m.hidden = true; m.innerHTML = ""; b.setAttribute("aria-expanded", "false"); if (back) b.focus(); }
  // Go to a screen and wait until it is drawn (the address changes too, so Back works as usual)
  const qaGo = async (r) => { if (location.hash !== "#" + r) history.pushState(null, "", "#" + r); await render(); };
  async function qaChart(id, tab) {
    const there = shown === "chart" && state.chartClient === id && cache.chart;
    if (there && (!tab || state.chartTab === tab)) return;
    state.chartClient = id; state.chartTab = tab || "overview"; await qaGo("chart");
  }
  async function qaRun(k, c) {
    qaClose(); const first = String(c.name || "").split(" ")[0];
    if (k === "invoice") { // the invoice generator, with this person already added
      if (!cache.gen) cache.gen = await load("/invoices").catch(() => null);
      ACT.igNew(); state.igPeople = [{ id: c.id, name: c.name, email: c.email }]; igDraw(); const d = $("#igDesc"); if (d) d.focus();
    } else if (k === "tele") { // the invitation the Telehealth screen sends; its own notice says how they were told
      if (!(window.MDFitRT && MDFitRT.connected())) { toast("Not connected to the live service. Reload the page."); return; }
      ACT.teleInvite({ dataset: { id: c.id } }); await qaGo("telehealth");
    } else if (k === "book") { await qaChart(c.id); await ACT.book(); const t = $("#blType"); if (t) { t.closest("form").scrollIntoView({ block: "nearest" }); t.focus(); } }
    else if (k === "note") {
      if (route() === "notes" && shown === "notes") { if (note.clientId !== c.id) await noteClientSwitch(c.id); } else { state.chartClient = c.id; await qaGo("notes"); }
      const box = $("#nBody"); if (box) box.focus();
    } else if (k === "forms") { const b = document.createElement("button"); b.dataset.id = c.id; b.dataset.name = c.name; await ACT.intakeRemind(b); }
    else if (k === "program") { await qaChart(c.id, "plans"); const card = $("#chartPrograms"); if (card) { card.scrollIntoView({ block: "start" }); const add = card.querySelector("[data-act=prAssign]"); if (add) add.focus({ preventScroll: true }); } toast(`Pick a program to add for ${first}. They are notified in the app and by email.`); }
    else if (k === "message") { // the conversation is drawn a moment after the list of people, so the box to write in is waited for
      state.thread = c.id; await qaGo("messages");
      for (let i = 0; i < 40 && routeNow() === "messages" && state.thread === c.id; i++) { const box = $(".composer input[name=body]"); if (box && cache.msgShown === c.id) { box.focus(); break; } await new Promise((go) => setTimeout(go, 100)); }
    }
  }
  Object.assign(ACT, {
    qaToggle: () => (qa.open ? qaClose() : qaOpen()),
    qaOther: () => { qa.other = true; qaDraw(); },
    qaBack: () => { qa.act = ""; qaDraw(); },
    qaDo: (el) => { if (el.dataset.k === "newclient") { qaClose(); return ACT.clientAdd(); } const who = qaWho(); if (who) return qaRun(el.dataset.k, who); qa.act = el.dataset.k; qaDraw(); },
    qaPick: (el) => { const c = qa.list.find((x) => x.id === el.dataset.id) || (cache.clients || []).find((x) => x.id === el.dataset.id); if (c) return qaRun(qa.act, c); }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "qaFind") qaFill(); });
  document.addEventListener("keydown", (e) => {
    if (!qa.open) return;
    if (e.key === "Escape") { e.preventDefault(); qaClose(true); return; }
    if (e.target.id !== "qaFind" || e.isComposing) return;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && qa.list.length) { e.preventDefault(); qa.at = (qa.at + (e.key === "ArrowDown" ? 1 : qa.list.length - 1)) % qa.list.length; qaList(); const on = $("#qaRes .on"); if (on) on.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); const c = qa.list[qa.at]; if (c && token) guard(qaRun)(qa.act, c); }
  });
  // A press anywhere else puts the menu away (looked at before the buttons inside it redraw anything)
  document.addEventListener("pointerdown", (e) => { if (qa.open && !(e.target.closest && e.target.closest("#qaMenu, #qaBtn"))) qaClose(); }, true);
  window.addEventListener("hashchange", () => qaClose());
  window.addEventListener("resize", qaPlace);
  // A restored session keeps its old last-input time: a reload must not hand out a fresh 15 minutes
  if (token && idleFor() >= IDLE_MS) idleOut();
  else if (token) { if (!idleFor()) idleStamp(); start(); } else { $("#signin").hidden = false; $("#app").hidden = true; }
})();
