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
