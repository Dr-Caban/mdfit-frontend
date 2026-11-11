// The patient's side of a built-in video visit (/visit).
// Signed-in members only: who you are comes from your sign-in, never from the link. The page checks the camera,
// knocks on the waiting room, and once Dr. Jared admits you the two browsers connect directly (WebRTC). Sound and
// picture are encrypted by the browsers and never pass through, or get recorded by, MD Fit's server.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const API = (window.MDFIT_CONFIG.apiUrl || "").replace(/\/+$/, "");
  const session = (() => { try { const s = JSON.parse(localStorage.getItem("mdfit_client") || "null"); return s && Date.parse(s.expiresAt) > Date.now() ? s : null; } catch { return null; } })();
  if (!session) { $("#needLogin").hidden = false; return; }
  $("#room").hidden = false;

  const say = (t) => { $("#status").textContent = t; };
  const note = (t) => { const n = $("#note"); n.textContent = t || ""; n.hidden = !t; };
  const st = { local: null, cam: null, pc: null, dc: null, queue: [], ice: null, state: "idle", micOff: false, camOff: false, chat: [] };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Chat, the whiteboard and the pain check-in travel on a private channel straight between the two browsers,
  // with the same encryption as the call. They never pass through MD Fit's server and are gone when the visit ends.
  const send = (m) => { try { if (st.dc && st.dc.readyState === "open") { st.dc.send(JSON.stringify(m)); return true; } } catch {} return false; };
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
    else if (m.t === "pain?") { $("#pain").hidden = false; $("#painBtns button") && $("#painBtns button").focus(); }
    else if (m.t === "board") { cv.hidden = !m.on; if (m.on) boardFit(); }
    else if (m.t === "draw") { if (cv.hidden) { cv.hidden = false; } boardLine(m, "#7AAFD7"); }
    else if (m.t === "clear") cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  }
  $("#painBtns").innerHTML = Array.from({ length: 11 }, (_, i) => `<button type="button" class="btn" data-level="${i}" aria-label="${i} out of 10">${i}</button>`).join("");
  $("#painBtns").addEventListener("click", (e) => { const b = e.target.closest("[data-level]"); if (!b) return; if (send({ t: "pain", level: Number(b.dataset.level) })) { $("#pain").hidden = true; say("Thanks. Dr. Jared has your answer."); } });
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const body = $("#chatIn").value.trim(); if (!body) return; if (!send({ t: "chat", body })) return; st.chat.push({ me: true, body }); $("#chatIn").value = ""; chatDraw(); });

  async function media() {
    if (st.local) return st.local;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser can't use a camera here. Open this page in Safari or Chrome.");
    try { st.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw new Error("Camera and microphone are blocked. Allow them for this site in your browser, then try again.");
      try { st.local = await navigator.mediaDevices.getUserMedia({ audio: true }); st.camOff = true; }
      catch { throw new Error("No camera or microphone could be started on this device."); }
    }
    st.cam = st.local.getVideoTracks()[0] || null;
    $("#local").srcObject = st.local;
    return st.local;
  }
  function paint() {
    const inCall = st.state === "call", waiting = st.state === "waiting";
    $("#stage").classList.toggle("preview", !inCall);
    $("#before").hidden = inCall || waiting; $("#during").hidden = !(inCall || waiting);
    $("#startCam").hidden = !!st.local; $("#join").hidden = !st.local;
    $("#mic").textContent = st.micOff ? "Unmute" : "Mute"; $("#mic").classList.toggle("off", st.micOff); $("#mic").setAttribute("aria-pressed", String(st.micOff));
    $("#cam").textContent = st.camOff ? "Camera on" : "Camera off"; $("#cam").classList.toggle("off", st.camOff); $("#cam").setAttribute("aria-pressed", String(st.camOff)); $("#cam").disabled = !st.cam;
    $("#leave").textContent = inCall ? "Leave" : "Leave the waiting room";
  }
  function hangUp() {
    if (st.pc) { try { st.pc.close(); } catch {} }
    st.pc = null; st.dc = null; st.queue = []; st.chat = [];
    $("#chat").hidden = true; $("#pain").hidden = true; cv.hidden = true; $("#chatList").innerHTML = "";
    $("#remote").srcObject = null; $("#stage").classList.remove("has-remote"); note("");
  }
  function reset(msg) { hangUp(); st.state = "idle"; say(msg || ""); paint(); }

  async function connectLive() {
    const sock = await window.MDFitRT.connect({ namespace: "/member", token: session.token });
    if (!sock) throw new Error("Couldn't reach MD Fit. Check your connection and reload this page.");
    return sock;
  }
  const RT = window.MDFitRT;
  RT.on("tele_waiting_room", (ev) => { st.state = "waiting"; say(ev && ev.staffOnline ? "You're in the waiting room. Dr. Jared will let you in shortly." : "You're in the waiting room. Dr. Jared isn't here yet; stay on this page."); paint(); });
  RT.on("tele_admitted", () => { st.state = "call"; say("Dr. Jared is letting you in…"); paint(); });
  RT.on("tele_declined", () => reset("Dr. Jared can't see you right now. Message the practice from your account, or try again at your visit time."));
  RT.on("tele_moved", () => reset("You joined from another tab or device, so this one stepped back."));
  RT.on("tele_ended", (ev) => reset(ev && ev.why === "staff_left" ? "The visit was interrupted on Dr. Jared's side. Join the waiting room again to reconnect." : "Your visit has ended. Thank you."));
  RT.on("tele_signal", async (d) => {
    try {
      if (d && d.sdp) {
        if (!st.pc) {
          if (!st.ice) { const r = await fetch(API + "/api/me/telehealth/ice", { headers: { Authorization: "Bearer " + session.token } }); st.ice = r.ok ? (await r.json()).iceServers || [] : []; }
          const pc = new RTCPeerConnection({ iceServers: st.ice }); st.pc = pc;
          const stream = await media(); stream.getTracks().forEach((t) => pc.addTrack(t, stream));
          pc.ondatachannel = (e) => { st.dc = e.channel; st.dc.onmessage = (x) => { try { onData(JSON.parse(x.data)); } catch {} }; st.dc.onopen = () => { $("#chat").hidden = false; }; };
          pc.ontrack = (e) => { $("#remote").srcObject = e.streams[0] || new MediaStream([e.track]); $("#stage").classList.add("has-remote"); };
          pc.onicecandidate = (e) => { if (e.candidate) RT.emit("tele_signal", { candidate: e.candidate }); };
          pc.onconnectionstatechange = () => {
            const s = pc.connectionState;
            if (s === "connected") { say("You're connected."); note(""); }
            else if (s === "connecting") say("Connecting…");
            else if (s === "disconnected") note("Connection interrupted. Trying to recover…");
            else if (s === "failed") { say("We couldn't connect the video on this network."); note("Try switching between Wi-Fi and cellular, then join again."); }
          };
        }
        await st.pc.setRemoteDescription(d.sdp);
        for (const c of st.queue.splice(0)) await st.pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === "offer") { await st.pc.setLocalDescription(await st.pc.createAnswer()); RT.emit("tele_signal", { sdp: st.pc.localDescription }); }
      } else if (d && d.candidate) {
        if (st.pc && st.pc.remoteDescription) await st.pc.addIceCandidate(d.candidate).catch(() => {}); else st.queue.push(d.candidate);
      }
    } catch (err) { say("There was a problem starting the video: " + err.message); }
  });
  // If the live connection drops and comes back while waiting, knock again so the place in the waiting room is kept
  document.addEventListener("mdfit:connected", () => { if (st.state === "waiting") RT.emit("tele_knock"); });

  $("#startCam").addEventListener("click", async () => {
    $("#startCam").disabled = true;
    try { await media(); say(st.cam ? "You look good. Join when you're ready." : "No camera found, so you'll join with sound only."); }
    catch (err) { say(err.message); }
    $("#startCam").disabled = false; paint();
  });
  $("#join").addEventListener("click", async () => {
    $("#join").disabled = true; say("Joining…");
    try {
      await connectLive(); RT.emit("tele_knock");
      // No answer means the server is not offering video visits (or the connection dropped): say so instead of waiting forever
      setTimeout(() => { if (st.state === "idle") say("The video room didn't answer. Check your connection, reload this page and try again. If it keeps happening, message the practice from your account."); }, 7000);
    }
    catch (err) { say(err.message); }
    $("#join").disabled = false;
  });
  $("#mic").addEventListener("click", () => { if (!st.local) return; st.micOff = !st.micOff; st.local.getAudioTracks().forEach((t) => { t.enabled = !st.micOff; }); paint(); });
  $("#cam").addEventListener("click", () => { if (!st.cam) return; st.camOff = !st.camOff; st.cam.enabled = !st.camOff; paint(); });
  $("#leave").addEventListener("click", () => { RT.emit("tele_leave"); reset(st.state === "call" ? "You left the visit." : "You left the waiting room."); });
  window.addEventListener("pagehide", () => { try { RT.emit("tele_leave"); } catch {} });

  say("First, turn on your camera and microphone.");
  paint();
})();
