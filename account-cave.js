// MD Fit member app: the gem mine on Home. The look is an ancient hewn mine (stone gate, clay oil lamps, gold in the
// rock) with Solomon as the guide who speaks in short sayings of his own; nothing here quotes or names scripture, and
// there are no religious symbols. The member's program drawn as a dirt road through the mine: one chamber per
// week (or stage), one stop per session, a gem in the rock at each stop. Done stops are cracked open and lit, today's
// stop glows, the rest wait in the dark. Solomon is not drawn here: the one cloud that follows the member round the app
// speaks for the mine too (account-solomon.js). Under the road: today's seam (workout,
// pain check-in, daily goal) and where the road ends (the program's finish and the next gem).
// The data comes from account.js (MDFitApp.journey()); nothing here is stored or sent.
//
// Photo art: every picture is a slot. ART below maps a slot to an image path; an empty slot is drawn here in SVG and CSS,
// so the cave works with no images at all and each one can be dropped in on its own.
(() => {
  const A = window.MDFitApp, M = window.MDFit; if (!A || !M || !A.journey) return;
  const { $, esc } = M;
  const ART = { mouth: "/assets/cave/gate.webp", road: "/assets/cave/wall.webp", vault: "/assets/cave/treasury.webp", geode: "/assets/cave/geode.webp",
    ore: { locked: "/assets/cave/ore-locked.webp", now: "/assets/cave/ore-now.webp", done: "/assets/cave/ore-done.webp" } };
  // The ore photos hold a ruby; each stop's own gem colour comes from turning the hue of a second copy that is masked
  // to the gem alone, so the rock and its gold veins keep their own colour (diamond: colour drained)
  const GEM_AT = { now: "62% 40%, #000 20%, transparent 33%", done: "50% 46%, #000 13%, transparent 24%" };
  const HUE = { "#d8213c": 0, "#3f7fe0": 225, "#2fa06a": 160, "#8b5cf6": 268, "#f2a900": 50, "#9ac85a": 95 };
  const tint = (state, color) => (state === "locked" ? "" : color in HUE ? (HUE[color] ? `filter:hue-rotate(${HUE[color]}deg)` : "") : "filter:saturate(.05) brightness(1.5)");
  const shade = (url, a, b) => `background-image:linear-gradient(180deg,rgba(11,13,18,${a}),rgba(11,13,18,${b})),url('${esc(url)}')`;
  const GEMS = ["#d8213c", "#3f7fe0", "#2fa06a", "#8b5cf6", "#f2a900", "#9ac85a", "#c6edff"]; // ruby, sapphire, emerald, amethyst, amber, peridot, diamond
  const X = [50, 70, 76, 60, 38, 26, 34, 52]; // where each stop sits across the road, in percent

  const home = $("#view-home .col-main"); if (!home) return;
  const card = document.createElement("section");
  card.className = "card cave-card"; card.id = "cave-card"; card.hidden = true; card.setAttribute("aria-label", "The gem mine");
  { const after = $("#next-card", home) || $("#gem-card", home); after ? after.after(card) : home.prepend(card); }

  // One stop's picture: the photo for its state when there is one, otherwise a drawn rock with its gem
  // Movement from the same photos: a stop that was finished since the mine was last looked at plays the three ore
  // photos in order (dull rock, glowing gem, split open) once. What has been seen is kept on the device per program.
  const SEEN = "mdfit-mine-seen";
  function freshDone(j) {
    const done = j.stops.filter((s) => s.state === "done").map((s) => s.n);
    let seen = null; try { seen = JSON.parse(localStorage.getItem(SEEN) || "null"); } catch {}
    const known = seen && seen.prog === j.program.id && Array.isArray(seen.done) ? seen.done : null;
    const fresh = known ? done.filter((n) => !known.includes(n)) : done.slice(-1); // first look: the latest one, once
    try { localStorage.setItem(SEEN, JSON.stringify({ prog: j.program.id, done: [...new Set([...(known || []), ...done])].slice(-400) })); } catch {}
    // A sequence lasts 2.4 seconds; a redraw inside that time (more data arriving) carries on from where it was
    const now = Date.now(); fresh.forEach((n) => playing.set(n, now));
    for (const [n, t] of playing) if (now - t > 2400) playing.delete(n);
    return playing;
  }
  const playing = new Map(); // stop number -> when its sequence started
  const sequence = (color) => (ART.ore.locked && ART.ore.now && ART.ore.done
    ? `<span class="cv-fr f1">${ore("locked", color, true)}</span><span class="cv-fr f2">${ore("now", color, true)}</span><span class="cv-fr f3">${ore("done", color)}</span><i class="cv-burst"></i>` : ore("done", color));
  function ore(state, color, bare) {
    if (ART.ore[state] && bare) { const t = tint(state, color), m = GEM_AT[state] ? `radial-gradient(circle at ${GEM_AT[state]})` : "";
      return `<img class="cv-ore-img" src="${esc(ART.ore[state])}" alt="" width="96" height="96">${t && m ? `<img class="cv-ore-img cv-tint" src="${esc(ART.ore[state])}" alt="" width="96" height="96" style="${t};-webkit-mask-image:${m};mask-image:${m}">` : ""}`; }
    if (ART.ore[state]) { const t = tint(state, color), m = GEM_AT[state] ? `radial-gradient(circle at ${GEM_AT[state]})` : "";
      return `<img class="cv-ore-img" src="${esc(ART.ore[state])}" alt="" width="96" height="96">${t && m ? `<img class="cv-ore-img cv-tint" src="${esc(ART.ore[state])}" alt="" width="96" height="96" style="${t};-webkit-mask-image:${m};mask-image:${m}">` : ""}${state === "done" ? `<i class="cv-badge ok"></i>` : state === "locked" ? `<i class="cv-badge lock"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="#c3cad6" stroke-width="2.5"/><rect x="5" y="11" width="14" height="9" rx="2" fill="#c3cad6"/></svg></i>` : ""}`; }
    const gem = state === "locked" ? "#3a4252" : color, rock = state === "locked" ? "#1d222b" : "#2b313d", edge = state === "locked" ? "#262c37" : "#3b4352";
    return state === "done"
      ? `<svg class="cv-ore-svg" viewBox="0 0 84 84" aria-hidden="true"><path d="M8 52 16 30l18-8 6 34-14 14z" fill="${rock}" stroke="${edge}" stroke-width="2"/><path d="M76 50 68 28 50 22l-6 34 14 14z" fill="${rock}" stroke="${edge}" stroke-width="2"/><path d="M42 18 30 36l12 28 12-28z" fill="${gem}"/><path d="M42 18 30 36h24z" fill="#fff" opacity=".35"/><circle cx="62" cy="64" r="11" fill="#2E9D63" stroke="#0b0d12" stroke-width="3"/><path d="M57 64l4 4 7-8" fill="none" stroke="#fff" stroke-width="3"/></svg>`
      : `<svg class="cv-ore-svg" viewBox="0 0 84 84" aria-hidden="true"><path d="M10 54 20 26l24-12 24 10 8 30-16 18H26z" fill="${rock}" stroke="${edge}" stroke-width="2"/><path d="M20 26l22 14 26-16M42 40l-16 32M42 40l18 32" fill="none" stroke="${edge}" stroke-width="1.5"/><path d="M42 26 32 40l10 20 10-20z" fill="${gem}"/><path d="M42 26 32 40h20z" fill="#fff" opacity="${state === "locked" ? ".08" : ".35"}"/>${state === "locked" ? `<g transform="translate(52 52)"><rect x="0" y="8" width="18" height="13" rx="3" fill="#596273"/><path d="M4 8V5a5 5 0 0 1 10 0v3" fill="none" stroke="#596273" stroke-width="3"/></g>` : ""}</svg>`;
  }
  const crystal = (lit) => `<svg class="cv-cry${lit ? " lit" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 7 9l5 13 5-13z"/><path d="M5 12 3 16l4 5zM19 12l2 4-4 5z"/></svg>`;

  // "Upper Body — 50-40-30-20-10 (light)" reads "Upper Body" on the road; the full name is on the stop's label for screen readers
  const short = (t) => String(t).split(/\s+[—–-]\s+|\s*\(/)[0].trim() || String(t);
  const flame = `<svg viewBox="0 0 26 34" aria-hidden="true"><path d="M3 24h20l-3 7H6z" fill="#8a5a30"/><path class="cv-flame" d="M13 22q-8-8 0-19 8 11 0 19z" fill="#ffb347"/><path class="cv-flame" d="M13 21q-4-5 0-11 4 6 0 11z" fill="#fff1c2"/></svg>`;
  const pathOf = (all, rowH) => all.map((p, i) => (i ? `C ${all[i - 1][0]} ${all[i - 1][1] + rowH / 2}, ${p[0]} ${p[1] - rowH / 2}, ${p[0]} ${p[1]}` : `M ${p[0]} ${p[1]}`)).join(" ");

  let lastSig = "";
  function render() {
    const j = A.journey(); if (!j) { card.hidden = true; return; }
    card.hidden = false;
    // Nothing changed: leave the card alone, so an animation in flight isn't restarted by a second redraw
    const sig = JSON.stringify(j); if (sig === lastSig && card.firstChild) return; lastSig = sig;
    if (!j.program) {
      card.innerHTML = `<div class="cv-mouth${ART.mouth ? " art" : ""}"${ART.mouth ? ` style="${shade(ART.mouth, 0.55, 0.9)}"` : ""}><span class="cv-kicker">The gem mine</span><b class="cv-title">${j.finished ? "You reached the vault" : "Every program is a road of gems"}</b>
        <p class="cv-sub">${j.finished ? "Every stop on your road is mined. Pick the next program to open a new mine." : "Pick a program and each session becomes a stop on the road down. Solomon walks it with you."}</p>
        <button type="button" class="cv-start" data-goto="programs">Choose a program</button></div>`;
      return;
    }
    // Today's stop gets room above it (its Start bubble)
    const rowH = 112, pts = []; let y = 104;
    // (a long name wraps the Start bubble to three lines; it must stay clear of the label of the stop above)
    const tall = (s) => (short(s.label) + (s.sub ? " · " + s.sub : "")).length > 19;
    j.stops.forEach((s, i) => { if (s.state === "now") y += i ? (tall(s) ? 82 : 66) : 70; pts.push([X[i % X.length], y]); y += rowH; });
    const H = y + 96, end = [50, H - 62], all = [...pts, end];
    // (with the gate photo above it, the road starts out of sight under the gate rather than as a loose stub on the wall)
    const from = [50, ART.road ? -40 : 30], d = pathOf([from, ...all], rowH);
    // The stretch already travelled carries moving lights, from the gate to today's stop (the whole road once it is cleared)
    const nowAt = j.stops.findIndex((s) => s.state === "now"), lit = pathOf([from, ...(nowAt < 0 ? all : pts.slice(0, nowAt + 1))], rowH);
    let lamps = ""; for (let k = 0, ly = 150; ly < H - 110; k++, ly += 210) lamps += `<span class="cv-wlamp ${k % 2 ? "r" : "l"}" style="top:${ly}px">${flame}</span>`;
    const lastChamber = j.chamber >= j.chambers, cleared = j.stops.every((s) => s.state === "done" || s.state === "passed");
    const fresh = freshDone(j);
    const stopHtml = j.stops.map((s, i) => {
      const [x, y] = pts[i], color = GEMS[s.n % GEMS.length], left = x < 50;
      const act = j.intro ? (s.state === "done" ? "disabled" : `data-intro-go="${esc(s.ref)}"`) : s.state === "now" ? (j.grid ? `data-cave-start="${s.n}"` : `data-fp="${esc(j.program.id)}"`) : s.state === "done" ? `data-fp="${esc(j.program.id)}"` : "disabled";
      return `<div class="cv-stop ${s.state}" style="left:${x}%;top:${y}px;--gem:${color}">
          ${s.state === "now" ? `<span class="cv-bubble">${j.intro ? "Start here" : j.today.workout ? "Go again" : "Start"}<small>${esc(short(s.label))}${s.sub ? " · " + esc(s.sub) : ""}</small></span>` : ""}
          <button type="button" class="cv-ore${s.state === "done" && fresh.has(s.n) ? " mining" : ""}" ${s.state === "done" && fresh.has(s.n) ? `style="--el:-${((Date.now() - fresh.get(s.n)) / 1000).toFixed(2)}s"` : ""} ${act} aria-label="${esc(s.label)}${s.sub ? ", " + esc(s.sub) : ""}: ${s.state === "done" ? "mined" : s.state === "now" ? "today, start" : s.state === "open" ? "open, 10 XP" : s.state === "passed" ? "skipped, tap to do it" : "not open yet"}">${s.state === "done" && fresh.has(s.n) ? sequence(color) : s.state === "passed" ? ore("locked", color, true) : ore(s.state === "open" ? "now" : s.state, color)}</button>
          ${s.state === "done" ? `<i class="cv-tw t1"></i><i class="cv-tw t2"></i>` : ""}
          ${s.state === "now" ? "" : `<span class="cv-cap">${esc(short(s.label))}${j.intro && s.state === "passed" ? " · skipped" : j.intro && s.state !== "done" ? " · +10 XP" : ""}</span>`}
        </div>`;
    }).join("");
    const chip = (lit, label, attrs = "") => `<button type="button" class="cv-chip${lit ? " lit" : ""}" ${attrs}>${crystal(lit)}<span>${label}</span></button>`;
    card.innerHTML = `
      <div class="cv-mouth${ART.mouth ? " art" : ""}"${ART.mouth ? ` style="${shade(ART.mouth, 0, 0.92)}"` : ""}>
        <span class="cv-kicker">${j.intro ? "The gem mine · start here" : `The gem mine · ${esc(j.unit)} ${j.chamber} of ${j.chambers}`}</span>
        <b class="cv-title">${esc(j.program.title)}</b>
        ${j.intro ? `<button type="button" class="cv-guidebook" data-intro-skip aria-label="Skip the intro">Skip</button>` : `<button type="button" class="cv-guidebook" data-fp="${esc(j.program.id)}" aria-label="Open the program">Program</button>`}
        ${j.intro && j.hasProgram ? `<button type="button" class="cv-guidebook cv-alt" data-mine-view="program">My program</button>` : j.introAlt ? `<button type="button" class="cv-guidebook cv-alt" data-mine-view="intro">First descent</button>` : ""}
      </div>
      <div class="cv-road${ART.road ? " art" : ""}" style="height:${H}px${ART.road ? `;--wall:url('${esc(ART.road)}')` : ""}">
        <i class="cv-dust d1"></i><i class="cv-dust d2"></i><i class="cv-dust d3"></i><i class="cv-dust d4"></i>
        <svg class="cv-path" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" class="cv-dirt"/><path d="${d}" class="cv-track"/><path d="${lit}" class="cv-glow"/></svg>
        <svg class="cv-gate" viewBox="0 0 390 52" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0h390v52H272c0-40-154-40-154 0H0z" fill="#3b3024"/><path d="M0 17h130M260 17h130M0 35h118M272 35h118M40 0v17M96 17v18M300 0v17M344 17v18M70 35v17M330 35v17" stroke="#261e15" stroke-width="2"/><path d="M118 52c0-40 154-40 154 0" fill="none" stroke="#c8a763" stroke-width="2.5"/></svg>
        ${lamps}
        ${stopHtml}
        <div class="cv-end${cleared ? " lit" : ""}" style="top:${end[1]}px">${ART.geode ? `<img src="${esc(ART.geode)}" alt="" width="64" height="64">` : `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 38a24 22 0 0 1 48 0c0 10-10 18-24 18S8 48 8 38z" fill="#2b313d" stroke="#3b4352" stroke-width="2"/><path d="M18 38l6-10 8 6 8-8 6 12-8 10H24z" fill="${cleared ? "#b58cff" : "#3a4252"}"/><path d="M24 28l8 6 8-8" fill="none" stroke="#fff" stroke-opacity="${cleared ? ".5" : ".12"}" stroke-width="2"/></svg>`}
          <span>${j.intro ? (cleared ? "First descent complete" : j.next && j.next.name === "Amber" ? "Your first new gem: Amber" : "The end of your first descent") : cleared ? `${esc(j.unit)} ${j.chamber} cleared` : lastChamber ? "The treasury lies past this chamber" : `Steps down to ${esc(j.unit.toLowerCase())} ${j.chamber + 1}`}</span></div>
      </div>
      <div class="cv-seam" aria-label="Today's seam">
        <span class="cv-kicker">Today's seam</span>
        <div class="cv-chips">${chip(j.today.workout, "Workout")}${chip(j.today.pain, "Pain check-in", `data-goto="pain"`)}${chip(j.today.goal, "Daily goal")}</div>
        ${j.movements ? `<button type="button" class="cv-moves" data-goto="profile">${j.movements} movement${j.movements === 1 ? "" : "s"} from Dr. Jared to do today</button>` : ""}
      </div>
      <div class="cv-vault${ART.vault ? " art" : ""}"${ART.vault ? ` style="${shade(ART.vault, 0.86, 0.3)}"` : ""}>
        <span class="cv-kicker">The treasury ahead</span>
        <p><b>${j.left}</b> stop${j.left === 1 ? "" : "s"} to the treasury of ${esc(j.program.title)}${j.next ? ` · <b>${Number(j.next.xp).toLocaleString()} XP</b> to <i class="cv-next" style="--gem:${esc(j.next.color)}"></i>${esc(j.next.name)}` : ""}</p>
      </div>`;
  }
  // The first descent has its own footer: how far along, and what finishing earns
  function decorate() {
    const j = A.journey(); if (!j || !j.intro) return;
    const seam = card.querySelector(".cv-seam"), vault = card.querySelector(".cv-vault p"), done = j.stops.filter((s) => s.state === "done").length, todo = j.stops.filter((s) => s.state === "now" || s.state === "open");
    if (seam) seam.innerHTML = `<span class="cv-kicker">Your first descent</span><p class="cv-intro-line"><b>${done} of ${j.stops.length}</b> stops done · 10 XP each · any order</p>${todo.length ? `<p class="cv-skip-row"><span>Can't do one right now? Skip it, no XP:</span>${todo.map((x) => `<button type="button" class="cv-skip" data-intro-pass="${esc(x.ref)}" aria-label="Skip ${esc(x.label)}">${esc(x.label)}</button>`).join("")}</p>` : ""}`;
    // (real actions earn their own XP too, so Amber often arrives before the last stop)
    if (vault) vault.innerHTML = j.next && j.next.name === "Amber" ? `Finish all five and <b>Amber</b>, your first new gem, is yours.` : `<b>Amber</b> is already yours. Finish the last stops for the XP.`;
  }
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cave-start]"); if (b) return A.journeyStart(Number(b.dataset.caveStart));
    const g = e.target.closest("[data-intro-go]"); if (g) return A.introGo(g.dataset.introGo);
    const v = e.target.closest("[data-mine-view]"); if (v) return A.setMineView(v.dataset.mineView);
    const ps = e.target.closest("[data-intro-pass]"); if (ps) return A.introPass(ps.dataset.introPass);
    if (e.target.closest("[data-intro-skip]") && confirm("Skip the intro? You can replay it from Profile.")) A.introSkip();
  });
  const draw = () => { try { render(); decorate(); } catch { card.hidden = true; } };
  ["mdfit:journey", "mdfit:rewards"].forEach((ev) => document.addEventListener(ev, draw));
  draw();
})();
