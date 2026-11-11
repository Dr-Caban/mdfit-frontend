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
  const notBuilt = (what) => `<div class="card">${none(`${what} is not connected yet: the server has nothing for it.`)}</div>`;

  // ---------------------------------------------------------------- session
  const KEY = "mdfit_ws_token";
  const store = { get: () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } }, set: (t) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch {} } };
  let token = store.get();
  const state = { chartClient: null, chartTab: "overview", thread: null, calWeek: 0, clientQ: "", insTab: "analytics", insDays: 30, picked: new Set() };
  const cache = { clients: null, unread: 0, waiting: 0, me: null };

  async function api(method, path, body) {
    const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && path !== "/api/admin/login") { signOut(); throw new Error("Session expired. Sign in again."); }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    if (!res.ok) throw new Error((data && data.error) || "Request failed.");
    return data;
  }
  const get = (p) => api("GET", "/api/admin" + p);

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600); }
  function modal(html) { $("#modal").classList.remove("wide"); $("#modal").innerHTML = html; $("#modalBack").classList.add("open"); $("#modal").querySelector("button,input,select,textarea")?.focus(); }
  function closeModal() { $("#modalBack").classList.remove("open"); $("#modal").innerHTML = ""; $("#modal").classList.remove("wide"); }
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

  // Signing out empties everything that was drawn, so names and notes do not stay on a shared screen.
  function signOut() {
    token = ""; store.set(""); if (window.MDFitRT) { if (teleIn()) MDFitRT.emit("tele_end"); MDFitRT.disconnect(); } teleDrop(); stopDictation();
    for (const k of Object.keys(cache)) cache[k] = (k === "unread" || k === "waiting") ? 0 : null; // every cached list, the open chart included
    state.chartClient = null; state.thread = null; state.clientQ = ""; state.scribeText = ""; tele.transcript = ""; noteReset(null);
    $("#view").innerHTML = ""; $("#nav").innerHTML = ""; $("#whoami").textContent = ""; $("#globalSearch").value = ""; closeModal();
    $("#app").hidden = true; $("#signin").hidden = false; clearTimeout(idleTimer);
    // /admin shares this tab: signing out here signs out there as well
    try { sessionStorage.removeItem("mdfit_token"); sessionStorage.removeItem(ACTIVE_KEY); } catch {}
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
  document.addEventListener("visibilitychange", () => { if (!document.hidden) idleCheck(); });
  window.addEventListener("pageshow", idleCheck); window.addEventListener("focus", idleCheck);

  $("#signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#siMsg"); msg.textContent = "";
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
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
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
    newsletter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    insights: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    team: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    feedback: '<path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.8 6.5 19.5l1-6.3L3 8.9 9 8z"/>',
    security: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    portal: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    booking: '<path d="M3 9h18M7 3v4M17 3v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="m9 15 2 2 4-4"/>'
  };
  const NAV = [
    { g: "Practice", items: [["dashboard", "Dashboard"], ["calendar", "Calendar"], ["clients", "Clients"], ["chart", "Client chart"], ["leads", "Leads"], ["messages", "Messages"], ["telehealth", "Telehealth"]] },
    { g: "Clinical", items: [["notes", "Notes & AI scribe"], ["forms", "Forms & intake"], ["programs", "Programs"], ["nutrition", "Nutrition"], ["fitness", "Fitness"]] },
    { g: "Business", items: [["payments", "Payments"], ["newsletter", "Newsletter"]] },
    { g: "Admin", items: [["team", "Team & roles"], ["feedback", "Reviews & feedback"], ["security", "Security & audit"], ["settings", "Modules & settings"], ["insights", "Insights"]] },
    { g: "Client-facing", items: [["portal", "Client app"], ["booking", "Booking page"]] }
  ];
  function renderNav(active) {
    const badge = (id) => id === "messages" && cache.unread ? `<span class="badge">${cache.unread}</span>` : id === "clients" && cache.waiting ? `<span class="badge">${cache.waiting}</span>` : "";
    $("#nav").innerHTML = `<div class="brand"><div class="logo"><img src="assets/logo.webp" alt="" width="160" height="160"></div><div><b>MD Fit</b><div class="muted" style="font-size:12px">Physical Rehab &amp; Fitness</div></div></div>` +
      NAV.map((g) => `<div class="nav-group"><span>${g.g}</span>${g.items.map(([id, label]) => `<a href="#${id}" class="${active === id ? "active" : ""}"><svg viewBox="0 0 24 24">${ICON[id]}</svg>${label}${badge(id)}</a>`).join("")}</div>`).join("") +
      `<div class="nav-group"><a href="/admin-classic" class="muted" style="font-size:12.5px">Earlier admin screens</a></div>`;
  }

  async function clients(fresh) { if (fresh || !cache.clients) cache.clients = await get("/clients"); return cache.clients; }
  const byEmail = (list, email) => list.find((c) => c.email && email && c.email.toLowerCase() === String(email).toLowerCase());
  function openChart(id) { state.chartClient = id; state.chartTab = "overview"; if (location.hash === "#chart") render(); else location.hash = "chart"; }

  // ---------------------------------------------------------------- screens
  const V = {};
  const kpi = (label, val, sub, kind) => `<div class="card kpi"><span class="muted">${label}</span><b class="num">${val}</b><small class="${kind ? "pill " + kind : "muted"}">${sub}</small></div>`;
  const statusPill = (s) => `<span class="pill ${s === "completed" ? "ok" : s === "cancelled" || s === "no-show" ? "bad" : ""}">${esc(s || "booked")}</span>`;
  function apptRow(a, list) {
    const c = byEmail(list, a.email);
    return `<div class="list-item"><span class="num muted" style="width:150px">${fmtDate(a.date)} · ${fmtTime(a.time)}</span><span class="dot" style="background:var(--body)"></span>
      <div style="flex:1;min-width:0"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${esc(a.typeName || a.typeId)} · ${a.minutes || "—"} min</div></div>
      ${statusPill(a.status)}<button class="btn sm" data-act="appt" data-id="${esc(a.id)}">Details</button>${c ? `<button class="btn sm" data-act="chart" data-id="${esc(c.id)}">Chart</button>` : ""}</div>`;
  }

  V.dashboard = async () => {
    const [st, msgs, emr, list] = await Promise.all([get("/stats"), get("/messages"), get("/emr"), clients()]);
    cache.unread = msgs.unread || 0; cache.waiting = emr.waiting.length; renderNav("dashboard");
    const h = new Date().getHours(), hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const paidWaiting = emr.patients.concat(emr.waiting).reduce((n, p) => n + (p.paidVisits || 0), 0);
    const attention = [
      emr.waiting.length ? [`${plural(emr.waiting.length, "member")} finished documents and can be made a patient`, "clients"] : null,
      st.leadsNew ? [`${plural(st.leadsNew, "new request")} from the website`, "leads"] : null,
      cache.unread ? [`${plural(cache.unread, "unread message")}`, "messages"] : null,
      paidWaiting ? [`${plural(paidWaiting, "paid video visit")} still need a time`, "clients"] : null
    ].filter(Boolean);
    return `
    <div class="view-head"><div><h1>${hello}</h1><p class="muted">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · ${plural(st.appointmentsToday, "appointment")} today</p></div>
    <div class="row"><a class="btn" href="#calendar">Open calendar</a><a class="btn primary" href="#clients">Clients</a></div></div>
    <div class="grid g4" style="margin-bottom:16px">
      ${kpi("Today", st.appointmentsToday, "appointments")}${kpi("Next 7 days", st.appointmentsWeek, "appointments")}
      ${kpi("New requests", st.leadsNew, `${st.leads30d} in the last 30 days`, st.leadsNew ? "warn" : "")}${kpi("Unread messages", cache.unread, "from members", cache.unread ? "warn" : "")}
    </div>
    <div class="grid g-side">
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Today's schedule</h2></div>${(st.today || []).map((a) => apptRow(a, list)).join("") || none("No appointments today.")}</div>
        <div class="card"><div class="card-head"><h2>Coming up</h2></div>${(st.nextAppointments || []).map((a) => apptRow(a, list)).join("") || none("Nothing booked in the next week.")}</div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Needs attention</h2></div>
          ${attention.map(([t, to]) => `<div class="list-item"><span class="dot" style="background:var(--warn)"></span><span style="flex:1">${t}</span><a class="btn sm" href="#${to}">Open</a></div>`).join("") || none("Nothing needs attention.")}</div>
        <div class="card"><div class="card-head"><h2>Classes this week</h2></div>
          ${(st.upcoming || []).map((c) => `<div class="list-item"><span style="flex:1"><b>${esc(c.title)}</b><div class="muted" style="font-size:12px">${esc(c.dayName)} ${fmtTime(c.time)} · ${esc(c.coach || "")}</div></span><span class="pill">${c.capacity - c.spotsLeft}/${c.capacity} booked</span></div>`).join("") || none("No classes scheduled.")}</div>
      </div>
    </div>`;
  };

  // Week grid, Monday to Sunday, 6 AM to 8 PM. 56px per hour.
  V.calendar = async () => {
    const now = new Date(), mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + state.calWeek * 7);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
    // The practice's other calendars (SimplePractice, Google Calendar) for the week on screen, drawn behind MD Fit's
    // own visits. Google events carry their titles (shown here only, never stored); anything else is a "Busy" block.
    const [appts, classes, bookings, sync] = await Promise.all([get("/appointments?all=1"), get("/classes"), get("/bookings"),
      get(`/busy?from=${isoDay(mon)}&days=7`).catch(() => null)]);
    cache.appts = appts; cache.classes = classes;
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
    <a class="btn sm" href="#settings">Hours &amp; calendar sync</a></div></div>
    <div class="row" style="margin-bottom:12px"><span class="pill"><span class="dot" style="background:var(--body)"></span>Booked</span><span class="pill"><span class="dot" style="background:var(--ok)"></span>Completed</span><span class="pill"><span class="dot" style="background:var(--fit)"></span>Class</span><span class="pill"><span class="dot" style="background:var(--muted)"></span>Your other calendars</span>
    <span class="muted" style="font-size:12.5px">${!sync ? "Your other calendars could not be read just now." : sync.simplepractice === "off" && sync.google === "off" ? "No outside calendar is connected, so only MD Fit bookings show." : `Showing ${[sync.simplepractice !== "off" && "SimplePractice", sync.google !== "off" && "Google Calendar"].filter(Boolean).join(" and ")}${sync.titles ? " events, shown only on this screen" : " busy times (times only)"}${sync.lastError ? ". Last sync reported a problem" : ""}.`}</span></div>
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
    const [list, emr] = await Promise.all([clients(true), get("/emr"), content()]);
    cache.waiting = emr.waiting.length; renderNav("clients");
    const patients = new Set(emr.patients.map((p) => p.id)), waiting = new Set(emr.waiting.map((p) => p.id));
    const q = state.clientQ.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((c) => q.every((w) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(w)));
    return `
    <div class="view-head"><div><h1>Clients</h1><p class="muted">${plural(list.length, "account")} · ${plural(patients.size, "active patient")} · ${waiting.size} waiting to be converted</p></div>
    <div class="row"><input class="input" id="clientQ" style="width:240px" placeholder="Filter by name, email or phone" value="${esc(state.clientQ)}" aria-label="Filter clients"><button class="btn" data-act="exportAsk" id="exportBtn">${ui("download", 14)} <span id="exportLabel">${state.picked.size ? `Export ${state.picked.size} selected` : "Export all"}</span></button></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th style="width:34px"><input type="checkbox" data-change="pickAll" aria-label="Select everyone shown"${shown.length && shown.every((c) => state.picked.has(c.id)) ? " checked" : ""}></th><th>Client</th><th>Status</th><th>Documents</th><th>Next visit</th><th>Membership</th><th>Last sign-in</th></tr></thead>
      <tbody id="clientRows">${clientRows(shown, patients, waiting) || noneRow(7, list.length ? "No one matches." : "No clients yet.")}</tbody>
    </table></div></div>`;
  };
  function clientRows(list, patients, waiting) {
    return list.map((c) => `<tr class="click" data-act="chart" data-id="${esc(c.id)}">
      <td data-act="stop"><input type="checkbox" data-change="pickOne" data-id="${esc(c.id)}" aria-label="Select ${esc(c.name)}"${state.picked.has(c.id) ? " checked" : ""}></td>
      <td><div class="row">${avatar(c.name)}<div style="min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.email)}${c.phone ? " · " + esc(c.phone) : ""}</div></div></div></td>
      <td>${patients.has(c.id) ? `<span class="pill ok">Active patient</span>` : waiting.has(c.id) ? `<span class="pill warn">Waiting</span>` : `<span class="pill">Member</span>`}${c.clientType === "inpatient" ? ` <span class="pill">Inpatient</span>` : ""}</td>
      <td>${c.documents ? (c.documents.complete ? `<span class="pill ok">Complete</span>` : `${c.documents.done} of ${c.documents.total}`) : "—"}</td>
      <td class="num">${c.next ? `${fmtDate(c.next.date)} · ${fmtTime(c.next.time)}` : `<span class="muted">Not booked</span>`}</td>
      <td data-act="stop"><select class="input tier-pick${c.membership ? " on" : ""}" data-change="rowTier" data-id="${esc(c.id)}" data-name="${esc(c.name)}" aria-label="Membership type for ${esc(c.name)}">${tierOptions((c.membership && c.membership.tier) || "")}</select></td>
      <td class="muted">${when(c.lastLoginAt)}</td></tr>`).join("");
  }

  // ---- Client chart. Every sub-tab is worked from here: nothing is handed off to another screen to edit.
  const usd = (cents) => "$" + (Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sizeOf = (n) => (n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB");
  const tiers = () => (cache.content && cache.content.tiers) || [];
  const tierName = (id) => (tiers().find((x) => x.id === id) || {}).name || id || "";
  const tierOptions = (cur) => `<option value="">No membership</option>${tiers().map((t) => `<option value="${esc(t.id)}"${cur === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}`;
  const content = async () => cache.content || (cache.content = await get("/content").catch(() => ({ programs: [], tiers: [] })));
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
      const emr = await get("/emr");
      const pick = (p) => `<div class="list-item"><span style="flex:1"><b>${esc(p.name)}</b> <span class="muted">${esc(p.email)}</span></span><button class="btn sm" data-act="chart" data-id="${esc(p.id)}">Open chart</button></div>`;
      return `<div class="view-head"><div><h1>Client chart</h1><p class="muted">Pick a client to open their chart</p></div><a class="btn" href="#clients">All clients</a></div>
      <div class="grid g2"><div class="card"><div class="card-head"><h2>Active patients</h2></div>${emr.patients.map(pick).join("") || none("No active patients yet.")}</div>
      <div class="card"><div class="card-head"><h2>Waiting to be converted</h2></div>${emr.waiting.map(pick).join("") || none("Nobody is waiting.")}</div></div>`;
    }
    const [d, c, cn] = await Promise.all([get(`/emr/${id}`), get(`/clients/${id}`), get(`/notes?clientId=${id}`).catch(() => ({ notes: [] })), content()]);
    cache.chart = { d, c, cn: cn.notes || [] }; cache.billing = null;
    const tabs = [["overview", "Overview"], ["notes", "Clinical notes"], ["plans", "Plans & protocols"], ["measures", "Measures"], ["meds", "Meds & allergies"], ["files", "Files"], ["billing", "Billing"], ["consent", "Sharing & consent"]];
    const tier = (c.membership && c.membership.tier) || "";
    return `
    <div class="view-head"><div class="row" style="gap:14px">${avatar(d.name, 52)}<div style="min-width:0"><h1>${esc(d.name)}</h1>
      <p class="muted">${esc(d.email)}${d.phone ? " · " + esc(d.phone) : ""} · Next: ${d.nextVisit ? `${fmtDate(d.nextVisit.date)} ${fmtTime(d.nextVisit.time)}` : "nothing booked"}</p>
      <div class="row" style="margin-top:6px" id="chartPills">${chartPills()}</div></div></div>
      <div class="row"><button class="btn ${d.patient ? "" : "primary"}" data-act="convert" data-on="${d.patient ? "0" : "1"}">${d.patient ? "Mark as not a patient" : "Convert to active patient"}</button>
      <button class="btn" data-act="thread" data-id="${esc(id)}">Message</button><button class="btn" data-act="book">Book</button><button class="btn ${d.patient ? "primary" : ""}" data-act="chartNewNote">${ui("plus", 14)} Note</button><a class="btn" href="#chart" data-act="chartClose">Other client</a></div></div>
    <div class="row chart-types"><label for="chTier">Membership</label><select id="chTier" class="input" data-change="chartTier">${tierOptions(tier)}</select>
      <label for="chType">Client type</label><select id="chType" class="input" data-change="chartType"><option value="outpatient"${d.clientType !== "inpatient" ? " selected" : ""}>Outpatient</option><option value="inpatient"${d.clientType === "inpatient" ? " selected" : ""}>Inpatient (visits not charged)</option></select></div>
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
        <div class="card stack"><div class="card-head"><h2>Protocols for ${first}</h2><span class="muted" style="font-size:12px">Type one, or pick from the lists below</span></div>
          <form class="stack" data-form="protocol"><div class="field"><label for="prName">Protocol</label><input id="prName" name="name" class="input" maxlength="80" required placeholder="e.g. ACL phase 1, weeks 0 to 2" list="prNames" autocomplete="off"><datalist id="prNames"></datalist></div>
          <div class="field"><div class="row" style="justify-content:space-between"><label for="prDetail">What to do</label><button type="button" class="btn sm mic" data-act="dictate" data-for="prDetail" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div><textarea id="prDetail" name="detail" class="input" rows="4" maxlength="1000" placeholder="Steps, sets and reps, how often, what to avoid"></textarea></div>
          <div class="row"><button class="btn primary">Add to ${first}'s program</button></div></form>
          ${(plan.exercises || []).map((x, i) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(x.name)}</b>${x.detail ? `<div class="muted note-text" style="font-size:12.5px">${esc(x.detail)}</div>` : ""}</span><button class="btn sm danger" data-act="prRemove" data-i="${i}">Remove</button></div>`).join("") || none(`Nothing in ${first}'s program yet.`)}</div></div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><div class="card-head"><h2>All protocols</h2><span class="muted" style="font-size:12px">Everything you have written, most used first</span></div><div id="prPool">${none("Loading…")}</div></div>
        <div class="card"><div class="card-head"><h2>All programs</h2><span class="muted" style="font-size:12px">${plural(progs.length, "program")} in the library</span></div>
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
          ${d.visits.map((v) => `<div class="list-item"><span style="flex:1"><b>${esc(v.typeName)}</b><div class="muted" style="font-size:12px">${fmtDate(v.date)} ${fmtTime(v.time)} · ${v.minutes} min</div></span>${v.payment === "paid" ? `<span class="pill ok">Paid</span>` : v.payment === "exempt" ? `<span class="pill">Inpatient</span>` : ""}</div>`).join("")}
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
        <form class="stack" data-form="consent"><div class="grid g2"><div class="field"><label for="csTitle">Consent</label><input id="csTitle" name="title" class="input" maxlength="120" required list="csTitles" placeholder="Release of records" autocomplete="off"><datalist id="csTitles">${["Release of records to another provider", "Telehealth consent", "Photo and video consent", "Email and text message consent", "Sharing with a family member or caregiver"].map((n) => `<option value="${n}">`).join("")}</datalist></div>
          <div class="field"><label for="csDetail">Who or what it covers</label><input id="csDetail" name="detail" class="input" maxlength="500" placeholder="Dr. Lee, orthopedics: visit notes"></div></div>
          <div class="grid g3"><div class="field"><label for="csOn">Signed on</label><input id="csOn" name="signedOn" type="date" class="input" value="${today}" max="${today}"></div><div class="field"><label for="csExp">Expires (optional)</label><input id="csExp" name="expires" type="date" class="input" min="${today}"></div>
            <div class="field"><label for="csHow">How it was given</label><select id="csHow" name="how" class="input"><option value="in person">Signed in person</option><option value="electronic">Signed electronically</option><option value="verbal">Verbal, noted by staff</option></select></div></div>
          <div class="row"><button class="btn primary">Record consent</button></div></form></div>`; }
    return "";
  }
  // What a tab needs once it is on screen
  function chartAfter() {
    if (state.chartTab === "plans") { loadPool(); loadProtocols(); }
    if (state.chartTab === "billing") loadBilling();
  }
  async function loadProtocols() {
    const r = await get("/emr/protocols").catch(() => ({ protocols: [] })), box = $("#prPool"); if (!box) return;
    cache.protocols = r.protocols || [];
    const mine = new Set(((cache.chart.c.plan || {}).exercises || []).map((x) => String(x.name).toLowerCase())), first = esc(String(cache.chart.d.name).split(" ")[0]);
    box.innerHTML = cache.protocols.map((p, i) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(p.name)}</b> <span class="muted" style="font-size:12px">used ${p.uses}×</span>${p.detail ? `<div class="muted note-text" style="font-size:12.5px">${esc(p.detail)}</div>` : ""}</span>${mine.has(p.name.toLowerCase()) ? `<span class="pill ok">In program</span>` : `<button class="btn sm" data-act="prPick" data-i="${i}">Add to ${first}'s program</button>`}</div>`).join("") || none("Nothing written yet. Type the first one above.");
    const dl = $("#prNames"); if (dl) dl.innerHTML = cache.protocols.map((p) => `<option value="${esc(p.name)}">`).join("");
  }
  const STATUS = { paid: "ok", unpaid: "warn", void: "", failed: "bad", refunded: "", pending: "warn" };
  async function loadBilling() {
    const id = state.chartClient, b = await get(`/emr/${id}/billing`).catch((e) => ({ error: e.message, invoices: [] }));
    if (state.chartClient !== id || !$("#billRows")) return;
    cache.billing = b;
    $("#billRows").innerHTML = b.error ? noneRow(6, esc(b.error)) : b.invoices.map((x) => `<tr><td>${esc(x.number || "—")}</td><td>${x.date ? fmtDate(x.date) : "—"}</td><td>${esc(x.description || "")}</td><td class="num">${x.amount == null ? "—" : usd(x.amount)}</td>
      <td><span class="pill ${STATUS[x.status] ?? "ok"}">${esc(x.status === "paid" && x.method ? `Paid · ${x.method}` : x.status.charAt(0).toUpperCase() + x.status.slice(1))}</span></td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap;justify-content:flex-end">${x.custom && x.status === "unpaid" ? `<button class="btn sm primary" data-act="invSend" data-id="${esc(x.id)}">Send invoice</button><button class="btn sm" data-act="invPay" data-id="${esc(x.id)}">Mark paid</button><button class="btn sm ghost" data-act="invVoid" data-id="${esc(x.id)}" aria-label="Void invoice ${esc(x.number)}">${ui("x", 14)}</button>` : x.custom && !x.online && (x.status === "paid" || x.status === "void") ? `<button class="btn sm" data-act="invUnpaid" data-id="${esc(x.id)}">Mark unpaid</button>` : x.receiptUrl ? `<a class="btn sm" href="${esc(x.receiptUrl)}" target="_blank" rel="noopener noreferrer">Receipt</a>` : ""}</div></td></tr>`).join("") || noneRow(6, "No invoices or payments yet.");
    $("#billPay").innerHTML = `<div class="list-item"><span style="flex:1">Card on file${b.card && b.card.exp ? `<div class="muted" style="font-size:12px">expires ${esc(b.card.exp)}</div>` : ""}</span><b>${b.card ? `${esc(b.card.brand.charAt(0).toUpperCase() + b.card.brand.slice(1))} ••${esc(b.card.last4)}` : "None"}</b><button type="button" class="btn sm${b.card ? "" : " primary"}" data-act="cardAdd">${b.card ? "Replace" : "Add card"}</button></div>
      <div class="list-item"><span style="flex:1">Autopay</span><span class="pill ${b.autopay ? "ok" : ""}">${b.autopay ? "On" : "Off"}</span></div>
      <div class="list-item"><span style="flex:1">Balance</span><b class="num">${usd(b.balance || 0)}</b></div>`;
  }

  V.leads = async () => {
    const list = await get("/leads");
    const STAT = ["new", "contacted", "booked", "client", "closed"];
    return `<div class="view-head"><div><h1>Leads</h1><p class="muted">Requests from the website · ${plural(list.filter((l) => l.status === "new").length, "new request")}</p></div></div>
    <div class="stack">${list.map((l) => `<div class="card" data-lead="${esc(l.id)}"><div class="card-head"><div style="min-width:0"><h2>${esc(l.name)}</h2><span class="muted">${esc(l.email)}${l.phone ? " · " + esc(l.phone) : ""} · ${when(l.createdAt)}</span></div>
      <select class="input" style="width:auto" data-change="leadStatus" aria-label="Status">${STAT.map((s) => `<option${s === l.status ? " selected" : ""}>${s}</option>`).join("")}</select></div>
      <dl class="kv">${l.service ? `<dt>Service</dt><dd>${esc(l.service)}</dd>` : ""}${l.goal ? `<dt>Goal</dt><dd>${esc(l.goal)}</dd>` : ""}${(l.areas || []).length ? `<dt>Areas</dt><dd>${esc(l.areas.join(", "))}</dd>` : ""}${l.painLevel != null ? `<dt>Pain</dt><dd>${esc(l.painLevel)}/10</dd>` : ""}${l.duration ? `<dt>How long</dt><dd>${esc(l.duration)}</dd>` : ""}${l.message ? `<dt>Message</dt><dd>${esc(l.message)}</dd>` : ""}</dl>
      <div class="field" style="margin-top:10px"><label>Your notes<textarea class="input" rows="2" data-lead-notes>${esc(l.notes || "")}</textarea></label></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="leadSave">Save notes</button><button class="btn sm danger" data-act="leadDelete">Delete</button></div></div>`).join("") || `<div class="card">${none("No requests yet.")}</div>`}</div>`;
  };

  V.messages = async () => {
    const t = await get("/messages"); cache.unread = t.unread || 0;
    if (!t.threads.find((x) => x.clientId === state.thread)) state.thread = t.threads[0] ? t.threads[0].clientId : null;
    const th = state.thread ? await get(`/messages/${state.thread}`) : null;
    renderNav("messages");
    return `<div class="view-head"><div><h1>Messages</h1><p class="muted">Conversations with members · stored encrypted on the server</p></div><button type="button" class="btn" data-act="broadcast">${ui("broadcast", 15)}Broadcast</button></div>
    <div class="card chat" style="padding:0">
      <div class="threads">${t.threads.map((x) => `<div class="thread ${x.clientId === state.thread ? "active" : ""}" data-act="thread" data-id="${esc(x.clientId)}">${avatar(x.name, 36)}<div style="flex:1;min-width:0"><div class="row" style="justify-content:space-between"><b>${esc(x.name)}</b>${x.unread ? `<span class="badge">${x.unread}</span>` : ""}</div><div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x.last ? (x.last.from === "doctor" ? "You: " : "") + esc(x.last.body) : ""}</div></div></div>`).join("") || `<p class="muted" style="padding:16px;margin:0">No messages yet.</p>`}</div>
      <div class="msgs">${th ? `<div style="padding:12px 16px;border-bottom:1px solid var(--line)" class="row"><b>${esc(th.client.name)}</b><span class="muted" style="font-size:12px">${esc(th.client.email)}</span><button class="btn sm" style="margin-left:auto" data-act="chart" data-id="${esc(th.client.id)}">Chart</button></div>
        <div class="msg-list" id="msgList">${th.messages.map((m) => `<div class="bubble ${m.from === "doctor" ? "me" : ""}">${esc(m.body)}<div class="muted" style="font-size:11px;margin-top:2px">${when(m.at)}</div></div>`).join("")}</div>
        <form class="composer" data-form="message"><input name="body" class="input" placeholder="Write a message" autocomplete="off" maxlength="4000" aria-label="Message" required><button class="btn primary">Send</button></form>` : `<p class="muted" style="padding:16px;margin:0">Pick a conversation.</p>`}</div>
    </div>`;
  };

  V.telehealth = async () => {
    const [appts, settings] = await Promise.all([get("/appointments?all=1"), get("/settings")]), today = isoDay(new Date());
    const room = (settings.booking && settings.booking.telehealthUrl) || "", own = location.origin + "/visit", usingOwn = room === own;
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
        <div class="card"><div class="card-head"><h2>Waiting room</h2><span class="pill" id="teleCount">Empty</span></div><div id="teleWaiting"></div><div id="telePending"></div></div>
        <div class="card" id="teleRoomCard" hidden><div class="card-head"><h2>In the room</h2><span class="pill" id="teleRoomCount"></span></div><div id="teleRoom"></div></div>
        <div class="card"><div class="card-head"><h2>Session tools</h2></div>
          <div class="list-item"><span style="flex:1;min-width:0">Live room<div class="muted" style="font-size:12px" id="telePeople">One to one · private</div></span><label class="toggle"><input type="checkbox" id="teleGroupSw" data-change="teleGroup" aria-label="Live room: admit several people as viewers"><span></span></label></div>
          <div class="list-item"><span style="flex:1;min-width:0">Live transcription → AI scribe<div class="muted" style="font-size:12px" id="teleWords">Starts with a visit</div></span><label class="toggle"><input type="checkbox" id="teleScribeSw" data-change="teleScribe" aria-label="Live transcription" disabled><span></span></label></div>
          <div class="list-item"><span style="flex:1;min-width:0">Pain check-in<div class="muted" style="font-size:12px" id="telePain"></div></span><button type="button" class="btn sm" id="telePainBtn" data-act="telePain" disabled>Send</button></div>
          <div class="list-item"><span style="flex:1">Encryption</span><span class="pill ok">DTLS-SRTP</span></div>
          <div class="list-item"><span style="flex:1">Recording</span><span class="pill">Never recorded</span></div></div>
        <div class="card stack"><div class="card-head"><h2>Session link</h2><span class="pill ${usingOwn ? "ok" : "warn"}">${usingOwn ? "Sent with video bookings" : room ? "Another link is in use" : "Not sent yet"}</span></div>
          <p class="muted" style="margin:0;font-size:13px;overflow-wrap:anywhere">${esc(own)}</p>
          <p class="muted" style="margin:0;font-size:12px">Patients sign in, check their camera and wait here until you admit them. ${usingOwn ? "Every video booking is sent this link." : room ? `Video bookings are currently sent ${esc(room)}.` : "Video bookings are not sent a link yet."}</p>
          ${usingOwn ? "" : `<div class="row"><button type="button" class="btn sm primary" data-act="useOwnRoom">Send this link with every video booking</button></div>`}
          <details><summary class="muted" style="font-size:12px;cursor:pointer">Use a different video service instead</summary>
            <form class="row" data-form="roomLink" style="align-items:flex-end;margin-top:8px"><div class="field" style="flex:1;min-width:200px;margin:0"><label for="roomUrl">Room link</label><input id="roomUrl" name="url" class="input" type="url" inputmode="url" placeholder="https://" value="${esc(usingOwn ? "" : room)}" maxlength="500"></div><button class="btn sm">Save</button></form></details></div>
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
    const [list, scribe] = await Promise.all([clients(), get("/scribe").catch(() => ({ enabled: false }))]);
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
        ${scribe.model || scribe.host ? `<div class="row" style="justify-content:space-between;font-size:12.5px"><span class="muted" style="overflow-wrap:anywhere">Model: <b id="sModel">${esc(scribe.model || "none chosen")}</b></span><button type="button" class="btn sm" data-act="scribeModels">Change model</button></div>` : ""}
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
    const list = await clients(true);
    return `<div class="view-head"><div><h1>Forms & intake</h1><p class="muted">New patient documents: client information, pain assessment, history and consent</p></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Client</th><th>Documents</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.email)}</div></td><td>${c.documents ? (c.documents.complete ? `<span class="pill ok">Complete</span>` : `<span class="pill">${c.documents.done} of ${c.documents.total}</span>`) : "—"}</td><td>${c.documents && c.documents.done ? `<button class="btn sm" data-act="docsModal" data-id="${esc(c.id)}">View</button>` : ""}</td></tr>`).join("") || noneRow(3, "No clients yet.")}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Form builder</h2><span class="pill">Not connected</span></div>${none("The four intake documents are fixed. A builder for custom forms is not built yet.")}</div>`;
  };

  // ---- Small form pieces shared by the editing screens
  const fld = (id, name, label, val, o = {}) => `<div class="field"><label for="${id}">${label}</label>${o.area ? `<textarea id="${id}" name="${name}" class="input" rows="${o.rows || 3}" maxlength="${o.max || 500}" ${o.attrs || ""}>${esc(val ?? "")}</textarea>` : `<input id="${id}" name="${name}" class="input" type="${o.type || "text"}" value="${esc(val ?? "")}" ${o.max ? `maxlength="${o.max}"` : ""} ${o.attrs || ""}>`}</div>`;
  const sel = (id, name, label, opts, cur) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${name}" class="input">${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`; }).join("")}</select></div>`;
  const slugOf = (t) => (String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "item") + "-" + Math.random().toString(36).slice(2, 6);
  const xBtn = `<button type="button" class="btn sm ghost" data-act="closeModal" aria-label="Close">${ui("x", 14)}</button>`;
  const DAYN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  V.programs = async () => {
    const c = cache.content = await get("/content");
    return `<div class="view-head"><div><h1>Programs</h1><p class="muted">${plural(c.programs.length, "program")} · ${plural((c.lectures || []).length, "lecture")} · what members see in the app</p></div><button class="btn primary" data-act="lectureEdit">${ui("plus", 14)} Lecture</button></div>
    <div class="grid g3">${c.programs.map((p) => `<div class="card stack"><div class="card-head"><h2>${esc(p.title)}</h2></div><div class="row" style="gap:6px"><span class="pill">${esc(p.category || "")}</span><span class="pill">${esc(p.level || "")}</span><span class="pill">${p.weeks} weeks</span><span class="pill ${p.access === "free" ? "ok" : ""}">${esc(p.access || "")}</span></div><p class="muted" style="margin:0">${esc(String(p.summary || "").slice(0, 160))}</p>
      <div class="row" style="margin-top:auto"><button class="btn sm" data-act="progEdit" data-id="${esc(p.id)}">Edit</button><button class="btn sm" data-act="progCopy" data-id="${esc(p.id)}">Duplicate</button><button class="btn sm danger" data-act="progDelete" data-id="${esc(p.id)}">Delete</button></div></div>`).join("") || `<div class="card">${none("No programs.")}</div>`}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Lectures</h2></div>${(c.lectures || []).map((l) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(l.title)}</b><div class="muted" style="font-size:12px">${esc(l.topic || "")} · ${l.minutes} min</div></span><span class="pill">${esc(l.access || "")}</span><button class="btn sm" data-act="lectureEdit" data-id="${esc(l.id)}">Edit</button><button class="btn sm ghost" data-act="lectureDelete" data-id="${esc(l.id)}" aria-label="Delete ${esc(l.title)}">${ui("x", 14)}</button></div>`).join("") || none("No lectures.")}</div>`;
  };

  V.nutrition = async () => {
    const c = cache.content = await get("/content"), recs = (c.recommendations || []);
    return `<div class="view-head"><div><h1>Nutrition</h1><p class="muted">Recommendations members see in the app</p></div><button class="btn primary" data-act="recEdit">${ui("plus", 14)} Recommendation</button></div>
    <div class="stack">${recs.map((r) => `<div class="card"><div class="card-head"><h2>${esc(r.title)}</h2><div class="row"><span class="pill">${esc(r.area || "")}</span><button class="btn sm" data-act="recEdit" data-id="${esc(r.id)}">Edit</button><button class="btn sm ghost" data-act="recDelete" data-id="${esc(r.id)}" aria-label="Delete ${esc(r.title)}">${ui("x", 14)}</button></div></div><p class="note-text muted">${esc(String(r.body || "").slice(0, 400))}</p></div>`).join("") || `<div class="card">${none("No recommendations.")}</div>`}</div>`;
  };

  V.fitness = async () => {
    const pool = (await get("/emr/pool")).pool || [], by = {};
    EXERCISES.forEach((e) => { by[e.region] = (by[e.region] || 0) + 1; });
    return `<div class="view-head"><div><h1>Fitness</h1><p class="muted">${plural(EXERCISES.length, "video")} in the movement library</p></div></div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Movements you prescribe most</h2></div>${pool.map((m) => `<div class="list-item"><span style="flex:1"><b>${esc(m.name)}</b>${m.dose ? ` <span class="pill">${esc(m.dose)}</span>` : ""}</span><span class="muted">${plural(m.uses, "time")}</span></div>`).join("") || none("Nothing prescribed yet. Add movements from a client's chart, under Plans.")}</div>
    <div class="card"><div class="card-head"><h2>Library by body region</h2></div>${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<div class="list-item"><span style="flex:1">${esc(r)}</span><b class="num">${n}</b></div>`).join("") || none("No videos.")}</div></div>`;
  };

  V.payments = async () => {
    const [p, members, s, c] = await Promise.all([get("/payments"), get("/members"), get("/settings"), get("/content"), clients()]);
    cache.content = c; cache.settings = s;
    return `<div class="view-head"><div><h1>Payments</h1><p class="muted">Self-pay only · card payments through Stripe · invoices are written from each client's chart</p></div><a class="btn" href="#settings">Services &amp; fees</a></div>
    <div class="grid g3" style="margin-bottom:16px">${kpi("Card payments", p.enabled ? "On" : "Off", p.enabled ? "Stripe connected" : "Stripe not set up", p.enabled ? "ok" : "warn")}${kpi("Payment confirmations", p.webhook ? "On" : "Off", "from Stripe", p.webhook ? "ok" : "warn")}${kpi("Members and requests", members.length, "people")}</div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Members and requests</h2><span class="muted" style="font-size:12px">Change a membership type here</span></div>${members.map((m) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(m.name)}</b> <span class="muted">${esc(m.email)}</span>${m.request && !m.membership ? `<div class="muted" style="font-size:12px">Asked for ${esc(tierName(m.request.tier))}</div>` : ""}</span><select class="input tier-pick${m.membership ? " on" : ""}" data-change="rowTier" data-id="${esc(m.id)}" data-name="${esc(m.name)}" aria-label="Membership type for ${esc(m.name)}">${tierOptions((m.membership && m.membership.tier) || "")}</select><button class="btn sm" data-act="chart" data-id="${esc(m.id)}">Chart</button></div>`).join("") || none("No members or requests yet.")}</div>
    <div class="card stack"><div class="card-head"><h2>Membership types</h2><span class="muted" style="font-size:12px">What members can sign up for</span></div>
      <form class="stack" data-form="setTiers">${(c.tiers || []).map((t, i) => `<div class="stack" style="border-bottom:1px solid var(--line);padding-bottom:12px"><div class="grid g2">${fld("tn" + i, "name" + i, "Name", t.name, { max: 60 })}${fld("tp" + i, "price" + i, "Price per month ($)", t.price, { type: "number", attrs: 'min="0" step="0.01"' })}</div>
        <div class="grid g2">${fld("tm" + i, "meetings" + i, "1-on-1 calls per month", t.meetings || 0, { type: "number", attrs: 'min="0" max="31"' })}${fld("tl" + i, "minutes" + i, "Minutes per call", t.meetingMinutes || 0, { type: "number", attrs: 'min="0" max="180"' })}</div>
        ${fld("tk" + i, "perks" + i, "What it includes (one per line)", (t.perks || []).join("\n"), { area: true, rows: 3, max: 1300 })}</div>`).join("")}
      <div class="row"><button class="btn primary">Save membership types</button></div><p class="muted" style="margin:0;font-size:12.5px">A price change applies to people who join from now on. Current members keep what their card is already charged.</p></form></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Clients with payments</h2></div>${(p.clients || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name || x.email || "")}</b></span><button class="btn sm" data-act="chartBilling" data-id="${esc(x.id)}">Billing</button></div>`).join("") || none("No payments recorded.")}</div>`;
  };

  V.newsletter = async () => {
    const list = await get("/subscribers");
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
  V.insights = async () => {
    const tabs = `<div class="tabs" role="tablist">${[["analytics", "Analytics"], ["audit", "Audit"]].map(([t, l]) => `<button class="tab ${state.insTab === t ? "active" : ""}" role="tab" data-act="insTab" data-tab="${t}">${l}</button>`).join("")}</div>`;
    if (state.insTab === "audit") {
      const a = await get("/audit");
      return `<div class="view-head"><div><h1>Insights</h1><p class="muted">Every sign-in, every look at a record and every change</p></div><button class="btn primary" data-act="auditVerify">Verify the ledger</button></div>${tabs}
      <div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:10px">Ledger check</h2><div id="auditResult">${none("Not checked in this session. Press Verify.")}</div></div>${ledgerTable(a)}`;
    }
    const days = state.insDays;
    const [d, sa, mail, people] = await Promise.all([get(`/analytics?days=${days}`), get(`/search-analytics?days=${days}`).catch(() => null), get("/email-log").catch(() => null), clients(true), content()]);
    // Sign-ups and members, counted from the accounts themselves. "Paying" means a card subscription is running;
    // a membership set by hand (no card on a schedule) is counted separately so the two are never confused.
    const since = Date.now() - days * 864e5, fresh = people.filter((c) => c.createdAt && Date.parse(c.createdAt) >= since).length;
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
    <div class="grid g4" style="margin-bottom:16px">${tile("all", "Total sign-ups", people.length, "accounts, all time")}${tile("fresh", `New sign-ups (${days}d)`, fresh, "accounts created")}${tile("paying", "Paying members", paying.length, "card subscription running", paying.length ? "ok" : "")}${tile("hand", "Members set by hand", byHand.length, "no card subscription")}</div>
    <div id="insPeople">${insPeople()}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Members by type</h2><span class="muted" style="font-size:12px">${paying.length ? `About ${money(Math.round(monthly))} a month from card subscriptions, before discounts` : "No card subscriptions running"}</span></div>
      ${tierRows.map((r) => `<div class="list-item"><span style="flex:1"><b>${esc(r.name)}</b></span><button type="button" class="pill pill-btn ${r.pay ? "ok" : ""}" data-act="insList" data-key="paying:${esc(r.id)}"${r.pay ? "" : " disabled"}>${r.pay} paying</button>${r.hand ? `<button type="button" class="pill pill-btn" data-act="insList" data-key="hand:${esc(r.id)}">${r.hand} set by hand</button>` : ""}</div>`).join("") || none("Nobody has a membership yet.")}</div>
    <div class="grid g4" style="margin-bottom:16px">${kpi("Views today", s.todayViews, "page views")}${kpi("Visitors today", s.todayUnique, "people")}${kpi(`Views (${d.rangeDays || days}d)`, s.totalViews, "page views")}${kpi(`Visitors (${d.rangeDays || days}d)`, s.totalUnique, "people")}</div>
    <div class="grid g2">
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>By day</h2></div><div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Views</th><th class="num">Visitors</th></tr></thead><tbody>${(d.days || []).slice().reverse().slice(0, 31).map((r) => `<tr><td>${fmtDate(r.date)}</td><td class="num">${r.views}</td><td class="num">${r.unique}</td></tr>`).join("") || noneRow(3, "No data yet.")}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Top pages</h2></div><div class="table-wrap"><table><thead><tr><th>Page</th><th class="num">Views</th></tr></thead><tbody>${(d.pages || []).slice(0, 15).map((r) => `<tr><td>${esc(r.page)}</td><td class="num">${r.views}</td></tr>`).join("") || noneRow(2, "No data yet.")}</tbody></table></div></div>
    </div>
    <div class="grid g3" style="margin-top:16px">${mixCard("Device", m.devices)}${mixCard("Where they came from", m.sources)}${mixCard("Location", m.places)}${mixCard("Operating system", m.os)}${mixCard("Browser", m.browsers)}${mixCard("Country", m.countries)}</div>
    <div class="card" style="padding:0;margin-top:16px"><div class="card-head" style="padding:14px 16px 0"><h2>Referring sites</h2></div><div class="table-wrap"><table><thead><tr><th>Source</th><th class="num">Views</th></tr></thead><tbody>${(d.referrers || []).map((r) => `<tr><td>${esc(r.source)}</td><td class="num">${r.views}</td></tr>`).join("") || noneRow(2, "No referral traffic yet.")}</tbody></table></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Site search: top queries</h2><span class="muted" style="font-size:12px">${st.events || 0} searches · ${st.uniqueQueries || 0} different</span></div><div class="table-wrap"><table><thead><tr><th>Query</th><th class="num">Shown</th><th class="num">Clicks</th><th class="num">CTR</th></tr></thead><tbody>${qRows(sa && sa.top)}</tbody></table></div></div>
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Site search: nothing found</h2></div><div class="table-wrap"><table><thead><tr><th>Query</th><th class="num">Shown</th><th class="num">Clicks</th><th class="num">CTR</th></tr></thead><tbody>${qRows(sa && sa.zeroResult)}</tbody></table></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Email alerts</h2><span class="pill ${mail && mail.enabled ? "ok" : "warn"}">${mail && mail.enabled ? "On" : "Off"}</span></div>
      ${mail ? `<p class="muted" style="margin:0">Alerts go to ${esc((mail.alertsTo || []).join(", ") || "nobody yet")}. ${plural((mail.failures || []).length, "failed send")} on record.</p>` : none("Email log unavailable.")}</div>`;
  };

  V.team = async () => {
    const [me, mfa] = await Promise.all([get("/me"), get("/mfa")]);
    return `<div class="view-head"><div><h1>Team & roles</h1><p class="muted">This system has one sign-in: the practice owner</p></div></div>
    <div class="card" style="padding:0;margin-bottom:16px"><div class="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Two-step sign-in</th><th>Email alerts</th></tr></thead><tbody>
    <tr><td><b>${esc(me.email)}</b></td><td>Owner</td><td><span class="pill ${mfa.enabled ? "ok" : "warn"}">${mfa.enabled ? "On" : "Off"}</span></td><td><span class="pill ${me.emailNotifications ? "ok" : ""}">${me.emailNotifications ? "On" : "Off"}</span></td></tr></tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>More staff and roles</h2><span class="pill">Not connected</span></div>${none("Separate sign-ins for clinicians and front desk, with their own permissions, are not built yet.")}</div>`;
  };

  V.feedback = async () => {
    const [reviews, rep] = await Promise.all([get("/feedback"), get("/feedback-reports")]);
    return `<div class="view-head"><div><h1>Reviews & feedback</h1><p class="muted">${plural(reviews.length, "review")} · ${plural(rep.open || 0, "open report")}</p></div></div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Reviews from the website</h2></div>
      ${reviews.map((f) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(f.name)}</b> <span class="stars" role="img" aria-label="${Math.max(0, Math.min(5, f.rating || 0))} out of 5 stars">${ui("star", 13).repeat(Math.max(0, Math.min(5, f.rating || 0)))}</span> <span class="pill">${esc(f.status)}</span><p class="note-text">${esc(f.text)}</p></span>
        ${f.status !== "hidden" ? `<button class="btn sm" data-act="review" data-id="${esc(f.id)}" data-st="hidden">Hide</button>` : `<button class="btn sm" data-act="review" data-id="${esc(f.id)}" data-st="pending">Restore</button>`}${f.publish && f.status !== "approved" ? `<button class="btn sm primary" data-act="review" data-id="${esc(f.id)}" data-st="approved">Show on website</button>` : ""}</div>`).join("") || none("No reviews yet.")}</div>
    <div class="card"><div class="card-head"><h2>Bug reports and ideas</h2></div>
      ${rep.reports.map((r) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(r.title)}</b> <span class="pill">${r.kind === "bug" ? "Bug" : "Suggestion"}</span> <span class="pill">${esc(r.status)}</span><p class="note-text">${esc(r.body)}</p><span class="muted" style="font-size:12px">${esc(r.clientName || "")} · ${when(r.createdAt)}</span></span>
        ${r.status !== "resolved" ? `<button class="btn sm" data-act="report" data-id="${esc(r.id)}" data-st="resolved">Mark resolved</button>` : ""}</div>`).join("") || none("No reports.")}</div></div>`;
  };

  V.security = async () => {
    const [a, mfa] = await Promise.all([get("/audit"), get("/mfa")]);
    return `<div class="view-head"><div><h1>Security & audit</h1><p class="muted">Every sign-in, every look at a record and every change, in a ledger that detects tampering</p></div><button class="btn primary" data-act="auditVerify">Verify the ledger</button></div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><h2 style="margin-bottom:10px">Ledger check</h2><div id="auditResult">${none("Not checked in this session. Press Verify.")}</div></div>
      <div class="card"><h2 style="margin-bottom:10px">Sign-in</h2>
        <div class="list-item"><span style="flex:1">Two-step sign-in by email code<div class="muted" style="font-size:12px">${mfa.forcedOff ? "Switched off by a server setting." : mfa.emailReady ? `The code goes to ${esc(mfa.sendsTo || "your email")}.` : "Email is not connected on the server, so codes cannot be sent."}</div></span><span class="pill ${mfa.enabled ? "ok" : "warn"}">${mfa.enabled ? "On" : "Off"}</span>${mfa.forcedOff ? "" : `<button class="btn sm ${mfa.enabled ? "" : "primary"}" data-act="${mfa.enabled ? "mfaOff" : "mfaOn"}">${mfa.enabled ? "Turn off" : "Turn on"}</button>`}</div>
        <div class="list-item"><span style="flex:1">Signs out when idle</span><span class="pill ok">15 minutes</span></div></div>
    </div>
    ${ledgerTable(a)}`;
  };

  // Hours are typed the way they are said: "09:00-12:00, 13:00-17:00". Blank means closed that day.
  const hoursText = (day) => (day || []).map((w) => `${w[0]}-${w[1]}`).join(", ");
  V.settings = async () => {
    const [s, cal, me] = await Promise.all([get("/settings"), get("/calsync"), get("/me")]);
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
        <div class="list-item"><span style="flex:1">Google Calendar${cal.serviceAccountEmail && cal.google !== "off" ? `<div class="muted" style="font-size:12px;overflow-wrap:anywhere">Shared with ${esc(cal.serviceAccountEmail)}${cal.calendars > 1 ? ` · ${cal.calendars} calendars` : ""}</div>` : ""}</span><span class="pill ${cal.google !== "off" ? "ok" : ""}">${cal.google !== "off" ? "Connected" : "Off"}</span></div>
        <div class="list-item"><span style="flex:1">SimplePractice calendar${cal.simplePracticeUrl ? `<div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(cal.simplePracticeUrl)}</div>` : ""}</span><span class="pill ${cal.simplepractice !== "off" ? "ok" : ""}">${cal.simplepractice !== "off" ? "Connected" : "Off"}</span></div>
        <div class="list-item"><span style="flex:1">Email alerts to you</span><span class="pill ${me.emailNotifications ? "ok" : ""}">${me.emailNotifications ? "On" : "Off"}</span></div>
        ${cal.lastError ? `<p class="muted" style="margin:0">Last calendar problem: ${esc(cal.lastError)}</p>` : ""}
        <form class="stack" data-form="setIcs">${fld("icsUrl", "icsUrl", "SimplePractice calendar link (paste a new one to change it; blank disconnects)", "", { type: "url", max: 500, attrs: 'placeholder="https://… or webcal://…" autocomplete="off"' })}
          <div class="row"><button class="btn">Save calendar link</button><button type="button" class="btn" data-act="calTest">Check the calendars now</button></div><div id="calTestOut" class="muted" style="font-size:12.5px"></div></form>
        <form class="stack" data-form="setVideo" style="border-top:1px solid var(--line);padding-top:12px">${fld("tvUrl", "telehealthUrl", "Outside video room link (optional; the built-in Telehealth room needs none)", bk.telehealthUrl, { type: "url", max: 300, attrs: 'placeholder="https://"' })}
          <div class="row"><button class="btn">Save video link</button></div></form></div>
    </div>`;
  };

  V.portal = async () => `<div class="view-head"><div><h1>Client app</h1><p class="muted">What members use on their phone and on the web</p></div><a class="btn primary" href="/account" target="_blank" rel="noopener">Open the client app</a></div>
    <div class="card"><h2 style="margin-bottom:10px">What members can do today</h2>${["Read notes from you and play their prescribed movements", "Book and pay for video visits", "Fill out new patient documents", "Message you", "Log pain and workouts", "Follow programs and earn rewards"].map((x) => `<div class="list-item">${x}</div>`).join("")}</div>`;

  V.booking = async () => {
    const s = await get("/settings"), url = location.origin + "/book";
    return `<div class="view-head"><div><h1>Booking page</h1><p class="muted">The public page where people book with you</p></div><a class="btn primary" href="/book" target="_blank" rel="noopener">Open booking page</a></div>
    <div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Booking link</h2><div class="row"><input class="input" id="bookUrl" readonly value="${esc(url)}" aria-label="Booking link" style="flex:1"><button class="btn" data-act="copyBook">Copy</button></div>${b_note(s)}</div>
    <div class="card"><div class="card-head"><h2>What people can book</h2><a class="btn sm" href="#settings">Hours and fees</a></div>${(s.services || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.unit || "")}</div></span><b class="num">${money(x.rate)}</b></div>`).join("") || none("No services.")}</div></div>`;
  };
  const b_note = (s) => s.business && s.business.bookingNote ? `<p class="muted" style="margin:10px 0 0">${esc(s.business.bookingNote)}</p>` : "";

  // ---------------------------------------------------------------- actions
  const reChart = async () => { const id = state.chartClient; const [d, c] = await Promise.all([get(`/emr/${id}`), get(`/clients/${id}`)]); cache.chart = { ...cache.chart, d, c }; const box = $("#chartBody"); if (box) box.innerHTML = chartTab(); };
  const showDocs = (d) => (d.docs || []).map((doc) => `<div class="card" style="box-shadow:none;margin-top:10px"><h3 style="margin:0 0 2px">${esc(doc.title)}</h3><p class="muted" style="margin:0 0 8px;font-size:12px">Completed ${when(doc.createdAt)}</p><dl class="qa">${(doc.fields || []).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(Array.isArray(f.value) ? f.value.join(", ") : f.value === true ? "Yes" : f.value === false ? "No" : f.value == null || f.value === "" ? "—" : f.value)}</dd></div>`).join("")}</dl></div>`).join("") || none("No documents received yet.");
  const ACT = {
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
        msg.textContent = `Draft ready. Read it and edit before you sign.${r.removed ? ` ${r.removed} name, contact or date ${r.removed === 1 ? "detail was" : "details were"} removed before sending.` : ""}`;
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
    teleRole: (el) => { const p = tele.peers.get(el.dataset.id); if (!p) return; MDFitRT.emit("tele_role", { clientId: p.id, role: el.dataset.role }); if (el.dataset.role === "speaker") toast(`${firstName(p.name)} was asked to speak. Their camera turns on once they agree.`); },
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
      modal(`<div class="card-head"><h2>${esc(a.name)}</h2>${statusPill(a.status)}</div>
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
    consult: async (f) => { const a = await api("POST", `/api/admin/clients/${state.chartClient}/consult`, { date: f.date.value, time: f.time.value, minutes: Number(f.minutes.value), title: f.title.value.trim(), meetingLink: f.meetingLink.value.trim(), message: "" }); closeModal(); toast(`Scheduled ${fmtDate(a.date)} at ${fmtTime(a.time)}.`); render(); },
    // The message shows at once as "Sending…" and the box clears, so typing the next one never waits on the server
    message: async (f) => {
      const body = f.body.value.trim(); if (!body) return;
      const l = $("#msgList"); f.body.value = "";
      if (l) { l.insertAdjacentHTML("beforeend", `<div class="bubble me" data-pending style="opacity:.6">${esc(body)}<div class="muted" style="font-size:11px;margin-top:2px">Sending…</div></div>`); l.scrollTop = l.scrollHeight; }
      try { await api("POST", `/api/admin/messages/${state.thread}`, { body }); }
      catch (err) { const p = $("[data-pending]"); if (p) p.remove(); const box = $(".composer input[name=body]"); if (box && !box.value) box.value = body; throw err; }
      await refreshMessages(true);
    },
    apptSave: async (f) => { await api("PATCH", `/api/admin/appointments/${f.dataset.id}`, { status: f.status.value, adminNotes: f.adminNotes.value }); cache.appts = null; closeModal(); toast("Appointment updated."); render(); }
  };
  // ---- Client chart: what the buttons do
  const cid = () => state.chartClient;
  const firstOf = () => String(cache.chart.d.name).split(" ")[0];
  const putPlan = (patch) => { const p = cache.chart.c.plan || {}; return api("PUT", `/api/admin/clients/${cid()}/plan`, { guides: p.guides || [], exercises: p.exercises || [], notes: p.notes || "", ...patch }); };
  const setPrograms = (ids) => api("PUT", `/api/admin/clients/${cid()}/programs`, { programs: ids.map((id) => ({ id })) });
  // After a change: fresh data, the same tab, and the alerts and tags in the header
  const chartRedo = async () => { await reChart(); const p = $("#chartPills"); if (p) p.innerHTML = chartPills(); chartAfter(); };
  async function setMembership(id, tier, until, name) {
    const cur = (cache.clients || []).find((x) => x.id === id), was = cur && cur.membership;
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
        <form class="stack" data-form="scribeModel"><div class="field"><label for="smPick">Model</label><select id="smPick" name="model" class="input">${(r.models || []).map((m) => `<option${m === r.current ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
        ${(r.models || []).includes(r.current) ? "" : `<p class="muted" style="margin:0;font-size:12.5px">The one set now, ${esc(r.current || "none")}, is not on this list, which is why drafts fail.</p>`}
        <div class="row"><button class="btn primary"${(r.models || []).length ? "" : " disabled"}>Use this model</button></div></form>`);
    },
    stop: () => {},
    // Export: the people ticked on the Clients list, or everyone when nobody is ticked
    exportAsk: async () => {
      const n = state.picked.size, all = !n, total = (await clients()).length;
      modal(`<div class="card-head"><h2>Export ${all ? `all ${total} clients` : plural(n, "selected client")}</h2>${xBtn}</div>
        <div class="stack"><button type="button" class="btn primary" data-act="exportGo" data-kind="csv">Spreadsheet (CSV)</button><p class="muted" style="margin:0;font-size:12.5px">One row per client: name, email, phone, status, membership, visit dates, tags, alerts and what is owed. Opens in Excel, Numbers or Google Sheets.</p>
        <button type="button" class="btn" data-act="exportGo" data-kind="records">Full records (JSON)</button><p class="muted" style="margin:0;font-size:12.5px">Everything in each chart: plan and protocols, measures, medications, alerts, consents, invoices, notes to the patient, new patient documents, visits and clinical notes. Restricted notes are listed without their text. For a patient's request for their record, or for moving to another system.</p>
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
        <div class="row"><button class="btn primary">Schedule</button></div></form>
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
    await chartRedo(); toast("Encrypted and saved to the chart.");
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
    setTiers: (f) => putContent({ tiers: (cache.content.tiers || []).map((t, i) => ({ ...t, name: f["name" + i].value.trim(), price: Number(f["price" + i].value), meetings: Number(f["meetings" + i].value), meetingMinutes: Number(f["minutes" + i].value), perks: f["perks" + i].value.split("\n").map((x) => x.trim()).filter(Boolean) })) }, "Membership types saved."),
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

  document.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || !token) return; const fn = ACT[el.dataset.act]; if (fn) guard(fn)(el, e); });
  document.addEventListener("submit", (e) => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault(); const fn = FORMS[f.dataset.form]; if (fn && token) guard(fn)(f, e); });
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-change=leadStatus]")) guard(ACT.leadSave)(e.target);
    if (e.target.matches("[data-change=chartFile]")) guard(chartUpload)(e.target);
    if (e.target.matches("[data-change=pickOne], [data-change=pickAll]")) {
      if (e.target.matches("[data-change=pickAll]")) document.querySelectorAll("[data-change=pickOne]").forEach((b) => { b.checked = e.target.checked; if (b.checked) state.picked.add(b.dataset.id); else state.picked.delete(b.dataset.id); });
      else if (e.target.checked) state.picked.add(e.target.dataset.id); else state.picked.delete(e.target.dataset.id);
      const l = $("#exportLabel"); if (l) l.textContent = state.picked.size ? `Export ${state.picked.size} selected` : "Export all";
    }
    if (e.target.matches("[data-change=rowTier]")) guard(async (el) => { const was = ((cache.clients || []).find((x) => x.id === el.dataset.id) || {}).membership; const said = await setMembership(el.dataset.id, el.value, was && was.tier === el.value ? was.until : "", el.dataset.name); if (said) { await clients(true); toast(said); } else el.value = (was && was.tier) || ""; el.classList.toggle("on", !!el.value); })(e.target);
    if (e.target.matches("[data-change=chartTier]")) guard(async (el) => { const was = cache.chart.c.membership, said = await setMembership(cid(), el.value, "", firstOf()); if (said) { await render(); toast(said); } else el.value = (was && was.tier) || ""; })(e.target);
    if (e.target.matches("[data-change=chartType]")) guard(async (el) => { await api("PUT", `/api/admin/clients/${cid()}/type`, { type: el.value }); cache.clients = null; const type = el.value; await render(); toast(`${firstOf()} is now ${type === "inpatient" ? "an inpatient: visits are not charged" : "an outpatient"}.`); })(e.target);
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
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "mvSearch") {
      const q = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean), box = $("#mvResults");
      box.innerHTML = q.length ? (EXERCISES.filter((x) => q.every((w) => `${x.name} ${x.region} ${x.cat}`.toLowerCase().includes(w))).slice(0, 10).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.region)} · ${esc(x.cat)} · level ${x.level}</div></span><button type="button" class="btn sm" data-act="mvPick" data-id="${esc(x.id)}">Choose</button></div>`).join("") || none("No movement matches.")) : "";
    }
    if (e.target.dataset && e.target.dataset.svc) { const sv = ((cache.settings && cache.settings.services) || []).find((x) => x.name === e.target.value), fee = e.target.parentElement.querySelector('[name^="fee"]'); if (sv && fee && !fee.value) fee.value = sv.rate; }
    if (e.target.id === "teleInviteQ") {
      const q = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean), box = $("#teleInviteRes");
      if (!q.length) { box.innerHTML = ""; return; }
      clients().then((list) => { if ($("#teleInviteQ").value.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ") !== q.join(" ")) return;
        const here = new Set([...tele.peers.keys(), ...tele.waiting.map((p) => p.clientId)]), asked = new Set(tele.invited.map((p) => p.clientId));
        box.innerHTML = list.filter((c) => q.every((w) => `${c.name} ${c.email}`.toLowerCase().includes(w))).slice(0, 8).map((c) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(c.email)}</div></span>${here.has(c.id) ? `<span class="pill ok">Here</span>` : `<button type="button" class="btn sm primary" data-act="teleInvite" data-id="${esc(c.id)}">${asked.has(c.id) ? "Invite again" : "Invite to telehealth"}</button>`}</div>`).join("") || none("No client matches.");
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
  let seq = 0;
  const noteAppend = (text) => { const box = $("#nBody"); if (!box) return; box.value = (box.value.trimEnd() ? box.value.trimEnd() + "\n\n" : "") + text; noteTouch(); box.focus(); box.scrollTop = box.scrollHeight; };
  document.addEventListener("input", (e) => { if (e.target.matches && e.target.matches("[data-input=note]")) noteTouch(); });
  async function render() {
    if (note.dirty && token && $("#nBody")) await noteSave(true);
    if (dict.on && !(dict.box && dict.box.isConnected && route() === dict.route)) stopDictation();
    if (!token) return;
    let r = (location.hash || "#dashboard").slice(1); if (r === "reports") r = "insights"; if (!V[r]) r = "dashboard";
    renderNav(r); $("#nav").classList.remove("open");
    const my = ++seq, view = $("#view");
    if (!view.innerHTML) view.innerHTML = `<p class="spin">Loading…</p>`;
    try { const html = await V[r](); if (my !== seq || !token) return; view.innerHTML = html; if (r === "chart" && state.chartClient) chartAfter(); if (r === "telehealth") { if (window.MDFitRT) MDFitRT.emit("tele_list"); teleMount(); } }
    catch (err) { if (my !== seq || !token) return; view.innerHTML = `<div class="card"><b>This screen could not be loaded.</b><p class="muted" style="margin:6px 0 0">${esc(err.message)}</p></div>`; }
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
      rl.innerHTML = all.map((p) => `<div class="list-item" style="flex-wrap:wrap;row-gap:6px"><span style="flex:1 1 120px;min-width:0;overflow-wrap:anywhere"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${p.state === "connected" ? "Connected" : p.state === "failed" ? "Could not connect" : "Connecting…"}</div></span>
        <span class="pill ${p.role === "speaker" ? "ok" : ""}">${!tele.group ? "In the visit" : p.role !== "speaker" ? "Viewer" : p.remote.getTracks().some((t) => !t.muted && t.readyState === "live") ? "Speaker" : "Asked to speak"}</span>
        ${tele.group ? `<button type="button" class="btn sm${p.role === "speaker" ? "" : " primary"}" data-act="teleRole" data-id="${esc(p.id)}" data-role="${p.role === "speaker" ? "viewer" : "speaker"}">${p.role === "speaker" ? "Make viewer" : "Make speaker"}</button>` : ""}
        ${all.length > 1 || tele.group ? `<button type="button" class="btn sm ghost" data-act="teleKick" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from the room">${ui("x", 14)}</button>` : ""}</div>`).join("");
      const rc = $("#teleRoomCount"); if (rc) rc.textContent = tele.group ? `${all.length} in the room` : "One to one";
    }
    teleSay(tele.status); teleClock();
    const w = $("#teleWaiting"), canAdmit = true; // in a private visit, Admit asks before opening it to more people
    if (w) w.innerHTML = tele.waiting.map((p) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(p.visit || "No video visit booked today")} · waiting ${Math.max(0, Math.round((Date.now() - p.since) / 60000))} min</div></span><button class="btn sm primary" data-act="teleAdmit" data-id="${esc(p.clientId)}"${canAdmit ? "" : " disabled"}>Admit</button><button class="btn sm ghost" data-act="teleDecline" data-id="${esc(p.clientId)}" aria-label="Turn away ${esc(p.name)}">${ui("x", 14)}</button></div>`).join("") || none(MDFitRT && MDFitRT.connected() ? "Nobody is waiting. People appear here when they open the session link." : "Not connected to the live service. Reload the page.");
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
      if (route() === "messages" && !$("#modalBack").classList.contains("open")) refreshMessages();
      else { cache.unread = (cache.unread || 0) + 1; renderNav(route()); toast(`New message from ${(ev && ev.clientName) || "a member"}`); }
    });
    MDFitRT.on("message_reaction", (ev) => { if (token && route() === "messages" && ev && ev.clientId === state.thread) refreshMessages(); });
    MDFitRT.on("tele_waiting", (ev) => {
      const had = new Set(tele.waiting.map((p) => p.clientId)); tele.waiting = (ev && ev.waiting) || []; tele.invited = (ev && ev.invited) || [];
      const fresh = tele.waiting.find((p) => !had.has(p.clientId));
      // the server is the record of the room's mode and of who is a viewer or a speaker
      tele.group = !!(ev && ev.group); let moved = false;
      tele.roomIds = new Set(((ev && ev.room) || []).map((m) => m.clientId));
      for (const m of (ev && ev.room) || []) { const p = tele.peers.get(m.clientId); if (p && p.role !== m.role) { p.role = m.role; moved = true; } }
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
    MDFitRT.on("tele_invited", (ev) => { if (ev) toast(`${firstName(ev.name || "They")} was invited: ${ev.emailed ? "emailed and " : ""}notified in the app. They are let in when they arrive.`); });
    MDFitRT.on("calendar_changed", () => { if (token && route() === "calendar" && !$("#modalBack").classList.contains("open")) render(); });
    setInterval(() => { if (token && route() === "messages" && !document.hidden && !MDFitRT.connected() && !$("#modalBack").classList.contains("open")) refreshMessages(); }, 15000);
  }
  async function start() {
    $("#signin").hidden = true; $("#app").hidden = false; idleArm(); goLive();
    get("/me").then((me) => { cache.me = me; $("#whoami").textContent = me.email; }).catch(() => {});
    render();
  }
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
    const list = await clients();
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
  // A restored session keeps its old last-input time: a reload must not hand out a fresh 15 minutes
  if (token && idleFor() >= IDLE_MS) idleOut();
  else if (token) { if (!idleFor()) idleStamp(); start(); } else { $("#signin").hidden = false; $("#app").hidden = true; }
})();
