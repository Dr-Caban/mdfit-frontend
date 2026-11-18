// MD Fit member app: the gem cave on Home. The member's program drawn as a dirt road through a cave: one chamber per
// week (or stage), one stop per session, a gem in the rock at each stop. Done stops are cracked open and lit, today's
// stop glows with Solomon and his lantern beside it, the rest wait in the dark. Under the road: today's seam (workout,
// pain check-in, daily goal) and where the road ends (the program's finish and the next gem).
// The data comes from account.js (MDFitApp.journey()); nothing here is stored or sent.
//
// Photo art: every picture is a slot. ART below maps a slot to an image path; an empty slot is drawn here in SVG and CSS,
// so the cave works with no images at all and each one can be dropped in on its own.
(() => {
  const A = window.MDFitApp, M = window.MDFit; if (!A || !M || !A.journey) return;
  const { $, esc } = M;
  const ART = { mouth: "", road: "", vault: "", guide: "", geode: "", ore: { locked: "", now: "", done: "" } };
  const GEMS = ["#d8213c", "#3f7fe0", "#2fa06a", "#8b5cf6", "#f2a900", "#9ac85a", "#c6edff"]; // ruby, sapphire, emerald, amethyst, amber, peridot, diamond
  const X = [50, 70, 76, 60, 38, 26, 34, 52]; // where each stop sits across the road, in percent

  const home = $("#view-home .col-main"); if (!home) return;
  const card = document.createElement("section");
  card.className = "card cave-card"; card.id = "cave-card"; card.hidden = true; card.setAttribute("aria-label", "Your gem cave");
  { const after = $("#next-card", home) || $("#gem-card", home); after ? after.after(card) : home.prepend(card); }

  // One stop's picture: the photo for its state when there is one, otherwise a drawn rock with its gem
  function ore(state, color) {
    if (ART.ore[state]) return `<img class="cv-ore-img" src="${esc(ART.ore[state])}" alt="" width="84" height="84">`;
    const gem = state === "locked" ? "#3a4252" : color, rock = state === "locked" ? "#1d222b" : "#2b313d", edge = state === "locked" ? "#262c37" : "#3b4352";
    return state === "done"
      ? `<svg class="cv-ore-svg" viewBox="0 0 84 84" aria-hidden="true"><path d="M8 52 16 30l18-8 6 34-14 14z" fill="${rock}" stroke="${edge}" stroke-width="2"/><path d="M76 50 68 28 50 22l-6 34 14 14z" fill="${rock}" stroke="${edge}" stroke-width="2"/><path d="M42 18 30 36l12 28 12-28z" fill="${gem}"/><path d="M42 18 30 36h24z" fill="#fff" opacity=".35"/><circle cx="62" cy="64" r="11" fill="#2E9D63" stroke="#0b0d12" stroke-width="3"/><path d="M57 64l4 4 7-8" fill="none" stroke="#fff" stroke-width="3"/></svg>`
      : `<svg class="cv-ore-svg" viewBox="0 0 84 84" aria-hidden="true"><path d="M10 54 20 26l24-12 24 10 8 30-16 18H26z" fill="${rock}" stroke="${edge}" stroke-width="2"/><path d="M20 26l22 14 26-16M42 40l-16 32M42 40l18 32" fill="none" stroke="${edge}" stroke-width="1.5"/><path d="M42 26 32 40l10 20 10-20z" fill="${gem}"/><path d="M42 26 32 40h20z" fill="#fff" opacity="${state === "locked" ? ".08" : ".35"}"/>${state === "locked" ? `<g transform="translate(52 52)"><rect x="0" y="8" width="18" height="13" rx="3" fill="#596273"/><path d="M4 8V5a5 5 0 0 1 10 0v3" fill="none" stroke="#596273" stroke-width="3"/></g>` : ""}</svg>`;
  }
  const guide = () => (ART.guide ? `<img class="cv-guide-img" src="${esc(ART.guide)}" alt="" width="92" height="92">`
    : `<svg class="cv-guide-svg" viewBox="0 0 104 96" aria-hidden="true"><path d="M24 58h58a20 20 0 0 0 2-40 26 26 0 0 0-49-6 18 18 0 0 0-11 46z" fill="#fff" stroke="#C8A763" stroke-width="4"/><circle cx="42" cy="38" r="4.5" fill="#C8A763"/><circle cx="56" cy="38" r="4.5" fill="#C8A763"/><circle cx="70" cy="38" r="4.5" fill="#C8A763"/><path d="M56 58v10" stroke="#8C7340" stroke-width="3"/><rect class="cv-lamp" x="47" y="68" width="18" height="22" rx="5" fill="#FFD98A" stroke="#8C7340" stroke-width="3"/></svg>`);
  const crystal = (lit) => `<svg class="cv-cry${lit ? " lit" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 7 9l5 13 5-13z"/><path d="M5 12 3 16l4 5zM19 12l2 4-4 5z"/></svg>`;

  // "Upper Body — 50-40-30-20-10 (light)" reads "Upper Body" on the road; the full name is on the stop's label for screen readers
  const short = (t) => String(t).split(/\s+[—–-]\s+|\s*\(/)[0].trim() || String(t);
  function line(j) {
    const now = j.stops.find((s) => s.state === "now"), t = j.today;
    if (t.workout && t.pain && t.goal) return "Seam mined. Every crystal lit. See you tomorrow.";
    if (!t.workout && now) return `${short(now.label)} today. I'll hold the lantern.`;
    if (!t.pain) return "Workout's in. Log how you feel to light the next crystal.";
    return "Nearly there. A little more XP lights the last crystal.";
  }

  function render() {
    const j = A.journey(); if (!j) { card.hidden = true; return; }
    card.hidden = false;
    if (!j.program) {
      card.innerHTML = `<div class="cv-mouth"${ART.mouth ? ` style="background-image:url('${esc(ART.mouth)}')"` : ""}><span class="cv-kicker">Your gem cave</span><b class="cv-title">${j.finished ? "You reached the vault" : "Every program is a road of gems"}</b>
        <p class="cv-sub">${j.finished ? "Every stop on your road is mined. Pick the next program to open a new cave." : "Pick a program and each session becomes a stop on the road down. Solomon carries the lantern."}</p>
        <button type="button" class="cv-start" data-goto="programs">Choose a program</button></div>`;
      return;
    }
    // Today's stop gets room above it (its Start bubble) and below it (Solomon and what he says)
    const rowH = 112, pts = []; let y = 56;
    j.stops.forEach((s, i) => { if (s.state === "now") y += i ? 62 : 70; pts.push([X[i % X.length], y]); y += rowH + (s.state === "now" ? 64 : 0); });
    const H = y + 96, end = [50, H - 62], all = [...pts, end];
    const d = all.map((p, i) => (i ? `C ${all[i - 1][0]} ${all[i - 1][1] + rowH / 2}, ${p[0]} ${p[1] - rowH / 2}, ${p[0]} ${p[1]}` : `M ${p[0]} ${p[1]}`)).join(" ");
    const lastChamber = j.chamber >= j.chambers, cleared = j.stops.every((s) => s.state === "done");
    const stopHtml = j.stops.map((s, i) => {
      const [x, y] = pts[i], color = GEMS[s.n % GEMS.length], left = x < 50;
      const act = s.state === "now" ? (j.grid ? `data-cave-start="${s.n}"` : `data-fp="${esc(j.program.id)}"`) : s.state === "done" ? `data-fp="${esc(j.program.id)}"` : "disabled";
      return `<div class="cv-stop ${s.state}" style="left:${x}%;top:${y}px;--gem:${color}">
          ${s.state === "now" ? `<span class="cv-bubble">${j.today.workout ? "Go again" : "Start"}<small>${esc(short(s.label))}${s.sub ? " · " + esc(s.sub) : ""}</small></span>` : ""}
          <button type="button" class="cv-ore" ${act} aria-label="${esc(s.label)}${s.sub ? ", " + esc(s.sub) : ""}: ${s.state === "done" ? "mined" : s.state === "now" ? "today, start" : "not open yet"}">${ore(s.state, color)}</button>
          ${s.state === "now" ? "" : `<span class="cv-cap">${esc(short(s.label))}</span>`}
          ${s.state === "now" ? `<div class="cv-guide ${left ? "right" : "left"}"><span class="cv-say">${esc(line(j))}</span>${guide()}</div>` : ""}
        </div>`;
    }).join("");
    const chip = (lit, label, attrs = "") => `<button type="button" class="cv-chip${lit ? " lit" : ""}" ${attrs}>${crystal(lit)}<span>${label}</span></button>`;
    card.innerHTML = `
      <div class="cv-mouth"${ART.mouth ? ` style="background-image:url('${esc(ART.mouth)}')"` : ""}>
        <span class="cv-kicker">Your gem cave · ${esc(j.unit)} ${j.chamber} of ${j.chambers}</span>
        <b class="cv-title">${esc(j.program.title)}</b>
        <button type="button" class="cv-guidebook" data-fp="${esc(j.program.id)}" aria-label="Open the program">Program</button>
      </div>
      <div class="cv-road" style="height:${H}px${ART.road ? `;background-image:url('${esc(ART.road)}')` : ""}">
        <i class="cv-dust d1"></i><i class="cv-dust d2"></i><i class="cv-dust d3"></i><i class="cv-dust d4"></i>
        <svg class="cv-path" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" class="cv-dirt"/><path d="${d}" class="cv-track"/></svg>
        ${stopHtml}
        <div class="cv-end${cleared ? " lit" : ""}" style="top:${end[1]}px">${ART.geode ? `<img src="${esc(ART.geode)}" alt="" width="64" height="64">` : `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 38a24 22 0 0 1 48 0c0 10-10 18-24 18S8 48 8 38z" fill="#2b313d" stroke="#3b4352" stroke-width="2"/><path d="M18 38l6-10 8 6 8-8 6 12-8 10H24z" fill="${cleared ? "#b58cff" : "#3a4252"}"/><path d="M24 28l8 6 8-8" fill="none" stroke="#fff" stroke-opacity="${cleared ? ".5" : ".12"}" stroke-width="2"/></svg>`}
          <span>${cleared ? `${esc(j.unit)} ${j.chamber} cleared` : lastChamber ? "The vault is past this chamber" : `Ladder down to ${esc(j.unit.toLowerCase())} ${j.chamber + 1}`}</span></div>
      </div>
      <div class="cv-seam" aria-label="Today's seam">
        <span class="cv-kicker">Today's seam</span>
        <div class="cv-chips">${chip(j.today.workout, "Workout")}${chip(j.today.pain, "Pain check-in", `data-goto="pain"`)}${chip(j.today.goal, "Daily goal")}</div>
        ${j.movements ? `<button type="button" class="cv-moves" data-goto="profile">${j.movements} movement${j.movements === 1 ? "" : "s"} from Dr. Jared to do today</button>` : ""}
      </div>
      <div class="cv-vault"${ART.vault ? ` style="background-image:url('${esc(ART.vault)}')"` : ""}>
        <span class="cv-kicker">Where the road ends</span>
        <p><b>${j.left}</b> stop${j.left === 1 ? "" : "s"} to the vault of ${esc(j.program.title)}${j.next ? ` · <b>${Number(j.next.xp).toLocaleString()} XP</b> to <i class="cv-next" style="--gem:${esc(j.next.color)}"></i>${esc(j.next.name)}` : ""}</p>
      </div>`;
  }
  card.addEventListener("click", (e) => { const b = e.target.closest("[data-cave-start]"); if (b) A.journeyStart(Number(b.dataset.caveStart)); });
  ["mdfit:journey", "mdfit:rewards"].forEach((ev) => document.addEventListener(ev, () => { try { render(); } catch { card.hidden = true; } }));
  try { render(); } catch { card.hidden = true; }
})();
