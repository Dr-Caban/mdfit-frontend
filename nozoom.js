// App-like behavior on phones: no pinch or double-tap zoom. The viewport meta (maximum-scale=1, user-scalable=no)
// covers Android and stops iOS zooming into focused inputs; iOS Safari ignores user-scalable=no for pinches, so those
// gestures are cancelled here, and touch-action removes double-tap zoom everywhere.
(function () {
  document.documentElement.style.touchAction = "manipulation";
  const stop = (e) => e.preventDefault();
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, stop, { passive: false }));
  document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
})();
