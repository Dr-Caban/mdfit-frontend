// MD Fit member app: send or share anything (server: mdfit-backend lib/sends.js).
//
//   - Every Share button (data-share-lib = video | page | program | track | muscle, with data-share-id and
//     data-share-title) opens one sheet with two ways out:
//       Send to a member   it lands on their Home ("Sent to you"); the sender sees waiting / opened / started.
//       Share a link       a public preview at /shared (anyone can read it; joining credits this member's referral code).
//   - Home: "Sent to you" (open or dismiss) and "You sent" (status).
// A workout a member built is sent as a challenge instead (account-xp.js).
(() => {
  "use strict";
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const A = window.MDFitApp; if (!A) return;
  const { $, esc, apiAuth } = M;
  const SITE = "https://www.mymdfit.com";
  const KIND = { video: "Video", page: "Guide", program: "Program", track: "Pain track", protocol: "Pain protocol" };
  const PARAM = { video: "v", page: "t", program: "p", track: "k", protocol: "m" };
  const ROUTE = { video: (r) => "videos/watch/" + r, page: (r) => "tips/" + r, program: (r) => "programs/" + r, track: (r) => "pain/track/" + r, protocol: (r) => "pain/muscle/" + r };
  const STATUS = { waiting: "waiting", opened: "opened", started: "started ✓", dismissed: "dismissed" };
  const CLOSE = '<button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>';
  const refCode = () => { try { const c = (M.auth.get() || {}).client; return (c && c.referralCode) || ""; } catch { return ""; } };
  const linkFor = (it) => `${SITE}/shared?${PARAM[it.kind]}=${encodeURIComponent(it.ref)}${refCode() ? `&ref=${encodeURIComponent(refCode())}` : ""}`;
  let members = null, box = { inbox: [], sent: [] }, cur = null;
  // The server names videos, programs and guides itself; a pain track or protocol is named here from its id, so no
  // words of the sender's ever reach another member.
  const nameOf = (s) => s.title || (s.kind === "track" ? (((window.MDFitTracks || {}).TRACKS || []).find((t) => t.id === s.ref) || {}).title
    : s.kind === "protocol" ? ((((window.MDFitMuscles || {}).MUSCLES || {})[s.ref] || {}).name ? `${window.MDFitMuscles.MUSCLES[s.ref].name} protocol` : "") : "") || KIND[s.kind] || "From MD Fit";

  // ---- The sheet ------------------------------------------------------------------------------------------------
  const dlg = document.createElement("dialog");
  dlg.className = "sheet send-sheet"; dlg.id = "send-sheet"; dlg.setAttribute("aria-label", "Send or share");
  document.body.appendChild(dlg);
  function drawMembers() {
    const ul = $("#send-members", dlg); if (!ul) return;
    const q = ($("#send-q", dlg).value || "").trim().toLowerCase();
    if (!members) { ul.innerHTML = `<li class="muted small">Loading members…</li>`; return; }
    const hits = members.filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 30);
    ul.innerHTML = hits.length ? hits.map((m) => `<li><span>${m.gem ? A.gemIcon(m.gem.color, 16) : ""}<b>${esc(m.name)}</b></span><button type="button" class="btn-blue sm" data-send-to="${esc(m.id)}" data-name="${esc(m.name)}">Send</button></li>`).join("")
      : `<li class="muted small">${members.length ? "No member by that name." : "No other members yet. Share the link instead."}</li>`;
  }
  async function open(it) {
    if (!it || !PARAM[it.kind] || !it.ref) return;
    cur = it;
    dlg.innerHTML = `<div class="sheet-head"><b>Send or share</b>${CLOSE}</div>
      <p class="send-what"><span class="coach-kind">${esc(KIND[it.kind])}</span><b>${esc(it.title)}</b></p>
      <h3 class="send-h">Send to a member</h3>
      <input type="search" id="send-q" placeholder="Search members" autocomplete="off" aria-label="Search members">
      <ul class="send-members" id="send-members"></ul>
      <h3 class="send-h">Or share a link</h3>
      <p class="muted small">Anyone can open it. If they join from your link, you get the referral credit.</p>
      <div class="send-link"><button type="button" class="btn-ghost sm" data-send-link>${navigator.share ? "Share link" : "Copy link"}</button></div>
      <p class="form-msg" role="status"></p>`;
    if (!dlg.open) dlg.showModal();
    drawMembers();
    if (!members) { try { members = (await apiAuth("GET", "/api/me/challenges/members")).members || []; } catch { members = []; } drawMembers(); }
  }
  dlg.addEventListener("input", (e) => { if (e.target.id === "send-q") drawMembers(); });
  dlg.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]") || e.target === dlg) { dlg.close(); return; }
    const msg = dlg.querySelector(".form-msg");
    const to = e.target.closest("[data-send-to]");
    if (to && cur) {
      to.disabled = true;
      try { await apiAuth("POST", "/api/me/sends", { toId: to.dataset.sendTo, kind: cur.kind, ref: cur.ref }); to.textContent = "Sent ✓"; A.toast(`Sent to ${to.dataset.name}.`); load(); }
      catch (err) { to.disabled = false; msg.textContent = err.message; }
      return;
    }
    if (e.target.closest("[data-send-link]") && cur) {
      const url = linkFor(cur);
      if (navigator.share) { try { await navigator.share({ title: `MD Fit: ${cur.title}`, text: `${cur.title}, from Dr. Jared on MD Fit`, url }); return; } catch (err) { if (err && err.name === "AbortError") return; } }
      try { await navigator.clipboard.writeText(url); msg.textContent = "Link copied. Paste it anywhere."; } catch { msg.textContent = url; }
    }
  });

  // Every Share button in the app (capture, so the older direct-share handler never runs twice)
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-share-lib]"); if (!b) return;
    const kind = b.dataset.shareLib === "muscle" ? "protocol" : b.dataset.shareLib;
    if (!PARAM[kind] || !b.dataset.shareId) return;
    e.preventDefault();
    open({ kind, ref: b.dataset.shareId, title: b.dataset.shareTitle || "MD Fit" });
  });

  // ---- Home: Sent to you / You sent -----------------------------------------------------------------------------
  const card = document.createElement("section");
  card.className = "card sends-card"; card.id = "sends-card"; card.hidden = true;
  (function place() { const home = $("#view-home .col-main"); if (!home) return; const t = $("#today-card", home); t ? t.after(card) : home.prepend(card); })();
  function render() {
    const inbox = box.inbox || [], sent = (box.sent || []).slice(0, 8);
    card.hidden = !(inbox.length || sent.length);
    if (card.hidden) return;
    card.innerHTML = (inbox.length ? `<div class="card-head"><span class="label accent">Sent to you</span></div>
      <ul class="coach-list">${inbox.map((s) => `<li data-send="${esc(s.id)}"><div><span class="coach-kind">${esc(KIND[s.kind] || "")}</span><b>${esc(nameOf(s))}</b><span class="muted small">From ${esc(s.from)}${s.status === "started" ? " · started ✓" : ""}</span></div>
        <span class="send-acts"><button type="button" class="btn-blue sm" data-send-open>Open</button><button type="button" class="icon-btn" data-send-x aria-label="Remove ${esc(nameOf(s))}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg></button></span></li>`).join("")}</ul>` : "")
      + (sent.length ? `<div class="card-head"${inbox.length ? ' style="margin-top:12px"' : ""}><span class="label">You sent</span></div>
      <ul class="send-sent">${sent.map((s) => `<li><span><b>${esc(nameOf(s))}</b> → ${esc(s.to)}</span><span class="send-st ${esc(s.status)}">${esc(STATUS[s.status] || s.status)}</span></li>`).join("")}</ul>` : "");
  }
  card.addEventListener("click", async (e) => {
    const li = e.target.closest("[data-send]"); if (!li) return;
    const s = (box.inbox || []).find((x) => x.id === li.dataset.send); if (!s) return;
    if (e.target.closest("[data-send-x]")) { try { await apiAuth("DELETE", `/api/me/sends/${encodeURIComponent(s.id)}`); } catch (err) { A.toast(err.message); } load(); return; }
    if (e.target.closest("[data-send-open]")) {
      apiAuth("POST", `/api/me/sends/${encodeURIComponent(s.id)}/open`).catch(() => {});
      if (ROUTE[s.kind]) A.go(ROUTE[s.kind](s.ref));
    }
  });
  async function load() { try { box = await apiAuth("GET", "/api/me/sends"); render(); } catch {} }
  load();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  window.MDFitSend = { open, reload: load };
})();
