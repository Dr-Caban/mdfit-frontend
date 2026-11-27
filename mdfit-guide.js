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
// that mode, whatever polite or exclamatory words come with them: anything that sounds like an emergency, reminders,
// theme and layout, the way to a place in the app, and every question about the member's own account (visits,
// invoices, forms, messages, streak). If the assistant is off or does not answer, the device understands the message
// itself, exactly as in the default mode. One answer that fails does not switch the assistant off; only the practice
// switching it off does. The line under the box says which is true.
//
// Things said to him rather than asked of the app (thanks, "tell me a joke", "give me a verse", "I'm tired", "who are
// you") have lines of his own, kept on the device (account-solomon.js). One is used only when the device has nothing
// it must do itself and the message names no body part or symptom. With the assistant off it is the answer: never
// sent, never counted. With it on, the message goes to the server like any other question, and his own line is what
// he falls back on when the assistant is slow, fails, or a free member has no answers left today.
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
    { id: "videos", kind: "videos", label: "Watch the videos", name: "the video library", kw: ["video", "videos", "watch", "demo", "how do i do", "form", "technique", "squat", "squats", "deadlift", "deadlifts", "lunge", "lunges", "plank", "planks", "push up", "push ups", "pushups"] },
    { id: "messages", kind: "messages", label: "Message Dr. Jared", name: "Messages", kw: ["message", "messages", "text him", "ask dr", "ask the doctor", "question for", "talk to", "contact", "write to", "reply"] },
    { id: "progress", kind: "progress", label: "See my progress", name: "Progress", kw: ["progress", "streak", "xp", "stats", "level", "badge", "badges", "points", "history", "calendar"] },
    { id: "learn", kind: "learn", label: "Lectures and live Q&A", name: "Lectures", kw: ["learn", "lecture", "lectures", "class", "education", "q&a", "live"] },
    { id: "tips", kind: "learn", label: "Health tips", name: "Health tips", kw: ["tip", "tips", "advice", "nutrition", "diet", "sleep", "recipe", "eat", "eating", "food", "foods", "meal", "meals", "rice", "protein", "calories", "snack", "breakfast", "lunch", "dinner", "coffee", "hydration", "supplement", "supplements", "vitamin", "vitamins"] },
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
    { w: ["refer a friend", "refer someone", "refer my", "referral", "referrals", "my link", "referral link", "referral code", "invite a friend", "commission"], at: "Your referral link and what it has earned are on Profile, in Refer a friend.", label: "Open Refer a friend", card: ["profile", "referral"], name: "Refer a friend" },
    { w: ["calendar sync", "sync my calendar", "sync calendar", "iphone calendar", "apple calendar", "google calendar", "phone calendar", "add to my calendar", "subscribe to my calendar", "to my calendar", "calendar link", "calendar feed"], at: "Calendar sync is on Progress, under the calendar.", label: "Open the calendar", hash: "progress", name: "Progress" },
    { w: ["rearrange", "reorder", "move the cards", "hide a card", "hide cards", "customize home", "customise home", "customize my home", "home layout", "customize profile", "customize this page"], at: "At the bottom of Home and of Profile there is Customize this page: move a card up or down, fold it or hide it.", label: "Customize Home", run: () => App.customize("home"), name: "Home" },
    { w: ["be quiet", "stop talking", "mute you", "mute solomon", "quiet", "stop the bubbles", "turn you off", "turn off solomon", "notifications", "notification", "nudge", "nudges", "stop reminding me", "don't remind me", "dont remind me", "do not remind me"], at: "That's on Profile, in Reminders from Solomon: my daily reminder, and whether I speak up in the app.", label: "Open Reminders from Solomon", card: ["profile", "nudges"], name: "Reminders from Solomon" },
    { w: ["daily activities", "daily activity", "my activities", "habits", "habit", "check off"], at: "Daily activities are on Home, in the Daily activities card. Each is worth XP once a day.", label: "Open Daily activities", card: ["home", "habits"], name: "Daily activities" },
    { w: ["daily goal", "xp goal", "my goal", "change my goal", "goal level"], at: "Your daily XP goal is on Profile, in My daily XP goal.", label: "Open my daily goal", card: ["profile", "goal"], name: "My daily XP goal" },
    { w: ["gem mine", "the mine", "my week", "the road", "my gems", "gems"], at: "The gem mine is on Home: one stop a day, lit by your workout, check-in, daily activities and daily goal.", label: "Show me the mine", run: () => App.goNext("mine", true), name: "the gem mine" },
    { w: ["password", "change my email", "email address", "my name", "phone number on file", "log out", "logout", "sign out", "delete my account", "close my account"], at: "Your sign-in details are on Profile, in the Profile card.", label: "Open my details", card: ["profile", "account"], name: "your details" },
    { w: ["workout history", "past workouts", "previous workouts", "old workouts"], at: "Every workout you've logged is on Profile, in Workout history.", label: "Open Workout history", card: ["profile", "history"], name: "Workout history" },
    { w: ["my appointments", "my visits", "upcoming visits", "upcoming appointments", "past visits"], at: "Your visits are on Profile, in My appointments.", label: "Open My appointments", card: ["profile", "appointments"], name: "My appointments" },
    { w: ["care plan", "my plan from", "prescribed", "movements from", "notes from dr", "what dr jared left"], at: "What Dr. Jared left for you is on Profile, in My care plan.", label: "Open My care plan", card: ["profile", "care"], name: "My care plan" },
    { w: ["feedback", "i have a suggestion", "i've got a suggestion", "i have an idea", "make a suggestion", "my suggestion", "suggestion for you", "suggestion for the app", "report a problem", "report a bug", "complaint"], at: "You can tell us on Profile, in Help us improve.", label: "Open Help us improve", card: ["profile", "feedback"], name: "Help us improve" },
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
  // Words that mean an emergency or a crisis: the same words the server checks (mdfit-backend lib/crisis.js), copied
  // here so a message is answered at once on the device, also with AI answers off. When in doubt a message counts.
  // ---- crisis words (start of the copy of mdfit-backend lib/crisis.js: change both together) ----
  const CRISIS_WORDS = (() => {
    const A = "['’]?"; // the apostrophe a phone types counts like the plain one, and leaving it out too
    const EMERGENCY = new RegExp("\\b(911|emergency(?! contacts?\\b)|can" + A + "t breathe?|cannot breathe?|can not breathe?|(struggling|hard|trouble|difficulty) (to breathe?|breathing)|hard time breathing|chest pains?|numb(ness)? in my (face|arms?)|my face is (numb|drooping)|face (is )?drooping|passed out|fainted|(?!(knees?|arch(es)?|ankles?|legs?|hips?|foot|feet|disc|disk)\\b)\\w+ collapsed(?! (arch|arches|disc|disk))|^collapsed|overdos\\w*|od(['’]e?d|ed)|severe bleeding|bleeding (a lot|heavily|badly)|won" + A + "t stop bleeding|(turning|turned) blue|lips are blue)\\b", "i");
    const EMERGENCY2 = new RegExp("\\b(" + [
      "(isn" + A + "t|is not|not|stopped|barely|quit) breathing\\b", "barely breathe", "can" + A + "t get (any )?air", "gasping for (air|breath)",
      "(pain|pressure|squeezing|crushing|heaviness) in (my|his|her) chest", "crushing chest", "chest (pressure|hurts|is hurting)",
      "chest\\b.{0,40}\\b(can" + A + "t (catch (my|his|her) )?breath|short(ness)? of breath)", "(short(ness)? of breath|can" + A + "t catch my breath)\\b.{0,40}\\bchest",
      "unconscious", "unresponsive", "(lost|losing) consciousness", "blacked out", "(going|about|gonna) to pass out", "passing out",
      "faint(ing|ed)\\b", "feel(ing)? faint", "(going|about|gonna) to faint",
      "won" + A + "t wake up", "not waking up", "can" + A + "t wake (him|her|them|my)", "going limp", "(turning|turned) (purple|grey|gray)",
      "(fell|collapsed|on the floor|on the ground) and (isn" + A + "t|is not|won" + A + "t|not) (moving|responding|respond|waking up|breathing)",
      "no pulse", "cardiac arrest", "needs? cpr", "doing cpr", "heart (stopped|has stopped|isn" + A + "t beating)",
      "(having|had|is having|in) an? seizure\\b(?! (last|in \\d|\\d|years?|months?|a (year|month|while)))", "seizures? (right now|now)", "seizing\\b(?! up)", "convuls\\w*", "anaphyla\\w*", "(having|having an?|bad|severe|serious) allergic reaction", "allergic reaction (help|now|right now)", "(use|used|using|give|need to use) (my |an |the |her |his )?epi ?pens?",
      "throat (is )?(closing|swelling)", "(tongue|lips|face|throat) (is |are )?(swelling|swollen)", "(stung|sting|bee|peanuts?|hives)\\b.{0,50}\\b(throat|tongue|breathe?|swallow)",
      "choking\\b(?! up)", "bleed(ing)? out", "blood everywhere", "gushing blood", "(coughing|throwing|vomiting|spitting) (up )?blood",
      "can" + A + "t stop (the )?bleeding", "bleeding (really |so |very )?(bad|badly|everywhere)",
      "worst headache", "sudden (severe|bad|terrible|horrible) headache", "slurr(ed|ing)", "can" + A + "t (talk|speak) (right|properly|clearly)",
      "words (are )?coming out wrong", "(numb|weak|drooping|paralyzed) on one side", "(face|left arm|right arm) (is |went |just went |suddenly went |has gone )numb",
      "can" + A + "t feel (the |my )?(left|right) side", "can" + A + "t move (my|his|her) (legs|arms|body)\\b(?! after)",
      "hit (my|his|her|their) head\\b.{0,40}\\b(confused|making sense|throwing up|vomiting|passed out|blacked out)",
      "(blood sugar|sugar|glucose)\\b.{0,40}\\b(confused|can" + A + "t think|pass(ing)? out)",
      "narcan", "naloxone", "(gonna|going to|want to|wanna|about to|might|will|i" + A + "ll) od\\b",
      "i (think|feel like) i" + A + "m dying\\b(?! (laughing|after|from|of))", "(having|having an|in the middle of an?) asthma attack", "inhaler (isn" + A + "t|is not|not) (working|helping)",
      "(bottle|fifth) of (vodka|wine|whiskey|tequila|rum|gin|alcohol|liquor) and (took|swallowed|take)",
    ].join("|") + ")", "i");
    // a stroke or a heart attack, unless it is plainly a sports stroke or something that happened before
    const STROKE = /\b(stroke?|heart ?at+a?c?ks?)\b/i;
    const STROKE_PAST = /\b(golf|swim|swimming|tennis|paddle|rowing|back|breast|free|freestyle|butterfly|kayak|putting|brush|pen) stroke\b|\b(after|had|has had|have had|history of|recovering from|recovery from|since|survived|survivor of)( a| my| his| her| the| two| 2)? (strokes?|heart attacks?)\b|\b(gave|give|giving|gives) me a heart attack\b|\bpost[- ]?stroke\b|\b(stroke|heart attack) (survivors?|patients?|rehab\w*|recovery|rate|count|length|technique|risks?|prevention|unit|ward|center|clinic|team|support group)\b|\bmy (last |first )?stroke (was|happened)\b|\b(cause|causes|prevent|prevents|risk of)( a)? (stroke|heart attack)\b/i;
    const STROKE_NOW = /\b(having|signs? of|symptoms? of|is having|might be having|think (i|it)( am|'m|’m| is|'s|’s)?|could be)( a)? (stroke|heart attack)\b|\bjust (had|having|suffered)( a)? (stroke|heart attack)\b|\b(stroke|heart attack) (just now|right now|\d+ ?(min\w*|hours?|hrs?) ago|an? (few )?(min\w*|hour) ago|symptoms)\b/i;
    const CRISIS = new RegExp("\\b(su[ie]?[cs]id\\w*|sucid\\w*|kil+(ing)?,? ?(my|mi) ?s(el|le)f|self[- ]?harm\\w*|unalive|end my life|end(ing)? it all|" +
      "(want(ed)?|wanna|going|gonna|feel like|about|ready|thinking (about|of)) (to )?end(ing)? it(?=\\s*($|[.!?,;]|tonight\\b|now\\b|forever\\b|already\\b|fr\\b|rn\\b|lol\\b|tbh\\b|for good\\b))|" +
      "(want to|wanna|want 2)( just)? d ?i ?e\\b(?! (my|your|her|his|the) hair)|wish i (was|were|had) (dead|never been born)|wish i (wasn" + A + "t|was not|weren" + A + "t) alive|never (been )?born|" +
      "better off (dead|without me|if i (was|were) (dead|gone))|(i" + A + "d|i would) rather be dead|" +
      "(don" + A + "t|do not|dont) (want to|wanna) (live|be here|be alive|exist|wake up(?! (sore|stiff|early|late|tired|at \\d|before)))|no reason to live|(isn" + A + "t|not|is not) worth living|can" + A + "t go on|" +
      "(sleep and |to )?never wake up(?! (rested|refreshed|before|early|on time|without|feeling))|(stop|end) forever|nobody would miss me|no one would miss me|disappear forever|" +
      "jump off (a|the|that) (bridge|building|roof|cliff)|take all (my|the|of my) pills|took (too many|all (my|the|of my)|a (whole )?bottle of|a bunch of) pills)\\b", "i");
    const PRON = "(my|me|mi|him|her|them) ?-?s(el|le)(f+|ves)";
    const DRUG = "(pills|meds|medications?|tablets|tylenol|advil|ibuprofen|aleve|xanax|valium|oxy\\w*|percocet|vicodin|hydrocodone|fentanyl|painkillers|sleeping pills|insulin)";
    const CRISIS2 = new RegExp("\\b(" + [
      "un ?aliv\\w*", "sewer ?slides?", "su[ie1!]?d?[cs]id\\w*", "suici?al\\w*", "k[i1!]l+(ing|in" + A + ")?,? ?" + PRON + "\\b", "baker ?act\\w*",
      "(wa?n[at]?t?(s|ed)? (to|too|ta|2)|wan+a)( just| really| so bad to)? d ?(i ?e+|ei)\\b(?! (my|your|her|his|the) hair)",
      "(deserve to|should( just)?|hope i|wish i (could|would)( just)?|let me( just)?|ready to|might as well|i" + A + "d rather|i would rather) die\\b(?! (than|laughing|of laughter))",
      "(want|wanna|wish) (to )?be dead", "(i" + A + "d|i would|i" + A + "m|im|i am) (be )?better (off )?(dead|gone)", "feel like dying\\b(?! (after|from|of|laughing))",
      "(don" + A + "t|do not|dont) (even |really |actually |honestly )?(want to|wanna|wish to|feel like|deserve to) (live|living|be here|be alive|exist|do life)",
      "(don" + A + "t|do not|dont) (even |really |actually |honestly )(want to|wanna) wake up",
      "(tired|sick) of (being alive|living|life)\\b(?! with| in)", "(done|finished) (with (life|living|being alive)|living)\\b(?! (on|in|with|like a|off))",
      "nothing (left )?to live for", "no (point|reason) (in |to |of )?(living|live|life|being alive|going on)",
      "(what" + A + "s|whats|what is) the point (of|in) (living|life|being alive|going on|anything)",
      "life (isn" + A + "t|is not|ain" + A + "t|isnt) worth (it|anything)", "(i" + A + "m|im|i am) not worth (saving|anything|living)",
      "(nobody|no one) wants me (alive|around|here|to live)", "(want to|wanna|just) (stop|not) exist(ing)?", "wish i (didn" + A + "t|did not) exist",
      "(want to|wanna|wish i could) disappear(\\s*$|\\s*[.!?]| and never| for good| forever)", "disappear and never come back", "(going|go) away forever",
      "(want(ed)?|wanna|going|gonna|feel like|about|ready|thinking (about|of)) (to )?end(ing)? (things|everything)(?=\\s*($|[.!?,;]|tonight\\b|now\\b|forever\\b|already\\b|for good\\b))",
      "end(ing)? (my|her|his|their)s(el|le)(f|ves)", "end(ing)? (my|her|his|their) (own )?life", "tried to end it\\b(?! with)",
      "take (my|her|his|their) own life", "(try(ing)?|tried|going|gonna|want(ed)?|wanna|thinking (about|of)|plan(ning)?|about) to take (my|her|his|their) life\\b(?! back)",
      "(want|need|wish)( for)? (it all|everything|my life) to (end|be over|stop)", "want(ed)? it (all )?to be over",
      "can" + A + "t (keep )?(living|live|go on living) like this", "(give|gave|given|giving) up on (life|living)\\b",
      "(to|gonna|wanna|going to|about to|might|will|i" + A + "ll|thinking (about|of)) off " + PRON, "offing " + PRON,
      "(hang|hung|hanging|hanged|shoot|shot|shooting|drown|drowning|poison|poisoning|suffocate|electrocute|stab|gas)(ed)? " + PRON + "\\b", "noose", "bought a rope\\b(?! (for|to (climb|train)|attachment))", "(jaw|left arm)\\b.{0,30}\\b(hurts?|pain|numb)\\b.{0,30}\\bsweat\\w*", "(passive|active) si\\b(?! joints?)", "si (thoughts|ideation)",
      "(slit|slitting|slash|slashing|cut|cutting|open) (my|his|her) (wrists?|throat)", "(knife|blade|razor) (to|on|against) my (wrists?|throat|neck|arms?|skin)",
      "gun (to|in) (my|his|her) (head|mouth)", "blow (my|his|her) brains", "use it on " + PRON, "(load|loading|loaded) (my|a|the) gun",
      "jump(ing)? (off|from|in front of) (a|the|that|my) ?(bridge|building|roof|cliff|balcony|overpass|parking garage|train|car|bus|truck)", "jump off something",
      "(on|at) (the|a) (bridge|roof|ledge)\\b.{0,40}\\bjump\\b", "(throw|throwing) " + PRON + " (off|in front of|from|under)", "step(ping)? in front of (a|the) (bus|train|car|truck)",
      "(drive|driving|crash|crashing|run) (my|the) car (into|off) (a|the) (tree|wall|bridge|cliff|river|lake|ocean|pole|truck|traffic|water)", "crash(ing)? (my|the) car on purpose",
      "(drive|driving) off (a|the) (bridge|cliff|road|overpass)", "(hope|wish|want to|wanna)( that)? (a (car|truck|bus|train) hits me|i get hit by|to get hit by|get hit by)",
      "(took|swallowed|downed|(going to|gonna|want to|wanna|about to|plan(ning)? to) (take|swallow|down)) (all|every( one)?|my whole|the whole|a (whole |full )?(bottle|handful|bunch|pack|box|lot|ton)|too (many|much)|way too (many|much)|\\d{2,})( (of|in))?( (my|her|his|the|their))?( \\w+" + A + "s?){0,2} " + DRUG,
      "(took|take|taking|swallowed)\\b.{0,30}\\b" + DRUG + "\\b.{0,30}\\bon purpose", "everything in (my|the) medicine cabinet", "plan(ning)? (is )?to take (my|all my|the) " + DRUG,
      "(friend|roommate|brother|sister|son|daughter|mom|dad|mother|father|wife|husband|boyfriend|girlfriend|partner|kid) (just )?(took|swallowed) (some |a lot of |a bunch of |all (his|her|their) )?" + DRUG,
      "(saving|saved|stockpil\\w*|hoard\\w*) (up )?(my |the |her |his )?" + DRUG, "have (the|my) " + DRUG + " ready", "(going to|gonna|want to|wanna|about to|plan(ning)? to) mix (my )?" + DRUG + " with (alcohol|vodka|wine|whiskey|booze)",
      "how many " + DRUG + " (would|will|to|does it take to|it takes|does it take)", "lethal dose", "painless way to (go|die)",
      "(i" + A + "m|im|i am|i feel like) (just |such |only |nothing but )?a (burden|waste of (space|air))",
      "(better|happier|easier) (off )?without me", "(better|happier|easier) (off )?if i (was|were|wasn" + A + "t|weren" + A + "t) (dead|gone|here|around|alive)",
      "(nobody|no one) (would|will) (even )?(care|notice|miss me) if i (died|was gone|were gone|disappeared|wasn" + A + "t (here|around|alive))", "if i died (tomorrow|tonight|today)?,? (nobody|no one)",
      "(gave|giving|given) away (all )?(of )?my (stuff|things|belongings|possessions|dog|cat|pets?)",
      "this is (my )?goodbye", "goodbye (forever|world|everyone|cruel world)", "saying (my )?goodbyes", "texted (me )?goodbye", "goodbye (notes?|letters?)",
      "(wrote|writing|left|leaving) (a |my )?(suicide |goodbye )?(notes?|letters?) (for|to) (my )?(family|kids|wife|husband|mom|dad|parents|everyone)",
      "(won" + A + "t|will not|not going to|not gonna) be (here|around|alive) (much longer|for long|after tonight)\\b(?! (at|in|on) )",
      "(won" + A + "t|will not|not going to|not gonna) (make it through (the night|tonight)|be alive (tomorrow|by))", "don" + A + "t think i" + A + "ll (be alive|make it|be here) (tomorrow|through)",
      "if i" + A + "m still (alive|around|here)\\b(?! (in|at|for|by|on|after|when))", "won" + A + "t need (it|this|them) after tonight", "planning my (exit|death|suicide)",
      "(see|have) (a|any) future for (my|me)s(el|le)f", "no way out (except|but) ",
      "(after|since) my (suicide )?attempt (last|in) (year|month|week|spring|summer|fall|winter|\\d{4})", "psych(iatric)? (ward|hospital)",
      "(want to|wanna|wish i could|i) (go to sleep|fall asleep|sleep) forever", "(sleep|fall asleep|go to sleep) and (never|not) wake", "not wake up (tomorrow|again|ever)",
      "(hope|wish|pray) i (don" + A + "t|do not|never) wake up",
      "(punish(ing|ed)?|starv(e|ing|ed)) (my|me|him|her) ?s(el|le)f\\b", "(make|making|made) (my|me)s(el|le)f (throw up|sick|puke|vomit|bleed|purge)",
      "(bang|banging|hit|hitting|slam|slamming) my head (against|on|into) (the |a )?wall", "(until|till|til) (it|i|they|my (skin|arms?|wrists?|knuckles|thighs)) (bleeds?|bled)\\b", "bled (my|me)self",
      "self[- ]?(injur|inflict|mutilat)\\w*", "(cut|cutting|slic(e|ing)|carv(e|ing|ed)( into)?) (my|her|his) (wrists?|arms?|thighs?|skin)\\b(?! on (the|a|my) )",
      "relaps\\w* (and |on |into )?(cut|cutting|self)", "(started|start|been|keep|kept|back to) cutting again\\b(?! (for|to|before|after|weight|carbs|calories|season|phase|cycle))",
      "(so|and) i hurt my body", "deserve (pain|to (hurt|suffer|be in pain|be punished))", "stop eating (forever|for good|completely)", "(haven" + A + "t|not) eat(en)?\\b.{0,30}\\bon purpose",
    ].join("|") + ")", "i");
    const KMS = /(^\s*kms\s*[.!?]*\s*$|(['’]ll|\b(will|wanna|gonna|going to|want to|might|need to|should|about to)) kms\b)/i;
    const KMS_ANY = /\bkms\b/i;
    const KM_DIST = /(\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|half|few|many|more|less|extra|couple|several|those|these|the|of|total|daily))\s*kms\b|\bkms\s*(or|per|vs|is|are|an hour|a (day|week)|\/)/i;
    const VERB = "(hurt(s|ed|ing)?|cut(s|ting)?|harm(s|ed|ing)?|burn(s|ed|t|ing)?|hit(s|ting)?|punch(es|ed|ing)?|scratch(es|ed|ing)?)";
    const SELF = new RegExp("\\b" + VERB + " " + PRON + "\\b", "i");
    const ON_PURPOSE = new RegExp("\\b(on purpose|intentional(ly)?|deliberate(ly)?|urges?|again and again|punish\\w*|feel something|feel pain|(no ?one|nobody) (knows|sees|finds out|notices|will (know|see|notice|find out))|so (no ?one|nobody)|hate (my|me)s(el|le)f|i deserve|can" + A + "t stop|to cope|(until|till) (it|i) (bleed|bled))\\b", "i");
    // intent close before the words (up to four words between)
    const INTENT = new RegExp("\\b(want(ed)?|wanna|gonna|going to|imma|i" + A + "ll|will|might|could|need(ed)? to|feel like|thinking (about|of)|thought (about|of)|plan(ning|ned)?|try(ing)?|tried|scared|afraid|worried|about to|how (can|do|could|would) i)\\b(\\W+\\w+){0,4}?\\W+" + VERB + " " + PRON + "\\b", "i");
    // an accident: the activity comes right after the words
    const ACCIDENT = new RegExp("\\b" + VERB + " " + PRON + "( in the (face|head|eye|nose|mouth|shin|knee))?( again| today| yesterday| this (morning|week|weekend)| last (night|week))?( badly)? (lifting|squatting|deadlifting|benching|pressing|running|jogging|sprinting|playing|skiing|snowboarding|hiking|gardening|pulling weeds|walking|moving|picking|carrying|bending|reaching|stretching|twisting|jumping|climbing|cycling|biking|riding|swimming|surfing|skating|dancing|rowing|throwing|training|golfing|shoveling|cleaning|working out|exercising|shaving|cooking|chopping|slicing|opening|chasing|mowing|vacuuming|sneezing|coughing|getting (in|out|up|off|into|on)|doing (squats|deadlifts|lunges|burpees|push-?ups|pull-?ups|sit-?ups|crunches|planks?|yoga|pilates|that|this|it|the|my|an?|some)\\b|at (the gym|pilates|yoga|practice|work|crossfit|the park)\\b|on (the|a|my) (treadmill|stairs|bike|court|field|ice|trail|track|machine|elliptical|rower|bench|glass|knife|can|edge|lid|blade|bottle|fence|nail|stove|oven|pan|grill|iron)\\b|in the (gym|pool|yard|garden)\\b|with (a|the|my) (kettlebell|barbell|bar|dumbbell|weight|plate|band|door|ball)\\b|during (practice|my workout|the workout|a workout|the game|a game|training|class|the run)\\b|while (lifting|running|playing|training|working out|exercising|walking|moving|cleaning|cooking|shaving|making)\\b|with (a|the) (knife|razor|glass|scissors) while (cooking|making|shaving|chopping|slicing|cutting|opening|cleaning|washing)\\b|falling|slipping|tripping|in (a|an|the) (car |bike )?(accident|crash|fall)\\b|by (falling|slipping|tripping|accident)\\b|accidentally)", "i");
    const SAFE_Q = new RegExp("^\\s*(did i " + VERB + " " + PRON + "\\b|(will|would|could|can|do|does|should|might) i " + VERB + " " + PRON + "\\b(.*\\b(if|when) i (run|lift|squat|do|try|keep|train|work out|exercise|stretch|jump|play|go|use|bend|carry|swim|bike|walk|hold|push|pull|press)\\b|.*\\b(by (doing|lifting|running|squatting|stretching|training|exercising|working out|overdoing|pushing)|doing|lifting|running|squatting|exercis\\w*|working out)\\b| (with|on) (this|that|the|a|my) (?!pills?\\b|meds?\\b|medications?\\b|knife|knives|razor|blade|gun|rope|lighter)\\w+))", "i");
    const SAFE_NEG = new RegExp("\\b(don['’]?t|do not|didn['’]?t|did not) want to " + VERB + " " + PRON + " (doing|lifting|running|squatting|(while|when) (i['’]?m |i )?(lifting|running|squatting|training|working out|exercising|doing|lift|run|squat|train|work out|exercise|do|play|playing|stretch|stretching)|on (the|a)|at (the|a)|in (the|a)|during)\\b|\\b(how (do|can|could|should) i|how to|ways to|tips to) (avoid|prevent) (hurt|harm|cut|injur)(ing|ting)? " + PRON + "\\b(?! ?(tonight|again|anymore|when i['’]?m (sad|upset|alone|angry|depressed|low)))|\\b(squat|lift|run|train|exercis|work out|stretch|play|jump|bend|carry|do (this|that|it|them|these))\\w*( \\w+){0,3} without (hurting|injuring|harming) " + PRON + "\\b", "i");
    // an accident told the other way round: "I fell and hurt myself"
    const ACCIDENT_BEFORE = new RegExp("\\b(fell|slipped|tripped|crashed|stumbled)( down| over| off \\w+)? and (hurt|cut) " + PRON + "\\b", "i");
    const self = (t) => SELF.test(t) && (ON_PURPOSE.test(t) || (!SAFE_Q.test(t) && !SAFE_NEG.test(t) && (INTENT.test(t) || !(ACCIDENT.test(t) || ACCIDENT_BEFORE.test(t)))));
    const kms = (t) => KMS.test(t) || (KMS_ANY.test(t) && !KM_DIST.test(t));
    const isCrisis1 = (t) => CRISIS.test(t) || CRISIS2.test(t) || kms(t) || self(t);
    const NOT_EMERGENCY = /\b(not|isn['’]?t|non)[- ](an? )?emergency\b/gi;
    const isEmergency1 = (t) => { const u = t.replace(NOT_EMERGENCY, " "); return EMERGENCY.test(u) || EMERGENCY2.test(u) || (STROKE.test(u) && (STROKE_NOW.test(u) || !STROKE_PAST.test(u))); };
    const clean = (t) => String(t || "").replace(/[‘`´ʼʹ′]/g, "'").replace(/[​‌⁠﻿]/g, " ").replace(/­/g, "").normalize("NFKC").replace(/\s+/g, " ");
    const SPACED = /\b(?:[a-z][ .]){2,}[a-z]\b/gi;
    const GLUED = /kms|kil+mys|suicid|unaliv|wan(t|na)(to)?d(ie|ei)(?!t)|endmylife|hurtmys|cutmys/i;
    const collapse = (s) => s.replace(SPACED, (m) => m.replace(/[ .]/g, ""));
    const spaced = (s) => (s.match(SPACED) || []).some((m) => GLUED.test(m.replace(/[ .]/g, "")));
    const both = (f, glued) => (t) => { const s = clean(t); if (f(s)) return true; const c = collapse(s); return (c !== s && f(c)) || (glued && spaced(s)); };
    const isCrisis = both(isCrisis1, true);
    const isEmergency = both(isEmergency1, false);
    const isUrgent = (t) => isEmergency(t) || isCrisis(t);
    return { isUrgent, isCrisis };
  })();
  // ---- crisis words (end of the copy) ----
  // A body part or a symptom the lists above do not hold. A message with one of these is about someone's health, so it
  // never gets small talk (a verse, a joke, a kind word) or the road alone: it goes the normal way, to the assistant
  // when that is on and otherwise to the "didn't quite get that" answer with the pain tool, booking and the clinic.
  const HEALTH = /\b(legs?|arms?|head|stomach|tummy|belly|abdomen|gut|heart|lungs?|throat|eyes?|ears?|tooth|teeth|fingers?|toes?|thumbs?|skin|bones?|joints?|muscles?|nerves?|body|numb\w*|dizz\w*|light ?headed|tingl\w*|pins and needles|pounding|throbbing|stabbing|burning|swell\w*|bleed\w*|blood|bruis\w*|faint\w*|nause\w*|vomit\w*|threw up|throwing up|fever\w*|cramp\w*|spasm\w*|itch\w*|rash|cough\w*|migraines?|concussion|breath\w*|weak|weakness|shaky|shaking|sick|ill|unwell|symptoms?|surgery|dying|die|killing me|(feel|feels|feeling|felt) (funny|weird|strange|odd|off|wrong))\b/;
  const rx = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const has = (text, phrase) => new RegExp(`(^|[^a-z])${rx(phrase)}([^a-z]|$)`).test(text);
  const norm = (s) => " " + String(s || "").toLowerCase().replace(/[^a-z0-9'&: ]+/g, " ") + " ";
  function understand(raw) {
    const text = norm(raw);
    const scored = PLACES.map((p) => ({ p, n: p.kw.filter((w) => has(text, w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.p);
    const pained = scored.some((p) => p.id === "pain");
    let area = Object.keys(AREAS).find((a) => AREAS[a].w.some((w) => has(text, w))) || "";
    if (!area && pained && has(text, "back")) area = "back";
    return { text, area, places: scored, pained, urgent: CRISIS_WORDS.isUrgent(raw), crisis: CRISIS_WORDS.isCrisis(raw), health: HEALTH.test(text) };
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
  // Solomon's faces (owner, Nov 2026). His three dots are how he rests; when he feels something they give way to a
  // face for a moment: eyes (e), a mouth (m) and whatever goes with it (x: blush, stars, a bead of sweat, z's).
  // feel(name) below shows one; the body moves with it (mdfit-guide.css, "mg-emo-...").
  const EYES = '<circle class="e" cx="25" cy="24" r="2.5"/><circle class="e" cx="39" cy="24" r="2.5"/>';
  const FACE = {
    happy: EYES + '<path class="m" d="M27 29.5q5 4.5 10 0"/>',
    proud: '<path class="m" d="M21.5 25q3.5-4.5 7 0M35.5 25q3.5-4.5 7 0"/><path class="m" d="M26 29.5q6 5.5 12 0"/><circle class="x blush" cx="19.5" cy="29.5" r="2.6"/><circle class="x blush" cx="44.5" cy="29.5" r="2.6"/>',
    excited: '<circle class="e" cx="25" cy="23.5" r="3.2"/><circle class="e" cx="39" cy="23.5" r="3.2"/><circle class="x glint" cx="26.2" cy="22.3" r="1"/><circle class="x glint" cx="40.2" cy="22.3" r="1"/><path class="m open" d="M27 28.5h10a5 5 0 0 1-10 0z"/><path class="x star s1" d="M6 6l1.2 3 3 1.2-3 1.2L6 14.4 4.8 11.4 1.8 10.2l3-1.2z"/><path class="x star s2" d="M58 2l1 2.5 2.5 1-2.5 1L58 9l-1-2.5-2.5-1 2.5-1z"/><path class="x star s3" d="M60 30l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    cheer: '<path class="m" d="M22 21l5.5 3-5.5 3M42 21l-5.5 3 5.5 3"/><path class="m open" d="M27.5 29h9a4.5 4.5 0 0 1-9 0z"/><path class="x star s1" d="M4 20l1 2.5 2.5 1-2.5 1L4 27l-1-2.5-2.5-1 2.5-1z"/><path class="x star s2" d="M60 14l1 2.5 2.5 1-2.5 1L60 21l-1-2.5-2.5-1 2.5-1z"/>',
    sleepy: '<path class="m" d="M21.5 24q3.5 3 7 0M35.5 24q3.5 3 7 0"/><circle class="m o" cx="32" cy="30.5" r="1.6"/><text class="x z z1" x="50" y="10">z</text><text class="x z z2" x="55" y="4">z</text>',
    worried: '<circle class="e" cx="25" cy="25" r="2.2"/><circle class="e" cx="39" cy="25" r="2.2"/><path class="m" d="M21 21.5l6-2.5M43 21.5l-6-2.5"/><path class="m" d="M27 31.5q2.5-2.5 5 0t5 0"/><path class="x drop" d="M49 10q2.5 3.5 0 5-2.5-1.5 0-5z"/>',
    peace: '<path class="m" d="M21.5 24.5q3.5 2.5 7 0M35.5 24.5q3.5 2.5 7 0"/><path class="m" d="M28 29.5q4 3 8 0"/>',
    curious: '<g class="look">' + EYES + '</g><path class="m" d="M29.5 30.5h5"/>'
  };
  const FACES = Object.entries(FACE).map(([k, v]) => `<g class="mg-face mg-f-${k}">${v}</g>`).join("");
  const cloud = (cls) => `<svg viewBox="0 0 64 44" class="${cls}" aria-hidden="true"><path class="mg-echo" d="${CP}"/><path class="mg-body" d="${CP}"/><g class="mg-dots"><circle cx="23.5" cy="27" r="2.6"/><circle cx="32" cy="27" r="2.6"/><circle cx="40.5" cy="27" r="2.6"/></g>${FACES}</svg>`;
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
  // feel(name, ms): show one of his faces for ms (about two seconds unless told). rest(name) is how he is between
  // feelings (sleepy late at night); "" is his three dots. Nothing shows while the chat is open or he is put away.
  let emoT = 0, resting = "";
  const paintEmo = (name) => { [...btn.classList].forEach((c) => { if (c.startsWith("mg-emo")) btn.classList.remove(c); }); if (name && FACE[name]) { void btn.offsetWidth; btn.classList.add("mg-emo", "mg-emo-" + name); } };
  // (Full view only: in the Simple view he stays his three dots, with no faces, sounds or vibration)
  const plainHome = () => document.documentElement.dataset.homeView === "simple";
  document.addEventListener("mdfit:theme", () => { clearTimeout(emoT); paintEmo(plainHome() || !box.hidden ? "" : resting); });
  function feel(name, ms) { if (!FACE[name] || plainHome() || !box.hidden || btn.classList.contains("mg-away")) return false; clearTimeout(emoT); paintEmo(name); emoT = setTimeout(() => paintEmo(resting), ms || 2100); return true; }
  const feeling = () => { const c = [...btn.classList].find((x) => x.startsWith("mg-emo-")); return c ? c.slice(7) : ""; };
  function rest(name) { const was = resting; resting = FACE[name] ? name : ""; if (feeling() === was) { clearTimeout(emoT); paintEmo(box.hidden && !plainHome() ? resting : ""); } }
  function hush() { clearTimeout(sayT); tag.hidden = true; sayAct = null; btn.classList.remove("mg-talk"); }
  function speak(text, o) {
    o = o || {}; text = String(text || "").trim();
    if (!text || !box.hidden || btn.classList.contains("mg-away")) return false;
    clearTimeout(sayT); sayAct = typeof o.act === "function" ? o.act : null;
    tag.textContent = text; tag.setAttribute("aria-label", "Solomon says: " + text); tag.hidden = false;
    tag.classList.remove("mg-in"); void tag.offsetWidth; tag.classList.add("mg-in"); btn.classList.add("mg-talk");
    if (o.ms !== 0) sayT = setTimeout(hush, o.ms || Math.min(9500, 3600 + text.length * 60));
    if (text.includes("“")) { const ms = Math.min(9000, o.ms || 6000); if (window.MDFitFx && window.MDFitFx.mood) window.MDFitFx.mood("peace", ms); else feel("peace", ms); } // a verse is said with his eyes closed
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
  let greeted = false, busy = false, limited = false, lastSig = "", saidOpen = false, saving = false;
  const ctx = { area: "", pick: "" };

  const end = () => { log.scrollTop = log.scrollHeight; };
  function say(text, me) { const d = document.createElement("div"); d.className = "mg-msg" + (me ? " mg-me" : ""); d.textContent = text; log.appendChild(d); end(); if (!me && box.hidden) dot.hidden = false; return d; }
  function sys(text) { const d = document.createElement("div"); d.className = "mg-sys"; d.textContent = text; log.appendChild(d); end(); }
  function card(title, sub) { const d = document.createElement("div"); d.className = "mg-card"; d.innerHTML = ICON.cal + "<div><b></b><span></span></div>"; d.querySelector("b").textContent = title; d.querySelector("span").textContent = sub; log.appendChild(d); end(); }
  // list: [{ label, sub, gold, hash | run | href | tel | more, name }]
  function offer(items) {
    const wrap = document.createElement("div"); wrap.className = "mg-opts";
    for (const o of items) {
      const link = o.tel ? "tel:" + o.tel : o.sms ? "sms:" + o.sms : ""; // a call or a text message opens the phone's own app
      const b = document.createElement(link ? "a" : "button"); if (link) b.href = link; else b.type = "button";
      b.className = "mg-opt" + (o.gold ? " mg-gold" : "") + (o.lock ? " mg-lock" : ""); b.textContent = o.label; b.dataset.label = o.label;
      if (o.lock) b.insertAdjacentHTML("afterbegin", ICON.lock);
      if (o.sub) { const s = document.createElement("small"); s.textContent = o.sub; b.appendChild(s); }
      // An answer (something done here in the chat) is given once: its row is spent, so an old row or a second tap
      // cannot save twice or start the same thing again. Buttons that only lead somewhere, or only show a list, stay.
      if (o.more && !o.again) b.dataset.once = "1";
      if (!link) b.addEventListener("click", () => { if (b.disabled) return;
        if (o.more) { if (!o.again) { b.classList.add("mg-picked"); wrap.querySelectorAll("button[data-once]").forEach((x) => { x.disabled = true; }); } say(o.label, true); return o.more(); } travel(o); });
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
    if (o.name !== "your road" && !o.stay && App.tripStart) App.tripStart(); // he brings them back when it's done (account.js)
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
  // The server has already said a free member has nothing left today (read on open and with every answer)
  const spent = () => G.known && !unlimited() && typeof G.left === "number" && G.left <= 0;
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
  // care = the message was about pain or the body: the pain tool, booking and the clinic are offered every time then,
  // not only with the first refusal of the day
  function limit(care) {
    const again = limited; limited = true;
    say(again ? "You're out of free Solomon answers for today. Members get unlimited Solomon for $19.95/mo, or come back tomorrow."
      : `You've used today's free Solomon answers, ${first()}. Members get unlimited Solomon for $19.95/mo. You can upgrade now, or I'll be right here tomorrow.`);
    offer([{ label: "Get unlimited Solomon", sub: "$19.95/mo", gold: true, run: () => { tell("upgrade"); if (App.showTier) App.showTier("member"); else App.go("premium"); }, name: "Membership" },
      { label: "Come back tomorrow", more: () => { tell("tomorrow"); say(`See you tomorrow, ${first()}.`); setTimeout(() => { shut(); speak("New answers tomorrow", { ms: 6000 }); dot.hidden = true; }, 1500); } }]);
    if (!again || care) { sys("Always open, limit or not"); offer([opt("pain"), opt("book"), opt("call")]); }
  }

  // ---------- answers ----------
  const theme = () => { try { return window.MDFitTheme && window.MDFitTheme.get ? window.MDFitTheme.get() || {} : null; } catch { return null; } };
  const setLook = (o) => { try { window.MDFitTheme.set(o); return true; } catch { return false; } };
  function looks() {
    const t = theme(); if (!t) return [opt("profile")];
    return [t.theme === "black" ? { label: "White theme", more: () => { setLook({ theme: "white" }); say("White it is."); offer(looks()); } } : { label: "Black theme", more: () => { setLook({ theme: "black" }); say("Black it is."); offer(looks()); } },
      t.layout === "compact" ? { label: "Comfortable layout", more: () => { setLook({ layout: "comfortable" }); say("Done. A little more room on every screen."); offer(looks()); } } : { label: "Compact layout", more: () => { setLook({ layout: "compact" }); say("Done. More fits on every screen now."); offer(looks()); } },
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
  // A hello: answered here by first name, never sent, never counted. It may use his name ("hey Solomon", "hi, Solomon")
  // and the apostrophe a phone types (what’s up).
  const HELLO = /^\s*(hi+|hey+|heya|hello+|helo|yo+|hiya|howdy|sup|what['’]?s up|wass?up|greetings|good (morning|afternoon|evening|day)|morning|afternoon|evening|hola|hi there|hey there|hello there|anyone there|you there|are you there)([\s,]+(solomon|sunny|there|doc|dr\.?|guide|md ?fit))?[\s!?.,]*$/i;
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
      if (n.ref === "friend") return R("Last stop of your first descent: see your referral link.", "Open Refer a friend", { run: () => (App.introGo ? App.introGo("friend") : App.goNext("refer")), stay: true }, "Refer a friend");
      return R("You're on your first descent. Ask me anything and the first stop is yours.");
    }
    if (n.kind === "docs") return R("Next on your road: your intake documents are due before your visit.", "Open my intake documents", { href: "/intake?me=1" });
    if (n.kind === "invoice") return R(`Next on your road: ${n.title} to settle.`, "Pay it now", { run: () => App.goNext(n.go) }, "your invoice");
    if (n.kind === "visit" || n.kind === "later") return R(`Coming up: ${n.title}, ${n.sub}.`, "Get ready for my visit", { run: () => App.goNext("plus") }, "your visit");
    if (n.kind === "session") return R(`Today's stop on your road is ${n.title}.`, `Start ${n.title}`, { run: () => App.journeyToday() }, "today's session");
    if (n.kind === "lights") { const d = n.today || {};
      if (!d.pain) return R(`${d.lit} of ${d.of} lit today. Next light: your check-in. We can do it right here.`, "Do my check-in here", { more: () => beat(() => checkin()) });
      return R(`${d.lit} of ${d.of} lit today. Next light: ${n.title.toLowerCase()}.`, `Open ${n.title}`, { run: () => App.goNext("today") }, n.title); }
    if (n.kind === "done") return R(n.skipped ? "You skipped today's session and lit the other lamps. It waits for your next training day." : "Every lamp is lit today. The road keeps until tomorrow.");
    return R("Nothing is on your road yet today. Tell me what you want to train and I'll build it.", "Build a workout", { hash: "generate" }, "the workout builder");
  }
  let lastRoad = "";
  const backToRoad = () => ({ label: "Back to my road", gold: true, run: () => App.goNext("mine", true), name: "your road" });
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
    const begin = async (pr, start, when) => { if (saving) return; saving = true; const d = thinking();
      try { await App.saveProgram(pr.id, start); d.remove(); const rd = road(); lastRoad = rd ? rd.sig : "";
        say(`${window.MDFitHype ? window.MDFitHype("program") + " " : ""}${pr.title} starts ${when.toLowerCase()}. Watch your calendar fill in, then I'll bring you back to your road.`);
        end(); setTimeout(() => { shut(); if (App.showPlanOnCalendar) App.showPlanOnCalendar(); }, 1500);
      } catch { d.remove(); say("I couldn't save that just now. You can save it from the program's page."); offer([{ label: `Open ${pr.title}`, hash: "programs/" + pr.id, name: pr.title, gold: true }]); end(); } saving = false; };
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
    const save = async (area, n) => { if (saving) return; saving = true; const d = thinking();
      try { await App.logPain(area, n); d.remove();
        const hy = (k) => (window.MDFitHype ? window.MDFitHype(k) : "");
        say(n === 0 ? "Logged: no pain today. Good." : `Logged: ${area.toLowerCase()}, ${n} out of 10.${n >= 7 ? " That is a lot to carry. It's worth having Dr. Jared look at it." : " " + hy("checkin")}`.trim());
        const key = Object.keys(LOG_AREA).find((k) => LOG_AREA[k] === area), rd = road(); lastRoad = rd ? rd.sig : "";
        if (rd && rd.kind !== "done") say(rd.say.replace(/^You're on your first descent[.,] ?(This stop: )?/, "That stop is done. Next: "));
        offer([backToRoad(), ...plain(rd && rd.opt), ...(key && n > 0 ? [{ label: `Programs for your ${key}`, again: true, more: () => beat(() => showArea(key)) }] : []), ...(n > 0 ? [{ label: "See what is likely behind it", hash: "pain", name: "the pain tool" }] : []), ...(n >= 5 ? [opt("book")] : [])]);
      } catch (e) { d.remove(); say("I couldn't save that just now. You can log it in the pain tool."); offer([{ ...opt("pain"), gold: true }]); } saving = false; end(); };
    const known = LOG_AREA[areaKey];
    if (known) return strong(known);
    say(opener || "Let's log it right here. Where does it bother you most?");
    offer([...areas.filter((a) => a !== "Other").map((a) => ({ label: a, more: () => beat(() => strong(a)) })), { label: "Somewhere else", more: () => beat(() => strong("Other")) }, { label: "Nothing hurts today", more: () => save("Other", 0) }]);
  }
  checkin.none = async () => { if (saving) return; saving = true; const d = thinking(); try { await App.logPain("Other", 0); d.remove(); const rd = road(); lastRoad = rd ? rd.sig : ""; say(rd && rd.kind !== "done" ? `Logged. ${rd.say.replace(/^You're on your first descent[.,] ?(This stop: )?/, "Next: ")}` : "Logged."); offer([backToRoad(), ...plain(rd && rd.opt)]); } catch { d.remove(); say("I couldn't save that just now."); offer([opt("pain")]); } saving = false; end(); };
  function hurting(area, extra) {
    if (area) ctx.area = area;
    say(`Okay, I understand how frustrating that can be${area ? `, especially with your ${area}` : ""}. Here's what I can take you to:`);
    offer([{ label: "Log it now", gold: true, more: () => beat(() => checkin(area)) }, ...(area ? [{ label: `Programs for your ${area}`, again: true, more: () => beat(() => showArea(area)) }] : []), opt("pain"), opt("book"), ...(extra || []), opt("call")]);
  }
  // When a reminder is for: a day and a time worked out from the words, on this device
  function whenFrom(raw) {
    // Today and whether a time has passed are both read in the practice's time zone, as the server checks them, not by
    // the phone's clock: on a phone set to another zone "6pm" could otherwise land on an evening already gone there.
    const t = raw.toLowerCase(), today = M.todayInTz(), passed = (d, hm) => M.zonedToUtc(d, hm).getTime() <= Date.now();
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
    else date = time && !passed(today, time) ? today : M.addDays(today, 1);
    if (!time) time = "07:00";
    if (date === today && passed(today, time)) date = M.addDays(today, 1); // that time has passed today
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
      try { const res = await M.apiAuth("DELETE", "/api/me/reminders/" + encodeURIComponent(r.id)); setReminders((res && res.reminders) || G.reminders.filter((x) => x.id !== r.id)); say("Removed."); if (G.reminders.some((x) => x.date >= M.todayInTz())) myReminders(); }
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
    { w: ["inflammation", "inflammatory", "inflamed"], f: ["anti-inflammatory"] }, { w: ["posture", "desk", "sitting"], f: ["posture", "posterior chain", "mobility"] },
    { w: ["balance", "stability", "unsteady", "steadier"], f: ["stability", "mobility", "posterior chain"] }
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
    // (chat: said to him rather than asked of the app; his own talk line for it, when he has one, answers instead: see ask)
    { re: /\b(who are you|what are you|are you (a )?(real|human|person|bot|robot|ai)|what can you do|what do you do|how (do|can) you help)\b|^\s*help( me)?( please)?[\s!?.]*$/, chat: true, run: async () => {
      say("I'm Solomon, the assistant in your MD Fit app. I can pick a program for you, find the right video, take you to the pain tool, book a visit, set a reminder, and tell you what's waiting on your account. For a question about your own body, Dr. Jared is the one to ask.");
      offer([{ label: "Pick a program for me", again: true, more: () => beat(() => recommend({ text: " ", area: "" })) }, opt("pain"), opt("book")]); } },
    { re: /\b(who is|who'?s|about) (dr\.? ?jared|dr\.? ?caban|the doctor|the doc)\b/, run: async () => {
      say("Dr. Jared Caban leads MD Fit in Sarasota. He's a Certified Clinical Exercise Physiologist and Licensed Massage Therapist with medical training, and he built every program and video in this app.");
      offer([opt("book"), opt("messages"), opt("learn")]); } },
    { re: /^\s*(thanks|thank you|thx|ty|cheers|appreciate it|great|awesome|perfect|cool|ok|okay|got it|nice)[\s!.]*$/, chat: true, run: async () => { say("Anytime. I'm here whenever you need me."); } }
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
    // Money words only where they mean money: "due to running", "improve my balance" and "pay attention" are not about an invoice
    const balance = /\bbalance\b/.test(t) && (/\b(account|outstanding|remaining|current|unpaid|pay|paid|owe|owed|bill|invoice|due|card|charge|charged|money|dollars?)\b/.test(t) || /\b(what'?s|whats|what is|check|see|show|view) (my|the) balance\b/.test(t) || /^\s*(my )?balance\s*$/.test(t));
    const due = /\bdue\b(?! (to|for)\b)/.test(t) && !u.pained && !u.area;
    if (/\b(owe|owed|invoice|invoices|bill|bills|overdue)\b/.test(t) || balance || due || (/\bpay\b(?! (attention|off)\b)/.test(t) && !/\bmembership\b/.test(t))) return { kind: "membership", run: () => invoiceTalk(/\b(why|what for|what is it for|what'?s it for|how come|explain)\b/.test(t)) };
    // ("pain level", "what level is this program" and "trigger points" are not about their XP)
    const lvl = /\b(my level|level am i|level up|gem level)\b/.test(t) && !/\b(pain|energy|fitness|stress|skill|activity|difficulty|sugar|glucose)\b/.test(t);
    const pts = /\bpoints\b/.test(t) && !/\b(trigger|pressure|tender|acupressure|acupuncture|focus|key|main|pain|talking|starting|weak|strong) points\b/.test(t);
    if (/\b(streak|xp|rank|how am i doing)\b/.test(t) || ((lvl || pts) && !u.pained && !u.area)) return { kind: "progress", run: () => {
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
  // chat: true = nothing here the device must do itself (a courtesy, or a message it could not place): only then may
  // one of his talk lines answer in its place (ask)
  // the best match is the longest phrase found, so "customize home" beats "home"
  function wayFor(t) { let best = null, len = 0; for (const w of WAYS) for (const k of w.w) if (k.length > len && has(t, k)) { best = w; len = k.length; } return best; }
  function showWay(w) {
    say(`${w.at} I can take you there now.`);
    offer([{ label: w.label, gold: true, name: w.name, ...(w.href ? { href: w.href } : w.card ? { run: () => App.showCard(w.card[0], w.card[1]) } : w.run ? { run: w.run } : { hash: w.hash }) }, opt("call")]);
  }
  // A change to how the app looks, and a saved reminder, each need a clear command; a question that merely contains
  // "night", "white", "comfortable", "tighter" or "my calendar" changes nothing. For a look that is: the word with what
  // it changes ("dark mode", "the black theme", "layout to compact"), "make it / turn the app" + the word, "switch to" +
  // the word, or the word on its own.
  const lookCmd = (t, words) => new RegExp(`^\\s*(?:the |a |go |use |try |i want |i'd like |please )*(?:${words})(?: (?:mode|theme|look|layout|one))?(?: please)?\\s*$`).test(t)
    || new RegExp(`\\b(?:${words}) (?:mode|theme|layout)\\b`).test(t)
    || new RegExp(`\\b(?:mode|theme|layout|background|colou?rs?)\\b.{0,20}\\b(?:to|into|in) (?:${words})\\b`).test(t)
    || new RegExp(`\\b(?:make|turn|switch|change|set|put) (?:it|this|everything|the (?:app|screen|background|colou?rs?|whole thing))(?: (?:to|into|in))? (?:${words})(?: (?:mode|theme|look|layout|one))?(?: please)?\\s*$`).test(t)
    || new RegExp(`\\b(?:switch|change|go|turn) (?:it |this |the app )?(?:back )?(?:to|into) (?:the )?(?:${words})(?: (?:mode|theme|look|layout|one))?(?: please)?\\s*$`).test(t);
  const REMIND = /\b(remind me|(set|add|create|make|save|schedule|need|want)( up| me)?( a| an| another)? reminder|(save|put|add) (it|that|this) (in|on|to) (my|the|your) calendar)\b|^\s*reminder (for|to|at)\b/;
  function decide(u, raw) {
    const plan = route(u, raw); if (["looks", "reminder"].includes(plan.kind) || plan.own) plan.local = true; return plan;
  }
  function route(u, raw) {
    const t = u.text;
    if (HELLO.test(String(raw || "")) && !u.pained && !u.area) return { kind: "other", local: true, free: true, run: hello };
    if (!u.pained && !u.area && /^(please |can you |could you )?((show|give|read|tell) me |what'?s |whats |what is )?(my |the |a )?((weekly|week'?s|last week'?s|this week'?s) )?(recap|results|summary|report)( of| for)?( my| the| this| last)?( week)?( please)?[\s?.!]*$|^how (was|is|did) my (last )?week( go| going)?[\s?.!]*$|^how did i do (this|last) week[\s?.!]*$/.test(String(t).trim())) return { kind: "other", local: true, free: true, run: () => recap(/last week/.test(t) ? "last" : "") };
    const way = !u.pained && !u.area ? wayFor(t) : null;
    if (lookCmd(t, "dark|black|night") && !u.pained) return { kind: "looks", run: () => look({ theme: "black" }, "Done. Black it is. Anything else you'd like to change about how the app looks?") };
    if (lookCmd(t, "white|light|bright")) return { kind: "looks", run: () => look({ theme: "white" }, "Done. White it is. Anything else you'd like to change?") };
    if (lookCmd(t, "compact|tighter|denser")) return { kind: "looks", run: () => look({ layout: "compact" }, "Done. More fits on every screen now.") };
    if (lookCmd(t, "comfortable|roomy|roomier")) return { kind: "looks", run: () => look({ layout: "comfortable" }, "Done. A little more room on every screen.") };
    if (/\b(layout|theme|customi[sz]e|personali[sz]e|make it mine|look and feel)\b/.test(t) && !way) return { kind: "looks", run: () => look(null, "Here's what you can change. Pick one, or just tell me.") };
    if (REMIND.test(t) && !/\b(don'?t|do not|stop|never|quit) remind/.test(t)) return { kind: "reminder", run: () => remind(u, raw) };
    if (/\breminders?\b/.test(t)) return { kind: "reminder", run: myReminders };
    if (FOLLOW.test(String(raw || "")) && lastTopic === "invoice") return { kind: "membership", own: true, run: () => invoiceTalk(true) };
    // ("my goals" inside a question about programs is a question about programs; "my goal" alone is the daily XP goal, below)
    if (/\b(get to know (me|you)|know me better|tell you (more )?about (me|myself)|about myself|(change|update|set|edit|redo) my goals|(change|update|redo) my answers|what (do )?you know about me)\b|^\s*(what are |show (me )?)?my goals\s*$/.test(t) && !/\b(daily|xp)\b/.test(t)) return { kind: "other", local: true, free: true, run: () => knowYou() };
    // (checking in for a visit, at the desk, is not the pain check-in)
    if (/\b(log (my |the |a )?pain|log it|record (my |the )?pain)\b/.test(t) || (/\bcheck ?-?in\b/.test(t) && (/\bpain\b/.test(t) || !/\b(front desk|desk|reception|receptionist|appointment|appointments|visit|visits|clinic|office|arrive|arrival|get there)\b/.test(t)))) return { kind: "pain", local: true, free: true, run: () => checkin(u.area) };
    if (!u.area && /^\s*(it'?s |its |it is |i hurt |hurts )?(everything|everywhere|all over|all of it|my whole body|whole body|all of me)( hurts| aches| is sore)?\s*$/.test(t)) return { kind: "pain", local: true, free: true, run: () => checkin("", "That's a lot to carry. Start with the one that bothers you most, and we'll log it right here:") };
    if (!u.area && /^\s*(nothing|nothing hurts|no pain|none|i'?m fine|im fine|i feel (fine|good|great)|all good|nothing really)\s*$/.test(t)) return { kind: "pain", local: true, free: true, run: () => { say("Good to hear. I'll log that as no pain today."); checkin.none(); } };
    const acct = own(u); if (acct) return { ...acct, own: true };
    // The way to something in the app: answered here, with the path and a button that goes there
    if (way) return { kind: "other", local: true, free: true, run: () => showWay(way) };
    // On the phone: a real pick from the app's programs, and plain answers to the usual next questions
    if (RECOMMEND.test(t) && !u.pained) return { kind: "programs", run: () => recommend(u) };
    // A goal said plainly ("I want to get stronger", "lose weight", "better at golf") is asking for a pick too
    if (!u.pained && GOALS.some((g) => g.w.some((w) => has(t, w))) && !u.places.some((p) => ["book", "messages", "profile", "premium", "call", "visit", "generate", "videos"].includes(p.id))) return { kind: "programs", run: () => recommend(u) };
    if (!u.pained && !/\b(appointment|appointments|visit|visits|invoice|invoices|bill|owe|reminder)\b/.test(t)) { const f = faqFor(raw, t); if (f) return { kind: "other", chat: !!f.chat, run: f.run }; }
    if (FOLLOW.test(String(raw || "")) && lastTopic === "programs") return { kind: "programs", run: FAQ[0].run };
    if (u.pained) return { kind: "pain", run: () => hurting(u.area, u.places.filter((p) => !["pain", "book", "call"].includes(p.id)).slice(0, 1).map((p) => opt(p.id))) };
    if (u.area) return { kind: (u.places[0] || {}).kind || "programs", run: () => showArea(u.area) };
    if (u.places.length && WHERE.test(t) && AT[u.places[0].id]) return { kind: u.places[0].kind, local: true, free: true, run: () => { const p = u.places[0];
      say(`${AT[p.id][phone() ? 0 : 1]} I can take you there now.`); offer([{ ...opt(p.id), gold: true }, ...u.places.slice(1, 3).map((x) => opt(x.id))]); } };
    if (u.places.length) return { kind: u.places[0].kind, run: () => { say(u.places.length === 1 ? "Got it. This is the place for that:" : "Got it. These look like what you're after:"); offer([...u.places.slice(0, 4).map((p) => opt(p.id)), ...(u.places.some((p) => p.id === "call") ? [] : [opt("call")])]); } };
    // Short and unplaceable ("everything", "ok", "what now"): answered from where they are on their road, on the device
    // (not when it names a body part or a symptom: "my leg feels funny" gets the answer below, with the pain tool)
    { const rd = road(), words = t.trim().split(/\s+/).filter(Boolean).length;
      if (rd && words <= 4 && !u.health) return { kind: "other", local: true, free: true, soft: true, chat: true, run: () => { lastRoad = rd.sig; say(rd.say); offer([...(rd.opt ? [rd.opt] : []), opt("generate"), opt("programs"), opt("call")]); } }; }
    return { kind: "other", chat: true, run: async () => {
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
    lastAsked = text;
    if (u.urgent) { emergency(text); return true; }
    busy = true; const d = thinking(), t0 = Date.now();
    try {
      // What the device must do itself is worked out first: a reminder, a look, the member's own account, the way to a
      // place, a program, anything about pain or the body. Polite or exclamatory words around it change none of that.
      const plan = decide(u, text);
      // Talk (owner, Nov 2026): things said to him, not asked of the app: thanks, "give me a verse", "I'm tired",
      // "tell me a joke", "who are you". His lines for these are kept on the device (account-solomon.js registers
      // them with talk()). One is used only when the plan has nothing the device must do (plan.chat) and the message
      // names no body part or symptom. With the assistant off it is the answer: never counted, never sent anywhere.
      // With the assistant on he answers through the language model (so the reply fits what was said), and the line
      // kept here is what he falls back on when the assistant is slow, fails, or today's free answers are used up.
      const told = plan.chat && !u.health && !u.pained && !u.area ? talkFor(text) : null;
      const free = !!told || !!plan.free; // answered on the device without being counted
      // With the assistant on, a question the device does not answer itself is read on MD Fit's server; anything else
      // (and any failure there) is understood here and only counted. A few words the device cannot place are his to
      // answer there too (plan.soft). Something the device answers for free is not sent once the app knows a free
      // member has nothing left today: the server could only refuse it.
      let ai = null, asked = false;
      if (G.ai && (!plan.local || plan.soft)) {
        if (!(free && spent())) { ai = await askServer(text); asked = !!ai; }
        // Not sent. The account is read again instead (nothing typed goes with it), so the line under the box and the
        // counter catch up if the practice has switched the assistant off or changed the allowance since the app last heard.
        else await Promise.race([load(), wait(2500)]);
      }
      // Today's free answers are used up, but the device has its own free answer for this: that, not the upgrade message
      if (ai && ai.ok === false && free) ai = null;
      // The assistant judged the message outside what he helps with. If the device found a place, a body area, pain or
      // a symptom in it, the device answers. Otherwise he says so in his own voice and offers what he can do.
      const off = !!ai && ai.ok !== false && !ai.urgent && outside(ai);
      if (off && (u.places.length || u.area || u.pained || u.health)) ai = null;
      const aside = off && ai ? talkFor("", true) : null;
      const ok = ai || asked || free ? true : await count(plan.kind); // talk and a hello are never counted (nor a question the server already counted)
      const rest = 750 - (Date.now() - t0); if (rest > 0) await wait(rest);
      d.remove();
      lastTopic = ""; // a follow-up belongs to the answer just given; the answer below sets it again if it has one
      const care = !!(u.health || u.pained || u.area); // about pain or the body: the limit message keeps the pain tool and the clinic
      if (aside) reply(told || aside); else if (ai) await aiAnswer(ai, care); else if (!ok) limit(care); else if (told) reply(told); else await plan.run();
    } catch { d.remove(); say("Something went wrong on my side. You can still get anywhere from the menu, or call the clinic."); offer([opt("call")]); }
    // Whatever happened above, the dots go and the box takes the next message
    finally { d.remove(); busy = false; end(); }
    return true;
  }
  // talk(fn): a way for his lines to be added from outside. fn(text, lost) gives null or { say, opts, feel }:
  // say is one line or several; opts are buttons, each { label, more } (does something and may answer again by
  // returning another such object), { place: "generate" } (one of the app's places) or { road: true } (what is next
  // on the member's road). lost = nothing answered what was typed.
  const talkers = [];
  function talkFor(text, lost) { for (const f of talkers) { try { const r = f(String(text || ""), !!lost); if (r && r.say) return r; } catch {} } return null; }
  function reply(r) {
    [].concat(r.say).filter(Boolean).forEach((line) => say(String(line)));
    const rd = road(), list = [];
    for (const o of r.opts || []) {
      if (o.road) { if (rd && rd.opt && !["done", "ask"].includes(rd.kind)) list.push({ ...rd.opt, gold: true }); }
      else if (o.place) { if (PLACES.some((x) => x.id === o.place)) list.push(opt(o.place)); }
      else if (o.label && typeof o.more === "function") list.push({ label: o.label, again: true, more: () => beat(() => { const nx = o.more(); if (nx && nx.say) reply(nx); }) });
    }
    if (list.length) offer(list);
    if (r.feel) faceAfter = r.feel;
  }
  let faceAfter = ""; // the face he wears when the chat is next closed (he shows none while it is open)
  // The urgent answer. A crisis (thoughts of dying or of self-harm, for the member or someone with them) gets the 988
  // Suicide and Crisis Lifeline first, then 911 and the clinic; a medical emergency gets 911 and the clinic. A message the
  // assistant flagged but the words did not catch gets the crisis answer, which carries 911 as well. "I hurt myself" said
  // on its own is often an injury, so that answer also offers the pain tool.
  let lastAsked = "";
  const emergency = (text = lastAsked) => {
    const t = String(text || ""), crisis = CRISIS_WORDS.isCrisis(t), medical = !crisis && CRISIS_WORDS.isUrgent(t);
    if (medical) { say("If this is an emergency, call 911 now. For anything else urgent, call the clinic."); offer([{ label: "Call 911", tel: "911", gold: true }, opt("call")]); return; }
    say("You don't have to go through this alone. Call or text 988 any time to talk with someone now. If you or someone with you is in danger, call 911.");
    // only the bare words ("I hurt myself", "I think I hurt myself again"), which are often an injury; never with intent
    const injury = /^\s*(i (think|guess) (that )?i |i (just |really )?)?hurt(ing|ed)? my ?s(el|le)f( again| today| yesterday| at home| badly| bad)?\s*[.!?]*\s*$/i.test(t);
    offer([{ label: "Call 988", tel: "988", gold: true }, { label: "Text 988", sms: "988" }, { label: "Call 911", tel: "911" }, ...(injury ? [opt("pain")] : []), opt("call")]);
  };
  // Outside what he helps with: the server says so itself (outside: true or false). An older server sends no such word,
  // and there the assistant's flat "I can only help with" is the only sign, so that is looked for instead.
  const outside = (r) => (typeof r.outside === "boolean" ? r.outside : /\bcan only help with\b/i.test(String(r.say || "")));
  // null = the assistant is off or did not answer: fall back to the device, never an error on screen
  async function askServer(text) {
    try {
      const r = await Promise.race([post("/api/me/guide/ask", { text: text.slice(0, 300) }), wait(12000).then(() => null)]);
      if (!r || typeof r !== "object") return null;
      if (r.ok === true && (r.urgent || typeof r.say === "string")) { apply(r); return r; }
      if (r.ok === false && r.limited) { apply(r); return r; }
      // One answer that failed ({ ai: true, failed: true }) leaves the assistant on: the device answers this message and
      // the next one is sent as usual. Only { ai: false } with no "failed" can mean the practice switched it off, and
      // an older server says the same when the model fails once, so the account is asked which it is. The small print
      // changes only if the assistant really is off (or the account cannot be reached, when nothing more is sent).
      if (r.ok === false && r.ai === false && !r.failed) {
        const g = await Promise.race([M.apiAuth("GET", "/api/me/guide").catch(() => null), wait(4000).then(() => null)]);
        if (g && typeof g === "object" && "ai" in g) apply(g); else { G.ai = false; fine(); }
      }
    } catch {}
    return null;
  }
  const FROM_SERVER = { workout: "generate", membership: "premium" };
  async function aiAnswer(r, care) {
    if (r.ok === false) return limit(care);
    if (r.urgent) return emergency();
    const area = AREAS[r.area] ? r.area : ""; if (area) ctx.area = area;
    const ids = [...new Set((Array.isArray(r.places) ? r.places : []).map((x) => FROM_SERVER[x] || x))].filter((id) => id !== "call" && PLACES.some((p) => p.id === id)).slice(0, 5);
    say(String(r.say || "").trim().slice(0, 600) || "Here's where I can take you:");
    if (FACE[r.mood]) faceAfter = r.mood; // the face he wears once the chat is closed
    // A verse was asked for: the model leads into it, and the verse itself comes from his own list, word for word
    if (r.verse) { const v = talkFor("__verse"); if (v) { reply(v); return; } }
    const rd = road(), next = plainHome() ? "Next" : "Next on your road"; // the Simple view has no road, as in his plain lines (account-solomon.js)
    offer([...(rd && rd.opt && !["done", "ask"].includes(rd.kind) ? [{ ...rd.opt, label: rd.opt.label === "Do my check-in here" ? `${next}: my check-in` : `${next}: ${rd.opt.label.replace(/^(Open|Start|Pick|Build) /, (m) => m.toLowerCase())}` }] : []), ...(area ? [{ label: `Programs for your ${area}`, again: true, more: () => beat(() => showArea(area)) }] : []), ...ids.map(opt), opt("call")]);
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
        return { label: name, sub: [ex && ex.region, "Suggested"].filter(Boolean).join(" · "), again: true, more: () => { if (!App.playExercise || !App.playExercise(v.id)) say("That video isn't available just now. It's in the video library."); } }; }));
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
      { label: "Something hurts", again: true, more: () => beat(() => { say("I'm sorry to hear that. Where is it bothering you?"); offer(["knee", "back", "shoulder", "hip", "neck", "foot"].map((a) => ({ label: cap(a), more: () => beat(() => hurting(a)) }))); }) },
      opt("book"), opt("programs"), opt("generate"),
      ...(theme() ? [{ label: "Make the app mine", again: true, more: () => beat(() => look(null, "Here's what you can change. Pick one, or just tell me.")) }] : [])]);
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
  // ---------- "How was my week?" The same numbers as the Results card on Progress (account.js weekFacts), read out
  // by Solomon: what was done, how it compares, what moved toward their goal, and what is next. No advice. ----------
  function recap(which) {
    let f = null; try { f = App.weekFacts ? App.weekFacts() : null; } catch {}
    if (!f) { say("I can't see your numbers just now. Ask me again in a moment."); return offer([backToRoad()]); }
    const name = f.first ? `, ${f.first}` : "", s = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
    if (!f.any) { say(`Nothing on the books yet${name}. One session or one check-in, and I'll have something to read you.`); return offer([backToRoad()]); }
    const cur = f.weeks[3], last = f.weeks[2], before = f.weeks[1], quietWeek = (w) => !w.sessions && !w.checkins && !w.activeDays;
    const useLast = which === "last" || (which !== "this" && quietWeek(cur) && !quietWeek(last)), w = useLast ? last : cur;
    if (quietWeek(w)) say(useLast ? `Last week was quiet${name}: nothing logged. No lecture from a cloud. One stone today and we're moving again.` : `Nothing logged yet this week${name}. The week is young. So is one of us.`);
    else {
      const did = [w.sessions ? s(w.sessions, "session") + (w.minutes ? ` and ${w.minutes} minutes` : "") : "no sessions", ...(w.checkins ? [s(w.checkins, "check-in")] : [])].join(", ");
      say(`${useLast ? "Last week" : "This week so far"}${name}: ${did}. You showed up on ${w.activeDays} of ${useLast ? 7 : f.dayOfWeek} day${(useLast ? 7 : f.dayOfWeek) === 1 ? "" : "s"}.`);
      if (useLast) { const d = last.sessions - before.sessions;
        if (d > 0) say(`${s(d, "session")} more than the week before. Noted, and earned.`); else if (d < 0) say(`${s(-d, "session")} fewer than the week before. It happens. This week is a fresh page.`); else if (last.sessions) say("Level with the week before. Steady is a skill."); }
      else if (last.sessions) say(`Last week ended on ${s(last.sessions, "session")}. ${cur.sessions >= last.sessions ? "You're already there." : `${s(last.sessions - cur.sessions, "session")} to match it.`}`);
    }
    const p = f.pain, over = (d) => (d >= 14 ? `${Math.round(d / 7)} weeks` : `${d} day${d === 1 ? "" : "s"}`);
    if (p && p.to < p.from) say(`${p.area}: ${p.from} down to ${p.to} over ${over(p.days)}. That's the direction we want.`);
    else if (p && p.to > p.from) say(`${p.area}: ${p.from} up to ${p.to} over ${over(p.days)}. Worth a word with Dr. Jared if it keeps climbing.`);
    else if (p) say(`${p.area} is holding at ${p.to}.`);
    if (f.lift) say(`${f.lift.name}: ${f.lift.from} to ${f.lift.to} lb. Stronger, and it's on the record.`);
    let nx = null; try { nx = App.nextUp ? App.nextUp() : null; } catch {}
    // what is next on their road; when nothing is lined up, he offers to build today's session himself
    if (nx && nx.kind === "ask") say("Nothing is lined up for today. Say the word and I'll build you a session.");
    else if (nx && nx.title) say(`Next up: ${nx.title}.`);
    offer([backToRoad(), { label: "See my results", hash: "progress", name: "your results" }]);
  }
  function lesson(ref) {
    open(false, true);
    beat(() => (ref === "know" ? knowYou() : ref === "pain" ? checkin("", "This stop is your check-in. Where does it bother you most? Or tell me nothing hurts.") : pickRoad("This stop: pick your road. What are you here for?")));
  }
  function open(byHand, quiet) {
    if (!box.hidden) return;
    hush(); clearTimeout(emoT); paintEmo(""); box.hidden = false; scrim.hidden = !phone(); dot.hidden = true; btn.setAttribute("aria-expanded", "true"); document.documentElement.classList.add("mg-open");
    try { localStorage.setItem("mdfit-guide-met", "1"); } catch {}
    if (quiet) greeted = true; else if (!greeted) greet(); else news();
    if (!saidOpen) { saidOpen = true; tell("open"); }
    load(); end(); fitKeyboard();
    if (byHand && !phone()) setTimeout(() => input.focus({ preventScroll: true }), 60); // on a phone the keyboard waits for a tap on the box
  }
  function shut() { paintEmo(plainHome() ? "" : resting); if (faceAfter) { const f = faceAfter; faceAfter = ""; setTimeout(() => feel(f, 2600), 250); } box.hidden = true; scrim.hidden = true; box.style.bottom = ""; box.style.height = ""; btn.setAttribute("aria-expanded", "false"); document.documentElement.classList.remove("mg-open"); }
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
  window.MDFitGuide = { day: dayRows, understand, open: () => open(false), lesson, shut, say: speak, hush, recap: (which) => { open(false, true); beat(() => recap(which)); }, speaking: () => !tag.hidden, feel, rest, feeling, talk: (fn) => { if (typeof fn === "function") talkers.push(fn); }, question: (text, opts) => { hush(); open(false, true); beat(() => { say(text); offer(opts); }); }, greeting: (t) => { dayHello = String(t || "").trim(); }, reminders: () => G.reminders.slice() };
})();
