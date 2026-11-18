// MD Fit member app: what Solomon says without being asked, wherever the member is. There is one Solomon (the cloud,
// mdfit-guide.js); this file only chooses his line for the screen in front of them and hands it to MDFitGuide.say(),
// which shows it above the cloud. Tapping the line does what it offers; tapping the cloud opens the chat as always.
//
// Every line is put together here, on the device, from what is already on the member's own screens (the Next tile, the
// mine, the rank card). Nothing is sent anywhere to make one, and none of this is the member's own words.
// He speaks when a screen opens, at most twice more if they stay on it, and never repeats a line inside ten minutes.
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
  const INTRO = { solomon: "I'm Solomon. Tap me and ask anything: that's your first stop.", pain: "Next stop: tell me what hurts, or that nothing does.", program: "Pick a road. I'll walk it with you.",
    session: "One session. That's all today asks.", friend: "Bring a friend down here and you both gain." };
  const open = () => G.open(), to = (go) => () => A.goNext(go);

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
      if (n.kind === "intro") out.push({ t: INTRO[n.ref] || "Five stops, and your first new gem is yours.", act: n.ref === "solomon" || !n.ref ? open : () => A.introGo(n.ref) });
      if (n.kind === "visit") out.push({ t: `${n.title}: ${n.sub}. Tap here to get ready.`, act: to("plus") });
      if (n.kind === "session") out.push({ t: `${n.title} today. ${saying()}`, act: to("mine") });
      if (n.kind === "later") out.push({ t: `${n.title} is booked: ${n.sub}.`, act: to("plus") });
      if (n.kind === "done") { const d = n.today || {};
        out.push(d.pain && d.goal ? { t: "Every lamp is lit. Rest now; the road will keep." } : !d.pain ? { t: "Good work. Tell me how you feel, and another crystal wakes.", act: () => A.go("pain") } : { t: "One more light to kindle: reach your daily goal." }); }
      if (n.kind === "ask") out.push({ t: `${f.first ? f.first + ", tell" : "Tell"} me what you want to train today and I'll build it.`, act: open });
      rank(); refer();
    } else if (view === "generate") {
      out.push({ t: "Tell me what you want to train and I'll build it for you.", act: open }, { t: "Short on time? Tell me how many minutes you have.", act: open });
    } else if (view === "videos") {
      out.push({ t: "Looking for a movement? Tell me its name and I'll find it.", act: open });
    } else if (view === "pain") {
      out.push({ t: "Tap where it hurts. I'll show you what is likely behind it." }, { t: "Not sure where it starts? Describe it to me in your own words.", act: open });
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
  let timer = 0, turns = 0, lastKind = "";
  const busy = () => !!document.querySelector(".tour, dialog[open]") || document.hidden;
  function speakFor(view) {
    clearTimeout(timer);
    if (quiet() || view !== A.view()) return;
    if (busy() || G.speaking()) { timer = setTimeout(() => speakFor(view), 4000); return; } // wait for a sheet or a pointer to close
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
