// MD Fit member app: moments (owner, Nov 2026). Small celebrations that change every time so the app never feels
// still: a word that pops with the XP just earned, a gold vein that strikes up the screen when one of today's stones
// lights, a combo count when things are logged back to back, each with its own short sound and a face from Solomon.
// All drawn here in the mine's own colours. They sit on top without blocking a tap and are gone in about a second.
//
//   pop     XP was earned: one of a dozen words, in gold, sapphire, emerald or amethyst, with gem shards
//   strike  a stone lit today (not the last: all four is the chest, account-chest.js) or the daily goal reached
//   combo   a second thing logged within two minutes of the last: "Combo x2", x3 ... rising in pitch
//
// Full view only: nothing here plays in the Simple view (no moments, faces, sounds or vibration). Not during the tour; with reduced motion the words fade in and out and nothing flies.
// Sounds follow the app's own switch (localStorage "mdfit-sounds" = "off").
(() => {
  "use strict";
  const M = window.MDFit; if (!M || !M.auth.get()) return;
  const A = window.MDFitApp; if (!A) return;
  const still = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const quiet = () => document.documentElement.dataset.homeView === "simple" || (window.MDFitTour && window.MDFitTour.running()) || !!document.getElementById("chest-ov") && !document.getElementById("chest-ov").hidden;
  const pick = (list, memo) => { let i = Math.floor(Math.random() * list.length); if (list.length > 1 && i === pick[memo]) i = (i + 1) % list.length; pick[memo] = i; return list[i]; }; // never the same twice running
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---- Sounds: a few short figures on sine and triangle waves; `step` raises the whole figure (combos climb)
  const TUNES = { pop: [[[784, 0], [1175, 0.08]], [[880, 0], [1319, 0.07], [1760, 0.14]], [[659, 0], [988, 0.09]], [[1047, 0], [1319, 0.06], [1568, 0.12]]],
    strike: [[[196, 0], [392, 0.05], [1568, 0.16]], [[220, 0], [440, 0.05], [1760, 0.15]]], combo: [[[988, 0], [1319, 0.07]]],
    // his moods, when no moment is sounding for him: glad (two warm notes up), proud (a major chord), worried (a
    // minor step down, then relief is the glad one), at peace (one low soft note). Sleepy and curious are silent.
    "m-happy": [[[587, 0], [880, 0.11]]], "m-proud": [[[523, 0], [659, 0.02], [784, 0.04], [1047, 0.22]]], "m-worried": [[[466, 0], [440, 0.16], [392, 0.32]]], "m-peace": [[[262, 0], [392, 0.25]]], chest: [[[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3], [1568, 0.46]]] };
  // Real recorded sounds (assets/sounds, made for MD Fit) are fetched when the app opens and decoded ahead of time,
  // so each plays the instant it is asked for. Until one has arrived (or if it never does: offline, an old browser)
  // the short synthesized figure above plays in its place. Phones only let a page make sound after a first touch,
  // so the first touch anywhere wakes the audio; from then on everything sounds without one.
  const FILES = { pop: ["pop1", "pop2", "pop3"], combo: ["combo"], strike: ["strike"], chest: ["chest"], "m-happy": ["happy"], "m-proud": ["proud"], "m-worried": ["worried"], "m-peace": ["peace"] };
  const BUF = {}, VOL = { strike: 0.8, chest: 0.9, "m-peace": 0.6, "m-worried": 0.6, "m-happy": 0.7, "m-proud": 0.7 };
  const audio = () => { const AC = window.AudioContext || window.webkitAudioContext; return AC ? sound.ac || (sound.ac = new AC()) : null; };
  function preload() {
    if (preload.done) return; preload.done = true;
    try { const ac = audio(); if (!ac || localStorage.getItem("mdfit-sounds") === "off") return;
      [...new Set(Object.values(FILES).flat())].forEach((n) => { fetch(`/assets/sounds/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((raw) => raw && new Promise((ok, no) => ac.decodeAudioData(raw, ok, no))).then((b) => { if (b) BUF[n] = b; }).catch(() => {}); });
    } catch {}
  }
  const wake = () => { try { const ac = audio(); if (ac && ac.state === "suspended") ac.resume().catch(() => {}); } catch {} preload(); };
  ["pointerdown", "touchend", "keydown"].forEach((ev) => document.addEventListener(ev, wake, { once: true, passive: true, capture: true }));
  if ("requestIdleCallback" in window) requestIdleCallback(preload, { timeout: 4000 }); else setTimeout(preload, 2500);
  // sound(kind, step, which): step raises the pitch (combos climb); which picks a file when a kind has several
  function sound(kind, step = 0, which) {
    try {
      if (localStorage.getItem("mdfit-sounds") === "off") return;
      const ac = audio(); if (!ac) return;
      const up = Math.pow(2, Math.min(step, 12) / 12), names = FILES[kind] || [], name = names.length ? names[Math.min(names.length - 1, which === undefined ? Math.floor(Math.random() * names.length) : which)] : "", buf = BUF[name];
      const notes = pick(TUNES[kind] || TUNES.pop, "t" + kind);
      const play = () => { const t = ac.currentTime;
        if (buf) { const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = buf; src.playbackRate.value = up; g.gain.value = VOL[kind] || 0.75; src.connect(g); g.connect(ac.destination); src.start(t); return; }
        notes.forEach(([f, d], i) => { const o = ac.createOscillator(), g = ac.createGain();
          o.type = kind === "strike" && i < 2 ? "triangle" : "sine"; o.frequency.value = f * up;
          g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.55);
          o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + 0.6); }); };
      if (ac.state === "suspended") ac.resume().then(play).catch(() => {}); else play();
    } catch {}
  }

  // ---- The layer
  const layer = document.createElement("div"); layer.id = "fx"; layer.setAttribute("aria-hidden", "true"); document.body.appendChild(layer);
  const live = document.createElement("p"); live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"; live.setAttribute("role", "status"); document.body.appendChild(live);
  const HUES = [["#f6dc8c", "#b98a2e"], ["#8fc2ff", "#2f6fd6"], ["#8fe3b4", "#1f8a57"], ["#cdb4ff", "#7446d8"]]; // gold, sapphire, emerald, amethyst
  const GEMS = ["#d8213c", "#3f7fe0", "#2fa06a", "#8b5cf6", "#f2a900", "#9ac85a", "#c6edff"];
  // Solomon feels each one (mdfit-guide.js feel): glad at a little, proud at more, thrilled at a lot, cheering a combo
  const G = window.MDFitGuide || {}, feel = (name, ms) => { try { return !!(G.feel && G.feel(name, ms)); } catch { return false; } };
  // Vibration. Android browsers have navigator.vibrate. iPhone browsers do not, but from iOS 18 a switch control gives
  // one small tap when it flips, so there a hidden switch is flipped once for each pulse in the pattern (the best a
  // web page can do on an iPhone: the taps are all one strength, and older iPhones stay still). A pattern is
  // [on, off, on, ...] in milliseconds, or one number.
  let hap = null;
  function tap() { try { if (!hap) { hap = document.createElement("label"); hap.setAttribute("aria-hidden", "true"); hap.style.cssText = "position:fixed;left:-200px;top:0;opacity:0;pointer-events:none"; hap.innerHTML = '<input type="checkbox" switch tabindex="-1">'; document.body.appendChild(hap); } hap.click(); } catch {} }
  // Inside the MD Fit phone app (a shell around this site) the real thing is on hand: the app's own haptics, by
  // name (light, medium, heavy, selection, success, warning). The app already taps and plays its own sound when XP
  // is earned or the daily goal is reached, so those two are left to it there ("" = nothing more from here).
  const APP = window.MDFitNative && typeof window.MDFitNative.haptic === "function" ? window.MDFitNative : null;
  const buzz = (p, style) => { try {
    if (APP) { if (style) APP.haptic(style); return; }
    if (navigator.vibrate) return void navigator.vibrate(p);
    let at = 0; [].concat(p).forEach((ms, i) => { if (i % 2 === 0) { const t = at; t ? setTimeout(tap, t) : tap(); if (ms >= 50) setTimeout(tap, t + 45); /* a long pulse is two taps */ } at += ms; });
  } catch {} };
  // A mood by itself (nothing popping with it) has its own sound and its own feel in the hand
  const BUZZ = { happy: [12, 40, 12], proud: [30, 50, 60], worried: [8, 60, 8, 60, 8], peace: [40] }, FEEL = { happy: "light", proud: "success", worried: "warning", peace: "selection" };
  const mood = (name, ms) => { if (!feel(name, ms)) return; if (TUNES["m-" + name]) sound("m-" + name); if (BUZZ[name]) buzz(BUZZ[name], FEEL[name]); }; // no face shown (Simple view, chat open): no sound, no buzz
  function words(big, small, hue, cls = "") {
    const el = document.createElement("div"); el.className = "fx-words " + cls; el.style.setProperty("--a", hue[0]); el.style.setProperty("--b", hue[1]); el.style.setProperty("--tilt", `${rnd(-5, 5).toFixed(1)}deg`);
    el.innerHTML = `<b></b>${small ? "<span></span>" : ""}`; el.firstChild.textContent = big; if (small) el.lastChild.textContent = small;
    layer.appendChild(el); live.textContent = small ? `${big}. ${small}` : big; setTimeout(() => el.remove(), 1700);
  }
  function shards(n = 10) {
    if (still()) return;
    for (let i = 0; i < n; i++) { const s = document.createElement("i"); s.className = "fx-shard"; const ang = rnd(0, Math.PI * 2), far = rnd(70, 170);
      s.style.cssText = `--x:${(Math.cos(ang) * far).toFixed(0)}px;--y:${(Math.sin(ang) * far - 30).toFixed(0)}px;--r:${rnd(-200, 200).toFixed(0)}deg;--c:${GEMS[Math.floor(Math.random() * GEMS.length)]};--s:${rnd(8, 15).toFixed(0)}px;--d:${rnd(0, 0.12).toFixed(2)}s`;
      layer.appendChild(s); setTimeout(() => s.remove(), 1300); }
  }
  // A vein of gold that cracks up the screen from the bottom edge, with two short branches
  function bolt() {
    if (still()) return;
    const W = innerWidth, H = innerHeight, x0 = rnd(W * 0.3, W * 0.7); let x = x0, y = H + 10; const pts = [[x, y]], branches = [];
    while (y > -20) { y -= rnd(40, 90); x = Math.max(20, Math.min(W - 20, x + rnd(-60, 60))); pts.push([x, y]); if (branches.length < 2 && Math.random() < 0.3) { const dir = Math.random() < 0.5 ? -1 : 1; branches.push([[x, y], [x + dir * rnd(30, 60), y - rnd(20, 50)], [x + dir * rnd(60, 110), y - rnd(50, 90)]]); } }
    const d = (p) => p.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(0)} ${b.toFixed(0)}`).join("");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "fx-bolt"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<path class="g" pathLength="1" d="${d(pts)}"/><path pathLength="1" d="${d(pts)}"/>${branches.map((b) => `<path class="br" pathLength="1" d="${d(b)}"/>`).join("")}`;
    layer.appendChild(svg); layer.classList.remove("flash"); void layer.offsetWidth; layer.classList.add("flash"); setTimeout(() => svg.remove(), 1000);
  }

  // ---- What each moment says. Picked at random, never the same one twice running.
  const SAY = { small: ["Nice", "Logged", "That counts", "Good", "Steady", "Kept"], mid: ["Strong work", "Well earned", "Solid", "On the road", "Good stone"], big: ["Rich seam", "Huge", "Deep vein", "Outstanding"],
    stone: ["Stone lit", "Another lamp", "It catches", "Lit"], goal: ["Daily goal", "Goal struck", "Goal reached"] };
  const queue = []; let running = false;
  function run() { const f = queue.shift(); if (!f) { running = false; return; } running = true; f(); setTimeout(run, still() ? 900 : 1250); }
  const later = (f) => { if (queue.length < 3) queue.push(f); if (!running) run(); };

  const pop = (xp) => later(() => { const tier = xp >= 40 ? "big" : xp >= 15 ? "mid" : "small"; words(pick(SAY[tier], "w" + tier), `+${xp} XP`, pick(HUES, "h")); shards(tier === "big" ? 18 : tier === "mid" ? 12 : 7); if (!APP) sound("pop", 0, tier === "big" ? 2 : tier === "mid" ? 1 : 0); feel(tier === "big" ? "excited" : tier === "mid" ? "proud" : "happy"); buzz(15, ""); });
  const combo = (n) => later(() => { words(`Combo x${n}`, "", HUES[1], "fx-combo"); shards(6 + n * 2); sound("combo", (n - 1) * 2); feel("cheer"); buzz([10, 30, 10], n > 2 ? "heavy" : "medium"); });
  const strike = (big, small, goal) => later(() => { bolt(); words(big, small, HUES[0], "fx-strike"); if (!(APP && goal)) sound("strike"); feel("excited", 2400); buzz([20, 30, 40], goal ? "" : "heavy"); });

  // ---- When: read what changed from the app's own events
  let prev = null, lit = null, lastGain = 0, chain = 1;
  const litNow = () => { const j = A.journey && A.journey(), s = j && !j.intro && (j.stops || []).find((x) => x.today); return s ? { lit: s.lit || 0, of: s.of || 0 } : null; };
  document.addEventListener("mdfit:rewards", (e) => {
    const next = e.detail; if (!next) return;
    const was = prev; prev = { xp: next.xp, todayXp: next.todayXp, dailyGoal: next.dailyGoal };
    if (!was || quiet()) return;
    const gained = next.xp - was.xp;
    if (gained > 0) {
      chain = Date.now() - lastGain < 120000 ? chain + 1 : 1; lastGain = Date.now();
      pop(gained); if (chain > 1) combo(chain);
      if (was.todayXp < was.dailyGoal && next.todayXp >= next.dailyGoal) strike(pick(SAY.goal, "wg"), `${next.todayXp} XP today`, true);
    }
  });
  document.addEventListener("mdfit:journey", () => {
    const now = litNow(), was = lit; lit = now;
    if (!was || !now || quiet() || now.lit <= was.lit || now.lit >= now.of) return; // the last stone is the chest's
    strike(pick(SAY.stone, "ws"), `${now.lit} of ${now.of} today`);
  });
  lit = litNow();

  // ---- How he is when nothing is happening
  // Late at night he dozes (10 PM to 5 AM); back after three days or more he is worried for a breath, then glad;
  // and now and then he simply looks around.
  const sleepyNow = () => { const h = new Date().getHours(); return h >= 22 || h < 5; };
  const settle = () => { try { if (G.rest) G.rest(sleepyNow() ? "sleepy" : ""); } catch {} };
  settle(); setInterval(settle, 5 * 60 * 1000);
  document.addEventListener("mdfit:arrive", (e) => { const away = Number((e.detail || {}).away); if (away >= 3) { mood("worried", 2200); setTimeout(() => mood("happy", 2400), 2300); } else feel("happy", 2400); }); // (an ordinary return already has its own chime, account.js ding)
  (function peek() { setTimeout(() => { try { if (!document.hidden && !still() && G.feeling && !G.feeling() && !(G.speaking && G.speaking())) feel("curious", 2800); } catch {} peek(); }, rnd(35000, 70000)); })();
  window.MDFitFx = { pop, combo, strike, sound, mood, buzz, on: () => !quiet() };
})();
