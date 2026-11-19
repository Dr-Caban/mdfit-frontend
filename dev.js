// MD Fit developer console (/dev): what is running, how the site and app are used, what the server recorded, what
// the system costs to run, and the logs. /api/admin/dev/overview is totals only, never a client or patient; the
// server's own log (/api/admin/logs*) is the practice owner's to read, and the page says so when it is refused.
// The platform overview panel itself is shared with /admin and /manager — platform.js.
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
    set(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch {} }, clear() { try { sessionStorage.removeItem(KEY); } catch {} } };
  async function api(method, path, body) {
    const s = session.get();
    const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(s ? { Authorization: "Bearer " + s.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && path !== "/api/admin/login") { signOut(); throw new Error("Session expired. Sign in again."); }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    if (!res.ok) { const e = new Error((data && data.error) || "Request failed."); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  function signOut() { session.clear(); show(false); }
  $("#signOut").addEventListener("click", signOut);

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

  // The switch in the header: everywhere this sign-in can go, with the same sign-in carried across (same tab, same
  // token, no second password). The list itself is MDFitPlatform.consoles, shared with the other two consoles.
  // Nothing to switch to means no switch at all.
  function drawSwitch(me) {
    const places = window.MDFitPlatform ? MDFitPlatform.consoles(me) : [];
    const seg = $("#switch");
    seg.innerHTML = places.map((x) => `<a href="${x.href}" data-key="${x.key}"${x.key === KEY ? ' aria-current="page"' : ""}>${esc(x.label)}</a>`).join("");
    seg.dataset.count = String(places.length);
  }
  // Any link marked with a console's storage key hands this sign-in over, wherever it sits on the page
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-key]"), s = session.get(); if (!a || !s) return;
    if (a.dataset.key === KEY) { e.preventDefault(); return; }
    try {
      if (a.dataset.key === "mdfit_ws_token") { sessionStorage.setItem("mdfit_ws_token", s.token); sessionStorage.setItem("mdfit_staff_active", String(Date.now())); }
      else sessionStorage.setItem(a.dataset.key, JSON.stringify({ token: s.token, expiresAt: s.expiresAt }));
    } catch {}
  });

  // ---- shell
  let state = { tab: "platform", days: 30, data: null, me: null };
  function show(signedIn) { $("#signin").hidden = signedIn; $("#app").hidden = !signedIn; $("#signOut").hidden = !signedIn; $("#who").hidden = !signedIn; $("#switch").hidden = !signedIn || Number($("#switch").dataset.count || 0) < 2; }
  const none = (t) => `<p class="muted" style="margin:0">${esc(t)}</p>`;
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const bars = (rows, key, label) => { const max = Math.max(1, ...rows.map((r) => r[key])); return rows.length ? `<div style="display:flex;align-items:flex-end;gap:2px;height:120px" role="img" aria-label="${esc(label)}: ${esc(rows.map((r) => `${r.date} ${r[key]}`).join(", "))}">${rows.map((r) => `<div title="${esc(r.date)}: ${num(r[key])}" style="flex:1;min-width:2px;background:var(--accent,#7AAFD7);border-radius:2px 2px 0 0;height:${Math.max(2, Math.round((r[key] / max) * 100))}%"></div>`).join("")}</div>` : none("Nothing in this period."); };
  const table = (head, rows) => `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>${head.map((h, i) => `<th style="text-align:${i ? "right" : "left"};padding:6px 8px;font-size:12px" class="muted">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i ? "right" : "left"};padding:6px 8px;border-top:1px solid var(--line,#e3e8ee)">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const card = (title, inner, side = "") => `<section class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px"><h2 style="margin:0;font-size:17px">${esc(title)}</h2><span class="muted" style="font-size:12px">${side}</span></div>${inner}</section>`;
  const stat = (label, val, sub = "") => `<div class="card" style="flex:1;min-width:140px"><div class="muted" style="font-size:12px">${esc(label)}</div><div style="font-size:24px;font-weight:700">${val}</div>${sub ? `<div class="muted" style="font-size:12px">${esc(sub)}</div>` : ""}</div>`;
  const pick = () => `<div style="display:flex;gap:6px;margin-bottom:14px" role="group" aria-label="Days shown">${[7, 30, 90].map((n) => `<button type="button" class="btn sm" data-days="${n}" aria-pressed="${state.days === n}"${state.days === n ? ' style="font-weight:700"' : ""}>${n} days</button>`).join("")}</div>`;

  // ---- the server's own log (owner only; 403 is an answer, not a failure)
  const LG = { days: null, summary: null, date: "", level: "", q: "", qDraft: "", limit: 500, sig: "", page: null };
  const today = () => new Date().toISOString().slice(0, 10);
  const soft = async (path) => { try { return await api("GET", path); } catch (e) { return e.status === 403 ? { denied: true } : { error: e.message }; } };
  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour12: false }) : "—");
  const LEVEL_PILL = { error: "bad", warn: "warn", info: "", debug: "" };
  const bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  // One line as it reads: the request it was, or the event it was, and whatever else the server wrote with it
  function logLine(e) {
    const { time, level, msg, method, path, status, ms, ...rest } = e;
    const head = msg === "request" ? `${esc(method || "")} ${esc(path || "")}` : `<b>${esc(msg || "—")}</b>`;
    const tail = msg === "request" ? `<span class="pill ${status >= 500 ? "bad" : status >= 400 ? "warn" : "ok"}">${esc(String(status ?? "—"))}</span> <span class="muted">${esc(String(ms ?? "—"))} ms</span>` : "";
    const extra = Object.keys(rest).length ? `<div class="muted" style="font-size:12px">${esc(Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("  "))}</div>` : "";
    return `<tr><td style="padding:6px 8px;border-top:1px solid var(--line);white-space:nowrap" class="muted">${esc(clock(time))}</td>
      <td style="padding:6px 8px;border-top:1px solid var(--line)"><span class="pill ${LEVEL_PILL[level] || ""}">${esc(level || "—")}</span></td>
      <td style="padding:6px 8px;border-top:1px solid var(--line)">${head}${extra}</td>
      <td style="padding:6px 8px;border-top:1px solid var(--line);text-align:right;white-space:nowrap">${tail}</td></tr>`;
  }
  const ndjson = () => ((LG.page && LG.page.entries) || []).map((e) => JSON.stringify(e)).join("\n");
  async function logsDownload() {
    const s = session.get(); if (!s) return;
    const res = await fetch(`${API}/api/admin/logs/download?date=${encodeURIComponent(LG.date)}`, { headers: { Authorization: "Bearer " + s.token } });
    if (!res.ok) return toast(res.status === 403 ? "The log file is the practice owner's to download." : "That day could not be downloaded.");
    const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
    a.href = url; a.download = `mdfit-activity-${LG.date}.jsonl`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Downloaded. It is one JSON object per line.");
  }

  const VIEWS = {
    platform: (d) => (window.MDFitPlatform
      ? MDFitPlatform.overview({ d, me: state.me, logs: LG.summary, where: "dev" })
      : card("Platform", none("The overview could not be loaded."))),
    usage: (d) => pick() + card("Site visits by day", bars(d.usage.visits, "views", "Visits by day"), `${num(d.usage.views)} views`) +
      card("Most-read pages", d.usage.pages.length ? table(["Page", "Views"], d.usage.pages.map((p) => [esc(p.page), num(p.views)])) : none("No page views recorded yet."), "all time") +
      card("Accounts", table(["", ""], [["All accounts", num(d.usage.accounts.total)], [`Joined in the last ${d.days} days`, num(d.usage.accounts.joined)], [`Signed in in the last ${d.days} days`, num(d.usage.accounts.signedIn)], ["With a membership", num(d.usage.accounts.members)]])),
    activity: (d) => pick() + card("Server events by day", bars(d.activity.byDay, "count", "Events by day"), `${num(d.activity.total)} events`) +
      card("By kind", d.activity.byType.length ? table(["Event", "Count"], d.activity.byType.map((x) => [esc(x.type), num(x.count)])) : none("No events in this period."), "counts only"),
    spending: (d) => card("What the system costs to run", d.spending.lines.length ? table(["Cost", "A month"], [...d.spending.lines.map((x) => [esc(x.name), usd(x.monthly)]), ["<b>Total</b>", `<b>${usd(d.spending.monthly)}</b>`]]) : none("The owner has not entered any system costs yet (workspace, System economics)."), "entered by the owner") +
      card("Not shown here", `<p class="muted" style="margin:0">The practice's other expenses, revenue and anyone's payments stay in the workspace.</p>`),
    logs: () => {
      const f = (window.MDFitPlatform && MDFitPlatform.faults.list()) || [];
      const browser = card("This browser", (f.length
        ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${f.slice().reverse().map((x) => `<tr>
            <td class="muted" style="padding:6px 8px;border-top:1px solid var(--line);white-space:nowrap">${esc(when(x.t))}</td>
            <td style="padding:6px 8px;border-top:1px solid var(--line)"><span class="pill ${x.kind === "console" ? "warn" : "bad"}">${esc(x.kind)}</span></td>
            <td style="padding:6px 8px;border-top:1px solid var(--line)">${esc(x.msg)}${x.at ? `<div class="muted" style="font-size:12px">${esc(x.at)}</div>` : ""}${x.again ? `<div class="muted" style="font-size:12px">happened ${num(x.again)} times</div>` : ""}<div class="muted" style="font-size:12px">${esc(x.page || "")}</div></td></tr>`).join("")}</tbody></table></div>
          <div class="row" style="margin-top:12px"><button class="btn" type="button" data-plat="copyFaults">Copy these faults</button><button class="btn" type="button" data-plat="clearFaults">Clear</button></div>`
        : `<p class="muted" style="margin:0">Nothing has gone wrong in this browser since it was last cleared.</p>`),
        "what the JavaScript console would have shown");
      const shut = !!(LG.days && (LG.days.denied || LG.days.error));
      const notes = card("Railway, Vercel and this browser", `
        <p class="muted" style="margin:0 0 8px">${shut ? "For the container's own messages and the site's builds, and for the same lines over the last 7 days:" : "The lines above are the server's own, kept here for 90 days — longer than Railway keeps them. For the container's own messages and the site's builds:"}</p>
        <div class="row"><a class="btn" href="${MDFitPlatform.RAILWAY}" target="_blank" rel="noopener">Railway → Deployments → Logs</a>
          <a class="btn" href="${MDFitPlatform.VERCEL}" target="_blank" rel="noopener">Vercel → Deployments</a>
          <button class="btn" type="button" data-plat="copy">Copy a platform summary</button></div>
        <p class="muted" style="margin:10px 0 0;font-size:12px">Faults in a member's own browser are not collected here: only what happens in the browser you are reading this in.</p>`);

      if (LG.days && LG.days.denied) return card("The server log", `<p style="margin:0 0 6px">This is the practice owner's to read.</p>
        <p class="muted" style="margin:0">Each line carries the request's path, which can name a client's record, so the log is not sent to a Manager or Developer sign-in. The failure counts and the busiest paths are on the Platform tab, and Railway shows the same lines for the last 7 days.</p>`) + browser + notes;
      if (LG.days && LG.days.error) return card("The server log", `<p style="margin:0">It could not be read: ${esc(LG.days.error)}</p>`) + browser + notes;

      const kept = (LG.days && LG.days.keep) || [];
      const p = LG.page || { entries: [], total: 0, matched: 0, unreadable: 0 };
      const sum = LG.summary && LG.summary.totals ? LG.summary : null;
      const faults = sum ? (sum.totals.s5xx || 0) + (sum.totals.error || 0) : null;
      const warns = sum ? sum.totals.warn || 0 : 0;

      let failing = "";
      if (sum) {
        const byDay = sum.perDay.length
          ? table(["Day", "Requests", "4xx", "5xx", "Warnings", "Errors", "Restarts"], sum.perDay.slice().reverse().map((x) => [esc(x.date), num(x.requests), num(x.s4xx), x.s5xx ? `<b>${num(x.s5xx)}</b>` : "0", num(x.warn), x.error ? `<b>${num(x.error)}</b>` : "0", num(x.restarts)]))
          : none("Nothing written yet.");
        const where = (sum.totals.errorPaths || []).length
          ? `<p class="muted small" style="margin:12px 0 4px">Where it failed</p>` + table(["Request", "Faults"], sum.totals.errorPaths.map((x) => [esc(x.key), num(x.count)]))
          : "";
        // The warnings are where the real trouble usually shows: a media upload that would not go up, a key refused
        const events = (sum.totals.events || []).length
          ? `<p class="muted small" style="margin:12px 0 4px">What the server reported, besides requests</p>` + table(["Event", "Times"], sum.totals.events.slice(0, 12).map((x) => [esc(x.key), num(x.count)]))
          : "";
        failing = card("Faults by day", byDay + where + events,
          `<span class="pill ${faults ? "bad" : warns ? "warn" : "ok"}">${faults ? `${num(faults)} in ${num(sum.days)} days` : warns ? `none, ${num(warns)} warnings in ${num(sum.days)} days` : `none in ${num(sum.days)} days`}</span>`);
      }

      const controls = `<div class="row" style="margin-bottom:10px">
        <label class="muted small" for="logDate">Day</label>
        <select class="input" id="logDate" data-log="date" style="width:auto">${(kept.length ? kept : [{ date: LG.date, bytes: 0 }]).slice().reverse().map((x) => `<option value="${esc(x.date)}"${x.date === LG.date ? " selected" : ""}>${esc(x.date)}${x.bytes ? ` · ${esc(bytes(x.bytes))}` : ""}</option>`).join("")}</select>
        ${[["", "Everything"], ["error", "Errors"], ["warn", "Warnings"], ["info", "Requests"]].map(([v, l]) => `<button class="btn sm" type="button" data-log="level" data-v="${v}" aria-pressed="${LG.level === v}"${LG.level === v ? ' style="font-weight:700"' : ""}>${l}</button>`).join("")}
        <input class="input" id="logQ" data-log="qbox" value="${esc(LG.qDraft)}" placeholder="Find in the lines: a path like /presence, a status, a word" style="flex:1;min-width:180px">
        <button class="btn sm" type="button" data-log="search">Search</button>${LG.q ? `<button class="btn sm" type="button" data-log="clearq">Clear</button>` : ""}
      </div>`;

      return failing + card("The server log", controls + (p.entries.length
          ? `<div style="overflow-x:auto;max-height:70vh;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${p.entries.map(logLine).join("")}</tbody></table></div>`
          : none(LG.q || LG.level ? "No line on this day matches." : "Nothing was written on this day.")) +
        `<div class="row" style="margin-top:12px"><button class="btn" type="button" data-log="copy"${p.entries.length ? "" : " disabled"}>Copy these lines</button>
          <button class="btn" type="button" data-log="download">Download the day</button>
          ${LG.limit === 500 ? `<button class="btn sm" type="button" data-log="more">Show up to 5,000</button>` : ""}
          <span class="muted small">${num(p.matched)} of ${num(p.total)} lines${p.unreadable ? `, ${num(p.unreadable)} unreadable` : ""}${LG.days && LG.days.encrypted ? " · encrypted on the server's disk" : ""}</span></div>`,
        `${esc(LG.date)}`) + browser + notes;
    }
  };
  async function render() {
    $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    const view = $("#view");
    try {
      if (!state.data || state.data.days !== state.days) { view.innerHTML = none("Loading…"); state.data = await api("GET", `/api/admin/dev/overview?days=${state.days}`); }
      // the failure counts: the platform panel shows the headline, the Logs tab the day-by-day
      if ((state.tab === "platform" || state.tab === "logs") && !LG.summary) LG.summary = await soft("/api/admin/logs/summary?days=21");
      if (state.tab === "logs") {
        if (!LG.days) LG.days = await soft("/api/admin/logs/days");
        if (!LG.days.denied && !LG.days.error) {
          if (!LG.date) { const k = LG.days.keep || []; LG.date = k.length ? k[k.length - 1].date : today(); }
          const sig = [LG.date, LG.level, LG.q, LG.limit].join("|");
          if (LG.sig !== sig) {
            LG.sig = sig; if (!LG.page) view.innerHTML = none("Reading the log…");
            const r = await soft(`/api/admin/logs?date=${encodeURIComponent(LG.date)}&level=${encodeURIComponent(LG.level)}&q=${encodeURIComponent(LG.q)}&limit=${LG.limit}`);
            LG.page = r.entries ? r : { entries: [], total: 0, matched: 0, unreadable: 0 };
          }
        }
      }
      view.innerHTML = VIEWS[state.tab](state.data);
    } catch (e) { view.innerHTML = card("Not available", `<p style="margin:0">${esc(e.message)}</p>`); }
  }
  // ---- the log's own controls
  function logAct(el) {
    const what = el.dataset.log;
    if (what === "level") { LG.level = el.dataset.v; return render(); }
    if (what === "search") { LG.q = ($("#logQ").value || "").trim(); LG.qDraft = LG.q; return render(); }
    if (what === "clearq") { LG.q = LG.qDraft = ""; return render(); }
    if (what === "more") { LG.limit = 5000; return render(); }
    if (what === "download") return logsDownload();
    if (what === "copy") {
      const text = ndjson();
      return navigator.clipboard.writeText(text).then(() => toast(`Copied ${num((LG.page.entries || []).length)} lines. One JSON object per line.`),
        () => toast("Couldn't copy. Use Download the day instead."));
    }
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".tab"); if (t) { state.tab = t.dataset.tab; try { history.replaceState(null, "", "#" + state.tab); } catch {} render(); return; }
    const p = e.target.closest("[data-plat]"); if (p) { MDFitPlatform.onClick(e).then((m) => m && toast(m)); return; }
    const l = e.target.closest("[data-log]"); if (l) { logAct(l); return; }
    const d = e.target.closest("[data-days]"); if (d) { state.days = Number(d.dataset.days); render(); }
  });
  document.addEventListener("change", (e) => { const s = e.target.closest('[data-log="date"]'); if (s) { LG.date = s.value; render(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "logQ") { e.preventDefault(); LG.q = LG.qDraft = e.target.value.trim(); render(); } });
  document.addEventListener("input", (e) => { if (e.target.id === "logQ") LG.qDraft = e.target.value; });
  async function boot() {
    if (!session.get()) return show(false);
    try {
      const me = await api("GET", "/api/admin/me");
      state.me = me;
      $("#whoName").textContent = `${me.name || me.email} · ${me.isOwner ? "Owner" : "Developer"}`;
      drawSwitch(me); show(true);
      let h = location.hash.slice(1); if (h === "overview") h = "platform"; if (VIEWS[h]) state.tab = h;
      await render();
    } catch { show(false); }
  }
  boot();
})();
