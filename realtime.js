(function () {
  "use strict";
  var SOCKET_IO_CDN = "https://cdn.jsdelivr.net/npm/socket.io-client@4.8.1/dist/socket.io.min.js";
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

        listeners.forEach(function (l) { socket.on(l.event, l.fn); });
        return socket;
      }).catch(function () { return null; });
    },

    on: function (event, fn) {
      listeners.push({ event: event, fn: fn });
      if (socket) socket.on(event, fn);
    },

    off: function (event, fn) {
      listeners = listeners.filter(function (l) { return !(l.event === event && l.fn === fn); });
      if (socket) socket.off(event, fn);
    },

    disconnect: function () {
      if (socket) { socket.disconnect(); socket = null; }
    },

    connected: function () { return socket && socket.connected; }
  };
})();
