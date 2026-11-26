// MD Fit member app: moments (owner, Nov 2026). Small celebrations that change every time so the app never feels
// still: a word that pops with the XP just earned, a gold vein that strikes up the screen when one of today's stones
// lights, a combo count when things are logged back to back, each with its own short sound and a hop from Solomon.
// All drawn here in the mine's own colours. They sit on top without blocking a tap and are gone in about a second.
//
//   pop     XP was earned: one of a dozen words, in gold, sapphire, emerald or amethyst, with gem shards
//   strike  a stone lit today (not the last: all four is the chest, account-chest.js) or the daily goal reached
//   combo   a second thing logged within two minutes of the last: "Combo x2", x3 ... rising in pitch
//
// Not in the Simple view, not during the tour; with reduced motion the words fade in and out and nothing flies.
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
    strike: [[[196, 0], [392, 0.05], [1568, 0.16]], [[220, 0], [440, 0.05], [1760, 0.15]]], combo: [[[988, 0], [1319, 0.07]]], chest: [[[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3], [1568, 0.46]]] };
  function sound(kind, step = 0) {
    try {
      if (localStorage.getItem("mdfit-sounds") === "off") return;
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ac = sound.ac || (sound.ac = new AC()), notes = pick(TUNES[kind] || TUNES.pop, "t" + kind), up = Math.pow(2, Math.min(step, 12) / 12);
      const play = () => { const t = ac.currentTime; notes.forEach(([f, d], i) => { const o = ac.createOscillator(), g = ac.createGain();
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
  const hop = () => { const b = document.getElementById("mg-btn"); if (!b) return; b.classList.remove("fx-hop"); void b.offsetWidth; b.classList.add("fx-hop"); setTimeout(() => b.classList.remove("fx-hop"), 900); };
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
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

  const pop = (xp) => later(() => { const tier = xp >= 40 ? "big" : xp >= 15 ? "mid" : "small"; words(pick(SAY[tier], "w" + tier), `+${xp} XP`, pick(HUES, "h")); shards(tier === "big" ? 18 : tier === "mid" ? 12 : 7); sound("pop"); hop(); buzz(15); });
  const combo = (n) => later(() => { words(`Combo x${n}`, "", HUES[1], "fx-combo"); shards(6 + n * 2); sound("combo", (n - 1) * 2); hop(); buzz([10, 30, 10]); });
  const strike = (big, small, kind) => later(() => { bolt(); words(big, small, HUES[0], "fx-strike"); sound("strike"); hop(); buzz([20, 30, 40]); });

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
      if (was.todayXp < was.dailyGoal && next.todayXp >= next.dailyGoal) strike(pick(SAY.goal, "wg"), `${next.todayXp} XP today`);
    }
  });
  document.addEventListener("mdfit:journey", () => {
    const now = litNow(), was = lit; lit = now;
    if (!was || !now || quiet() || now.lit <= was.lit || now.lit >= now.of) return; // the last stone is the chest's
    strike(pick(SAY.stone, "ws"), `${now.lit} of ${now.of} today`);
  });
  lit = litNow();
  window.MDFitFx = { pop, combo, strike, sound, on: () => !quiet() };
})();
