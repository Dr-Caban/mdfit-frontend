// MD Fit admin portal: appointments, booking hours, leads, classes, bookings, subscribers, site settings.
(() => {
  const API = window.MDFIT_CONFIG.apiUrl.replace(/\/+$/, "");
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const STATUSES = ["new", "contacted", "booked", "client", "closed"];
  const APPT_STATUSES = ["booked", "completed", "no-show", "cancelled"];
  const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fmtTime = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

  const session = {
    get: () => { try { return sessionStorage.getItem("mdfit_token") || ""; } catch { return ""; } },
    set: (t) => { try { t ? sessionStorage.setItem("mdfit_token", t) : sessionStorage.removeItem("mdfit_token"); } catch {} }
  };
  let token = session.get();

  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.status === 401 && path !== "/api/admin/login") { logout(); throw new Error("Session expired. Log in again."); }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.blob();
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  let toastTimer;
  function toast(text, err = false) {
    const t = $("#toast");
    t.textContent = text; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }
  const run = (fn) => (...a) => Promise.resolve(fn(...a)).catch((e) => toast(e.message, true));

  // ---- Login
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $(".form-msg", f);
    msg.className = "form-msg"; msg.textContent = "";
    try {
      const body = Object.fromEntries(new FormData(f)); if (!body.code) delete body.code;
      const out = await api("POST", "/api/admin/login", body);
      token = out.token; session.set(token); f.reset(); $("#code-row").hidden = true; show();
    } catch (err) {
      if (/code/i.test(err.message)) { $("#code-row").hidden = false; f.code.focus(); }
      msg.className = "form-msg err"; msg.textContent = err.message;
    }
  });
  // Logging out also empties every rendered list: client names, messages and documents must not stay in the DOM
  // on a shared screen (HIPAA automatic logoff). The idle timer signs out after 15 minutes without input.
  function logout() {
    token = ""; session.set(""); $("#app").hidden = true; $("#login").hidden = false; if (window.MDFitRT) MDFitRT.disconnect();
    $$("#appts-list, #clients-list, #client-totals, #client-detail, #leads-list, #members-list, #msg-thread, #msg-threads, #bc-list, #feedback-list, #reviews-list, #cal-grid, #cal-pop-body, #notif-list, #home-inbox, #app table tbody").forEach((el) => { el.innerHTML = ""; });
    const pop = $("#cal-pop"); if (pop && pop.open) pop.close();
    // cached patient data goes too, so nothing is shown again before the next sign-in reloads it
    clientList = []; calAppts = []; notes = []; contentCache = null; homeThread = null; drafts.clear();
    clearTimeout(idleT);
  }
  $("#logout").addEventListener("click", logout);
  const IDLE_MS = 15 * 60 * 1000; let idleT = 0;
  const idleBump = () => { if (!token) return; clearTimeout(idleT); idleT = setTimeout(() => { logout(); $("#login .form-msg").textContent = "Signed out after 15 minutes of inactivity."; }, IDLE_MS); };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((t) => document.addEventListener(t, idleBump, { passive: true }));

  // ---- Tabs
  const loaders = { dash: loadDash, clients: loadClients, appts: loadAppts, hours: loadHours, leads: loadLeads, classes: loadClasses, bookings: loadBookings, subs: loadSubs, reviews: loadReviews, audit: loadAudit, messages: loadThreads, members: loadMembers, content: loadContent, settings: loadSettings, feedback: loadFeedback, analytics: loadAnalytics };
  // ---- Navigation: six sections in the sidebar; screens that used to be separate tabs are sub-tabs of a section.
  // Every screen keeps its own #hash so reload and the back button return to it.
  const NAV = [
    { id: "home", label: "Home", tabs: [["dash", "Calendar"], ["appts", "Appointments"], ["classes", "Classes"], ["bookings", "Class bookings"], ["hours", "Hours & sync"]] },
    { id: "people", label: "Clients", tabs: [["clients", "Clients"], ["leads", "Leads"], ["members", "Members"], ["subs", "Newsletter"]] },
    { id: "inbox", label: "Inbox", tabs: [["messages", "Messages"], ["reviews", "Reviews"], ["feedback", "Bug reports & ideas"]] },
    { id: "insights", label: "Insights", tabs: [["analytics", "Analytics"], ["audit", "Audit"]] },
    { id: "settings", label: "Settings", tabs: [["settings", "Settings"], ["content", "Content"]] }
  ];
  const groupOf = (tab) => NAV.find((g) => g.tabs.some(([t]) => t === tab)) || NAV[0];
  const fromHash = () => { const t = location.hash.slice(1); return NAV.some((g) => g.tabs.some(([x]) => x === t)) ? t : "dash"; };
  let current = fromHash();
  function openTab(name, { load = true } = {}) {
    current = name;
    const g = groupOf(name);
    $$("#sidebar [data-nav]").forEach((b) => b.setAttribute("aria-current", b.dataset.nav === g.id ? "page" : "false"));
    const sub = $("#subnav");
    sub.hidden = g.tabs.length < 2;
    sub.innerHTML = g.tabs.map(([t, l]) => `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === name}">${l}</button>`).join("");
    { const sl = (g.tabs.find(([t]) => t === name) || [])[1]; $("#tb-title").textContent = g.tabs.length > 1 && sl !== g.label ? `${g.label} · ${sl}` : g.label; }
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
    if (location.hash.slice(1) !== name) history.pushState(null, "", "#" + name);
    closeSidebar();
    if (load) run(loaders[name])();
  }
  $("#sidebar").addEventListener("click", (e) => { const b = e.target.closest("[data-nav]"); if (b) openTab(NAV.find((g) => g.id === b.dataset.nav).tabs[0][0]); });
  $("#subnav").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) openTab(b.dataset.tab); });
  window.addEventListener("popstate", () => { if (token) openTab(fromHash()); });
  // Phone/tablet: the sidebar slides in from the left
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#sb-scrim").hidden = true; $("#menu-btn").setAttribute("aria-expanded", "false"); }
  $("#menu-btn").addEventListener("click", () => { const o = !$("#sidebar").classList.contains("open"); $("#sidebar").classList.toggle("open", o); $("#sb-scrim").hidden = !o; $("#menu-btn").setAttribute("aria-expanded", String(o)); });
  $("#sb-scrim").addEventListener("click", closeSidebar);
  // Jump straight to one client's profile or message thread (from the calendar, notifications or a profile)
  async function goClient(cid) { openTab("clients", { load: false }); await loadClients(); await openClient(cid); }
  async function goThread(cid) { openTab("messages", { load: false }); await loadThreads(); await showThread(cid); }

  // ---- Notifications bell: what patients and visitors did (bookings, messages, documents, leads, reviews...),
  // newest first. "Unread" = newer than the last time the bell was opened on this browser.
  const NOTE = {
    appointment: ["📅", "New booking", "dash"], appointment_cancelled: ["❌", "Appointment cancelled", "dash"], intake: ["📝", "Intake documents", "appts"],
    lead: ["🎯", "New evaluation request", "leads"], booking: ["🏋️", "Class spot booked", "bookings"], booking_cancelled: ["❌", "Class spot cancelled", "bookings"],
    message: ["💬", "New message", "messages"], subscribe: ["📧", "New newsletter subscriber", "subs"], bug_report: ["🐛", "Bug report", "feedback"],
    suggestion: ["💡", "Suggestion", "feedback"], feedback: ["⭐", "New review", "reviews"], client_signup: ["👤", "New client account", "clients"],
    meeting_request: ["🗓️", "1-on-1 request", "members"], membership_request: ["💳", "Membership request", "members"]
  };
  let notes = [];
  const SEEN_KEY = "mdfit_admin_seen";
  const seenAt = () => { try { return localStorage.getItem(SEEN_KEY) || ""; } catch { return ""; } };
  const ago = (t) => { const m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(t); };
  function renderNotes() {
    const seen = seenAt(), list = groupNotes(notes.filter((n) => NOTE[n.type] || /^cal_booking/.test(n.type))).slice(0, 40);
    const unread = list.filter((n) => n.time > seen).length;
    $("#bell-count").hidden = !unread; $("#bell-count").textContent = unread > 99 ? "99+" : unread;
    $("#notif-list").innerHTML = list.map((n, i) => {
      const [ic, base] = NOTE[n.type] || ["📅", "Cal.com booking"];
      const label = n.type === "intake" ? (n.total && n.completed >= n.total ? "Intake documents completed" : n.total ? `Intake documents: ${n.completed} of ${n.total} done` : base) : base;
      return `<li><button type="button" class="np-item${n.time > seen ? " unread" : ""}" data-note="${i}"><span class="np-ic" aria-hidden="true">${ic}</span>
        <span class="np-txt"><b>${esc(label)}</b>${n.email ? `<span>${esc(n.email)}</span>` : ""}<small>${esc(ago(n.time))}</small></span></button></li>`;
    }).join("") || `<li class="np-empty">Nothing new yet.</li>`;
    $("#notif-list").dataset.items = "";
    renderNotes.list = list;
  }
  // One line per thing that happened: the forms of one intake packet (saved one at a time) collapse into a single
  // "Intake documents" item, and the same event arriving twice (live + reload) shows once.
  function groupNotes(list) {
    const out = [], seenKeys = new Set();
    for (const n of list) {
      const key = n.type === "intake" ? `intake|${n.appointmentId || n.email || ""}|${String(n.time).slice(0, 10)}`
        : `${n.type}|${n.email || ""}|${n.id || n.appointmentId || ""}|${String(n.time).slice(0, 16)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key); out.push(n);
    }
    return out;
  }
  // Open the documents an intake notification is about: the visit's card in Appointments, or the client's profile
  async function openIntake(n) {
    if (n.appointmentId) {
      openTab("appts", { load: false });
      await loadAppts();
      let card = $(`#appts-list .appt[data-id="${CSS.escape(n.appointmentId)}"]`);
      if (!card && !$("#appts-all").checked) { $("#appts-all").checked = true; await loadAppts(); card = $(`#appts-list .appt[data-id="${CSS.escape(n.appointmentId)}"]`); }
      const btn = card && $("[data-intake]", card);
      if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
      if (btn) btn.click();
      if (card) return;
    }
    const who = n.email && clientList.find((c) => c.email === n.email);
    if (who) { await goClient(who.id); const b = $("[data-cdocs]"); if (b) { b.click(); b.scrollIntoView({ block: "center" }); } return; }
    openTab("appts");
  }
  async function loadNotes() { try { notes = await api("GET", "/api/admin/activity"); renderNotes(); } catch {} }
  function toggleNotes(open) {
    const p = $("#notif-panel"); open = open === undefined ? p.hidden : open;
    p.hidden = !open; $("#bell").setAttribute("aria-expanded", String(open));
    if (open) renderNotes();
  }
  $("#bell").addEventListener("click", (e) => { e.stopPropagation(); toggleNotes(); });
  $("#notif-read").addEventListener("click", () => { try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch {} renderNotes(); });
  document.addEventListener("click", (e) => { if (!$("#notif-panel").hidden && !e.target.closest("#notif-panel")) toggleNotes(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#notif-panel").hidden) toggleNotes(false); });
  $("#notif-list").addEventListener("click", run(async (e) => {
    const b = e.target.closest("[data-note]"); if (!b) return;
    const n = renderNotes.list[Number(b.dataset.note)]; toggleNotes(false);
    try { if (n.time > seenAt()) localStorage.setItem(SEEN_KEY, n.time); } catch {}
    const target = (NOTE[n.type] || [, , "dash"])[2];
    const who = n.email && clientList.find((c) => c.email === n.email);
    if (n.type === "intake") return openIntake(n);
    if (target === "messages" && who) return goThread(who.id);
    if (target === "clients" && who) return goClient(who.id);
    openTab(target);
  }));
  function rtToast(text, icon) {
    const box = $("#rt-toasts"); if (!box) return;
    const el = document.createElement("div"); el.className = "rt-toast";
    el.innerHTML = `<span class="rt-icon">${icon || "🔔"}</span><span>${esc(text)}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 300); }, 5000);
    if (hasNotify && Notification.permission === "granted") { try { new Notification("MD Fit", { body: text, icon: "/assets/icon-64.png" }); } catch {} }
  }
  const TOAST_ICONS = { appointment: "📅", appointment_cancelled: "❌", lead: "🎯", booking: "🏋️", message: "💬", subscribe: "📧", bug_report: "🐛", suggestion: "💡", feedback: "⭐" };

  // iPhone Safari (outside an installed app) has no Notification API; touching it would throw and stop live updates.
  const hasNotify = typeof window.Notification !== "undefined";
  let rtWired = false; // live-update handlers are registered once; logging in again only reconnects
  function show() {
    $("#login").hidden = true; $("#app").hidden = false; openTab(fromHash()); idleBump();
    pollBadges(); // unread messages / open feedback counts right away, not a minute after logging in
    loadNotes(); if (!clientList.length) api("GET", "/api/admin/clients").then((l) => { clientList = l; }).catch(() => {});
    if (hasNotify && Notification.permission === "default") { try { Promise.resolve(Notification.requestPermission()).catch(() => {}); } catch {} }
    if (window.MDFitRT) {
      MDFitRT.connect({ namespace: "/admin", token });
      if (rtWired) return;
      rtWired = true;
      MDFitRT.on("activity", (ev) => {
        notes.unshift({ time: new Date().toISOString(), ...ev }); renderNotes();
        if (current === "dash") run(loadDash)();
        if (ev.type === "appointment" || ev.type === "appointment_cancelled" || ev.type === "intake") { if (current === "appts") run(loadAppts)(); }
        if (ev.type === "booking" || ev.type === "booking_cancelled") { if (current === "bookings") run(loadBookings)(); }
        if (ev.type === "lead") { if (current === "leads") run(loadLeads)(); }
        if (ev.type === "subscribe") { if (current === "subs") run(loadSubs)(); }
        if (ev.type === "feedback" || ev.type === "bug_report" || ev.type === "suggestion") { if (current === "feedback") run(loadFeedback)(); pollBadges(); }
      });
      MDFitRT.on("new_message", () => {
        if (current === "dash") run(() => (homeThread ? openHomeThread(homeThread) : loadHomeInbox()))();
        if (current === "messages") run(loadThreads)();
        else pollBadges();
      });
      MDFitRT.on("message_reaction", (ev) => { if (openThread && ev.clientId === openThread) showThread(openThread); });
      MDFitRT.on("toast", (ev) => { rtToast(ev.text, TOAST_ICONS[ev.type]); });
      // Google Calendar / SimplePractice changed (the server checks every minute): refresh what's on screen
      MDFitRT.on("calendar_changed", (ev) => {
        const n = (ev && ev.dates && ev.dates.length) || 0;
        rtToast(`Your calendar changed${n ? ` (${n} day${n === 1 ? "" : "s"})` : ""}. Booking times updated.`);
        if (current === "appts") run(loadAppts)();
        if (current === "dash") run(loadCalendar)();
        if (current === "hours") loadSync();
      });
      MDFitRT.on("online_count", (ev) => {
        const bar = $("#online-bar"); if (!bar) return;
        bar.classList.add("live");
        $("#online-text").textContent = `${ev.members} member${ev.members !== 1 ? "s" : ""} and ${ev.pages} visitor${ev.pages !== 1 ? "s" : ""} online now`;
      });
      document.addEventListener("mdfit:connected", () => { const bar = $("#online-bar"); if (bar) bar.classList.add("live"); });
      document.addEventListener("mdfit:disconnected", () => { const bar = $("#online-bar"); if (bar) { bar.classList.remove("live"); $("#online-text").textContent = "Reconnecting…"; } });
    }
  }

  const table = (el, head, rows, empty) => {
    el.innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
      rows.length ? rows.join("") : `<tr><td class="empty" colspan="${head.length}">${empty}</td></tr>`}</tbody>`;
  };

  // ---- Dashboard
  async function loadDash() {
    const [s, me, st] = await Promise.all([api("GET", "/api/admin/stats"), api("GET", "/api/admin/me"), api("GET", "/api/admin/settings").catch(() => null)]);
    // Telehealth types are offered but no video room link is saved: patients would get no way to join
    $("#video-banner").hidden = !st || !!(st.booking && st.booking.telehealthUrl) || !(st.appointmentTypes || []).some((t) => t.remote);
    $("#email-banner").hidden = me.emailNotifications;
    $(".stats").innerHTML = [
      [s.appointmentsToday, "Appointments today"], [s.appointmentsWeek, "Appointments next 7 days"], [s.leadsNew, "New requests"],
      [s.leads30d, "Requests last 30 days"], [s.bookingsThisWeek, "Class spots booked"], [s.subscribers, "Subscribers"]
    ].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join("");
    const apptRow = (a, withDate) => `<tr><td>${withDate ? fmtDate(a.date) + " · " : ""}${fmtTime(a.time)}</td><td>${esc(a.typeName)} · ${a.minutes}m</td>
      <td>${esc(a.name)}</td><td><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></td>
      <td>${esc([(a.areas || []).join(", "), a.painLevel != null ? `pain ${a.painLevel}/10` : "", a.notes].filter(Boolean).join(" · "))}</td></tr>`;
    table($("#today"), ["Time", "Type", "Client", "Phone", "Notes"], s.today.map((a) => apptRow(a, false)), "Nothing booked today.");
    table($("#next-appts"), ["When", "Type", "Client", "Phone", "Notes"], s.nextAppointments.map((a) => apptRow(a, true)), "No upcoming appointments.");
    table($("#upcoming"), ["When", "Class", "Booked"], s.upcoming.map((x) =>
      `<tr><td>${fmtDate(x.date)} · ${fmtTime(x.time)}</td><td>${esc(x.title)}</td><td>${x.capacity - x.spotsLeft} / ${x.capacity}</td></tr>`),
      "No classes in the next 7 days. Add some under Classes.");
    await Promise.all([loadCalendar(), homeThread ? openHomeThread(homeThread) : loadHomeInbox()]);
  }

  // ---- Home inbox: message threads beside the calendar; a tap opens the conversation right here, with a reply box
  let homeThread = null;
  async function loadHomeInbox() {
    homeThread = null;
    const d = await api("GET", "/api/admin/messages");
    const hc = $("#home-inbox-count"); hc.hidden = !d.unread; hc.textContent = d.unread;
    const list = d.threads.slice().sort((x, y) => (y.unread > 0) - (x.unread > 0)).slice(0, 8);
    $("#home-inbox").innerHTML = list.length ? `<ul class="hi-list">${list.map((t) => `<li><button type="button" class="hi-row${t.unread ? " unread" : ""}" data-hthread="${esc(t.clientId)}">
        <span class="hi-name"><b>${esc(t.name)}</b>${t.unread ? `<span class="pill pending">${t.unread}</span>` : ""}</span>
        <span class="hi-last">${t.last ? `${t.last.from === "doctor" ? "You: " : ""}${esc(t.last.body)}` : ""}</span>
        <small class="muted">${t.last ? esc(when(t.last.at)) : ""}</small></button></li>`).join("")}</ul>` : `<p class="muted">No messages yet. Members can message you from the app.</p>`;
  }
  async function openHomeThread(cid) {
    homeThread = cid;
    const d = await api("GET", `/api/admin/messages/${cid}`);
    const first = esc(d.client.name.split(" ")[0]);
    $("#home-inbox").innerHTML = `<div class="hi-thread">
        <div class="hi-top"><button type="button" class="mini" data-hback>‹ Inbox</button><b>${esc(d.client.name)}</b>
          <span class="hi-actions"><button type="button" class="link" data-hclient="${esc(cid)}">Profile</button></span></div>
        <div class="msg-log hi-log">${d.messages.map((m) => `<div class="mb ${m.from}"><p>${esc(m.body).replace(/\n/g, "<br>")}</p><small>${m.from === "doctor" ? "You" : first} · ${when(m.at)}</small></div>`).join("") || `<p class="muted">No messages yet.</p>`}</div>
        <form class="msg-reply hi-reply"><textarea name="body" rows="2" maxlength="2000" placeholder="Reply to ${first}…"></textarea><button class="btn btn-sm" type="submit">Send</button></form>
      </div>`;
    const log = $(".hi-log"); log.scrollTop = log.scrollHeight;
    const ta = $(".hi-reply textarea"); ta.value = drafts.get(cid) || ""; ta.addEventListener("input", () => drafts.set(cid, ta.value));
    pollBadges(); // opening a thread marks it read
  }
  $("#home-inbox").addEventListener("click", run(async (e) => {
    const t = e.target.closest("[data-hthread]"), back = e.target.closest("[data-hback]"), prof = e.target.closest("[data-hclient]");
    if (t) await openHomeThread(t.dataset.hthread);
    else if (back) await loadHomeInbox();
    else if (prof) await goClient(prof.dataset.hclient);
  }));
  $("#home-inbox").addEventListener("submit", run(async (e) => {
    e.preventDefault();
    const f = e.target, body = f.body.value.trim(), btn = $("button[type=submit]", f); if (!body || btn.disabled || !homeThread) return;
    btn.disabled = true; // one tap = one message (and one email)
    try { await api("POST", `/api/admin/messages/${homeThread}`, { body }); } finally { btn.disabled = false; }
    drafts.delete(homeThread);
    toast("Sent. They'll get an email that you replied."); await openHomeThread(homeThread);
  }));
  $("#video-banner-go").addEventListener("click", () => { openTab("hours"); setTimeout(() => { const f = $('#cal-form [name="telehealthUrl"]'); if (f) { f.scrollIntoView({ block: "center" }); f.focus(); } }, 400); });
  $("#home-inbox-card").addEventListener("click", (e) => { const l = e.target.closest("[data-tab-link]"); if (l) openTab(l.dataset.tabLink); });
  // Phones/tablets: Calendar and Inbox share Home, one at a time
  $$("[data-homeview]").forEach((b) => b.addEventListener("click", () => {
    $(".home-grid").dataset.show = b.dataset.homeview; $('[data-panel="dash"]').dataset.show = b.dataset.homeview;
    $$("[data-homeview]").forEach((x) => x.setAttribute("aria-checked", x === b));
  }));

  // ---- Calendar (Home): appointments and classes on a week or day grid, 7 AM to 7 PM (stretches for earlier/later
  // visits). Tap a visit for the details, the client's profile and the video link.
  const tzDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const addD = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const mondayOf = (d) => addD(d, -((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7));
  let calView = matchMedia("(max-width: 700px)").matches ? "day" : "week", calDay = tzDay(), calAppts = [], calClasses = [];
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  // Classes come from the public schedule (14 days ahead; the dashboard's "upcoming" list stops at 10 sessions)
  async function loadCalendar() {
    const [ap, sc] = await Promise.all([api("GET", "/api/admin/appointments?all=1"), api("GET", "/api/schedule?days=14").catch(() => ({ sessions: [] }))]);
    calAppts = ap.filter((a) => a.status !== "cancelled"); calClasses = sc.sessions || []; renderCalendar();
  }
  function renderCalendar() {
    const days = calView === "week" ? Array.from({ length: 7 }, (_, i) => addD(mondayOf(calDay), i)) : [calDay];
    const evs = [...calAppts.map((a) => ({ kind: "appt", a, date: a.date, start: toMin(a.time), end: toMin(a.time) + (a.minutes || 60) })),
      ...calClasses.map((x) => ({ kind: "class", x, date: x.date, start: toMin(x.time), end: toMin(x.time) + (x.durationMin || 60) }))].filter((e) => days.includes(e.date));
    const lo = Math.min(7 * 60, ...evs.map((e) => Math.floor(e.start / 60) * 60)), hi = Math.max(19 * 60, ...evs.map((e) => Math.ceil(e.end / 60) * 60));
    const PX = 52 / 60, today = tzDay();
    $("#cal-label").textContent = calView === "week" ? `${fmtDate(days[0], { month: "short", day: "numeric" })} – ${fmtDate(days[6], { month: "short", day: "numeric", year: "numeric" })}` : fmtDate(calDay, { weekday: "long", month: "long", day: "numeric" });
    $$("[data-calview]").forEach((b) => b.setAttribute("aria-checked", b.dataset.calview === calView));
    const hours = []; for (let m = lo; m < hi; m += 60) hours.push(m);
    const evHtml = (e, i) => {
      const top = (e.start - lo) * PX, h = Math.max(22, (e.end - e.start) * PX - 2);
      if (e.kind === "class") return `<div class="cal-ev class" style="top:${top}px;height:${h}px"><b>${esc(e.x.title)}</b><span>${fmtTime(e.x.time)} · ${e.x.capacity - e.x.spotsLeft}/${e.x.capacity}</span></div>`;
      const a = e.a, cls = a.status === "completed" ? "completed" : a.status === "no-show" ? "noshow" : isVideo(a) ? "video" : "booked";
      return `<button type="button" class="cal-ev ${cls}" style="top:${top}px;height:${h}px" data-ev="${esc(a.id)}"><b>${esc(a.name)}</b><span>${fmtTime(a.time)} · ${esc(a.typeName)}</span></button>`;
    };
    $("#cal-grid").innerHTML = `<div class="cg ${calView}" style="--cols:${days.length}">
      <div class="cg-corner"></div>${days.map((d) => `<div class="cg-day${d === today ? " today" : ""}">${fmtDate(d, { weekday: "short" })} <b>${Number(d.slice(8))}</b></div>`).join("")}
      <div class="cg-hours" style="height:${(hi - lo) * PX}px">${hours.map((m) => `<span style="top:${(m - lo) * PX}px">${fmtTime(String(m / 60).padStart(2, "0") + ":00").replace(":00", "")}</span>`).join("")}</div>
      ${days.map((d) => `<div class="cg-col${d === today ? " today" : ""}" style="height:${(hi - lo) * PX}px">${hours.map((m) => `<i style="top:${(m - lo) * PX}px"></i>`).join("")}${
        d === today ? (() => { const n = new Date().toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }); const nm = toMin(n); return nm >= lo && nm <= hi ? `<em class="cg-now" style="top:${(nm - lo) * PX}px"></em>` : ""; })() : ""}${
        evs.filter((e) => e.date === d).map(evHtml).join("")}</div>`).join("")}</div>
      ${evs.length ? "" : `<p class="muted cal-empty">Nothing scheduled ${calView === "week" ? "this week" : "this day"}.</p>`}`;
  }
  $("#cal-prev").addEventListener("click", () => { calDay = addD(calDay, calView === "week" ? -7 : -1); renderCalendar(); });
  $("#cal-next").addEventListener("click", () => { calDay = addD(calDay, calView === "week" ? 7 : 1); renderCalendar(); });
  $("#cal-today").addEventListener("click", () => { calDay = tzDay(); renderCalendar(); });
  $$("[data-calview]").forEach((b) => b.addEventListener("click", () => { calView = b.dataset.calview; renderCalendar(); }));
  $("#cal-grid").addEventListener("click", run(async (e) => {
    const b = e.target.closest("[data-ev]"); if (!b) return;
    const a = calAppts.find((x) => x.id === b.dataset.ev); if (!a) return;
    if (!clientList.length) clientList = await api("GET", "/api/admin/clients");
    const who = clientList.find((c) => c.email === a.email);
    $("#cal-pop-body").innerHTML = `<h3>${esc(a.name)}</h3>
      <p class="meta">${fmtDate(a.date, { weekday: "long", month: "long", day: "numeric" })} · ${fmtTime(a.time)} · ${a.minutes} min</p>
      <p>${esc(a.typeName)} <span class="badge ${a.status}">${a.status}</span>${isVideo(a) ? ` <span class="badge remote">Video</span>` : ""}${who ? ` ${typeBadge(who.clientType)}` : ""}</p>
      <p><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>
      ${a.documents && a.documents.total ? `<p>${docsChip(a.documents)}</p>` : ""}
      <div class="actions">${a.meetingLink ? `<a class="btn btn-sm" href="${esc(a.meetingLink)}" target="_blank" rel="noopener">Join video</a>` : ""}
        ${who ? `<button type="button" class="btn btn-sm btn-line" data-pop-client="${esc(who.id)}">Open client</button><button type="button" class="btn btn-sm btn-line" data-pop-msg="${esc(who.id)}">Message</button>` : ""}
        <button type="button" class="btn btn-sm btn-line" data-pop-appts>All appointments</button></div>
      <div class="actions pop-status" data-pop-id="${esc(a.id)}">${a.status === "completed" ? "" : `<button type="button" class="btn btn-sm btn-line" data-pop-status="completed">Mark completed</button>`}${
        a.status === "no-show" ? "" : `<button type="button" class="btn btn-sm btn-line" data-pop-status="no-show">No-show</button>`}${a.status === "booked" ? "" : `<button type="button" class="btn btn-sm btn-line" data-pop-status="booked">Back to booked</button>`}</div>
      ${isVideo(a) ? `<label class="meet-row">Video link <input type="url" inputmode="url" data-pop-meet value="${esc(a.meetingLink || "")}" placeholder="https://zoom.us/j/…"></label>
        <div class="actions"><button type="button" class="btn btn-sm" data-pop-meet-save>Save video link</button></div><p class="fine muted">A new link is emailed to the patient.</p>` : ""}`;
    $("#cal-pop").showModal();
  }));
  $("#cal-pop").addEventListener("click", run(async (e) => {
    // Status and video link: saved straight away, then the calendar redraws
    const st = e.target.closest("[data-pop-status]"), ms = e.target.closest("[data-pop-meet-save]");
    if (st || ms) {
      const id = $("[data-pop-id]", $("#cal-pop")).dataset.popId, btn = st || ms;
      btn.disabled = true;
      try {
        const body = st ? { status: st.dataset.popStatus } : { meetingLink: $("[data-pop-meet]", $("#cal-pop")).value.trim() };
        const r = await api("PATCH", `/api/admin/appointments/${id}`, body);
        calAppts = calAppts.map((x) => (x.id === id ? { ...x, ...r } : x)); renderCalendar(); $("#cal-pop").close();
        toast(st ? `Marked ${r.status}.` : "Video link saved.");
      } finally { btn.disabled = false; }
      return;
    }
    const c = e.target.closest("[data-pop-client]"), m = e.target.closest("[data-pop-msg]"), l = e.target.closest("[data-pop-appts]");
    if (c || m || l) $("#cal-pop").close();
    if (c) await goClient(c.dataset.popClient); else if (m) await goThread(m.dataset.popMsg); else if (l) openTab("appts");
  }));

  // ---- Share link (the public site is where this admin page is served from)
  const bookUrl = location.origin + "/book";
  $("#book-link").value = bookUrl;
  $("#call-link").textContent = bookUrl + "?type=call";
  $("#copy-link").addEventListener("click", run(async () => {
    try { await navigator.clipboard.writeText(bookUrl); } catch { $("#book-link").select(); document.execCommand("copy"); }
    toast("Booking link copied.");
  }));

  // ---- Appointments
  const VIDEO_TYPES = ["eval-remote", "followup-remote", "session-remote"];
  const isVideo = (a) => VIDEO_TYPES.includes(a.typeId) || !!a.meetingLink;
  async function loadAppts() {
    const list = await api("GET", "/api/admin/appointments" + ($("#appts-all").checked ? "?all=1" : ""));
    $("#appts-list").innerHTML = list.length ? list.map((a) => `
      <article class="lead appt ${a.status}" data-id="${a.id}">
        <header>
          <div><h3>${fmtDate(a.date)} · ${fmtTime(a.time)} <span class="badge ${a.status}">${a.status}</span>${isVideo(a) ? ` <span class="badge remote">Video</span>` : ""}${a.source === "cal" ? ` <span class="badge cal">Cal.com</span>` : ""}</h3>
            <div class="meta">${esc(a.typeName)} · ${a.minutes} min</div></div>
          <div class="meta">Booked ${when(a.createdAt)}</div>
        </header>
        <div><strong>${esc(a.name)}</strong> · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></div>
        <div class="intake">${[...(a.areas || []), a.painLevel != null && `Pain ${a.painLevel}/10`].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        ${a.notes ? `<p class="msg">${esc(a.notes)}</p>` : ""}
        ${a.documents && a.documents.total ? `<p><span class="badge docs${a.documents.complete ? " done" : ""}">${a.documents.complete ? "Documents complete ✓" : `Documents ${a.documents.done} of ${a.documents.total}`}</span>${
          a.documents.done ? ` <button class="mini" data-intake>View documents</button>` : ""}</p><div class="intake-view" hidden></div>` : ""}
        ${isVideo(a) ? `<label class="meet-row">Video link <input type="url" inputmode="url" data-meet value="${esc(a.meetingLink || "")}" placeholder="https://zoom.us/j/… (saving a new link emails it to the patient)">${a.meetingLink ? ` <a class="mini" href="${esc(a.meetingLink)}" target="_blank" rel="noopener">Join</a>` : ""}</label>` : ""}
        <textarea rows="2" placeholder="Session notes (private)" data-notes>${esc(a.adminNotes)}</textarea>
        <div class="actions">
          <select data-status>${APPT_STATUSES.map((x) => `<option ${x === a.status ? "selected" : ""}>${x}</option>`).join("")}</select>
          <button class="mini" data-save>Save</button>
        </div>
      </article>`).join("") : `<p class="muted">No upcoming appointments.</p>`;
  }
  $("#appts-all").addEventListener("change", run(loadAppts));
  // Intake documents viewer (appointment cards and client profiles): one section per completed document;
  // answers arrive as strings, numbers, booleans or arrays. "On file" marks forms filled from the member dashboard.
  function showDocs(box, d) {
    const val = (v) => Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "—" : String(v);
    box.innerHTML = (d.docs || []).map((doc) => `<section><h4>${esc(doc.title)}</h4><p class="meta">Completed ${when(doc.createdAt)}${doc.onFile ? " · on file from the client's dashboard" : ""}</p>${
      (doc.fields || []).map((f) => `<div><b>${esc(f.label)}</b><span>${esc(val(f.value))}</span></div>`).join("")}</section>`).join("")
      || `<p class="meta">No documents received yet.</p>`;
    box.hidden = false;
  }
  const docsChip = (st) => st && st.total ? `<span class="badge docs${st.complete ? " done" : ""}">${st.complete ? "Documents complete ✓" : `Documents ${st.done} of ${st.total}`}</span>` : "";

  $("#appts-list").addEventListener("click", run(async (e) => {
    const card = e.target.closest(".appt");
    if (card && e.target.matches("[data-intake]")) {
      const box = $(".intake-view", card);
      if (!box.hidden) { box.hidden = true; return; }
      showDocs(box, await api("GET", `/api/admin/appointments/${card.dataset.id}/intake`));
      return;
    }
    if (!card || !e.target.matches("[data-save]")) return;
    const status = $("[data-status]", card).value;
    if (status === "cancelled" && !confirm("Cancel this appointment? The time opens up for booking again.")) return;
    const meet = $("[data-meet]", card);
    await api("PATCH", `/api/admin/appointments/${card.dataset.id}`, { status, adminNotes: $("[data-notes]", card).value, ...(meet ? { meetingLink: meet.value.trim() } : {}) });
    toast("Appointment saved."); loadAppts();
  }));

  // ---- Booking system (built-in or Cal.com)
  const cf = $("#cal-form");
  $("#cal-hook").textContent = API + "/api/cal/webhook";
  const calFields = () => ($(".cal-fields", cf).hidden = cf.provider.value !== "cal");
  cf.addEventListener("change", calFields);
  async function loadCalStatus() {
    const box = $("#cal-status");
    box.className = "cal-status"; box.innerHTML = `<span class="muted">Checking Cal.com…</span>`;
    const st = await api("GET", "/api/admin/cal/status");
    if (st.connected) {
      box.className = "cal-status ok";
      box.innerHTML = `<b>Connected</b> as <code>${esc(st.username)}</code>${st.timeZone ? ` · ${esc(st.timeZone)}` : ""}${st.webhookSecretSet ? " · webhook secret set" : " · <b>webhook secret not set</b> (bookings arrive on sync only)"}
        <ul>${st.eventTypes.map((t) => `<li><code>${esc(t.slug)}</code> ${esc(t.title)}${t.minutes ? ` (${t.minutes} min)` : ""}</li>`).join("") || "<li>No visible event types. Create one in Cal.com.</li>"}</ul>`;
    } else {
      box.className = "cal-status bad";
      box.innerHTML = `<b>Not connected.</b> ${esc(st.message || "")}`;
    }
  }
  $("#cal-test").addEventListener("click", run(loadCalStatus));
  $("#cal-sync").addEventListener("click", run(async () => {
    const r = await api("POST", "/api/admin/cal/sync");
    toast(`Synced ${r.synced} upcoming Cal.com booking${r.synced === 1 ? "" : "s"}.`);
  }));
  cf.addEventListener("submit", run(async (e) => {
    e.preventDefault();
    const msg = $(".form-msg", cf);
    msg.className = "form-msg"; msg.textContent = "";
    try {
      await api("PUT", "/api/admin/settings", { booking: {
        provider: cf.provider.value, calUsername: cf.calUsername.value, telehealthUrl: cf.telehealthUrl.value.trim(),
        calEventSlugs: cf.calEventSlugs.value.split(",").map((x) => x.trim()).filter(Boolean)
      } });
      msg.className = "form-msg ok";
      msg.textContent = cf.provider.value === "cal" ? "Saved. The website now books through Cal.com." : "Saved. The website uses the built-in scheduler.";
      if (cf.provider.value === "cal") loadCalStatus().catch(() => {});
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  }));

  // ---- Booking hours
  const hf = $("#hours-form");
  $("#hours-days").innerHTML = DAYS.map((d, i) => `<label class="day-hours">${d}<input data-day="${i}" placeholder="Closed"></label>`).join("");
  // ---- Calendar sync (Google Calendar + SimplePractice)
  const syncF = $("#sync-form");
  const showSync = (st) => {
    const g = st.google === "configured", sp = st.simplepractice === "configured";
    $("#sync-status").innerHTML = `<p><b>Google Calendar:</b> ${g ? `connected (${esc(st.calendarId || "")})` : "not connected. Add GOOGLE_SERVICE_ACCOUNT and GOOGLE_CALENDAR_ID in Railway"}${st.serviceAccountEmail ? `<br><span class="muted small">Share your calendar with <code>${esc(st.serviceAccountEmail)}</code> ("Make changes to events")</span>` : ""}</p>
      <p><b>SimplePractice:</b> ${sp ? `connected ${st.simplePracticeUrl ? `<span class="muted small">${esc(st.simplePracticeUrl)}</span>` : ""}` : "not connected. Paste your calendar link below"}</p>
      ${st.live && st.live.everySec && (g || sp) ? `<p class="muted small">Live: checks every ${st.live.everySec >= 60 ? `${Math.round(st.live.everySec / 60)} min` : `${st.live.everySec} sec`} and updates open booking pages instantly${st.live.lastCheck ? ` · last check ${when(st.live.lastCheck)}` : ""}${st.live.lastChange ? ` · last change ${when(st.live.lastChange)}` : ""}</p>` : ""}
      ${st.lastSync ? `<p class="muted small">Last sync ${when(st.lastSync)}</p>` : ""}${st.lastError ? `<p class="form-msg err">${esc(st.lastError)}</p>` : ""}${st.busyNext14Days !== undefined ? `<p class="muted small">Busy blocks in the next 14 days: ${st.busyNext14Days} ${Object.entries(st.bySource || {}).map(([k, v]) => `(${k}: ${v})`).join(" ")}</p>` : ""}`;
  };
  const loadSync = () => api("GET", "/api/admin/calsync").then(showSync).catch(() => {});
  syncF.addEventListener("submit", run(async (e) => {
    e.preventDefault(); const msg = $(".form-msg", syncF);
    try { await api("PUT", "/api/admin/calsync", { icsUrl: syncF.icsUrl.value.trim() }); syncF.icsUrl.value = ""; msg.className = "form-msg ok"; msg.textContent = "Saved."; loadSync(); }
    catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  }));
  $("#sync-test").addEventListener("click", run(async () => showSync(await api("POST", "/api/admin/calsync/test"))));

  async function loadHours() {
    loadSync();
    const s = await api("GET", "/api/admin/settings");
    cf.provider.value = s.booking.provider;
    cf.calUsername.value = s.booking.calUsername;
    cf.telehealthUrl.value = s.booking.telehealthUrl || "";
    cf.calEventSlugs.value = s.booking.calEventSlugs.join(", ");
    calFields();
    if (s.booking.provider === "cal") loadCalStatus().catch(() => {});
    const sch = s.scheduling;
    $$("[data-day]", hf).forEach((el) => (el.value = (sch.hours[el.dataset.day] || []).map((w) => w.join("-")).join(", ")));
    hf.slotStepMin.value = String(sch.slotStepMin);
    hf.minNoticeHours.value = sch.minNoticeHours;
    hf.daysAhead.value = sch.daysAhead;
    hf.blockedDates.value = sch.blockedDates.join("\n");
    hf.appointmentTypes.value = s.appointmentTypes.map((t) => [t.id, t.name, t.minutes, t.description].join(" | ")).join("\n");
    origApptTypes = s.appointmentTypes;
  }
  let origApptTypes = []; // keeps fields the text box doesn't show (e.g. remote = telehealth) when saving
  hf.addEventListener("submit", run(async (e) => {
    e.preventDefault();
    const msg = $(".form-msg", hf);
    msg.className = "form-msg"; msg.textContent = "";
    try {
      const hours = $$("[data-day]", hf).map((el) => el.value.split(",").map((x) => x.trim()).filter(Boolean).map((w) => {
        const m = w.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
        if (!m) throw new Error(`${DAYS[el.dataset.day]}: write hours like 09:00-17:00`);
        return [m[1].padStart(5, "0"), m[2].padStart(5, "0")];
      }));
      const appointmentTypes = hf.appointmentTypes.value.split("\n").map((x) => x.trim()).filter(Boolean).map((line) => {
        const [id = "", name = "", minutes = "", description = ""] = line.split("|").map((x) => x.trim());
        return { ...(origApptTypes.find((t) => t.id === id) || {}), id, name, minutes: Number(minutes), description };
      });
      await api("PUT", "/api/admin/settings", {
        scheduling: {
          hours, slotStepMin: Number(hf.slotStepMin.value), minNoticeHours: Number(hf.minNoticeHours.value), daysAhead: Number(hf.daysAhead.value),
          blockedDates: hf.blockedDates.value.split(/[\s,]+/).filter(Boolean)
        },
        appointmentTypes
      });
      msg.className = "form-msg ok"; msg.textContent = "Saved. Online booking uses the new hours right away.";
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  }));

  // ---- Clients (accounts created at /login)
  const GUIDES = { "posterior-neck": "Posterior Neck Power Grid", "scalenes": "Scalenes & Intercostals", "rotator-cuff": "Rotator Cuff",
    "iliopsoas": "Iliopsoas Complex", "lateral-hip": "Lateral Hip Powerhouse", "quads": "Tight Quads", "calf": "Calf Complex" };
  let clientList = [];
  async function loadClients() {
    $("#client-detail").hidden = true; $("#clients-list").hidden = false;
    clientList = await api("GET", "/api/admin/clients");
    renderClients();
  }
  // Totals across the top: tap one to show only those clients (tap again, or "All clients", to show everyone)
  let clientPeriod = "all";
  const clinicDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  function clientsIn(period) {
    const today = clinicDay(new Date().toISOString());
    const daysAgo = (n) => clinicDay(new Date(Date.now() - n * 864e5).toISOString());
    const from = { today, week: daysAgo(6), month: today.slice(0, 8) + "01" }[period];
    if (period === "plan") return clientList.filter((c) => c.hasPlan);
    if (period === "inpatient") return clientList.filter((c) => c.clientType === "inpatient");
    return from ? clientList.filter((c) => c.createdAt && clinicDay(c.createdAt) >= from) : clientList;
  }
  function renderClientTotals() {
    const chips = [["all", "All clients"], ["today", "Joined today"], ["week", "Last 7 days"], ["month", "This month"], ["inpatient", "Inpatients"], ["plan", "Have a plan"]];
    $("#client-totals").innerHTML = chips.map(([k, label]) => `<button type="button" class="ct${k === clientPeriod ? " on" : ""}" data-period="${k}" aria-pressed="${k === clientPeriod}"><b>${clientsIn(k).length.toLocaleString()}</b><span>${label}</span></button>`).join("");
  }
  $("#client-totals").addEventListener("click", (e) => {
    const b = e.target.closest("[data-period]"); if (!b) return;
    clientPeriod = clientPeriod === b.dataset.period ? "all" : b.dataset.period;
    renderClients();
  });
  function renderClients() {
    renderClientTotals();
    const q = $("#client-search").value.trim().toLowerCase();
    const rows = clientsIn(clientPeriod).filter((c) => !q || [c.name, c.email, c.phone].join(" ").toLowerCase().includes(q));
    table($("#clients-table"), ["Client", "Type", "Phone", "Next visit", "Last pain log", "Plan", "Docs", "Joined"], rows.map((c) => `
      <tr data-id="${c.id}" class="click-row"><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.email)}</span></td><td><button type="button" class="badge ctype type-toggle ${c.clientType === "inpatient" ? "in" : "out"}" data-type-toggle="${c.id}" title="Click to switch to ${c.clientType === "inpatient" ? "outpatient" : "inpatient"}" aria-label="${esc(c.name)}: ${c.clientType === "inpatient" ? "Inpatient" : "Outpatient"}. Click to switch.">${c.clientType === "inpatient" ? "Inpatient" : "Outpatient"} <span aria-hidden="true">⇄</span></button></td><td>${esc(c.phone)}</td>
        <td>${c.next ? `${fmtDate(c.next.date)} · ${fmtTime(c.next.time)}` : "—"}</td>
        <td>${c.lastPain ? `${esc(c.lastPain.area)} ${c.lastPain.level}/10 · ${fmtDate(c.lastPain.date)}` : "—"}</td>
        <td>${c.hasPlan ? "✓" : "—"}</td><td>${c.documents && c.documents.complete ? "✓" : c.documents && c.documents.done ? `${c.documents.done}/${c.documents.total}` : "—"}</td><td>${when(c.createdAt)}</td></tr>`),
      clientList.length ? "No clients match." : "No client accounts yet. Clients sign up at /login.");
  }
  $("#client-search").addEventListener("input", renderClients);
  $("#clients-table").addEventListener("click", run(async (e) => {
    // The Type badge flips inpatient/outpatient in place (without opening the profile)
    const tg = e.target.closest("[data-type-toggle]");
    if (tg) {
      const c = clientList.find((x) => x.id === tg.dataset.typeToggle); if (!c) return;
      tg.disabled = true;
      const r = await api("PUT", `/api/admin/clients/${c.id}/type`, { type: c.clientType === "inpatient" ? "outpatient" : "inpatient" });
      c.clientType = r.clientType; renderClients();
      toast(`${c.name.split(" ")[0]} is now an ${r.clientType}.`);
      return;
    }
    const row = e.target.closest("tr[data-id]");
    if (row) openClient(row.dataset.id);
  }));

  // Client type: inpatients (in-clinic) never pay for video calls or consultations; everyone else is an outpatient
  const typeBadge = (t) => t === "inpatient" ? `<span class="badge ctype in">Inpatient</span>` : `<span class="badge ctype out">Outpatient</span>`;
  const careBox = (c, types, progs, roomUrl) => {
    const first = esc(c.name.split(" ")[0]), assigned = new Map((c.assignedPrograms || []).map((x) => [x.id, x]));
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return `<section class="client-care">
      <div class="ctype-row"><span class="label-sm">Client type</span>
        <div class="seg" role="radiogroup" aria-label="Client type">
          <button type="button" role="radio" data-ctype="outpatient" aria-checked="${c.clientType !== "inpatient"}">Outpatient</button>
          <button type="button" role="radio" data-ctype="inpatient" aria-checked="${c.clientType === "inpatient"}">Inpatient</button>
        </div>
        <span class="muted fine" id="ctype-note">${c.clientType === "inpatient" ? "Inpatient: never pays for video calls or consultations." : "Outpatient: standard booking and payment."}</span></div>
      <div class="care-actions">
        <details class="care"><summary>Send booking link</summary>
          <form class="form care-form" data-care="link" novalidate>
            <label>Appointment type<select name="typeId">${types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} · ${t.minutes} min</option>`).join("")}</select></label>
            <label>Message (optional)<textarea name="message" rows="2" maxlength="500" placeholder="Hi ${first}, here's a link to book your next visit."></textarea></label>
            <button class="btn btn-sm" type="submit">Email booking link</button><p class="form-msg" role="status"></p>
          </form></details>
        <details class="care"><summary>Schedule video consultation</summary>
          <form class="form care-form" data-care="consult" novalidate>
            <div class="grid3"><label>Date<input type="date" name="date" min="${today}" required></label>
              <label>Time<input type="time" name="time" step="900" required></label>
              <label>Length<select name="minutes"><option>15</option><option selected>30</option><option>45</option><option>60</option></select></label></div>
            <label>Video link<input type="url" name="meetingLink" inputmode="url" value="${esc(roomUrl || "")}" placeholder="https://zoom.us/j/…"></label>
            <label>Message (optional)<textarea name="message" rows="2" maxlength="500"></textarea></label>
            <button class="btn btn-sm" type="submit">Schedule and email the link</button><p class="form-msg" role="status"></p>
          </form></details>
        <details class="care"><summary>Programs for ${first} (${assigned.size})</summary>
          <form class="form care-form" data-care="programs" novalidate>
            <p class="muted fine">Checked programs show on ${first}'s Home under "From Dr. Jared".</p>
            <div class="prog-picks">${progs.map((p) => `<div class="prog-pick"><label class="check"><input type="checkbox" name="prog" value="${esc(p.id)}" ${assigned.has(p.id) ? "checked" : ""}> ${esc(p.title)}</label>
              <input type="text" name="note-${esc(p.id)}" maxlength="300" placeholder="Note for ${first} (optional)" value="${esc((assigned.get(p.id) || {}).note || "")}"></div>`).join("")}</div>
            <button class="btn btn-sm" type="submit">Save programs</button><p class="form-msg" role="status"></p>
          </form></details>
      </div></section>`;
  };

  // At-a-glance numbers for one client (all from the profile they already load; nothing extra is stored)
  function clientOverview(c) {
    const t = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }), ap = c.appointments || [];
    const n = (st) => ap.filter((a) => a.status === st).length;
    const next = ap.filter((a) => a.status === "booked" && a.date >= t).sort((x, y) => (x.date + x.time < y.date + y.time ? -1 : 1))[0];
    const pain = (c.painLog || []).slice(-6), last = pain[pain.length - 1], prev = pain[pain.length - 2];
    const trend = last && prev ? (last.level < prev.level ? "↓ improving" : last.level > prev.level ? "↑ worse" : "→ steady") : "";
    const spark = pain.length > 1 ? `<svg class="spark" viewBox="0 0 100 30" aria-hidden="true"><polyline points="${pain.map((p, i) => `${(i / (pain.length - 1)) * 100},${30 - p.level * 2.8}`).join(" ")}"/></svg>` : "";
    const m = c.membership, st = c.stats || {}, rw = c.rewards || {};
    const card = (k, v, sub = "") => `<div class="ov"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    return `<div class="client-ov">
      ${card("Next visit", next ? `${fmtDate(next.date)} · ${fmtTime(next.time)}` : "—", next ? esc(next.typeName) : "")}
      ${card("Visits done", n("completed"), `${n("no-show")} no-show · ${n("cancelled")} cancelled`)}
      ${card("Pain", last ? `${last.level}/10` : "—", last ? `${esc(last.area)} · ${esc(trend || fmtDate(last.date))}${spark}` : "No entries yet")}
      ${card("Membership", m ? esc(m.tier) : "None", m && m.until ? `paid through ${fmtDate(m.until)}` : "")}
      ${card("Activity", `${st.streak || 0}-day streak`, `${st.workouts || 0} workouts${rw.level ? ` · level ${rw.level}` : ""}`)}
      ${card("Last login", c.lastLoginAt ? when(c.lastLoginAt) : "Never", `joined ${when(c.createdAt)}`)}
    </div>`;
  }

  async function openClient(id) {
    const [c, st, ct] = await Promise.all([api("GET", `/api/admin/clients/${id}`), api("GET", "/api/admin/settings"), contentCache ? contentCache : api("GET", "/api/admin/content")]);
    contentCache = ct;
    const box = $("#client-detail");
    const p = c.plan;
    box.innerHTML = `
      <button type="button" class="mini" data-back>← All clients</button>
      <div class="client-head"><div><h2>${esc(c.name)}</h2>
        <p class="muted"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.phone ? ` · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""} · joined ${when(c.createdAt)}${c.lastLoginAt ? ` · last login ${when(c.lastLoginAt)}` : ""}</p></div>
        <div class="client-actions"><button type="button" class="mini" data-cmsg>Message</button><button type="button" class="mini" data-reset>Send reset code</button><button type="button" class="mini danger" data-delete>Delete account</button></div></div>
      ${clientOverview(c)}
      <p class="client-docs">${docsChip(c.documents)}${c.documents && c.documents.done ? ` <button type="button" class="mini" data-cdocs>View documents</button>` : c.documents ? ` <span class="muted">No intake documents on file yet.</span>` : ""}</p><div class="intake-view" id="client-docs" hidden></div>
      ${careBox(c, st.appointmentTypes || [], ct.programs || [], (st.booking || {}).telehealthUrl)}
      <div class="client-grid">
        <form class="form" id="plan-form" novalidate>
          <h2>Plan</h2>
          <label>Notes for ${esc(c.name.split(" ")[0])}<textarea name="notes" rows="4" maxlength="3000">${esc(p.notes)}</textarea></label>
          <label>Home exercises, one per line: <code>Name | sets, reps, cues</code><textarea name="exercises" rows="6">${esc(p.exercises.map((x) => x.detail ? `${x.name} | ${x.detail}` : x.name).join("\n"))}</textarea></label>
          <fieldset><legend>Guides to share</legend><div class="guide-picks">${Object.entries(GUIDES).map(([k, v]) =>
            `<label class="check"><input type="checkbox" name="guides" value="${k}" ${p.guides.includes(k) ? "checked" : ""}> ${esc(v)}</label>`).join("")}</div></fieldset>
          <button class="btn btn-sm" type="submit">Save plan</button>
          <p class="form-msg" role="status"></p>
        </form>
        <div>
          <h2>Appointments</h2>
          <div class="table-wrap"><table id="client-appts"></table></div>
          <h2>Pain log</h2>
          <div class="table-wrap"><table id="client-pain"></table></div>
        </div>
      </div>`;
    table($("#client-appts"), ["When", "Type", "Status"], c.appointments.map((a) => `<tr><td>${fmtDate(a.date)} · ${fmtTime(a.time)}</td><td>${esc(a.typeName)}</td><td><span class="badge ${a.status}">${a.status}</span></td></tr>`), "No appointments under this email yet.");
    table($("#client-pain"), ["Date", "Area", "Pain", "Note"], c.painLog.slice().reverse().slice(0, 50).map((e) => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.area)}</td><td>${e.level}/10</td><td>${esc(e.note)}</td></tr>`), "No entries yet.");
    $("#clients-list").hidden = true; box.hidden = false;

    $("[data-back]", box).addEventListener("click", run(loadClients));
    $("[data-cmsg]", box).addEventListener("click", run(() => goThread(id)));
    const cd = $("[data-cdocs]", box);
    if (cd) cd.addEventListener("click", run(async () => { const v = $("#client-docs"); if (!v.hidden) { v.hidden = true; return; } showDocs(v, await api("GET", `/api/admin/clients/${id}/intake`)); }));
    $("[data-reset]", box).addEventListener("click", run(async () => {
      const r = await api("POST", `/api/admin/clients/${id}/send-reset-code`);
      toast(r.message);
    }));
    $("[data-delete]", box).addEventListener("click", run(async () => {
      if (!confirm(`Delete ${c.name}'s account? Their appointments stay; their plan and pain log are removed.`)) return;
      await api("DELETE", `/api/admin/clients/${id}`); toast("Account deleted."); loadClients();
    }));
    // Client type, booking link, video consultation, programs
    $$("[data-ctype]", box).forEach((b) => b.addEventListener("click", run(async () => {
      const r = await api("PUT", `/api/admin/clients/${id}/type`, { type: b.dataset.ctype });
      $$("[data-ctype]", box).forEach((x) => x.setAttribute("aria-checked", x.dataset.ctype === r.clientType));
      $("#ctype-note").textContent = r.clientType === "inpatient" ? "Inpatient: never pays for video calls or consultations." : "Outpatient: standard booking and payment.";
      toast(`${c.name.split(" ")[0]} is now an ${r.clientType}.`);
    })));
    $$("form[data-care]", box).forEach((f) => f.addEventListener("submit", run(async (e) => {
      e.preventDefault();
      const msg = $(".form-msg", f), btn = $("button[type=submit]", f);
      msg.className = "form-msg"; msg.textContent = ""; btn.disabled = true;
      try {
        if (f.dataset.care === "link") {
          const r = await api("POST", `/api/admin/clients/${id}/send-booking-link`, { typeId: f.typeId.value, message: f.message.value });
          msg.textContent = r.message;
        } else if (f.dataset.care === "consult") {
          if (!f.date.value || !f.time.value) throw new Error("Pick a date and time.");
          const a = await api("POST", `/api/admin/clients/${id}/consult`, { date: f.date.value, time: f.time.value, minutes: Number(f.minutes.value), meetingLink: f.meetingLink.value.trim(), message: f.message.value });
          msg.textContent = `Scheduled ${fmtDate(a.date)} at ${fmtTime(a.time)}. ${c.name.split(" ")[0]} has been emailed the link.`;
          c.appointments.unshift(a);
          table($("#client-appts"), ["When", "Type", "Status"], c.appointments.map((x) => `<tr><td>${fmtDate(x.date)} · ${fmtTime(x.time)}</td><td>${esc(x.typeName)}</td><td><span class="badge ${x.status}">${x.status}</span></td></tr>`), "");
        } else {
          const programs = $$("[name=prog]:checked", f).map((x) => ({ id: x.value, note: f.elements[`note-${x.value}`].value }));
          const r = await api("PUT", `/api/admin/clients/${id}/programs`, { programs });
          $("summary", f.closest("details")).textContent = `Programs for ${c.name.split(" ")[0]} (${r.assignedPrograms.length})`;
          msg.textContent = "Saved. They're on the client's Home now.";
        }
        msg.className = "form-msg ok";
      } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
      btn.disabled = false;
    })));
    const pfm = $("#plan-form", box);
    pfm.addEventListener("submit", run(async (e) => {
      e.preventDefault();
      const msg = $(".form-msg", pfm);
      msg.className = "form-msg"; msg.textContent = "";
      try {
        await api("PUT", `/api/admin/clients/${id}/plan`, {
          notes: pfm.notes.value,
          exercises: pfm.exercises.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf("|"); return i < 0 ? { name: l, detail: "" } : { name: l.slice(0, i).trim(), detail: l.slice(i + 1).trim() }; }),
          guides: $$("[name=guides]:checked", pfm).map((x) => x.value)
        });
        msg.className = "form-msg ok"; msg.textContent = "Saved. It's on their dashboard now.";
      } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
    }));
  }

  // ---- Leads
  async function loadLeads() {
    const status = $("#lead-filter").value;
    const list = await api("GET", "/api/admin/leads" + (status ? "?status=" + status : ""));
    $("#leads-list").innerHTML = list.length ? list.map((l) => `
      <article class="lead" data-id="${l.id}">
        <header>
          <div><h3>${esc(l.name)} <span class="badge ${l.status}">${l.status}</span></h3>
            <div class="meta"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a>${l.phone ? ` · <a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : ""}</div></div>
          <div class="meta">${when(l.createdAt)}</div>
        </header>
        <div class="meta">${esc(l.service)} · ${esc(l.goal)}${l.preferredTime ? " · Best time: " + esc(l.preferredTime) : ""}${l.referral ? " · Heard via: " + esc(l.referral) : ""}</div>
        <div class="intake">${[...(l.areas || []), l.painLevel != null && `Pain ${l.painLevel}/10`, l.duration, l.surgery && l.surgery !== "No" && l.surgery]
          .filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        ${l.message ? `<p class="msg">${esc(l.message)}</p>` : ""}
        <textarea rows="2" placeholder="Notes" data-notes>${esc(l.notes)}</textarea>
        <div class="actions">
          <select data-status>${STATUSES.map((s) => `<option ${s === l.status ? "selected" : ""}>${s}</option>`).join("")}</select>
          <button class="mini" data-save>Save</button>
          <button class="mini danger" data-del>Delete</button>
        </div>
      </article>`).join("") : `<p class="muted">No leads yet.</p>`;
  }
  $("#lead-filter").addEventListener("change", run(loadLeads));
  // Picking a status saves it right away (with the notes as typed); it used to wait for the Save button and was lost on reload
  $("#leads-list").addEventListener("change", run(async (e) => {
    if (!e.target.matches("[data-status]")) return;
    const card = e.target.closest(".lead");
    const r = await api("PATCH", `/api/admin/leads/${card.dataset.id}`, { status: e.target.value });
    const badge = $("h3 .badge", card); if (badge) { badge.className = `badge ${r.status}`; badge.textContent = r.status; }
    toast("Lead saved."); // no re-render, so notes being typed aren't wiped
  }));
  $("#leads-list").addEventListener("click", run(async (e) => {
    const card = e.target.closest(".lead");
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.matches("[data-save]")) {
      await api("PATCH", `/api/admin/leads/${id}`, { status: $("[data-status]", card).value, notes: $("[data-notes]", card).value });
      toast("Lead saved."); loadLeads();
    }
    if (e.target.matches("[data-del]") && confirm("Delete this lead for good?")) {
      await api("DELETE", `/api/admin/leads/${id}`); toast("Lead deleted."); loadLeads();
    }
  }));

  // ---- Classes
  $("[name=day]", $("#class-form")).innerHTML = DAYS.map((d, i) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${d}</option>`).join("");
  let classList = [];
  async function loadClasses() {
    classList = await api("GET", "/api/admin/classes");
    const sorted = [...classList].sort((a, b) => a.day - b.day || (a.time < b.time ? -1 : 1));
    table($("#classes-table"), ["Day", "Time", "Class", "Cap.", "Coach", ""], sorted.map((c) => `
      <tr class="${c.active === false ? "off" : ""}" data-id="${c.id}">
        <td>${DAYS[c.day]}</td><td>${fmtTime(c.time)} · ${c.durationMin}m</td><td>${esc(c.title)}</td><td>${c.capacity}</td><td>${esc(c.coach)}</td>
        <td><button class="mini" data-toggle>${c.active === false ? "Turn on" : "Pause"}</button>
            <button class="mini" data-cap>Capacity</button>
            <button class="mini danger" data-del>Delete</button></td>
      </tr>`), "No classes yet.");
  }
  $("#class-form").addEventListener("submit", run(async (e) => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f)), msg = $(".form-msg", f);
    msg.textContent = "";
    try {
      await api("POST", "/api/admin/classes", { ...d, day: Number(d.day), durationMin: Number(d.durationMin), capacity: Number(d.capacity) });
      f.reset(); toast("Class added."); loadClasses();
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  }));
  $("#classes-table").addEventListener("click", run(async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const c = classList.find((x) => x.id === row.dataset.id);
    if (e.target.matches("[data-toggle]")) await api("PUT", `/api/admin/classes/${c.id}`, { active: c.active === false });
    else if (e.target.matches("[data-cap]")) {
      const n = prompt("New capacity:", c.capacity);
      if (n === null) return;
      const cap = Number(String(n).trim());
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) throw new Error("Capacity must be a whole number from 1 to 100.");
      await api("PUT", `/api/admin/classes/${c.id}`, { capacity: cap });
    } else if (e.target.matches("[data-del]")) {
      if (!confirm(`Delete "${c.title}" and all its bookings?`)) return;
      await api("DELETE", `/api/admin/classes/${c.id}`);
    } else return;
    toast("Saved."); loadClasses();
  }));

  // ---- Bookings
  async function loadBookings() {
    const list = await api("GET", "/api/admin/bookings" + ($("#bookings-all").checked ? "?all=1" : ""));
    table($("#bookings-table"), ["When", "Class", "Name", "Contact", ""], list.map((b) => `
      <tr data-id="${b.id}"><td>${fmtDate(b.date)} · ${fmtTime(b.time)}</td><td>${esc(b.title)}</td><td>${esc(b.name)}</td>
        <td><a href="mailto:${esc(b.email)}">${esc(b.email)}</a>${b.phone ? "<br>" + esc(b.phone) : ""}</td>
        <td><button class="mini danger" data-del>Cancel</button></td></tr>`), "No upcoming bookings.");
  }
  $("#bookings-all").addEventListener("change", run(loadBookings));
  $("#bookings-table").addEventListener("click", run(async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row || !e.target.matches("[data-del]") || !confirm("Cancel this booking?")) return;
    await api("DELETE", `/api/admin/bookings/${row.dataset.id}`); toast("Booking cancelled."); loadBookings();
  }));

  // ---- Subscribers
  async function loadSubs() {
    const list = await api("GET", "/api/admin/subscribers");
    table($("#subs-table"), ["Email", "Joined", ""], list.map((s) => `
      <tr data-email="${esc(s.email)}"><td>${esc(s.email)}</td><td>${when(s.createdAt)}</td><td><button class="mini danger" data-del>Remove</button></td></tr>`),
      "No subscribers yet.");
  }
  $("#subs-table").addEventListener("click", run(async (e) => {
    const row = e.target.closest("tr[data-email]");
    if (!row || !e.target.matches("[data-del]") || !confirm("Remove this subscriber?")) return;
    await api("DELETE", `/api/admin/subscribers/${encodeURIComponent(row.dataset.email)}`); toast("Removed."); loadSubs();
  }));

  // ---- Audit ledger
  async function loadAudit() {
    const f = $("#audit-filter").value;
    const d = await api("GET", "/api/admin/audit?limit=300" + (f ? "&action=" + encodeURIComponent(f) : ""));
    $("#audit-pub").textContent = `${d.publicKey}\nFingerprint: ${d.fingerprint}`;
    table($("#audit-table"), ["#", "When", "Who", "What", "Record", "Hash"], d.entries.map((e) => `
      <tr><td>${e.seq}</td><td>${when(e.ts)}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td>${esc(e.subject || "")}</td><td><code title="${e.hash}">${e.hash.slice(0, 10)}…</code></td></tr>`), "No events yet.");
  }
  $("#audit-filter").addEventListener("change", run(loadAudit));
  $("#anchor-check").addEventListener("click", run(async () => {
    const v = await api("GET", `/api/admin/audit/verify?seq=${encodeURIComponent($("#anchor-seq").value.trim())}&head=${encodeURIComponent($("#anchor-head").value.trim())}`);
    const a = v.anchor || {};
    $("#audit-status").innerHTML = a.ok ? `<p class="banner ok">✓ Anchor #${a.seq} matches the live ledger, and the chain is ${v.ok ? "intact" : "BROKEN: " + esc(v.error)}.</p>`
      : `<p class="banner bad">✗ ${esc(a.error || "That anchor does NOT match the live ledger. The log may have been rewritten. Contact your IT/security help.")}</p>`;
  }));
  $("#anchor-now").addEventListener("click", run(async () => { await api("POST", "/api/admin/audit/anchor"); toast("Anchor emailed to you (if there were new entries)."); }));
  $("#audit-verify").addEventListener("click", run(async () => {
    const v = await api("GET", "/api/admin/audit/verify");
    $("#audit-status").innerHTML = v.ok
      ? `<p class="banner ok">✓ Ledger intact: ${v.entries} entries, every link and signature checks out. Head <code>${v.head.slice(0, 16)}…</code></p>`
      : `<p class="banner bad">✗ ${esc(v.error)}</p>`;
  }));

  // ---- Messages from members
  let openThread = null;
  // Recent group messages: who read them, how many email notices went out, and a reminder button for the rest
  async function loadBroadcasts() {
    const box = $("#bc-recent"); if (!box) return;
    let list = [];
    try { list = await api("GET", "/api/admin/messages/broadcasts"); } catch { box.hidden = true; return; }
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<h4>Recent group messages</h4>` + list.slice(0, 5).map((g) => {
      const unread = g.recipients - g.read;
      return `<div class="bc-row" data-bid="${esc(g.broadcastId)}">
        <div class="bc-info"><p>${esc(g.preview)}${g.preview.length >= 120 ? "…" : ""}</p>
          <small class="muted">${when(g.at)} · ${g.recipients} people · ${g.read} read · ${g.sending ? "emails going out now…" : `${g.emailed} emailed`}</small></div>
        ${unread && !g.sending ? `<button type="button" class="mini" data-remind>Email reminder to ${unread} who haven't read it</button>` : ""}
      </div>`;
    }).join("") : "";
    if (list.some((g) => g.sending)) setTimeout(() => { if (current === "messages") loadBroadcasts(); }, 4000);
  }
  $("#bc-recent").addEventListener("click", run(async (e) => {
    const b = e.target.closest("[data-remind]"); if (!b) return;
    const row = b.closest("[data-bid]");
    if (!confirm(b.textContent.replace("Email reminder to", "Email a reminder to") + "?")) return;
    b.disabled = true; b.textContent = "Sending…";
    try {
      const r = await api("POST", `/api/admin/messages/broadcast/${encodeURIComponent(row.dataset.bid)}/remind`, {});
      toast(r.failed ? `Reminder sent to ${r.sent}; ${r.failed} couldn't be emailed (bad address).` : `Reminder emailed to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`);
    } finally { loadBroadcasts(); }
  }));
  async function loadThreads() {
    loadBroadcasts();
    const d = await api("GET", "/api/admin/messages");
    const c = $("#admin-msg-count"); c.hidden = !d.unread; c.textContent = d.unread;
    $("#msg-threads").innerHTML = d.threads.length ? d.threads.map((t) => `
      <button type="button" class="msg-row${t.unread ? " unread" : ""}${t.clientId === openThread ? " on" : ""}" data-cid="${t.clientId}">
        <b>${esc(t.name)}</b>${t.unread ? `<span class="pill pending">${t.unread} new</span>` : ""}
        <small>${t.last.from === "doctor" ? "You: " : ""}${esc(t.last.body)}</small><small class="muted">${when(t.last.at)}${t.member ? "" : " · not a member"}</small></button>`).join("")
      : `<p class="muted">No messages yet. Members can message you from the app.</p>`;
    if (openThread) showThread(openThread);
  }
  // Unsent replies, per member: a re-render (new message or reaction arriving) must not wipe what you're typing.
  const drafts = new Map();
  async function showThread(cid) {
    openThread = cid;
    const d = await api("GET", `/api/admin/messages/${cid}`);
    const old = $("#msg-reply textarea");
    if (old && old.dataset.cid) drafts.set(old.dataset.cid, old.value);
    const hadFocus = old && document.activeElement === old && old.dataset.cid === cid;
    $("#msg-thread").innerHTML = `<div class="item-head"><b>${esc(d.client.name)}</b> <span class="muted">${esc(d.client.email)} ${esc(d.client.phone || "")}</span> ${d.client.member ? `<span class="pill approved">${esc(d.client.tier)}</span>` : `<span class="pill hidden">not a member</span>`}</div>
      <div class="msg-log">${d.messages.map((m) => `<div class="mb ${m.from}" data-mid="${esc(m.id)}"><p>${esc(m.body).replace(/\n/g, "<br>")}</p><small>${m.from === "doctor" ? "You" : esc(d.client.name.split(" ")[0])} · ${when(m.at)}</small>${[m.reactions?.client, m.reactions?.doctor].filter(Boolean).length ? `<div class="reacts">${[m.reactions.client, m.reactions.doctor].filter(Boolean).map((x) => `<b>${x}</b>`).join("")}</div>` : ""}<div class="react-row">${["👍", "❤️", "😂", "🙏", "💪", "😮"].map((x) => `<button type="button" data-emoji="${x}" class="${m.reactions?.doctor === x ? "on" : ""}">${x}</button>`).join("")}</div></div>`).join("")}</div>
      <form class="msg-reply" id="msg-reply"><textarea name="body" rows="3" maxlength="2000" placeholder="Reply to ${esc(d.client.name.split(" ")[0])}…"></textarea><button class="btn btn-sm" type="submit">Send reply</button></form>`;
    const log = $(".msg-log"); log.scrollTop = log.scrollHeight;
    log.addEventListener("click", run(async (e) => {
      const btn = e.target.closest("[data-emoji]"), mb = e.target.closest("[data-mid]"); if (!btn || !mb) return;
      await api("POST", `/api/admin/messages/${cid}/${encodeURIComponent(mb.dataset.mid)}/react`, { emoji: btn.dataset.emoji }); showThread(cid);
    }));
    $$("#msg-threads .msg-row").forEach((r) => r.classList.toggle("on", r.dataset.cid === cid));
    const ta = $("#msg-reply textarea"); ta.dataset.cid = cid; ta.value = drafts.get(cid) || "";
    ta.addEventListener("input", () => drafts.set(cid, ta.value));
    if (hadFocus) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    $("#msg-reply").addEventListener("submit", run(async (e) => {
      e.preventDefault(); const body = e.target.body.value.trim(); if (!body) return;
      const btn = $("button[type=submit]", e.target); if (btn.disabled) return;
      btn.disabled = true; // one tap = one message (and one email)
      try { await api("POST", `/api/admin/messages/${cid}`, { body }); } finally { btn.disabled = false; }
      drafts.delete(cid); ta.value = "";
      toast("Sent. They'll get an email that you replied."); showThread(cid);
    }));
  }
  $("#msg-threads").addEventListener("click", run(async (e) => { const r = e.target.closest("[data-cid]"); if (r) { await showThread(r.dataset.cid); await loadThreads(); } }));

  // ---- One message to many: everyone, all members, one tier, or picked people. Each lands in that person's own thread.
  $("#bc-open").addEventListener("click", run(async () => {
    openThread = null; $$("#msg-threads .msg-row").forEach((r) => r.classList.remove("on"));
    const [people, c] = await Promise.all([api("GET", "/api/admin/clients"), contentCache ? contentCache : api("GET", "/api/admin/content")]);
    contentCache = c;
    const tiers = c.tiers || [], tierName = (id) => (tiers.find((t) => t.id === id) || {}).name || id;
    const picked = new Set();
    const box = $("#msg-thread");
    box.innerHTML = `<form class="bc-form" id="bc-form">
      <div class="item-head"><b>New message to many</b> <span class="muted small">Each person gets it in their own private thread and can reply to you as usual.</span></div>
      <fieldset class="bc-to"><legend>Send to</legend>
        <label class="check"><input type="radio" name="to" value="all" checked> Everyone with an account</label>
        <label class="check"><input type="radio" name="to" value="members"> All active members</label>
        <label class="check"><input type="radio" name="to" value="tier"${tiers.length ? "" : " disabled"}> One membership tier
          <select name="tier">${tiers.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></label>
        <label class="check"><input type="radio" name="to" value="selected"> People I pick</label>
      </fieldset>
      <div class="bc-pick" id="bc-pick" hidden>
        <div class="row-actions"><input type="search" id="bc-search" placeholder="Search name or email" style="flex:1;min-width:180px">
          <button class="mini" type="button" id="bc-all">Select shown</button><button class="mini" type="button" id="bc-none">Clear</button></div>
        <div class="bc-list" id="bc-list"></div>
      </div>
      <textarea name="body" rows="5" maxlength="2000" placeholder="Write your message…" required></textarea>
      <label class="check"><input type="checkbox" name="email" checked> Also email them that they have a new message (the email never includes the message itself)</label>
      <div class="row-actions"><button class="btn btn-sm" type="submit" id="bc-send">Send</button><span class="muted small" id="bc-count"></span></div>
    </form>`;
    const f = $("#bc-form");
    const audience = () => {
      const to = f.to.value;
      if (to === "all") return people;
      if (to === "members") return people.filter((p) => p.membership);
      if (to === "tier") return people.filter((p) => p.membership && p.membership.tier === f.tier.value);
      return people.filter((p) => picked.has(p.id));
    };
    const shown = () => { const q = $("#bc-search").value.trim().toLowerCase(); return people.filter((p) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q)); };
    const renderList = () => {
      const list = shown();
      $("#bc-list").innerHTML = list.length ? list.map((p) => `<label class="check bc-person"><input type="checkbox" value="${esc(p.id)}"${picked.has(p.id) ? " checked" : ""}>
        <span><b>${esc(p.name)}</b> <span class="muted small">${esc(p.email)}</span>${p.membership ? ` <span class="pill approved">${esc(tierName(p.membership.tier))}</span>` : ""}</span></label>`).join("")
        : `<p class="muted small">Nobody matches.</p>`;
    };
    const update = () => {
      $("#bc-pick").hidden = f.to.value !== "selected";
      const n = audience().length;
      $("#bc-count").textContent = n ? `${n} ${n === 1 ? "person" : "people"} will get this.` : f.to.value === "selected" ? "Pick at least one person." : "Nobody matches this choice yet.";
      // Only touch the label when it changes: typing the message then tapping Send fires "change" on the way, and
      // Safari drops the click if the button's text is replaced between press and release
      const label = n ? `Send to ${n}` : "Send"; if ($("#bc-send").textContent !== label) $("#bc-send").textContent = label;
      $("#bc-send").disabled = !n;
    };
    f.addEventListener("change", (e) => {
      if (e.target.matches("#bc-list input")) { e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value); }
      if (e.target.name === "tier") f.querySelector('input[value="tier"]').checked = true;
      update();
    });
    $("#bc-search").addEventListener("input", renderList);
    $("#bc-all").addEventListener("click", () => { shown().forEach((p) => picked.add(p.id)); renderList(); update(); });
    $("#bc-none").addEventListener("click", () => { picked.clear(); renderList(); update(); });
    f.addEventListener("submit", run(async (e) => {
      e.preventDefault();
      const body = f.body.value.trim(), n = audience().length; if (!body || !n) return;
      const to = f.to.value;
      const who = to === "all" ? "everyone with an account" : to === "members" ? "all active members" : to === "tier" ? `${tierName(f.tier.value)} members` : "the people you picked";
      if (!confirm(`Send this message to ${n} ${n === 1 ? "person" : "people"} (${who})?`)) return;
      $("#bc-send").disabled = true;
      try {
        const r = await api("POST", "/api/admin/messages/broadcast", { to, tier: f.tier.value, clientIds: [...picked], body, email: f.email.checked });
        toast(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.${r.emailing ? " Email notices are going out now." : ""}`);
        box.innerHTML = `<p class="muted">Sent. Pick a conversation to see replies.</p>`;
        loadThreads();
      } finally { const b = $("#bc-send"); if (b) b.disabled = false; }
    }));
    renderList(); update(); f.body.focus();
  }));
  function pollBadges() {
    if (!token) return;
    api("GET", "/api/admin/messages").then((d) => { const c = $("#admin-msg-count"); c.hidden = !d.unread; c.textContent = d.unread; }).catch(() => {});
    api("GET", "/api/admin/feedback-reports").then((d) => { const c = $("#admin-fb-count"); c.hidden = !d.open; c.textContent = d.open; }).catch(() => {});
  }
  setInterval(() => { if (token && !document.hidden) pollBadges(); }, 60000);

  // ---- Reviews from the website
  async function loadReviews() {
    const list = await api("GET", "/api/admin/feedback");
    $("#reviews-list").innerHTML = list.length ? list.map((f) => `
      <article class="item" data-id="${f.id}">
        <div class="item-head"><b>${esc(f.name)}</b> <span class="stars">${"★".repeat(f.rating)}${"☆".repeat(5 - f.rating)}</span>
          <span class="pill ${f.status}">${f.status}</span> <span class="muted">${when(f.createdAt)}</span></div>
        <p>${esc(f.text)}</p>
        <p class="muted small">${esc(f.email)} · ${f.publish ? "OK to publish" : "Private, do not publish"} · Reward ${esc(f.rewardCode)} ${f.rewardUsedAt ? `(booked ${when(f.rewardUsedAt)})` : "(not used yet)"}</p>
        <div class="row-actions">${f.publish && f.status !== "approved" ? `<button class="mini" data-st="approved">Show on website</button>` : ""}
          ${f.status !== "hidden" ? `<button class="mini danger" data-st="hidden">Hide</button>` : `<button class="mini" data-st="pending">Restore</button>`}</div>
      </article>`).join("") : `<p class="muted">No reviews yet. The form is in the Reviews section of the homepage.</p>`;
  }
  $("#reviews-list").addEventListener("click", run(async (e) => {
    const b = e.target.closest("[data-st]"); if (!b) return;
    await api("PATCH", `/api/admin/feedback/${b.closest("[data-id]").dataset.id}`, { status: b.dataset.st }); toast("Updated."); loadReviews();
  }));

  // ---- Feedback: bug reports and suggestions from members
  async function loadFeedback() {
    const kind = $("#fb-filter-kind").value, status = $("#fb-filter-status").value;
    const q = new URLSearchParams(); if (kind) q.set("kind", kind); if (status) q.set("status", status);
    const d = await api("GET", "/api/admin/feedback-reports" + (q.toString() ? "?" + q : ""));
    const c = $("#admin-fb-count"); c.hidden = !d.open; c.textContent = d.open;
    $("#feedback-list").innerHTML = d.reports.length ? d.reports.map((r) => `
      <article class="item" data-id="${r.id}">
        <div class="item-head"><b>${esc(r.title)}</b>
          <span class="pill ${r.kind}">${r.kind === "bug" ? "Bug" : "Suggestion"}</span>
          <span class="pill ${r.status}">${r.status}</span>
          <span class="muted">${when(r.createdAt)}</span></div>
        <p>${esc(r.body)}</p>
        <p class="muted small">${esc(r.clientName)} &lt;${esc(r.clientEmail)}&gt;${r.page ? ` · from ${esc(r.page)}` : ""}${r.userAgent ? ` · ${esc(String(r.userAgent).slice(0, 80))}` : ""}${r.resolvedAt ? ` · resolved ${when(r.resolvedAt)}` : ""}</p>
        <div class="row-actions">
          ${r.status !== "working" ? `<button class="mini" data-st="working">Mark working</button>` : ""}
          ${r.status !== "resolved" ? `<button class="mini" data-st="resolved">Mark resolved</button>` : ""}
          ${r.status === "resolved" ? `<button class="mini" data-st="new">Reopen</button>` : ""}
          <button class="mini danger" data-del>Delete</button>
        </div>
      </article>`).join("") : `<p class="muted">No feedback yet. Members submit it from Account → Profile → Help us improve.</p>`;
  }
  $("#feedback-list").addEventListener("click", run(async (e) => {
    const card = e.target.closest("[data-id]"); if (!card) return;
    if (e.target.matches("[data-del]")) {
      if (!confirm("Delete this report? This can't be undone.")) return;
      await api("DELETE", `/api/admin/feedback-reports/${card.dataset.id}`); toast("Deleted."); loadFeedback(); return;
    }
    const st = e.target.closest("[data-st]"); if (!st) return;
    await api("PATCH", `/api/admin/feedback-reports/${card.dataset.id}`, { status: st.dataset.st }); toast("Updated."); loadFeedback();
  }));
  $("#fb-filter-kind").addEventListener("change", run(loadFeedback));
  $("#fb-filter-status").addEventListener("change", run(loadFeedback));
  // Feedback badge polling now handled by pollBadges()

  // ---- Members: requests, tiers, 1-on-1 scheduling
  let contentCache = null;
  async function loadMembers() {
    const [list, c] = await Promise.all([api("GET", "/api/admin/members"), api("GET", "/api/admin/content")]);
    contentCache = c;
    const opts = (sel) => `<option value="">No membership</option>` + c.tiers.map((t) => `<option value="${t.id}"${t.id === sel ? " selected" : ""}>${esc(t.name)} ($${t.price}/mo)</option>`).join("");
    $("#members-list").innerHTML = list.length ? list.map((m) => `
      <article class="item" data-id="${m.id}">
        <div class="item-head"><b>${esc(m.name)}</b> <span class="muted">${esc(m.email)} ${esc(m.phone || "")}</span> ${m.membership ? `<span class="pill approved">${esc(m.tier)}</span>` : ""}</div>
        ${m.request ? `<p class="banner">Requested <b>${esc((c.tiers.find((t) => t.id === m.request.tier) || {}).name || m.request.tier)}</b> on ${when(m.request.at)}${m.request.note ? `: “${esc(m.request.note)}”` : ""}</p>` : ""}
        <div class="row-actions mem-row"><select data-tier>${opts(m.membership ? m.membership.tier : (m.request || {}).tier)}</select>
          <label>Paid through <input type="date" data-until value="${m.membership && m.membership.until || ""}"></label><button class="mini" data-save-mem>Save membership</button></div>
        ${m.meetings.length ? `<h4>1-on-1 sessions</h4>${m.meetings.map((x) => `<div class="meet-row" data-mid="${x.id}">
          <p><b>${esc(x.topic)}</b> <span class="pill ${x.status === "done" ? "approved" : x.status === "cancelled" ? "hidden" : "pending"}">${x.status}</span><br><span class="muted small">Asked ${when(x.createdAt)} · prefers ${esc(x.times)}</span></p>
          <div class="row-actions"><input data-when placeholder="When, e.g. Nov 12, 5:30 PM" value="${esc(x.when)}"><input data-link placeholder="https://meet.google.com/…" value="${esc(x.link)}">
          <select data-mst>${["requested", "scheduled", "done", "cancelled"].map((st) => `<option${st === x.status ? " selected" : ""}>${st}</option>`).join("")}</select><button class="mini" data-save-meet>Save</button></div></div>`).join("")}` : ""}
      </article>`).join("") : `<p class="muted">No members or requests yet. Clients request a membership from the Membership tab in their app.</p>`;
  }
  $("#members-list").addEventListener("click", run(async (e) => {
    const card = e.target.closest("[data-id]"); if (!card) return;
    if (e.target.matches("[data-save-mem]")) {
      await api("PUT", `/api/admin/clients/${card.dataset.id}/membership`, { tier: $("[data-tier]", card).value || null, until: $("[data-until]", card).value });
      toast("Membership saved."); loadMembers();
    }
    if (e.target.matches("[data-save-meet]")) {
      const r = e.target.closest("[data-mid]");
      await api("PATCH", `/api/admin/clients/${card.dataset.id}/meetings/${r.dataset.mid}`, { when: $("[data-when]", r).value, link: $("[data-link]", r).value, status: $("[data-mst]", r).value });
      toast("Session saved. The client gets an email when it's scheduled."); loadMembers();
    }
  }));

  // ---- Content editor: live Q&A, lectures, tips, tiers, programs
  const ctf = $("#content-form");
  const FIELDS = {
    lectures: { blank: { id: "", title: "", topic: "Health", minutes: 0, url: "", downloadUrl: "", access: "free", summary: "" }, html: (x, c) => `
      <label>Title<input data-f="title" value="${esc(x.title)}" maxlength="120"></label>
      <label>Topic<select data-f="topic">${c.topics.map((t) => `<option${t === x.topic ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Video link<input data-f="url" value="${esc(x.url)}" placeholder="https://youtu.be/…"></label>
      <label>Download link<input data-f="downloadUrl" value="${esc(x.downloadUrl)}" placeholder="optional"></label>
      <label>Minutes<input data-f="minutes" type="number" min="0" value="${x.minutes}"></label>
      <label>Access<select data-f="access">${["free", "member", "premium"].map((a) => `<option${a === x.access ? " selected" : ""}>${a}</option>`).join("")}</select></label>
      <label class="wide">Summary<input data-f="summary" value="${esc(x.summary)}" maxlength="500"></label>` },
    recommendations: { blank: { id: "", area: "", title: "", body: "", link: "" }, html: (x) => `
      <label>Area<input data-f="area" value="${esc(x.area)}" placeholder="Feet, Low back…" maxlength="40"></label>
      <label class="wide">Title<input data-f="title" value="${esc(x.title)}" maxlength="120"></label>
      <label class="wide">Text<textarea data-f="body" rows="3" maxlength="2000">${esc(x.body)}</textarea></label>
      <label class="wide">Link (optional)<input data-f="link" value="${esc(x.link)}"></label>` },
    tiers: { blank: { id: "", name: "", price: 0, meetings: 0, meetingMinutes: 45, perks: [] }, html: (x) => `
      <label>Name<input data-f="name" value="${esc(x.name)}" maxlength="60"></label>
      <label>Price per month ($)<input data-f="price" type="number" min="0" step="0.01" value="${x.price}"></label>
      <label>1-on-1 sessions per month<input data-f="meetings" type="number" min="0" max="31" value="${x.meetings}"></label>
      <label>Session length (min)<input data-f="meetingMinutes" type="number" min="0" max="180" value="${x.meetingMinutes}"></label>
      <label class="wide">Perks, one per line<textarea data-f="perks" rows="3">${esc(x.perks.join("\n"))}</textarea></label>` },
    tracks: { blank: { id: "", title: "", region: "", img: [], pts: [], note: "", levels: [{ title: "Level 1", videos: [] }] }, html: (x) => {
      const MUS = (window.MDFitMuscles || {}).MUSCLES || {};
      const opts = Object.entries(MUS).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, m]) => `<option value="${id}"${x.pts.includes(id) ? " selected" : ""}>${esc(m.name)}</option>`).join("");
      const lv = x.levels.map((l) => [l.title, ...l.videos.map((v) => `${v.name} | ${v.id ? "https://drive.google.com/file/d/" + v.id + "/view" : ""}`)].join("\n")).join("\n");
      return `
      <label class="wide">Title<input data-f="title" value="${esc(x.title)}" maxlength="120" placeholder="Scalenes → front of the chest"></label>
      <label>Region<input data-f="region" value="${esc(x.region)}" maxlength="40" placeholder="Chest"></label>
      <label>Note<input data-f="note" value="${esc(x.note)}" maxlength="300"></label>
      <label class="wide">Muscles (body-map buttons). Ctrl/Cmd-click to pick several<select data-f="pts" multiple size="6">${opts}</select></label>
      <label class="wide">Pain pattern images, one Drive link per line<textarea data-f="img" rows="2">${esc(x.img.map((i) => "https://drive.google.com/file/d/" + i + "/view").join("\n"))}</textarea></label>
      <div class="wide trk-thumbs">${x.img.map((i) => `<img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(i)}&sz=w200" alt="" referrerpolicy="no-referrer">`).join("")}</div>
      <label class="wide">Levels and videos<textarea data-f="levels" rows="8">${esc(lv)}</textarea></label>`;
    } },
    programs: { blank: { id: "", title: "", category: "Strength", level: "beginner", location: "home", weeks: 4, seed: Math.floor(Math.random() * 90000) + 1000, access: "free", summary: "", notes: "", days: [{ name: "Day 1", goal: "full", length: 30 }] }, html: (x, c) => `
      <label>Title<input data-f="title" value="${esc(x.title)}" maxlength="80"></label>
      <label>Category<select data-f="category">${c.categories.map((t) => `<option${t === x.category ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Level<select data-f="level">${["beginner", "intermediate", "advanced", "elite"].map((t) => `<option${t === x.level ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Where<select data-f="location">${["home", "gym", "outdoor", "office"].map((t) => `<option${t === x.location ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Weeks<input data-f="weeks" type="number" min="1" max="52" value="${x.weeks}"></label>
      <label>Seed<input data-f="seed" type="number" min="1" value="${x.seed}"></label>
      <label>Access<select data-f="access">${["free", "member", "premium"].map((a) => `<option${a === x.access ? " selected" : ""}>${a}</option>`).join("")}</select></label>
      <label class="wide">Summary<input data-f="summary" value="${esc(x.summary)}" maxlength="400"></label>
      <label class="wide">Coaching notes<textarea data-f="notes" rows="2" maxlength="1000">${esc(x.notes)}</textarea></label>
      <label class="wide">Days<textarea data-f="days" rows="4">${esc(x.days.map((d) => [d.name, d.goal, d.length, d.rounds || ""].join(" | ")).join("\n"))}</textarea></label>` },
    events: { blank: { id: "", title: "", date: "", time: "", location: "", description: "", link: "", free: false }, html: (x) => `
      <label>Title<input data-f="title" value="${esc(x.title)}" maxlength="120"></label>
      <label>Date (YYYY-MM-DD)<input data-f="date" value="${esc(x.date)}" maxlength="10" placeholder="2026-11-14"></label>
      <label>Time<input data-f="time" value="${esc(x.time)}" maxlength="20" placeholder="10:00 AM – 2:00 PM"></label>
      <label>Location<input data-f="location" value="${esc(x.location)}" maxlength="200"></label>
      <label class="wide">Description<textarea data-f="description" rows="2" maxlength="2000">${esc(x.description)}</textarea></label>
      <label>RSVP / Details link<input data-f="link" value="${esc(x.link)}" placeholder="https://…"></label>
      <label><input data-f="free" type="checkbox"${x.free ? " checked" : ""}> Free event</label>` }
  };
  let tracksEdited = false;
  $("#rows-tracks").addEventListener("input", () => (tracksEdited = true));
  $("#rows-tracks").addEventListener("change", () => (tracksEdited = true));
  $("#tracks-reset").addEventListener("click", run(async () => {
    if (!confirm("Replace every pain track with Dr. Jared's originals? Your edits to tracks will be lost.")) return;
    await api("PUT", "/api/admin/content", { tracks: [] }); toast("Pain tracks reset."); loadContent();
  }));
  const slugify = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
  // Each row keeps its full original item, so fields the editor doesn't show (a program's exercise lists, rest
  // times, image and sport; a recommendation's image) survive a save instead of being silently dropped.
  const rowOrig = new WeakMap();
  function addRow(kind, x, c) {
    const row = document.createElement("div"); row.className = "crow"; row.dataset.id = x.id || ""; rowOrig.set(row, x);
    row.innerHTML = `<div class="crow-grid">${FIELDS[kind].html(x, c)}</div><button type="button" class="link svc-del" data-del-row>Remove</button>`;
    $("#rows-" + kind).append(row);
  }
  async function loadContent() {
    const c = await api("GET", "/api/admin/content");
    c.topics = ["Health", "Wellness", "Hormones", "Inflammation", "Pain science", "Nutrition", "Sleep & recovery"];
    c.categories = ["Hypertrophy", "Strength", "Anti-inflammatory", "Weight loss", "Mobility", "Rehabilitation", "Desk & posture", "Performance", "Sport Performance"];
    c.programs.forEach((p) => { if (p.category && !c.categories.includes(p.category)) c.categories.push(p.category); });
    contentCache = c;
    ["title", "date", "time", "minutes", "joinUrl", "access", "notes"].forEach((k) => (ctf["live_" + k].value = c.live[k] ?? ""));
    ctf.live_recordings.value = c.live.recordings.map((r) => [r.title, r.date, r.url].join(" | ")).join("\n");
    tracksEdited = false;
    c.tracks = c.tracks && c.tracks.length ? c.tracks : ((window.MDFitTracks || {}).BUILTIN || []);
    Object.keys(FIELDS).forEach((k) => { $("#rows-" + k).innerHTML = ""; c[k].forEach((x) => addRow(k, x, c)); });
  }
  ctf.addEventListener("click", (e) => {
    const a = e.target.closest("[data-add]"); if (a) { addRow(a.dataset.add, { ...FIELDS[a.dataset.add].blank }, contentCache); if (a.dataset.add === "tracks") tracksEdited = true; }
    if (e.target.closest("[data-del-row]") && confirm("Remove this item?")) { if (e.target.closest("#rows-tracks")) tracksEdited = true; e.target.closest(".crow").remove(); }
  });
  function readRows(kind) {
    const used = new Set();
    return $$("#rows-" + kind + " .crow").map((r) => {
      const orig = rowOrig.get(r) || {};
      const o = {}; $$("[data-f]", r).forEach((el) => (o[el.dataset.f] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value.trim()));
      const base = o.title || o.name || "item"; let id = r.dataset.id || slugify(base), n = 2; while (used.has(id)) id = slugify(base) + "-" + n++; used.add(id); o.id = id;
      if (kind === "tiers") o.perks = o.perks.split("\n").map((x) => x.trim()).filter(Boolean);
      if (kind === "tracks") {
        o.pts = [...$("[data-f=pts]", r).selectedOptions].map((op) => op.value);
        o.img = o.img.split("\n").map((x) => x.trim()).filter(Boolean);
        const levels = [];
        o.levels.split("\n").map((x) => x.trim()).filter(Boolean).forEach((line) => {
          const i = line.indexOf("|");
          if (i < 0) levels.push({ title: line, videos: [] });
          else { if (!levels.length) levels.push({ title: "Level 1", videos: [] }); levels[levels.length - 1].videos.push({ name: line.slice(0, i).trim(), id: line.slice(i + 1).trim() }); }
        });
        o.levels = levels;
      }
      if (kind === "programs") {
        // Each line is "name | focus | minutes | rounds". Keep each day's exercise list and rest times by matching
        // the original day by name (else by position) and laying the edited fields over it.
        const origDays = orig.days || [];
        o.days = o.days.split("\n").map((x) => x.trim()).filter(Boolean).map((line, i) => {
          const [name, goal = "full", length = "30", rounds = ""] = line.split("|").map((y) => y.trim());
          const { rounds: oldRounds, ...od } = origDays.find((d) => d.name === name) || origDays[i] || {};
          return { ...od, name, goal, length: Number(length), ...(rounds ? { rounds: Number(rounds) } : {}) };
        });
      }
      return { ...orig, ...o };
    });
  }
  ctf.addEventListener("submit", run(async (e) => {
    e.preventDefault();
    const msg = $(".form-msg", ctf); msg.className = "form-msg"; msg.textContent = "";
    const live = {}; ["title", "date", "time", "joinUrl", "access", "notes"].forEach((k) => (live[k] = ctf["live_" + k].value.trim()));
    live.minutes = Number(ctf.live_minutes.value || 60);
    live.recordings = ctf.live_recordings.value.split("\n").map((x) => x.trim()).filter(Boolean).map((l) => { const [title, date = "", url = ""] = l.split("|").map((y) => y.trim()); return { title, date, url }; });
    try {
      await api("PUT", "/api/admin/content", { live, lectures: readRows("lectures"), recommendations: readRows("recommendations"), tiers: readRows("tiers"), programs: readRows("programs"), events: readRows("events"), ...(tracksEdited ? { tracks: readRows("tracks") } : {}) });
      msg.className = "form-msg ok"; msg.textContent = "Saved. The app updates immediately."; loadContent();
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  }));

  // ---- CSV downloads (need the auth header, so fetch then save)
  $$("[data-csv]").forEach((b) => b.addEventListener("click", run(async () => {
    const blob = await api("GET", b.dataset.csv);
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: b.dataset.csv.split("/").pop() });
    a.click(); URL.revokeObjectURL(a.href);
  })));

  // ---- Settings
  const sf = $("#settings-form");
  // ---- Two-step login by email code
  async function loadMfa() {
    const st = await api("GET", "/api/admin/mfa");
    $("#mfa-box").innerHTML = !st.emailReady ? `<p class="banner">Two-step login needs email (Resend) to be connected first.</p>`
      : st.forcedOff ? `<p class="banner">Two-step login is switched off in Railway (ADMIN_MFA=off). Remove that variable to turn it back on.</p>`
      : st.enabled ? `<p class="banner ok">✓ Two-step login is on. Each sign-in emails a 6-digit code to ${esc(st.sendsTo)}.</p>
         <div class="row-actions"><input type="password" id="mfa-pass" placeholder="Your password"><button class="mini danger" type="button" id="mfa-off">Turn off</button></div>`
      : `<p class="banner">Two-step login is off. When on, every admin sign-in also needs a 6-digit code emailed to ${esc(st.sendsTo)}, so a stolen password alone can't open patient records.</p><button class="btn btn-sm" type="button" id="mfa-start">Turn on</button>`;
  }
  document.addEventListener("click", run(async (e) => {
    if (e.target.id === "mfa-start") {
      const r = await api("POST", "/api/admin/mfa/start");
      $("#mfa-box").innerHTML = `<p class="banner">We emailed a 6-digit code to ${esc(r.to)}. Enter it to turn on two-step login.</p>
        <div class="row-actions"><input id="mfa-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="width:130px" placeholder="6-digit code"><button class="btn btn-sm" type="button" id="mfa-confirm">Turn on</button></div>`;
    }
    if (e.target.id === "mfa-confirm") { await api("POST", "/api/admin/mfa/confirm", { code: $("#mfa-code").value.trim() }); toast("Two-step login is on."); loadMfa(); }
    if (e.target.id === "mfa-off") { await api("POST", "/api/admin/mfa/disable", { password: $("#mfa-pass").value }); toast("Two-step login turned off."); loadMfa(); }
  }));

  // Email delivery: who gets your alerts, sent/failed per day (last 14 days) and the latest failures
  async function loadEmailLog() {
    const box = $("#email-log"); if (!box) return;
    let d;
    try { d = await api("GET", "/api/admin/email-log"); } catch (err) { box.innerHTML = `<p class="muted">Couldn't load email delivery: ${esc(err.message)}</p>`; return; }
    if (!d.enabled) { box.innerHTML = `<p class="banner">Email is off. Add <code>RESEND_API_KEY</code> and <code>NOTIFY_FROM</code> in Railway.</p>`; return; }
    const days = d.days.slice(0, 14), sent = days.reduce((a, x) => a + x.sent, 0), failed = days.reduce((a, x) => a + x.failed, 0);
    box.innerHTML = `<p class="muted small">Your alerts (feedback, bookings, messages, group-message reports) go to: <b>${d.alertsTo.map(esc).join(", ") || "nobody yet"}</b></p>
      <div class="stats"><div class="stat"><b>${sent}</b><small>Emails sent (14d)</small></div><div class="stat${failed ? " bad" : ""}"><b>${failed}</b><small>Failed (14d)</small></div></div>
      ${days.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Sent</th><th>Failed</th></tr></thead><tbody>${days.map((x) => `<tr><td>${esc(x.date)}</td><td>${x.sent}</td><td>${x.failed ? `<b class="err">${x.failed}</b>` : 0}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No emails sent yet.</p>`}
      ${d.failures.length ? `<details class="audit-key"><summary>Latest failures (${d.failures.length})</summary><div class="table-wrap"><table><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Error</th></tr></thead><tbody>${d.failures.map((f) => `<tr><td>${when(f.at)}</td><td>${esc(f.to)}</td><td>${esc(f.subject)}</td><td>${esc(f.error)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`;
  }
  async function loadAnalytics() {
    loadEmailLog();
    const d = await api("GET", `/api/admin/analytics?days=${($("#an-range") || {}).value || 30}`);
    const s = d.summary;
    $("#analytics-stats").innerHTML = `
      <div class="stat"><b>${s.todayViews}</b><small>Views today</small></div>
      <div class="stat"><b>${s.todayUnique}</b><small>Visitors today</small></div>
      <div class="stat"><b>${s.totalViews}</b><small>Views (${d.rangeDays || 30}d)</small></div>
      <div class="stat"><b>${s.totalUnique}</b><small>Visitors (${d.rangeDays || 30}d)</small></div>`;
    $("#analytics-days").innerHTML = `<thead><tr><th>Date</th><th>Views</th><th>Visitors</th></tr></thead><tbody>${
      d.days.map((r) => `<tr><td>${esc(r.date)}</td><td>${r.views}</td><td>${r.unique}</td></tr>`).join("") || "<tr><td colspan=3 class='muted'>No data yet</td></tr>"
    }</tbody>`;
    $("#analytics-pages").innerHTML = `<thead><tr><th>Page</th><th>Views</th></tr></thead><tbody>${
      d.pages.map((r) => `<tr><td>${esc(r.page)}</td><td>${r.views}</td></tr>`).join("") || "<tr><td colspan=2 class='muted'>No data yet</td></tr>"
    }</tbody>`;
    $("#analytics-refs").innerHTML = `<thead><tr><th>Source</th><th>Views</th></tr></thead><tbody>${
      d.referrers.map((r) => `<tr><td>${esc(r.source)}</td><td>${r.views}</td></tr>`).join("") || "<tr><td colspan=2 class='muted'>No referral traffic yet</td></tr>"
    }</tbody>`;
    const m = d.mix || {};
    const block = (title, rows, icon) => `<div class="an-card"><h4>${title}</h4>${(rows || []).length ? rows.map((r) => `<div class="an-row"><span class="an-name">${icon ? icon(r.name) + " " : ""}${esc(r.name)}</span><span class="an-bar"><i style="width:${Math.max(2, r.pct)}%"></i></span><b>${r.pct}%</b><small>${r.views}</small></div>`).join("") : `<p class="muted small">No data yet</p>`}</div>`;
    const devIc = (n) => ({ Mobile: "📱", Desktop: "🖥️", Tablet: "📲" })[n] || "";
    $("#an-mix").innerHTML = block("Device", m.devices, devIc) + block("Where they came from", m.sources) + block("Location (city, state)", m.places)
      + block("Operating system", m.os) + block("Browser", m.browsers) + block("Country", m.countries);
  }

  document.addEventListener("change", (e) => { if (e.target.id === "an-range") loadAnalytics(); if (e.target.id === "sa-range") loadSearchAnalytics(); });

  async function loadSearchAnalytics() {
    const days = ($("#sa-range") || {}).value || 30;
    let d; try { d = await api("GET", `/api/admin/search-analytics?days=${days}`); } catch { return; }
    const s = d.totals || {};
    $("#sa-stats").innerHTML = `<div class="stat"><b>${s.events || 0}</b><small>Search events</small></div><div class="stat"><b>${s.uniqueQueries || 0}</b><small>Unique queries</small></div>`;
    const row = (r) => `<tr><td>${esc(r.q)}</td><td>${r.impressions}</td><td>${r.clicks}</td><td>${r.ctr}%</td><td>${r.meanPosition != null ? r.meanPosition : "—"}</td></tr>`;
    const head = `<thead><tr><th>Query</th><th>Shown</th><th>Clicks</th><th>CTR</th><th>Avg. pos.</th></tr></thead>`;
    const noData = `<tr><td colspan=5 class='muted'>No data yet</td></tr>`;
    $("#sa-top").innerHTML = head + "<tbody>" + ((d.top || []).map(row).join("") || noData) + "</tbody>";
    $("#sa-zero").innerHTML = head + "<tbody>" + ((d.zeroResult || []).map(row).join("") || noData) + "</tbody>";
    $("#sa-best").innerHTML = head + "<tbody>" + ((d.topCtr || []).map(row).join("") || noData) + "</tbody>";
    $("#sa-worst").innerHTML = head + "<tbody>" + ((d.bottomCtr || []).map(row).join("") || noData) + "</tbody>";
  }
  const _origAn = loadAnalytics;
  async function loadAnalyticsWithSearch() { await _origAn(); loadSearchAnalytics(); }
  loaders.analytics = loadAnalyticsWithSearch;
  async function loadSettings() {
    loadMfa();
    const s = await api("GET", "/api/admin/settings");
    $$("input[name*='.'], textarea[name*='.']", sf).forEach((el) => {
      const [sec, key] = el.name.split(".");
      el.value = s[sec][key] ?? "";
    });
    $("#svc-rows").innerHTML = ""; s.services.forEach(addSvc);
    const P = s.plans;
    ["gold", "silver", "silverPayments", "ext12", "ext24", "guaranteeMin"].forEach((k) => (sf["plan_" + k].value = P[k]));
    sf.plan_packageSizes.value = P.packageSizes.join(", ");
    sf.testimonials.value = s.testimonials.map((t) => `${t.name} | ${t.quote}`).join("\n");
  }
  function addSvc(v = { id: "", name: "", rate: 0, protocol: true, description: "" }) {
    const row = document.createElement("div");
    row.className = "svc-row";
    row.innerHTML = `
      <label>Name<input data-f="name" maxlength="60" required></label>
      <label>Rate ($)<input data-f="rate" type="number" min="0" max="10000"></label>
      <label class="check"><input type="checkbox" data-f="protocol"> Protocol</label>
      <label class="svc-desc">Description<input data-f="description" maxlength="300"></label>
      <button type="button" class="link svc-del" aria-label="Remove service">Remove</button>`;
    row.dataset.id = v.id;
    svcOrig.set(row, v); // keeps unit, withEval (plan includes the evaluation) and remote (telehealth) on save
    $("[data-f=name]", row).value = v.name; $("[data-f=rate]", row).value = v.rate;
    $("[data-f=protocol]", row).checked = v.protocol; $("[data-f=description]", row).value = v.description;
    $(".svc-del", row).addEventListener("click", () => row.remove());
    $("#svc-rows").append(row);
  }
  const svcOrig = new WeakMap();
  $("#svc-add").addEventListener("click", () => addSvc());
  const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "service";
  sf.addEventListener("submit", run(async (e) => {
    e.preventDefault();
    const msg = $(".form-msg", sf);
    msg.className = "form-msg"; msg.textContent = "";
    const body = { business: {}, coach: {}, rating: {} };
    $$("input[name*='.'], textarea[name*='.']", sf).forEach((el) => { const [sec, key] = el.name.split("."); body[sec][key] = el.value; });
    body.rating.count = Number(body.rating.count || 0);
    const used = new Set();
    body.services = $$(".svc-row", sf).map((r) => {
      const name = $("[data-f=name]", r).value.trim();
      let id = r.dataset.id || slug(name), n = 2; while (used.has(id)) id = slug(name) + "-" + n++; used.add(id);
      return { unit: "visit", ...(svcOrig.get(r) || {}), id, name, rate: Number($("[data-f=rate]", r).value || 0), protocol: $("[data-f=protocol]", r).checked, description: $("[data-f=description]", r).value.trim() };
    });
    const num = (k) => Number(sf["plan_" + k].value);
    body.plans = {
      gold: num("gold"), silver: num("silver"), silverPayments: num("silverPayments"), ext12: num("ext12"), ext24: num("ext24"), guaranteeMin: num("guaranteeMin"),
      packageSizes: sf.plan_packageSizes.value.split(/[,\s]+/).filter(Boolean).map(Number),
    };
    body.testimonials = sf.testimonials.value.split("\n").map((x) => x.trim()).filter(Boolean)
      .map((line) => { const i = line.indexOf("|"); return i < 0 ? { name: "", quote: line } : { name: line.slice(0, i).trim(), quote: line.slice(i + 1).trim() }; });
    try {
      await api("PUT", "/api/admin/settings", body);
      msg.className = "form-msg ok"; msg.textContent = "Saved. The website updates immediately.";
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
  }));

  if (token) api("GET", "/api/admin/me").then(show).catch(() => {});
})();
