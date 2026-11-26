// MD Fit member app: the overflowing chest (owner, Nov 2026). The day a member lights all four of today's stones
// (workout, check-in, activities, daily goal), a chest fills the screen once: they tap it, the lid lifts and the
// day's gems pour over the sides. Once per day per member on a device. Not shown in the Simple view (no gems there),
// during the tour, or over another celebration; with reduced motion the chest simply stands open.
(() => {
  "use strict";
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const A = window.MDFitApp; if (!A || !A.journey) return;
  const GEMS = ["#d8213c", "#3f7fe0", "#2fa06a", "#8b5cf6", "#f2a900", "#9ac85a", "#c6edff"]; // the mine's seven (account-cave.js)
  const me = () => { try { return ((M.auth.get() || {}).client || {}).id || "me"; } catch { return "me"; } };
  const dayNow = () => (A.today ? A.today() : new Date().toISOString().slice(0, 10));
  const key = () => `mdfit-chest-${me()}`;
  const seen = () => { try { return localStorage.getItem(key()) === dayNow(); } catch { return true; } };
  const mark = () => { try { localStorage.setItem(key(), dayNow()); } catch {} };
  const still = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const simple = () => document.documentElement.dataset.homeView === "simple";
  const busy = () => (window.MDFitTour && window.MDFitTour.running()) || document.querySelector("dialog[open]") || [...document.querySelectorAll("#ms, #mg")].some((e) => !e.hidden);

  const gem = (c, i) => `<svg class="ch-gem" viewBox="0 0 24 24" style="--c:${c};--i:${i}" aria-hidden="true"><path d="M12 2 4 9l8 13 8-13z" fill="${c}"/><path d="M12 2 4 9h16z" fill="#fff" opacity=".35"/><path d="M12 22 9 9h6z" fill="#000" opacity=".14"/></svg>`;
  // Where each gem comes to rest (x, y in px from the chest's mouth; r = turn). The first row heaps in the mouth,
  // the rest spill down both sides and onto the floor.
  const REST = [[-34, -22, -18], [-12, -30, 8], [12, -32, -6], [34, -22, 20], [-22, -44, 12], [2, -50, -10], [24, -44, 16],
    [-64, 10, -30], [64, 6, 28], [-82, 58, 14], [82, 56, -16], [-58, 86, -8], [56, 88, 22], [-104, 92, 30], [104, 94, -26], [-28, 98, 6], [26, 100, -12], [0, -64, 4]];
  const ov = document.createElement("div");
  ov.id = "chest-ov"; ov.hidden = true; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "ch-title");
  document.body.appendChild(ov);

  function show(stop) {
    mark();
    const what = stop && stop.session && stop.label ? stop.label : "";
    ov.innerHTML = `<div class="ch-glow" aria-hidden="true"></div>
      <button type="button" class="ch-chest" aria-label="Open today's chest">
        <span class="ch-gems" aria-hidden="true">${REST.map((r, i) => `<i style="--x:${r[0]}px;--y:${r[1]}px;--r:${r[2]}deg;--d:${(i * 0.06).toFixed(2)}s">${gem(GEMS[i % GEMS.length], i)}</i>`).join("")}</span>
        <svg viewBox="0 0 200 170" class="ch-art" aria-hidden="true">
          <defs><linearGradient id="ch-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3a22"/><stop offset="1" stop-color="#2e1b10"/></linearGradient>
            <linearGradient id="ch-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc8c"/><stop offset="1" stop-color="#b98a2e"/></linearGradient>
            <radialGradient id="ch-in" cx=".5" cy="1" r="1"><stop offset="0" stop-color="#ffe9a6"/><stop offset=".6" stop-color="#e2a93a"/><stop offset="1" stop-color="#5a3a12"/></radialGradient></defs>
          <path class="ch-mouth" d="M22 84h156v16H22z" fill="url(#ch-in)"/>
          <g class="ch-body"><path d="M18 88h164v62a10 10 0 0 1-10 10H28a10 10 0 0 1-10-10z" fill="url(#ch-wood)"/>
            <path d="M18 88h164v12H18zM18 146h164v6H18zM40 88h12v72H40zM148 88h12v72h-12z" fill="url(#ch-gold)"/>
            <rect x="88" y="94" width="24" height="30" rx="5" fill="url(#ch-gold)"/><circle cx="100" cy="106" r="4" fill="#2e1b10"/><path d="M98.5 108h3l1.5 9h-6z" fill="#2e1b10"/></g>
          <g class="ch-lid"><path d="M18 88V62a44 44 0 0 1 44-44h76a44 44 0 0 1 44 44v26z" fill="url(#ch-wood)"/>
            <path d="M18 78h164v10H18zM40 26h12v62H40zM148 26h12v62h-12z" fill="url(#ch-gold)"/><path d="M62 18h76" stroke="#f6dc8c" stroke-width="3" stroke-linecap="round" opacity=".5"/></g>
        </svg>
      </button>
      <div class="ch-words"><p class="ch-kicker">All four stones lit</p><h2 id="ch-title">Tap the chest</h2><p class="ch-sub" id="ch-sub">Today's haul is inside.</p></div>
      <button type="button" class="ch-go" hidden>Continue</button>`;
    ov.hidden = false; ov.classList.remove("open"); void ov.offsetWidth; ov.classList.add("in");
    const chest = ov.querySelector(".ch-chest"), go = ov.querySelector(".ch-go");
    const open = () => {
      if (ov.classList.contains("open")) return;
      ov.classList.add("open"); chest.setAttribute("aria-label", "Today's chest, overflowing"); chest.disabled = true;
      ov.querySelector("#ch-title").textContent = "Your chest is overflowing";
      ov.querySelector("#ch-sub").textContent = what ? `${what} done, and every stone lit. See you tomorrow.` : "Every stone lit today. See you tomorrow.";
      try { navigator.vibrate && navigator.vibrate([20, 40, 30, 40, 80]); } catch {}
      setTimeout(() => { go.hidden = false; go.focus({ preventScroll: true }); }, still() ? 0 : 1300);
    };
    chest.addEventListener("click", open);
    go.addEventListener("click", close);
    if (still()) open();
  }
  function close() { ov.hidden = true; ov.classList.remove("in", "open"); ov.innerHTML = ""; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ov.hidden) close(); });

  let waitT = 0, tries = 0;
  function check() {
    clearTimeout(waitT);
    if (!ov.hidden || seen() || simple()) return;
    const j = A.journey(), s = j && !j.intro && (j.stops || []).find((x) => x.today);
    if (!s || s.state !== "done" || !(s.of > 0) || s.lit < s.of) return;
    if (busy()) { if (tries++ < 30) waitT = setTimeout(check, 2000); return; } // after the other celebration, not over it
    tries = 0; show(s);
  }
  ["mdfit:journey", "mdfit:rewards"].forEach((ev) => document.addEventListener(ev, () => { clearTimeout(waitT); waitT = setTimeout(check, 900); }));
  setTimeout(check, 1500);
  window.MDFitChest = { show: (s) => show(s || null), close };
})();
