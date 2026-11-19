// MD Fit Manager console (/manager): the manager's revenue share, payment notices, statements, PATF partners and
// their own Stripe Express payouts account (Connect embedded components). Talks to /api/admin/partner/*, which only
// the manager named by the owner (or the owner) can read. The API never sends patient data here.
(() => {
  const API = window.MDFIT_CONFIG.apiUrl.replace(/\/+$/, "");
  const KEY = "mdfit_manager";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const usd = (c) => (c == null ? "—" : (c < 0 ? "−$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const thisMonth = () => new Date().toISOString().slice(0, 7);
  function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3200); }

  // ---- theme (remembered on this device)
  const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem("mdfit_manager_theme", t); } catch {} };
  try { const t = localStorage.getItem("mdfit_manager_theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
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
  // Signing out ends this sign-in on the server too, so a copy of it kept anywhere stops working at once
  const endSignIn = (t) => { if (!t) return; try { fetch(API + "/api/admin/me/logout", { method: "POST", headers: { Authorization: "Bearer " + t }, keepalive: true }).catch(() => {}); } catch {} };
  function signOut() { endSignIn((session.get() || {}).token); clearTimeout(idleT); try { STAFF_KEYS.forEach((k) => sessionStorage.removeItem(k)); } catch {} connectP = null; show(false); }
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

  // ---- shell
  let state = { tab: "share", month: thisMonth(), share: null };
  // To the client management portal with the same sign-in (same tab, same token: no second password)
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
  function show(signedIn) {
    $("#signin").hidden = signedIn; $("#app").hidden = !signedIn; $("#signOut").hidden = !signedIn; $("#who").hidden = !signedIn; $("#switch").hidden = !signedIn;
  }
  async function boot() {
    if (!session.get()) return show(false);
    if (idleFor() >= IDLE_MS) return idleOut();
    if (!idleFor()) idleStamp(); idleArm();
    try {
      const me = await api("GET", "/api/admin/me").catch(() => null);
      state.share = await api("GET", "/api/admin/partner/share");
      $("#whoName").textContent = me ? `${me.name || me.email}${me.isOwner || me.role === "owner" ? " · Owner, view only" : (me.roles || [me.role]).includes("manager") ? " · Manager" + (state.share && state.share.viewOnly ? ", view only" : "") : me.role ? " · " + me.role : ""}` : "";
      drawSwitch(me); show(true);
      const h = (location.hash || "").slice(1);
      if (["share", "statement", "partners", "payouts"].includes(h)) state.tab = h;
      render();
    } catch (e) {
      show(false);
      $("#siMsg").className = "msg err";
      $("#siMsg").textContent = e.message;
      if (e.status === 403) session.clear();
    }
  }
  $$(".tab").forEach((b) => b.addEventListener("click", () => { state.tab = b.dataset.tab; history.replaceState(null, "", "#" + state.tab); render(); }));
  async function render() {
    $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    const v = $("#view");
    try { v.innerHTML = await VIEWS[state.tab](); WIRE[state.tab] && WIRE[state.tab](); }
    catch (e) { v.innerHTML = `<div class="card"><p class="msg err">${esc(e.message)}</p></div>`; }
  }

  const statusPill = (s) => `<span class="pill ${s === "paid" ? "ok" : s === "ready" ? "" : s === "reversed" ? "bad" : "warn"}">${esc({ pending: "Pending", ready: "Payout ready", paid: "Paid", reversed: "Reversed" }[s] || s)}</span>`;
  const kpi = (label, val, sub) => `<div class="card kpi"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;

  const VIEWS = {
    // ---------- Revenue share: balances, how it's paid, notices to accept, every share
    async share() {
      const d = state.share = await api("GET", "/api/admin/partner/share"), b = d.balances;
      const open = d.notices.filter((n) => !n.acceptedAt);
      return `<h1>Revenue share</h1><p class="muted">${esc(d.pct)}% of MD Fit Online Net Revenue (${d.status === "active" ? "active" : "continuing"}), under Section 4 of the ${esc(d.agreement)}. Net Revenue is what was paid, less sales tax, Stripe's fee and refunds.</p>
        ${d.enabled ? "" : `<div class="card"><b>Not switched on yet.</b> <span class="muted">The owner turns the revenue share on in the workspace.</span></div>`}
        <div class="grid g4">${kpi("Pending", usd(b.pendingCents), "until Stripe clears each payment")}${kpi("Payout ready", usd(b.readyCents), d.autoPay ? "paid automatically" : "paid by the owner")}${kpi("Paid", usd(b.paidCents), "to your Stripe account")}${kpi("Your share", `${esc(d.pct)}%`, `${esc(d.activePct)}% active · ${esc(d.continuingPct)}% continuing`)}</div>
        <div class="card"><div class="card-head"><h2>How you're paid</h2>${d.autoPay ? '<span class="pill ok">Automatic</span>' : '<span class="pill">Owner pays</span>'}</div>
          <p style="margin:0">${d.autoPay ? `Each share is paid to your Stripe account as soon as its payment clears in Stripe. The owner switched this on ${esc(day(d.autoPayOnAt))}.` : "Shares become payout ready as their payments clear in Stripe. The owner pays them from the workspace. Automatic payouts as each payment clears start when the owner switches them on (the agreement says monthly, Section 4.8)."}</p>
          ${d.stripe.payoutsEnabled ? "" : `<p class="msg" style="margin-top:8px">Your Stripe payouts account isn't ready yet. <a href="#payouts" data-goto="payouts">Set it up</a>.</p>`}</div>
        <div class="card"><div class="card-head"><h2>Payment notices</h2><span class="muted small">${open.length ? `${open.length} to accept` : "all accepted"}</span></div>
          ${d.notices.length ? d.notices.map((n) => `<div class="notice ${n.acceptedAt ? "" : "new"}"><div class="row" style="justify-content:space-between"><b>${usd(n.cents)} · ${esc(day(n.ts))}</b>${n.acceptedAt ? `<span class="pill ok">Accepted ${esc(day(n.acceptedAt))}</span>` : '<span class="pill warn">To accept</span>'}</div>
            <p>${esc(n.text)}</p><div class="row"><span class="muted small">Transfer <span class="code">${esc(n.transferId)}</span></span>${n.acceptedAt ? "" : `<button class="btn sm primary" data-accept="${esc(n.id)}">Accept</button>`}</div></div>`).join("") : '<p class="empty">No payouts yet. A notice appears here with each one.</p>'}</div>
        <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Every share</h2><span class="muted small">Products and amounts only</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Category</th><th class="num">Paid</th><th class="num">Tax</th><th class="num">Stripe fee</th><th class="num">Refunded</th><th class="num">Net</th><th class="num">%</th><th class="num">Share</th><th>Status</th></tr></thead><tbody>
          ${d.ledger.map((r) => `<tr><td>${esc(day(r.ts))}</td><td>${esc(r.kind === "clawback" ? r.product + " (refund)" : r.product)}${r.viaPartner ? `<div class="muted small">via ${esc(r.viaPartner)}</div>` : ""}</td><td>${esc(r.category === "online" ? "MD Fit Online" : r.category)}</td><td class="num">${usd(r.grossCents)}</td><td class="num">${usd(r.taxCents)}</td><td class="num">${r.feeCents == null ? '<span class="muted">waiting</span>' : usd(r.feeCents)}</td><td class="num">${usd(r.refundedCents)}</td><td class="num">${usd(r.netCents)}</td><td class="num">${esc(r.pct)}</td><td class="num"><b>${usd(r.cents)}</b></td><td>${statusPill(r.status)}</td></tr>`).join("") || '<tr><td colspan="11" class="empty">No MD Fit Online payments yet.</td></tr>'}
        </tbody></table></div></div>`;
    },
    // ---------- Monthly statement (Section 4.8)
    async statement() {
      const s = await api("GET", `/api/admin/partner/statement?month=${encodeURIComponent(state.month)}`);
      const row = (k, label) => { const c = s.categories[k]; return `<tr><td>${label}</td><td class="num">${c.payments}</td><td class="num">${usd(c.grossCents)}</td><td class="num">${usd(c.taxCents)}</td><td class="num">${usd(c.feeCents)}${c.feesPending ? ` <span class="muted small">(${c.feesPending} waiting)</span>` : ""}</td><td class="num">${usd(c.refundedCents)}</td><td class="num"><b>${usd(c.netCents)}</b></td></tr>`; };
      return `<div class="row" style="justify-content:space-between"><div><h1>Statement</h1><p class="muted">Net Revenue by category, your share and payouts for the month (Section 4.8).</p></div>
          <div class="row"><input type="month" class="input" id="stMonth" value="${esc(state.month)}" style="width:auto"><button class="btn" id="stCsv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>CSV</button></div></div>
        <div class="grid g4">${kpi("Share earned", usd(s.share.earnedCents), `${usd(s.share.paidCents)} paid · ${usd(s.share.readyCents)} ready · ${usd(s.share.pendingCents)} pending`)}${kpi("MD Fit Online net", usd(s.categories.online.netCents), `${s.categories.online.payments} payments`)}${kpi("In-Clinic (100% Clinic)", usd(s.categories.clinic.grossCents), `${s.categories.clinic.payments} payments`)}${kpi("Partner commissions", usd(s.partnerCommissionsCents), "affiliates, this month")}</div>
        <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>By category</h2></div><div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Payments</th><th class="num">Paid</th><th class="num">Tax</th><th class="num">Stripe fees</th><th class="num">Refunded</th><th class="num">Net</th></tr></thead><tbody>${row("online", "MD Fit Online")}${row("clinic", "In-Clinic")}${row("unclassified", "Waiting for the owner to classify")}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>Payouts this month</h2></div>${s.payouts.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Amount</th><th>Transfer</th><th>Notice</th></tr></thead><tbody>${s.payouts.map((p) => `<tr><td>${esc(when(p.ts))}</td><td class="num">${usd(p.cents)}</td><td><span class="code">${esc(p.transferId)}</span></td><td>${p.acceptedAt ? `<span class="pill ok">Accepted</span>` : '<span class="pill warn">To accept</span>'}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty">None.</p>'}</div>`;
    },
    // ---------- PATF: every partner, every referral
    async partners() {
      const p = await api("GET", `/api/admin/partner/patf?month=${encodeURIComponent(state.month)}`), m = p.members;
      const state2 = (s) => `<span class="pill ${s === "acknowledged" || s === "deemed acknowledged" ? "ok" : s === "disputed" ? "bad" : "warn"}">${esc(s)}</span>`;
      return `<div class="row" style="justify-content:space-between"><div><h1>Partners and referrals</h1><p class="muted">PATF tracking: every partner and every member referral, by month. Counts and amounts only.</p></div><input type="month" class="input" id="pMonth" value="${esc(state.month)}" style="width:auto"></div>
        <div class="grid g4">${kpi("Member link clicks", m.clicks)}${kpi("Member code copies and shares", m.copies)}${kpi("Member referral sign-ups", m.signups, `${m.payingNow} paying now`)}${kpi("Member commissions", usd(m.commissionsCents), p.unmatchedCodes ? `${p.unmatchedCodes} codes matched nobody` : "")}</div>
        <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Partners</h2><span class="muted small">Commission is a share of Net Revenue from their customers' memberships, within the 15% Partner Allowance</span></div><div class="table-wrap"><table><thead><tr><th>Partner</th><th>Code and link</th><th class="num">Rate</th><th class="num">Clicks</th><th class="num">Sign-ups</th><th class="num">Paying</th><th class="num">Revenue</th><th class="num">Commission due</th><th>Registration</th></tr></thead><tbody>
          ${p.partners.map((r) => `<tr><td><b>${esc(r.name)}</b><div class="muted small">${esc(r.type)}${r.originatedByManager ? " · originated by you" : ""}</div></td><td><span class="code">${esc(r.code)}</span> <button class="btn sm" data-copy="${esc(r.link)}">Copy link</button></td><td class="num">${esc(r.ratePct)}%</td><td class="num">${r.clicks}</td><td class="num">${r.signups}</td><td class="num">${r.payingNow}</td><td class="num">${usd(r.revenueCents)}</td><td class="num"><b>${usd(r.commissionDueCents)}</b></td><td>${state2(r.state)}<div class="muted small">${r.state === "awaiting acknowledgment" ? `owner by ${esc(day(r.ackDueAt))}` : r.disputeReason ? esc(r.disputeReason) : `non-circumvention to ${esc(day(r.nonCircumventionUntil))}`}</div></td></tr>`).join("") || '<tr><td colspan="9" class="empty">No partners yet. Register one below.</td></tr>'}
        </tbody></table></div></div>
        <form class="card" id="regForm" novalidate><div class="card-head"><h2>Register a partner (Section 7.2)</h2></div>
          <p class="muted small" style="margin-top:-6px">The owner is notified and acknowledges within five business days or disputes it in writing; undisputed, it is deemed acknowledged. Partners you register count as originated by you (Section 4.4).</p>
          <div class="grid g2"><div class="field"><label for="rgName">Partner name</label><input id="rgName" name="name" class="input" maxlength="120" required></div>
            <div class="field"><label for="rgType">Type</label><select id="rgType" name="type"><option value="gym">Participating gym</option><option value="affiliate">Affiliate</option><option value="referral">Referral partner</option><option value="api">API</option><option value="other">Other</option></select></div>
            <div class="field"><label for="rgContact">Contact</label><input id="rgContact" name="contact" class="input" maxlength="200" placeholder="Name, email or phone"></div>
            <div class="field"><label for="rgRate">Commission (% of Net Revenue, 0 to 15)</label><input id="rgRate" name="ratePct" class="input" type="number" min="0" max="15" step="0.01" value="10" required></div></div>
          <div class="field"><label for="rgNotes">Notes</label><input id="rgNotes" name="notes" class="input" maxlength="1000"></div>
          <button class="btn primary">Register partner</button><p class="msg" id="rgMsg" role="status"></p></form>`;
    },
    // ---------- Payouts account: Stripe Express, embedded
    async payouts() {
      const d = state.share = await api("GET", "/api/admin/partner/share"), st = d.stripe;
      return `<h1>Payouts account</h1><p class="muted">Your own Stripe Express account. Stripe verifies your identity and holds your bank details; MD Fit never sees them.</p>
        <div class="card"><div class="card-head"><h2>${st.payoutsEnabled ? "Payouts" : "Set up payouts"}</h2>${st.payoutsEnabled ? '<span class="pill ok">Payouts on</span>' : st.connected ? '<span class="pill warn">Stripe is checking your details</span>' : '<span class="pill">Not set up</span>'}</div>
          <div id="stripeBanner"></div><div id="stripeMount" class="stripe-mount"><p class="muted">Loading Stripe…</p></div>
          ${st.payoutsEnabled ? '<details id="stripeMore"><summary class="small" style="cursor:pointer;color:var(--accent-text);font-weight:700">Bank account and details</summary><div id="stripeAccount"></div></details>' : ""}
          <p class="msg" id="stripeMsg" role="status"></p></div>`;
    }
  };

  // ---------- Stripe Connect embedded components (one instance per page)
  let connectP = null;
  const looks = () => { const css = getComputedStyle(document.documentElement), v = (n, d) => css.getPropertyValue(n).trim() || d;
    return { overlays: "dialog", variables: { colorPrimary: v("--ink", "#0A1A2E"), colorBackground: v("--surface", "#FFFFFF"), colorText: v("--ink", "#0A1A2E"), colorSecondaryText: v("--muted", "#5B6B7C"), colorBorder: v("--line", "#DCE8F2"), borderRadius: "12px", fontFamily: "Montserrat, system-ui, sans-serif" } }; };
  function stripeConnect() {
    if (!connectP) {
      connectP = import("/vendor/stripe-connect-js-3.5.0.esm.js").then(({ loadConnectAndInitialize }) => loadConnectAndInitialize({ publishableKey: state.share.stripe.publishableKey,
        fetchClientSecret: async () => (await api("POST", "/api/admin/partner/stripe/session")).clientSecret, appearance: looks() }));
      connectP.catch(() => { connectP = null; });
    }
    return connectP;
  }
  $("#themeBtn").addEventListener("click", () => { if (connectP) connectP.then((sc) => sc.update({ appearance: looks() })).catch(() => {}); });
  async function hosted() {
    try { const r = await api("POST", "/api/admin/partner/stripe/onboard"); location.href = r.url; }
    catch (e) { $("#stripeMsg").className = "msg err"; $("#stripeMsg").textContent = e.message; }
  }

  const WIRE = {
    share() {
      $$("[data-accept]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("Accept this payment notice? It confirms you have reviewed this payment and its breakdown.")) return;
        b.disabled = true;
        try { await api("POST", `/api/admin/partner/notices/${encodeURIComponent(b.dataset.accept)}/accept`); toast("Notice accepted."); render(); } catch (e) { b.disabled = false; toast(e.message); }
      }));
      $$("[data-goto]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); state.tab = a.dataset.goto; history.replaceState(null, "", "#" + state.tab); render(); }));
    },
    statement() {
      $("#stMonth").addEventListener("change", (e) => { state.month = e.target.value || thisMonth(); render(); });
      $("#stCsv").addEventListener("click", async () => {
        const s = session.get(); const res = await fetch(`${API}/api/admin/partner/statement.csv?month=${encodeURIComponent(state.month)}`, { headers: { Authorization: "Bearer " + s.token } });
        if (!res.ok) return toast("The statement couldn't be downloaded.");
        const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
        a.href = url; a.download = `mdfit-online-statement-${state.month}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      });
    },
    partners() {
      $("#pMonth").addEventListener("change", (e) => { state.month = e.target.value || thisMonth(); render(); });
      $$("[data-copy]").forEach((b) => b.addEventListener("click", () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Partner link copied.")).catch(() => toast("Couldn't copy the link."))));
      $("#regForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target, msg = $("#rgMsg"); msg.className = "msg";
        try {
          const p = await api("POST", "/api/admin/partner/partners", { name: f.name.value.trim(), type: f.type.value, contact: f.contact.value.trim(), ratePct: Number(f.ratePct.value), notes: f.notes.value.trim() });
          toast(`${p.name} registered. Code ${p.code}. The owner has been notified.`); render();
        } catch (err) { msg.className = "msg err"; msg.textContent = err.message; }
      });
    },
    async payouts() {
      const st = state.share.stripe, mount = $("#stripeMount");
      if (!st.embedded) { mount.innerHTML = `<p>Embedded payouts aren't available on this server. Use Stripe's own page instead.</p><button class="btn primary" id="hostedBtn">${st.connected ? "Continue on Stripe" : "Set up on Stripe"}</button>`; $("#hostedBtn").addEventListener("click", hosted); return; }
      let sc;
      try { sc = await stripeConnect(); } catch { mount.innerHTML = `<p class="msg err">Stripe couldn't load here.</p><button class="btn primary" id="hostedBtn">Use Stripe's own page</button>`; $("#hostedBtn").addEventListener("click", hosted); return; }
      const failed = () => { mount.innerHTML = `<p class="msg err">Stripe couldn't load here.</p><button class="btn primary" id="hostedBtn">Use Stripe's own page</button>`; $("#hostedBtn").addEventListener("click", hosted); };
      mount.innerHTML = "";
      if (!st.payoutsEnabled) {
        const el = sc.create("account-onboarding");
        el.setOnExit(async () => { try { await api("GET", "/api/admin/partner/stripe/status"); } catch {} toast("Saved. Stripe will confirm your details shortly."); render(); });
        el.setOnLoadError(failed); mount.appendChild(el);
      } else {
        $("#stripeBanner").appendChild(sc.create("notification-banner"));
        const po = sc.create("payouts"); po.setOnLoadError(failed); mount.appendChild(po);
        const box = $("#stripeAccount"); if (box) box.appendChild(sc.create("account-management"));
      }
    }
  };

  boot();
})();
