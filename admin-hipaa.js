// Admin → Compliance: HIPAA records (lib/hipaa.js on the API). Accounting of disclosures, amendment requests with
// their 60-day clock, retention settings and the dry-run purge report, the security incident log with notification
// deadlines, and who still hasn't acknowledged the Notice of Privacy Practices. Also adds a "Privacy & records" block
// to each client profile (communication preferences, NPP status, record export, disclosures).
(() => {
  // Works whether this file loads before or after admin.js (which drains the queue)
  window.MDFitAdmin = window.MDFitAdmin || { _q: [], register(id, fn, o) { this._q.push([id, fn, o]); } };
  const API = (window.MDFIT_CONFIG.apiUrl || "").replace(/\/+$/, "");
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const token = () => { try { return sessionStorage.getItem("mdfit_token") || ""; } catch { return ""; } };
  async function api(method, path, body) {
    const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    if (!res.ok) throw new Error((data && data.error) || "Request failed.");
    return data;
  }
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const day = (d) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—");
  const toast = (t, err) => (window.MDFitAdmin.toast ? window.MDFitAdmin.toast(t, err) : alert(t));
  const guard = (fn) => (...a) => Promise.resolve(fn(...a)).catch((e) => toast(e.message, true));
  const download = (data, name) => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: name }); a.click(); URL.revokeObjectURL(a.href); };
  const exportRecord = async (id, name) => { const d = await api("GET", `/api/admin/clients/${id}/records`); download(d, `mdfit-record-${String(name || "patient").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`); toast("Record downloaded. This view is in the audit ledger."); };

  const VIEWS = [["overview", "Overview & settings"], ["amendments", "Amendment requests"], ["disclosures", "Disclosures"], ["incidents", "Incidents"], ["retention", "Retention"], ["npp", "Privacy notice"]];
  let view = "overview", clientsCache = null;
  const clientList = async () => (clientsCache ||= await api("GET", "/api/admin/clients"));

  async function load() {
    const root = $("#compliance-root"); if (!root) return;
    if (!$(".cp-tabs", root)) {
      root.innerHTML = `<div class="cp-tabs" role="tablist" aria-label="Compliance sections">${VIEWS.map(([id, l]) => `<button type="button" role="tab" data-cp="${id}" aria-selected="${id === view}">${l}</button>`).join("")}</div><div id="cp-body"></div>`;
      $(".cp-tabs", root).addEventListener("click", (e) => { const b = e.target.closest("[data-cp]"); if (!b) return; view = b.dataset.cp; $$("[data-cp]", root).forEach((x) => x.setAttribute("aria-selected", x.dataset.cp === view)); guard(show)(); });
    }
    await show();
  }
  async function show() {
    const body = $("#cp-body"); if (!body) return;
    body.innerHTML = `<p class="muted">Loading…</p>`; body.onclick = null;
    await ({ overview, amendments, disclosures, incidents, retention, npp })[view](body);
  }

  // ---- Overview: counts and the compliance settings (officers, retention, notice version, dates to remember)
  async function overview(body) {
    const d = await api("GET", "/api/admin/compliance"), s = d.settings, c = d.counts;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><strong>${c.pendingAmendments}</strong><span>Amendment requests waiting${c.overdueAmendments ? ` · <b class="err">${c.overdueAmendments} past due</b>` : ""}</span></div>
        <div class="stat"><strong>${c.openIncidents}</strong><span>Open incidents</span></div>
        <div class="stat"><strong>${c.disclosures}</strong><span>Disclosures on record</span></div>
      </div>
      <form class="form" id="cp-settings" novalidate>
        <h2>Who is responsible</h2>
        <p class="muted">HIPAA requires a named privacy officer (§164.530(a)) and security officer (§164.308(a)(2)). In a solo practice both can be Dr. Jared.</p>
        <div class="grid2"><label>Privacy officer<input name="privacyOfficer" maxlength="120" value="${esc(s.privacyOfficer)}"></label><label>Security officer<input name="securityOfficer" maxlength="120" value="${esc(s.securityOfficer)}"></label></div>
        <h2>Dates to keep current</h2>
        <div class="grid4">
          <label>Last risk analysis (§164.308(a)(1))<input name="lastRiskAnalysisAt" type="date" value="${esc(s.lastRiskAnalysisAt)}"></label>
          <label>Last workforce training (§164.530(b))<input name="lastTrainingAt" type="date" value="${esc(s.lastTrainingAt)}"></label>
          <label>Privacy notice version<input name="nppVersion" maxlength="40" placeholder="2026-11" value="${esc(s.nppVersion)}"></label>
          <label>Privacy notice last updated<input name="nppUpdatedAt" type="date" value="${esc(s.nppUpdatedAt)}"></label>
        </div>
        <h2>Retention</h2>
        <p class="muted">Florida measures medical-record retention from the last contact; HIPAA keeps policies, notices, accountings and logs for 6 years. 7 years covers both. Nothing is deleted automatically; see the Retention tab for what would be eligible.</p>
        <div class="grid4"><label>Keep patient records (years)<input name="retentionYears" type="number" min="1" max="50" value="${s.retentionYears}"></label><label>Keep the audit ledger (years)<input name="auditRetentionYears" type="number" min="1" max="50" value="${s.auditRetentionYears}"></label></div>
        <label class="check"><input type="checkbox" name="includeVisitNotesInMemberExport"${s.includeVisitNotesInMemberExport ? " checked" : ""}> Include your private session notes when a patient downloads their own record (the patient has a right to them under §164.524; off by default so you can review first)</label>
        <button class="btn" type="submit">Save</button>
        <p class="form-msg" role="status"></p>
      </form>`;
    const f = $("#cp-settings", body);
    f.addEventListener("submit", guard(async (e) => {
      e.preventDefault(); const msg = $(".form-msg", f); msg.className = "form-msg"; msg.textContent = "";
      try {
        await api("PUT", "/api/admin/compliance/settings", { privacyOfficer: f.privacyOfficer.value, securityOfficer: f.securityOfficer.value, lastRiskAnalysisAt: f.lastRiskAnalysisAt.value, lastTrainingAt: f.lastTrainingAt.value,
          nppVersion: f.nppVersion.value, nppUpdatedAt: f.nppUpdatedAt.value, retentionYears: Number(f.retentionYears.value), auditRetentionYears: Number(f.auditRetentionYears.value), includeVisitNotesInMemberExport: f.includeVisitNotesInMemberExport.checked });
        msg.className = "form-msg ok"; msg.textContent = "Saved.";
      } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
    }));
  }

  // ---- Amendment requests (§164.526): answer within 60 days, one 30-day extension, every denial with a reason
  async function amendments(body, status = "pending") {
    const list = await api("GET", "/api/admin/amendments" + (status ? "?status=" + status : ""));
    body.innerHTML = `<div class="bar"><select id="am-filter"><option value="pending"${status === "pending" ? " selected" : ""}>Waiting for an answer</option><option value="accepted"${status === "accepted" ? " selected" : ""}>Accepted</option><option value="denied"${status === "denied" ? " selected" : ""}>Denied</option><option value=""${status === "" ? " selected" : ""}>All</option></select>
      <span class="muted small">A patient may ask to correct their record. Accepting means you also update the record (notes, intake answers) yourself.</span></div>
      <div class="stack">${list.length ? list.map((a) => `<article class="lead" data-id="${esc(a.id)}">
        <header><div><h3>${esc(a.clientName)} <span class="badge ${a.status === "pending" ? (a.overdue ? "overdue" : "new") : a.status}">${a.status === "pending" ? (a.overdue ? `past due by ${-a.daysLeft} days` : `${a.daysLeft} days left`) : a.status}</span></h3>
          <div class="meta"><a href="mailto:${esc(a.clientEmail)}">${esc(a.clientEmail)}</a> · asked ${when(a.createdAt)} · due ${day(a.dueAt)}${a.extendedAt ? " (extended once)" : ""}</div></div></header>
        <div><b>Record:</b> ${esc(a.record)}</div>
        <p class="msg"><b>Requested change:</b> ${esc(a.request)}</p>
        ${a.reason ? `<p class="msg"><b>Why:</b> ${esc(a.reason)}</p>` : ""}
        ${a.status === "pending" ? `<textarea rows="2" placeholder="Your answer to the patient (required to deny; optional to accept)" data-reason maxlength="2000"></textarea>
          <div class="actions"><button class="mini" data-decide="accepted">Accept</button><button class="mini danger" data-decide="denied">Deny</button>${a.extendedAt ? "" : `<button class="mini" data-extend>Need 30 more days</button>`}</div>`
          : `<p class="meta">Answered ${when(a.decidedAt)} by ${esc(a.decidedBy)}${a.decisionReason ? `: “${esc(a.decisionReason)}”` : ""}</p>`}
      </article>`).join("") : `<p class="muted">No requests here.</p>`}</div>`;
    $("#am-filter", body).addEventListener("change", (e) => guard(amendments)(body, e.target.value));
    body.onclick = guard(async (e) => { // one delegated handler per render (assignment replaces the previous one)
      const card = e.target.closest("[data-id]"); if (!card) return;
      if (e.target.matches("[data-decide]")) {
        const st = e.target.dataset.decide, reason = $("[data-reason]", card).value.trim();
        if (st === "denied" && !reason) throw new Error("Tell the patient why the request is denied (HIPAA requires a plain-language reason).");
        if (!confirm(st === "accepted" ? "Accept this request? Remember to update the record itself." : "Deny this request? The patient gets an email that you answered and can read your reason in their account.")) return;
        await api("PATCH", `/api/admin/amendments/${card.dataset.id}`, { status: st, reason }); toast("Answer saved. The patient has been told to sign in."); amendments(body, status);
      }
      if (e.target.matches("[data-extend]")) { await api("POST", `/api/admin/amendments/${card.dataset.id}/extend`, {}); toast("Due date moved 30 days. The patient gets a note."); amendments(body, status); }
    });
  }

  // ---- Accounting of disclosures (§164.528): record every disclosure outside treatment, payment and operations
  const disclosureForm = (clientSelect) => `<form class="form" id="dc-form" novalidate><h2>Record a disclosure</h2>
    <p class="muted">Needed for anything that is not treatment, payment or your own operations, and not to the patient themselves: records sent to a lawyer, an insurer's audit, a subpoena, public health, a school or employer with authorization.</p>
    ${clientSelect}
    <div class="grid2"><label>Who received it<input name="recipient" maxlength="200" required placeholder="Sarasota Orthopedic Associates, Dr. Lee"></label><label>Purpose<input name="purpose" maxlength="300" required placeholder="Referral records request"></label></div>
    <div class="grid2"><label>Legal basis<input name="basis" maxlength="100" placeholder="Patient authorization, subpoena, public health…"></label><label>Date disclosed<input name="date" type="date"></label></div>
    <label>What was disclosed<textarea name="description" rows="2" maxlength="2000" required placeholder="Intake packet and visit notes from March, faxed"></textarea></label>
    <button class="btn btn-sm" type="submit">Save to the accounting</button><p class="form-msg" role="status"></p></form>`;
  const disclosureRows = (list) => `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Patient</th><th>To</th><th>Purpose</th><th>What</th><th>Basis</th><th>Recorded</th></tr></thead><tbody>${
    list.length ? list.map((d) => `<tr><td>${day(d.date)}</td><td>${esc(d.clientName || "")}</td><td>${esc(d.recipient)}</td><td>${esc(d.purpose)}</td><td>${esc(d.description)}</td><td>${esc(d.basis)}</td><td class="muted">${when(d.createdAt)}</td></tr>`).join("") : `<tr><td class="empty" colspan="7">No disclosures recorded. That is normal for a practice that only shares records for treatment and with the patient.</td></tr>`}</tbody></table></div>`;
  async function submitDisclosure(f, clientId) {
    const msg = $(".form-msg", f); msg.className = "form-msg"; msg.textContent = "";
    try {
      await api("POST", `/api/admin/clients/${clientId}/disclosures`, { recipient: f.recipient.value, purpose: f.purpose.value, basis: f.basis.value, date: f.date.value, description: f.description.value });
      f.reset(); msg.className = "form-msg ok"; msg.textContent = "Recorded. The patient can see this in their account."; return true;
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; return false; }
  }
  async function disclosures(body) {
    const [list, people] = await Promise.all([api("GET", "/api/admin/disclosures"), clientList()]);
    body.innerHTML = disclosureForm(`<label>Patient<select name="clientId" required><option value="">Pick a patient</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.email)}</option>`).join("")}</select></label>`) + `<h2>Every disclosure on record</h2>` + disclosureRows(list);
    const f = $("#dc-form", body);
    f.addEventListener("submit", guard(async (e) => { e.preventDefault(); if (!f.clientId.value) { $(".form-msg", f).className = "form-msg err"; $(".form-msg", f).textContent = "Pick a patient."; return; } if (await submitDisclosure(f, f.clientId.value)) disclosures(body); }));
  }

  // ---- Security incidents and breaches (§164.308(a)(6), §164.400-414, Florida §501.171)
  const statesText = (states) => (states || []).map((s) => `${s.state} ${s.count}`).join(", ");
  const statesParse = (txt) => txt.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^([A-Za-z]{2})\s+(\d+)$/); if (!m) throw new Error(`States: write each as "FL 12" (two-letter state, then how many people), separated by commas.`); return { state: m[1].toUpperCase(), count: Number(m[2]) }; });
  const deadlineRows = (dl) => dl ? `<div class="deadlines">${[
    ["Affected people", dl.individuals.by, true, dl.individuals.rule], ["Florida residents (FIPA)", dl.floridaIndividuals.by, dl.floridaIndividuals.required, dl.floridaIndividuals.rule],
    ["Florida Attorney General", dl.floridaAttorneyGeneral.by, dl.floridaAttorneyGeneral.required, dl.floridaAttorneyGeneral.rule], ["HHS", dl.hhs.by, true, dl.hhs.rule],
    ["Media" + (dl.media.states.length ? ` (${dl.media.states.join(", ")})` : ""), dl.media.by, dl.media.required, dl.media.rule]
  ].map(([l, d, req, rule]) => `<div class="dl${req ? "" : " off"}" title="${esc(rule)}"><b>${esc(l)}</b><span>${req ? "by " + day(d) : "not required"}</span></div>`).join("")}<p class="muted small">${esc(dl.businessAssociate.rule)} Decide "breach" or "not a breach" with the four-factor risk assessment below (§164.402(2)); if it is a breach, every notification must say what happened, what information was involved, what the patient should do, what you are doing, and how to reach you (§164.404(c)).</p></div>` : "";
  async function incidents(body) {
    const list = await api("GET", "/api/admin/incidents");
    body.innerHTML = `<form class="form" id="in-form" novalidate><h2>Log an incident</h2>
      <p class="muted">Anything that may have exposed health information: a lost phone or laptop, an email to the wrong person, a hacked account, a vendor's breach notice, records left out. Logging it starts the clock, which runs from the day you knew or should have known.</p>
      <div class="grid2"><label>What happened, in one line<input name="title" maxlength="200" required></label><label>Discovered on<input name="discoveredAt" type="date" required></label></div>
      <div class="grid4"><label>Happened on (if known)<input name="occurredAt" type="date"></label><label>People affected<input name="affectedCount" type="number" min="0" value="0"></label><label class="wide">By state, e.g. <code>FL 12, GA 3</code><input name="states" placeholder="FL 12"></label></div>
      <label>Details<textarea name="description" rows="3" maxlength="4000"></textarea></label>
      <button class="btn btn-sm" type="submit">Log it</button><p class="form-msg" role="status"></p></form>
      <h2>Incident log</h2>
      <div class="stack">${list.length ? list.map((i) => `<article class="lead${i.status === "closed" ? " closed" : ""}" data-id="${esc(i.id)}">
        <header><div><h3>${esc(i.title)} <span class="badge ${i.status === "open" ? "new" : "completed"}">${i.status}</span> ${i.riskAssessment.conclusion && i.riskAssessment.conclusion !== "pending" ? `<span class="badge ${i.riskAssessment.conclusion === "breach" ? "overdue" : "completed"}">${i.riskAssessment.conclusion === "breach" ? "breach" : "not a breach"}</span>` : `<span class="badge">risk assessment pending</span>`}</h3>
          <div class="meta">Discovered ${day(i.discoveredAt)}${i.occurredAt ? ` · happened ${day(i.occurredAt)}` : ""} · ${i.affectedCount} affected${i.states.length ? ` (${esc(statesText(i.states))})` : ""} · logged ${when(i.createdAt)}</div></div></header>
        ${i.description ? `<p class="msg">${esc(i.description)}</p>` : ""}
        ${deadlineRows(i.deadlines)}
        <details class="audit-key"><summary>Risk assessment, notifications and status</summary>
          <div class="grid2">
            <label>1. What information, and how identifiable<textarea data-f="nature" rows="2" maxlength="2000">${esc(i.riskAssessment.nature || "")}</textarea></label>
            <label>2. Who got it (unauthorized person)<textarea data-f="recipient" rows="2" maxlength="1000">${esc(i.riskAssessment.recipient || "")}</textarea></label>
            <label>3. Was it actually acquired or viewed<textarea data-f="acquired" rows="2" maxlength="1000">${esc(i.riskAssessment.acquired || "")}</textarea></label>
            <label>4. How the risk was mitigated<textarea data-f="mitigation" rows="2" maxlength="2000">${esc(i.riskAssessment.mitigation || "")}</textarea></label>
          </div>
          <label>Notes<textarea data-f="notes" rows="2" maxlength="4000">${esc(i.riskAssessment.notes || "")}</textarea></label>
          <div class="grid4">
            <label>Conclusion<select data-f="conclusion">${[["pending", "Pending"], ["breach", "Breach: notify"], ["not-a-breach", "Low probability: not a breach"]].map(([v, l]) => `<option value="${v}"${(i.riskAssessment.conclusion || "pending") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
            <label>Affected people notified on<input type="date" data-n="individualsAt" value="${esc(i.notifications.individualsAt || "")}"></label>
            <label>Florida residents notified on<input type="date" data-n="floridaAt" value="${esc(i.notifications.floridaAt || "")}"></label>
            <label>Florida AG notified on<input type="date" data-n="floridaAttorneyGeneralAt" value="${esc(i.notifications.floridaAttorneyGeneralAt || "")}"></label>
            <label>HHS notified on<input type="date" data-n="hhsAt" value="${esc(i.notifications.hhsAt || "")}"></label>
            <label>Media notified on<input type="date" data-n="mediaAt" value="${esc(i.notifications.mediaAt || "")}"></label>
            <label>Status<select data-f="status"><option value="open"${i.status === "open" ? " selected" : ""}>Open</option><option value="closed"${i.status === "closed" ? " selected" : ""}>Closed</option></select></label>
          </div>
          <div class="actions"><button class="mini" data-save>Save</button></div>
        </details>
      </article>`).join("") : `<p class="muted">No incidents logged. Keep it that way, and log anything that worries you: a logged near-miss that turns out fine is far better than a breach nobody wrote down.</p>`}</div>`;
    const f = $("#in-form", body);
    f.addEventListener("submit", guard(async (e) => {
      e.preventDefault(); const msg = $(".form-msg", f); msg.className = "form-msg"; msg.textContent = "";
      try {
        await api("POST", "/api/admin/incidents", { title: f.title.value, discoveredAt: f.discoveredAt.value, occurredAt: f.occurredAt.value, affectedCount: Number(f.affectedCount.value || 0), states: statesParse(f.states.value), description: f.description.value });
        toast("Incident logged."); incidents(body);
      } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
    }));
    body.onclick = guard(async (e) => {
      if (!e.target.matches("[data-save]")) return;
      const card = e.target.closest("[data-id]"), v = (k) => $(`[data-f="${k}"]`, card).value, n = {}; $$("[data-n]", card).forEach((el) => (n[el.dataset.n] = el.value));
      await api("PATCH", `/api/admin/incidents/${card.dataset.id}`, { riskAssessment: { nature: v("nature"), recipient: v("recipient"), acquired: v("acquired"), mitigation: v("mitigation"), notes: v("notes"), conclusion: v("conclusion") }, notifications: n, status: v("status") });
      toast("Saved."); incidents(body);
    });
  }

  // ---- Retention dry run: what is older than the retention period today. Nothing is deleted.
  async function retention(body) {
    const r = await api("GET", "/api/admin/compliance/retention");
    body.innerHTML = `<p class="banner">Dry run only. Records kept ${r.retentionYears} years (cutoff ${day(r.cutoff)}); audit ledger ${r.auditRetentionYears} years (months before ${esc(r.auditCutoff)}). ${esc(r.note)}</p>
      <div class="table-wrap"><table><thead><tr><th>Records</th><th>Total</th><th>Past retention</th><th>Oldest</th><th>Newest eligible</th><th>Sample ids</th></tr></thead><tbody>${r.groups.map((g) => `<tr${g.eligible ? "" : ' class="off"'}><td>${esc(g.name)}</td><td>${g.total}</td><td><b>${g.eligible}</b></td><td>${g.oldest ? day(g.oldest) : "—"}</td><td>${g.newest ? day(g.newest) : "—"}</td><td class="muted small">${g.sample.map(esc).join(", ") || "—"}</td></tr>`).join("")}
      <tr${r.auditMonths.eligible.length ? "" : ' class="off"'}><td>Audit ledger (months)</td><td>${r.auditMonths.total}</td><td><b>${r.auditMonths.eligible.length}</b></td><td colspan="3" class="muted small">${r.auditMonths.eligible.join(", ") || "—"}</td></tr></tbody></table></div>
      <p class="muted small">To purge: decide per group with your privacy officer, keep a dated note of what was removed and why, and remember Florida requires written notice of record destruction policies for physician records. Purging is deliberately not a button.</p>`;
  }

  // ---- Notice of Privacy Practices: who has acknowledged it (from the intake consent or their account)
  async function npp(body) {
    const d = await api("GET", "/api/admin/compliance/npp");
    body.innerHTML = `<div class="stats"><div class="stat"><strong>${d.acknowledged}</strong><span>Acknowledged the notice</span></div><div class="stat"><strong>${d.missing.length}</strong><span>Not yet</span></div></div>
      <p class="muted">The acknowledgment comes from the "Consent & policies" intake document. Members without one are asked once in Account → Profile → Privacy & my records. HIPAA asks for a good-faith effort (§164.520(c)(2)(ii)), so a refusal is fine as long as it is noted. Post the notice at the clinic and on <a href="/privacy-policy" target="_blank" rel="noopener">mymdfit.com/privacy-policy</a>.</p>
      <div class="table-wrap"><table><thead><tr><th>Client</th><th>Email</th></tr></thead><tbody>${d.missing.length ? d.missing.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td></tr>`).join("") : `<tr><td class="empty" colspan="2">Everyone has acknowledged the notice.</td></tr>`}</tbody></table></div>`;
  }

  window.MDFitAdmin.register("compliance", load, { label: "Compliance", group: "insights" });

  // ---- Client profile: privacy preferences (§164.522), NPP status, record export, this person's disclosures
  document.addEventListener("mdfit:admin:client", (e) => {
    const { id, box, client } = e.detail;
    const anchor = $(".client-docs", box); if (!anchor) return;
    const el = document.createElement("div"); el.className = "client-privacy"; el.innerHTML = `<p class="muted">Loading privacy…</p>`;
    anchor.insertAdjacentElement("afterend", el);
    guard(async () => {
      const [p, d] = await Promise.all([api("GET", `/api/admin/clients/${id}/privacy`), api("GET", `/api/admin/clients/${id}/disclosures`)]);
      const pr = p.preferences, asks = [pr.contactBy && `reach by ${pr.contactBy} only`, pr.noVoicemail && "no voicemail", pr.noText && "no texts"].filter(Boolean);
      el.innerHTML = `<div class="privacy-head"><h2>Privacy &amp; records</h2>
          <div class="row-actions"><button type="button" class="mini" data-export>Export patient record (JSON)</button><button type="button" class="mini" data-disclose>Record a disclosure</button></div></div>
        <div class="privacy-grid">
          <div><b>How to contact them</b><p>${asks.length ? `<span class="badge overdue">${esc(asks.join(" · "))}</span>` : "<span class='muted'>No special requests.</span>"}</p>${pr.restrictions ? `<p class="msg"><b>Their request:</b> ${esc(pr.restrictions)}</p>` : ""}${pr.updatedAt ? `<p class="meta">Updated ${when(pr.updatedAt)}</p>` : ""}</div>
          <div><b>Notice of Privacy Practices</b><p>${p.npp.acknowledged ? `<span class="badge completed">acknowledged ${when(p.npp.at)} via ${esc(p.npp.via)}</span>` : `<span class="badge docs">not acknowledged yet</span>`}</p></div>
        </div>
        <div class="dc-inline" hidden></div>
        <details class="audit-key"><summary>Accounting of disclosures (${d.disclosures.length})${d.exports.length ? ` · ${d.exports.length} record exports` : ""}</summary>
          ${disclosureRows(d.disclosures)}${d.exports.length ? `<p class="muted small">Exports (to the patient; not a disclosure to account for): ${d.exports.map((x) => `${when(x.at)} by ${esc(x.who)}`).join("; ")}</p>` : ""}</details>`;
      $("[data-export]", el).addEventListener("click", guard(() => exportRecord(id, client.name)));
      $("[data-disclose]", el).addEventListener("click", () => {
        const slot = $(".dc-inline", el); if (!slot.hidden) { slot.hidden = true; return; }
        slot.innerHTML = disclosureForm(""); slot.hidden = false;
        const f = $("#dc-form", slot);
        f.addEventListener("submit", guard(async (ev) => { ev.preventDefault(); if (await submitDisclosure(f, id)) { toast("Disclosure recorded."); el.remove(); document.dispatchEvent(new CustomEvent("mdfit:admin:client", { detail: e.detail })); } }));
        $("[name=recipient]", f).focus();
      });
    })();
  });
})();
