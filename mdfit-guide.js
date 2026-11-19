// Solomon: the gold cloud to tap and talk to, on every screen of the member app.
//
// Solomon is a guide to the app, not a doer of clinical things: it reads what the member writes, works out what they are
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
// In that mode the server also reads the member's activity in the app (programs, check-ins, workouts) to personalize
// what it suggests; the member's name and contact details are never sent, and what is typed is not saved.
//
// A hello is always answered on the device, by first name (the app holds it; it is never sent), and is never counted.
// The device also puts the member's own things first: a program Dr. Jared recommended, and the pain relief track for
// the area they last logged. Both come from what the app already loaded.
//
// With the assistant on, an answer can also carry suggestions: programs, exercise videos and a general tip from the
// app's own library, and Dr. Jared's own written guides. The server keeps them on the member's record and the app shows them on Home under "Suggested for
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
  // Where each of those is, in the words on the screen: [on a phone, on a computer]
  const AT = { book: ["Tap + at the top of Home, then Book a visit.", "Tap + at the top of Home, then Book a visit."], pain: ["Tap Train, then Pain tool at the top.", "It's Pain Tool in the menu."],
    programs: ["Tap More, then Programs.", "It's Programs in the menu."], generate: ["Tap Train in the bar at the bottom.", "It's Workout Generator in the menu."],
    videos: ["Tap Train, then Videos at the top.", "It's Video Library in the menu."], messages: ["Tap More, then Messages.", "It's Message Dr. Jared in the menu."],
    progress: ["Tap Progress in the bar at the bottom.", "It's Progress Tracking in the menu."], learn: ["Tap More, then Learn.", "It's Lectures & Live Q&A in the menu."],
    tips: ["Tap More, then Tips.", "It's Health Tips in the menu."], leaders: ["Tap More, then Leaders.", "It's Leaderboard in the menu."],
    premium: ["Tap More, then Membership.", "It's Membership & 1-on-1 in the menu."], profile: ["Tap Profile in the bar at the bottom.", "It's My Profile in the menu."],
    visit: ["Tap + at the top of Home, then Join video visit.", "Tap + at the top of Home, then Join video visit."] };
  // The smaller things people ask the way to. w = the words that mean it; at = where it is, as the screen names it;
  // label + href / card / run = the button that takes them straight there. Answered on the device, never sent, never counted.
  const WAYS = [
    { w: ["intake", "documents", "document", "paperwork", "forms", "intake form", "consent", "consents", "waiver", "health history", "new patient"], at: "Your intake documents are under the + button at the top of Home: tap +, then Intake documents.", label: "Open my intake documents", href: "/intake?me=1" },
    { w: ["refer", "referral", "referrals", "refer a friend", "my link", "referral link", "referral code", "invite a friend", "commission"], at: "Your referral link and what it has earned are on Profile, in Refer a friend.", label: "Open Refer a friend", card: ["profile", "referral"], name: "Refer a friend" },
    { w: ["calendar sync", "sync my calendar", "sync calendar", "iphone calendar", "apple calendar", "google calendar", "phone calendar", "add to my calendar", "subscribe to my calendar"], at: "Calendar sync is on Progress, under the calendar.", label: "Open the calendar", hash: "progress", name: "Progress" },
    { w: ["rearrange", "reorder", "move the cards", "hide a card", "hide cards", "customize home", "customise home", "customize my home", "home layout", "customize profile", "customize this page"], at: "At the bottom of Home and of Profile there is Customize this page: move a card up or down, fold it or hide it.", label: "Customize Home", run: () => App.customize("home"), name: "Home" },
    { w: ["be quiet", "stop talking", "mute you", "mute solomon", "quiet", "stop the bubbles", "turn you off", "turn off solomon", "notifications", "notification", "nudge", "nudges"], at: "That's on Profile, in Reminders from Solomon: my daily reminder, and whether I speak up in the app.", label: "Open Reminders from Solomon", card: ["profile", "nudges"], name: "Reminders from Solomon" },
    { w: ["daily activities", "daily activity", "activities", "habits", "habit", "check off"], at: "Daily activities are on Home, in the Daily activities card. Each is worth XP once a day.", label: "Open Daily activities", card: ["home", "habits"], name: "Daily activities" },
    { w: ["daily goal", "xp goal", "my goal", "change my goal", "goal level"], at: "Your daily XP goal is on Profile, in My daily XP goal.", label: "Open my daily goal", card: ["profile", "goal"], name: "My daily XP goal" },
    { w: ["gem mine", "the mine", "my week", "the road", "my gems", "gems"], at: "The gem mine is on Home: one stop a day, lit by your workout, check-in, daily activities and daily goal.", label: "Show me the mine", run: () => App.goNext("mine"), name: "the gem mine" },
    { w: ["password", "change my email", "email address", "my name", "phone number on file", "log out", "logout", "sign out", "delete my account", "close my account"], at: "Your sign-in details are on Profile, in the Profile card.", label: "Open my details", card: ["profile", "account"], name: "your details" },
    { w: ["workout history", "past workouts", "previous workouts", "old workouts"], at: "Every workout you've logged is on Profile, in Workout history.", label: "Open Workout history", card: ["profile", "history"], name: "Workout history" },
    { w: ["my appointments", "my visits", "upcoming visits", "upcoming appointments", "past visits"], at: "Your visits are on Profile, in My appointments.", label: "Open My appointments", card: ["profile", "appointments"], name: "My appointments" },
    { w: ["care plan", "my plan from", "prescribed", "movements from", "notes from dr", "what dr jared left"], at: "What Dr. Jared left for you is on Profile, in My care plan.", label: "Open My care plan", card: ["profile", "care"], name: "My care plan" },
    { w: ["feedback", "suggestion", "report a problem", "report a bug", "complaint"], at: "You can tell us on Profile, in Help us improve.", label: "Open Help us improve", card: ["profile", "feedback"], name: "Help us improve" },
    { w: ["install", "home screen", "add to home", "download the app", "get the app"], at: "How to put MD Fit on your phone is on Profile, in Get the app.", label: "Open Get the app", card: ["profile", "install"], name: "Get the app" }
  ];
  // Asking the way: "where is", "how do I get to", "find", "take me to", "can't find"...
  const WHERE = /\b(where|how (do|can|would) i (get|find|open|see|go|access|reach|view|change|turn|use|do that|do this)|how to (get|find|open|see|access|view|change|use)|find|locate|take me|bring me|go to|get to|show me|open (the|my|up)|navigate|can'?t find|cannot find|looking for|can'?t you help|can you help)\b/;
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
  const btn = document.createElement("button"); btn.id = "mg-btn"; btn.type = "button"; btn.setAttribute("aria-label", "Open Solomon: tap me to talk"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "mg"); btn.innerHTML = cloud("") + '<i class="mg-dot" hidden></i>';
  // What he says without being asked rises above the cloud and fades by itself. Tapping it does what it offers (or opens the chat).
  const tag = document.createElement("button"); tag.id = "mg-tag"; tag.type = "button"; tag.hidden = true;
  let sayT = 0, sayAct = null, dayHello = "";
  function hush() { clearTimeout(sayT); tag.hidden = true; sayAct = null; btn.classList.remove("mg-talk"); }
  function speak(text, o) {
    o = o || {}; text = String(text || "").trim();
    if (!text || !box.hidden || btn.classList.contains("mg-away")) return false;
    clearTimeout(sayT); sayAct = typeof o.act === "function" ? o.act : null;
    tag.textContent = text; tag.setAttribute("aria-label", "Solomon says: " + text); tag.hidden = false;
    tag.classList.remove("mg-in"); void tag.offsetWidth; tag.classList.add("mg-in"); btn.classList.add("mg-talk");
    if (o.ms !== 0) sayT = setTimeout(hush, o.ms || Math.min(9500, 3600 + text.length * 60));
    return true;
  }
  tag.addEventListener("click", () => { const act = sayAct; hush(); if (act) { try { act(); } catch {} } else open(true); });
  const scrim = document.createElement("div"); scrim.id = "mg-scrim"; scrim.hidden = true;
  const box = document.createElement("section"); box.id = "mg"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Solomon");
  box.innerHTML = `<header class="mg-head"><div class="mg-grab"></div><div class="mg-in">${cloud("mg-mini")}<div class="mg-who"><b>Solomon</b><span>Your MD Fit assistant</span></div>
      <button type="button" id="mg-x" aria-label="Close Solomon">${ICON.x}${ICON.down}</button></div></header>
    <div id="mg-log" role="log" aria-live="polite" aria-label="Conversation with Solomon"></div>
    <div id="mg-meter" hidden></div>
    <form id="mg-form"><input id="mg-in" autocomplete="off" maxlength="200" enterkeyhint="send" placeholder="Tell me what you're looking for" aria-label="Tell Solomon what you are looking for"><button aria-label="Send">${ICON.send}</button></form>
    <p class="mg-fine" id="mg-fine"></p>`;
  document.body.append(btn, tag, scrim, box);
  const log = box.querySelector("#mg-log"), input = box.querySelector("#mg-in"), meterEl = box.querySelector("#mg-meter"), dot = btn.querySelector(".mg-dot"), fineEl = box.querySelector("#mg-fine");
  // The line under the box always says what is true for the mode the guide is in
  const fine = () => { fineEl.textContent = G.ai
    ? "Solomon reads what you type and your activity in the app (programs, check-ins, workouts) to personalize suggestions. Your name and contact details are never sent, and what you type isn't saved. Not medical advice."
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
    if (o.name !== "your road" && App.tripStart) App.tripStart(); // he brings them back when it's done (account.js)
    if (o.then) setTimeout(o.then, 90);
    if (phone()) { shut(); App.toast(`Solomon brought you to ${o.name}`); } else sys(`Opened ${o.name}`);
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
    meterEl.textContent = out ? "No free Solomon answers left today" : G.unit === "tokens" ? (n ? `About ${n} free answer${n === 1 ? "" : "s"} left today` : "Almost out of free answers today") : `${n} free answer${n === 1 ? "" : "s"} left today`;
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
    say(again ? "You're out of free Solomon answers for today. Members get unlimited Solomon for $19.95/mo, or come back tomorrow."
      : `You've used today's free Solomon answers, ${first()}. Members get unlimited Solomon for $19.95/mo. You can upgrade now, or I'll be right here tomorrow.`);
    offer([{ label: "Get unlimited Solomon", sub: "$19.95/mo", gold: true, run: () => { tell("upgrade"); if (App.showTier) App.showTier("member"); else App.go("premium"); }, name: "Membership" },
      { label: "Come back tomorrow", more: () => { tell("tomorrow"); say(`See you tomorrow, ${first()}.`); setTimeout(() => { shut(); speak("New answers tomorrow", { ms: 6000 }); dot.hidden = true; }, 1500); } }]);
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
  // The member's own things, from what the app already holds (never sent): the program Dr. Jared recommended, and the
  // pain relief track for the area they last logged
  async function mine() {
    const out = { rec: null, track: null, title: "" };
    try {
      const c = App.client() || {}; let C = null; try { C = await App.content(); } catch {}
      const progs = (C && C.programs) || [];
      const a = (c.assignedPrograms || []).map((x) => progs.find((p) => p && p.id === x.id)).find(Boolean);
      if (a) { out.title = a.title; out.rec = { label: `Pick up ${a.title}`, sub: "Recommended by Dr. Jared", gold: true, hash: `programs/${a.id}`, name: a.title, pick: a.title }; }
      const last = norm(App.lastPain ? App.lastPain() : ""), key = last.trim() ? Object.keys(AREAS).find((k) => AREAS[k].f.some((w) => has(last, w)) || has(last, k)) : "";
      if (key) { const t = (await forArea(key)).tracks[0]; if (t) out.track = { ...t, sub: `Pain relief track · your ${key}` }; }
    } catch {}
    return out;
  }
  const own3 = (m) => [m.rec, m.track].filter(Boolean);
  // A hello: answered here by first name, never sent, never counted
  const HELLO = /^\s*(hi+|hey+|heya|hello+|helo|yo+|hiya|howdy|sup|what'?s up|wass?up|greetings|good (morning|afternoon|evening|day)|morning|afternoon|evening|hola|hi there|hey there|hello there|anyone there|you there|are you there)(\s+(sunny|there|doc|dr\.?|guide|md ?fit))?[\s!?.,]*$/i;
  async function hello() {
    const m = await mine();
    say(`Hey ${first()}, I'm Solomon. What are we working on today?`);
    if (m.rec) say(`Want to pick up ${m.title} that Dr. Jared recommended?`);
    offer([...own3(m), opt("pain"), opt("programs"), opt("generate")]);
  }
  // ---------- the road: where this member is right now (the same "next" as the Home tile), read on the device ----------
  // Solomon opens with it, falls back to it when a message is vague, and says the new stop when the last one is done.
  function road() {
    let n = null; try { n = App.nextUp ? App.nextUp() : null; } catch {} if (!n) return null;
    const sig = [n.kind, n.ref || "", n.title || ""].join("|");
    const R = (text, label, how, name) => ({ sig, kind: n.kind, ref: n.ref || "", say: text, opt: label ? { label, gold: true, name: name || "it", ...how } : null });
    if (n.kind === "intro") {
      if (n.ref === "know") return R("You're on your first descent. This stop: let me get to know you. A few taps, and I'll steer by what you tell me.", "Let's do it", { more: () => beat(() => knowYou()) });
      if (n.ref === "pain") return R("You're on your first descent. This stop: your check-in. Tell me what hurts, or that nothing does. We can do it right here.", "Do my check-in here", { more: () => beat(() => checkin()) });
      if (n.ref === "program") return R("You're on your first descent. This stop: pick a program that fits you.", "Help me pick one", { more: () => beat(() => pickRoad()) });
      if (n.ref === "session") return R("You're on your first descent. This stop: finish one workout. Tell me how long you have, or start one now.", "Build a workout", { hash: "generate" }, "the workout builder");
      if (n.ref === "friend") return R("Last stop of your first descent: see your referral link.", "Open Refer a friend", { run: () => App.goNext("refer") }, "Refer a friend");
      return R("You're on your first descent. Ask me anything and the first stop is yours.");
    }
    if (n.kind === "docs") return R("Next on your road: your intake documents are due before your visit.", "Open my intake documents", { href: "/intake?me=1" });
    if (n.kind === "invoice") return R(`Next on your road: ${n.title} to settle.`, "Pay it now", { run: () => App.goNext(n.go) }, "your invoice");
    if (n.kind === "visit" || n.kind === "later") return R(`Coming up: ${n.title}, ${n.sub}.`, "Get ready for my visit", { run: () => App.goNext("plus") }, "your visit");
    if (n.kind === "session") return R(`Today's stop on your road is ${n.title}.`, `Start ${n.title}`, { run: () => App.journeyToday() }, "today's session");
    if (n.kind === "lights") { const d = n.today || {};
      if (!d.pain) return R(`${d.lit} of ${d.of} lit today. Next light: your check-in. We can do it right here.`, "Do my check-in here", { more: () => beat(() => checkin()) });
      return R(`${d.lit} of ${d.of} lit today. Next light: ${n.title.toLowerCase()}.`, `Open ${n.title}`, { run: () => App.goNext("today") }, n.title); }
    if (n.kind === "done") return R("Every lamp is lit today. The road keeps until tomorrow.");
    return R("Nothing is on your road yet today. Tell me what you want to train and I'll build it.", "Build a workout", { hash: "generate" }, "the workout builder");
  }
  let lastRoad = "";
  const backToRoad = () => ({ label: "Back to my road", gold: true, run: () => App.goNext("mine"), name: "your road" });
  const plain = (o) => (o ? [{ ...o, gold: false, label: o.label.replace(/^Do my check-in here$/, "Do my check-in now") }] : []);
  // ---------- "Pick your road": a program chosen by what the member is here for, without leaving the chat ----------
  const AIMS = [["pain", "Get out of pain", ["Rehabilitation", "Anti-inflammatory", "Desk & posture"]], ["stronger", "Get stronger", ["Hypertrophy", "Strength"]], ["weight", "Lose weight", ["Weight loss"]],
    ["move", "Move better", ["Mobility"]], ["sport", "Get better at my sport", ["Sport Performance", "Performance"]]];
  // ---------- "Let me get to know you": where they've been and where they're going, in taps, kept on their account ----------
  // Every answer is a choice (nothing typed is saved) and every question can be skipped.
  const KNOW = {
    athlete: [["comp", "Yes, competitively"], ["fun", "For fun"], ["no", "Not really"]],
    sports: [["football", "Football"], ["basketball", "Basketball"], ["baseball", "Baseball or softball"], ["soccer", "Soccer"], ["tennis", "Tennis"], ["pickleball", "Pickleball"], ["golf", "Golf"], ["running", "Running or track"],
      ["swimming", "Swimming"], ["volleyball", "Volleyball"], ["wrestling", "Wrestling"], ["martial", "Martial arts or boxing"], ["gymnastics", "Gymnastics"], ["cheer", "Cheerleading"], ["dance", "Dance"], ["hockey", "Hockey"],
      ["lacrosse", "Lacrosse"], ["cycling", "Cycling"], ["rowing", "Rowing"], ["lifting", "Lifting or CrossFit"], ["skiing", "Skiing or snowboarding"], ["surfing", "Surfing"], ["climbing", "Climbing"], ["chess", "Chess"], ["other", "Something else"]],
    free: [["outdoors", "Outdoors"], ["sports", "Playing sports"], ["family", "Family"], ["friends", "Friends"], ["games", "Gaming"], ["reading", "Reading"], ["travel", "Travel"], ["cooking", "Cooking"], ["music", "Music"], ["tv", "Shows and movies"]],
    foods: [["meat", "Meat"], ["seafood", "Seafood"], ["pasta", "Pasta and rice"], ["veg", "Vegetables"], ["fruit", "Fruit"], ["sweets", "Sweets"], ["fastfood", "Fast food"], ["homecooked", "Home cooking"]],
    diet: [["none", "No particular way"], ["protein", "High protein"], ["plant", "Vegetarian or vegan"], ["lowcarb", "Low carb"], ["mediterranean", "Mediterranean"], ["better", "Trying to eat better"]],
    aim: AIMS.map(([id, label]) => [id, label])
  };
  const word = (k, id) => ((KNOW[k].find((x) => x[0] === id) || [])[1] || "").toLowerCase();
  const listed = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
  // What he says back: where you've been, where you're going
  function heard(a) {
    const been = [], sp = (a.sports || []).filter((x) => x !== "other").map((x) => word("sports", x));
    if (a.athlete === "comp") been.push(sp.length ? `you competed in ${listed(sp)}` : "you competed growing up"); else if (a.athlete === "fun") been.push(sp.length ? `you played ${listed(sp)} for fun` : "you played for fun");
    else if (a.athlete === "no") been.push("sport wasn't your thing");
    if (a.competitive) been.push(`you rate yourself ${a.competitive} out of 10 for competitiveness`);
    if ((a.free || []).length) been.push(`your free time goes to ${listed(a.free.map((x) => word("free", x)))}`);
    if ((a.foods || []).length) been.push(`you love ${listed(a.foods.map((x) => word("foods", x)))}`);
    if (a.diet && a.diet !== "none") been.push(a.diet === "better" ? "you're trying to eat better" : `you eat ${word("diet", a.diet)}`);
    const going = a.aim ? `you're here to ${word("aim", a.aim).replace(/\bmy\b/, "your")}` : "";
    if (!been.length && !going) return "";
    return `Here's what I heard.${been.length ? ` Where you've been: ${been.join("; ")}.` : ""}${going ? ` Where you're going: ${going}.` : ""} I'll steer by that.`;
  }
  function knowYou() {
    const a = {};
    const drop = () => { const w = [...log.querySelectorAll(".mg-opts")].pop(); if (w) w.remove(); };
    const one = (text, key, next, choices) => { say(text); offer([...(choices || KNOW[key]).map(([id, label]) => ({ label, more: () => { a[key] = id; beat(next); } })), { label: "Skip", more: () => beat(next) }]); };
    const many = (text, key, next) => { const got = []; const round = (first) => { if (first) say(text); else drop();
      offer([...KNOW[key].filter(([id]) => !got.includes(id)).map(([id, label]) => ({ label, more: () => { if (!got.includes(id)) got.push(id); a[key] = got.slice(); if (got.length >= 5) beat(next); else round(false); } })),
        { label: got.length ? "That's it" : "Skip", gold: got.length > 0, more: () => beat(next) }]); }; round(true); };
    const finish = async () => { const d = thinking();
      try { const saved = await App.saveAbout(a); d.remove(); const rd = road(); lastRoad = rd ? rd.sig : "";
        say(heard(saved || a) || "No problem. Whenever you like, just say \u201cget to know me\u201d.");
        if (rd && rd.kind === "intro") say(rd.say.replace(/^You're on your first descent[.,] ?(This stop: )?/, "That stop is done. Next: "));
        offer([backToRoad(), ...plain(rd && rd.opt)]);
      } catch { d.remove(); say("I couldn't save that just now. Say \u201cget to know me\u201d and we'll try again."); } end(); };
    const goal = () => { say("Now, where you're going."); one("What are your goals here?", "aim", finish); };
    const diet = () => one("And how do you eat these days?", "diet", goal);
    const foods = () => many("What do you love to eat? Pick a few.", "foods", diet);
    const free = () => many("What do you do with your free time? Pick a few.", "free", foods);
    const comp = () => { say("How competitive would you say you are? 1 is just for fun, 10 is you hate to lose."); offer([...Array.from({ length: 10 }, (_, n) => ({ label: String(n + 1), more: () => { a.competitive = n + 1; beat(free); } })), { label: "Skip", more: () => beat(free) }]); };
    const sports = () => many("Which sports? Pick any that were yours.", "sports", comp);
    say("Let me get to know you. First, where you've been.");
    say("Were you an athlete?");
    offer([...KNOW.athlete.map(([id, label]) => ({ label, more: () => { a.athlete = id; beat(id === "no" ? comp : sports); } })), { label: "Skip", more: () => beat(comp) }]);
  }
  async function pickRoad(opener) {
    let C = null; try { C = await App.content(); } catch {}
    const all = ((C && C.programs) || []).filter((x) => !(App.lockedFor && App.lockedFor(x)));
    if (!all.length || !App.saveProgram) { say("The programs are one tap away."); return offer([{ ...opt("programs"), gold: true }]); }
    // when to start, then: saved, the calendar fills in while they watch, and they are back on the road
    const choose = (pr) => { const t = App.today ? App.today() : new Date().toISOString().slice(0, 10), plus = (n) => new Date(Date.parse(t + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
      const toMon = (8 - new Date(t + "T12:00:00Z").getUTCDay()) % 7 || 7;
      say("When do you want to start?");
      offer([["Today", 0], ["Tomorrow", 1], ...(toMon > 1 ? [["Monday", toMon]] : [])].map(([label, n]) => ({ label, more: () => begin(pr, plus(n), label) }))); };
    const begin = async (pr, start, when) => { const d = thinking();
      try { await App.saveProgram(pr.id, start); d.remove(); const rd = road(); lastRoad = rd ? rd.sig : "";
        say(`${window.MDFitHype ? window.MDFitHype("program") + " " : ""}${pr.title} starts ${when.toLowerCase()}. Watch your calendar fill in, then I'll bring you back to your road.`);
        end(); setTimeout(() => { shut(); if (App.showPlanOnCalendar) App.showPlanOnCalendar(); }, 1500);
      } catch { d.remove(); say("I couldn't save that just now. You can save it from the program's page."); offer([{ label: `Open ${pr.title}`, hash: "programs/" + pr.id, name: pr.title, gold: true }]); end(); } };
    const show = (pr) => { say(`${pr.title}. ${String(pr.summary || "").split(/(?<=[.!?])\s/)[0] || `${pr.weeks} weeks, ${pr.level || "all levels"}.`}`);
      offer([{ label: "Make this my road", gold: true, more: () => choose(pr) }, { label: "See it first", hash: "programs/" + pr.id, name: pr.title }, { label: "Show me others", more: () => beat(() => pickRoad("What are you here for?")) }]); };
    const me = (App.about && App.about()) || {};
    const fitFor = (id, cats) => { let fit = all.filter((x) => cats.includes(x.category));
      // their own sports first, when they are here for a sport
      if (id === "sport" && (me.sports || []).length) { const names = me.sports.map((x) => word("sports", x).split(" ")[0]); fit = [...fit.filter((x) => names.some((n) => x.title.toLowerCase().includes(n))), ...fit.filter((x) => !names.some((n) => x.title.toLowerCase().includes(n)))]; }
      return fit.slice(0, 4); };
    const offerFit = (id, cats, lead) => { const fit = fitFor(id, cats); say(lead || (fit.length === 1 ? "This is the one for that:" : "These fit that. Pick one:"));
      offer([...fit.map((pr) => ({ label: pr.title, sub: `${pr.weeks} weeks · ${pr.level || "all levels"}`, more: () => beat(() => show(pr)) })), ...(lead ? [{ label: "Something else", more: () => beat(() => ask2()) }] : [])]); };
    const ask2 = () => { say(opener || "What are you here for? I'll point to the road that fits.");
      offer(AIMS.filter(([, , cats]) => all.some((x) => cats.includes(x.category))).map(([id, label, cats]) => ({ label, more: () => beat(() => offerFit(id, cats)) }))); };
    const known = !opener || /pick your road/i.test(opener) ? AIMS.find(([id, , cats]) => id === me.aim && all.some((x) => cats.includes(x.category))) : null;
    if (known) offerFit(known[0], known[2], `You told me you're here to ${known[1].toLowerCase().replace(/\bmy\b/, "your")}. These fit:`); else ask2();
  }
  // ---------- a pain check-in, done in the chat: where, how strong, saved ----------
  // The words the app's own check-in uses for each area a member might name
  const LOG_AREA = { knee: "Knee", back: "Lower back", shoulder: "Shoulder", hip: "Hip", neck: "Neck", ankle: "Ankle / foot", foot: "Ankle / foot", elbow: "Elbow / wrist / hand", wrist: "Elbow / wrist / hand" };
  function checkin(areaKey, opener) {
    const areas = App.painAreas ? App.painAreas() : [];
    if (!App.logPain || !areas.length) { say("The check-in is in the pain tool."); return offer([{ ...opt("pain"), gold: true }]); }
    const strong = (area) => { say(area === "Other" ? "How strong is it right now, 0 to 10?" : `How strong is your ${area.toLowerCase()} right now, 0 to 10?`);
      offer(Array.from({ length: 11 }, (_, n) => ({ label: String(n), more: () => save(area, n) }))); };
    const save = async (area, n) => { const d = thinking();
      try { await App.logPain(area, n); d.remove();
        const hy = (k) => (window.MDFitHype ? window.MDFitHype(k) : "");
        say(n === 0 ? "Logged: no pain today. Good." : `Logged: ${area.toLowerCase()}, ${n} out of 10.${n >= 7 ? " That is a lot to carry. It's worth having Dr. Jared look at it." : " " + hy("checkin")}`.trim());
        const key = Object.keys(LOG_AREA).find((k) => LOG_AREA[k] === area), rd = road(); lastRoad = rd ? rd.sig : "";
        if (rd && rd.kind !== "done") say(rd.say.replace(/^You're on your first descent[.,] ?(This stop: )?/, "That stop is done. Next: "));
        offer([backToRoad(), ...plain(rd && rd.opt), ...(key && n > 0 ? [{ label: `Programs for your ${key}`, more: () => beat(() => showArea(key)) }] : []), ...(n > 0 ? [{ label: "See what is likely behind it", hash: "pain", name: "the pain tool" }] : []), ...(n >= 5 ? [opt("book")] : [])]);
      } catch (e) { d.remove(); say("I couldn't save that just now. You can log it in the pain tool."); offer([{ ...opt("pain"), gold: true }]); } end(); };
    const known = LOG_AREA[areaKey];
    if (known) return strong(known);
    say(opener || "Let's log it right here. Where does it bother you most?");
    offer([...areas.filter((a) => a !== "Other").map((a) => ({ label: a, more: () => beat(() => strong(a)) })), { label: "Somewhere else", more: () => beat(() => strong("Other")) }, { label: "Nothing hurts today", more: () => save("Other", 0) }]);
  }
  checkin.none = async () => { const d = thinking(); try { await App.logPain("Other", 0); d.remove(); const rd = road(); lastRoad = rd ? rd.sig : ""; say(rd && rd.kind !== "done" ? `Logged. ${rd.say.replace(/^You're on your first descent[.,] ?(This stop: )?/, "Next: ")}` : "Logged."); offer([backToRoad(), ...plain(rd && rd.opt)]); } catch { d.remove(); say("I couldn't save that just now."); offer([opt("pain")]); } end(); };
  function hurting(area, extra) {
    if (area) ctx.area = area;
    say(`Okay, I understand how frustrating that can be${area ? `, especially with your ${area}` : ""}. Here's what I can take you to:`);
    offer([{ label: "Log it now", gold: true, more: () => beat(() => checkin(area)) }, ...(area ? [{ label: `Programs for your ${area}`, more: () => beat(() => showArea(area)) }] : []), opt("pain"), opt("book"), ...(extra || []), opt("call")]);
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
  // The member's unpaid invoices, said plainly: the number, the amount, what it is for and when it was sent. `why` =
  // they asked why they got it, so lead with what it is for. All from what the app already holds; nothing is sent.
  let lastTopic = "";
  const sentOn = (v) => { const d = String((v && v.at) || "").slice(0, 10); try { return /^\d{4}-\d{2}-\d{2}$/.test(d) ? M.fmtDate(d, { month: "short", day: "numeric" }) : ""; } catch { return ""; } };
  function invoiceTalk(why) {
    const inv = (state().invoices || []).filter((v) => v && v.number && v.path);
    lastTopic = "invoice";
    if (!inv.length) { say("I couldn't find an unpaid invoice on your account."); offer([opt("premium"), opt("call")]); return; }
    const about = (v) => `${v.number} is ${money(v.amount)}${v.description ? ` for ${String(v.description).replace(/[.\s]+$/, "")}` : ""}${sentOn(v) ? `, sent ${sentOn(v)}` : ""}.`;
    if (why) say(inv.length === 1 ? `Dr. Jared's office sent it. Invoice ${about(inv[0])} If it doesn't look right, message Dr. Jared or call the clinic.` : `Dr. Jared's office sent them. ${inv.slice(0, 3).map((v) => "Invoice " + about(v)).join(" ")} If one doesn't look right, message Dr. Jared or call the clinic.`);
    else say(inv.length === 1 ? `You have one unpaid invoice. ${about(inv[0])}` : `You have ${inv.length} unpaid invoices. ${inv.slice(0, 3).map(about).join(" ")}`);
    offer([...inv.slice(0, 4).map((v) => ({ label: `Pay invoice ${v.number}`, sub: money(v.amount), href: v.path, gold: true })), ...(why ? [opt("messages"), opt("call")] : [opt("premium")])]);
  }
  // ---------- what Solomon can say on the phone, with no AI: real picks from the app's own programs, and plain answers
  // to the questions people ask next. Everything here is the practice's own wording; nothing typed is sent anywhere.
  const GOALS = [ // words a member might use -> words to look for in a program's title or category
    { w: ["strength", "stronger", "strong", "muscle", "build", "bulk", "size", "hypertrophy", "lift", "lifting", "barbell", "powerlifting", "bodybuilding"], f: ["hypertrophy", "strength", "growth"] },
    { w: ["weight", "lean", "fat", "lose", "tone", "toned", "slim", "diet"], f: ["weight loss", "lean"] },
    { w: ["mobility", "flexible", "flexibility", "stretch", "stretching", "stiff", "loosen", "limber"], f: ["mobility"] },
    { w: ["golf", "golfer"], f: ["golf"] }, { w: ["pickleball"], f: ["pickleball"] }, { w: ["run", "running", "runner", "5k", "10k", "jog", "jogging"], f: ["running"] },
    { w: ["marathon"], f: ["marathon"] }, { w: ["ski", "skiing"], f: ["ski"] },
    { w: ["inflammation", "inflammatory", "inflamed"], f: ["anti-inflammatory"] }, { w: ["posture", "desk", "sitting"], f: ["posture", "posterior chain", "mobility"] }
  ];
  const RECOMMEND = /\b(recommend|reccomend|recomend|reccommend|suggest|suggestion|suggestions|which (program|plan|one)|what (program|programs|plan|plans)|what should i (do|start|try|pick|choose)|best (program|plan|one)|where (do|should) i start|how (do|should) i start|not sure (what|which|where|how)|help me (pick|choose|start)|pick (one|a program|something) for me|what do you (recommend|suggest|think))\b/;
  const LEVEL_WORD = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", elite: "Elite" };
  async function recommend(u) {
    const c = App.client() || {}; let C = null; try { C = await App.content(); } catch {}
    const progs = ((C && C.programs) || []).filter((p) => p && p.id && p.title);
    const subOf = (p) => [p.category, LEVEL_WORD[p.level] || "", p.weeks ? `${p.weeks} weeks` : ""].filter(Boolean).join(" · ");
    const row = (p, gold, sub) => (p.locked === true && !gold) // locked only where the app really locks it
      ? { label: p.title, sub: "Members · unlock with Membership", lock: true, run: () => { tell("upgrade"); if (App.showTier) App.showTier("member"); else App.go("premium"); }, name: "Membership" }
      : { label: p.title, sub: sub || subOf(p), gold: !!gold, hash: `programs/${p.id}`, name: p.title, pick: p.title };
    const picked = [], seen = new Set(), add = (p, gold, sub) => { if (p && !seen.has(p.id) && picked.length < 4) { seen.add(p.id); picked.push(row(p, gold, sub)); } };
    const hit = (p, words) => words.some((w) => has(norm(p.title + " " + (p.category || "")), w));
    // 1. what Dr. Jared recommended for them
    const mineP = (c.assignedPrograms || []).map((x) => progs.find((p) => p.id === x.id)).filter(Boolean);
    mineP.slice(0, 2).forEach((p) => add(p, true, "Recommended by Dr. Jared"));
    // 2. a goal or a body area in what they just typed
    const goal = GOALS.find((g) => g.w.some((w) => has(u.text, w))), area = u.area || ctx.area || "";
    if (goal) progs.filter((p) => hit(p, goal.f)).sort((a, b) => (a.level === "beginner" ? -1 : 0) - (b.level === "beginner" ? -1 : 0)).slice(0, 3).forEach((p) => add(p));
    if (area && AREAS[area]) progs.filter((p) => hit(p, AREAS[area].f)).slice(0, 2).forEach((p) => add(p));
    // 3. the area of their last pain check-in
    const last = norm(App.lastPain ? App.lastPain() : ""), pkey = last.trim() ? Object.keys(AREAS).find((k) => AREAS[k].f.some((w) => has(last, w)) || has(last, k)) : "";
    if (!goal && !area && pkey) progs.filter((p) => hit(p, AREAS[pkey].f)).slice(0, 2).forEach((p) => add(p));
    // 4. good places to start: one of each kind, beginner first
    const specific = !!(goal || area || pkey || mineP.length);
    if (picked.length < ((goal || area) && picked.length ? 1 : 3)) for (const cat of ["Mobility", "Rehabilitation", "Hypertrophy", "Weight loss", "Sport Performance", "Anti-inflammatory"]) {
      add(progs.filter((p) => p.category === cat).sort((a, b) => (a.level === "beginner" ? -1 : 0) - (b.level === "beginner" ? -1 : 0))[0]);
      if (picked.length >= (specific ? 3 : 4)) break;
    }
    lastTopic = "programs";
    if (!picked.length) { say("The programs are all in one place. Tell me what you're working on and I'll narrow it down."); offer([opt("programs"), opt("pain")]); return; }
    const first = mineP[0];
    say(first ? `Start with ${first.title}: Dr. Jared recommended it for you. ${picked.length > 1 ? "These fit too:" : ""}`.trim()
      : goal || area ? "Here's what I'd start with for that:"
      : pkey ? `Since you logged your ${pkey}, I'd start here:`
      : "Here are good ones to start with. Tell me your goal (a sore spot, strength, weight loss, golf, running) and I'll narrow it down:");
    sys(first ? "Recommended and suggested" : "Suggested programs");
    offer(picked);
    offer([opt("programs"), ...(pkey || area ? [opt("pain")] : [])]);
  }
  // Plain answers to what people ask next. Each is the practice's own position, said the same way every time.
  const priceOf = async () => { try { const C = await App.content(); const t = ((C && C.tiers) || []).find((x) => x.id === "member"); return t ? money(Math.round(Number(t.price) * 100)) : ""; } catch { return ""; } };
  const FAQ = [
    { re: /\b(will|do|does|did|can|could) (it|they|this|that|these|those|the programs?|the app) (really |actually )?(work|help)\b|\b(does|do) (it|they|this|these) (really |actually )?work\b|\bis (it|this) (any )?good\b|\bare (they|these) (any )?good\b|\bworth it\b/, run: async () => {
      say("They're the same programs Dr. Jared uses with his clinic patients, built on how he treats in person: release what's tight, correct how you move, then build strength. What makes them work is doing the sessions regularly. If something isn't improving after a few weeks, book an evaluation so he can look at it himself.");
      offer([opt("programs"), opt("progress"), opt("book")]); } },
    { re: /\bhow long\b|\bhow many (weeks|days|minutes|sessions)\b|\bhow much time\b|\bwhen will i (see|feel|notice)\b/, run: async () => {
      let C = null; try { C = await App.content(); } catch {}
      const w = ((C && C.programs) || []).map((p) => Number(p.weeks)).filter((n) => n > 0), lo = w.length ? Math.min(...w) : 4, hi = w.length ? Math.max(...w) : 12;
      say(`Programs run ${lo} to ${hi} weeks, and each one lists its length and sessions before you start. Most sessions are short enough to fit a normal day. Your Progress screen shows how it's going week by week.`);
      offer([opt("programs"), opt("progress")]); } },
    { re: /\b(is|are) (it|this|they|the app|sunny|solomon|the programs?) free\b|\bhow much (is|does|do|are)\b|\b(cost|costs|price|prices|pricing|pay for|paid|subscription)\b/, run: async () => {
      const p = await priceOf();
      say(`The app is free: the pain tool, the exercise videos and I are all included. Membership${p ? ` is ${p} a month and` : ""} adds every program, the lecture library, the live Q&A and unlimited time with me.`);
      offer([opt("premium"), opt("programs"), opt("pain")]); } },
    { re: /\b(who are you|what are you|are you (a )?(real|human|person|bot|robot|ai)|what can you do|what do you do|how (do|can) you help)\b|^\s*help( me)?( please)?[\s!?.]*$/, run: async () => {
      say("I'm Solomon, the assistant in your MD Fit app. I can pick a program for you, find the right video, take you to the pain tool, book a visit, set a reminder, and tell you what's waiting on your account. For a question about your own body, Dr. Jared is the one to ask.");
      offer([{ label: "Pick a program for me", more: () => beat(() => recommend({ text: " ", area: "" })) }, opt("pain"), opt("book")]); } },
    { re: /\b(who is|who'?s|about) (dr\.? ?jared|dr\.? ?caban|the doctor|the doc)\b/, run: async () => {
      say("Dr. Jared Caban leads MD Fit in Sarasota. He's a Certified Clinical Exercise Physiologist and Licensed Massage Therapist with medical training, and he built every program and video in this app.");
      offer([opt("book"), opt("messages"), opt("learn")]); } },
    { re: /^\s*(thanks|thank you|thx|ty|cheers|appreciate it|great|awesome|perfect|cool|ok|okay|got it|nice)[\s!.]*$/, run: async () => { say("Anytime. I'm here whenever you need me."); } }
  ];
  const faqFor = (raw, t) => FAQ.find((f) => f.re.test(t) || f.re.test(String(raw || "").toLowerCase()));

  // A short follow-up ("why?", "what for?", "how much?") is about what was just talked about
  const FOLLOW = /^\s*(why|why\?*|how come|what for|what is (it|that|this) for|what'?s (it|that|this) for|what is (it|that)|what'?s that|explain|how much|when|huh|\?+)\s*\??\s*$/i;

  // Questions about the member's own account, answered from what the app has already loaded
  function own(u) {
    const t = u.text, s = state();
    if (/\b(when|what time|next|upcoming|do i have|have i got|is my|are my)\b/.test(t) && /\b(appointment|appointments|visit|visits|session)\b/.test(t)) return { kind: "profile", run: () => {
      const v = nextVisit(s);
      if (v) { say(`Your next visit is ${v.typeName ? v.typeName + " " : ""}${whenWords(v)}.`); offer([{ label: "See my appointments", hash: "profile", name: "your profile" }, ...(v.meetingLink && v.date === M.todayInTz() ? [opt("visit")] : []), opt("book")]); }
      else { say("I couldn't find an upcoming visit on your account."); offer([opt("book"), { label: "See my appointments", hash: "profile", name: "your profile" }, opt("call")]); } } };
    if (/\b(owe|owed|balance|invoice|invoices|bill|bills|due)\b/.test(t) || (/\bpay\b/.test(t) && !/\bmembership\b/.test(t))) return { kind: "membership", run: () => invoiceTalk(/\b(why|what for|what is it for|what'?s it for|how come|explain)\b/.test(t)) };
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
  // the best match is the longest phrase found, so "customize home" beats "home"
  function wayFor(t) { let best = null, len = 0; for (const w of WAYS) for (const k of w.w) if (k.length > len && has(t, k)) { best = w; len = k.length; } return best; }
  function showWay(w) {
    say(`${w.at} I can take you there now.`);
    offer([{ label: w.label, gold: true, name: w.name, ...(w.href ? { href: w.href } : w.card ? { run: () => App.showCard(w.card[0], w.card[1]) } : w.run ? { run: w.run } : { hash: w.hash }) }, opt("call")]);
  }
  function decide(u, raw) {
    const plan = route(u, raw); if (["looks", "reminder"].includes(plan.kind) || plan.own) plan.local = true; return plan;
  }
  function route(u, raw) {
    const t = u.text;
    if (HELLO.test(String(raw || "")) && !u.pained && !u.area) return { kind: "other", local: true, free: true, run: hello };
    if (/\b(dark|black|night) ?(mode|theme|look)?\b/.test(t) && !u.pained) return { kind: "looks", run: () => look({ theme: "black" }, "Done. Black it is. Anything else you'd like to change about how the app looks?") };
    if (/\b(white|light (mode|theme|look)|make it light)\b/.test(t)) return { kind: "looks", run: () => look({ theme: "white" }, "Done. White it is. Anything else you'd like to change?") };
    if (/\b(compact|tighter|denser)\b/.test(t)) return { kind: "looks", run: () => look({ layout: "compact" }, "Done. More fits on every screen now.") };
    if (/\b(comfortable|roomy|roomier)\b/.test(t)) return { kind: "looks", run: () => look({ layout: "comfortable" }, "Done. A little more room on every screen.") };
    if (/\b(layout|theme|customi[sz]e|personali[sz]e|make it mine|look and feel)\b/.test(t)) return { kind: "looks", run: () => look(null, "Here's what you can change. Pick one, or just tell me.") };
    if (/\b(remind me|set a reminder|reminder (for|to|at)|save (it|that|this)|put (it|that|this) (in|on)|add (it|that|this) to|(on|in|to) my calendar)\b/.test(t)) return { kind: "reminder", run: () => remind(u, raw) };
    if (/\breminders?\b/.test(t)) return { kind: "reminder", run: myReminders };
    if (FOLLOW.test(String(raw || "")) && lastTopic === "invoice") return { kind: "membership", own: true, run: () => invoiceTalk(true) };
    if (/\b(get to know me|know me better|about me|my goals?|change my goals?|update my goals?|tell you about (me|myself))\b/.test(t) && !/\b(daily|xp)\b/.test(t)) return { kind: "other", local: true, free: true, run: () => knowYou() };
    if (/\b(check ?-?in|log (my |the |a )?pain|log it|record (my |the )?pain)\b/.test(t)) return { kind: "pain", local: true, free: true, run: () => checkin(u.area) };
    if (!u.area && /^\s*(it'?s |its |it is |i hurt |hurts )?(everything|everywhere|all over|all of it|my whole body|whole body|all of me)( hurts| aches| is sore)?\s*$/.test(t)) return { kind: "pain", local: true, free: true, run: () => checkin("", "That's a lot to carry. Start with the one that bothers you most, and we'll log it right here:") };
    if (!u.area && /^\s*(nothing|nothing hurts|no pain|none|i'?m fine|im fine|i feel (fine|good|great)|all good|nothing really)\s*$/.test(t)) return { kind: "pain", local: true, free: true, run: () => { say("Good to hear. I'll log that as no pain today."); checkin.none(); } };
    const acct = own(u); if (acct) return { ...acct, own: true };
    // The way to something in the app: answered here, with the path and a button that goes there
    if (!u.pained && !u.area) { const w = wayFor(t); if (w) return { kind: "other", local: true, free: true, run: () => showWay(w) }; }
    // On the phone: a real pick from the app's programs, and plain answers to the usual next questions
    if (RECOMMEND.test(t) && !u.pained) return { kind: "programs", run: () => recommend(u) };
    // A goal said plainly ("I want to get stronger", "lose weight", "better at golf") is asking for a pick too
    if (!u.pained && GOALS.some((g) => g.w.some((w) => has(t, w))) && !u.places.some((p) => ["book", "messages", "profile", "premium", "call", "visit", "generate", "videos"].includes(p.id))) return { kind: "programs", run: () => recommend(u) };
    if (!u.pained && !/\b(appointment|appointments|visit|visits|invoice|invoices|bill|owe|reminder)\b/.test(t)) { const f = faqFor(raw, t); if (f) return { kind: "other", run: f.run }; }
    if (FOLLOW.test(String(raw || "")) && lastTopic === "programs") return { kind: "programs", run: FAQ[0].run };
    if (u.pained) return { kind: "pain", run: () => hurting(u.area, u.places.filter((p) => !["pain", "book", "call"].includes(p.id)).slice(0, 1).map((p) => opt(p.id))) };
    if (u.area) return { kind: (u.places[0] || {}).kind || "programs", run: () => showArea(u.area) };
    if (u.places.length && WHERE.test(t) && AT[u.places[0].id]) return { kind: u.places[0].kind, local: true, free: true, run: () => { const p = u.places[0];
      say(`${AT[p.id][phone() ? 0 : 1]} I can take you there now.`); offer([{ ...opt(p.id), gold: true }, ...u.places.slice(1, 3).map((x) => opt(x.id))]); } };
    if (u.places.length) return { kind: u.places[0].kind, run: () => { say(u.places.length === 1 ? "Got it. This is the place for that:" : "Got it. These look like what you're after:"); offer([...u.places.slice(0, 4).map((p) => opt(p.id)), ...(u.places.some((p) => p.id === "call") ? [] : [opt("call")])]); } };
    // Short and unplaceable ("everything", "ok", "what now"): answered from where they are on their road, on the device
    { const rd = road(), words = t.trim().split(/\s+/).filter(Boolean).length;
      if (rd && words <= 4) return { kind: "other", local: true, free: true, run: () => { lastRoad = rd.sig; say(rd.say); offer([...(rd.opt ? [rd.opt] : []), opt("generate"), opt("programs"), opt("call")]); } }; }
    return { kind: "other", run: async () => {
      const m = await mine(), theirs = own3(m);
      say(theirs.length ? "I didn't quite get that one. Try telling me what you're working on, like a sore knee, getting stronger, or booking a visit. Here's what you have going:" : "I didn't quite get that one. Try telling me what you're working on, like a sore knee, getting stronger, or booking a visit. Or start here:");
      offer([...theirs, opt("pain"), opt("programs"), opt("generate"), opt("book"), opt("messages"), opt("call")]); } };
  }
  async function ask(raw) {
    const text = String(raw || "").trim(); if (!text || busy) return false;
    try { document.dispatchEvent(new CustomEvent("mdfit:guide-asked")); } catch {} // the first descent's "Meet Solomon" stop (account.js)
    say(text, true);
    const u = understand(text);
    // An emergency is answered at once: never counted, never behind the limit
    if (u.urgent) { emergency(); return true; }
    const plan = decide(u, text);
    busy = true; const d = thinking(), t0 = Date.now();
    // With the assistant on, a question the device does not answer itself is read on MD Fit's server; anything else
    // (and any failure there) is understood here and only counted.
    let ai = null, asked = false; if (G.ai && !plan.local) { ai = await askServer(text); asked = !!ai; }
    if (ai && ai.ok !== false && !ai.urgent && /\bcan only help with\b/i.test(String(ai.say || "")) && (u.places.length || u.area)) ai = null;
    const ok = ai || asked || plan.free ? true : await count(plan.kind); // a hello is never counted (nor a question the server already counted)
    const rest = 750 - (Date.now() - t0); if (rest > 0) await wait(rest);
    d.remove();
    lastTopic = ""; // a follow-up belongs to the answer just given; the answer below sets it again if it has one
    try { if (ai) await aiAnswer(ai); else if (!ok) limit(); else await plan.run(); } catch { say("Something went wrong on my side. You can still get anywhere from the menu, or call the clinic."); offer([opt("call")]); }
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
  async function aiAnswer(r) {
    if (r.ok === false) return limit();
    if (r.urgent) return emergency();
    const area = AREAS[r.area] ? r.area : ""; if (area) ctx.area = area;
    const ids = [...new Set((Array.isArray(r.places) ? r.places : []).map((x) => FROM_SERVER[x] || x))].filter((id) => id !== "call" && PLACES.some((p) => p.id === id)).slice(0, 5);
    say(String(r.say || "").trim().slice(0, 600) || "Here's where I can take you:");
    const rd = road();
    offer([...(rd && rd.opt && !["done", "ask"].includes(rd.kind) ? [{ ...rd.opt, label: rd.opt.label === "Do my check-in here" ? "Next on your road: my check-in" : `Next on your road: ${rd.opt.label.replace(/^(Open|Start|Pick|Build) /, (m) => m.toLowerCase())}` }] : []), ...(area ? [{ label: `Programs for your ${area}`, more: () => beat(() => showArea(area)) }] : []), ...ids.map(opt), opt("call")]);
    let C = null; try { C = await App.content(); } catch {}
    suggest(r.suggested, new Map(((C && C.programs) || []).map((p) => [p.id, p])));
  }
  // Solomon's suggestions with an answer: programs (a members-only one shows locked and opens the membership page),
  // exercise videos and a general tip, each tagged Suggested. The server has already put them on the member's Home.
  function suggest(sg, byId = new Map()) {
    if (!sg || typeof sg !== "object") return;
    const progs = (Array.isArray(sg.programs) ? sg.programs : []).filter((p) => p && typeof p.id === "string" && typeof p.title === "string").slice(0, 3);
    const vids = (Array.isArray(sg.videos) ? sg.videos : []).filter((v) => v && typeof v.id === "string" && (App.exercise ? App.exercise(v.id) : v.name)).slice(0, 4);
    const tip = typeof sg.tip === "string" ? sg.tip.trim().slice(0, 300) : "";
    const guides = (Array.isArray(sg.guides) ? sg.guides : []).filter((g) => g && typeof g.id === "string" && typeof g.title === "string").slice(0, 3);
    if (!progs.length && !vids.length && !tip && !guides.length) return;
    if (progs.length) {
      sys("Suggested programs");
      // A lock only where the app really locks that program (what the Programs screen shows), so the two never disagree
      offer(progs.map((p) => (byId.get(p.id) || {}).locked === true
        ? { label: p.title, sub: "Members · unlock with Membership", lock: true, run: () => { tell("upgrade"); if (App.showTier) App.showTier("member"); else App.go("premium"); }, name: "Membership" }
        : { label: p.title, sub: "Suggested", hash: `programs/${p.id}`, name: p.title, pick: p.title }));
    }
    if (vids.length) {
      sys("Suggested videos");
      offer(vids.map((v) => { const ex = App.exercise ? App.exercise(v.id) : null, name = (ex && ex.name) || v.name;
        return { label: name, sub: [ex && ex.region, "Suggested"].filter(Boolean).join(" · "), more: () => { if (!App.playExercise || !App.playExercise(v.id)) say("That video isn't available just now. It's in the video library."); } }; }));
    }
    if (guides.length) {
      sys("From Dr. Jared's guides");
      offer(guides.map((g) => ({ label: g.title, sub: "Suggested", hash: `tips/${g.id}`, name: g.title })));
    }
    if (tip) { const d = say(tip); const t = document.createElement("span"); t.className = "mg-sug"; t.textContent = "Suggested"; d.prepend(t); }
    sys("Added to your Home under Suggested for you");
    if (App.setSuggested) M.apiAuth("GET", "/api/me").then((r) => r && r.client && r.client.suggested && App.setSuggested(r.client.suggested)).catch(() => {});
  }
  async function greet() {
    greeted = true;
    const w = waiting(); lastSig = w.sig;
    // (on the first opening of a day the chat opens with the same welcome he gave above the cloud)
    say(dayHello ? `${dayHello} What are we working on today?` : `Hey ${first()}, I'm Solomon. What are we working on today?`);
    if (w.line) say(w.line);
    const m = await mine(), rd = road(); lastRoad = rd ? rd.sig : "";
    if (rd && !w.line && rd.kind !== "ask") say(rd.say);
    else if (m.rec && !w.line) say(`Want to pick up ${m.title} that Dr. Jared recommended?`);
    offer([...(rd && rd.opt && rd.kind !== "ask" ? [rd.opt] : []), ...w.opts, ...own3(m),
      { label: "Something hurts", more: () => beat(() => { say("I'm sorry to hear that. Where is it bothering you?"); offer(["knee", "back", "shoulder", "hip", "neck", "foot"].map((a) => ({ label: cap(a), more: () => beat(() => hurting(a)) }))); }) },
      opt("book"), opt("programs"), opt("generate"),
      ...(theme() ? [{ label: "Make the app mine", more: () => beat(() => look(null, "Here's what you can change. Pick one, or just tell me.")) }] : [])]);
  }
  // Something new turned up since the guide last looked (a visit, an invoice, a message): say so on the next open
  function news() { const w = waiting(), rd = road();
    if (w.sig && w.sig !== lastSig) { say(`Something is waiting for you. ${w.line}`.trim()); offer(w.opts); }
    else if (rd && lastRoad && rd.sig !== lastRoad) { say(rd.kind === "done" ? rd.say : `You moved along. ${rd.say.replace(/^You're on your first descent[.,] ?/, "Still on your first descent. ")}`); if (rd.opt) offer([rd.opt]); }
    lastSig = w.sig; lastRoad = rd ? rd.sig : lastRoad; }

  // ---------- open and close ----------
  function fitKeyboard() { // keep the box above a phone's on-screen keyboard
    const vv = window.visualViewport; if (!vv || box.hidden) return;
    if (!phone()) { box.style.bottom = ""; box.style.height = ""; return; }
    const under = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    box.style.bottom = under ? under + "px" : ""; box.style.height = under ? Math.round(vv.height * 0.94) + "px" : "";
  }
  // A stop on the road, done with Solomon: the chat opens over the road and goes straight to the lesson
  function lesson(ref) {
    open(false, true);
    beat(() => (ref === "know" ? knowYou() : ref === "pain" ? checkin("", "This stop is your check-in. Where does it bother you most? Or tell me nothing hurts.") : pickRoad("This stop: pick your road. What are you here for?")));
  }
  function open(byHand, quiet) {
    if (!box.hidden) return;
    hush(); box.hidden = false; scrim.hidden = !phone(); dot.hidden = true; btn.setAttribute("aria-expanded", "true"); document.documentElement.classList.add("mg-open");
    try { localStorage.setItem("mdfit-guide-met", "1"); } catch {}
    if (quiet) greeted = true; else if (!greeted) greet(); else news();
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

  // Someone who has not met him yet is invited once; after that what he says depends on where they are (account-solomon.js)
  let met = false; try { met = !!localStorage.getItem("mdfit-guide-met"); } catch {}
  if (!met) setTimeout(() => { if (tag.hidden) speak("Tap me to talk", { ms: 7000 }); }, 1200);
  // Out of the way of a full-screen workout, and lifted clear of the app's pop-up notifications
  const hideFor = () => { const p = document.getElementById("player"), on = !!(p && !p.hidden); btn.classList.toggle("mg-away", on); tag.classList.toggle("mg-away", on); if (on) hush(); if (on && !box.hidden) shut(); };
  const player = document.getElementById("player"); if (player && window.MutationObserver) { new MutationObserver(hideFor).observe(player, { attributes: true, attributeFilter: ["hidden"] }); hideFor(); }
  const notifs = document.getElementById("notifs");
  const lift = () => { let px = 0;
    // (measured against where the cloud sits unlifted, so being lifted does not make it drop back)
    for (const el of [notifs && notifs.children.length ? notifs : null, document.getElementById("inv-banner")]) {
      if (!el || el.hidden) continue; const n = el.getBoundingClientRect(), b = btn.getBoundingClientRect();
      if (n.height && n.right > b.left - 8) px = Math.max(px, Math.round(n.height + 22)); }
    document.documentElement.style.setProperty("--mg-lift", px + "px"); };
  if (notifs && window.MutationObserver) new MutationObserver(lift).observe(notifs, { childList: true, subtree: true });
  // The "new invoice" banner is added to and removed from the page itself; it must never sit on top of the cloud
  if (window.MutationObserver) new MutationObserver(lift).observe(document.body, { childList: true });
  lift();

  load();
  window.MDFitGuide = { day: dayRows, understand, open: () => open(false), lesson, shut, say: speak, hush, speaking: () => !tag.hidden, greeting: (t) => { dayHello = String(t || "").trim(); }, reminders: () => G.reminders.slice() };
})();
