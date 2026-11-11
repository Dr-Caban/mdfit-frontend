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
  const adminLink = (tab, label) => `<a class="btn sm" href="/admin#${tab}">${label}</a>`;
  const notBuilt = (what) => `<div class="card">${none(`${what} is not connected yet: the server has nothing for it.`)}</div>`;

  // ---------------------------------------------------------------- session
  const KEY = "mdfit_ws_token";
  const store = { get: () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } }, set: (t) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch {} } };
  let token = store.get();
  const state = { chartClient: null, chartTab: "overview", thread: null, calWeek: 0, clientQ: "", insTab: "analytics", insDays: 30 };
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
  function modal(html) { $("#modal").innerHTML = html; $("#modalBack").classList.add("open"); $("#modal").querySelector("button,input,select,textarea")?.focus(); }
  function closeModal() { $("#modalBack").classList.remove("open"); $("#modal").innerHTML = ""; }
  const guard = (fn) => (...a) => Promise.resolve(fn(...a)).catch((e) => toast(e.message));

  // Signing out empties everything that was drawn, so names and notes do not stay on a shared screen.
  function signOut() {
    token = ""; store.set(""); if (window.MDFitRT) { if (tele.call) MDFitRT.emit("tele_end"); MDFitRT.disconnect(); } teleDrop(); stopDictation();
    for (const k of Object.keys(cache)) cache[k] = (k === "unread" || k === "waiting") ? 0 : null; // every cached list, the open chart included
    state.chartClient = null; state.thread = null; state.clientQ = ""; state.scribeText = ""; tele.transcript = "";
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
      token = out.token; store.set(token); idleStamp(); f.reset(); $("#siCodeRow").hidden = true; start();
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
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z" fill="currentColor"/>',
    camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    phoneOff: '<path d="M4 15c5-5 11-5 16 0l-2.5 2.5-3-1.5v-2.5a8 8 0 0 0-5 0V16l-3 1.5z" fill="currentColor"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    broadcast: '<path d="M3 10v4h3l6 4V6l-6 4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
    board: '<path d="M3 4h18v12H3zM12 16v4M8 20h8"/><path d="M7 12l3-3 2 2 4-4"/>',
    blur: '<circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="3"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'
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
      NAV.map((g) => `<div class="nav-group"><span>${g.g}</span>${g.items.map(([id, label]) => `<a href="#${id}" class="${active === id ? "active" : ""}"><svg viewBox="0 0 24 24">${ICON[id]}</svg>${label}${badge(id)}</a>`).join("")}</div>`).join("");
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
    // The practice's other calendars (SimplePractice, Google Calendar) for the week on screen. The server passes on
    // times only, never a name or a title, so these are drawn as "Busy" blocks behind MD Fit's own visits.
    const [appts, classes, bookings, sync] = await Promise.all([get("/appointments?all=1"), get("/classes"), get("/bookings"),
      get(`/busy?from=${isoDay(mon)}&days=7`).catch(() => null)]);
    cache.appts = appts;
    const busy = (sync && sync.busy) || [], srcName = (x) => (x === "simplepractice" ? "SimplePractice" : "Google Calendar");
    const START = 6, END = 20, top = (t) => { const [h, m] = t.split(":").map(Number); return (h + m / 60 - START) * 56; };
    const hhmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
    const cols = days.map((d) => {
      const key = isoDay(d), dow = d.getDay();
      const ev = appts.filter((a) => a.date === key && a.status !== "cancelled").map((a) => `<div class="appt" style="--c:var(--${a.status === "completed" ? "ok" : "body"});top:${top(a.time) + 2}px;height:${Math.max(26, (a.minutes || 60) / 60 * 56 - 4)}px" data-act="appt" data-id="${esc(a.id)}"><b>${esc(a.name)}</b>${fmtTime(a.time)} · ${esc(a.typeName || "")}</div>`);
      const cl = classes.filter((c) => c.active !== false && c.day === dow).map((c) => `<div class="appt" style="--c:var(--fit);top:${top(c.time) + 2}px;height:${Math.max(26, (c.durationMin || 60) / 60 * 56 - 4)}px;opacity:.85"><b>${esc(c.title)}</b>${fmtTime(c.time)} · class</div>`);
      const bz = busy.filter((b) => b.date === key && !b.allDay).map((b) => {
        const s = Math.max(b.start, START * 60), e = Math.min(b.end, END * 60); if (e <= s) return "";
        return `<div class="appt busy" style="top:${(s / 60 - START) * 56 + 2}px;height:${Math.max(20, (e - s) / 60 * 56 - 4)}px" title="Busy on ${srcName(b.source)}, ${fmtTime(hhmm(b.start))} to ${fmtTime(hhmm(b.end))}"><b>Busy</b>${fmtTime(hhmm(b.start))} · ${srcName(b.source)}</div>`;
      });
      return `<div class="cal-col" style="grid-row:2">${bz.concat(ev, cl).join("")}</div>`;
    }).join("");
    const today = isoDay(now);
    return `
    <div class="view-head"><div><h1>Calendar</h1><p class="muted">Week of ${mon.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</p></div>
    <div class="row"><button class="btn sm" data-act="calWeek" data-d="-1" aria-label="Previous week">${ui("prev", 14)}</button><button class="btn sm" data-act="calWeek" data-d="0">Today</button><button class="btn sm" data-act="calWeek" data-d="1" aria-label="Next week">${ui("next", 14)}</button>
    ${adminLink("hours", "Hours &amp; calendar sync")}</div></div>
    <div class="row" style="margin-bottom:12px"><span class="pill"><span class="dot" style="background:var(--body)"></span>Booked</span><span class="pill"><span class="dot" style="background:var(--ok)"></span>Completed</span><span class="pill"><span class="dot" style="background:var(--fit)"></span>Class</span><span class="pill"><span class="dot" style="background:var(--muted)"></span>Busy on your other calendars</span>
    <span class="muted" style="font-size:12.5px">${!sync ? "Your other calendars could not be read just now." : sync.simplepractice === "off" && sync.google === "off" ? "No outside calendar is connected, so only MD Fit bookings show." : `Showing ${[sync.simplepractice !== "off" && "SimplePractice", sync.google !== "off" && "Google Calendar"].filter(Boolean).join(" and ")} busy times (times only)${sync.lastError ? ". Last sync reported a problem" : ""}.`}</span></div>
    <div class="table-wrap"><div class="cal">
      <div style="border-bottom:1px solid var(--line)"></div>${days.map((d) => `<div class="cal-h ${isoDay(d) === today ? "today" : ""}">${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getDate()}${busy.filter((b) => b.allDay && b.date === isoDay(d)).slice(0, 1).map((b) => ` <span class="pill" style="font-weight:500" title="All day on ${srcName(b.source)}">Busy all day</span>`).join("")}</div>`).join("")}
      <div class="cal-times" style="grid-row:2">${Array.from({ length: 28 }, (_, i) => `<div>${i % 2 === 0 ? fmtTime(`${START + i / 2}:00`).replace(":00", "") : ""}</div>`).join("")}</div>
      ${cols}
    </div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Weekly classes</h2>${adminLink("classes", "Edit classes")}</div>
        ${classes.map((c) => `<div class="list-item"><span style="flex:1"><b>${esc(c.title)}</b><div class="muted" style="font-size:12px">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][c.day]} ${fmtTime(c.time)} · ${c.durationMin} min · ${esc(c.coach || "")}</div></span><span class="pill">${c.capacity} spots</span></div>`).join("") || none("No classes set up.")}</div>
      <div class="card"><div class="card-head"><h2>Class bookings</h2></div>
        ${bookings.map((b) => `<div class="list-item"><span style="flex:1"><b>${esc(b.name)}</b><div class="muted" style="font-size:12px">${esc(b.title)} · ${fmtDate(b.date)} ${fmtTime(b.time)}</div></span><button class="btn sm danger" data-act="cancelBooking" data-id="${esc(b.id)}">Cancel</button></div>`).join("") || none("No upcoming class bookings.")}</div>
    </div>`;
  };

  V.clients = async () => {
    const [list, emr] = await Promise.all([clients(true), get("/emr")]);
    cache.waiting = emr.waiting.length; renderNav("clients");
    const patients = new Set(emr.patients.map((p) => p.id)), waiting = new Set(emr.waiting.map((p) => p.id));
    const q = state.clientQ.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((c) => q.every((w) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(w)));
    return `
    <div class="view-head"><div><h1>Clients</h1><p class="muted">${plural(list.length, "account")} · ${plural(patients.size, "active patient")} · ${waiting.size} waiting to be converted</p></div>
    <div class="row"><input class="input" id="clientQ" style="width:240px" placeholder="Filter by name, email or phone" value="${esc(state.clientQ)}" aria-label="Filter clients"></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>Client</th><th>Status</th><th>Documents</th><th>Next visit</th><th>Membership</th><th>Last sign-in</th></tr></thead>
      <tbody id="clientRows">${clientRows(shown, patients, waiting) || noneRow(6, list.length ? "No one matches." : "No clients yet.")}</tbody>
    </table></div></div>`;
  };
  function clientRows(list, patients, waiting) {
    return list.map((c) => `<tr class="click" data-act="chart" data-id="${esc(c.id)}">
      <td><div class="row">${avatar(c.name)}<div style="min-width:0"><b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.email)}${c.phone ? " · " + esc(c.phone) : ""}</div></div></div></td>
      <td>${patients.has(c.id) ? `<span class="pill ok">Active patient</span>` : waiting.has(c.id) ? `<span class="pill warn">Waiting</span>` : `<span class="pill">Member</span>`}${c.clientType === "inpatient" ? ` <span class="pill">Inpatient</span>` : ""}</td>
      <td>${c.documents ? (c.documents.complete ? `<span class="pill ok">Complete</span>` : `${c.documents.done} of ${c.documents.total}`) : "—"}</td>
      <td class="num">${c.next ? `${fmtDate(c.next.date)} · ${fmtTime(c.next.time)}` : `<span class="muted">Not booked</span>`}</td>
      <td>${c.membership ? `<span class="pill ok">${esc(c.membership.tier || "Member")}</span>` : `<span class="muted">—</span>`}</td>
      <td class="muted">${when(c.lastLoginAt)}</td></tr>`).join("");
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
    const [d, c] = await Promise.all([get(`/emr/${id}`), get(`/clients/${id}`)]);
    cache.chart = { d, c };
    const tabs = [["overview", "Overview"], ["notes", "Clinical notes"], ["plans", "Plans & protocols"], ["measures", "Measures"], ["meds", "Meds & allergies"], ["files", "Files"], ["billing", "Billing"], ["consent", "Sharing & consent"]];
    return `
    <div class="view-head"><div class="row" style="gap:14px">${avatar(d.name, 52)}<div style="min-width:0"><h1>${esc(d.name)}</h1>
      <p class="muted">${esc(d.email)}${d.phone ? " · " + esc(d.phone) : ""} · ${d.clientType === "inpatient" ? "inpatient" : "outpatient"} · joined ${when(d.createdAt)}</p>
      <div class="row" style="margin-top:6px">${d.patient ? `<span class="pill ok">Active patient${d.since ? " since " + when(d.since) : ""}</span>` : `<span class="pill warn">Not yet a patient</span>`}</div></div></div>
      <div class="row"><button class="btn ${d.patient ? "" : "primary"}" data-act="convert" data-on="${d.patient ? "0" : "1"}">${d.patient ? "Mark as not a patient" : "Convert to active patient"}</button>
      <button class="btn" data-act="thread" data-id="${esc(id)}">Message</button><a class="btn" href="#chart" data-act="chartClose">Other client</a></div></div>
    <div class="tabs" role="tablist">${tabs.map(([t, l]) => `<button class="tab ${state.chartTab === t ? "active" : ""}" role="tab" data-act="chartTab" data-tab="${t}">${l}</button>`).join("")}</div>
    <div id="chartBody">${chartTab()}</div>`;
  };
  const REC = { joined: "Joined", documents: "Documents", patient: "Patient", note: "Note", movement: "Movement", payment: "Paid", scheduled: "Scheduled", visit: "Visit", cancelled: "Cancelled", lapsed: "Unfinished", removed: "Removed" };
  function chartTab() {
    const { d, c } = cache.chart, t = state.chartTab, first = esc(String(d.name).split(" ")[0]);
    if (t === "overview") return `
      <div class="grid g4" style="margin-bottom:16px">${kpi("Documents", `${d.documents.done}/${d.documents.total}`, d.documents.complete ? "complete" : "in progress")}${kpi("Notes", d.notes.length, "for the patient")}${kpi("Movements", d.movements.length, "prescribed")}${kpi("Paid visits", d.paidVisits.length, "need a time", d.paidVisits.length ? "warn" : "")}</div>
      <div class="grid g-side"><div class="card"><div class="card-head"><h2>Record</h2><span class="muted" style="font-size:12px">Newest first</span></div>
        ${(d.record || []).map((e) => `<div class="rec"><span class="muted num" style="font-size:12px">${when(e.at)}</span><span class="pill">${esc(REC[e.kind] || e.kind)}</span><span><b>${esc(e.title)}</b>${e.detail ? ` <span class="muted">${esc(e.detail)}</span>` : ""}</span></div>`).join("") || none("Nothing on the record yet.")}</div>
      <div class="stack"><div class="card"><h2 style="margin-bottom:10px">Contact</h2><dl class="kv"><dt>Email</dt><dd>${esc(d.email)}</dd><dt>Phone</dt><dd>${esc(d.phone || "—")}</dd><dt>Last sign-in</dt><dd>${when(d.lastLoginAt)}</dd></dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Next visit</h2>${d.nextVisit ? `<b>${fmtDate(d.nextVisit.date)} · ${fmtTime(d.nextVisit.time)}</b><div class="muted">${esc(d.nextVisit.typeName || "")}</div>` : none("Nothing booked.")}</div></div></div>`;
    if (t === "notes") return `
      <div class="card stack"><div class="card-head"><h2>Notes for ${first}</h2><span class="pill warn">${first} reads these in the app</span></div>
        <p class="muted" style="margin:0">These notes are shared with the patient. This system does not yet have private clinical notes or signing.</p>
        <form class="stack" data-form="note"><div class="row" style="justify-content:space-between"><label class="muted" for="noteText" style="font-size:12px">New note</label><button type="button" class="btn sm mic" data-act="dictate" data-for="noteText" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div><textarea id="noteText" name="text" class="input" rows="3" maxlength="4000" required placeholder="What ${first} should know or do next"></textarea>
        <div class="row"><button class="btn primary">Add note</button></div></form></div>
      <div class="stack" style="margin-top:16px">${d.notes.map((n) => `<div class="card"><div class="card-head"><span class="muted">${when(n.at)}</span><button class="btn sm danger" data-act="rmNote" data-id="${esc(n.id)}">Remove</button></div><p class="note-text">${esc(n.text)}</p></div>`).join("") || `<div class="card">${none("No notes yet.")}</div>`}</div>`;
    if (t === "plans") return `
      <div class="card stack"><div class="card-head"><h2>Movements for ${first}</h2><span class="muted" style="font-size:12px">Each one plays its video in the app</span></div>
        <div id="mvPool"></div>
        <input class="input" id="mvSearch" type="search" placeholder="Search the video library (e.g. hip hinge, calf, dead bug)" aria-label="Search movements" autocomplete="off">
        <div id="mvResults"></div>
        <form class="stack" data-form="movement" id="mvForm" hidden><p style="margin:0"><b id="mvName"></b> <span class="muted" id="mvMeta"></span></p><input type="hidden" name="videoId"><input type="hidden" name="name">
          <div class="grid g2"><div class="field"><label for="mvDose">Sets × reps</label><input id="mvDose" name="dose" class="input" maxlength="120" placeholder="3 × 12"></div><div class="field"><label for="mvCue">Cue (optional)</label><input id="mvCue" name="cue" class="input" maxlength="300"></div></div>
          <div class="row"><button class="btn primary">Add to ${first}'s plan</button><button type="button" class="btn" data-act="mvCancel">Cancel</button></div></form></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Prescribed</h2></div>
        ${d.movements.map((m) => `<div class="list-item"><img class="mv-thumb" src="https://drive.google.com/thumbnail?id=${encodeURIComponent(m.videoId)}&sz=w160" alt="" loading="lazy" referrerpolicy="no-referrer"><span style="flex:1;min-width:0"><b>${esc(m.name)}</b>${m.dose ? ` <span class="pill">${esc(m.dose)}</span>` : ""}<div class="muted" style="font-size:12px">${m.cue ? esc(m.cue) + " · " : ""}added ${when(m.at)}</div></span><button class="btn sm danger" data-act="rmMove" data-id="${esc(m.id)}">Remove</button></div>`).join("") || none("No movements prescribed yet.")}</div>
      ${(c.assignedPrograms || []).length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Assigned programs</h2>${adminLink("clients", "Edit in admin")}</div>${c.assignedPrograms.map((p) => `<div class="list-item"><span style="flex:1"><b>${esc(p.title || p.id)}</b></span></div>`).join("")}</div>` : ""}`;
    if (t === "measures") { const pain = (c.painLog || []).slice().reverse().slice(0, 50); return `
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Pain log</h2><span class="muted" style="font-size:12px">Logged by ${first} in the app</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Area</th><th class="num">Pain</th><th>Note</th></tr></thead><tbody>
      ${pain.map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.area)}</td><td class="num">${esc(e.level)}/10</td><td>${esc(e.note || "")}</td></tr>`).join("") || noneRow(4, "No entries yet.")}</tbody></table></div></div>
      <div class="grid g3" style="margin-top:16px">${kpi("Workouts", (c.stats && c.stats.workouts) || 0, "logged")}${kpi("Streak", (c.stats && c.stats.streak) || 0, "days")}${kpi("Level", (c.rewards && c.rewards.level) || 1, esc((c.rewards && c.rewards.title) || ""))}</div>`; }
    if (t === "meds") return notBuilt("A medication and allergy list");
    if (t === "files") return `<div class="card"><div class="card-head"><h2>New patient documents</h2><span class="pill ${d.documents.complete ? "ok" : ""}">${d.documents.done} of ${d.documents.total}</span></div>
      ${d.documents.done ? `<button class="btn" data-act="docs">View documents</button><div id="docsBox" style="margin-top:12px"></div>` : none("None on file yet.")}</div>`;
    if (t === "billing") { const today = isoDay(new Date()); return `
      <div class="grid g2"><div class="card"><div class="card-head"><h2>Video visits</h2></div>
        ${d.paidVisits.map((v) => `<div class="list-item"><span style="flex:1"><b>${esc(v.name || v.service)}</b><div class="muted" style="font-size:12px">paid ${when(v.paidAt)}${v.amount != null ? ` · $${(v.amount / 100).toFixed(2)}` : ""}</div></span><span class="pill warn">Needs a time</span></div>`).join("")}
        ${d.visits.map((v) => `<div class="list-item"><span style="flex:1"><b>${esc(v.typeName)}</b><div class="muted" style="font-size:12px">${fmtDate(v.date)} ${fmtTime(v.time)} · ${v.minutes} min</div></span>${v.payment === "paid" ? `<span class="pill ok">Paid</span>` : v.payment === "exempt" ? `<span class="pill">Inpatient</span>` : ""}</div>`).join("")}
        ${d.paidVisits.length || d.visits.length ? "" : none("No video visits.")}</div>
      <div class="card"><div class="card-head"><h2>Schedule a video visit</h2></div>
        <form class="stack" data-form="consult"><div class="grid g2"><div class="field"><label for="cvDate">Date</label><input id="cvDate" name="date" type="date" class="input" min="${today}" required></div><div class="field"><label for="cvTime">Time</label><input id="cvTime" name="time" type="time" step="900" class="input" required></div></div>
        <div class="grid g2"><div class="field"><label for="cvMin">Length</label><select id="cvMin" name="minutes" class="input"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>60 min</option><option value="90">90 min</option></select></div><div class="field"><label for="cvTitle">Title</label><input id="cvTitle" name="title" class="input" maxlength="80" value="Video visit"></div></div>
        <div class="field"><label for="cvLink">Video link (blank uses your usual room)</label><input id="cvLink" name="meetingLink" type="url" class="input" placeholder="https://"></div>
        <div class="row"><button class="btn primary">Schedule</button></div></form></div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Membership</h2>${adminLink("members", "Edit in admin")}</div>${c.membership ? `<dl class="kv"><dt>Tier</dt><dd>${esc(c.membership.tier || "")}</dd><dt>Since</dt><dd>${esc(c.membership.since || "—")}</dd><dt>Paid through</dt><dd>${esc(c.membership.until || "—")}</dd></dl>` : none("No membership.")}</div>`; }
    if (t === "consent") return notBuilt("Care-team sharing consent");
    return "";
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
          <video id="teleRemote" autoplay playsinline></video>
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
        <div class="card"><div class="card-head"><h2>Waiting room</h2><span class="pill" id="teleCount">Empty</span></div><div id="teleWaiting"></div></div>
        <div class="card"><div class="card-head"><h2>Session tools</h2></div>
          <div class="list-item"><span style="flex:1">Participants</span><span class="pill">One to one · private</span></div>
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

  V.notes = async () => {
    // The scribe is on only when the server has a model connected; an older server answers 404 and it stays off
    const [emr, scribe] = await Promise.all([get("/emr"), get("/scribe").catch(() => ({ enabled: false }))]);
    const heard = state.scribeText || ""; state.scribeText = "";
    return `<div class="view-head"><div><h1>New note</h1><p class="muted">A note for a patient. They read it in their app.</p></div></div>
    <div class="grid g-side"><div class="card stack">
      <form class="stack" data-form="noteFor"><div class="field"><label for="nClient">Patient</label><select id="nClient" name="id" class="input" required>${emr.patients.map((p) => `<option value="${esc(p.id)}"${p.id === state.chartClient ? " selected" : ""}>${esc(p.name)}</option>`).join("") || `<option value="">No active patients yet</option>`}</select></div>
      <div class="field"><div class="row" style="justify-content:space-between"><label for="nBody">Note</label><button type="button" class="btn sm mic" data-act="dictate" data-for="nBody" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div><textarea id="nBody" name="text" class="input" style="min-height:260px" maxlength="4000" required placeholder="What the patient should know or do next">${scribe.enabled ? "" : esc(heard.slice(0, 4000))}</textarea></div>
      <div class="row"><button class="btn primary"${emr.patients.length ? "" : " disabled"}>Add note</button><span class="muted" style="font-size:12px">Shared with the patient as soon as it is added</span></div></form></div>
    <div class="stack"><div class="card">${scribe.enabled ? `<div class="card-head"><h2 class="row" style="gap:6px">${ui("spark", 18)}AI scribe</h2><span class="pill ok">On · ${esc(scribe.model)}</span></div>
      <form class="stack" data-form="scribe">
        <div class="field"><div class="row" style="justify-content:space-between"><label for="sText">What happened in the visit</label><button type="button" class="btn sm mic" data-act="dictate" data-for="sText" aria-pressed="false">${ui("mic", 14)}<span>Dictate</span></button></div><textarea id="sText" name="text" class="input" style="min-height:150px" maxlength="20000" required placeholder="Your rough notes, or paste a transcript. For example: right knee 3 weeks post-op, swelling down, soft tissue on the quad, heel slides 2x10 twice a day, back in a week.">${esc(heard)}</textarea></div>
        <div class="row"><button class="btn primary"${emr.patients.length ? "" : " disabled"}>Draft the note</button><span class="muted" style="font-size:12px" id="sMsg" role="status"></span></div>
        <p class="muted" style="font-size:12px;margin:0">The draft lands in the Note box for you to read and edit. Nothing is saved or shared until you press Add note. The patient's name, emails and phone numbers are removed before the text goes to ${esc(scribe.host)}.</p>
      </form>` : `<div class="card-head"><h2 class="row" style="gap:6px">${ui("spark", 18)}AI scribe</h2><span class="pill">Not connected</span></div>${none("Drafts the patient's note from your rough notes. It turns on once a language model is connected on the server.")}`}</div>
    <div class="card"><div class="card-head"><h2>Private notes and signing</h2><span class="pill">Not connected</span></div>${none("This system stores only notes the patient can read. Private clinical notes, sensitivity tiers and sign-and-lock are not built yet.")}</div></div></div>`;
  };

  V.forms = async () => {
    const list = await clients(true);
    return `<div class="view-head"><div><h1>Forms & intake</h1><p class="muted">New patient documents: client information, pain assessment, history and consent</p></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Client</th><th>Documents</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="muted" style="font-size:12px">${esc(c.email)}</div></td><td>${c.documents ? (c.documents.complete ? `<span class="pill ok">Complete</span>` : `<span class="pill">${c.documents.done} of ${c.documents.total}</span>`) : "—"}</td><td>${c.documents && c.documents.done ? `<button class="btn sm" data-act="docsModal" data-id="${esc(c.id)}">View</button>` : ""}</td></tr>`).join("") || noneRow(3, "No clients yet.")}</tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Form builder</h2><span class="pill">Not connected</span></div>${none("The four intake documents are fixed. A builder for custom forms is not built yet.")}</div>`;
  };

  V.programs = async () => {
    const c = await get("/content");
    return `<div class="view-head"><div><h1>Programs</h1><p class="muted">${plural(c.programs.length, "program")} · ${plural((c.lectures || []).length, "lecture")}</p></div>${adminLink("content", "Edit content")}</div>
    <div class="grid g3">${c.programs.map((p) => `<div class="card"><div class="card-head"><h2>${esc(p.title)}</h2></div><div class="row" style="gap:6px"><span class="pill">${esc(p.category || "")}</span><span class="pill">${esc(p.level || "")}</span><span class="pill">${p.weeks} weeks</span><span class="pill ${p.access === "free" ? "ok" : ""}">${esc(p.access || "")}</span></div><p class="muted" style="margin:10px 0 0">${esc(String(p.summary || "").slice(0, 160))}</p></div>`).join("") || `<div class="card">${none("No programs.")}</div>`}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Lectures</h2></div>${(c.lectures || []).map((l) => `<div class="list-item"><span style="flex:1"><b>${esc(l.title)}</b><div class="muted" style="font-size:12px">${esc(l.topic || "")} · ${l.minutes} min</div></span><span class="pill">${esc(l.access || "")}</span></div>`).join("") || none("No lectures.")}</div>`;
  };

  V.nutrition = async () => {
    const c = await get("/content"), recs = (c.recommendations || []);
    return `<div class="view-head"><div><h1>Nutrition</h1><p class="muted">Recommendations members see in the app</p></div>${adminLink("content", "Edit content")}</div>
    <div class="stack">${recs.map((r) => `<div class="card"><div class="card-head"><h2>${esc(r.title)}</h2><span class="pill">${esc(r.area || "")}</span></div><p class="note-text muted">${esc(String(r.body || "").slice(0, 400))}</p></div>`).join("") || `<div class="card">${none("No recommendations.")}</div>`}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Food journals and meal plans</h2><span class="pill">Not connected</span></div>${none("Per-client food journals, targets and meal plans are not built yet.")}</div>`;
  };

  V.fitness = async () => {
    const pool = (await get("/emr/pool")).pool || [], by = {};
    EXERCISES.forEach((e) => { by[e.region] = (by[e.region] || 0) + 1; });
    return `<div class="view-head"><div><h1>Fitness</h1><p class="muted">${plural(EXERCISES.length, "video")} in the movement library</p></div></div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Movements you prescribe most</h2></div>${pool.map((m) => `<div class="list-item"><span style="flex:1"><b>${esc(m.name)}</b>${m.dose ? ` <span class="pill">${esc(m.dose)}</span>` : ""}</span><span class="muted">${plural(m.uses, "time")}</span></div>`).join("") || none("Nothing prescribed yet. Add movements from a client's chart, under Plans.")}</div>
    <div class="card"><div class="card-head"><h2>Library by body region</h2></div>${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<div class="list-item"><span style="flex:1">${esc(r)}</span><b class="num">${n}</b></div>`).join("") || none("No videos.")}</div></div>`;
  };

  V.payments = async () => {
    const [p, members, s, c] = await Promise.all([get("/payments"), get("/members"), get("/settings"), get("/content")]);
    return `<div class="view-head"><div><h1>Payments</h1><p class="muted">Self-pay only · card payments through Stripe</p></div>${adminLink("members", "Manage memberships")}</div>
    <div class="grid g3" style="margin-bottom:16px">${kpi("Card payments", p.enabled ? "On" : "Off", p.enabled ? "Stripe connected" : "Stripe not set up", p.enabled ? "ok" : "warn")}${kpi("Payment confirmations", p.webhook ? "On" : "Off", "from Stripe", p.webhook ? "ok" : "warn")}${kpi("Members and requests", members.length, "people")}</div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Services & fees</h2>${adminLink("settings", "Edit")}</div>${(s.services || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.unit || "")}</div></span><b class="num">${money(x.rate)}</b></div>`).join("") || none("No services.")}</div>
    <div class="card"><div class="card-head"><h2>Membership tiers</h2></div>${(c.tiers || []).map((t) => `<div class="list-item"><span style="flex:1"><b>${esc(t.name)}</b></span><b class="num">$${esc(t.price)}/mo</b></div>`).join("") || none("No tiers.")}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Members and requests</h2></div>${members.map((m) => `<div class="list-item"><span style="flex:1"><b>${esc(m.name)}</b> <span class="muted">${esc(m.email)}</span></span>${m.membership ? `<span class="pill ok">${esc(m.tier || "")}</span>` : m.request ? `<span class="pill warn">Requested ${esc(m.request.tier || "")}</span>` : ""}<button class="btn sm" data-act="chart" data-id="${esc(m.id)}">Chart</button></div>`).join("") || none("No members or requests yet.")}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Clients with payments</h2></div>${(p.clients || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name || x.email || "")}</b></span></div>`).join("") || none("No payments recorded.")}</div>`;
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
  V.insights = async () => {
    const tabs = `<div class="tabs" role="tablist">${[["analytics", "Analytics"], ["audit", "Audit"]].map(([t, l]) => `<button class="tab ${state.insTab === t ? "active" : ""}" role="tab" data-act="insTab" data-tab="${t}">${l}</button>`).join("")}</div>`;
    if (state.insTab === "audit") {
      const a = await get("/audit");
      return `<div class="view-head"><div><h1>Insights</h1><p class="muted">Every sign-in, every look at a record and every change</p></div><button class="btn primary" data-act="auditVerify">Verify the ledger</button></div>${tabs}
      <div class="card" style="margin-bottom:16px"><h2 style="margin-bottom:10px">Ledger check</h2><div id="auditResult">${none("Not checked in this session. Press Verify.")}</div></div>${ledgerTable(a)}`;
    }
    const days = state.insDays;
    const [d, sa, mail] = await Promise.all([get(`/analytics?days=${days}`), get(`/search-analytics?days=${days}`).catch(() => null), get("/email-log").catch(() => null)]);
    const s = d.summary, m = d.mix || {}, st = (sa && sa.totals) || {};
    const qRows = (list) => (list || []).slice(0, 10).map((r) => `<tr><td>${esc(r.q)}</td><td class="num">${esc(r.impressions)}</td><td class="num">${esc(r.clicks)}</td><td class="num">${esc(r.ctr)}%</td></tr>`).join("") || noneRow(4, "No data yet.");
    return `<div class="view-head"><div><h1>Insights</h1><p class="muted">Website traffic, search and alerts</p></div>
      <select class="input" style="width:auto" data-change="insDays" aria-label="Period">${[7, 30, 90].map((n) => `<option value="${n}"${n === days ? " selected" : ""}>Last ${n} days</option>`).join("")}</select></div>${tabs}
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
    <div class="grid g3" style="margin-bottom:16px">
      <div class="card"><h2 style="margin-bottom:10px">Ledger check</h2><div id="auditResult">${none("Not checked in this session. Press Verify.")}</div></div>
      <div class="card"><h2 style="margin-bottom:10px">Sign-in</h2><div class="list-item"><span style="flex:1">Two-step sign-in by email code</span><span class="pill ${mfa.enabled ? "ok" : "warn"}">${mfa.enabled ? "On" : "Off"}</span></div><div class="list-item"><span style="flex:1">Signs out when idle</span><span class="pill ok">15 minutes</span></div>${adminLink("settings", "Change sign-in settings")}</div>
      <div class="card"><h2 style="margin-bottom:10px">Not connected</h2>${none("Sensitivity tiers, break-glass access and per-vendor agreement tracking are not in this system yet.")}</div>
    </div>
    ${ledgerTable(a)}`;
  };

  V.settings = async () => {
    const [s, cal, me] = await Promise.all([get("/settings"), get("/calsync"), get("/me")]);
    const b = s.business || {};
    return `<div class="view-head"><div><h1>Settings</h1><p class="muted">Read here; edit in the admin portal for now</p></div>${adminLink("settings", "Edit settings")}</div>
    <div class="grid g2">
      <div class="card"><h2 style="margin-bottom:10px">Practice</h2><dl class="kv"><dt>Name</dt><dd>${esc(b.name)}</dd><dt>Tagline</dt><dd>${esc(b.tagline)}</dd><dt>Phone</dt><dd>${esc(b.phone)}</dd><dt>Address</dt><dd>${esc(b.address)}</dd><dt>Hours</dt><dd>${esc(b.hours)}</dd></dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Connections</h2>
        <div class="list-item"><span style="flex:1">Google Calendar</span><span class="pill ${cal.google === "on" ? "ok" : ""}">${esc(cal.google)}</span></div>
        <div class="list-item"><span style="flex:1">SimplePractice calendar</span><span class="pill ${cal.simplepractice === "on" ? "ok" : ""}">${esc(cal.simplepractice)}</span></div>
        <div class="list-item"><span style="flex:1">Email alerts to you</span><span class="pill ${me.emailNotifications ? "ok" : ""}">${me.emailNotifications ? "on" : "off"}</span></div>
        ${cal.lastError ? `<p class="muted" style="margin:8px 0 0">Last calendar error: ${esc(cal.lastError)}</p>` : ""}</div>
      <div class="card"><div class="card-head"><h2>Services & fees</h2></div>${(s.services || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.unit || "")}</div></span><b class="num">${money(x.rate)}</b></div>`).join("") || none("No services.")}</div>
      <div class="card"><div class="card-head"><h2>Discipline modules</h2><span class="pill">Not connected</span></div>${none("This system serves one practice and one discipline. Switching modules on and off is not built yet.")}</div>
    </div>`;
  };

  V.portal = async () => `<div class="view-head"><div><h1>Client app</h1><p class="muted">What members use on their phone and on the web</p></div><a class="btn primary" href="/account" target="_blank" rel="noopener">Open the client app</a></div>
    <div class="card"><h2 style="margin-bottom:10px">What members can do today</h2>${["Read notes from you and play their prescribed movements", "Book and pay for video visits", "Fill out new patient documents", "Message you", "Log pain and workouts", "Follow programs and earn rewards"].map((x) => `<div class="list-item">${x}</div>`).join("")}</div>`;

  V.booking = async () => {
    const s = await get("/settings"), url = location.origin + "/book";
    return `<div class="view-head"><div><h1>Booking page</h1><p class="muted">The public page where people book with you</p></div><a class="btn primary" href="/book" target="_blank" rel="noopener">Open booking page</a></div>
    <div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Booking link</h2><div class="row"><input class="input" id="bookUrl" readonly value="${esc(url)}" aria-label="Booking link" style="flex:1"><button class="btn" data-act="copyBook">Copy</button></div>${b_note(s)}</div>
    <div class="card"><div class="card-head"><h2>What people can book</h2>${adminLink("hours", "Hours")}</div>${(s.services || []).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.unit || "")}</div></span><b class="num">${money(x.rate)}</b></div>`).join("") || none("No services.")}</div></div>`;
  };
  const b_note = (s) => s.business && s.business.bookingNote ? `<p class="muted" style="margin:10px 0 0">${esc(s.business.bookingNote)}</p>` : "";

  // ---------------------------------------------------------------- actions
  const reChart = async () => { const id = state.chartClient; const [d, c] = await Promise.all([get(`/emr/${id}`), get(`/clients/${id}`)]); cache.chart = { d, c }; const box = $("#chartBody"); if (box) box.innerHTML = chartTab(); };
  const showDocs = (d) => (d.docs || []).map((doc) => `<div class="card" style="box-shadow:none;margin-top:10px"><h3 style="margin:0 0 2px">${esc(doc.title)}</h3><p class="muted" style="margin:0 0 8px;font-size:12px">Completed ${when(doc.createdAt)}</p><dl class="qa">${(doc.fields || []).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(Array.isArray(f.value) ? f.value.join(", ") : f.value === true ? "Yes" : f.value === false ? "No" : f.value == null || f.value === "" ? "—" : f.value)}</dd></div>`).join("")}</dl></div>`).join("") || none("No documents received yet.");
  const ACT = {
    chart: (el) => openChart(el.dataset.id),
    chartClose: (el, e) => { e.preventDefault(); state.chartClient = null; render(); },
    chartTab: (el) => { state.chartTab = el.dataset.tab; document.querySelectorAll(".tabs .tab").forEach((b) => b.classList.toggle("active", b === el)); $("#chartBody").innerHTML = chartTab(); if (state.chartTab === "plans") loadPool(); },
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
    teleAdmit: async (el) => { if (teleIn()) return; el.disabled = true; try { await teleMedia(); teleMount(); MDFitRT.emit("tele_admit", { clientId: el.dataset.id }); } catch (err) { el.disabled = false; toast(err.message); } },
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
    teleChat: async (f) => { const body = f.body.value.trim(); if (!body) return; if (!teleSend({ t: "chat", body })) { toast("Chat isn't connected yet."); return; } tele.chat.push({ me: true, body, at: Date.now() }); f.body.value = ""; teleMount(); },
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
    consult: async (f) => { const a = await api("POST", `/api/admin/clients/${state.chartClient}/consult`, { date: f.date.value, time: f.time.value, minutes: Number(f.minutes.value), title: f.title.value.trim(), meetingLink: f.meetingLink.value.trim(), message: "" }); toast(`Scheduled ${fmtDate(a.date)} at ${fmtTime(a.time)}.`); await reChart(); },
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
  async function loadPool() {
    const box = $("#mvPool"); if (!box) return;
    const pool = ((await get("/emr/pool").catch(() => ({ pool: [] }))).pool || []).slice(0, 12);
    if ($("#mvPool")) $("#mvPool").innerHTML = pool.length ? `<p class="muted" style="margin:0 0 6px;font-size:12px">Prescribed most often. One tap adds it with the same dose.</p><div class="row">${pool.map((m) => `<button type="button" class="btn sm" data-act="mvPool" data-id="${esc(m.videoId)}" data-name="${esc(m.name)}" data-dose="${esc(m.dose || "")}" data-cue="${esc(m.cue || "")}">${esc(m.name)}${m.dose ? ` <span class="muted">${esc(m.dose)}</span>` : ""}</button>`).join("")}</div>` : "";
  }

  document.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || !token) return; const fn = ACT[el.dataset.act]; if (fn) guard(fn)(el, e); });
  document.addEventListener("submit", (e) => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault(); const fn = FORMS[f.dataset.form]; if (fn && token) guard(fn)(f); });
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-change=leadStatus]")) guard(ACT.leadSave)(e.target);
    if (e.target.matches("[data-change=teleScribe]")) teleScribe(e.target.checked);
    if (e.target.matches("[data-change=bcTo]")) { const p = $("#bcPick"); if (p) p.hidden = e.target.value !== "selected"; }
    if (e.target.matches("[data-change=insDays]")) { state.insDays = Number(e.target.value) || 30; render(); }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "mvSearch") {
      const q = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean), box = $("#mvResults");
      box.innerHTML = q.length ? (EXERCISES.filter((x) => q.every((w) => `${x.name} ${x.region} ${x.cat}`.toLowerCase().includes(w))).slice(0, 10).map((x) => `<div class="list-item"><span style="flex:1"><b>${esc(x.name)}</b><div class="muted" style="font-size:12px">${esc(x.region)} · ${esc(x.cat)} · level ${x.level}</div></span><button type="button" class="btn sm" data-act="mvPick" data-id="${esc(x.id)}">Choose</button></div>`).join("") || none("No movement matches.")) : "";
    }
    if (e.target.id === "clientQ") { state.clientQ = e.target.value; clearTimeout(e.target._t); e.target._t = setTimeout(async () => { const pos = e.target.selectionStart; await render(); const i = $("#clientQ"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 250); }
  });

  // ---------------------------------------------------------------- router and start
  let seq = 0;
  async function render() {
    if (dict.on && !(dict.box && dict.box.isConnected && route() === dict.route)) stopDictation();
    if (!token) return;
    let r = (location.hash || "#dashboard").slice(1); if (r === "reports") r = "insights"; if (!V[r]) r = "dashboard";
    renderNav(r); $("#nav").classList.remove("open");
    const my = ++seq, view = $("#view");
    if (!view.innerHTML) view.innerHTML = `<p class="spin">Loading…</p>`;
    try { const html = await V[r](); if (my !== seq || !token) return; view.innerHTML = html; if (r === "chart" && state.chartTab === "plans") loadPool(); if (r === "telehealth") { if (window.MDFitRT) MDFitRT.emit("tele_list"); teleMount(); } }
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
      if (dict.box.isConnected) { dict.box.value = dict.base + dict.said + interim; dict.box.scrollTop = dict.box.scrollHeight; }
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

  // ---- Built-in video visits. The patient knocks from /visit; Dr. Jared admits them here. Sound and picture then
  // travel browser to browser, encrypted by the browsers (WebRTC). The server only passes the short set-up messages
  // and never sees the call. Chat, the whiteboard and the pain check-in ride a private data channel between the same
  // two browsers, so they never touch the server either and are gone when the visit ends.
  // The call lives in `tele`, outside the screen, so moving around the workspace keeps it up.
  const TELE0 = () => ({ call: null, pc: null, dc: null, local: null, cam: null, screen: null, remote: null, micOff: false, camOff: false, blur: false, status: "", queue: [], tick: 0,
    chat: [], chatOpen: false, unread: 0, pain: null, painAsked: false, board: false, scribing: false, scribeRec: null });
  const tele = { waiting: [], ice: null, transcript: "", ...TELE0() };
  const teleIn = () => !!tele.call;
  const teleSay = (t) => { tele.status = t; const el = $("#teleStatus"); if (el) el.textContent = t; };
  const teleSend = (m) => { try { if (tele.dc && tele.dc.readyState === "open") { tele.dc.send(JSON.stringify(m)); return true; } } catch {} return false; };
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
  function teleDrop() {
    clearInterval(tele.tick); teleScribeStop();
    if (tele.dc) { try { tele.dc.close(); } catch {} }
    if (tele.pc) { try { tele.pc.close(); } catch {} }
    for (const s of [tele.local, tele.screen]) if (s) s.getTracks().forEach((t) => t.stop());
    Object.assign(tele, TELE0()); // chat, whiteboard and pain answer go with the visit; a transcript waits for Notes
  }
  function teleOver(msg) { const was = teleIn(); teleDrop(); teleSay(""); if (was && msg) toast(msg); if (route() === "telehealth") teleMount(); }
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  function teleClock() { const el = $("#teleTimer"); if (!el) return; const s = tele.call ? Math.floor((Date.now() - tele.call.since) / 1000) : 0; el.textContent = mmss(s) + (tele.call && tele.call.minutes ? ` / ${mmss(tele.call.minutes * 60)}` : ""); }

  // What arrives over the private channel from the patient's browser
  function teleData(m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "chat" && typeof m.body === "string") { tele.chat.push({ me: false, body: m.body.slice(0, 1000), at: Date.now() }); if (!tele.chatOpen || route() !== "telehealth") { tele.unread++; toast("New chat message in the visit"); } teleMount(); }
    else if (m.t === "pain") { const n = Math.round(Number(m.level)); if (n >= 0 && n <= 10) { tele.pain = n; toast(`${tele.call ? tele.call.name : "The patient"} reports pain ${n} out of 10`); teleMount(); } }
    else if (m.t === "draw") boardLine($("#teleBoard"), m, "#F0A55B");
    else if (m.t === "clear") boardClear($("#teleBoard"));
  }
  // Shared whiteboard: lines are sent as fractions of the board's size, so both screens show the same drawing
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
    let ok = false;
    try { ok = !!SR && typeof SR.available === "function" && (await SR.available({ langs: ["en-US"], processLocally: true })) === "available"; } catch {}
    if (!ok) { toast("Live transcription needs on-device speech recognition, which this browser does not have ready. Nothing was turned on, and no audio left this computer."); teleMount(); return; }
    tele.scribing = true;
    const go = () => {
      if (!tele.scribing || !teleIn()) return;
      const r = new SR(); tele.scribeRec = r; r.lang = "en-US"; r.continuous = true; r.interimResults = false;
      try { r.processLocally = true; } catch {}
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
  async function teleBegin(ev) {
    try {
      if (!tele.ice) tele.ice = (await get("/telehealth/ice")).iceServers || [];
      const stream = await teleMedia();
      const pc = new RTCPeerConnection({ iceServers: tele.ice }); tele.pc = pc; tele.queue = [];
      tele.call = { clientId: ev.clientId, name: ev.name || "Patient", visit: ev.visit || "", minutes: Number(ev.minutes) || 0, since: Date.now() };
      tele.transcript = "";
      // The private channel for chat, whiteboard and the pain check-in (browser to browser, same encryption as the call)
      const dc = pc.createDataChannel("visit"); tele.dc = dc;
      dc.onmessage = (e) => { try { teleData(JSON.parse(e.data)); } catch {} };
      dc.onopen = () => teleMount(); dc.onclose = () => teleMount();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.ontrack = (e) => { tele.remote = e.streams[0] || new MediaStream([e.track]); const v = $("#teleRemote"); if (v) v.srcObject = tele.remote; teleMount(); };
      pc.onicecandidate = (e) => { if (e.candidate) MDFitRT.emit("tele_signal", { candidate: e.candidate }); };
      // Same approach as the Connect Studio: this side makes every offer (first one and any re-offer), and a path
      // that drops is looked for again (ICE restart) before the visit is given up on.
      let offering = false, retry = 0, tries = 0;
      pc.onnegotiationneeded = async () => {
        if (offering || tele.pc !== pc) return; offering = true;
        try { await pc.setLocalDescription(await pc.createOffer()); MDFitRT.emit("tele_signal", { sdp: pc.localDescription }); }
        catch (err) { teleSay("Set-up problem: " + err.message); }
        finally { offering = false; }
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState; clearTimeout(retry);
        if (s === "connected") { tries = 0; teleSay("Connected, encrypted browser to browser"); }
        else if (s === "connecting") teleSay("Connecting…");
        else if (s === "disconnected") { teleSay("Connection interrupted. Trying to recover…"); retry = setTimeout(() => { if (tele.pc === pc && pc.connectionState === "disconnected") { try { pc.restartIce(); } catch {} } }, 4000); }
        else if (s === "failed") {
          if (tries++ < 2) { teleSay("Connection lost. Reconnecting…"); try { pc.restartIce(); } catch {} }
          else teleSay("Could not connect: one of the two networks blocks direct video. Ask the patient to try another network.");
        }
      };
      teleSay("Connecting…");
      clearInterval(tele.tick);
      tele.tick = setInterval(() => { teleClock(); idleBump(); /* a visit counts as activity */ }, 1000);
      if (route() === "telehealth") teleMount(); else toast(`Video visit with ${tele.call.name} started. Open Telehealth to see it.`);
    } catch (err) { MDFitRT.emit("tele_end"); teleOver(""); toast(err.message); }
  }
  async function teleSignal(d) {
    const pc = tele.pc; if (!pc || !d) return;
    try {
      if (d.sdp) { await pc.setRemoteDescription(d.sdp); for (const c of tele.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {}); }
      else if (d.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(d.candidate).catch(() => {}); else tele.queue.push(d.candidate); }
    } catch (err) { teleSay("Set-up problem: " + err.message); }
  }
  async function teleShare() {
    if (!tele.pc) return;
    const sender = tele.pc.getSenders().find((s) => s.track && s.track.kind === "video") || tele.pc.getSenders().find((s) => !s.track);
    if (tele.screen) { tele.screen.getTracks().forEach((t) => t.stop()); tele.screen = null; if (sender && tele.cam) await sender.replaceTrack(tele.cam); teleMount(); return; }
    if (!sender) { toast("Screen sharing needs a camera connection in this visit."); return; }
    try {
      tele.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = tele.screen.getVideoTracks()[0];
      track.onended = () => { if (tele.screen) teleShare(); };
      await sender.replaceTrack(track); teleMount();
    } catch { tele.screen = null; }
  }
  // Ending a visit: if words were transcribed, they go to the Notes screen for the scribe (held in this page only)
  function teleFinish() {
    const text = tele.transcript.trim(), who = tele.call && tele.call.clientId;
    MDFitRT.emit("tele_end"); teleOver("");
    if (text) { state.scribeText = text; tele.transcript = ""; if (who) state.chartClient = who; toast("Visit ended. Your transcript is on the Notes screen."); location.hash = "notes"; }
    else toast("Visit ended.");
  }
  // Puts the current state on the Telehealth screen without redrawing it (the videos must not be torn down)
  function teleMount() {
    const stage = $("#teleStage"); if (!stage) return;
    const r = $("#teleRemote"), l = $("#teleLocal");
    if (r && r.srcObject !== tele.remote) r.srcObject = tele.remote;
    const mine = tele.screen || tele.local; if (l && l.srcObject !== mine) l.srcObject = mine;
    stage.classList.toggle("live", teleIn()); stage.classList.toggle("has-remote", !!tele.remote); stage.classList.toggle("boarding", tele.board);
    $("#teleWho").textContent = tele.call ? `${tele.call.name}${tele.call.visit ? " · " + tele.call.visit : ""}` : "";
    $("#teleAvatarName").textContent = tele.call ? tele.call.name : "";
    $("#teleIdle").hidden = teleIn(); $("#teleControls").hidden = !teleIn();
    // Round icon buttons, filled while the thing is on
    const set = (id, on, labelOn, labelOff) => { const el = $(id); if (el) { el.classList.toggle("on", on); el.setAttribute("aria-pressed", String(on)); el.setAttribute("aria-label", on ? labelOn : labelOff); el.title = on ? labelOn : labelOff; } };
    set("#teleMic", !tele.micOff, "Microphone on. Press to mute", "Muted. Press to unmute");
    set("#teleCam", !!tele.cam && !tele.camOff, "Camera on. Press to turn off", "Camera off. Press to turn on");
    set("#teleShare", !!tele.screen, "Sharing your screen. Press to stop", "Share your screen");
    set("#teleBoardBtn", tele.board, "Whiteboard open. Press to close", "Open the whiteboard");
    set("#teleBlurBtn", tele.blur, "Background blurred. Press to show it", "Blur your background");
    set("#teleChatBtn", tele.chatOpen, "Chat open. Press to close", tele.unread ? `Open chat, ${tele.unread} new` : "Open chat");
    set("#teleScribeBtn", tele.scribing, "Transcribing on this device. Press to stop", "Transcribe for the AI scribe");
    const dot = $("#teleChatDot"); if (dot) dot.hidden = !tele.unread;
    const sw = $("#teleScribeSw"); if (sw) sw.checked = tele.scribing;
    const words = $("#teleWords"); if (words) words.textContent = tele.scribing ? `${tele.transcript.trim().split(/\s+/).filter(Boolean).length} words so far` : teleIn() ? "Off" : "Starts with a visit";
    for (const id of ["#teleCam", "#teleBlurBtn"]) if ($(id)) $(id).disabled = !tele.cam;
    const open = !!(tele.dc && tele.dc.readyState === "open");
    for (const id of ["#teleBoardBtn", "#teleChatBtn", "#telePainBtn"]) if ($(id)) $(id).disabled = !open;
    if (sw) sw.disabled = !teleIn();
    const pain = $("#telePain"); if (pain) pain.textContent = tele.pain !== null ? `${tele.pain} out of 10` : tele.painAsked ? "Asked, waiting" : "";
    const cv = $("#teleBoard"); if (cv) { cv.hidden = !tele.board; if (tele.board) { boardFit(cv); boardWire(cv); } }
    const clr = $("#teleClear"); if (clr) clr.hidden = !tele.board;
    const box = $("#teleChatBox");
    if (box) {
      box.hidden = !(tele.chatOpen && teleIn());
      const list = $("#teleChatList"), stick = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.innerHTML = tele.chat.map((m) => `<div class="bubble ${m.me ? "me" : ""}">${esc(m.body)}</div>`).join("") || `<p class="muted" style="margin:0;font-size:12.5px">Messages here go straight between the two of you and disappear when the visit ends.</p>`;
      if (stick) list.scrollTop = list.scrollHeight;
    }
    teleSay(tele.status); teleClock();
    const w = $("#teleWaiting");
    if (w) w.innerHTML = tele.waiting.map((p) => `<div class="list-item"><span style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="muted" style="font-size:12px">${esc(p.visit || "No video visit booked today")} · waiting ${Math.max(0, Math.round((Date.now() - p.since) / 60000))} min</div></span><button class="btn sm primary" data-act="teleAdmit" data-id="${esc(p.clientId)}"${teleIn() ? " disabled" : ""}>Admit</button><button class="btn sm ghost" data-act="teleDecline" data-id="${esc(p.clientId)}" aria-label="Turn away ${esc(p.name)}">${ui("x", 14)}</button></div>`).join("") || none(MDFitRT && MDFitRT.connected() ? "Nobody is waiting. Patients appear here when they open their visit link." : "Not connected to the live service. Reload the page.");
    const n = $("#teleCount"); if (n) { n.textContent = tele.waiting.length ? `${tele.waiting.length} waiting` : "Empty"; n.className = "pill" + (tele.waiting.length ? " ok" : ""); }
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
      const had = new Set(tele.waiting.map((p) => p.clientId)); tele.waiting = (ev && ev.waiting) || [];
      const fresh = tele.waiting.find((p) => !had.has(p.clientId));
      if (route() === "telehealth") teleMount(); else if (fresh && token) toast(`${fresh.name} is in the video waiting room`);
    });
    MDFitRT.on("tele_started", (ev) => { if (token) teleBegin(ev || {}); });
    MDFitRT.on("tele_signal", (d) => teleSignal(d));
    MDFitRT.on("tele_ended", (ev) => teleOver(ev && ev.why === "patient_left" ? "The patient left the visit." : ev && ev.why === "staff_left" ? "The visit ended: this page lost its connection." : "Visit ended."));
    MDFitRT.on("tele_error", (ev) => { if (ev && ev.error) toast(ev.error); });
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
  $("#globalSearch").addEventListener("keydown", guard(async (e) => {
    if (e.key !== "Enter" || !token) return;
    const q = e.target.value.trim().toLowerCase(); if (!q) return;
    const c = (await clients()).find((x) => `${x.name} ${x.email}`.toLowerCase().includes(q));
    if (c) { e.target.value = ""; openChart(c.id); } else toast("No client matches that.");
  }));
  // A restored session keeps its old last-input time: a reload must not hand out a fresh 15 minutes
  if (token && idleFor() >= IDLE_MS) idleOut();
  else if (token) { if (!idleFor()) idleStamp(); start(); } else { $("#signin").hidden = false; $("#app").hidden = true; }
})();
