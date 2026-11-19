// MD Fit member app: what Solomon says without being asked, wherever the member is. There is one Solomon (the cloud,
// mdfit-guide.js); this file only chooses his line for the screen in front of them and hands it to MDFitGuide.say(),
// which shows it above the cloud. Tapping the line does what it offers; tapping the cloud opens the chat as always.
//
// Every line is put together here, on the device, from what is already on the member's own screens (the Next tile, the
// mine, the rank card). Nothing is sent anywhere to make one, and none of this is the member's own words.
// He speaks when a screen opens, at most twice more if they stay on it, and never repeats a line inside ten minutes.
// On the first opening of a day he welcomes them first: by how long they were away and whether it is earlier or later
// than they usually train (two numbers the server works out from dates and hours; nothing from their record).
// Profile → Reminders from Solomon has the switch that keeps him quiet until tapped (kept on the device).
(() => {
  const A = window.MDFitApp, G = window.MDFitGuide; if (!A || !G || !G.say || !A.nextUp) return;
  const QUIET = "mdfit-solomon-quiet", AGAIN = 10 * 60 * 1000;
  const quiet = () => { try { return localStorage.getItem(QUIET) === "1"; } catch { return false; } };
  const s = (n) => (n === 1 ? "" : "s");
  // Solomon's own sayings (written for the app, in the manner of old proverbs; none is a quotation)
  const SAYINGS = ["The patient miner finds the brighter stone.", "Small steps, well kept, move mountains.", "What you build daily, no one can take.",
    "Strength is gathered, not found.", "A steady hand outlasts a strong one.", "The lamp you tend lights the whole road.", "Dig a little each day and the mountain yields."];
  const saying = (k = 0) => SAYINGS[(Math.floor(Date.now() / 864e5) + k) % SAYINGS.length];
  const INTRO = { solomon: "I'm Solomon. Tap me and ask anything: that's your first stop.", know: "Next stop: let me get to know you. A few taps.", pain: "Next stop: tell me what hurts, or that nothing does.", program: "Pick a road. I'll walk it with you.",
    session: "One session. That's all today asks.", friend: "Bring a friend down here and you both gain." };
  const stopsWord = () => { let n = 0; try { n = (A.journey().stops || []).length; } catch {} const w = n && A.numWord ? A.numWord(n) : "A few"; return w.charAt(0).toUpperCase() + w.slice(1); };
  const open = () => G.open(), to = (go) => () => A.goNext(go, true);
  // ---- The hype man, and a just one (owner, Nov 2026): he praises what was actually done, the moment it is done, and
  // makes it personal from what the member told him about themselves ("as I'd expect from an ex-tennis player").
  // Never for nothing, never a rank they did not claim: "ex-tennis player", not "pro".
  const NOUN = { football: "football player", basketball: "basketball player", baseball: "ballplayer", soccer: "soccer player", tennis: "tennis player", pickleball: "pickleball player", golf: "golfer", running: "runner",
    swimming: "swimmer", volleyball: "volleyball player", wrestling: "wrestler", martial: "fighter", gymnastics: "gymnast", cheer: "cheerleader", dance: "dancer", hockey: "hockey player", lacrosse: "lacrosse player",
    cycling: "cyclist", rowing: "rower", lifting: "lifter", skiing: "skier", surfing: "surfer", climbing: "climber", chess: "chess player" };
  function hype(kind) {
    const ab = (A.about && A.about()) || {}, sport = (ab.sports || []).find((x) => NOUN[x]), noun = sport ? NOUN[sport] : "", n = Number(ab.competitive) || 0, day = Math.floor(Date.now() / 864e5);
    const pick = (list) => list[day % list.length];
    if (kind === "workout") {
      if (ab.athlete === "comp" && noun) return pick([`That was brilliant. Exactly what I'd expect from an ex-${noun}.`, `Done, and done properly. The ${noun} in you never left.`]);
      if (ab.athlete === "fun" && noun) return pick([`That was brilliant. The ${noun} in you still shows up.`, `Session done. You can take the ${noun} off the field, but there they are.`]);
      if (n >= 8) return `Session done. A ${n} out of 10 competitor doesn't leave it for tomorrow.`;
      if (ab.athlete === "no") return "That was brilliant. Not bad for someone who says sport wasn't their thing.";
      return pick(["That was brilliant. You said you would, and you did.", "Session done. That one counts."]);
    }
    if (kind === "checkin") return ab.athlete === "comp" ? "An honest number. Athletes know the scoreboard doesn't lie." : "An honest number. That's how we beat it.";
    if (kind === "program") return n >= 8 ? "Good pick. Now there's something to win." : "Good pick.";
    if (kind === "alllit") return noun ? `Every lamp lit. A full day's work, ${ab.athlete === "comp" ? `ex-${noun}` : noun}. You earned each one.` : "Every lamp lit. A full day's work, and you earned each one.";
    return "";
  }
  window.MDFitHype = hype;
  // His welcome on the first opening of a day. The joke is always on him (a cloud who cannot lift anything), never on
  // the member, and a long absence gets one dry line or none: nobody is teased for having been away.
  // {first} = their first name, {n} = days since they were last here.
  const HELLO = {
    first: ["Welcome, {first} 🤗 Glad you made it. I'm Solomon: a cloud with a lamp and good intentions."],
    back30: ["{first}! No speech. I'm just glad you're here."],
    back14: ["It's been a while, {first}. I kept your spot warm. As warm as a cloud can."],
    back7: ["A week! I practised a welcome speech, {first}. That was it."],
    back3: ["{n} days. I counted the gems twice. Same number. Good to have you back."],
    missed: ["Missed you yesterday, {first}. I kept the lamp lit. Mostly I just stood here.", "Missed you yesterday. The mine was quiet. I talked to a rock. It didn't answer."],
    early: ["Welcome 🤗 Glad you made it. Earlier than usual, let's get started.", "Up before the lamp, {first}. I'd raise an eyebrow, but: cloud. Let's get started."],
    late: ["Later than usual, {first}. I'm a cloud, I had nowhere to be. Let's get started."],
    daily: ["Welcome back, {first} 🤗 Glad you made it.", "There you are, {first}. I was floating here trying to look busy.", "Good to see you, {first}. The lamp's lit. Let's get started."]
  };
  function greetingFor(d) {
    const away = Number.isFinite(d.away) ? d.away : null, u = Number.isFinite(d.usual) ? d.usual : null, h = Number.isFinite(d.hour) ? d.hour : null;
    const k = d.firstEver ? "first" : away >= 30 ? "back30" : away >= 14 ? "back14" : away >= 7 ? "back7" : away >= 3 ? "back3" : away === 2 ? "missed"
      : u !== null && h !== null && h <= u - 2 ? "early" : u !== null && h !== null && h >= u + 3 ? "late" : "daily";
    const set = HELLO[k], first = A.guideFacts().first || "friend";
    return set[Math.floor(Date.now() / 864e5) % set.length].replace(/\{first\}/g, first).replace(/\{n\}/g, String(away));
  }

  // The lines for one screen, most useful first. Each is { t: what he says, act: what a tap on it does }.
  function lines(view) {
    const f = A.guideFacts(), n = A.nextUp(), out = [];
    const urgent = () => {
      if (n.kind === "docs") out.push({ t: "Your intake documents are due before your visit. Tap here and I'll open them.", act: to("plus") });
      if (n.kind === "invoice") out.push({ t: n.count > 1 ? `There is ${n.title.replace(" due", "")} to settle across ${n.count} invoices. Tap here to pay.` : `There is a ${n.title} to settle. Tap here to pay.`, act: to(n.go) });
    };
    const rank = () => { if (f.toNext && f.toNext.xp > 0) out.push({ t: `${f.toNext.xp} XP to ${f.toNext.name}. ${saying(1)}`, act: () => A.go("leaders") }); };
    const refer = () => { if (f.refer && f.refer.pct) out.push({ t: `Bring a friend: ${f.refer.pct}% of their subscription comes to you, in cash.`, act: to("refer") }); };
    if (view === "home") {
      urgent();
      if (n.kind === "intro") out.push({ t: INTRO[n.ref] || `${stopsWord()} stops, and your first new gem is yours.`, act: n.ref === "solomon" || !n.ref ? open : () => A.introGo(n.ref) });
      if (n.kind === "visit") out.push({ t: `${n.title}: ${n.sub}. Tap here to get ready.`, act: to("plus") });
      if (n.kind === "session") out.push({ t: `${n.title} today. ${saying()}`, act: to("mine") });
      if (n.kind === "later") out.push({ t: `${n.title} is booked: ${n.sub}.`, act: to("plus") });
      if (n.kind === "lights") { const d = n.today || {};
        out.push(!d.pain ? { t: "Good work. Tell me how you feel, and another light wakes.", act: () => A.go("pain") }
          : !d.acts ? { t: `${d.lit} of ${d.of} lit today. One daily activity lights the next.`, act: to("today") } : { t: "One more light to kindle: reach your daily goal.", act: to("today") }); }
      if (n.kind === "done") out.push(n.skipped ? { t: "Session skipped, and the other lamps are lit. It waits for your next training day." } : { t: hype("alllit") }, { t: "Rest now; the road will keep." });
      const AIM = { pain: "get out of pain", stronger: "get stronger", weight: "lose weight", move: "move better", sport: "get better at your sport" }, ab = f.about || {};
      if (n.kind === "ask") out.push({ t: ab.aim ? `You're here to ${AIM[ab.aim]}. Tell me how long you have today and I'll build toward it.` : `${f.first ? f.first + ", tell" : "Tell"} me what you want to train today and I'll build it.`, act: open });
      if (ab.competitive >= 8 && f.toNext && f.toNext.xp > 0) out.push({ t: `You said you hate to lose. ${f.toNext.xp} XP and ${f.toNext.name} is yours.`, act: () => A.go("leaders") });
      if (f.track && f.track.sessions) out.push({ t: `You've done ${f.track.sessions} session${s(f.track.sessions)} of your ${f.track.source.toLowerCase()} track. ${saying(2)}`, act: () => A.openTrack(f.track.id) });
      else if (f.track) out.push({ t: `Your ${f.track.source.toLowerCase()} track is on your road. Start it when you're ready.`, act: () => A.openTrack(f.track.id) });
      rank(); refer();
    } else if (view === "generate") {
      out.push({ t: "Tell me what you want to train and I'll build it for you.", act: open }, { t: "Short on time? Tell me how many minutes you have.", act: open });
    } else if (view === "videos") {
      out.push({ t: "Looking for a movement? Tell me its name and I'll find it.", act: open });
    } else if (view === "pain") {
      if (f.track) out.push({ t: `You started the ${f.track.source.toLowerCase()} track${f.track.sessions ? `: ${f.track.sessions} session${s(f.track.sessions)} so far` : ""}. Tap here to open it.`, act: () => A.openTrack(f.track.id) });
      out.push({ t: "Tap where it hurts. I'll show you what is likely behind it, then what to do about it." }, { t: "Not sure where it starts? Describe it to me in your own words.", act: open });
    } else if (view === "programs") {
      out.push({ t: "Pick a road. I'll walk it with you." }, { t: "Not sure which? Tell me your goal and I'll point to one.", act: open });
    } else if (view === "progress") {
      urgent();
      out.push({ t: f.week ? `${f.week} session${s(f.week)} in the last seven days. ${saying()}` : "Nothing logged this week yet. One session lights the calendar." },
        { t: "Pink marks billing, green marks your membership. Tap any day to see it." });
    } else if (view === "leaders") {
      out.push(f.gem && f.toNext ? { t: `You hold ${f.gem}. ${f.toNext.xp} XP to ${f.toNext.name}.` } : { t: "Every session, check-in and goal adds to your gem." });
    } else if (view === "profile") {
      urgent();
      out.push({ t: "This page is yours to arrange. Customize puts what matters first." }); refer();
    } else if (view === "messages") {
      out.push({ t: "Your messages with Dr. Jared live here." });
    } else if (view === "learn" || view === "tips") {
      out.push({ t: "Reading for between sessions. Ask me and I'll find the one you need.", act: open });
    } else if (view === "premium") {
      out.push({ t: "Each plan and what it opens. Ask me if you're unsure which fits.", act: open });
    }
    return out;
  }

  const said = new Map(); // line -> when he last said it
  let timer = 0, turns = 0, lastKind = "", hello = "", cheer = "", weekDue = false;
  const WEEK = "mdfit-recap-week"; // the Monday of the week he last offered the recap for (kept on the device)
  const busy = () => !!document.querySelector("#gt, dialog[open]") || document.hidden;
  function speakFor(view) {
    clearTimeout(timer);
    if (quiet() || view !== A.view()) return;
    if (busy() || G.speaking()) { timer = setTimeout(() => speakFor(view), 4000); return; } // wait for a sheet or a pointer to close
    // Praise that was earned comes before anything else
    if (cheer) { const c = cheer; cheer = ""; if (G.say(c, { ms: 7000 })) { timer = setTimeout(() => speakFor(view), 9500); return; } }
    // The day's welcome comes first, then what this screen has to say
    if (hello) { const h = hello; hello = ""; if (G.say(h, { ms: 8000 })) { timer = setTimeout(() => speakFor(view), 10500); return; } }
    // The first opening of a new week: last week's numbers are ready, once, for anyone who has a week to hear about
    if (weekDue && view === "home") { weekDue = false;
      try { const f = A.weekFacts(), mon = f.weeks[3].from, worth = f.any && (f.weeks[2].sessions || f.weeks[2].checkins || f.weeks[1].sessions);
        if (worth && localStorage.getItem(`${WEEK}-${f.me}`) !== mon && G.recap && G.say(`Your week is in${f.first ? ", " + f.first : ""}. Tap here and I’ll read it to you.`, { act: () => G.recap("last"), ms: 12000 })) { localStorage.setItem(`${WEEK}-${f.me}`, mon); timer = setTimeout(() => speakFor(view), 13500); return; }
      } catch {} }
    let list = []; try { list = lines(view); } catch { return; }
    const now = Date.now(), c = list.find((x) => !said.has(x.t) || now - said.get(x.t) > AGAIN);
    if (!c || !G.say(c.t, { act: c.act })) return;
    said.set(c.t, now);
    // Still on this screen in a while: one more thought, twice at most
    if (++turns <= 2) timer = setTimeout(() => speakFor(view), 45000);
  }
  const arrive = (view, wait) => { clearTimeout(timer); turns = 0; G.hush(); timer = setTimeout(() => speakFor(view), wait); };
  document.addEventListener("mdfit:view", (e) => arrive(e.detail, 700));
  // What is next has changed while they are on Home (a session finished, an invoice paid): he says the new thing
  document.addEventListener("mdfit:journey", () => { let k = ""; try { k = A.nextUp().kind; } catch {} if (lastKind && k !== lastKind && A.view() === "home") arrive("home", 1800); lastKind = k; });
  // A session was finished and saved: he says so when they are back on the road (the player closes onto it)
  document.addEventListener("mdfit:workout", () => { cheer = hype("workout"); });
  // The first opening of the day (account.js welcomeBack): he greets them above the cloud, and the chat opens with the same words
  document.addEventListener("mdfit:arrive", (e) => { try { hello = greetingFor(e.detail || {}); } catch { hello = ""; } if (G.greeting) G.greeting(hello); weekDue = true; arrive(A.view(), 4000); });
  // First words: once the app has its data and the welcome toast has had its moment
  arrive(A.view(), 4200);

  // Profile → Reminders from Solomon: speaks up, or quiet until tapped
  const paint = () => document.querySelectorAll("#p-speak-pick [data-speak]").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.speak === "off") === quiet())));
  document.addEventListener("click", (e) => {
    const b = e.target.closest("#p-speak-pick [data-speak]"); if (!b) return;
    try { if (b.dataset.speak === "off") localStorage.setItem(QUIET, "1"); else localStorage.removeItem(QUIET); } catch {}
    paint();
    if (quiet()) { clearTimeout(timer); G.hush(); } else G.say("I'll speak up when there's something worth saying.");
  });
  paint();
})();
