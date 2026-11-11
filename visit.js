// The member's side of a built-in video visit or live room (/visit).
// Signed-in members only: who you are comes from your sign-in, never from the link. The page knocks on the waiting
// room; once Dr. Jared admits you, your browser and his connect directly (WebRTC). Sound and picture are encrypted
// by the browsers and never pass through, or get recorded by, MD Fit's server.
//
// Two kinds of session:
//   - a one to one visit: your camera and microphone are on, and only Dr. Jared sees and hears you;
//   - a live room: you come in as a VIEWER with camera and microphone off. If Dr. Jared invites you "into the dock"
//     you are asked first; saying yes makes you a SPEAKER and the room sees and hears you until he sends you back
//     to the audience or you step down yourself. Viewers are never shown who else is watching.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const API = (window.MDFIT_CONFIG.apiUrl || "").replace(/\/+$/, "");
  // Opened from the phone app into Safari: a one-time code (good for two minutes, works once) signs this browser in,
  // so the member does not have to type a password to use their camera here.
  const hand = new URLSearchParams(location.search).get("h");
  if (hand) {
    fetch(API + "/api/clients/handoff/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: hand }) })
      .then((r) => (r.ok ? r.json() : null)).then((s) => { if (s && s.token) { try { localStorage.setItem("mdfit_client", JSON.stringify(s)); } catch {} } })
      .catch(() => {}).then(() => location.replace("/visit"));
    return;
  }
  const session = (() => { try { const s = JSON.parse(localStorage.getItem("mdfit_client") || "null"); return s && Date.parse(s.expiresAt) > Date.now() ? s : null; } catch { return null; } })();
  if (!session) { $("#needLogin").hidden = false; return; }
  // Inside the MD Fit phone app, watching works but the app cannot use the camera or microphone. Safari can.
  const inApp = !!(window.MDFitNative && typeof window.MDFitNative.open === "function");
  if (inApp) $("#appNote").hidden = false;
  $("#room").hidden = false;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const say = (t) => { $("#status").textContent = t; };
  const note = (t) => { const n = $("#note"); n.textContent = t || ""; n.hidden = !t; };
  // state: idle | waiting | call.  role: viewer | speaker.  tx: the two sending slots once we have ever sent.
  const st = { local: null, cam: null, pc: null, dc: null, queue: [], ice: null, state: "idle", role: "speaker", group: false, invited: false,
    micOff: false, camOff: false, chat: [], hostSid: null, streams: new Map(), dock: [], tx: null };
  const RT = window.MDFitRT;

  async function media() {
    if (st.local) return st.local;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(inApp ? "The MD Fit app can't use your camera or microphone. Tap \"Open in Safari\" below to be seen and heard." : "This browser can't use a camera here. Open this page in Safari or Chrome.");
    try { st.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } }); st.camOff = false; }
    catch (err) {
      if (inApp) throw new Error("The MD Fit app can't use your camera or microphone. Tap \"Open in Safari\" below to be seen and heard.");
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw new Error("Camera and microphone are blocked. Allow them for this site in your browser, then try again.");
      try { st.local = await navigator.mediaDevices.getUserMedia({ audio: true }); st.camOff = true; }
      catch { throw new Error("No camera or microphone could be started on this device."); }
    }
    st.cam = st.local.getVideoTracks()[0] || null; st.micOff = false;
    $("#local").srcObject = st.local;
    return st.local;
  }
  function mediaOff() { if (st.local) st.local.getTracks().forEach((t) => t.stop()); st.local = null; st.cam = null; $("#local").srcObject = null; }
  const send = (m) => { try { if (st.dc && st.dc.readyState === "open") { st.dc.send(JSON.stringify(m)); return true; } } catch {} return false; };

  // Start or stop sending our picture and sound on the connection that is already up. The other side makes the
  // offers, so after changing what we send we ask it for a fresh one ("reneg").
  async function startSending() {
    const stream = await media(), pc = st.pc; if (!pc) return;
    if (st.tx) { for (const k of ["audio", "video"]) { const t = st.tx[k], tr = stream.getTracks().find((x) => x.kind === k); if (t && tr) { await t.sender.replaceTrack(tr); t.direction = "sendrecv"; } } }
    else { st.tx = {}; for (const tr of stream.getTracks()) { const sender = pc.addTrack(tr, stream); st.tx[tr.kind] = pc.getTransceivers().find((t) => t.sender === sender) || null; } }
  }
  async function stopSending() {
    if (st.tx) for (const k of ["audio", "video"]) { const t = st.tx[k]; if (t) { try { await t.sender.replaceTrack(null); t.direction = "recvonly"; } catch {} } }
    mediaOff();
  }

  function paint() {
    const inCall = st.state === "call", idle = st.state === "idle", speaking = inCall && st.role === "speaker" && !!st.local;
    const stage = $("#stage");
    stage.classList.toggle("preview", !inCall); stage.classList.toggle("viewer", inCall && !speaking); stage.classList.toggle("nocam", !st.local);
    $("#title").textContent = inCall && st.group ? "MD Fit live room" : "Your video visit";
    $("#join").hidden = !idle;
    // Before joining this is a check. In a one to one visit that started without a camera, it is how to turn one on.
    $("#startCam").hidden = !!st.local || (inCall && (st.group || st.role !== "speaker"));
    $("#startCam").textContent = inCall ? "Turn on my camera and microphone" : "Check my camera and microphone";
    $("#mic").hidden = $("#cam").hidden = !speaking;
    $("#mic").textContent = st.micOff ? "Unmute" : "Mute"; $("#mic").classList.toggle("off", st.micOff); $("#mic").setAttribute("aria-pressed", String(st.micOff));
    $("#cam").textContent = st.camOff ? "Camera on" : "Camera off"; $("#cam").classList.toggle("off", st.camOff); $("#cam").setAttribute("aria-pressed", String(st.camOff)); $("#cam").disabled = !st.cam;
    $("#stepDown").hidden = !(speaking && st.group);
    $("#leave").hidden = idle; $("#leave").textContent = inCall ? (st.group ? "Leave the room" : "Leave") : "Leave the waiting room";
    $("#invite").hidden = !st.invited;
    $("#roleTag").hidden = !(inCall && st.group); $("#roleTag").textContent = speaking ? "You are on screen: the room can see and hear you" : "Viewer: your camera and microphone are off";
    $("#roleTag").classList.toggle("on", speaking);
    // the dock: the other people Dr. Jared has brought on screen
    const want = st.dock.filter((d) => st.streams.has(d.sid)), box = $("#dock"), key = want.map((d) => d.sid).join(",");
    box.hidden = !(inCall && want.length);
    if (box.dataset.key !== key) { box.dataset.key = key; box.innerHTML = want.map((d) => `<div class="dtile" data-sid="${esc(d.sid)}"><video autoplay playsinline></video><span>${esc(d.name)}</span></div>`).join(""); }
    want.forEach((d) => { const v = [...box.querySelectorAll(".dtile")].find((x) => x.dataset.sid === d.sid).querySelector("video"); const s = st.streams.get(d.sid); if (v.srcObject !== s) v.srcObject = s; });
  }
  function hangUp() {
    if (st.pc) { try { st.pc.close(); } catch {} }
    Object.assign(st, { pc: null, dc: null, queue: [], chat: [], hostSid: null, streams: new Map(), dock: [], tx: null, invited: false });
    $("#chat").hidden = true; $("#pain").hidden = true; cv.hidden = true; $("#chatList").innerHTML = "";
    $("#remote").srcObject = null; $("#stage").classList.remove("has-remote"); note("");
  }
  function reset(msg) { hangUp(); st.state = "idle"; st.group = false; st.role = "speaker"; say(msg || ""); paint(); }

  // Chat, the whiteboard and the pain check-in travel on a private channel straight between this browser and
  // Dr. Jared's, with the same encryption as the call. They never pass through the server and are gone at the end.
  const cv = $("#board");
  function boardFit() { const r = cv.getBoundingClientRect(); if (r.width && (cv.width !== Math.round(r.width) || cv.height !== Math.round(r.height))) { cv.width = Math.round(r.width); cv.height = Math.round(r.height); } }
  function boardLine(m, color) { if (!Array.isArray(m.a) || !Array.isArray(m.b)) return; boardFit(); const g = cv.getContext("2d"); g.strokeStyle = color; g.lineWidth = 3; g.lineCap = "round"; g.beginPath(); g.moveTo(m.a[0] * cv.width, m.a[1] * cv.height); g.lineTo(m.b[0] * cv.width, m.b[1] * cv.height); g.stroke(); }
  { let last = null; const at = (e) => { const r = cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    cv.addEventListener("pointerdown", (e) => { last = at(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener("pointermove", (e) => { if (!last) return; const p = at(e), m = { t: "draw", a: last, b: p }; boardLine(m, "#F0A55B"); send(m); last = p; });
    const up = () => { last = null; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up); }
  function chatDraw() { const l = $("#chatList"); l.innerHTML = st.chat.map((m) => `<div class="bubble ${m.me ? "me" : ""}">${esc(m.body)}</div>`).join(""); l.scrollTop = l.scrollHeight; }
  function onData(m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "chat" && typeof m.body === "string") { st.chat.push({ me: false, body: m.body.slice(0, 1000) }); chatDraw(); }
    else if (m.t === "pain?") { $("#pain").hidden = false; const b = $("#painBtns button"); if (b) b.focus(); }
    else if (m.t === "board") { cv.hidden = !m.on; if (m.on) boardFit(); }
    else if (m.t === "draw") { if (cv.hidden) cv.hidden = false; boardLine(m, "#7AAFD7"); }
    else if (m.t === "clear") cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    else if (m.t === "room") { st.group = !!m.group; st.dock = Array.isArray(m.dock) ? m.dock.filter((d) => d && typeof d.sid === "string").map((d) => ({ sid: d.sid, name: String(d.name || "Guest").slice(0, 40) })).slice(0, 12) : []; paint(); }
  }
  $("#painBtns").innerHTML = Array.from({ length: 11 }, (_, i) => `<button type="button" class="btn" data-level="${i}" aria-label="${i} out of 10">${i}</button>`).join("");
  $("#painBtns").addEventListener("click", (e) => { const b = e.target.closest("[data-level]"); if (!b) return; if (send({ t: "pain", level: Number(b.dataset.level) })) { $("#pain").hidden = true; say("Thanks. Dr. Jared has your answer."); } });
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const body = $("#chatIn").value.trim(); if (!body) return; if (!send({ t: "chat", body })) return; st.chat.push({ me: true, body }); $("#chatIn").value = ""; chatDraw(); });

  async function connectLive() {
    const sock = await RT.connect({ namespace: "/member", token: session.token });
    if (!sock) throw new Error("Couldn't reach MD Fit. Check your connection and reload this page.");
    return sock;
  }
  RT.on("tele_waiting_room", (ev) => { st.state = "waiting"; say(ev && ev.staffOnline ? "You're in the waiting room. Dr. Jared will let you in shortly." : "You're in the waiting room. Dr. Jared isn't here yet; stay on this page."); paint(); });
  RT.on("tele_admitted", (ev) => {
    st.state = "call"; st.group = !!(ev && ev.group); st.role = ev && ev.role === "viewer" ? "viewer" : "speaker";
    if (st.role === "viewer") mediaOff(); // a viewer's camera and microphone are off, even if they tried them while waiting
    say(st.role === "viewer" ? "You're in. Your camera and microphone are off; you can see and hear Dr. Jared." : "Dr. Jared is letting you in…"); paint();
  });
  RT.on("tele_declined", (ev) => reset(ev && ev.removed ? "You were removed from this session and can't rejoin it." : "Dr. Jared can't see you right now. Message the practice from your account, or try again at your visit time."));
  RT.on("tele_moved", () => reset("You joined from another tab or device, so this one stepped back."));
  RT.on("tele_ended", (ev) => { mediaOff(); reset(ev && ev.why === "removed" ? "Dr. Jared removed you from the room." : ev && ev.why === "staff_left" ? "The session was interrupted on Dr. Jared's side. Join the waiting room again to reconnect." : "The session has ended. Thank you."); });
  // Into the dock, or back to the audience. Nothing turns on until the person says yes on this screen.
  RT.on("tele_role", async (ev) => {
    if (st.state !== "call") return;
    if (ev && ev.role === "speaker") { st.invited = true; say("Dr. Jared invited you to speak."); paint(); const b = $("#inviteYes"); if (b) b.focus(); }
    else { st.invited = false; st.role = "viewer"; if (ev && ev.opened) st.group = true; await stopSending(); send({ t: "reneg" }); say(ev && ev.opened ? "Dr. Jared opened this session to more people, so your camera and microphone are now off. Nobody new can see or hear you. He can invite you to speak." : "You're back in the audience. Your camera and microphone are off."); paint(); }
  });
  $("#inviteYes").addEventListener("click", async () => {
    try { st.role = "speaker"; await startSending(); st.invited = false; send({ t: "reneg" }); say("You're on screen. Everyone in the room can see and hear you."); }
    catch (err) { st.role = "viewer"; st.invited = false; send({ t: "declined" }); say(err.message); }
    paint();
  });
  $("#inviteNo").addEventListener("click", () => { st.invited = false; st.role = "viewer"; send({ t: "declined" }); say("You're staying a viewer. Your camera and microphone are off."); paint(); });
  $("#stepDown").addEventListener("click", () => { st.role = "viewer"; send({ t: "declined" }); stopSending().then(() => { send({ t: "reneg" }); say("You stepped down. Your camera and microphone are off."); paint(); }); });

  RT.on("tele_signal", async (d) => {
    try {
      if (d && d.sdp) {
        if (!st.pc) {
          if (!st.ice) { const r = await fetch(API + "/api/me/telehealth/ice", { headers: { Authorization: "Bearer " + session.token } }); st.ice = r.ok ? (await r.json()).iceServers || [] : []; }
          const pc = new RTCPeerConnection({ iceServers: st.ice }); st.pc = pc;
          pc.ondatachannel = (e) => { st.dc = e.channel; st.dc.onmessage = (x) => { try { onData(JSON.parse(x.data)); } catch {} }; st.dc.onopen = () => { $("#chat").hidden = false; }; };
          // The first stream is Dr. Jared's own picture; any other is someone he brought into the dock
          pc.ontrack = (e) => {
            const s = e.streams[0] || new MediaStream([e.track]);
            if (!st.hostSid) st.hostSid = s.id;
            if (s.id === st.hostSid) { $("#remote").srcObject = s; $("#stage").classList.add("has-remote"); } else st.streams.set(s.id, s);
            paint();
          };
          pc.onicecandidate = (e) => { if (e.candidate) RT.emit("tele_signal", { candidate: e.candidate }); };
          pc.onconnectionstatechange = () => {
            const s = pc.connectionState;
            if (s === "connected") { if (/letting you in|Connecting/.test($("#status").textContent)) say("You're connected."); note(""); }
            else if (s === "connecting") { if (st.role === "speaker") say("Connecting…"); }
            else if (s === "disconnected") note("Connection interrupted. Trying to recover…");
            else if (s === "failed") { say("We couldn't connect the video on this network."); note("Try switching between Wi-Fi and cellular, then join again."); }
          };
        }
        await st.pc.setRemoteDescription(d.sdp);
        // One to one: our camera and microphone go on with the first offer. A viewer sends nothing.
        // If the camera can't start, the visit still connects: they see and hear Dr. Jared and can try again.
        if (d.sdp.type === "offer" && st.role === "speaker" && !st.group && !st.tx) { try { await startSending(); } catch (err) { st.tx = null; say(err.message); } }
        for (const c of st.queue.splice(0)) await st.pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === "offer") { await st.pc.setLocalDescription(await st.pc.createAnswer()); RT.emit("tele_signal", { sdp: st.pc.localDescription }); }
        paint();
      } else if (d && d.candidate) {
        if (st.pc && st.pc.remoteDescription) await st.pc.addIceCandidate(d.candidate).catch(() => {}); else st.queue.push(d.candidate);
      }
    } catch (err) { say("There was a problem starting the video: " + err.message); }
  });
  // If the live connection drops and comes back while waiting, knock again so the place in the waiting room is kept
  // During a session, sound and picture go browser to browser, so they keep going if the connection to MD Fit drops
  // for a moment. When it comes back, say we are still here; if the session is not picked back up, say so plainly.
  let hereTimer = 0;
  document.addEventListener("mdfit:connected", () => {
    if (st.state === "waiting") RT.emit("tele_knock");
    if (st.state !== "call") return;
    RT.emit("tele_here"); clearTimeout(hereTimer);
    hereTimer = setTimeout(() => { if (st.state !== "call") return; try { RT.emit("tele_leave"); } catch {} mediaOff(); reset("The connection to MD Fit dropped and the session could not be picked back up. Join the waiting room to reconnect."); }, 30000);
  });
  document.addEventListener("mdfit:disconnected", () => { if (st.state === "call") note("Reconnecting to MD Fit. Your session continues."); });
  RT.on("tele_resumed", () => { clearTimeout(hereTimer); note(""); });

  $("#openSafari").addEventListener("click", async () => {
    $("#openSafari").disabled = true;
    try {
      const r = await fetch(API + "/api/clients/handoff", { method: "POST", headers: { Authorization: "Bearer " + session.token } });
      const d = r.ok ? await r.json() : null;
      if (!d || !d.code) throw new Error("Couldn't open Safari just now. Try again.");
      try { RT.emit("tele_leave"); } catch {}
      mediaOff(); reset("This session continues in Safari.");
      window.MDFitNative.open(location.origin + "/visit?h=" + encodeURIComponent(d.code));
    } catch (err) { say(err.message); }
    $("#openSafari").disabled = false;
  });
  $("#startCam").addEventListener("click", async () => {
    $("#startCam").disabled = true;
    try {
      if (st.state === "call") { await startSending(); send({ t: "reneg" }); say("Your camera and microphone are on."); }
      else { await media(); say(st.cam ? "Camera and microphone work." + (st.state === "idle" ? " Join when you're ready." : "") : "No camera found; your microphone works."); }
    }
    catch (err) { say(err.message); }
    $("#startCam").disabled = false; paint();
  });
  $("#join").addEventListener("click", async () => {
    $("#join").disabled = true; say("Joining…");
    try {
      await connectLive(); RT.emit("tele_knock");
      // No answer means the server is not offering video visits (or the connection dropped): say so instead of waiting forever
      setTimeout(() => { if (st.state === "idle" && /Joining/.test($("#status").textContent)) say("The video room didn't answer. Check your connection, reload this page and try again. If it keeps happening, message the practice from your account."); }, 7000);
    }
    catch (err) { say(err.message); }
    $("#join").disabled = false;
  });
  $("#mic").addEventListener("click", () => { if (!st.local) return; st.micOff = !st.micOff; st.local.getAudioTracks().forEach((t) => { t.enabled = !st.micOff; }); paint(); });
  $("#cam").addEventListener("click", () => { if (!st.cam) return; st.camOff = !st.camOff; st.cam.enabled = !st.camOff; paint(); });
  $("#leave").addEventListener("click", () => { const was = st.state; RT.emit("tele_leave"); mediaOff(); reset(was === "call" ? "You left." : "You left the waiting room."); });
  window.addEventListener("pagehide", () => { try { RT.emit("tele_leave"); } catch {} });

  say("Join when you're ready. You can check your camera and microphone first.");
  paint();
})();
