// API address. In production every API call goes through the site's own edge guard (middleware.js: US only,
// bot filter, secret header), never straight to Railway. Locally the site talks to localhost:3000.
window.MDFIT_CONFIG = {
  apiUrl: ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:3000" : location.origin
};

// The mobile menu lives in /site-header.js: one handler, on every page.
