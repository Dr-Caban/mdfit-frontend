// Sunny (MD Fit Intelligence): the gold cloud to tap and talk to, on every screen of the member app.
//
// Sunny is a guide to the app, not a doer of clinical things: it reads what the member writes, works out what they are
// trying to do, and offers the places in the app that fit as selections. Tapping one takes them there. It knows what
// is waiting for this member (a visit, an invoice, forms, a message) because the app already loaded it, and it offers
// that first. Two small jobs it does itself: saving a reminder to the calendar, and switching the theme or layout.
//
// Privacy: by default what is typed is understood ON THIS DEVICE against the word lists below and is never sent
// anywhere. The server is told only that an answer was given and which kind (one word from a fixed list), so it can
// count the free plan's daily answers. A reminder's title is built from the app's own names (a program, "Workout"),
// never from the typed sentence. No analytics, no third parties.
//
// When the practice has switched on its assistant (GET /api/me/guide says ai: true), a typed question that the device
// does not answer itself goes to MD Fit's own server (/api/me/guide/ask) to be read there. Still kept on the device in
// that mode: anything that sounds like an emergency, reminders, theme and layout, and every question about the
// member's own account (visits, invoices, forms, messages, streak). If the assistant is off or does not answer, the
// device understands the message itself, exactly as in the default mode. The line under the box says which is true.
//
// With the assistant on, an answer can also carry suggestions: programs, exercise videos and a general tip from the
// app's own library. The server keeps them on the member's record and the app shows them on Home under "Suggested for
// you", labeled Suggested, apart from what Dr. Jared recommends. A members-only program is shown locked and opens the
// membership page. On the device alone nothing is suggested or saved.
//
// Free accounts get a daily allowance the server counts in tokens (unit: "tokens"); members, people with an active
// treatment plan and inpatients are unlimited (left: null). An older server counts answers instead; both are read.
(() => {
  "use strict";
  const App = window.MDFitApp, M = window.MDFit;
  let G = { known: false, plan: "free", limit: null, left: null, unit: "answers", reminders: [], ai: false };
  const dayRows = (d) => { try { return d >= M.todayInTz() ? G.reminders.filter((r) => r.date === d).map((r) => ({ k: "reminder", t: r.title, s: `${M.fmtTime(r.time)} · reminder` })) : []; } catch { return []; } };
  window.MDFitGuide = { day: dayRows }; // the calendar asks for a day's reminders (account.js dayItems)
  if (!App || !M || typeof App.client !== "function" || !App.client()) return;

  const PHONE_TEL = "+19413130562", PHONE_SAY = "941-313-0562", QUIET_ABOVE = 5;
  // In tokens: an answer from the assistant uses about 3,000, one found on the device 300 (server's count)
  const PER_ANSWER = 3000;
  const first = () => { const c = App.client() || {}; return String(c.firstName || c.name || "").trim().split(/\s+/)[0] || "there"; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const phone = () => window.matchMedia("(max-width: 720px)").matches;
  const money = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);
  const post = (path, body) => M.apiAuth("POST", path, body);

  // ---------- where the guide can take someone, and the words that point there ----------
  const PLACES = [
    { id: "book", kind: "book", label: "Schedule an appointment", name: "scheduling", kw: ["appointment", "schedule", "book", "booking", "see the doctor", "see dr", "evaluation", "eval", "consult", "come in", "availability", "reschedule"] },
    { id: "pain", kind: "pain", label: "Open the pain tool", name: "the pain tool", kw: ["pain", "hurt", "hurts", "hurting", "ache", "aches", "aching", "sore", "stiff", "tight", "injury", "injured", "swollen", "strain", "sprain", "pinch", "tweak", "tweaked", "flare"] },
    { id: "programs", kind: "programs", label: "Browse programs", name: "Programs", kw: ["program", "programs", "plan", "routine", "protocol", "rehab", "course"] },
    { id: "generate", kind: "workout", label: "Build a workout", name: "the workout builder", kw: ["workout", "workouts", "work out", "exercise", "exercises", "train", "training", "gym", "lift", "lifting"] },
    { id: "videos", kind: "videos", label: "Watch the videos", name: "the video library", kw: ["video", "videos", "watch", "demo", "how do i do", "form", "technique"] },
    { id: "messages", kind: "messages", label: "Message Dr. Jared", name: "Messages", kw: ["message", "messages", "text him", "ask dr", "ask the doctor", "question for", "talk to", "contact", "write to", "reply"] },
    { id: "progress", kind: "progress", label: "See my progress", name: "Progress", kw: ["progress", "streak", "xp", "stats", "level", "badge", "badges", "points", "history", "calendar"] },
    { id: "learn", kind: "learn", label: "Lectures and live Q&A", name: "Lectures", kw: ["learn", "lecture", "lectures", "class", "education", "q&a", "live"] },
    { id: "tips", kind: "learn", label: "Health tips", name: "Health tips", kw: ["tip", "tips", "advice", "nutrition", "diet", "sleep", "recipe"] },
    { id: "leaders", kind: "progress", label: "Leaderboard", name: "the leaderboard", kw: ["leaderboard", "rank", "ranking", "compete", "league"] },
    { id: "premium", kind: "membership", label: "Membership and billing", name: "Membership", kw: ["membership", "member", "subscribe", "subscription", "upgrade", "cancel", "billing", "payment", "price", "cost", "how much", "card", "charge", "refund"] },
    { id: "profile", kind: "profile", label: "My profile and visits", name: "your profile", kw: ["profile", "account", "password", "email", "my visits", "documents", "intake", "forms", "paperwork", "settings"] },
    { id: "visit", kind: "visit", label: "Join my video visit", name: "your video visit", kw: ["video visit", "telehealth", "video call", "video session", "virtual visit", "zoom"] },
    { id: "call", kind: "other", label: `Call the clinic · ${PHONE_SAY}`, kw: ["call", "phone", "speak to", "human", "real person", "front desk", "phone number"] }
  ];
  // Body areas: w = words a member might type; f = words to find in the app's own program titles and pain-track regions
  const AREAS = {
    knee: { w: ["knee", "knees", "patella", "acl", "meniscus"], f: ["knee"] },
    back: { w: ["my back", "lower back", "low back", "upper back", "mid back", "lumbar", "spine", "sciatica", "disc", "back pain", "back hurts", "back is"], f: ["back"] },
    shoulder: { w: ["shoulder", "shoulders", "rotator", "cuff"], f: ["shoulder", "rotator"] },
    hip: { w: ["hip", "hips", "glute", "glutes", "groin"], f: ["hip", "glute", "glutes", "groin"] },
    neck: { w: ["neck", "cervical"], f: ["neck"] },
    ankle: { w: ["ankle", "ankles", "achilles"], f: ["ankle", "calf"] },
    foot: { w: ["foot", "feet", "heel", "plantar", "arch"], f: ["foot", "plantar"] },
    elbow: { w: ["elbow", "elbows", "forearm", "forearms"], f: ["elbow", "forearm"] },
    wrist: { w: ["wrist", "wrists", "hand", "hands", "carpal"], f: ["wrist", "forearm"] },
    calf: { w: ["calf", "calves", "shin", "shins"], f: ["calf"] },
    chest: { w: ["chest", "pec", "pecs", "rib", "ribs"], f: ["chest", "ribs"] },
    leg: { w: ["hamstring", "hamstrings", "quad", "quads", "thigh", "thighs"], f: ["hamstring", "thigh", "quad"] },
    jaw: { w: ["jaw", "tmj", "headache", "headaches"], f: ["jaw", "head"] }
  };
  const URGENT = /\b(911|emergency|can'?t breathe|cannot breathe|chest pain|heart attack|stroke|passed out|fainted|suicid|kill myself|numb(ness)? in my (face|arm)|severe bleeding|overdos)/i;
  const rx = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const has = (text, phrase) => new RegExp(`(^|[^a-z])${rx(phrase)}([^a-z]|$)`).test(text);
  const norm = (s) => " " + String(s || "").toLowerCase().replace(/[^a-z0-9'&: ]+/g, " ") + " ";
  function understand(raw) {
    const text = norm(raw);
    const scored = PLACES.map((p) => ({ p, n: p.kw.filter((w) => has(text, w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.p);
    const pained = scored.some((p) => p.id === "pain");
    let area = Object.keys(AREAS).find((a) => AREAS[a].w.some((w) => has(text, w))) || "";
    if (!area && pained && has(text, "back")) area = "back";
    return { text, area, places: scored, pained, urgent: URGENT.test(raw || "") };
  }

  // ---------- what the app already knows is waiting for this member (read fresh each time; never sent anywhere) ----------
  const state = () => { try { return (App.state && App.state()) || {}; } catch { return {}; } };
  const nextVisit = (s) => { const t = M.todayInTz(); return (((s.appts || {}).upcoming) || []).filter((a) => a && a.status !== "cancelled" && a.date >= t).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))[0] || null; };
  function whenWords(a) {
    const t = M.todayInTz(), d = a.date;
    const day = d === t ? "today" : d === M.addDays(t, 1) ? "tomorrow" : d <= M.addDays(t, 6) ? M.fmtDate(d, { weekday: "long" }) : "on " + M.fmtDate(d, { month: "short", day: "numeric" });
    return `${day} at ${M.fmtTime(a.time)}`;
  }
  const list = (parts) => (parts.length < 2 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]);
  function waiting() {
    const s = state(), opts = [], parts = [], sig = [];
    const invited = !!s.invited, invoices = (s.invoices || []).filter((v) => v && v.number && v.path), d = s.docs, unread = Number(s.unread) || 0, v = nextVisit(s);
    if (invited) { opts.push({ label: "Join your video visit", gold: true, href: "/visit" }); sig.push("video"); }
    for (const inv of invoices.slice(0, 3)) { opts.push({ label: `Pay invoice ${inv.number}`, sub: money(inv.amount), href: inv.path }); sig.push("inv" + inv.number); }
    if (invoices.length) parts.push(invoices.length === 1 ? "an invoice to pay" : `${invoices.length} invoices to pay`);
    const formsLeft = d && !d.done && d.total && (d.completed > 0 || v) ? Math.max(1, d.total - (d.completed || 0)) : 0;
    if (formsLeft) { opts.push({ label: "Finish your forms", sub: `${d.completed || 0} of ${d.total} done`, href: "/intake?me=1" }); parts.push(formsLeft === 1 ? "one form to finish" : `${formsLeft} forms to finish`); sig.push("forms" + formsLeft); }
    if (unread) { opts.push({ label: unread === 1 ? "Read your new message" : "Read your new messages", hash: "messages", name: "Messages" }); parts.push(unread === 1 ? "a new message" : `${unread} new messages`); sig.push("msg" + unread); }
    if (v) { opts.push({ label: `Your visit ${whenWords(v)}`, sub: v.typeName || "", hash: "profile", name: "your profile" }); parts.unshift(`a visit ${whenWords(v)}`); sig.push("visit" + v.date + v.time); }
    const line = [invited ? "Dr. Jared invited you to a video session." : "", parts.length ? `You have ${list(parts)}.` : ""].filter(Boolean).join(" ");
    return { opts, line, sig: sig.join("|") };
  }

  // ---------- the cloud and the chat ----------
  const CP = "M17 38a11 11 0 0 1-2.2-21.8A13 13 0 0 1 39.5 11.2 10 10 0 0 1 53 20.5 9 9 0 0 1 50 38z";
  const cloud = (cls) => `<svg viewBox="0 0 64 44" class="${cls}" aria-hidden="true"><path class="mg-echo" d="${CP}"/><path class="mg-body" d="${CP}"/><g class="mg-dots"><circle cx="23.5" cy="27" r="2.6"/><circle cx="32" cy="27" r="2.6"/><circle cx="40.5" cy="27" r="2.6"/></g></svg>`;
  const ICON = {
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm12 8v10H5V10z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5 21 12 3 3.5v6.6l11 1.9-11 1.9z"/></svg>',
    x: '<svg viewBox="0 0 24 24" class="mg-line" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    down: '<svg viewBox="0 0 24 24" class="mg-line" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" class="mg-lock-ic" aria-hidden="true"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4z"/></svg>'
  };
  const btn = document.createElement("button"); btn.id = "mg-btn"; btn.type = "button"; btn.setAttribute("aria-label", "Open Sunny, MD Fit Intelligence: tap me to talk"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "mg"); btn.innerHTML = cloud("") + '<i class="mg-dot" hidden></i>';
  const tag = document.createElement("span"); tag.id = "mg-tag"; tag.textContent = "Tap me to talk"; tag.setAttribute("aria-hidden", "true");
  const scrim = document.createElement("div"); scrim.id = "mg-scrim"; scrim.hidden = true;
  const box = document.createElement("section"); box.id = "mg"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Sunny, MD Fit Intelligence");
  box.innerHTML = `<header class="mg-head"><div class="mg-grab"></div><div class="mg-in">${cloud("mg-mini")}<div class="mg-who"><b>Sunny</b><span>MD Fit Intelligence</span></div>
      <button type="button" id="mg-x" aria-label="Close Sunny">${ICON.x}${ICON.down}</button></div></header>
    <div id="mg-log" role="log" aria-live="polite" aria-label="Conversation with Sunny"></div>
    <div id="mg-meter" hidden></div>
    <form id="mg-form"><input id="mg-in" autocomplete="off" maxlength="200" enterkeyhint="send" placeholder="Tell me what you're looking for" aria-label="Tell Sunny what you are looking for"><button aria-label="Send">${ICON.send}</button></form>
    <p class="mg-fine" id="mg-fine"></p>`;
  document.body.append(btn, tag, scrim, box);
  const log = box.querySelector("#mg-log"), input = box.querySelector("#mg-in"), meterEl = box.querySelector("#mg-meter"), dot = btn.querySelector(".mg-dot"), fineEl = box.querySelector("#mg-fine");
  // The line under the box always says what is true for the mode the guide is in
  const fine = () => { fineEl.textContent = G.ai
    ? "I suggest programs, videos and general tips from the app, not medical advice. What you type is read by MD Fit Intelligence and isn't saved; my suggestions are added to your Home."
    : "I show you where things are in the app. I don't give medical advice. What you type stays on this device."; };
  fine();
  let greeted = false, busy = false, limited = false, lastSig = "", saidOpen = false;
  const ctx = { area: "", pick: "" };

  const end = () => { log.scrollTop = log.scrollHeight; };
  function say(text, me) { const d = document.createElement("div"); d.className = "mg-msg" + (me ? " mg-me" : ""); d.textContent = text; log.appendChild(d); end(); if (!me && box.hidden) dot.hidden = false; return d; }
  function sys(text) { const d = document.createElement("div"); d.className = "mg-sys"; d.textContent = text; log.appendChild(d); end(); }
  function card(title, sub) { const d = document.createElement("div"); d.className = "mg-card"; d.innerHTML = ICON.cal + "<div><b></b><span></span></div>"; d.querySelector("b").textContent = title; d.querySelector("span").textContent = sub; log.appendChild(d); end(); }
  // list: [{ label, sub, gold, hash | run | href | tel | more, name }]
  function offer(items) {
    const wrap = document.createElement("div"); wrap.className = "mg-opts";
    for (const o of items) {
      const b = document.createElement(o.tel ? "a" : "button"); if (o.tel) b.href = "tel:" + o.tel; else b.type = "button";
      b.className = "mg-opt" + (o.gold ? " mg-gold" : "") + (o.lock ? " mg-lock" : ""); b.textContent = o.label; b.dataset.label = o.label;
      if (o.lock) b.insertAdjacentHTML("afterbegin", ICON.lock);
      if (o.sub) { const s = document.createElement("small"); s.textContent = o.sub; b.appendChild(s); }
      if (!o.tel) b.addEventListener("click", () => { if (o.more) { say(o.label, true); return o.more(); } travel(o); });
      wrap.appendChild(b);
    }
    log.appendChild(wrap); end();
  }
  const opt = (id) => { const p = PLACES.find((x) => x.id === id); return id === "call" ? { label: p.label, tel: PHONE_TEL } : id === "visit" ? { label: p.label, href: "/visit" } : id === "book" ? { label: p.label, run: () => App.openBook(), name: p.name } : { label: p.label, hash: id, name: p.name }; };
  // A selection: go to that screen with the app's own navigation. On a phone the sheet steps aside; on desktop the chat stays.
  function travel(o) {
    if (o.pick) ctx.pick = o.pick;
    if (o.href) { location.href = o.href; return; }
    try { if (o.run) o.run(); else App.go(o.hash); } catch { return; }
    if (o.then) setTimeout(o.then, 90);
    if (phone()) { shut(); App.toast(`Sunny brought you to ${o.name}`); } else sys(`Opened ${o.name}`);
  }
  function thinking() { const d = document.createElement("div"); d.className = "mg-msg mg-think"; d.innerHTML = "<i><b></b><b></b><b></b></i>"; d.appendChild(document.createTextNode("Hmm, let's see what's available")); log.appendChild(d); end(); return d; }
  async function beat(fn) { const d = thinking(); await wait(750); d.remove(); await fn(); end(); }

  // ---------- the free plan's daily answers: the server counts, the guide only shows what the server says ----------
  function apply(r) { if (!r || typeof r !== "object") return; G.known = true; if (r.plan) G.plan = r.plan; if (r.unit) G.unit = r.unit; if ("limit" in r) G.limit = r.limit; if ("left" in r) G.left = r.left; if ("ai" in r) { G.ai = r.ai === true; fine(); } if (Array.isArray(r.reminders)) setReminders(r.reminders); meter(); }
  // Unlimited: a member, an active plan or an inpatient (the server sends left: null); never a counter or an upgrade
  const unlimited = () => G.known && (G.plan === "member" || G.left === null);
  // Roughly how many answers are left, in the member's terms (tokens stay a server matter)
  const answersLeft = () => (typeof G.left !== "number" ? null : G.unit === "tokens" ? Math.floor(G.left / PER_ANSWER) : G.left);
  function meter() {
    const n = answersLeft(), free = G.known && !unlimited() && typeof n === "number";
    // Quiet until few are left: with plenty remaining it should feel unlimited. Members never see a counter.
    if (!free || n > QUIET_ABOVE) { meterEl.hidden = true; limited = limited && free; input.placeholder = "Tell me what you're looking for"; return; }
    const out = G.unit === "tokens" ? G.left <= 0 : n <= 0;
    meterEl.hidden = false; meterEl.className = out ? "mg-out" : "";
    meterEl.textContent = out ? "No free Sunny answers left today" : G.unit === "tokens" ? (n ? `About ${n} free answer${n === 1 ? "" : "s"} left today` : "Almost out of free answers today") : `${n} free answer${n === 1 ? "" : "s"} left today`;
    input.placeholder = out ? "Free answers are back tomorrow" : "Tell me what you're looking for";
  }
  function setReminders(listIn) { const before = JSON.stringify(G.reminders); G.reminders = (listIn || []).filter((r) => r && r.date && r.time && r.title); if (JSON.stringify(G.reminders) !== before) App.redrawCalendar(); }
  const load = () => M.apiAuth("GET", "/api/me/guide").then(apply).catch(() => {});
  // One answer used. Anything going wrong (offline, server error, slow) counts as "go ahead": nobody is trapped behind an error.
  async function count(kind) {
    try {
      const r = await Promise.race([post("/api/me/guide/answer", { kind }), wait(4000).then(() => null)]);
      if (r && typeof r === "object") { apply(r); return !(r.ok === false && r.limited); }
    } catch {}
    return true;
  }
  const tell = (type) => { post("/api/me/guide/event", { type }).catch(() => {}); };
  function limit() {
    const again = limited; limited = true;
    say(again ? "You're out of free Sunny answers for today. Members get unlimited Sunny for $19.95/mo, or come back tomorrow."
      : `You've used today's free Sunny answers, ${first()}. Members get unlimited Sunny for $19.95/mo. You can upgrade now, or I'll be right here tomorrow.`);
    offer([{ label: "Get unlimited Sunny", sub: "$19.95/mo", gold: true, run: () => { tell("upgrade"); if (App.showTier) App.showTier("member"); else App.go("premium"); }, name: "Membership" },
      { label: "Come back tomorrow", more: () => { tell("tomorrow"); say(`See you tomorrow, ${first()}.`); setTimeout(() => { shut(); tag.textContent = "New answers tomorrow"; tag.hidden = false; dot.hidden = true; }, 1500); } }]);
    if (!again) { sys("Always open, limit or not"); offer([opt("pain"), opt("book"), opt("call")]); }
  }

  // ---------- answers ----------
  const theme = () => { try { return window.MDFitTheme && window.MDFitTheme.get ? window.MDFitTheme.get() || {} : null; } catch { return null; } };
  const setLook = (o) => { try { window.MDFitTheme.set(o); return true; } catch { return false; } };
  function looks() {
    const t = theme(); if (!t) return [opt("profile")];
    return [t.theme === "black" ? { label: "White theme", more: () => { setLook({ theme: "white" }); say("White it is."); } } : { label: "Black theme", more: () => { setLook({ theme: "black" }); say("Black it is."); } },
      t.layout === "compact" ? { label: "Comfortable layout", more: () => { setLook({ layout: "comfortable" }); say("Done. A little more room on every screen."); } } : { label: "Compact layout", more: () => { setLook({ layout: "compact" }); say("Done. More fits on every screen now."); } },
      { label: "Open my profile", hash: "profile", name: "your profile" }];
  }
  function look(change, done) {
    if (!theme()) { say("The theme and layout switches live in My Profile."); return offer([opt("profile")]); }
    if (change && !setLook(change)) { say("I couldn't change that just now. The switches are in My Profile."); return offer([opt("profile")]); }
    say(done); offer(looks());
  }
  // Programs and pain tracks the app really has for one part of the body
  async function forArea(area) {
    const f = AREAS[area].f, hit = (s) => f.some((w) => has(norm(s), w));
    let C = null; try { C = await App.content(); } catch {}
    const progs = ((C && C.programs) || []).filter((p) => p && p.id && hit(p.title)).slice(0, 4)
      .map((p) => ({ label: p.title, sub: [p.category, p.weeks ? `${p.weeks} weeks` : ""].filter(Boolean).join(" · "), hash: `programs/${p.id}`, name: p.title, pick: p.title }));
    const tracks = (((window.MDFitTracks || {}).TRACKS) || []).filter((t) => t && t.id && hit(t.region)).slice(0, 3)
      .map((t) => ({ label: t.title, sub: "Pain relief track", hash: `pain/track/${t.id}`, name: t.title }));
    return { progs, tracks };
  }
  async function showArea(area) {
    ctx.area = area;
    const { progs, tracks } = await forArea(area);
    if (progs.length) { say(`Okay, these are the ${area} programs available right now:`); offer(progs); }
    else say(`There isn't a program built for the ${area} yet.`);
    if (tracks.length) { say(`And these pain relief tracks cover the ${area}:`); offer(tracks); }
    say("If you'd like a more specific read on what's going on, I can guide you to the pain tool."); offer([opt("pain"), opt("book"), opt("call")]);
  }
  function hurting(area, extra) {
    if (area) ctx.area = area;
    say(`Okay, I understand how frustrating that can be${area ? `, especially with your ${area}` : ""}. Here's what I can take you to:`);
    offer([...(area ? [{ label: `Programs for your ${area}`, more: () => beat(() => showArea(area)) }] : []), opt("pain"), opt("book"), ...(extra || []), opt("call")]);
  }
  // When a reminder is for: a day and a time worked out from the words, on this device
  function whenFrom(raw) {
    const t = raw.toLowerCase(), today = M.todayInTz(), now = new Date(), nowHM = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    let time = "", m;
    if ((m = t.match(/\b(\d{1,2}):(\d\d)\s*(am|pm|a\.m\.|p\.m\.)?/)) || (m = t.match(/\b(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/)) || (m = t.match(/\bat\s+(\d{1,2})()()\b/))) {
      let h = +m[1]; const min = m[2] || "00", ap = (m[3] || "").replace(/\./g, "");
      if (h <= 23 && +min <= 59) {
        if (ap === "pm" && h < 12) h += 12; else if (ap === "am" && h === 12) h = 0; else if (!ap && h >= 1 && h <= 5) h += 12;
        time = String(h).padStart(2, "0") + ":" + min;
      }
    }
    if (!time) time = /\bnoon\b/.test(t) ? "12:00" : /\bafternoon\b/.test(t) ? "15:00" : /\b(evening|tonight)\b/.test(t) ? "18:00" : /\bmorning\b/.test(t) ? "07:00" : "";
    const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    let date = "", wd = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t)), inN = t.match(/\bin (\d{1,2}) days?\b/);
    if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(t)) date = today;
    else if (/\btomorrow\b/.test(t)) date = M.addDays(today, 1);
    else if (wd >= 0) { const cur = new Date(today + "T12:00:00Z").getUTCDay(); date = M.addDays(today, ((wd - cur + 7) % 7) || 7); }
    else if (inN) date = M.addDays(today, Math.min(60, +inN[1]));
    else date = time && time > nowHM ? today : M.addDays(today, 1);
    if (!time) time = "07:00";
    if (date === today && time <= nowHM) date = M.addDays(today, 1); // that time has passed today
    return { date, time };
  }
  // What the reminder is called: the app's own names only (never the typed sentence)
  function titleFor(u) {
    const t = u.text, area = u.area || ctx.area;
    if (ctx.pick && !/\b(workout|stretch|walk|appointment|visit)\b/.test(t)) return ctx.pick;
    if (/\bstretch/.test(t)) return "Stretching"; if (/\bwalk/.test(t)) return "Walk";
    if (/\b(pain (log|check)|check ?in)\b/.test(t)) return "Pain check-in";
    if (/\b(appointment|visit)\b/.test(t)) return "Appointment";
    if (/\b(program|rehab|protocol|exercises?)\b/.test(t)) return area ? `${cap(area)} program` : "Program";
    if (/\b(workout|work out|train|gym|lift)/.test(t)) return "Workout";
    return area ? `${cap(area)} exercises` : "MD Fit reminder";
  }
  const whenSay = (r) => { const t = M.todayInTz(); return `${r.date === t ? "Today" : r.date === M.addDays(t, 1) ? "Tomorrow" : M.fmtDate(r.date, { weekday: "long", month: "short", day: "numeric" })} at ${M.fmtTime(r.time)}`; };
  const showDay = (date) => () => { const b = document.querySelector(`#cal [data-day="${date}"]`); if (b) b.click(); };
  async function remind(u, raw) {
    const w = whenFrom(raw), title = titleFor(u);
    try {
      const r = await post("/api/me/reminders", { title, date: w.date, time: w.time });
      if (r && Array.isArray(r.reminders)) setReminders(r.reminders); else setReminders([...G.reminders, (r && r.reminder) || { title, ...w }]);
      say("Okay, I'll save that in your calendar for you."); card(title, `${whenSay(w)} · saved to your calendar`);
      offer([{ label: "See my calendar", hash: "progress", name: "your calendar", then: showDay(w.date) }]);
    } catch (e) { say("I couldn't save that just now, so nothing was added to your calendar. Please try again in a moment."); }
  }
  function myReminders() {
    const t = M.todayInTz(), up = G.reminders.filter((r) => r.date >= t).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    if (!up.length) { say("I couldn't find a saved reminder. Tell me what to remind you of and when, like \"remind me to stretch tomorrow at 7am\"."); return; }
    say(up.length === 1 ? "Here is the reminder I've saved for you:" : "Here are the reminders I've saved for you:");
    for (const r of up.slice(0, 6)) card(r.title, whenSay(r));
    offer([{ label: "See my calendar", hash: "progress", name: "your calendar" }, ...up.slice(0, 6).filter((r) => r.id).map((r) => ({ label: `Remove: ${r.title}`, sub: whenSay(r), more: async () => {
      try { const res = await M.apiAuth("DELETE", "/api/me/reminders/" + encodeURIComponent(r.id)); setReminders((res && res.reminders) || G.reminders.filter((x) => x.id !== r.id)); say("Removed."); }
      catch { say("I couldn't remove that just now. Please try again in a moment."); } } }))]);
  }
  // Questions about the member's own account, answered from what the app has already loaded
  function own(u) {
    const t = u.text, s = state();
    if (/\b(when|what time|next|upcoming|do i have|have i got|is my|are my)\b/.test(t) && /\b(appointment|appointments|visit|visits|session)\b/.test(t)) return { kind: "profile", run: () => {
      const v = nextVisit(s);
      if (v) { say(`Your next visit is ${v.typeName ? v.typeName + " " : ""}${whenWords(v)}.`); offer([{ label: "See my appointments", hash: "profile", name: "your profile" }, ...(v.meetingLink && v.date === M.todayInTz() ? [opt("visit")] : []), opt("book")]); }
      else { say("I couldn't find an upcoming visit on your account."); offer([opt("book"), { label: "See my appointments", hash: "profile", name: "your profile" }, opt("call")]); } } };
    if (/\b(owe|owed|balance|invoice|invoices|bill|bills|due)\b/.test(t) || (/\bpay\b/.test(t) && !/\bmembership\b/.test(t))) return { kind: "membership", run: () => {
      const inv = (s.invoices || []).filter((v) => v && v.number && v.path);
      if (inv.length) { say(inv.length === 1 ? `You have one unpaid invoice: ${inv[0].number}, ${money(inv[0].amount)}.` : `You have ${inv.length} unpaid invoices.`); offer([...inv.slice(0, 4).map((v) => ({ label: `Pay invoice ${v.number}`, sub: money(v.amount), href: v.path, gold: true })), opt("premium")]); }
      else { say("I couldn't find an unpaid invoice on your account."); offer([opt("premium"), opt("call")]); } } };
    if (/\b(streak|xp|level|rank|points|how am i doing)\b/.test(t)) return { kind: "progress", run: () => {
      const r = s.reward, n = parseInt((document.getElementById("streak-n") || {}).textContent, 10), bits = [];
      if (n > 0) bits.push(`You're on a ${n}-day streak.`);
      if (r && typeof r.todayXp === "number" && r.dailyGoal) bits.push(`Today you have ${r.todayXp} of your ${r.dailyGoal} XP goal.`);
      if (r && r.title && typeof r.xp === "number") bits.push(`Your rank is ${r.title}, with ${r.xp.toLocaleString()} XP.`);
      say(bits.length ? bits.join(" ") : "I couldn't find your numbers just now. They're all on your Progress screen."); offer([opt("progress"), opt("leaders"), opt("generate")]); } };
    if (/\bmessages?\b/.test(t) && /\b(any|new|unread|check|did|have i|do i have)\b/.test(t)) return { kind: "messages", run: () => {
      const n = Number(s.unread) || 0;
      if (n) { say(n === 1 ? "You have a new message." : `You have ${n} new messages.`); offer([{ label: n === 1 ? "Read your new message" : "Read your new messages", hash: "messages", name: "Messages", gold: true }]); }
      else { say("I don't see an unread message right now."); offer([opt("messages")]); } } };
    // "what should I do" on its own (or with next/now/today) is about their list; "what should I do for my hip" is not
    if (/\bwhat (do|should) i (need to |have to )?do( next| now| today| first| here)?\s*$/.test(t) || /\b(what'?s next|what is next|to-?do list|waiting (for|on) me|anything (for me|waiting|pending)|catch me up|what did i miss)\b/.test(t)) return { kind: "other", run: () => {
      const w = waiting(); lastSig = w.sig;
      if (w.opts.length) { say(w.line || "Here's what is waiting for you:"); offer(w.opts); }
      else { say("I couldn't find anything waiting on you right now. Here's where people usually head next:"); offer([opt("generate"), opt("programs"), opt("book")]); } } };
    return null;
  }
  // Work out what was asked: which kind (one word, for the count) and what to answer
  // local: true = the device answers this itself in every mode (the member's own data, reminders, how the app looks)
  function decide(u, raw) {
    const plan = route(u, raw); if (["looks", "reminder"].includes(plan.kind) || plan.own) plan.local = true; return plan;
  }
  function route(u, raw) {
    const t = u.text;
    if (/\b(dark|black|night) ?(mode|theme|look)?\b/.test(t) && !u.pained) return { kind: "looks", run: () => look({ theme: "black" }, "Done. Black it is. Anything else you'd like to change about how the app looks?") };
    if (/\b(white|light (mode|theme|look)|make it light)\b/.test(t)) return { kind: "looks", run: () => look({ theme: "white" }, "Done. White it is. Anything else you'd like to change?") };
    if (/\b(compact|tighter|denser)\b/.test(t)) return { kind: "looks", run: () => look({ layout: "compact" }, "Done. More fits on every screen now.") };
    if (/\b(comfortable|roomy|roomier)\b/.test(t)) return { kind: "looks", run: () => look({ layout: "comfortable" }, "Done. A little more room on every screen.") };
    if (/\b(layout|theme|customi[sz]e|personali[sz]e|make it mine|look and feel)\b/.test(t)) return { kind: "looks", run: () => look(null, "Here's what you can change. Pick one, or just tell me.") };
    if (/\b(remind me|set a reminder|reminder (for|to|at)|save (it|that|this)|put (it|that|this) (in|on)|add (it|that|this) to|(on|in|to) my calendar)\b/.test(t)) return { kind: "reminder", run: () => remind(u, raw) };
    if (/\breminders?\b/.test(t)) return { kind: "reminder", run: myReminders };
    const mine = own(u); if (mine) return { ...mine, own: true };
    if (u.pained) return { kind: "pain", run: () => hurting(u.area, u.places.filter((p) => !["pain", "book", "call"].includes(p.id)).slice(0, 1).map((p) => opt(p.id))) };
    if (u.area) return { kind: (u.places[0] || {}).kind || "programs", run: () => showArea(u.area) };
    if (u.places.length) return { kind: u.places[0].kind, run: () => { say(u.places.length === 1 ? "Got it. This is the place for that:" : "Got it. These look like what you're after:"); offer([...u.places.slice(0, 4).map((p) => opt(p.id)), ...(u.places.some((p) => p.id === "call") ? [] : [opt("call")])]); } };
    return { kind: "other", run: () => { say("I'm not sure I caught that. Here are the places people use most, or tell me a little more:"); offer([opt("book"), opt("pain"), opt("programs"), opt("generate"), opt("messages"), opt("call")]); } };
  }
  async function ask(raw) {
    const text = String(raw || "").trim(); if (!text || busy) return false;
    say(text, true);
    const u = understand(text);
    // An emergency is answered at once: never counted, never behind the limit
    if (u.urgent) { emergency(); return true; }
    const plan = decide(u, text);
    busy = true; const d = thinking(), t0 = Date.now();
    // With the assistant on, a question the device does not answer itself is read on MD Fit's server; anything else
    // (and any failure there) is understood here and only counted.
    let ai = null; if (G.ai && !plan.local) ai = await askServer(text);
    const ok = ai ? true : await count(plan.kind);
    const rest = 750 - (Date.now() - t0); if (rest > 0) await wait(rest);
    d.remove();
    try { if (ai) aiAnswer(ai); else if (!ok) limit(); else await plan.run(); } catch { say("Something went wrong on my side. You can still get anywhere from the menu, or call the clinic."); offer([opt("call")]); }
    busy = false; end();
    return true;
  }
  const emergency = () => { say("If this is an emergency, call 911 now. For anything else urgent, call the clinic."); offer([{ label: "Call 911", tel: "911", gold: true }, opt("call")]); };
  // null = the assistant is off or did not answer: fall back to the device, never an error on screen
  async function askServer(text) {
    try {
      const r = await Promise.race([post("/api/me/guide/ask", { text: text.slice(0, 300) }), wait(12000).then(() => null)]);
      if (!r || typeof r !== "object") return null;
      if (r.ok === true && (r.urgent || typeof r.say === "string")) { apply(r); return r; }
      if (r.ok === false && r.limited) { apply(r); return r; }
      if (r.ok === false && r.ai === false) { G.ai = false; fine(); }
    } catch {}
    return null;
  }
  const FROM_SERVER = { workout: "generate", membership: "premium" };
  function aiAnswer(r) {
    if (r.ok === false) return limit();
    if (r.urgent) return emergency();
    const area = AREAS[r.area] ? r.area : ""; if (area) ctx.area = area;
    const ids = [...new Set((Array.isArray(r.places) ? r.places : []).map((x) => FROM_SERVER[x] || x))].filter((id) => id !== "call" && PLACES.some((p) => p.id === id)).slice(0, 5);
    say(String(r.say || "").trim().slice(0, 600) || "Here's where I can take you:");
    offer([...(area ? [{ label: `Programs for your ${area}`, more: () => beat(() => showArea(area)) }] : []), ...ids.map(opt), opt("call")]);
    suggest(r.suggested);
  }
  // Sunny's suggestions with an answer: programs (a members-only one shows locked and opens the membership page),
  // exercise videos and a general tip, each tagged Suggested. The server has already put them on the member's Home.
  function suggest(sg) {
    if (!sg || typeof sg !== "object") return;
    const progs = (Array.isArray(sg.programs) ? sg.programs : []).filter((p) => p && typeof p.id === "string" && typeof p.title === "string").slice(0, 3);
    const vids = (Array.isArray(sg.videos) ? sg.videos : []).filter((v) => v && typeof v.id === "string" && (App.exercise ? App.exercise(v.id) : v.name)).slice(0, 4);
    const tip = typeof sg.tip === "string" ? sg.tip.trim().slice(0, 300) : "";
    if (!progs.length && !vids.length && !tip) return;
    if (progs.length) {
      sys("Suggested programs");
      offer(progs.map((p) => p.locked
        ? { label: p.title, sub: "Members · unlock with Membership", lock: true, run: () => { tell("upgrade"); if (App.showTier) App.showTier("member"); else App.go("premium"); }, name: "Membership" }
        : { label: p.title, sub: "Suggested", hash: `programs/${p.id}`, name: p.title, pick: p.title }));
    }
    if (vids.length) {
      sys("Suggested videos");
      offer(vids.map((v) => { const ex = App.exercise ? App.exercise(v.id) : null, name = (ex && ex.name) || v.name;
        return { label: name, sub: [ex && ex.region, "Suggested"].filter(Boolean).join(" · "), more: () => { if (!App.playExercise || !App.playExercise(v.id)) say("That video isn't available just now. It's in the video library."); } }; }));
    }
    if (tip) { const d = say(tip); const t = document.createElement("span"); t.className = "mg-sug"; t.textContent = "Suggested"; d.prepend(t); }
    sys("Added to your Home under Suggested for you");
    if (App.setSuggested) M.apiAuth("GET", "/api/me").then((r) => r && r.client && r.client.suggested && App.setSuggested(r.client.suggested)).catch(() => {});
  }
  function greet() {
    greeted = true;
    const w = waiting(); lastSig = w.sig;
    say(`Hi ${first()}, I'm Sunny. What brings you in today?`);
    if (w.line) say(w.line);
    offer([...w.opts,
      { label: "Something hurts", more: () => beat(() => { say("I'm sorry to hear that. Where is it bothering you?"); offer(["knee", "back", "shoulder", "hip", "neck", "foot"].map((a) => ({ label: cap(a), more: () => beat(() => hurting(a)) }))); }) },
      opt("book"), opt("programs"), opt("generate"),
      ...(theme() ? [{ label: "Make the app mine", more: () => beat(() => look(null, "Here's what you can change. Pick one, or just tell me.")) }] : [])]);
  }
  // Something new turned up since the guide last looked (a visit, an invoice, a message): say so on the next open
  function news() { const w = waiting(); if (w.sig && w.sig !== lastSig) { say(`Something is waiting for you. ${w.line}`.trim()); offer(w.opts); } lastSig = w.sig; }

  // ---------- open and close ----------
  function fitKeyboard() { // keep the box above a phone's on-screen keyboard
    const vv = window.visualViewport; if (!vv || box.hidden) return;
    if (!phone()) { box.style.bottom = ""; box.style.height = ""; return; }
    const under = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    box.style.bottom = under ? under + "px" : ""; box.style.height = under ? Math.round(vv.height * 0.94) + "px" : "";
  }
  function open(byHand) {
    if (!box.hidden) return;
    box.hidden = false; scrim.hidden = !phone(); tag.hidden = true; dot.hidden = true; btn.setAttribute("aria-expanded", "true"); document.documentElement.classList.add("mg-open");
    try { localStorage.setItem("mdfit-guide-met", "1"); } catch {}
    if (!greeted) greet(); else news();
    if (!saidOpen) { saidOpen = true; tell("open"); }
    load(); end(); fitKeyboard();
    if (byHand && !phone()) setTimeout(() => input.focus({ preventScroll: true }), 60); // on a phone the keyboard waits for a tap on the box
  }
  function shut() { box.hidden = true; scrim.hidden = true; box.style.bottom = ""; box.style.height = ""; btn.setAttribute("aria-expanded", "false"); document.documentElement.classList.remove("mg-open"); }
  btn.addEventListener("click", () => (box.hidden ? open(true) : shut()));
  box.querySelector("#mg-x").addEventListener("click", () => { shut(); btn.focus({ preventScroll: true }); });
  scrim.addEventListener("click", shut);
  box.querySelector("#mg-form").addEventListener("submit", (e) => { e.preventDefault(); if (busy) return; const t = input.value; input.value = ""; ask(t); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { shut(); btn.focus({ preventScroll: true }); } });
  document.addEventListener("pointerdown", (e) => { if (!box.hidden && !phone() && !box.contains(e.target) && !btn.contains(e.target)) shut(); }); // desktop: a click outside puts it away
  if (window.visualViewport) { window.visualViewport.addEventListener("resize", fitKeyboard); window.visualViewport.addEventListener("scroll", fitKeyboard); }
  window.matchMedia("(max-width: 720px)").addEventListener("change", () => { if (!box.hidden) { scrim.hidden = !phone(); fitKeyboard(); } });

  // The label steps aside after a moment for someone who has met Sunny before; the cloud keeps breathing
  let met = false; try { met = !!localStorage.getItem("mdfit-guide-met"); } catch {}
  if (met) setTimeout(() => { if (box.hidden && tag.textContent === "Tap me to talk") tag.hidden = true; }, 7000);
  // Out of the way of a full-screen workout, and lifted clear of the app's pop-up notifications
  const hideFor = () => { const p = document.getElementById("player"), on = !!(p && !p.hidden); btn.classList.toggle("mg-away", on); tag.classList.toggle("mg-away", on); if (on && !box.hidden) shut(); };
  const player = document.getElementById("player"); if (player && window.MutationObserver) { new MutationObserver(hideFor).observe(player, { attributes: true, attributeFilter: ["hidden"] }); hideFor(); }
  const notifs = document.getElementById("notifs");
  const lift = () => { let px = 0; if (notifs && notifs.children.length) { const n = notifs.getBoundingClientRect(), b = btn.getBoundingClientRect(); if (n.height && n.right > b.left - 8) px = Math.round(n.height + 22); } document.documentElement.style.setProperty("--mg-lift", px + "px"); };
  if (notifs && window.MutationObserver) new MutationObserver(lift).observe(notifs, { childList: true, subtree: true });

  load();
  window.MDFitGuide = { day: dayRows, understand, open: () => open(false), shut, reminders: () => G.reminders.slice() };
})();
