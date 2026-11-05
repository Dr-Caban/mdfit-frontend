// API address. In production every API call goes through the site's own edge guard (middleware.js: US only,
// bot filter, secret header), never straight to Railway. Locally the site talks to localhost:3000.
window.MDFIT_CONFIG = {
  apiUrl: ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:3000" : location.origin
};

// Mobile hamburger menus
(function() {
  // gd-nav pages (conditions, blog, etc.)
  var gdBtn = document.querySelector('.gd-menu-btn');
  var gdLinks = document.querySelector('.gd-links');
  if (gdBtn && gdLinks) {
    gdBtn.addEventListener('click', function() {
      var isOpen = gdLinks.classList.toggle('open');
      gdBtn.setAttribute('aria-expanded', isOpen);
    });
    gdLinks.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function() {
        gdLinks.classList.remove('open');
        gdBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }
  // Main nav (events, etc.)
  var menuBtn = document.querySelector('.menu-btn');
  var menu = document.getElementById('menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', function() {
      var isOpen = menu.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', isOpen);
    });
    menu.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function() {
        menu.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();
