// Shared helpers for every MD Fit page: API calls, dates in the clinic's time zone, form wiring.
(() => {
  const API = window.MDFIT_CONFIG.apiUrl.replace(/\/+$/, "");
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const get = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
  let TZ = "America/New_York";

  async function api(path, body) {
    const res = await fetch(API + path, body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { status: res.status });
    return data;
  }

  // Dates are YYYY-MM-DD in the clinic's time zone, times HH:MM
  const fmtTime = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const fmtDate = (d, opts) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
  const todayInTz = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  // Wall-clock time in TZ -> UTC Date
  function zonedToUtc(date, time) {
    const guess = Date.parse(`${date}T${time}:00Z`);
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const asTz = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    return new Date(guess - (asTz - guess));
  }
  const icsStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const telHref = (p) => { const d = p.replace(/[^\d+]/g, ""); return "tel:" + (d.length === 10 ? "+1" : "") + d; };

  function formData(form) {
    const out = {};
    for (const [k, v] of new FormData(form)) {
      if (k === "areas") (out.areas ||= []).push(v);
      else out[k] = v;
    }
    return out;
  }

  // Validates, disables the button while sending, shows the server's message or error.
  function wire(form, submit, { reset = true } = {}) {
    const msg = $(".form-msg", form), btn = $("button[type=submit]", form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.className = "form-msg"; msg.textContent = "";
      if (!form.checkValidity()) {
        const bad = $(":invalid", form);
        msg.className = "form-msg err";
        msg.textContent = `Please check: ${bad.closest("label")?.firstChild?.textContent?.trim() || bad.name}.`;
        bad.focus();
        return;
      }
      btn.disabled = true;
      try {
        const out = await submit(formData(form));
        if (out && out.message) { msg.className = "form-msg ok"; msg.textContent = out.message; }
        if (reset) form.reset();
      } catch (err) {
        msg.className = "form-msg err"; msg.textContent = err.message;
      } finally { btn.disabled = false; }
    });
  }

  const AREAS = ["Neck", "Shoulder", "Upper back", "Lower back", "Hip", "Knee", "Ankle / foot", "Elbow / wrist / hand", "Other"];
  let n = 0;
  const areaChips = (areas = AREAS) => areas.map((a) => `<label class="chip"><input type="checkbox" name="areas" value="${esc(a)}" id="area-${n++}"><span>${esc(a)}</span></label>`).join("");

  let sitePromise;
  const loadSite = () => (sitePromise ||= api("/api/site").then((d) => { if (d.timeZone) TZ = d.timeZone; return d; }));

  // Live Google rating + reviews (null when the backend has no Google key or Google is unreachable)
  const GOOGLE_G = '<svg class="g-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const loadGoogleReviews = () => api("/api/reviews").then((g) => (g && g.source === "google" && g.rating ? g : null)).catch(() => null);
  function applyGoogleRating(g) {
    $$("#rating").forEach((el) => {
      el.hidden = false;
      el.innerHTML = `${GOOGLE_G}<span class="stars" aria-hidden="true">★★★★★</span><span><strong>${g.rating.toFixed(1)}</strong> from <strong>${g.count}</strong> Google reviews</span>`;
    });
  }

  // ---- Client accounts: session kept in this browser (localStorage), sent as a Bearer token.
  const KEY = "mdfit_client";
  const auth = {
    get() { try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); return s && Date.parse(s.expiresAt) > Date.now() ? s : null; } catch { return null; } },
    set(sess) { try { localStorage.setItem(KEY, JSON.stringify(sess)); } catch {} },
    clear() { try { localStorage.removeItem(KEY); } catch {} },
    client() { const s = auth.get(); return s ? s.client : null; }
  };
  async function apiAuth(method, path, body) {
    const sess = auth.get();
    const res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(sess ? { Authorization: "Bearer " + sess.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { auth.clear(); location.href = "/login?next=" + encodeURIComponent(location.pathname); throw new Error("Please log in again."); }
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { status: res.status });
    return data;
  }
  // Header link: "Log in" or "My account"
  function accountLinks() {
    const c = auth.client();
    $$("[data-account-link]").forEach((a) => {
      a.href = c ? "/account" : "/login";
      a.textContent = c ? "My account" : "Log in";
    });
  }
  document.addEventListener("DOMContentLoaded", accountLinks);

  // Video hosting: Cloudinary for every video that has been copied there (list cached on the device), Drive otherwise
  const VKEY = "mdfit-cdn2";
  let cdn = (() => { try { const c = JSON.parse(localStorage.getItem(VKEY) || "null"); return c && c.cloud ? c : null; } catch { return null; } })();
  fetch(API + "/api/videos").then((r) => r.ok ? r.json() : null).then((c) => {
    if (!c) return; cdn = c.cloud ? { cloud: c.cloud, map: c.map || {} } : null;
    try { localStorage.setItem(VKEY, JSON.stringify(cdn)); } catch {}
  }).catch(() => {});
  const hit = (id) => (cdn && cdn.map && cdn.map[id]) || null;
  const CLD = (kind, t, pid, ver, ext) => `https://res.cloudinary.com/${cdn.cloud}/${kind}/upload/${t}/${ver ? "v" + ver + "/" : ""}${pid.split("/").map(encodeURIComponent).join("/")}${ext ? "." + ext : ""}`;
  window.MDFitVideo = {
    onCdn: (id) => !!hit(id),
    mp4: (id) => { const h = hit(id); return h && h[1] === "v" ? CLD("video", "q_auto,vc_h264", h[0], h[2], "mp4") : `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&authuser=jaredcaban0nopills@gmail.com`; },
    thumb: (id, w = 480) => { const h = hit(id); if (h) return h[1] === "v" ? CLD("video", `so_1,w_${w},c_limit,q_auto`, h[0], h[2], "jpg") : CLD("image", `f_auto,q_auto,w_${w},c_limit`, h[0], h[2]); return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`; },
    preview: (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`
  };

  window.MDFit = { auth, apiAuth, accountLinks, GOOGLE_G, loadGoogleReviews, applyGoogleRating, API, $, $$, esc, get, api, fmtTime, fmtDate, todayInTz, addDays, zonedToUtc, icsStamp, telHref, formData, wire, AREAS, areaChips, loadSite };
})();
