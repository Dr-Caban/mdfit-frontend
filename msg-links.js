// Links in messages from the practice, drawn the same way wherever a patient thread is shown: the member app
// (account.js), the workspace (workspace-app.js) and the earlier admin (admin.js).
// A web address the practice typed becomes a link. An address on MD Fit's own site that stands on its own line becomes
// a button, named after the short line that introduces it ("Subscribe:", "Book your session:"). Everything typed is
// escaped first: a message can only ever produce text, links to http(s) addresses, and line breaks.
// What a member types is never passed through here: it stays plain text on every screen.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const OWN = new Set(["mymdfit.com", "www.mymdfit.com", location.hostname.toLowerCase()]);
  const URL_RE = /https?:\/\/[^\s<>"']+|(?:www\.)?mymdfit\.com(?:\/[^\s<>"']*)?/gi;
  const LABEL = 40; // the longest line that can name a button

  // every address in a line: { at, raw (as typed, without closing punctuation), href, own, url }
  function links(line) {
    const found = []; let m; URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(line))) {
      const before = m.index ? line[m.index - 1] : "";
      if (/[\w@.\-/]/.test(before)) continue; // the middle of a word or of an email address is not an address of its own
      const raw = m[0].replace(/[.,;:!?)\]]+$/, "");
      let url; try { url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { continue; }
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
      const own = OWN.has(url.hostname.toLowerCase());
      // a link to MD Fit stays on the site the reader is on; the path can never start a new address ("//elsewhere")
      const href = own ? location.origin + url.pathname.replace(/^\/+/, "/") + url.search + url.hash : url.href;
      found.push({ at: m.index, raw, href, own, url });
    }
    return found;
  }
  function ownName(url) {
    const p = url.pathname.replace(/\/+$/, "") || "/", h = url.hash.toLowerCase();
    if (p === "/book") return "Book a session";
    if (p === "/account" && h === "#premium") return "See membership options";
    if (p === "/account" && h === "#messages") return "Open messages";
    if (p === "/account" || p === "/login") return "Open the app";
    if (p === "/events") return "See events";
    return "Open on MD Fit";
  }
  // newTab: every link opens a new tab (the staff screens, so a click never leaves the workspace). Otherwise only an
  // outside site does, and an MD Fit address opens in place (the member app).
  const anchor = (l, text, cls, newTab) => `<a class="${cls}" href="${esc(l.href)}"${newTab || !l.own ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(text)}</a>`;

  function html(body, opts) {
    const newTab = !!(opts && opts.newTab);
    const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n"), parts = []; // { btn: true, html } or { raw, html, blank }
    for (const line of lines) {
      const found = links(line), t = line.trim();
      const one = found.length === 1 ? found[0] : null;
      const tail = one ? line.slice(one.at + one.raw.length).trim() : "";
      if (one && one.own && /^[.,;:!?)\]]*$/.test(tail)) {
        const lead = line.slice(0, one.at).trim();
        // "Subscribe: <address>" on one line
        if (lead && /:$/.test(lead) && lead.length <= LABEL + 1) { parts.push({ btn: true, html: anchor(one, lead.slice(0, -1).trim(), "msg-btn", newTab) }); continue; }
        // the address alone on its line: named after a short line ending in a colon just above it, if there is one
        if (!lead) {
          const prev = parts[parts.length - 1], above = prev && !prev.btn && prev.raw !== undefined ? prev.raw.trim() : "";
          if (above && /:$/.test(above) && above.length <= LABEL + 1 && !links(above).length) { parts.pop(); parts.push({ btn: true, html: anchor(one, above.slice(0, -1).trim(), "msg-btn", newTab) }); }
          else parts.push({ btn: true, html: anchor(one, ownName(one.url), "msg-btn", newTab) });
          continue;
        }
      }
      // any other line: its text, with each address as a link
      let out = "", at = 0;
      for (const l of found) { out += esc(line.slice(at, l.at)) + anchor(l, l.raw, "msg-link", newTab); at = l.at + l.raw.length; }
      parts.push({ raw: line, html: out + esc(line.slice(at)), blank: !t });
    }
    // a button brings its own spacing: an empty line right before or after one is dropped
    const kept = parts.filter((p, i) => !(p.blank && ((parts[i - 1] && parts[i - 1].btn) || (parts[i + 1] && parts[i + 1].btn))));
    return kept.map((p, i) => p.html + (!p.btn && kept[i + 1] && !kept[i + 1].btn ? "<br>" : "")).join("");
  }

  window.MDFitMsgLinks = { html };
})();
