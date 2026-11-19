// The first-open tour. Solomon lights one thing at a time and the member does it as he says it: everything else on
// the screen is dimmed and cannot be tapped. It runs on the real app (the real chat, the real Pain Tool, the real
// road), saves nothing by itself, can be skipped from every screen, and hands the member to their road at the end.
// Started by account.js (introTour); "Replay the intro" in Profile starts it again.
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const seen = (e) => !!e && e.getClientRects().length > 0;
  const first = (s) => [...document.querySelectorAll(s)].find(seen) || null;
  const open = (id) => { const v = document.getElementById(id); return !!v && !v.hidden; };
  const guide = () => window.MDFitGuide || {};
  const shutDialogs = () => document.querySelectorAll("dialog[open]").forEach((d) => { try { d.close(); } catch {} });
  const reduce = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const CLOUD = '<svg viewBox="0 0 56 44" aria-hidden="true"><path d="M14 38h30a10 10 0 0 0 1.5-19.9A14 14 0 0 0 18.5 14 12 12 0 0 0 14 38z" fill="#fffdf7" stroke="#c9a45c" stroke-width="3"/><circle cx="22" cy="28" r="2.2" fill="#c9a45c"/><circle cx="29" cy="28" r="2.2" fill="#c9a45c"/><circle cx="36" cy="28" r="2.2" fill="#c9a45c"/></svg>';

  // snd: the line spoken aloud (the first beat has none: a browser plays no sound before the first tap).
  // One beat each. tap: the member taps the lit thing and `until` says when that has happened (a tap inside it when
  // there is no `until`). read: nothing to tap, Next moves on. A beat whose target is not on the screen is passed over.
  function beats(name) {
    return [
      { say: `Hi${name ? " " + name : ""}, I’m Solomon. Tap me to start.`, find: () => $("#mg-btn"), pad: 10, round: 40,
        before: () => { if (guide().hush) guide().hush(); if (guide().shut && open("mg")) guide().shut(); }, until: () => open("mg"),
        after: () => { try { document.dispatchEvent(new CustomEvent("mdfit:guide-asked")); } catch {} } }, // meeting him is the first stop on the road
      { snd: "02", read: true, say: "I’m with you on every screen. Any question, type it here.", find: () => { const i = $("#mg-in"); return i && (i.closest("form") || i.parentElement); }, pad: 4, round: 16 },
      { snd: "03", read: true, say: "Or tap one of these and I’ll take you there.", find: () => [...document.querySelectorAll("#mg-log .mg-opts")].filter(seen).pop(), pad: 6, round: 16,
        after: () => { if (guide().shut) guide().shut(); } },
      { snd: "04", say: "First, where it hurts. The Pain Tool lives under Train. Tap Train.", find: () => first('.tabbar [data-tab="generate"]'), pad: 2, round: 14,
        until: () => ["view-generate", "view-videos", "view-pain", "view-programs"].some(open) },
      { snd: "05", say: "This is the Pain Tool. Tap it.", find: () => first('.view:not([hidden]) [data-goto="pain"]'), pad: 4, round: 22, until: () => open("view-pain") },
      { snd: "06", say: "Tap the body where it hurts.", find: () => first("#view-pain .pm-regions") && (first("#view-pain .pm-regions").closest("svg") || first("#view-pain .pm-regions")), lift: 210, pad: 4, round: 22,
        until: () => !!$("dialog.pm-sheet[open]") },
      { snd: "07", say: "Pick the picture that looks like your pain.", find: () => first("dialog.pm-sheet[open] .pm-choices"), pad: 2, round: 18, until: () => !!$("dialog.tk-dialog[open]") },
      { snd: "08", read: true, say: "These are your movements. Start plays the videos. Add puts them on your road. They’ll be here when you want them.",
        find: () => [first("dialog.tk-dialog[open] .tk-start"), first("dialog.tk-dialog[open] .tk-add")], pad: 7, round: 16, after: shutDialogs },
      { snd: "09", say: "This builds a workout for you in a few taps. Tap Build a workout.", before: () => { shutDialogs(); location.hash = "#generate"; setTimeout(() => window.scrollTo(0, 0), 60); },
        find: () => first("#view-generate [data-build-workout]"), pad: 6, round: 16, settle: 900 },
      { snd: "10", say: "One more place, then your road. Tap Profile.", before: shutDialogs, find: () => first('.tabbar [data-tab="profile"]'), pad: 2, round: 14, until: () => open("view-profile") },
      { snd: "11", read: true, say: "Becoming a patient? Your documents live here.", find: () => first("#view-profile #p-patient"), pad: 4, round: 18 },
      { snd: "12", read: true, say: "Change how the app looks here. Refer a friend is right below it.",
        find: () => { const h = [...document.querySelectorAll("#view-profile .card-head")].find((x) => seen(x) && /^make it yours/i.test(x.textContent.trim())); return h && (h.closest(".card") || h); }, pad: 2, round: 16 },
      { snd: "13", say: "This is your road. One stone a day. Tap the stone and we begin.", before: () => { location.hash = "#home"; },
        find: () => first("#cave-card .cv-stop.now .cv-ore") || first("#cave-card .cv-stop.today .cv-ore"), pad: 12, round: 60, last: true },
    ];
  }

  // ---------- The voice. Each beat's line is a small recording. Browsers only let a page make sound after a tap, so
  // the player is made inside the member's first tap (on Solomon) and reused for every later beat. ----------
  const SOUND = "mdfit-tour-sound";
  const soundOn = () => { try { return localStorage.getItem(SOUND) !== "off"; } catch { return true; } };
  const ICON = { on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="m16.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' };

  let run = null;
  function start(o) {
    if (run) return false;
    o = o || {};
    const steps = beats(String(o.name || "").split(" ")[0].slice(0, 20));
    const root = document.createElement("div"); root.id = "gt"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "A quick tour with Solomon");
    root.innerHTML = '<i class="gt-hole"></i><i class="gt-b"></i><i class="gt-b"></i><i class="gt-b"></i><i class="gt-b"></i><i class="gt-b gt-mid"></i>'
      + '<div class="gt-bar"><i></i></div><button type="button" class="gt-snd" aria-label="Solomon\'s voice"></button><button type="button" class="gt-skip">Skip tour</button>'
      + '<div class="gt-say" aria-live="polite">' + CLOUD + '<p></p><div class="gt-acts"><button type="button" class="gt-pass">Skip this step</button><button type="button" class="gt-next">Next</button></div></div>';
    const hole = $(".gt-hole", root), blocks = [...root.querySelectorAll(".gt-b")], sayBox = $(".gt-say", root), sayP = $("p", sayBox), bar = $(".gt-bar i", root);
    let at = -1, step = null, tick = null, typing = null, missing = 0, tapped = false, moving = false, lifted = false, ended = false, audio = null, primed = "";
    const sndBtn = $(".gt-snd", root), paintSnd = () => { sndBtn.innerHTML = soundOn() ? ICON.on : ICON.off; sndBtn.setAttribute("aria-pressed", String(soundOn())); sndBtn.title = soundOn() ? "Voice on" : "Voice off"; };
    const quietNow = () => { if (audio) { try { audio.pause(); } catch {} } };
    function speakLine(id) { quietNow(); if (!audio || audio.dead || !id || !soundOn()) return; try { audio.src = `/assets/tour/${id}.mp3`; const pr = audio.play(); if (pr && pr.catch) pr.catch(() => {}); } catch {} }
    // Called inside a tap: makes the player, and starts the coming beat's line there and then so the browser allows it
    // No recording to play (not made yet, or it cannot be fetched): the tour is simply silent and the button goes away
    const noVoice = () => { quietNow(); audio = { play() {}, pause() {}, dead: true }; sndBtn.hidden = true; };
    function unlock() { if (audio) return; try { audio = new Audio(); audio.preload = "auto"; audio.addEventListener("error", noVoice); } catch { audio = null; return; } const nx = steps[at + 1]; if (nx && nx.snd && soundOn()) { primed = nx.snd; speakLine(nx.snd); } }
    paintSnd();

    function end(done) {
      if (ended) return; ended = true; run = null;
      quietNow(); clearInterval(tick); clearInterval(typing); document.removeEventListener("click", onTap, true); document.removeEventListener("keydown", onKey, true);
      root.remove(); document.body.classList.remove("gt-on", "gt-nocloud");
      if (typeof o.onEnd === "function") { try { o.onEnd(!!done); } catch {} }
    }
    const targets = () => { let t = null; try { t = step.find(); } catch {} return (Array.isArray(t) ? t : [t]).filter(seen); };
    // Dialogs opened with showModal sit above the page and make the rest of it inert, so the tour moves inside the open one
    function host(els) {
      const inDlg = els[0] && els[0].closest("dialog[open]"), anyDlg = [...document.querySelectorAll("dialog[open]")].pop();
      const want = inDlg || anyDlg || document.body; if (root.parentNode !== want) want.appendChild(root);
    }
    function place() {
      if (ended || !step) return;
      const els = targets(); host(els);
      if (!els.length) { // nothing to light yet: the whole screen is dimmed; a beat that never shows up is passed over
        hole.style.cssText = "left:50%;top:50%;width:0;height:0;opacity:0"; root.classList.add("gt-wait"); blocks[0].style.cssText = "left:0;top:0;right:0;bottom:0"; for (let i = 1; i < 5; i++) blocks[i].style.cssText = "display:none";
        if (++missing > 28) next(); return; }
      missing = 0; root.classList.remove("gt-wait");
      if (!lifted) { lifted = true; const r0 = els[0].getBoundingClientRect();
        if (step.lift) window.scrollTo(0, Math.max(0, r0.top + window.scrollY - step.lift)); else if (r0.top < 90 || r0.bottom > innerHeight - 90) els[0].scrollIntoView({ block: "center" }); }
      let l = 1e9, t = 1e9, r = -1e9, b = -1e9; els.forEach((e) => { const x = e.getBoundingClientRect(); l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom); });
      const p = step.pad || 0, W = innerWidth, H = innerHeight;
      l = Math.max(6, l - p); t = Math.max(52, t - p); r = Math.min(W - 6, r + p); b = Math.min(H - 6, b + p);
      const bar2 = first(".tabbar"); if (bar2 && root.parentNode === document.body && !els.some((e) => bar2.contains(e))) b = Math.min(b, bar2.getBoundingClientRect().top - 6);
      if (r - l < 8 || b - t < 8) return;
      hole.style.cssText = `left:${l}px;top:${t}px;width:${r - l}px;height:${b - t}px;border-radius:${step.round || 16}px;opacity:1`;
      blocks[0].style.cssText = `left:0;top:0;right:0;height:${t}px`; blocks[1].style.cssText = `left:0;top:${b}px;right:0;bottom:0`;
      blocks[2].style.cssText = `left:0;top:${t}px;width:${l}px;height:${b - t}px`; blocks[3].style.cssText = `left:${r}px;top:${t}px;right:0;height:${b - t}px`;
      blocks[4].style.cssText = step.read ? `left:${l}px;top:${t}px;width:${r - l}px;height:${b - t}px` : "display:none";
      // Solomon speaks beside it: under it when there is room, over it when not, at the foot of the screen when it fills the screen
      const h = sayBox.offsetHeight || 90; let top = b + 14;
      if (top + h > H - 10) top = t - h - 14;
      if (top < 52) top = H - h - 12;
      sayBox.style.top = Math.round(top) + "px"; sayBox.classList.add("on");
      if (!step.read && !moving && (step.until ? step.until() : tapped)) advance();
    }
    function advance() { if (moving) return; moving = true; if (step.last) return end(true); setTimeout(next, step.settle || 380); }
    function type(text) {
      clearInterval(typing); if (reduce()) { sayP.textContent = text; return; }
      let n = 0; sayP.textContent = ""; typing = setInterval(() => { n += 2; sayP.textContent = text.slice(0, n); if (n >= text.length) clearInterval(typing); }, 20);
    }
    function next() {
      if (ended) return;
      if (step && step.after) { try { step.after(); } catch {} }
      at++; step = steps[at]; if (!step) return end(true);
      missing = 0; tapped = false; moving = false; lifted = false;
      if (step.before) { try { step.before(); } catch {} }
      root.classList.toggle("gt-read", !!step.read); sayBox.classList.remove("on"); document.body.classList.toggle("gt-nocloud", at > 0);
      bar.style.width = Math.round(((at + 1) / steps.length) * 100) + "%";
      type(step.say); place();
      if (primed && primed === step.snd) primed = ""; else speakLine(step.snd); // (already speaking when the tap that led here started it)
    }
    // A tap on the lit thing reaches the app itself (the tour only watches); a tap on the dim does nothing but a nudge
    function onTap(e) {
      if (ended || !step) return;
      if (e.target.closest && e.target.closest("#gt")) {
        if (e.target.closest(".gt-skip")) { e.preventDefault(); end(false); }
        else if (e.target.closest(".gt-snd")) { try { localStorage.setItem(SOUND, soundOn() ? "off" : "on"); } catch {} paintSnd(); if (!audio) { try { audio = new Audio(); audio.addEventListener("error", noVoice); } catch {} } if (soundOn()) speakLine(step.snd); else quietNow(); }
        else if (e.target.closest(".gt-next") && step.read) next();
        else if (e.target.closest(".gt-pass") && !step.read) next();
        else if (e.target.closest(".gt-b")) { root.classList.remove("gt-nudge"); void root.offsetWidth; root.classList.add("gt-nudge"); }
        return; }
      if (!step.read && targets().some((t) => t.contains(e.target))) { tapped = true; unlock(); if (step.last) setTimeout(() => end(true), 0); }
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); } }

    run = { end }; document.body.appendChild(root); document.body.classList.add("gt-on");
    document.addEventListener("click", onTap, true); document.addEventListener("keydown", onKey, true);
    tick = setInterval(place, 110); next();
    return true;
  }

  window.MDFitTour = { start, running: () => !!run, stop: () => { if (run) run.end(false); }, beats };
})();
