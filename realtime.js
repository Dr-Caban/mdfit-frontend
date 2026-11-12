(function () {
  "use strict";
  // Served from this site, not a public CDN: this script runs inside the signed-in member app and Admin,
  // so no outside host may be able to change it. The file is the unmodified socket.io-client 4.8.1 build from npm.
  var SOCKET_IO_CDN = "/vendor/socket.io-4.8.1.min.js";
  var loaded = null;

  function loadSocketIO() {
    if (loaded) return loaded;
    loaded = new Promise(function (resolve, reject) {
      if (window.io) return resolve(window.io);
      var s = document.createElement("script");
      s.src = SOCKET_IO_CDN;
      s.async = true;
      s.onload = function () { resolve(window.io); };
      s.onerror = function () { reject(new Error("Socket.IO failed to load")); };
      document.head.appendChild(s);
    });
    return loaded;
  }

  var socket = null;
  var listeners = [];

  window.MDFitRT = {
    connect: function (opts) {
      var cfg = window.MDFIT_CONFIG || {}, apiUrl = cfg.realtimeUrl || cfg.apiUrl;
      if (!apiUrl) return Promise.resolve(null);
      apiUrl = apiUrl.replace(/\/+$/, "");
      var ns = opts.namespace || "/";
      var token = opts.token;
      // "/public" needs no login (booking pages); "/member" and "/admin" do
      if (!token && ns !== "/public") return Promise.resolve(null);
      // A page that already has a live connection (e.g. the member app) keeps it: every namespace gets slots_changed
      if (ns === "/public" && socket) return Promise.resolve(socket);

      return loadSocketIO().then(function (io) {
        if (socket) { socket.disconnect(); socket = null; }
        socket = io(apiUrl + ns, {
          path: "/ws",
          transports: ["websocket", "polling"],
          auth: token ? { token: token } : {}
        });

        socket.on("connect", function () {
          document.dispatchEvent(new CustomEvent("mdfit:connected"));
        });
        socket.on("disconnect", function () {
          document.dispatchEvent(new CustomEvent("mdfit:disconnected"));
        });
        // The server turned the connection down (a sign-in that is no longer good): socket.io does not try again by
        // itself after that, so the page is told and can say so instead of looking connected to nothing.
        socket.on("connect_error", function (err) {
          document.dispatchEvent(new CustomEvent("mdfit:rt-error", { detail: { message: (err && err.message) || "" } }));
        });

        listeners.forEach(function (l) { socket.on(l.event, l.fn); });
        return socket;
      }).catch(function () { return null; });
    },

    on: function (event, fn) {
      listeners.push({ event: event, fn: fn });
      if (socket) socket.on(event, fn);
    },

    // Send an event up the live connection (used by video visits for the waiting room and call set-up)
    emit: function (event, data) { if (socket) socket.emit(event, data); },

    off: function (event, fn) {
      listeners = listeners.filter(function (l) { return !(l.event === event && l.fn === fn); });
      if (socket) socket.off(event, fn);
    },

    disconnect: function () {
      if (socket) { socket.disconnect(); socket = null; }
    },

    connected: function () { return socket && socket.connected; },

    // "Are you there?": resolves with the milliseconds the server took to answer, or null if it did not within the
    // wait. A connection can look open and be dead (a laptop that slept, a phone that changed networks).
    ping: function (waitMs) {
      return new Promise(function (resolve) {
        if (!socket || !socket.connected) return resolve(null);
        var t0 = Date.now(), done = false;
        var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, waitMs || 3000);
        socket.emit("rt_ping", function () { if (done) return; done = true; clearTimeout(timer); resolve(Date.now() - t0); });
      });
    },

    // Make sure the connection is really alive: connect if it is down; if it claims to be up but does not answer,
    // drop it and connect afresh. Resolves with the answer time in ms, or null if it is still coming back.
    revive: function () {
      if (!socket) return Promise.resolve(null);
      if (!socket.connected) { socket.connect(); return Promise.resolve(null); }
      return window.MDFitRT.ping(3000).then(function (ms) {
        if (ms === null && socket) { socket.disconnect(); socket.connect(); }
        return ms;
      });
    }
  };

  // Coming back to the page, or back online, is when a connection is most likely to be stale: check it then.
  var checking = 0;
  function check() { if (!socket || document.hidden) return; var now = Date.now(); if (now - checking < 4000) return; checking = now; window.MDFitRT.revive(); }
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
})();
