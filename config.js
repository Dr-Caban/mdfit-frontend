// API address. In production every API call goes through the site's own edge guard (middleware.js: US only,
// bot filter, secret header), never straight to Railway. Locally the site talks to localhost:3000.
var MDFIT_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
window.MDFIT_CONFIG = {
  apiUrl: MDFIT_LOCAL ? "http://localhost:3000" : location.origin,
  // Live updates (new messages, bookings) need a WebSocket, which the edge proxy can't carry, so they go straight to
  // the Railway API. Every socket must present a valid login token. Keep in sync with DEFAULT_API in middleware.js.
  realtimeUrl: MDFIT_LOCAL ? "http://localhost:3000" : "https://amiable-peace-production-e382.up.railway.app"
};

// The mobile menu lives in /site-header.js: one handler, on every page.
