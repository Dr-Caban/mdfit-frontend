// The site header's hamburger menu. This is the ONLY script that handles it: page scripts must not add their own
// click handler, or one tap would open and immediately close the menu.
(function () {
  // Signed-in members get the app's notification bell in the public header, next to the menu. The menu itself stays
  // (Conditions, Treatments, Book...; "Log in" becomes "My account" via common.js) so the site still reads as the site.
  function memberHeader() {
    var sh = document.querySelector(".sh");
    if (!sh || sh.classList.contains("sh-app")) return false;
    var sess = null;
    try { sess = JSON.parse(localStorage.getItem("mdfit_client") || "null"); } catch (e) {}
    if (!sess || !sess.token || !(Date.parse(sess.expiresAt) > Date.now())) return false;
    sh.classList.add("sh-app");
    var bell = document.createElement("a");
    bell.className = "sh-bell"; bell.href = "/account?notes=1"; bell.setAttribute("aria-label", "Notifications");
    bell.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg><span class="sh-bell-count" hidden></span>';
    var inner = sh.querySelector(".sh-inner"), btn = sh.querySelector(".sh-menu-btn");
    if (btn) inner.insertBefore(bell, btn); else inner.appendChild(bell); // bell sits left of the hamburger on phones
    // Same count as the app's bell: unseen in-app notifications + unread messages from Dr. Jared
    var unseen = 0; try { unseen = Number(JSON.parse(localStorage.getItem("mdfit-seen-inbox-unseen") || "0")) || 0; } catch (e) {}
    var api = (window.MDFIT_CONFIG && window.MDFIT_CONFIG.apiUrl ? window.MDFIT_CONFIG.apiUrl : location.origin).replace(/[/]+$/, "");
    var show = function (n) { var c = bell.querySelector(".sh-bell-count"); c.hidden = !n; c.textContent = n > 9 ? "9+" : n; };
    show(unseen);
    fetch(api + "/api/me/messages/unread-count", { headers: { Authorization: "Bearer " + sess.token } })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) show(unseen + (d.unread || 0)); }).catch(function () {});
    return true;
  }
  function init() {
    memberHeader();
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
