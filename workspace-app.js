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
  const state = { chartClient: null, chartTab: "overview", thread: null, calWeek: 0, clientQ: "" };
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
    token = ""; store.set(""); cache.clients = null; cache.me = null; state.chartClient = null; state.thread = null;
    $("#view").innerHTML = ""; $("#nav").innerHTML = ""; $("#whoami").textContent = ""; closeModal();
    $("#app").hidden = true; $("#signin").hidden = false; clearTimeout(idleTimer);
  }
  let idleTimer;
  const IDLE_MS = 15 * 60 * 1000;
  function idleBump() { clearTimeout(idleTimer); if (token) idleTimer = setTimeout(() => { signOut(); $("#siMsg").textContent = "Signed out after 15 minutes without activity."; }, IDLE_MS); }
  ["pointerdown", "keydown", "scroll"].forEach((ev) => window.addEventListener(ev, idleBump, { passive: true, capture: true }));

  $("#signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#siMsg"); msg.textContent = "";
    try {
      const body = { email: f.email.value.trim(), password: f.password.value }; if (f.code.value.trim()) body.code = f.code.value.trim();
      const out = await api("POST", "/api/admin/login", body);
      token = out.token; store.set(token); f.reset(); $("#siCodeRow").hidden = true; start();
    } catch (err) {
      if (/code/i.test(err.message)) { $("#siCodeRow").hidden = false; f.code.focus(); }
      msg.textContent = err.message;
    }
  });
  $("#signOut").addEventListener("click", signOut);

  // ---------------------------------------------------------------- navigation
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
    reports: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
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
    { g: "Business", items: [["payments", "Payments"], ["newsletter", "Newsletter"], ["reports", "Reports"]] },
    { g: "Admin", items: [["team", "Team & roles"], ["feedback", "Reviews & feedback"], ["security", "Security & audit"], ["settings", "Modules & settings"]] },
    { g: "Client-facing", items: [["portal", "Client app"], ["booking", "Booking page"]] }
  ];
  function renderNav(active) {
    const badge = (id) => id === "messages" && cache.unread ? `<span class="badge">${cache.unread}</span>` : id === "clients" && cache.waiting ? `<span class="badge">${cache.waiting}</span>` : "";
    $("#nav").innerHTML = `<div class="brand"><div class="logo">M</div><div><b>MD Fit</b><div class="muted" style="font-size:12px">Physical Rehab &amp; Fitness</div></div></div>` +
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
    const [appts, classes, bookings] = await Promise.all([get("/appointments?all=1"), get("/classes"), get("/bookings")]);
    cache.appts = appts;
    const now = new Date(), mon = new Date(now); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + state.calWeek * 7);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
    const START = 6, top = (t) => { const [h, m] = t.split(":").map(Number); return (h + m / 60 - START) * 56; };
    const cols = days.map((d) => {
      const key = isoDay(d), dow = d.getDay();
      const ev = appts.filter((a) => a.date === key && a.status !== "cancelled").map((a) => `<div class="appt" style="--c:var(--${a.status === "completed" ? "ok" : "body"});top:${top(a.time) + 2}px;height:${Math.max(26, (a.minutes || 60) / 60 * 56 - 4)}px" data-act="appt" data-id="${esc(a.id)}"><b>${esc(a.name)}</b>${fmtTime(a.time)} · ${esc(a.typeName || "")}</div>`);
      const cl = classes.filter((c) => c.active !== false && c.day === dow).map((c) => `<div class="appt" style="--c:var(--fit);top:${top(c.time) + 2}px;height:${Math.max(26, (c.durationMin || 60) / 60 * 56 - 4)}px;opacity:.85"><b>${esc(c.title)}</b>${fmtTime(c.time)} · class</div>`);
      return `<div class="cal-col" style="grid-row:2">${ev.concat(cl).join("")}</div>`;
    }).join("");
    const today = isoDay(now);
    return `
    <div class="view-head"><div><h1>Calendar</h1><p class="muted">Week of ${mon.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</p></div>
    <div class="row"><button class="btn sm" data-act="calWeek" data-d="-1" aria-label="Previous week">‹</button><button class="btn sm" data-act="calWeek" data-d="0">Today</button><button class="btn sm" data-act="calWeek" data-d="1" aria-label="Next week">›</button>
    ${adminLink("hours", "Hours &amp; calendar sync")}</div></div>
    <div class="row" style="margin-bottom:12px"><span class="pill"><span class="dot" style="background:var(--body)"></span>Booked</span><span class="pill"><span class="dot" style="background:var(--ok)"></span>Completed</span><span class="pill"><span class="dot" style="background:var(--fit)"></span>Class</span></div>
    <div class="table-wrap"><div class="cal">
      <div style="border-bottom:1px solid var(--line)"></div>${days.map((d) => `<div class="cal-h ${isoDay(d) === today ? "today" : ""}">${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getDate()}</div>`).join("")}
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
        <form class="stack" data-form="note"><label class="muted" for="noteText" style="font-size:12px">New note</label><textarea id="noteText" name="text" class="input" rows="3" maxlength="4000" required placeholder="What ${first} should know or do next"></textarea>
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
    return `<div class="view-head"><div><h1>Messages</h1><p class="muted">Conversations with members · stored encrypted on the server</p></div>${adminLink("messages", "Message many people")}</div>
    <div class="card chat" style="padding:0">
      <div class="threads">${t.threads.map((x) => `<div class="thread ${x.clientId === state.thread ? "active" : ""}" data-act="thread" data-id="${esc(x.clientId)}">${avatar(x.name, 36)}<div style="flex:1;min-width:0"><div class="row" style="justify-content:space-between"><b>${esc(x.name)}</b>${x.unread ? `<span class="badge">${x.unread}</span>` : ""}</div><div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x.last ? (x.last.from === "doctor" ? "You: " : "") + esc(x.last.body) : ""}</div></div></div>`).join("") || `<p class="muted" style="padding:16px;margin:0">No messages yet.</p>`}</div>
      <div class="msgs">${th ? `<div style="padding:12px 16px;border-bottom:1px solid var(--line)" class="row"><b>${esc(th.client.name)}</b><span class="muted" style="font-size:12px">${esc(th.client.email)}</span><button class="btn sm" style="margin-left:auto" data-act="chart" data-id="${esc(th.client.id)}">Chart</button></div>
        <div class="msg-list" id="msgList">${th.messages.map((m) => `<div class="bubble ${m.from === "doctor" ? "me" : ""}">${esc(m.body)}<div class="muted" style="font-size:11px;margin-top:2px">${when(m.at)}</div></div>`).join("")}</div>
        <form class="composer" data-form="message"><input name="body" class="input" placeholder="Write a message" autocomplete="off" maxlength="4000" aria-label="Message" required><button class="btn primary">Send</button></form>` : `<p class="muted" style="padding:16px;margin:0">Pick a conversation.</p>`}</div>
    </div>`;
  };

  V.telehealth = async () => {
    const appts = await get("/appointments?all=1"), today = isoDay(new Date());
    const video = appts.filter((a) => a.date >= today && a.status === "booked" && (a.meetingLink || /remote|video|online|call/i.test(`${a.typeId} ${a.typeName}`)));
    return `<div class="view-head"><div><h1>Telehealth</h1><p class="muted">Video visits run on your own meeting link. Built-in video is not connected.</p></div>${adminLink("hours", "Set your video room link")}</div>
    <div class="card"><div class="card-head"><h2>Upcoming video visits</h2></div>
      ${video.map((a) => `<div class="list-item"><span style="flex:1"><b>${esc(a.name)}</b><div class="muted" style="font-size:12px">${fmtDate(a.date)} · ${fmtTime(a.time)} · ${esc(a.typeName || "")}</div></span>${a.meetingLink ? `<a class="btn sm primary" href="${esc(a.meetingLink)}" target="_blank" rel="noopener">Open video link</a>` : `<span class="pill warn">No link yet</span>`}</div>`).join("") || none("No video visits booked. Schedule one from a client's chart, under Billing.")}</div>`;
  };

  V.notes = async () => {
    const emr = await get("/emr");
    return `<div class="view-head"><div><h1>New note</h1><p class="muted">A note for a patient. They read it in their app.</p></div></div>
    <div class="grid g-side"><div class="card stack">
      <form class="stack" data-form="noteFor"><div class="field"><label for="nClient">Patient</label><select id="nClient" name="id" class="input" required>${emr.patients.map((p) => `<option value="${esc(p.id)}"${p.id === state.chartClient ? " selected" : ""}>${esc(p.name)}</option>`).join("") || `<option value="">No active patients yet</option>`}</select></div>
      <div class="field"><label for="nBody">Note</label><textarea id="nBody" name="text" class="input" style="min-height:260px" maxlength="4000" required placeholder="What the patient should know or do next"></textarea></div>
      <div class="row"><button class="btn primary"${emr.patients.length ? "" : " disabled"}>Add note</button><span class="muted" style="font-size:12px">Shared with the patient as soon as it is added</span></div></form></div>
    <div class="stack"><div class="card"><div class="card-head"><h2>✦ AI scribe</h2><span class="pill">Not connected</span></div>${none("Drafting notes from a recording or transcript is not built yet.")}</div>
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

  V.reports = async () => {
    const [a, st] = await Promise.all([get("/analytics"), get("/stats")]);
    return `<div class="view-head"><div><h1>Reports</h1><p class="muted">Website traffic over the last ${a.rangeDays || 30} days, and bookings</p></div>${adminLink("analytics", "Full analytics")}</div>
    <div class="grid g4" style="margin-bottom:16px">${kpi("Page views", a.summary.totalViews, `${a.summary.todayViews} today`)}${kpi("Visitors", a.summary.totalUnique, `${a.summary.todayUnique} today`)}${kpi("Requests", st.leads30d, "last 30 days")}${kpi("Sessions", st.sessionsThisWeek, "this week")}</div>
    <div class="grid g2"><div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Top pages</h2></div><div class="table-wrap"><table><thead><tr><th>Page</th><th class="num">Views</th></tr></thead><tbody>${(a.pages || []).slice(0, 12).map((p) => `<tr><td>${esc(p.page)}</td><td class="num">${p.views}</td></tr>`).join("") || noneRow(2, "No visits recorded.")}</tbody></table></div></div>
    <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>By day</h2></div><div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Views</th><th class="num">Visitors</th></tr></thead><tbody>${(a.days || []).slice(-14).reverse().map((d) => `<tr><td>${fmtDate(d.date)}</td><td class="num">${d.views}</td><td class="num">${d.unique}</td></tr>`).join("") || noneRow(3, "No visits recorded.")}</tbody></table></div></div></div>`;
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
      ${reviews.map((f) => `<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(f.name)}</b> <span class="muted">${"★".repeat(Math.max(0, Math.min(5, f.rating || 0)))}</span> <span class="pill">${esc(f.status)}</span><p class="note-text">${esc(f.text)}</p></span>
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
    <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Audit ledger</h2><span class="muted" style="font-size:12px">Newest ${Math.min(100, a.entries.length)} entries</span></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>Who</th><th>Action</th><th>Subject</th></tr></thead><tbody>
    ${a.entries.slice(0, 100).map((e) => `<tr><td class="num muted">${e.seq}</td><td class="num">${when(e.ts)}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td class="muted">${esc(e.subject || "")}</td></tr>`).join("") || noneRow(5, "No entries.")}</tbody></table></div></div>`;
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
  const showDocs = (d) => (d.docs || []).map((doc) => `<div class="card" style="box-shadow:none;margin-top:10px"><h3 style="margin:0 0 2px">${esc(doc.title)}</h3><p class="muted" style="margin:0 0 8px;font-size:12px">Completed ${when(doc.createdAt)}</p><dl class="kv">${(doc.fields || []).map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(Array.isArray(f.value) ? f.value.join(", ") : f.value === true ? "Yes" : f.value === false ? "No" : f.value == null || f.value === "" ? "—" : f.value)}</dd>`).join("")}</dl></div>`).join("") || none("No documents received yet.");
  const ACT = {
    chart: (el) => openChart(el.dataset.id),
    chartClose: (el, e) => { e.preventDefault(); state.chartClient = null; render(); },
    chartTab: (el) => { state.chartTab = el.dataset.tab; document.querySelectorAll(".tabs .tab").forEach((b) => b.classList.toggle("active", b === el)); $("#chartBody").innerHTML = chartTab(); if (state.chartTab === "plans") loadPool(); },
    thread: (el) => { state.thread = el.dataset.id; if (location.hash === "#messages") render(); else location.hash = "messages"; },
    calWeek: (el) => { const d = Number(el.dataset.d); state.calWeek = d ? state.calWeek + d : 0; render(); },
    convert: async (el) => { const r = await api("PUT", `/api/admin/emr/${state.chartClient}/patient`, { active: el.dataset.on === "1" }); toast(r.patient ? "Now an active patient." : "No longer marked as a patient."); render(); },
    rmNote: async (el) => { if (!confirm("Remove this note? The patient will no longer see it.")) return; await api("DELETE", `/api/admin/emr/${state.chartClient}/notes/${el.dataset.id}`); toast("Note removed."); await reChart(); },
    rmMove: async (el) => { if (!confirm("Remove this movement from the plan?")) return; await api("DELETE", `/api/admin/emr/${state.chartClient}/movements/${el.dataset.id}`); toast("Movement removed."); await reChart(); loadPool(); },
    mvPick: (el) => { const ex = EXERCISES.find((x) => x.id === el.dataset.id); if (!ex) return; const f = $("#mvForm"); f.videoId.value = ex.id; f.name.value = ex.name; $("#mvName").textContent = ex.name; $("#mvMeta").textContent = `${ex.region} · ${ex.cat} · level ${ex.level}`; $("#mvResults").innerHTML = ""; f.hidden = false; f.dose.focus(); },
    mvCancel: () => { const f = $("#mvForm"); f.reset(); f.hidden = true; },
    mvPool: async (el) => { await api("POST", `/api/admin/emr/${state.chartClient}/movements`, { videoId: el.dataset.id, name: el.dataset.name, dose: el.dataset.dose, cue: el.dataset.cue }); toast("Added to the plan."); await reChart(); loadPool(); },
    docs: async () => { $("#docsBox").innerHTML = showDocs(await get(`/clients/${state.chartClient}/intake`)); },
    docsModal: async (el) => { const d = await get(`/clients/${el.dataset.id}/intake`); modal(`<div class="card-head"><h2>New patient documents</h2><button class="btn sm" data-act="closeModal">Close</button></div>${showDocs(d)}`); },
    closeModal: () => closeModal(),
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
    note: async (f) => { const text = f.text.value.trim(); if (!text) return; await api("POST", `/api/admin/emr/${state.chartClient}/notes`, { text }); toast("Note added. The patient can see it now."); await reChart(); },
    noteFor: async (f) => { const text = f.text.value.trim(); if (!f.id.value || !text) return; await api("POST", `/api/admin/emr/${f.id.value}/notes`, { text }); f.text.value = ""; toast("Note added. The patient can see it now."); },
    movement: async (f) => { await api("POST", `/api/admin/emr/${state.chartClient}/movements`, { videoId: f.videoId.value, name: f.name.value, dose: f.dose.value.trim(), cue: f.cue.value.trim() }); toast("Added to the plan."); await reChart(); loadPool(); },
    consult: async (f) => { const a = await api("POST", `/api/admin/clients/${state.chartClient}/consult`, { date: f.date.value, time: f.time.value, minutes: Number(f.minutes.value), title: f.title.value.trim(), meetingLink: f.meetingLink.value.trim(), message: "" }); toast(`Scheduled ${fmtDate(a.date)} at ${fmtTime(a.time)}.`); await reChart(); },
    message: async (f) => { const body = f.body.value.trim(); if (!body) return; await api("POST", `/api/admin/messages/${state.thread}`, { body }); await render(); const l = $("#msgList"); if (l) l.scrollTop = l.scrollHeight; },
    apptSave: async (f) => { await api("PATCH", `/api/admin/appointments/${f.dataset.id}`, { status: f.status.value, adminNotes: f.adminNotes.value }); cache.appts = null; closeModal(); toast("Appointment updated."); render(); }
  };
  async function loadPool() {
    const box = $("#mvPool"); if (!box) return;
    const pool = ((await get("/emr/pool").catch(() => ({ pool: [] }))).pool || []).slice(0, 12);
    if ($("#mvPool")) $("#mvPool").innerHTML = pool.length ? `<p class="muted" style="margin:0 0 6px;font-size:12px">Prescribed most often. One tap adds it with the same dose.</p><div class="row">${pool.map((m) => `<button type="button" class="btn sm" data-act="mvPool" data-id="${esc(m.videoId)}" data-name="${esc(m.name)}" data-dose="${esc(m.dose || "")}" data-cue="${esc(m.cue || "")}">${esc(m.name)}${m.dose ? ` <span class="muted">${esc(m.dose)}</span>` : ""}</button>`).join("")}</div>` : "";
  }

  document.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || !token) return; const fn = ACT[el.dataset.act]; if (fn) guard(fn)(el, e); });
  document.addEventListener("submit", (e) => { const f = e.target.closest("[data-form]"); if (!f) return; e.preventDefault(); const fn = FORMS[f.dataset.form]; if (fn && token) guard(fn)(f); });
  document.addEventListener("change", (e) => { if (e.target.matches("[data-change=leadStatus]")) guard(ACT.leadSave)(e.target); });
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
    if (!token) return;
    let r = (location.hash || "#dashboard").slice(1); if (!V[r]) r = "dashboard";
    renderNav(r); $("#nav").classList.remove("open");
    const my = ++seq, view = $("#view");
    if (!view.innerHTML) view.innerHTML = `<p class="spin">Loading…</p>`;
    try { const html = await V[r](); if (my !== seq || !token) return; view.innerHTML = html; if (r === "chart" && state.chartTab === "plans") loadPool(); }
    catch (err) { if (my !== seq || !token) return; view.innerHTML = `<div class="card"><b>This screen could not be loaded.</b><p class="muted" style="margin:6px 0 0">${esc(err.message)}</p></div>`; }
  }
  async function start() {
    $("#signin").hidden = true; $("#app").hidden = false; idleBump();
    get("/me").then((me) => { cache.me = me; $("#whoami").textContent = me.email; }).catch(() => {});
    render();
  }
  window.addEventListener("hashchange", () => { if (location.hash !== "#chart") {} render(); });
  $("#navToggle").addEventListener("click", () => $("#nav").classList.toggle("open"));
  $("#themeBtn").addEventListener("click", () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; r.dataset.theme = dark ? "light" : "dark"; });
  $("#modalBack").addEventListener("click", (e) => { if (e.target.id === "modalBack") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  $("#globalSearch").addEventListener("keydown", guard(async (e) => {
    if (e.key !== "Enter" || !token) return;
    const q = e.target.value.trim().toLowerCase(); if (!q) return;
    const c = (await clients()).find((x) => `${x.name} ${x.email}`.toLowerCase().includes(q));
    if (c) { e.target.value = ""; openChart(c.id); } else toast("No client matches that.");
  }));
  if (token) start(); else { $("#signin").hidden = false; $("#app").hidden = true; }
})();
