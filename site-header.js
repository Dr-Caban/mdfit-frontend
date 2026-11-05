// The site header's hamburger menu. This is the ONLY script that handles it: page scripts must not add their own
// click handler, or one tap would open and immediately close the menu.
(function () {
  function init() {
    var btn = document.querySelector(".sh-menu-btn"), menu = document.getElementById("sh-menu");
    if (!btn || !menu || btn.dataset.ready) return;
    btn.dataset.ready = "1";
    function set(open) { menu.classList.toggle("open", open); btn.setAttribute("aria-expanded", open ? "true" : "false"); btn.setAttribute("aria-label", open ? "Close menu" : "Menu"); }
    btn.addEventListener("click", function (e) { e.stopPropagation(); set(!menu.classList.contains("open")); });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) set(false); });
    document.addEventListener("click", function (e) { if (menu.classList.contains("open") && !e.target.closest(".sh")) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.classList.contains("open")) { set(false); btn.focus(); } });
    window.addEventListener("resize", function () { if (window.innerWidth > 960) set(false); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
