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
  function logout() { token = ""; session.set(""); $("#app").hidden = true; $("#login").hidden = false; if (window.MDFitRT) MDFitRT.disconnect(); }
  $("#logout").addEventListener("click", logout);

  // ---- Tabs
  const loaders = { dash: loadDash, clients: loadClients, appts: loadAppts, hours: loadHours, leads: loadLeads, classes: loadClasses, bookings: loadBookings, subs: loadSubs, reviews: loadReviews, audit: loadAudit, messages: loadThreads, members: loadMembers, content: loadContent, settings: loadSettings, feedback: loadFeedback, analytics: loadAnalytics };
  let current = "dash";
  $$(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));
  function openTab(name) {
    current = name;
    $$(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
    run(loaders[name])();
  }
  function rtToast(text, icon) {
    const box = $("#rt-toasts"); if (!box) return;
    const el = document.createElement("div"); el.className = "rt-toast";
    el.innerHTML = `<span class="rt-icon">${icon || "🔔"}</span><span>${esc(text)}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 300); }, 5000);
    if (Notification.permission === "granted") { try { new Notification("MD Fit", { body: text, icon: "/assets/icon-64.png" }); } catch {} }
  }
  const TOAST_ICONS = { appointment: "📅", appointment_cancelled: "❌", lead: "🎯", booking: "🏋️", message: "💬", subscribe: "📧", bug_report: "🐛", suggestion: "💡", feedback: "⭐" };

  function show() {
    $("#login").hidden = true; $("#app").hidden = false; openTab(current);
    if (Notification.permission === "default") Notification.requestPermission().catch(() => {});
    if (window.MDFitRT) {
      MDFitRT.connect({ namespace: "/admin", token });
      MDFitRT.on("activity", (ev) => {
        if (current === "dash") run(loadDash)();
        if (ev.type === "appointment" || ev.type === "appointment_cancelled") { if (current === "appts") run(loadAppts)(); }
        if (ev.type === "booking" || ev.type === "booking_cancelled") { if (current === "bookings") run(loadBookings)(); }
        if (ev.type === "lead") { if (current === "leads") run(loadLeads)(); }
        if (ev.type === "subscribe") { if (current === "subs") run(loadSubs)(); }
        if (ev.type === "feedback" || ev.type === "bug_report" || ev.type === "suggestion") { if (current === "feedback") run(loadFeedback)(); }
      });
      MDFitRT.on("new_message", () => {
        if (current === "messages") run(loadThreads)();
        else pollBadges();
      });
      MDFitRT.on("message_reaction", (ev) => { if (openThread && ev.clientId === openThread) showThread(openThread); });
      MDFitRT.on("toast", (ev) => { rtToast(ev.text, TOAST_ICONS[ev.type]); });
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
    const [s, me] = await Promise.all([api("GET", "/api/admin/stats"), api("GET", "/api/admin/me")]);
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
  }

  // ---- Share link (the public site is where this admin page is served from)
  const bookUrl = location.origin + "/book";
  $("#book-link").value = bookUrl;
  $("#call-link").textContent = bookUrl + "?type=call";
  $("#copy-link").addEventListener("click", run(async () => {
    try { await navigator.clipboard.writeText(bookUrl); } catch { $("#book-link").select(); document.execCommand("copy"); }
    toast("Booking link copied.");
  }));

  // ---- Appointments
  async function loadAppts() {
    const list = await api("GET", "/api/admin/appointments" + ($("#appts-all").checked ? "?all=1" : ""));
    $("#appts-list").innerHTML = list.length ? list.map((a) => `
      <article class="lead appt ${a.status}" data-id="${a.id}">
        <header>
          <div><h3>${fmtDate(a.date)} · ${fmtTime(a.time)} <span class="badge ${a.status}">${a.status}</span>${["eval-remote","followup-remote"].includes(a.typeId) ? ` <span class="badge remote">Video</span>` : ""}${a.source === "cal" ? ` <span class="badge cal">Cal.com</span>` : ""}</h3>
            <div class="meta">${esc(a.typeName)} · ${a.minutes} min</div></div>
          <div class="meta">Booked ${when(a.createdAt)}</div>
        </header>
        <div><strong>${esc(a.name)}</strong> · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></div>
        <div class="intake">${[...(a.areas || []), a.painLevel != null && `Pain ${a.painLevel}/10`].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        ${a.notes ? `<p class="msg">${esc(a.notes)}</p>` : ""}
        ${["massage", "massage90"].includes(a.typeId) ? (a.intakeAt ? `<p><button class="mini" data-intake>View massage intake</button> <span class="meta">received ${when(a.intakeAt)}</span></p><div class="intake-view" hidden></div>` : `<p class="meta">Massage intake not received yet</p>`) : ""}
        <textarea rows="2" placeholder="Session notes (private)" data-notes>${esc(a.adminNotes)}</textarea>
        <div class="actions">
          <select data-status>${APPT_STATUSES.map((x) => `<option ${x === a.status ? "selected" : ""}>${x}</option>`).join("")}</select>
          <button class="mini" data-save>Save</button>
        </div>
      </article>`).join("") : `<p class="muted">No upcoming appointments.</p>`;
  }
  $("#appts-all").addEventListener("change", run(loadAppts));
  $("#appts-list").addEventListener("click", run(async (e) => {
    const card = e.target.closest(".appt");
    if (card && e.target.matches("[data-intake]")) {
      const box = $(".intake-view", card);
      if (!box.hidden) { box.hidden = true; return; }
      const d = await api("GET", `/api/admin/appointments/${card.dataset.id}/intake`);
      const row = (k, v) => v ? `<div><b>${k}</b><span>${esc(v)}</span></div>` : "";
      box.innerHTML = row("Focus", d.focus) + row("Pain", d.painLevel != null ? `${d.painLevel}/10` : "") + row("Pressure", d.pressure) + row("Goals", d.goals)
        + row("Conditions", (d.conditions || []).join(", ") || "None checked") + row("Medications", d.medications) + row("Allergies", d.allergies) + row("Other", d.other)
        + row("Emergency contact", [d.emergencyName, d.emergencyPhone].filter(Boolean).join(" · ")) + row("Signed", `${d.signature} · ${when(d.consentAt)}`);
      box.hidden = false; return;
    }
    if (!card || !e.target.matches("[data-save]")) return;
    const status = $("[data-status]", card).value;
    if (status === "cancelled" && !confirm("Cancel this appointment? The time opens up for booking again.")) return;
    await api("PATCH", `/api/admin/appointments/${card.dataset.id}`, { status, adminNotes: $("[data-notes]", card).value });
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
        provider: cf.provider.value, calUsername: cf.calUsername.value,
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
  }
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
        return { id, name, minutes: Number(minutes), description };
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
  function renderClients() {
    const q = $("#client-search").value.trim().toLowerCase();
    const rows = clientList.filter((c) => !q || [c.name, c.email, c.phone].join(" ").toLowerCase().includes(q));
    table($("#clients-table"), ["Client", "Phone", "Next visit", "Last pain log", "Plan", "Joined"], rows.map((c) => `
      <tr data-id="${c.id}" class="click-row"><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.email)}</span></td><td>${esc(c.phone)}</td>
        <td>${c.next ? `${fmtDate(c.next.date)} · ${fmtTime(c.next.time)}` : "—"}</td>
        <td>${c.lastPain ? `${esc(c.lastPain.area)} ${c.lastPain.level}/10 · ${fmtDate(c.lastPain.date)}` : "—"}</td>
        <td>${c.hasPlan ? "✓" : "—"}</td><td>${when(c.createdAt)}</td></tr>`),
      "No client accounts yet. Clients sign up at /login.");
  }
  $("#client-search").addEventListener("input", renderClients);
  $("#clients-table").addEventListener("click", run(async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (row) openClient(row.dataset.id);
  }));

  async function openClient(id) {
    const c = await api("GET", `/api/admin/clients/${id}`);
    const box = $("#client-detail");
    const p = c.plan;
    box.innerHTML = `
      <button type="button" class="mini" data-back>← All clients</button>
      <div class="client-head"><div><h2>${esc(c.name)}</h2>
        <p class="muted"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.phone ? ` · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""} · joined ${when(c.createdAt)}${c.lastLoginAt ? ` · last login ${when(c.lastLoginAt)}` : ""}</p></div>
        <div class="client-actions"><button type="button" class="mini" data-reset>Send reset code</button><button type="button" class="mini danger" data-delete>Delete account</button></div></div>
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
    $("[data-reset]", box).addEventListener("click", run(async () => {
      const r = await api("POST", `/api/admin/clients/${id}/send-reset-code`);
      toast(r.message);
    }));
    $("[data-delete]", box).addEventListener("click", run(async () => {
      if (!confirm(`Delete ${c.name}'s account? Their appointments stay; their plan and pain log are removed.`)) return;
      await api("DELETE", `/api/admin/clients/${id}`); toast("Account deleted."); loadClients();
    }));
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
      await api("PUT", `/api/admin/classes/${c.id}`, { capacity: Number(n) });
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
  async function loadThreads() {
    const d = await api("GET", "/api/admin/messages");
    const c = $("#admin-msg-count"); c.hidden = !d.unread; c.textContent = d.unread;
    $("#msg-threads").innerHTML = d.threads.length ? d.threads.map((t) => `
      <button type="button" class="msg-row${t.unread ? " unread" : ""}${t.clientId === openThread ? " on" : ""}" data-cid="${t.clientId}">
        <b>${esc(t.name)}</b>${t.unread ? `<span class="pill pending">${t.unread} new</span>` : ""}
        <small>${t.last.from === "doctor" ? "You: " : ""}${esc(t.last.body)}</small><small class="muted">${when(t.last.at)}${t.member ? "" : " · not a member"}</small></button>`).join("")
      : `<p class="muted">No messages yet. Members can message you from the app.</p>`;
    if (openThread) showThread(openThread);
  }
  async function showThread(cid) {
    openThread = cid;
    const d = await api("GET", `/api/admin/messages/${cid}`);
    $("#msg-thread").innerHTML = `<div class="item-head"><b>${esc(d.client.name)}</b> <span class="muted">${esc(d.client.email)} ${esc(d.client.phone || "")}</span> ${d.client.member ? `<span class="pill approved">${esc(d.client.tier)}</span>` : `<span class="pill hidden">not a member</span>`}</div>
      <div class="msg-log">${d.messages.map((m) => `<div class="mb ${m.from}" data-mid="${esc(m.id)}"><p>${esc(m.body).replace(/\n/g, "<br>")}</p><small>${m.from === "doctor" ? "You" : esc(d.client.name.split(" ")[0])} · ${when(m.at)}</small>${[m.reactions?.client, m.reactions?.doctor].filter(Boolean).length ? `<div class="reacts">${[m.reactions.client, m.reactions.doctor].filter(Boolean).map((x) => `<b>${x}</b>`).join("")}</div>` : ""}<div class="react-row">${["👍", "❤️", "😂", "🙏", "💪", "😮"].map((x) => `<button type="button" data-emoji="${x}" class="${m.reactions?.doctor === x ? "on" : ""}">${x}</button>`).join("")}</div></div>`).join("")}</div>
      <form class="msg-reply" id="msg-reply"><textarea name="body" rows="3" maxlength="2000" placeholder="Reply to ${esc(d.client.name.split(" ")[0])}…"></textarea><button class="btn btn-sm" type="submit">Send reply</button></form>`;
    const log = $(".msg-log"); log.scrollTop = log.scrollHeight;
    log.addEventListener("click", run(async (e) => {
      const btn = e.target.closest("[data-emoji]"), mb = e.target.closest("[data-mid]"); if (!btn || !mb) return;
      await api("POST", `/api/admin/messages/${cid}/${encodeURIComponent(mb.dataset.mid)}/react`, { emoji: btn.dataset.emoji }); showThread(cid);
    }));
    $$("#msg-threads .msg-row").forEach((r) => r.classList.toggle("on", r.dataset.cid === cid));
    $("#msg-reply").addEventListener("submit", run(async (e) => {
      e.preventDefault(); const body = e.target.body.value.trim(); if (!body) return;
      await api("POST", `/api/admin/messages/${cid}`, { body }); toast("Sent. They'll get an email that you replied."); showThread(cid);
    }));
  }
  $("#msg-threads").addEventListener("click", (e) => { const r = e.target.closest("[data-cid]"); if (r) { showThread(r.dataset.cid).then(loadThreads); } });
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
  $("#fb-filter-kind").addEventListener("change", loadFeedback);
  $("#fb-filter-status").addEventListener("change", loadFeedback);
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
      <label>Price per month ($)<input data-f="price" type="number" min="0" value="${x.price}"></label>
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
  function addRow(kind, x, c) {
    const row = document.createElement("div"); row.className = "crow"; row.dataset.id = x.id || ""; row.dataset.extra = JSON.stringify(kind === "programs" ? { days: x.days } : {});
    row.innerHTML = `<div class="crow-grid">${FIELDS[kind].html(x, c)}</div><button type="button" class="link svc-del" data-del-row>Remove</button>`;
    $("#rows-" + kind).append(row);
  }
  async function loadContent() {
    const c = await api("GET", "/api/admin/content");
    c.topics = ["Health", "Wellness", "Hormones", "Inflammation", "Pain science", "Nutrition", "Sleep & recovery"];
    c.categories = ["Hypertrophy", "Strength", "Anti-inflammatory", "Weight loss", "Mobility", "Rehabilitation", "Desk & posture", "Performance"];
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
      if (kind === "programs") o.days = o.days.split("\n").map((x) => x.trim()).filter(Boolean).map((line) => {
        const [name, goal = "full", length = "30", rounds = ""] = line.split("|").map((y) => y.trim());
        return { name, goal, length: Number(length), ...(rounds ? { rounds: Number(rounds) } : {}) };
      });
      return o;
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

  async function loadAnalytics() {
    const d = await api("GET", `/api/admin/analytics?days=${($("#an-range") || {}).value || 30}`);
    const s = d.summary;
    $("#analytics-stats").innerHTML = `
      <div class="stat"><b>${s.todayViews}</b><small>Views today</small></div>
      <div class="stat"><b>${s.todayUnique}</b><small>Visitors today</small></div>
      <div class="stat"><b>${s.totalViews}</b><small>Views (30d)</small></div>
      <div class="stat"><b>${s.totalUnique}</b><small>Visitors (30d)</small></div>`;
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
      <label>Rate ($/hr)<input data-f="rate" type="number" min="0" max="10000"></label>
      <label class="check"><input type="checkbox" data-f="protocol"> Protocol</label>
      <label class="svc-desc">Description<input data-f="description" maxlength="300"></label>
      <button type="button" class="link svc-del" aria-label="Remove service">Remove</button>`;
    row.dataset.id = v.id;
    $("[data-f=name]", row).value = v.name; $("[data-f=rate]", row).value = v.rate;
    $("[data-f=protocol]", row).checked = v.protocol; $("[data-f=description]", row).value = v.description;
    $(".svc-del", row).addEventListener("click", () => row.remove());
    $("#svc-rows").append(row);
  }
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
      return { id, name, rate: Number($("[data-f=rate]", r).value || 0), unit: "hour", protocol: $("[data-f=protocol]", r).checked, description: $("[data-f=description]", r).value.trim() };
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
