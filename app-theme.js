// How the member app looks: White or Black, Comfortable or Compact. The member picks; nothing follows the device's
// dark mode by itself, and White / Comfortable stays the look until they choose otherwise.
//
// This file is loaded in the <head>, after the stylesheets and before the page is drawn, so the saved look is on
// the <html> element before the first paint (no white flash for someone who chose Black). app-theme.css holds the
// colours and spacing for html[data-theme="black"] and html[data-layout="compact"].
//
// The choice is kept on this device and on the account (PUT /api/me/prefs), so it follows the member to another
// device. Signing out clears it from the device with everything else the app kept there (common.js, auth.clear).
(function () {
  "use strict";
  var KEY = "mdfit_looks";
  var THEMES = ["white", "black"], LAYOUTS = ["comfortable", "compact"];
  var BAR = { white: null, black: "#0B0D11" }; // the phone's status bar colour; null = what the page asked for
  var root = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  var metaWas = meta ? meta.getAttribute("content") : null;

  function clean(v) {
    v = v || {};
    return { theme: THEMES.indexOf(v.theme) >= 0 ? v.theme : "white", layout: LAYOUTS.indexOf(v.layout) >= 0 ? v.layout : "comfortable" };
  }
  function readSaved() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function writeSaved(synced) { try { localStorage.setItem(KEY, JSON.stringify({ theme: cur.theme, layout: cur.layout, synced: !!synced })); } catch (e) {} }

  var saved = readSaved();
  var cur = clean(saved);
  var chosenHere = !!saved;                    // this device already holds a choice
  var unsent = !!(saved && saved.synced === false); // ...that the account has not been told about yet

  function apply() {
    root.dataset.theme = cur.theme;
    root.dataset.layout = cur.layout;
    if (meta) meta.setAttribute("content", BAR[cur.theme] || metaWas || "");
  }
  apply();

  function signedIn() { try { return !!(window.MDFit && window.MDFit.auth && window.MDFit.auth.get()); } catch (e) { return false; } }
  function announce() { try { document.dispatchEvent(new CustomEvent("mdfit:theme", { detail: { theme: cur.theme, layout: cur.layout } })); } catch (e) {} }
  // Tell the account. A failure (offline, or a server that does not know the route yet) never undoes the choice:
  // it stays on this device and is sent again the next time the app opens.
  function send() {
    if (!signedIn()) return;
    var sent = { theme: cur.theme, layout: cur.layout };
    try {
      window.MDFit.apiAuth("PUT", "/api/me/prefs", sent).then(function () {
        // still signed in (signing out wipes the device, and must stay wiped) and still the current choice
        if (signedIn() && sent.theme === cur.theme && sent.layout === cur.layout) { unsent = false; writeSaved(true); }
      }).catch(function () {});
    } catch (e) {}
  }

  function get() { return { theme: cur.theme, layout: cur.layout }; }
  function set(next) {
    next = next || {};
    var want = clean({ theme: next.theme === undefined ? cur.theme : next.theme, layout: next.layout === undefined ? cur.layout : next.layout });
    // an unknown value is ignored, not turned into the default
    if (next.theme !== undefined && THEMES.indexOf(next.theme) < 0) want.theme = cur.theme;
    if (next.layout !== undefined && LAYOUTS.indexOf(next.layout) < 0) want.layout = cur.layout;
    if (want.theme === cur.theme && want.layout === cur.layout) { if (unsent) send(); return get(); } // nothing to change
    cur = want; chosenHere = true; unsent = true;
    apply(); writeSaved(false);
    announce();
    send();
    return get();
  }
  window.MDFitTheme = { get: get, set: set };

  // Once the app is up: a device with an unsent choice sends it; otherwise the account's saved look is adopted when
  // it differs (a second phone, or the first sign-in after signing out).
  function meetAccount() {
    if (!signedIn()) return;
    if (chosenHere && unsent) { send(); return; }
    try {
      window.MDFit.apiAuth("GET", "/api/me/guide").then(function (g) {
        var p = g && g.prefs; if (!p || unsent) return;
        var theirs = clean(p);
        if (THEMES.indexOf(p.theme) < 0 && LAYOUTS.indexOf(p.layout) < 0) return; // the account holds no choice yet
        var changed = theirs.theme !== cur.theme || theirs.layout !== cur.layout;
        cur = theirs; chosenHere = true; apply(); writeSaved(true);
        if (changed) announce();
      }).catch(function () {});
    } catch (e) {}
  }

  // ---- "Make it yours" on the Profile tab
  var PICKS = [
    { key: "theme", name: "Theme", options: [["white", "White", "Light and bright"], ["black", "Black", "Easy on the eyes at night"]] },
    { key: "layout", name: "Layout", options: [["comfortable", "Comfortable", "More room"], ["compact", "Compact", "More on each screen"]] }
  ];
  function card() { return document.getElementById("p-looks"); }
  function mark() {
    var box = card(); if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll("[data-look]"), function (b) {
      var on = cur[b.dataset.look] === b.dataset.value;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }
  function build() {
    var box = card(); if (!box || box.dataset.built) return;
    box.dataset.built = "1";
    box.innerHTML = '<div class="card-head"><span class="label">Make it yours</span></div>' +
      '<p class="muted small">How the app looks for you. It changes right away and is saved to your account.</p>' +
      PICKS.map(function (p) {
        return '<p class="looks-name" id="p-looks-' + p.key + '">' + p.name + '</p>' +
          '<div class="hb-norm p-looks" role="radiogroup" aria-labelledby="p-looks-' + p.key + '">' +
          p.options.map(function (o) { return '<button type="button" role="radio" data-look="' + p.key + '" data-value="' + o[0] + '" aria-checked="false">' + o[1] + ' <small>' + o[2] + '</small></button>'; }).join("") +
          '</div>';
      }).join("");
    box.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-look]") : null; if (!b) return;
      var next = {}; next[b.dataset.look] = b.dataset.value; set(next);
    });
    // a radio group: the arrow keys move the choice, Tab leaves the group
    box.addEventListener("keydown", function (e) {
      var b = e.target.closest ? e.target.closest("[data-look]") : null; if (!b) return;
      var step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (!step) return;
      e.preventDefault();
      var all = Array.prototype.slice.call(b.parentNode.querySelectorAll("[data-look]"));
      var to = all[(all.indexOf(b) + step + all.length) % all.length];
      var next = {}; next[to.dataset.look] = to.dataset.value; set(next); to.focus();
    });
    mark();
    box.hidden = false;
  }
  document.addEventListener("mdfit:theme", mark);
  // another tab of the app on this device changed the look
  window.addEventListener("storage", function (e) {
    if (e.key !== KEY || !e.newValue) return;
    var theirs = clean(readSaved());
    if (theirs.theme === cur.theme && theirs.layout === cur.layout) return;
    cur = theirs; apply(); announce();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  if (document.readyState === "complete") setTimeout(meetAccount, 0); else window.addEventListener("load", function () { setTimeout(meetAccount, 0); });
})();
