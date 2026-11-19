// MD Fit developer console (/dev): what is running, how the site and app are used, what the server recorded and
// what the system costs to run. One read from /api/admin/dev/overview: totals only, never a client or patient.
(() => {
  const API = window.MDFIT_CONFIG.apiUrl.replace(/\/+$/, "");
  const KEY = "mdfit_dev";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const usd = (c) => (c == null ? "—" : (c < 0 ? "−$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const thisMonth = () => new Date().toISOString().slice(0, 7);
  function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3200); }

  // ---- theme (remembered on this device)
  const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem("mdfit_dev_theme", t); } catch {} };
  try { const t = localStorage.getItem("mdfit_dev_theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
  $("#themeBtn").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  // ---- session (this tab only)
  const session = { get() { try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); return s && Date.parse(s.expiresAt) > Date.now() ? s : null; } catch { return null; } },
    set(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch {} idleStamp(); }, clear() { try { sessionStorage.removeItem(KEY); } catch {} } };
  // One staff sign-in is carried between the workspace, /admin-classic and the consoles in this tab, so signing out
  // of any of them removes every copy, and the 15 idle minutes (kept in the tab, shared by all of them) count here too.
  const STAFF_KEYS = ["mdfit_ws_token", "mdfit_token", "mdfit_manager", "mdfit_dev", "mdfit_staff_active"];
  const IDLE_MS = 15 * 60 * 1000, ACTIVE_KEY = "mdfit_staff_active"; let idleT = 0, lastStamp = 0;
  const idleStamp = () => { lastStamp = Date.now(); try { sessionStorage.setItem(ACTIVE_KEY, String(lastStamp)); } catch {} };
  const idleFor = () => { try { const t = Number(sessionStorage.getItem(ACTIVE_KEY)); return t ? Date.now() - t : 0; } catch { return 0; } };
  const idleOut = () => { signOut(); $("#siMsg").className = "msg"; $("#siMsg").textContent = "Signed out after 15 minutes without activity."; };
  function idleArm() { clearTimeout(idleT); if (session.get()) idleT = setTimeout(() => (idleFor() >= IDLE_MS ? idleOut() : idleArm()), Math.max(1000, IDLE_MS - idleFor())); }
  const idleBump = () => { if (!session.get()) return; if (idleFor() >= IDLE_MS) return idleOut(); if (Date.now() - lastStamp > 5000) idleStamp(); idleArm(); };
  // Signed out in the workspace (or idle too long) while this page was put aside: it must not come back still open
  const idleCheck = () => { if ($("#app").hidden) return; if (!session.get()) signOut(); else if (idleFor() >= IDLE_MS) idleOut(); };
  ["pointerdown", "keydown", "scroll"].forEach((ev) => window.addEventListener(ev, idleBump, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) idleCheck(); });
  window.addEventListener("pageshow", idleCheck); window.addEventListener("focus", idleCheck);
  async function api(method, path, body) {
    const s = session.get();
    const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(s ? { Authorization: "Bearer " + s.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && path !== "/api/admin/login") { signOut(); throw new Error("Session expired. Sign in again."); }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    if (!res.ok) { const e = new Error((data && data.error) || "Request failed."); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  // The server ends a staff session after 15 minutes without a request and at sign-out (see README: DO NOT TOUCH).
  // While this page is being used, it says so every few minutes; signing out ends the session on the server.
  let beatAt = Date.now();
  const beat = () => { const s = session.get(); if (!s || Date.now() - beatAt < 4 * 60 * 1000) return; beatAt = Date.now(); fetch(API + "/api/admin/me", { headers: { Authorization: "Bearer " + s.token } }).then((r) => { if (r.status === 401) signOut(); }).catch(() => {}); };
  ["pointerdown", "keydown", "scroll"].forEach((ev) => window.addEventListener(ev, beat, { passive: true, capture: true }));
  const endSession = () => { const s = session.get(); if (s) { try { fetch(API + "/api/admin/logout", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.token }, body: "{}" }).catch(() => {}); } catch {} } };
  function signOut() { clearTimeout(idleT); session.clear(); try { STAFF_KEYS.forEach((k) => sessionStorage.removeItem(k)); } catch {} show(false); }
  $("#signOut").addEventListener("click", () => { endSession(); signOut(); });

  // ---- sign in: password, or Google (the address must be the Manager account's; the emailed code still applies)
  let gCred = "";
  async function googleIn(code) {
    const msg = $("#siMsg"), f = $("#signinForm"); msg.className = "msg"; msg.textContent = "Signing in…";
    try { const r = await api("POST", "/api/admin/login/google", { credential: gCred, ...(code ? { code } : {}) }); gCred = ""; session.set(r); f.reset(); msg.textContent = ""; await boot(); }
    catch (err) { if (err.data && err.data.mfaRequired) { $("#siCodeRow").hidden = false; f.code.focus(); } else gCred = ""; msg.className = "msg err"; msg.textContent = err.message; }
  }
  fetch(API + "/api/app/config").then((r) => r.json()).then((c) => {
    if (!c || !c.googleClientId) return;
    const sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client"; sc.async = true;
    sc.onload = () => {
      google.accounts.id.initialize({ client_id: c.googleClientId, callback: (resp) => { gCred = resp.credential; googleIn(""); } });
      $("#siGoogleWrap").hidden = false;
      google.accounts.id.renderButton($("#siGoogle"), { theme: "outline", size: "large", width: 320, text: "signin_with" });
    };
    document.head.appendChild(sc);
  }).catch(() => {});
  $("#signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#siMsg"); msg.className = "msg"; msg.textContent = "Signing in…";
    if (gCred && !f.password.value && f.code.value.trim()) return googleIn(f.code.value.trim());
    try {
      const r = await api("POST", "/api/admin/login", { email: f.email.value.trim(), password: f.password.value, ...(f.code.value.trim() ? { code: f.code.value.trim() } : {}) });
      session.set(r); f.password.value = ""; f.code.value = ""; msg.textContent = "";
      await boot();
    } catch (err) {
      if (err.data && err.data.mfaRequired) $("#siCodeRow").hidden = false;
      msg.className = "msg err"; msg.textContent = err.message;
    }
  });

  // ---- to the client management portal with the same sign-in (same tab, same token: no second password)
  const PORTALS = [[["admin"], "/workspace", "mdfit_ws_token", "Admin"], [["manager"], "/manager", "mdfit_manager", "Manager"], [["manager", "developer"], "/dev", "mdfit_dev", "Developer"], [null, "/workspace#clients", "mdfit_ws_token", "Client portal"]];
  function drawSwitch(me) {
    const roles = (me && (me.roles || [me.role])) || [], owner = !!(me && (me.isOwner || me.role === "owner"));
    const partner = owner || ((me && me.permissions) || []).includes("partner"); // /manager also needs the Partner console permission
    $("#switch").innerHTML = PORTALS.filter(([need, , key]) => key === KEY || !need || owner || (need.some((r) => roles.includes(r)) && (key !== "mdfit_manager" || partner)))
      .map(([, href, key, label]) => `<a href="${href}" data-key="${key}"${key === KEY ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  }
  $("#switch").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-key]"), s = session.get(); if (!a) return;
    if (!s || a.dataset.key === KEY) { e.preventDefault(); if (!s) signOut(); return; } // signed out meanwhile: nothing is handed across
    try {
      if (a.dataset.key === "mdfit_ws_token") { sessionStorage.setItem("mdfit_ws_token", s.token); sessionStorage.setItem("mdfit_staff_active", String(Date.now())); }
      else sessionStorage.setItem(a.dataset.key, JSON.stringify({ token: s.token, expiresAt: s.expiresAt }));
    } catch {}
  });

  // ---- shell
  let state = { tab: "overview", days: 30, data: null };
  function show(signedIn) { $("#signin").hidden = signedIn; $("#app").hidden = !signedIn; $("#signOut").hidden = !signedIn; $("#who").hidden = !signedIn; $("#switch").hidden = !signedIn; }
  const none = (t) => `<p class="muted" style="margin:0">${esc(t)}</p>`;
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const bars = (rows, key, label) => { const max = Math.max(1, ...rows.map((r) => r[key])); return rows.length ? `<div style="display:flex;align-items:flex-end;gap:2px;height:120px" role="img" aria-label="${esc(label)}: ${esc(rows.map((r) => `${r.date} ${r[key]}`).join(", "))}">${rows.map((r) => `<div title="${esc(r.date)}: ${num(r[key])}" style="flex:1;min-width:2px;background:var(--accent,#7AAFD7);border-radius:2px 2px 0 0;height:${Math.max(2, Math.round((r[key] / max) * 100))}%"></div>`).join("")}</div>` : none("Nothing in this period."); };
  const table = (head, rows) => `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>${head.map((h, i) => `<th style="text-align:${i ? "right" : "left"};padding:6px 8px;font-size:12px" class="muted">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i ? "right" : "left"};padding:6px 8px;border-top:1px solid var(--line,#e3e8ee)">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const card = (title, inner, side = "") => `<section class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px"><h2 style="margin:0;font-size:17px">${esc(title)}</h2><span class="muted" style="font-size:12px">${side}</span></div>${inner}</section>`;
  const stat = (label, val, sub = "") => `<div class="card" style="flex:1;min-width:140px"><div class="muted" style="font-size:12px">${esc(label)}</div><div style="font-size:24px;font-weight:700">${val}</div>${sub ? `<div class="muted" style="font-size:12px">${esc(sub)}</div>` : ""}</div>`;
  const pick = () => `<div style="display:flex;gap:6px;margin-bottom:14px" role="group" aria-label="Days shown">${[7, 30, 90].map((n) => `<button type="button" class="btn sm" data-days="${n}" aria-pressed="${state.days === n}"${state.days === n ? ' style="font-weight:700"' : ""}>${n} days</button>`).join("")}</div>`;

  const VIEWS = {
    overview: (d) => `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        ${stat("Site visits", num(d.usage.views), `${num(d.usage.unique)} visitors, last ${d.days} days`)}
        ${stat("Accounts", num(d.usage.accounts.total), `${num(d.usage.accounts.joined)} joined, ${num(d.usage.accounts.signedIn)} signed in`)}
        ${stat("Server events", num(d.activity.total), `last ${d.days} days`)}
        ${stat("Running cost", usd(d.spending.monthly), "a month, as the owner entered it")}</div>
      ${card("System", table(["", ""], [["Deployed commit", esc(d.system.commit || "not reported")], ["Running since", esc(when(d.system.startedAt))], ["Up for", `${num(d.system.uptimeMinutes)} min`], ["Memory", `${num(d.system.memoryMb)} MB`], ["Node", esc(d.system.node)]]))}
      ${card("What this console shows", `<p class="muted" style="margin:0">Totals only. No name, email, chart or message from any client or patient is sent to this page.</p>`)}`,
    usage: (d) => pick() + card("Site visits by day", bars(d.usage.visits, "views", "Visits by day"), `${num(d.usage.views)} views`) +
      card("Most-read pages", d.usage.pages.length ? table(["Page", "Views"], d.usage.pages.map((p) => [esc(p.page), num(p.views)])) : none("No page views recorded yet."), "all time") +
      card("Accounts", table(["", ""], [["All accounts", num(d.usage.accounts.total)], [`Joined in the last ${d.days} days`, num(d.usage.accounts.joined)], [`Signed in in the last ${d.days} days`, num(d.usage.accounts.signedIn)], ["With a membership", num(d.usage.accounts.members)]])),
    activity: (d) => pick() + card("Server events by day", bars(d.activity.byDay, "count", "Events by day"), `${num(d.activity.total)} events`) +
      card("By kind", d.activity.byType.length ? table(["Event", "Count"], d.activity.byType.map((x) => [esc(x.type), num(x.count)])) : none("No events in this period."), "counts only"),
    spending: (d) => card("What the system costs to run", d.spending.lines.length ? table(["Cost", "A month"], [...d.spending.lines.map((x) => [esc(x.name), usd(x.monthly)]), ["<b>Total</b>", `<b>${usd(d.spending.monthly)}</b>`]]) : none("The owner has not entered any system costs yet (workspace, System economics)."), "entered by the owner") +
      card("Not shown here", `<p class="muted" style="margin:0">The practice's other expenses, revenue and anyone's payments stay in the workspace.</p>`),
    logs: () => card("Railway and Vercel logs", `<p class="muted" style="margin:0">Server and site logs will open here in a later release. Until then they are in the Railway and Vercel dashboards.</p>`)
  };
  async function render() {
    $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    const view = $("#view");
    try {
      if (!state.data || state.data.days !== state.days) { view.innerHTML = none("Loading…"); state.data = await api("GET", `/api/admin/dev/overview?days=${state.days}`); }
      view.innerHTML = VIEWS[state.tab](state.data);
    } catch (e) { view.innerHTML = card("Not available", `<p style="margin:0">${esc(e.message)}</p>`); }
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".tab"); if (t) { state.tab = t.dataset.tab; try { history.replaceState(null, "", "#" + state.tab); } catch {} render(); return; }
    const d = e.target.closest("[data-days]"); if (d) { state.days = Number(d.dataset.days); render(); }
  });
  async function boot() {
    if (!session.get()) return show(false);
    if (idleFor() >= IDLE_MS) return idleOut();
    if (!idleFor()) idleStamp(); idleArm();
    try {
      const me = await api("GET", "/api/admin/me");
      $("#whoName").textContent = `${me.name || me.email} · ${me.isOwner ? "Owner" : "Developer"}`;
      drawSwitch(me); show(true);
      const h = location.hash.slice(1); if (VIEWS[h]) state.tab = h;
      await render();
    } catch { show(false); }
  }
  boot();
})();
