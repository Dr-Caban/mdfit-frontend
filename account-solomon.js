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
//
// The daily Bible verse (owner, Nov 2026): his first greeting of the day carries one verse, quoted exactly from the
// World English Bible, British Edition (public domain; the edition that prints "the LORD" where the standard one prints
// "Yahweh": owner's choice), the same verse for everyone that day. It is off until the member says yes: Solomon
// asks once, after the tour (or on the next open for someone who had the tour before the question existed), and the
// switch is in the More menu ("Daily Bible verse"). The choice is kept on the device and on the account (prefs.verse).
// His own sayings below are still his own and quote nothing.
(() => {
  const A = window.MDFitApp, G = window.MDFitGuide; if (!A || !G || !G.say || !A.nextUp) return;
  const QUIET = "mdfit-solomon-quiet", AGAIN = 10 * 60 * 1000;
  const quiet = () => { try { return localStorage.getItem(QUIET) === "1"; } catch { return false; } };
  const s = (n) => (n === 1 ? "" : "s");
  // ---- The daily Bible verse. Text exactly as the World English Bible (British Edition) has it; [text, reference].
  const VERSES = [
    ["but those who wait for the LORD will renew their strength. They will mount up with wings like eagles. They will run, and not be weary. They will walk, and not faint.", "Isaiah 40:31"],
    ["I can do all things through Christ who strengthens me.", "Philippians 4:13"],
    ["Trust in the LORD with all your heart, and don’t lean on your own understanding. In all your ways acknowledge him, and he will make your paths straight.", "Proverbs 3:5-6"],
    ["God is our refuge and strength, a very present help in trouble.", "Psalm 46:1"],
    ["Don’t you be afraid, for I am with you. Don’t be dismayed, for I am your God. I will strengthen you. Yes, I will help you. Yes, I will uphold you with the right hand of my righteousness.", "Isaiah 41:10"],
    ["For God didn’t give us a spirit of fear, but of power, love, and self-control.", "2 Timothy 1:7"],
    ["The LORD is my strength and my shield. My heart has trusted in him, and I am helped. Therefore my heart greatly rejoices. With my song I will thank him.", "Psalm 28:7"],
    ["Let’s not be weary in doing good, for we will reap in due season if we don’t give up.", "Galatians 6:9"],
    ["A cheerful heart makes good medicine, but a crushed spirit dries up the bones.", "Proverbs 17:22"],
    ["This is the day that the LORD has made. We will rejoice and be glad in it!", "Psalm 118:24"],
    ["I will lift up my eyes to the hills. Where does my help come from? My help comes from the LORD, who made heaven and earth.", "Psalm 121:1-2"],
    ["Commit your deeds to the LORD, and your plans shall succeed.", "Proverbs 16:3"],
    ["He heals the broken in heart, and binds up their wounds.", "Psalm 147:3"],
    ["We know that all things work together for good for those who love God, for those who are called according to his purpose.", "Romans 8:28"],
    ["The LORD is near to those who have a broken heart, and saves those who have a crushed spirit.", "Psalm 34:18"],
    ["Blessed is a person who endures temptation, for when he has been approved, he will receive the crown of life which the Lord promised to those who love him.", "James 1:12"],
    ["My flesh and my heart fails, but God is the strength of my heart and my portion forever.", "Psalm 73:26"],
    ["He gives power to the weak. He increases the strength of him who has no might.", "Isaiah 40:29"],
    ["Beloved, I pray that you may prosper in all things and be healthy, even as your soul prospers.", "3 John 1:2"],
    ["Keep your heart with all diligence, for out of it is the wellspring of life.", "Proverbs 4:23"],
    ["Cast your burden on the LORD and he will sustain you. He will never allow the righteous to be moved.", "Psalm 55:22"],
    ["He has said to me, “My grace is sufficient for you, for my power is made perfect in weakness.” Most gladly therefore I will rather glory in my weaknesses, that the power of Christ may rest on me.", "2 Corinthians 12:9"],
    ["I have set the LORD always before me. Because he is at my right hand, I shall not be moved.", "Psalm 16:8"],
    ["Don’t you know that those who run in a race all run, but one receives the prize? Run like that, so that you may win.", "1 Corinthians 9:24"],
    ["The LORD is my light and my salvation. Whom shall I fear? The LORD is the strength of my life. Of whom shall I be afraid?", "Psalm 27:1"],
    ["Now may the God of hope fill you with all joy and peace in believing, that you may abound in hope in the power of the Holy Spirit.", "Romans 15:13"],
    ["LORD my God, I cried to you, and you have healed me.", "Psalm 30:2"]
  ];
  const VERSE_KEY = "mdfit_verse";
  let verseOn = (() => { try { return localStorage.getItem(VERSE_KEY) === "on"; } catch { return false; } })();
  const verseToday = () => VERSES[Math.floor(Date.now() / 864e5) % VERSES.length];
  const verseLine = () => { const v = verseToday(); return `“${v[0]}” ${v[1]}`; };
  // The day a verse was last shown on this device: a member who already had today's greeting before the verse existed
  // (or before they turned it on) still gets today's verse the next time the app opens, once.
  const VERSE_SEEN = "mdfit_verse_seen", dayNow = () => (A.today ? A.today() : new Date().toISOString().slice(0, 10));
  const verseSeen = () => { try { return localStorage.getItem(VERSE_SEEN) === dayNow(); } catch { return true; } };
  const verseShown = () => { try { localStorage.setItem(VERSE_SEEN, dayNow()); } catch {} };
  const VERSE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h11a2 2 0 0 1 2 2v16a1 1 0 0 1-1 1H7a3 3 0 0 1-3-3V4a2 2 0 0 1 2-2zm0 15a1 1 0 0 0 0 2h11v-2zM11 5v2H9v2h2v5h2V9h2V7h-2V5z"/></svg>';
  function verseRow() {
    const list = document.getElementById("more-list"); if (!list) return;
    let b = document.getElementById("more-verse");
    if (!b) { b = document.createElement("button"); b.type = "button"; b.id = "more-verse"; b.setAttribute("role", "switch"); (list.querySelector(".more-sep:last-of-type") || list.lastElementChild || list).before(b);
      b.addEventListener("click", () => setVerse(!verseOn)); }
    b.setAttribute("aria-checked", String(verseOn));
    b.innerHTML = `${VERSE_IC}<span>Daily Bible verse</span><em class="more-onoff">${verseOn ? "On" : "Off"}</em>`;
  }
  // A choice the account has not been told yet (offline, or the request failed) is kept and sent on the next open,
  // and the account's older answer never overwrites it meanwhile (the same rule as the looks in app-theme.js).
  // Solomon's question, once: "Would you like a Bible verse from me each day?" Asked in his chat with two buttons.
  const VERSE_ASKED = "mdfit_verse_asked";
  const wasAsked = () => { try { return localStorage.getItem(VERSE_ASKED) === "1"; } catch { return true; } };
  const askedNow = () => { try { localStorage.setItem(VERSE_ASKED, "1"); } catch {} };
  // Not within a quarter of an hour of a crisis or emergency answer (mdfit:urgent): it waits for another visit
  let urgentAt = 0;
  document.addEventListener("mdfit:urgent", () => { urgentAt = Date.now(); });
  function askVerse() {
    if (Date.now() - urgentAt < 15 * 60e3) return;
    if (wasAsked() || verseOn || !G.question || (window.MDFitTour && window.MDFitTour.running())) return;
    if (document.querySelector("dialog[open]")) return void setTimeout(askVerse, 8000); // not over something they are in the middle of
    askedNow();
    G.question("One more thing. Would you like a Bible verse from me each day? I'd greet you with one.", [
      { label: "Yes, a daily verse", more: () => setVerse(true) },
      { label: "No thanks", more: () => setVerse(false) }]);
  }
  document.addEventListener("mdfit:tour-end", () => setTimeout(askVerse, 4500)); // after his "That's the tour" line
  const VERSE_UNSENT = "mdfit_verse_unsent";
  let versePicks = 0;
  const verseUnsent = () => { try { return localStorage.getItem(VERSE_UNSENT) === "1"; } catch { return false; } };
  function sendVerse() {
    const want = verseOn; try { localStorage.setItem(VERSE_UNSENT, "1"); } catch {}
    try { window.MDFit.apiAuth("PUT", "/api/me/prefs", { verse: want ? "on" : "off" }).then(() => { if (want === verseOn) { try { localStorage.removeItem(VERSE_UNSENT); } catch {} } }).catch(() => {}); } catch {}
  }
  function setVerse(on, fromAccount) {
    if (!fromAccount) askedNow(); // using the switch is an answer
    verseOn = !!on; try { localStorage.setItem(VERSE_KEY, verseOn ? "on" : "off"); } catch {}
    verseRow();
    if (fromAccount) return;
    versePicks++; sendVerse();
    A.toast(verseOn ? "Daily Bible verse is on. Solomon greets you with one each day." : "Daily Bible verse is off. The switch is in More if you change your mind.");
    if (verseOn) { const ms = document.getElementById("more-sheet"); if (ms && ms.open) ms.close(); const t = `Today's verse: ${verseLine()}`; setTimeout(() => { if (G.say(t, { ms: Math.min(18000, 3500 + t.length * 55) })) verseShown(); }, 400); }
  }
  verseRow();
  // another device may have changed it: the account's choice wins when this device has none of its own to send
  if (verseUnsent()) sendVerse();
  else try { const asked = versePicks; window.MDFit.apiAuth("GET", "/api/me/guide").then((g) => { if (verseUnsent() || versePicks !== asked) return; /* a tap made while this was on its way is newer */ const v = g && g.prefs && g.prefs.verse; if ((v === "on" || v === "off") && (v === "on") !== verseOn) setVerse(v === "on", true);
    // Answered on another device: not asked again here. Never answered and no tour on its way: he asks now.
    if (g && g.verseAsked) askedNow(); else if (g && g.verseAsked === false) setTimeout(askVerse, 6000); }).catch(() => {}); } catch {}
  // ---- Talk: what he says back when he is spoken to (mdfit-guide.js ask and talk). These lines are kept here, on the
  // device, and chosen from the words below. With the assistant off they are his answer and nothing typed is sent
  // anywhere for them. With it on, the same message is read on MD Fit's server like any other question (the small
  // print under the box says so), and these lines are what he falls back on when the assistant is slow, fails, or a
  // free member has no answers left today. A verse is always quoted exactly from the list above.
  //
  // A line is given only for a message that is nothing but small talk: the words that say it, with at most a polite
  // word or a "can you give me" around them. "Can I get a quote for a massage", "how can I sleep well" and "what's up
  // with my invoice" are real questions and get nothing here, and "oh my god" on its own asks for no verse.
  // mdfit-guide.js asks for a line only once it has found nothing it must do itself (a reminder, the member's own
  // account, a place, a program, anything about pain or the body).
  let lastVerse = -1;
  const anotherVerse = () => { let i = Math.floor(Math.random() * VERSES.length); if (i === lastVerse) i = (i + 1) % VERSES.length; lastVerse = i; return `“${VERSES[i][0]}” ${VERSES[i][1]}`; };
  const firstName = () => (A.guideFacts().first || "friend");
  // One of a list, in a shuffled order: none comes again until every one has been said (per list, while the page is
  // open), and the first of a new round is never the last of the one before
  const bags = {};
  const oneOf = (list, key) => {
    let b = bags[key];
    if (!b || !b.length || b.n !== list.length) {
      b = list.map((_, i) => i);
      for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
      if (b.length > 1 && b[0] === oneOf[key]) b.push(b.shift());
      b.n = list.length; bags[key] = b;
    }
    const i = b.shift(); oneOf[key] = i; return list[i];
  };
  const verseReply = (lead) => ({ say: [lead, anotherVerse()].filter(Boolean), feel: "peace",
    opts: [{ label: "Another verse", more: () => verseReply("") }, ...(verseOn ? [] : [{ label: "Send me one every day", more: () => { setVerse(true); return { say: "Done. I'll greet you with one each day." }; } }]), { road: true }] });
  const JOKES = ["Why did the dumbbell go to therapy? It had too much weight on its shoulders.", "I tried a rest day once. As a cloud, I mostly drifted.", "What's a skeleton's least favourite workout? Anything with a spotter. Nobody has his back.",
    "Why don't hamstrings ever win arguments? They always get tight under pressure.", "I asked the foam roller for advice. It said: just roll with it."];
  // His kind words, and beside them the same four for the Simple view (plain(), below): no road, lamp or stone
  const LIFT = ["You showed up to say so, which already counts. Start with the smallest thing on your road and stop there if you need to.", "Tired is allowed. Five easy minutes is still a lamp lit.",
    "You don't have to feel like it. You only have to begin; the feeling usually catches up.", "Hard days are when the small things matter most. One stone is enough for today."];
  const LIFT_PLAIN = ["You showed up to say so, which already counts. Start with the smallest thing in your plan and stop there if you need to.", "Tired is allowed. Five easy minutes still counts.",
    LIFT[2], "Hard days are when the small things matter most. One small thing is enough for today."];
  const lift = () => oneOf(plain() ? LIFT_PLAIN : LIFT, "l");
  // Asked for a saying: one of his own (SAYINGS, below). The Simple view has no sayings, so there it is a kind word.
  const wise = () => (plain() ? lift() : oneOf(SAYINGS, "s"));
  // Words that ask for nothing wherever they sit ("please", his name, "for me", "today"), and the small sounds people
  // start with ("oh", "ok", "hey"). They are taken out before a message is tested.
  const POLITE = /\b(for (me|now|today|tonight)|right now|please|pls|solomon|sunny|today(?!')|tonight|again|now)\b/g;
  const OPENER = /^((hey|hi|hello|yo|oh|ok|okay|well|so|and|um|hmm|wow|haha|lol|yes|yeah|yay) )+/;
  // The ways of asking him for one of his lines: "can you give me a", "I need another", "got any", "tell me some"
  const WANT = "(?:(?:can|could|will|would) you |(?:can|could|may) i |i'?d (?:like|love) |i would (?:like|love) |i (?:want|need|could use|could do with) |do you (?:have|know) |(?:have you )?got |let'?s (?:hear|have) |how about )?"
    + "(?:(?:to )?(?:give|tell|show|read|send|share|say|hear|have|get|find)(?: me| us)? )?(?:(?:a|an|another|one more|some|any|more|the|your|a few) )?";
  // only: the whole message is this and nothing else. wants: the same, with one of those ways of asking in front.
  const only = (b, core) => new RegExp(`^(?:${core})$`).test(b);
  const wants = (b, core) => new RegExp(`^${WANT}(?:${core})$`).test(b);
  const VERY = "(?:(?:so|really|very|just|too|a bit|a little|kind of|kinda|pretty|quite|super|still) )*";
  const LOW = "tired|exhausted|lazy|unmotivated|busy|stressed(?: out)?|overwhelmed|down|worn out|wiped(?: out)?|drained|fed up|not feeling it|not in the mood";
  const talk = (text, lost) => {
    const t = text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
    const day = new Date().getHours(), when = day < 5 ? "night" : day < 12 ? "morning" : day < 18 ? "afternoon" : "evening", P = plain();
    if (lost) return { say: `${P ? "That one is beyond me" : "That one is past my lamp's reach"}, ${firstName()}. I'm best with your training, your pain and finding things in MD Fit. I can also give you a verse, a word of encouragement or a laugh.`,
      opts: [{ road: true }, { label: "Give me a verse", more: () => verseReply("") }, { label: "Encourage me", more: () => ({ say: lift(), opts: [{ road: true }] }) }, { place: "generate" }] };
    if (!t) return null;
    if (t === "__verse") return verseReply(""); // asked for by the assistant's answer (mdfit-guide.js aiAnswer)
    // b = the message without punctuation, polite words or an opening "oh". Each test below has to match all of it.
    const b = t.replace(/[^a-z0-9' ]+/g, " ").replace(POLITE, " ").replace(/\s+/g, " ").trim().replace(OPENER, "");
    // A verse, a prayer, a blessing. (God's name on its own is an exclamation as often as a request, so it asks for nothing.)
    if (wants(b, "(?:(?:bible|daily|short|good|favou?rite|encouraging|comforting|new|different) )*(?:bible|verses?|scriptures?|psalms?|proverbs?|gospel|prayers?|blessings?|devotion(?:al)?s?|word (?:of|from) (?:god|the lord|the bible)|something from (?:the bible|scripture))(?: (?:of|for) the day)?(?: from the bible)?")
      || only(b, "(?:what'?s |what is )?(?:today'?s|the daily|my daily|my|the) (?:bible )?verse|(?:(?:can|could|will|would) you )?pray(?: with me)?|bless me|god bless(?: you| me| us)?|(?:tell|talk to|teach) me (?:more )?about (?:god|jesus|christ|the lord|faith|the bible|scripture)"))
      return verseReply(/\bpray|bless/.test(b) ? `Gladly, ${firstName()}. Here is one to carry with you:` : oneOf(["Here is one for you:", "Gladly:", `For you, ${firstName()}:`], "v"));
    // One of his sayings. ("Can I get a quote" is as likely to be about a price, so it is left alone.)
    if (!/\bget\b/.test(b) && (wants(b, "(?:(?:good|wise|daily|short|inspiring|inspirational|motivational|favou?rite) )*(?:quotes?|sayings?|wisdom|wise words?|words? of wisdom|inspiration|something (?:wise|inspiring))(?: (?:of|for) the day)?") || only(b, "inspire me")))
      return { say: [wise()], feel: "proud", opts: [{ label: P ? "Another one" : "Another saying", more: () => ({ say: wise() }) }, { label: "A Bible verse", more: () => verseReply("") }, { road: true }] };
    if (wants(b, "(?:(?:good|funny|quick|short|bad|dad|new|different) )*(?:jokes?|laugh|something (?:funny|to laugh at))") || only(b, "(?:(?:can|could|will|would) you )?(?:make me (?:laugh|smile)|be funny)|i need to laugh|joke time"))
      return { say: oneOf(JOKES, "j"), feel: "cheer", opts: [{ label: "Another one", more: () => ({ say: oneOf(JOKES, "j") }) }, { road: true }] };
    if (wants(b, "(?:(?:little|bit of|quick) )?(?:motivation|encouragement|pep talk|kind word|word of encouragement|boost|push|pick me up)")
      || only(b, `(?:(?:can|could|will|would) you )?(?:motivate|encourage) me|cheer me up|(?:i'?m|i am|i feel|i'?m feeling|i am feeling|feeling) ${VERY}(?:${LOW})|${VERY}(?:tired|exhausted|unmotivated|stressed(?: out)?|overwhelmed)`
        + "|i (?:don'?t|do not) feel like (?:it|doing (?:it|this|anything|much)|working out|exercising|moving|going)|(?:i )?(?:can'?t|cannot) be bothered|(?:i have |i'?ve got |i got |got )?(?:no|zero) (?:energy|motivation)"
        + "|(?:i'?ve had |i have had |i had |i'?m having |having |what |(?:it ?)?(?:was |is |has been |'?s been ))?(?:a |such a |quite a |a really |a very |a pretty )?(?:rough|hard|bad|long|tough|terrible|awful|horrible|stressful) (?:day|week|morning|night|one)(?: at work)?"
        + `|i give up|i (?:want to|wanna) (?:quit|give up)|i feel like (?:quitting|giving up)|(?:i'?m |i am )?${VERY}struggling(?: to (?:get going|get started|keep going|stay motivated))?`))
      return { say: lift(), feel: "happy", opts: [{ road: true }, { label: "A verse for today", more: () => verseReply("") }, { place: "messages" }] };
    if (only(b, "(?:(?:i|we)(?: just| finally)? |just |finally )?(?:did it|finished(?: it)?|crushed it|nailed it|smashed it|killed it)|all done|(?:(?:i )?(?:just )?(?:got|hit|set) )?(?:a )?new (?:pr|pb|personal (?:best|record))|(?:i )?(?:just )?(?:hit|reached|made|met) my goal|(?:i'?m |i am )?(?:so |really )?proud of (?:me|myself)"))
      return { say: oneOf([`That is how it is done, ${firstName()}!`, "Well earned. I saw that.", `Proud of you, ${firstName()}. Truly.`], "w"), feel: "excited", opts: [{ place: "progress" }, { road: true }] };
    if (only(b, "(?:thank you|thanks|thank u|thx|ty|cheers|many thanks)(?: (?:so much|very much|a lot|a ton|a bunch|a million))?(?: for (?:that|this|it|everything|the help|your help|all your help|all the help|helping(?: me)?))?(?: (?:that helps|that helped|that'?s all|that is all|i appreciate (?:it|you|that)))?|(?:i )?(?:really )?appreciate (?:it|you|that|this)|much appreciated"))
      return { say: oneOf(["Always. That's what I'm here for.", `Any time, ${firstName()}.`, "Glad to. Come find me whenever you like."], "th"), feel: "proud", opts: [{ road: true }] };
    if (only(b, "(?:i )?(?:really )?(?:love|like|adore) (?:you|u|ya)(?: so much| a lot)?|(?:you'?re|you are|ur|u r) (?:so |really |very |too |just )?(?:the best|great|awesome|amazing|cute|funny|sweet|kind|wonderful|helpful)|(?:good|great|nice) (?:job|work|bot|cloud)"))
      return { say: oneOf([`You'll make a cloud blush, ${firstName()}.`, P ? "That made my day. Thank you." : "That lights my lamp. Thank you.", P ? "Kind of you. I like our chats too." : "Kind of you. I like our walks down the road too."], "lv"), feel: "proud" };
    if (only(b, "good ?night|night night|nighty(?: night)?|sleep well|sweet dreams|(?:(?:i'?m|i am) )?(?:going|off|heading) to (?:bed|sleep)|off to bed|time for bed"))
      return { say: oneOf([`Sleep well, ${firstName()}. Rest is part of the work.`, P ? "Good night. It will all keep until morning." : "Good night. The road will keep until morning."], "gn"), feel: "sleepy" };
    if (only(b, "how are (?:you|u|ya)(?: doing| feeling)?|how'?re you(?: doing)?|how (?:you|u) doing|how do you feel|how'?s it going|how is it going|how are things|how'?s your (?:day|morning|evening|night)(?: going)?|what'?s up|wass?up|sup|(?:are )?you (?:ok|okay|good|alright|all right)"))
      return { say: oneOf([`Better now that you're here, ${firstName()}. How about you: what are we doing today?`, `Floating along nicely. Good ${when} to you. What do you need?`, P ? "In good spirits. What can I do for you?" : "Lamp lit, spirits high. What can I do for you?"], "h"), feel: "happy",
        opts: [{ road: true }, { label: "Encourage me", more: () => ({ say: lift(), opts: [{ road: true }] }) }, { label: "Give me a verse", more: () => verseReply("") }] };
    if (only(b, "(?:who|what) are you(?: exactly| really)?|what'?s your name|what is your name|are you (?:real|human|alive|a (?:real )?(?:person|human|robot|bot)|an? ai)|what can you do|what do you do|how do you work|what can i ask(?: you)?|help(?: me)?"))
      return { say: [P ? "I'm Solomon, MD Fit's guide. I'm not a person, and I don't give medical advice." : "I'm Solomon: a cloud with a lamp, and MD Fit's guide. I'm not a person, and I don't give medical advice.",
        `I can show you where anything is, tell you what is next ${P ? "for you today" : "on your road"}, find the rehab for what hurts, build a workout, set a reminder, and hand you a verse, a kind word or a joke when you want one.`], feel: "happy",
        opts: [{ road: true }, { place: "pain" }, { place: "generate" }, { label: "Give me a verse", more: () => verseReply("") }] };
    if (/^(give me|show me|tell me|i want|i need|can you|could you|please)\.?$/.test(t)) return { say: `Give you what, ${firstName()}? Here is what I have ready:`, opts: [{ road: true }, { label: "A Bible verse", more: () => verseReply("") }, { label: "A word of encouragement", more: () => ({ say: lift(), opts: [{ road: true }] }) }, { label: "A joke", more: () => ({ say: oneOf(JOKES, "j") }) }, { place: "generate" }] };
    return null;
  };
  try { if (G.talk) G.talk(talk); } catch {}

  // Solomon's own sayings (written for the app, in the manner of old proverbs; none is a quotation)
  const SAYINGS = ["The patient miner finds the brighter stone.", "Small steps, well kept, move mountains.", "What you build daily, no one can take.",
    "Strength is gathered, not found.", "A steady hand outlasts a strong one.", "The lamp you tend lights the whole road.", "Dig a little each day and the mountain yields."];
  // Simple view (Profile > Make it yours > Home screen): he keeps his voice but drops the mine: no sayings, lamps,
  // stones, gems or XP in what he says. The plain lines sit beside each mine line below.
  const plain = () => document.documentElement.dataset.homeView === "simple";
  const saying = (k = 0) => (plain() ? "" : SAYINGS[(Math.floor(Date.now() / 864e5) + k) % SAYINGS.length]);
  const INTRO_PLAIN = { solomon: "I'm Solomon, your guide. Tap me and ask anything.", know: "Next: let me get to know you. A few taps.", pain: "Next: tell me what hurts, or that nothing does.", program: "Pick a program. I'll guide you through it.",
    session: "One session. That's all today asks.", friend: "Invite a friend and you both gain." };
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
    if (kind === "alllit" && plain()) return "Everything done today. A full day's work.";
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
  const HELLO_PLAIN = { first: ["Welcome, {first} 🤗 Glad you made it. I'm Solomon, your guide."], back3: ["{n} days. Good to have you back, {first}."],
    missed: ["Missed you yesterday, {first}. Good to see you."], early: [HELLO.early[0]], daily: [HELLO.daily[0], HELLO.daily[1]] };
  function greetingFor(d) {
    const away = Number.isFinite(d.away) ? d.away : null, u = Number.isFinite(d.usual) ? d.usual : null, h = Number.isFinite(d.hour) ? d.hour : null;
    const k = d.firstEver ? "first" : away >= 30 ? "back30" : away >= 14 ? "back14" : away >= 7 ? "back7" : away >= 3 ? "back3" : away === 2 ? "missed"
      : u !== null && h !== null && h <= u - 2 ? "early" : u !== null && h !== null && h >= u + 3 ? "late" : "daily";
    const set = (plain() && HELLO_PLAIN[k]) || HELLO[k], first = A.guideFacts().first || "friend";
    const hi = set[Math.floor(Date.now() / 864e5) % set.length].replace(/\{first\}/g, first).replace(/\{n\}/g, String(away));
    // With the daily verse on, the greeting is short and the verse follows it (the first-ever welcome stays whole)
    if (!verseOn) return hi;
    return `${d.firstEver ? hi : `Welcome back, ${first} 🤗`} ${verseLine()}`;
  }

  // The lines for one screen, most useful first. Each is { t: what he says, act: what a tap on it does }.
  function lines(view) {
    const f = A.guideFacts(), n = A.nextUp(), out = [];
    const urgent = () => {
      if (n.kind === "docs") out.push({ t: "Your intake documents are due before your visit. Tap here and I'll open them.", act: to("plus") });
      if (n.kind === "invoice") out.push({ t: n.count > 1 ? `There is ${n.title.replace(" due", "")} to settle across ${n.count} invoices. Tap here to pay.` : `There is a ${n.title} to settle. Tap here to pay.`, act: to(n.go) });
    };
    const P = plain();
    const rank = () => { if (P) return; if (f.toNext && f.toNext.xp > 0) out.push({ t: `${f.toNext.xp} XP to ${f.toNext.name}. ${saying(1)}`, act: () => A.go("leaders") }); };
    const refer = () => { if (f.refer && f.refer.pct) out.push({ t: `Bring a friend: ${f.refer.pct}% of their subscription comes to you, in cash.`, act: to("refer") }); };
    if (view === "home") {
      urgent();
      if (n.kind === "intro") out.push({ t: P ? INTRO_PLAIN[n.ref] || "A few quick steps to get you started." : INTRO[n.ref] || `${stopsWord()} stops, and your first new gem is yours.`, act: n.ref === "solomon" || !n.ref ? open : () => A.introGo(n.ref) });
      if (n.kind === "visit") out.push({ t: `${n.title}: ${n.sub}. Tap here to get ready.`, act: to("plus") });
      if (n.kind === "session") out.push({ t: P ? `${n.title} today. Tap Start when you're ready.` : `${n.title} today. ${saying()}`, act: to("mine") });
      if (n.kind === "later") out.push({ t: `${n.title} is booked: ${n.sub}.`, act: to("plus") });
      if (n.kind === "lights") { const d = n.today || {};
        out.push(!d.pain ? { t: P ? "Good work. A quick pain check-in is next." : "Good work. Tell me how you feel, and another light wakes.", act: () => A.go("pain") }
          : !d.acts ? { t: P ? `${d.lit} of ${d.of} done today. A daily activity is next.` : `${d.lit} of ${d.of} lit today. One daily activity lights the next.`, act: to("today") } : { t: P ? "One left today: reach your daily goal." : "One more light to kindle: reach your daily goal.", act: to("today") }); }
      if (n.kind === "done") out.push(n.skipped ? { t: P ? "Session skipped, and everything else is done. It waits for your next training day." : "Session skipped, and the other lamps are lit. It waits for your next training day." } : { t: hype("alllit") }, { t: P ? "Rest up. See you tomorrow." : "Rest now; the road will keep." });
      const AIM = { pain: "get out of pain", stronger: "get stronger", weight: "lose weight", move: "move better", sport: "get better at your sport" }, ab = f.about || {};
      if (n.kind === "ask") out.push({ t: ab.aim ? `You're here to ${AIM[ab.aim]}. Tell me how long you have today and I'll build toward it.` : `${f.first ? f.first + ", tell" : "Tell"} me what you want to train today and I'll build it.`, act: open });
      if (!P && ab.competitive >= 8 && f.toNext && f.toNext.xp > 0) out.push({ t: `You said you hate to lose. ${f.toNext.xp} XP and ${f.toNext.name} is yours.`, act: () => A.go("leaders") });
      if (f.track && f.track.sessions) out.push({ t: `You've done ${f.track.sessions} session${s(f.track.sessions)} of your ${f.track.source.toLowerCase()} track. ${saying(2)}`.trim(), act: () => A.openTrack(f.track.id) });
      else if (f.track) out.push({ t: `Your ${f.track.source.toLowerCase()} track is ${P ? "in your plan" : "on your road"}. Start it when you're ready.`, act: () => A.openTrack(f.track.id) });
      rank(); refer();
    } else if (view === "generate") {
      out.push({ t: "Tell me what you want to train and I'll build it for you.", act: open }, { t: "Short on time? Tell me how many minutes you have.", act: open });
    } else if (view === "videos") {
      out.push({ t: "Looking for a movement? Tell me its name and I'll find it.", act: open });
    } else if (view === "pain") {
      if (f.track) out.push({ t: `You started the ${f.track.source.toLowerCase()} track${f.track.sessions ? `: ${f.track.sessions} session${s(f.track.sessions)} so far` : ""}. Tap here to open it.`, act: () => A.openTrack(f.track.id) });
      out.push({ t: "Tap where it hurts. I'll show you what is likely behind it, then what to do about it." }, { t: "Not sure where it starts? Describe it to me in your own words.", act: open });
    } else if (view === "programs") {
      out.push({ t: P ? "Pick a program. I'll guide you through it." : "Pick a road. I'll walk it with you." }, { t: "Not sure which? Tell me your goal and I'll point to one.", act: open });
    } else if (view === "progress") {
      urgent();
      out.push({ t: f.week ? `${f.week} session${s(f.week)} in the last seven days. ${saying()}`.trim() : P ? "Nothing logged this week yet. One session gets it started." : "Nothing logged this week yet. One session lights the calendar." },
        { t: "Pink marks billing, green marks your membership. Tap any day to see it." });
    } else if (view === "leaders") {
      out.push(P ? { t: "Every session, check-in and daily goal counts here." } : f.gem && f.toNext ? { t: `You hold ${f.gem}. ${f.toNext.xp} XP to ${f.toNext.name}.` } : { t: "Every session, check-in and goal adds to your gem." });
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
    if (hello) { const h = hello; hello = ""; const ms = Math.min(18000, Math.max(8000, 3500 + h.length * 55)); // a verse takes longer to read than a hello
      if (G.say(h, { ms })) { if (h.includes("“")) verseShown(); timer = setTimeout(() => speakFor(view), ms + 2500); return; } }
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
  // No verse yet today (the day's greeting already went by without one): he gives it now, ahead of his other lines
  if (verseOn && !verseSeen() && !hello) hello = `Today's verse: ${verseLine()}`;
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
