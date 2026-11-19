// PLATFORM OVERVIEW — the same panel in all three consoles (/admin, /manager, /dev).
//
// What it answers, for someone who did not build the thing: what the platform is made of, how much it is being
// used and whether that is growing, whether anything is failing right now, and where the logs and the numbers are
// kept so they can be copied and handed to whoever is fixing it.
//
// Totals only. No name, email, chart or message from any client or patient reaches this panel: it reads
// /api/admin/dev/overview (counts and sums) and, for the owner, the fault counts from the server's own log.
//
// It also keeps the fault recorder for these console pages: whatever the browser's JavaScript console would have
// shown is kept on the device, so it can be copied out from the Developer console, Logs. Nothing is sent anywhere.
(() => {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const usd = (c) => (c == null ? "—" : "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const utcDay = (t) => new Date(t).toISOString().slice(0, 10);

  // ---------------------------------------------------------------- the fault recorder (this browser only)
  const FKEY = "mdfit_faults", FMAX = 60, CUT = 600;
  const trim = (s, n = CUT) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; };
  const faults = {
    list() { try { const a = JSON.parse(localStorage.getItem(FKEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } },
    add(f) {
      try {
        const all = faults.list();
        const last = all[all.length - 1];
        // the same fault firing in a loop is counted, not copied out sixty times
        if (last && last.msg === f.msg && last.at === f.at) { last.again = (last.again || 1) + 1; last.t = f.t; }
        else all.push(f);
        localStorage.setItem(FKEY, JSON.stringify(all.slice(-FMAX)));
      } catch {}
    },
    clear() { try { localStorage.removeItem(FKEY); } catch {} },
    // Plain text, for pasting to whoever is fixing it
    text() {
      const all = faults.list();
      const head = `MD Fit — JavaScript faults recorded in this browser\n${new Date().toString()}\n${location.origin}\n${navigator.userAgent}\n`;
      if (!all.length) return head + "\nNone recorded.\n";
      return head + "\n" + all.map((f) => `${f.t}  ${f.kind.toUpperCase()}  ${f.page}\n  ${f.msg}${f.at ? `\n  at ${f.at}` : ""}${f.again ? `\n  (happened ${f.again} times)` : ""}${f.stack ? `\n  ${f.stack.split("\n").join("\n  ")}` : ""}`).join("\n\n") + "\n";
    },
    install() {
      if (faults._on) return; faults._on = true;
      const page = location.pathname + location.hash;
      const note = (kind, msg, at, stack) => faults.add({ t: new Date().toISOString(), kind, msg: trim(msg, 400), at: trim(at, 200), stack: stack ? trim(stack) : "", page: trim(page, 120) });
      window.addEventListener("error", (e) => {
        const el = e.target;
        // a stylesheet, script or image that did not load reaches the same handler with no message
        if (el && el !== window && (el.src || el.href)) return note("load", "Did not load: " + (el.src || el.href), el.tagName.toLowerCase());
        note("error", e.message || "Script error", e.filename ? `${e.filename}:${e.lineno || 0}` : "", e.error && e.error.stack);
      }, true);
      window.addEventListener("unhandledrejection", (e) => {
        const r = e.reason;
        note("promise", (r && (r.message || r.error || r)) || "Promise rejected with no reason", "", r && r.stack);
      });
      const real = console.error ? console.error.bind(console) : null;
      if (real) console.error = (...a) => { try { note("console", a.map((x) => (x && x.stack) || (x && x.message) || (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); } catch {} real(...a); };
    }
  };
  faults.install();

  // ---------------------------------------------------------------- what the platform is made of
  // Each part: what it is, where it runs, and where to look when it misbehaves.
  const PARTS = [
    ["Website", "The public pages, the condition and muscle pages, the booking page", "Vercel", "Vercel → Deployments → Build logs; Web Analytics for traffic"],
    ["Member app", "/account: the road, workouts, programs, videos, pain tool, messages — and Solomon", "Vercel pages over the Railway API", "Server log below; the browser's own faults in Logs → This browser"],
    ["Practice workspace", "/admin: the diary, clients, charts, notes, payments, settings", "Vercel pages over the Railway API", "Server log below"],
    ["Manager console", "/manager: the revenue share, payment notices, statements, PATF partners, payouts", "Vercel pages over the Railway API and Stripe", "Server log below; Stripe dashboard for a payout"],
    ["Developer console", "/dev: what is running, how it is used, what it costs, and the logs", "Vercel pages over the Railway API", "This page"],
    ["API and data", "/api/* — every read and write the apps make, and the stored records", "Railway (Express), records on the Railway volume", "Railway → Deployments → Logs (7 days) and the 90-day copy below"],
    ["Video", "Exercise footage members watch", "Bunny Stream (library MDfit), images on Cloudinary, originals in Google Drive", "Workspace → Programs/Fitness; the mirror state in the video status"],
    ["Payments", "Memberships, services, invoices and the manager's payouts", "Stripe", "Stripe dashboard → Payments, Subscriptions, Connect"],
    ["Email", "Owner alerts, member codes and notices", "Railway, through the mail service", "Workspace → Insights → Analytics → email delivery"],
    ["Booking", "Appointment times and class spots", "Cal.com or the built-in scheduler, on the API", "Workspace → Calendar; Cal.com dashboard if Cal is the provider"]
  ];

  // Who sees what. The agreement with the manager (Section 11.2) keeps patient data away from the manager and the
  // developer, and the server — not this page — is what enforces it.
  const WHO = [
    ["Owner", "Everything, patient records included", "ok"],
    ["Manager", "The revenue share, statements, payouts, content, and these platform totals. Never a patient's name, chart or message.", ""],
    ["Developer", "These platform totals, the server's faults and content. Never patient data, never money.", ""],
    ["Other staff", "Only the screens the owner turns on, one permission at a time (Workspace → Team & roles)", ""]
  ];

  // ---------------------------------------------------------------- growth, worked out from the daily visits
  function growth(visits) {
    if (!Array.isArray(visits) || !visits.length) return null;
    const by = new Map(visits.map((v) => [v.date, v]));
    const span = (from, to) => { // days ago, inclusive
      let views = 0, uniq = 0, had = 0;
      for (let i = from; i <= to; i++) { const v = by.get(utcDay(Date.now() - i * 864e5)); if (v) { views += v.views || 0; uniq += v.unique || 0; had++; } }
      return { views, uniq, had };
    };
    const now = span(0, 6), was = span(7, 13);
    if (!was.had) return { now, was, pct: null };
    return { now, was, pct: was.views ? Math.round(((now.views - was.views) / was.views) * 100) : null };
  }

  // ---------------------------------------------------------------- the panel
  let last = { d: null, me: null, logs: null, where: "" };
  const kpi = (label, val, sub) => `<div class="card kpi"><span class="muted">${esc(label)}</span><b class="num">${val}</b><small class="muted">${sub}</small></div>`;
  const card = (title, inner, side = "") => `<section class="card"><div class="card-head" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px"><h2 style="margin:0;font-size:16px">${esc(title)}</h2><span class="muted" style="font-size:12px">${side}</span></div>${inner}</section>`;
  // nums: the columns after the first hold figures, so they read right-aligned. Text columns stay left, headings with them.
  // min: a table of three or four columns is scrolled sideways on a phone rather than crushed into unreadable strips
  const rows = (head, body, nums = true, min = 0) => `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="width:100%;border-collapse:collapse;font-size:13.5px${min ? `;min-width:${min}px` : ""}"><thead><tr>${head.map((h, i) => `<th class="muted" style="text-align:${nums && i && head.length > 2 ? "right" : "left"};padding:6px 8px;font-size:12px;font-weight:600">${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  const cell = (c, right) => `<td style="text-align:${right ? "right" : "left"};padding:7px 8px;border-top:1px solid var(--line,#e3e8ee);vertical-align:top">${c}</td>`;
  const body = (list, nums = true) => list.map((r) => `<tr>${r.map((c, i) => cell(c, nums && i && r.length > 2)).join("")}</tr>`).join("");

  function overview({ d, me, logs, where }) {
    last = { d, me, logs, where };
    const owner = !!(me && (me.isOwner || me.role === "owner"));
    const g = d && growth(d.usage.visits);
    const acc = (d && d.usage.accounts) || {};
    const sys = (d && d.system) || {};
    const t = logs && logs.totals;
    const faultCount = t ? (t.s5xx || 0) + (t.error || 0) : null;
    const trendLine = !g ? "no visits recorded yet" : g.pct == null ? `${num(g.now.views)} in the last 7 days` : `${g.pct >= 0 ? "up" : "down"} ${Math.abs(g.pct)}% on the 7 days before`;

    // The link that opens the server log: in the developer console it is the next tab along; from the workspace or
    // the manager console it is the developer console, opened with the same sign-in.
    const logLink = where === "dev"
      ? `<a class="btn" href="#logs">Open the logs</a>`
      : `<a class="btn" href="/dev#logs"${where === "workspace" ? ' data-portal="mdfit_dev"' : ' data-key="mdfit_dev"'}>Open the logs in the developer console</a>`;
    const analytics = where === "workspace" ? `<a class="btn" href="#insights">Site analytics</a>` : where === "dev" ? `<a class="btn" href="#usage">Site analytics</a>` : "";

    return `
    ${d ? `<div class="grid g4" style="margin-bottom:14px">
      ${kpi("Site visits", num(d.usage.views), `${num(d.usage.unique)} visitors in ${d.days} days`)}
      ${kpi("Growth", g ? num(g.now.views) : "—", esc(trendLine))}
      ${kpi("Accounts", num(acc.total), `${num(acc.joined)} joined, ${num(acc.signedIn)} signed in`)}
      ${kpi("Members", num(acc.members), d.spending ? `${usd(d.spending.monthly)} a month to run` : "")}
    </div>` : ""}

    <div class="grid g2">
      ${card("Is anything failing", (() => {
        if (logs && logs.denied) return `<p class="muted" style="margin:0">The server log is open to the practice owner's sign-in. Railway and Vercel show the same thing in their own dashboards.</p>`;
        if (logs && logs.error) return `<p class="muted" style="margin:0">The server log could not be read: ${esc(logs.error)}</p>`;
        if (!t) return `<p class="muted" style="margin:0">Checking the server log…</p>`;
        return `<p style="margin:0 0 10px"><span class="pill ${faultCount ? "bad" : "ok"}">${faultCount ? `${num(faultCount)} ${faultCount === 1 ? "fault" : "faults"}` : "No faults"}</span>
          <span class="muted"> in the last ${num(logs.days)} days, over ${num(t.requests)} requests</span></p>
          ${rows(["", ""], body([
            ["Requests that failed on the server (5xx)", `<b>${num(t.s5xx)}</b>`],
            ["Requests refused or not found (4xx)", num(t.s4xx)],
            ["Errors written to the log", num(t.error)],
            ["Warnings", num(t.warn)],
            ["Times the server restarted", num(t.restarts)]
          ], false))}
          ${(t.errorPaths || []).length ? `<p class="muted" style="margin:12px 0 4px;font-size:12px">Where it failed</p>${rows(["Request", "Faults"], body(t.errorPaths.slice(0, 6).map((p) => [esc(p.key), num(p.count)])))}` : ""}`;
      })(), owner ? "the server's own log, kept 90 days" : "")}

      ${card("What is running", rows(["", ""], body([
        ["Deployed commit", sys.commit ? `<span class="pill">${esc(sys.commit)}</span>` : "not reported"],
        ["Running since", esc(when(sys.startedAt))],
        ["Up for", `${num(sys.uptimeMinutes)} min`],
        ["Memory in use", `${num(sys.memoryMb)} MB`],
        ["Node", esc(sys.node || "—")],
        ["Faults in this browser", `${num(faults.list().length)} recorded`]
      ], false)), "the API on Railway")}
    </div>

    ${card("Where the logs and the numbers are kept", `
      <p class="muted" style="margin:0 0 10px">Each of these can be read, copied and handed to whoever is fixing something. Railway and Vercel need their own sign-ins.</p>
      ${rows(["Where", "What is there", "How long it is kept"], body([
        ["The server log, here", "Every request, warning, error and restart the API wrote — as lines you can filter, copy or download", logs && logs.denied ? "90 days, for the owner's sign-in" : "90 days"],
        ["Railway → Deployments → Logs", "The same lines as the server writes them, plus the build and the container's own messages", "7 days"],
        ["Vercel → Deployments", "The build log for the site, and which commit is live", "kept with the deployment"],
        ["Vercel → Web Analytics", "Visits to the public site as Vercel counts them", "per the plan"],
        ["This browser", "What the JavaScript console would have shown on these console pages", "until cleared"]
      ], false), false, 620)}
      <div class="row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px">
        ${logLink}${analytics}
        <button class="btn" type="button" data-plat="copy">Copy a platform summary</button>
        <a class="btn" href="https://railway.com/dashboard" target="_blank" rel="noopener">Railway</a>
        <a class="btn" href="https://vercel.com/dashboard" target="_blank" rel="noopener">Vercel</a>
      </div>`)}

    ${card("The parts of the platform", rows(["Part", "What it does", "Where it runs", "Where to look"],
      PARTS.map((p) => `<tr>${p.map((c, i) => cell(i ? `<span class="muted">${esc(c)}</span>` : `<b>${esc(c)}</b>`, false)).join("")}</tr>`).join(""), false, 760))}

    ${card("Who can see what", rows(["Sign-in", "Sees"], WHO.map(([role, sees, kind]) => `<tr>${cell(`<b>${esc(role)}</b>${kind ? ` <span class="pill ${kind}">all</span>` : ""}`, false)}${cell(`<span class="muted">${esc(sees)}</span>`, false)}</tr>`).join("")),
      "the server decides, not this page")}`;
  }

  // ---------------------------------------------------------------- one paste for whoever is fixing it
  function bundle() {
    const { d, me, logs } = last;
    const t = logs && logs.totals, g = d && growth(d.usage.visits);
    const L = ["MD Fit — platform summary", new Date().toString(), ""];
    L.push(`Signed in as: ${(me && (me.isOwner ? "owner" : (me.roles || [me.role]).join(", "))) || "unknown"}`);
    if (d) {
      L.push(`Deployed commit: ${d.system.commit || "not reported"}`, `API running since: ${d.system.startedAt} (${d.system.uptimeMinutes} min, ${d.system.memoryMb} MB, Node ${d.system.node})`, "",
        `Site visits, last ${d.days} days: ${d.usage.views} views, ${d.usage.unique} visitors`,
        g ? `Last 7 days: ${g.now.views} views${g.pct == null ? "" : ` (${g.pct >= 0 ? "+" : ""}${g.pct}% on the 7 before: ${g.was.views})`}` : "",
        `Accounts: ${d.usage.accounts.total} in all, ${d.usage.accounts.joined} joined and ${d.usage.accounts.signedIn} signed in in that window, ${d.usage.accounts.members} with a membership`,
        `Server events recorded: ${d.activity.total}`, "");
    }
    if (t) L.push(`Server log, last ${logs.days} days: ${t.requests} requests, ${t.s5xx} failed (5xx), ${t.s4xx} refused (4xx), ${t.error} errors, ${t.warn} warnings, ${t.restarts} restarts`,
      ...(t.errorPaths || []).slice(0, 8).map((p) => `  failed: ${p.key} — ${p.count}`), "");
    else if (logs && logs.denied) L.push("Server log: not open to this sign-in (owner only).", "");
    L.push(`This browser: ${navigator.userAgent}`, `Page: ${location.href}`, "");
    L.push(faults.text());
    return L.filter((x) => x != null).join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }

  async function put(text) {
    try { await navigator.clipboard.writeText(text); return "Copied."; }
    catch { return "Couldn't copy on its own — the text is in the box, select it and copy."; }
  }

  // Each console calls this from its own click handler and shows what comes back.
  async function onClick(e) {
    const b = e.target.closest("[data-plat]"); if (!b) return null;
    const what = b.dataset.plat;
    if (what === "copy") return put(bundle());
    if (what === "copyFaults") return put(faults.text());
    if (what === "clearFaults") { faults.clear(); return "Cleared."; }
    return null;
  }

  window.MDFitPlatform = { overview, bundle, faults, onClick, growth, PARTS, esc };
})();
