// Cycles the phone demo's scenes on the landing page. Pure DOM, no dependencies, no global styles.
// Pauses when the section is off-screen or the tab is hidden, and shows a single static scene when the
// visitor has asked for reduced motion. Remove app-demo.css/js from a page and nothing else changes.
(() => {
  const root = document.querySelector("[data-app-demo]");
  if (!root) return;
  const scenes = [...root.querySelectorAll(".ad-scene")];
  const pips = [...root.querySelectorAll(".ad-pip")];
  const tabs = [...root.querySelectorAll(".ad-tab")];
  if (scenes.length < 2) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HOLD = 4200;
  let at = 0, timer = null, visible = false;

  function show(i, manual) {
    at = (i + scenes.length) % scenes.length;
    scenes.forEach((s, n) => s.classList.toggle("on", n === at));
    pips.forEach((p, n) => { p.classList.toggle("on", n === at); p.setAttribute("aria-current", n === at ? "true" : "false"); });
    const tab = scenes[at].dataset.tab;
    tabs.forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
    if (manual) restart();
  }
  const stop = () => { clearInterval(timer); timer = null; };
  function restart() {
    stop();
    if (still || !visible) return;
    timer = setInterval(() => show(at + 1), HOLD);
  }

  pips.forEach((p, n) => p.addEventListener("click", () => show(n, true)));
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : restart()));
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    visible ? restart() : stop();
  }, { threshold: 0.3 }).observe(root);

  show(0);
})();

// "Add to Home Screen". Chrome hands us an install prompt we can fire on a click; every other browser gets the
// two or three steps for its own menu. Hidden when the site is already running as an installed app.
(() => {
  const btn = document.getElementById("ad-install");
  const sheet = document.getElementById("ad-sheet");
  if (!btn || !sheet) return;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;

  const ua = navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua) || (/mac/i.test(ua) && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const steps = iOS
    ? ['Tap the <b>Share</b> button at the bottom of Safari.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.']
    : android
    ? ['Tap the <b>\u22EE</b> menu at the top right of Chrome.', 'Tap <b>Install app</b> or <b>Add to Home screen</b>.', 'Tap <b>Install</b>.']
    : ['Click the <b>install icon</b> in the address bar, or the browser menu.', 'Click <b>Install</b>.'];
  sheet.querySelector(".ad-sheet-steps").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");

  let prompt = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); prompt = e; });
  addEventListener("appinstalled", () => { btn.hidden = true; close(); });

  const open = () => { sheet.hidden = false; document.body.style.overflow = "hidden"; sheet.querySelector(".ad-sheet-x").focus(); };
  function close() { sheet.hidden = true; document.body.style.overflow = ""; }
  sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest(".ad-sheet-x")) close(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) close(); });

  btn.addEventListener("click", async () => {
    if (!prompt) return open();
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (outcome === "accepted") btn.hidden = true;
    prompt = null;
  });
  btn.hidden = false;
})();
