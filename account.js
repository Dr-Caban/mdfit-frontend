// MD Fit client app (/account): Home, Generate, Videos, Pain Tool, Profile, plus the workout player.
(() => {
  const { $, $$, esc, auth, apiAuth, api, wire, fmtDate, fmtTime, todayInTz, addDays, zonedToUtc, icsStamp, AREAS, loadSite } = window.MDFit;
  if (!auth.get()) { location.replace("/login?next=" + encodeURIComponent("/account" + location.hash)); return; }
  // Live updates; the new_message handler is registered once, with the Messages code below.
  if (window.MDFitRT) MDFitRT.connect({ namespace: "/member", token: auth.get().token });
  const EX = window.MDFIT_EXERCISES || [], INTROS = window.MDFIT_INTROS || {}, Gen = window.MDFitGen;

  const ADDRESS = "3214 Clark Road, Sarasota, FL 34231";
  const GUIDES = {
    "posterior-neck": "The Posterior Neck Power Grid", "scalenes": "The Scalenes & Intercostals", "rotator-cuff": "The Rotator Cuff",
    "iliopsoas": "The Iliopsoas Complex", "lateral-hip": "Lateral Hip Powerhouse", "quads": "Tight Quads: Referred Pain", "calf": "The Calf Complex"
  };
  const shortDate = (d) => fmtDate(d, { month: "short", day: "numeric" });
  const thumb = (id) => MDFitVideo.thumb(id, 480);
  const thumbImg = (id) => `<span class="thumb" data-thumb="${esc(id)}"><img src="${thumb(id)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="window.MDFitThumbFail&&window.MDFitThumbFail(this)" onload="this.naturalWidth<40&&window.MDFitThumbFail&&window.MDFitThumbFail(this)"></span>`;
  // If Drive has no thumbnail, show a still frame from the video itself (#t= makes Safari paint that frame)
  window.MDFitThumbFail = (img) => {
    const box = img.closest(".thumb"); img.remove(); if (!box || box.querySelector("video")) return;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "metadata"; v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true"); v.tabIndex = -1;
    v.src = MDFitVideo.mp4(box.dataset.thumb) + "#t=0.8";
    v.addEventListener("loadeddata", () => box.classList.add("has-frame"), { once: true });
    box.prepend(v);
  };
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  // Clean update: drop what older app versions saved on this device and no longer use (old workout-generator
  // choices and old "today's workout"). Sign-in, favorites and everything on the account are left alone.
  try { ["mdfit_prefs", "mdfit_prefs1", "mdfit_prefs2", "mdfit_today", "mdfit_today1", "mdfit_today2"].forEach((k) => localStorage.removeItem(k)); } catch {}
  let client = auth.client(), stats = null, appts = { upcoming: [], past: [] }, painLog = [], allWorkouts = [], reward = null;
  let lib = { favorites: [], programs: [] };

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false; t.classList.remove("celebrate");
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }

  // Bottom pop-up notifications (rewards, messages, upcoming visits). Each fires once, tracked per device.
  const seenStore = { get(k) { try { return JSON.parse(localStorage.getItem("mdfit-seen-" + k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem("mdfit-seen-" + k, JSON.stringify(v)); } catch {} } };
  const NOTIF_ICONS = { reward: "🏆", level: "⭐", message: "💬", visit: "📅" };
  const inbox = { items: seenStore.get("inbox") || [], unseen: seenStore.get("inbox-unseen") || 0 };
  function saveInbox() { inbox.items = inbox.items.slice(0, 25); seenStore.set("inbox", inbox.items); seenStore.set("inbox-unseen", inbox.unseen); if (typeof renderNotes === "function" && $("#notes")) renderNotes(); }
  // Red dot on the bottom tab a notification is about (and on "More" when that tab is tucked away); cleared when the tab is opened
  const tabDots = new Set();
  function renderDots() {
    $$(".tabbar [data-tab]").forEach((b) => b.classList.toggle("has-dot", tabDots.has(b.dataset.tab) && b.dataset.tab !== "messages"));
    const hiddenDot = $$(".tabbar .ov").some((b) => tabDots.has(b.dataset.tab) && b.dataset.tab !== "messages");
    $("#more-btn").classList.toggle("has-dot", hiddenDot);
    $$("#more-list [data-goto]").forEach((a) => a.classList.toggle("has-dot", tabDots.has(a.dataset.goto) && a.dataset.goto !== "messages"));
  }
  function dotFor(go) {
    const tab = String(go || "").replace(/^#/, "").split("/")[0];
    const view = tab && $(`[data-view="${tab}"]`);
    if (!view || !view.hidden) return;
    tabDots.add(tab); renderDots();
  }
  function notify({ kind, title, body, action, go }) {
    inbox.items.unshift({ kind, title, body: body || "", action: action || "", go: go || "", at: Date.now() }); inbox.unseen++; saveInbox();
    dotFor(go);
    const box = $("#notifs"); if (!box) return;
    while (box.children.length >= 3) box.firstElementChild.remove();
    const n = document.createElement("div");
    n.className = `notif notif-${kind}`; n.setAttribute("role", "status");
    n.innerHTML = `<span class="notif-ic" aria-hidden="true">${NOTIF_ICONS[kind] || "🔔"}</span><div class="notif-txt"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}</div>${action ? `<button type="button" class="notif-go">${esc(action)}</button>` : ""}<button type="button" class="notif-x" aria-label="Dismiss"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    const close = () => { n.classList.add("out"); setTimeout(() => n.remove(), 220); };
    n.querySelector(".notif-x").addEventListener("click", close);
    const g = n.querySelector(".notif-go"); if (g) g.addEventListener("click", () => { close(); if (go) location.hash = go; });
    let sx = null;
    n.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    n.addEventListener("touchend", (e) => { if (sx !== null && Math.abs(e.changedTouches[0].clientX - sx) > 60) close(); sx = null; });
    box.appendChild(n);
    setTimeout(close, 8000);
  }
  // Milestones: spinning coin + bonus XP, then (on level-ups and every 3rd badge) a Duolingo-style leaderboard pop-up
  const msQueue = []; let msBusy = false, msShowBoard = false;
  function milestone(m) { msQueue.push(m); if (!msBusy) nextMilestone(); }
  function nextMilestone() {
    const m = msQueue.shift();
    if (!m) { msBusy = false; if (msShowBoard) { msShowBoard = false; showBoardPopup(); } return; }
    msBusy = true;
    $("#ms-face").innerHTML = m.icon;
    $("#ms-kicker").textContent = m.kicker;
    $("#ms-title").textContent = m.title;
    $("#ms-desc").textContent = m.desc || "";
    $("#ms-xp").innerHTML = m.xp ? `<span>+${m.xp}</span> XP` : "";
    const ov = $("#ms"); ov.hidden = false; ov.classList.remove("play"); void ov.offsetWidth; ov.classList.add("play");
    try { navigator.vibrate && navigator.vibrate([30, 40, 60]); } catch {}
  }
  $("#ms-go").addEventListener("click", () => { $("#ms").hidden = true; nextMilestone(); });
  async function showBoardPopup() {
    let d; try { d = await apiAuth("GET", "/api/me/leaderboard?period=week"); } catch { return; }
    if (d.hidden || !d.me) return;
    const lname = d.league === "olympic" ? "🏆 Olympic League" : "🏅 Pro League";
    $("#ms-lb-league").textContent = lname;
    $("#ms-lb-title").textContent = d.me.rank === 1 ? "You're #1 this week!" : `You're #${d.me.rank} this week`;
    const rows = d.top.slice(0, 5);
    if (!rows.some((r) => r.me)) rows.push({ rank: d.me.rank, name: client.name || "You", score: d.me.score, level: reward ? reward.level : 1, me: true });
    $("#ms-lb-list").innerHTML = rows.map((r, i) => `<li class="${r.me ? "me" : ""}" style="animation-delay:${i * 70}ms"><span class="rk rk-${r.rank}">${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</span><span class="nm">${esc(r.name)}${r.me ? " (you)" : ""}<small>${esc((r.gem && r.gem.name) || (reward && reward.title) || "")}</small></span><b>${r.score.toLocaleString()}</b></li>`).join("");
    $("#ms-lb").hidden = false;
  }
  $("#ms-lb-go").addEventListener("click", () => { $("#ms-lb").hidden = true; });
  function notifyRewards(r) {
    if (!r) return;
    const earned = r.badges.filter((b) => b.earned).map((b) => b.id), seen = seenStore.get("badges"), lvl = seenStore.get("level");
    let badgeCount = seenStore.get("ms-count") || 0;
    if (seen) r.badges.filter((b) => b.earned && !seen.includes(b.id)).forEach((b) => {
      notify({ kind: "reward", title: `Badge unlocked: ${b.title}`, body: b.desc, action: "View", go: "#progress" });
      milestone({ icon: `<svg viewBox="0 0 24 24">${BADGE_IC[b.icon] || BADGE_IC.star}</svg>`, kicker: "Milestone unlocked", title: b.title, desc: b.desc, xp: 25 });
      badgeCount++; if (badgeCount % 3 === 0) msShowBoard = true;
    });
    if (lvl !== null && r.level > lvl) {
      notify({ kind: "level", title: `New gem: ${r.title}`, body: "You reached a new gem level. Keep it going!", action: "View", go: "#home" });
      milestone({ icon: `<span class="ms-lv">${r.level}</span>`, kicker: "New gem!", title: r.title, desc: r.level === (r.olympicLevel || 4) ? "Welcome to the Olympic League." : `You reached ${r.title}, gem level ${r.level} of 8.`, xp: 0 });
      msShowBoard = true;
    }
    if (msShowBoard && !msBusy && !msQueue.length) { msShowBoard = false; showBoardPopup(); }
    seenStore.set("ms-count", badgeCount); seenStore.set("badges", earned); seenStore.set("level", r.level);
  }
  function notifyVisits() {
    const t = todayInTz(), seen = seenStore.get("visits") || {};
    appts.upcoming.filter((a) => a.status !== "cancelled" && a.date <= addDays(t, 1)).forEach((a) => {
      const key = `${a.id || a.date + a.time}:${t}`; if (seen[key]) return;
      notify({ kind: "visit", title: `Visit ${a.date === t ? "today" : "tomorrow"} at ${fmtTime(a.time)}`, body: a.typeName, action: "Details", go: "#profile" });
      seen[key] = 1;
    });
    seenStore.set("visits", Object.fromEntries(Object.entries(seen).filter(([k]) => k.endsWith(":" + t))));
  }
  let lastUnreadNotified = -1;
  function notifyMessages(n) {
    if (n > 0 && n !== lastUnreadNotified && $("#view-messages").hidden) notify({ kind: "message", title: n === 1 ? "New message from Dr. Jared" : `${n} new messages from Dr. Jared`, action: "Read", go: "#messages" });
    lastUnreadNotified = n;
  }

  // ================= Tabs (hash routing so the back button and refresh work)
  const TABS = ["home", "generate", "programs", "videos", "pain", "learn", "progress", "leaders", "premium", "messages", "tips", "profile"];
  // Hash is "#tab" or "#pain/muscle/<id>" (deep link to a muscle report)
  function show(hash) {
    let [tab, sub, arg] = String(hash).split("/");
    if (!TABS.includes(tab)) tab = "home";
    if (tab === "pain" && sub === "muscle" && arg) setTimeout(() => openReport(arg, false), 0);
    else if (tab === "pain" && sub === "track" && arg) setTimeout(() => openTrack(arg), 0);
    else if (tab === "pain" && !$("#muscle-report").hidden) setMode(reportFrom);
    $$("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== tab));
    $$(".tabbar [data-tab]").forEach((b) => (b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    if (tabDots.delete(tab)) renderDots();
    if (tab === "videos") renderVideos();
    if (tab === "pain" && !show.painMap) { show.painMap = true; if (window.MDFitPainMap) window.MDFitPainMap.init($("[data-painmap='app']")); }
    if (tab === "progress") renderCalendar();
    if (tab === "leaders" && typeof loadBoard === "function") loadBoard();
    if (["programs", "learn", "premium", "tips"].includes(tab)) renderContent(tab, tab === "programs" ? String(hash).split("/").slice(1).join("/") : sub);
    if (tab === "messages") openMessages(); else clearInterval(msgPoll);
    $("#more-btn").classList.toggle("on", $$(".tabbar .ov").some((b) => b.dataset.tab === tab));
    const ms = $("#more-sheet"); if (ms.open) ms.close();
    // Back/forward or a link away from the Pain Tool must not leave its pattern sheet open over the next screen
    if (tab !== "pain") $$("dialog.pm-sheet[open]").forEach((d) => d.close());
    window.scrollTo(0, 0);
  }
  const go = (tab) => { if (location.hash !== "#" + tab) history.pushState(null, "", "#" + tab); show(tab); };
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  $$(".tabbar [data-tab]").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
  document.addEventListener("click", (e) => { const g = e.target.closest("[data-goto]"); if (g) go(g.dataset.goto); });
  // Shortcut actions from the More sheet (e.g., Book an appointment)
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    const ms = $("#more-sheet"); if (ms && ms.open) ms.close();
    if (b.dataset.action === "book") { go("profile"); setTimeout(() => $("#p-book-open") && $("#p-book-open").click(), 50); }
  });
  // Phones show five tabs plus "More"; the rest live in a sheet
  // Prepend high-value destinations (Pain Tool, Video Library, Book) above the overflow tabs
  const topLinks = [
    { tab: "pain", label: "Pain Tool", icon: `<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 1 1-2 2 2 2 0 0 1 2-2zm-3 20v-7H7.5V9a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v6H15v7z"/></svg>` },
    { tab: "videos", label: "Video Library", icon: `<svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm6 3.5v7l6-3.5z"/></svg>` },
    { action: "book", label: "Book an appointment", icon: `<svg viewBox="0 0 24 24"><path d="M19 4h-2V2h-2v2H9V2H7v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14zM7 12h5v5H7z"/></svg>` }
  ];
  const topHtml = topLinks.map((x) => `<button type="button" class="more-top" ${x.tab ? `data-goto="${x.tab}"` : `data-action="${x.action}"`}>${x.icon}<span>${x.label}</span></button>`).join("");
  const restHtml = $$(".tabbar .ov").map((b) => `<button type="button" data-goto="${b.dataset.tab}">${b.querySelector("svg").outerHTML}<span>${b.querySelector(".long").innerHTML}</span></button>`).join("");
  $("#more-list").innerHTML = topHtml + `<div class="more-sep"></div>` + restHtml;
  if (typeof renderDots === "function") renderDots();
  $("#more-btn").addEventListener("click", () => $("#more-sheet").showModal());

  // ================= Dialogs: exercise videos, guides, intros
  const vd = $("#video-dialog");
  $$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
  // Video preloading: direct MP4 in a native <video>, warmed before the tap. Visible cards fetch metadata
  // (a few at a time); touching a card starts buffering the opening seconds. Drive's player is the fallback.
  const mp4Url = (id) => MDFitVideo.mp4(id);
  const saveData = !!(navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || "")));
  const warm = new Map(); const WARM_MAX = 8; let warmQueue = [], warmActive = 0;
  function warmVideo(id, level = "metadata") {
    if (!id || !MDFitVideo.onCdn(id)) return null; // Drive-hosted clips can only play in Drive's iframe: no element to warm
    let v = warm.get(id);
    if (v) { warm.delete(id); warm.set(id, v); if (level === "auto" && v.preload !== "auto") { v.preload = "auto"; v.load(); } return v; }
    v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = level; v.src = mp4Url(id);
    v.setAttribute("playsinline", ""); v.className = "vd-video";
    warm.set(id, v);
    while (warm.size > WARM_MAX) { const [k, old] = warm.entries().next().value; if (old.isConnected) break; old.removeAttribute("src"); old.load(); warm.delete(k); }
    return v;
  }
  function pumpWarm() {
    while (warmActive < 3 && warmQueue.length) {
      const id = warmQueue.shift(); if (warm.has(id)) continue;
      const v = warmVideo(id, "metadata"); if (!v) continue; warmActive++;
      let finished = false;
      const done = () => { if (finished) return; finished = true; warmActive--; v.removeEventListener("loadedmetadata", done); v.removeEventListener("error", done); pumpWarm(); };
      v.addEventListener("loadedmetadata", done); v.addEventListener("error", done); setTimeout(done, 8000);
    }
  }
  const warmObs = "IntersectionObserver" in window && !saveData ? new IntersectionObserver((ents) => {
    ents.forEach((en) => { if (en.isIntersecting) { const id = en.target.dataset.video; if (id && !warm.has(id) && !warmQueue.includes(id)) warmQueue.push(id); warmObs.unobserve(en.target); } });
    pumpWarm();
  }, { rootMargin: "200px 0px" }) : null;
  function observeCards(root) { if (warmObs) $$("[data-video]", root).forEach((el) => warmObs.observe(el)); }
  ["pointerdown", "mouseover", "touchstart"].forEach((t) => document.addEventListener(t, (e) => {
    const c = e.target.closest && e.target.closest("[data-video]"); if (c) warmVideo(c.dataset.video, "auto");
  }, { passive: true }));
  vd.addEventListener("close", () => {
    clearTimeout(playVideo.stall);
    $("#vd-frame").src = "about:blank"; $("#vd-frame").hidden = true;
    const v = $("#vd-box .vd-video"); if (v) { v.pause(); v.remove(); }
  });
  const earn = (kind, ref = "") => apiAuth("POST", "/api/me/xp", { kind, ref: String(ref) }).then(() => loadRewards(true)).catch(() => {});
  // Drive answers the direct MP4 with Cross-Origin-Resource-Policy: same-site (and an HTML virus-scan page for files
  // over 100 MB), so browsers refuse it in a <video> within milliseconds: Drive's own player (the iframe) is the real
  // path for everything not yet on Cloudinary. The warmed element has therefore usually failed before this runs
  // (touchstart on the card reloads it well ahead of the click) and a MediaError is never fired twice, so read the
  // state here instead of only waiting for `error`; a clip that shows no frame within 6 s falls back too.
  function playVideo(id, title, meta = "") {
    earn("video", id);
    $("#vd-title").textContent = title;
    $("#vd-meta").textContent = meta;
    const box = $("#vd-box"), f = $("#vd-frame"), v = warmVideo(id, "auto");
    if (!v) { f.hidden = false; f.src = MDFitVideo.preview(id); vd.showModal(); return; }
    v.controls = true; v.muted = false; v.autoplay = true; // opened by a tap, so sound is allowed
    const fallback = () => {
      clearTimeout(playVideo.stall); v.onerror = null; v.remove();
      warm.delete(id); v.removeAttribute("src"); v.load(); // drop the dead element so the next tap starts clean
      f.hidden = false; f.src = MDFitVideo.preview(id);
    };
    v.onerror = fallback;
    clearTimeout(playVideo.stall);
    playVideo.stall = setTimeout(() => { if (v.isConnected && v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) fallback(); }, 6000);
    box.prepend(v);
    vd.showModal();
    if (v.error) fallback(); else v.play().catch((err) => { if (err && err.name === "NotAllowedError") { v.muted = true; v.play().catch(() => {}); } });
  }
  const exMeta = (e) => [e.region, e.cat, e.level && `Level ${e.level}`, e.loc && e.loc !== "any" && e.loc[0].toUpperCase() + e.loc.slice(1)].filter(Boolean).join(" · ");
  const byId = new Map(EX.map((e) => [e.id, e]));
  document.addEventListener("click", (e) => {
    const v = e.target.closest("[data-video]");
    if (v) { const x = byId.get(v.dataset.video); if (x) playVideo(x.id, x.name, exMeta(x)); return; }
    const i = e.target.closest("[data-intro]");
    if (i && INTROS[i.dataset.intro]) { playVideo(INTROS[i.dataset.intro], i.textContent.trim()); return; }
    const g = e.target.closest("[data-guide]");
    if (g) window.MDFitGuides.open(g.dataset.guide);
  });

  // ================= Home
  function renderStats() {
    const s = stats || { streak: 0, bestStreak: 0, workouts: 0, hours: 0, week: Array(7).fill(false), todayIndex: (new Date().getDay() + 6) % 7 };
    $("#streak-n").textContent = s.streak;
    $("#best-n").textContent = s.bestStreak;
    $("#workouts-n").textContent = s.workouts;
    $("#hours-n").textContent = Number(s.hours).toFixed(1);
    $("#week").innerHTML = ["M", "T", "W", "T", "F", "S", "S"].map((d, i) =>
      `<li class="${s.week[i] ? "done" : ""} ${i === s.todayIndex ? "today" : ""}"><i aria-hidden="true"></i><span aria-label="${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]}${s.week[i] ? ", worked out" : ""}">${d}</span></li>`).join("");
  }

  // Today's workout: one per day from the client's last generator settings, kept until they change it
  // v3: no rest by default, no rest between rounds, warm-up / cool-down chosen after generating (older saved choices are dropped)
  const PREFS_KEY = "mdfit_prefs3", TODAY_KEY = "mdfit_today3";
  const saved = store.get(PREFS_KEY, {});
  const prefs = { ...Gen.DEFAULTS, ...saved, addons: { ...Gen.DEFAULTS.addons, ...(saved.addons || {}) } };
  const daySeed = (d) => [...d].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  // Free accounts get one generated workout ("Your free workout"); members generate freely. The server enforces it.
  let access = { member: true, freeUsed: false, freeLeft: null, reviewCode: null };
  const freeProgram = () => lib.programs.find((p) => p.free);
  const compactW = (w) => ({ title: w.title, goal: w.goal, goalId: w.goalId, location: w.location, level: w.level, levelLabel: w.levelLabel,
    rounds: w.rounds, restEx: w.restEx, restRound: w.restRound, minutes: w.minutes,
    warmup: w.warmup.map((e) => ({ id: e.id, sets: e.sets })), circuit: w.circuit.map((e) => ({ id: e.id, sets: e.sets })), cooldown: w.cooldown.map((e) => ({ id: e.id, sets: e.sets })) });
  // Resolves true when this workout may be used: members always; free accounts claim their one free workout
  async function claim(w) {
    if (access.member) return true;
    const fp = freeProgram();
    if (access.freeUsed) { if (fp && w && w.key === "program-" + fp.id) return true; showPaywall(); return false; }
    try {
      const r = await apiAuth("POST", "/api/me/generations", { workout: compactW(w) });
      if (r.member) { access.member = true; return true; }
      lib = r.library; access.freeUsed = true; access.freeLeft = 0; renderPrograms(); renderAccessBadge();
      toast("Saved as your free workout. Repeat it any time from My Programs.");
      return true;
    } catch (err) { if (/free workout/i.test(err.message)) { access.freeUsed = true; showPaywall(); } else toast(err.message); return false; }
  }
  function todaysWorkout() {
    if (!access.member && access.freeUsed && freeProgram()) return programWorkout(freeProgram());
    const t = todayInTz(), s = store.get(TODAY_KEY, null);
    if (s && s.date === t && s.workout && s.workout.circuit) return s.workout;
    const w = Gen.generate({ ...prefs, seed: daySeed(t + (client?.id || "")) });
    store.set(TODAY_KEY, { date: t, workout: w });
    return w;
  }
  const planLine = (w) => `${w.circuit.length} exercises × ${w.rounds} round${w.rounds === 1 ? "" : "s"}`;
  function renderToday() {
    const w = todaysWorkout();
    $("#today-title").textContent = w.title;
    $("#today-meta").textContent = `About ${w.minutes} min · ${planLine(w)} · ${w.levelLabel}`;
  }
  $("#start-today").addEventListener("click", async () => { const w = todaysWorkout(); if (await claim(w)) startPlayer(w); });
  // Short on time: the same goal, place and level as today's workout, cut to about 10 minutes (same one every time today)
  function tenMinuteWorkout() {
    const t = todayInTz();
    return Gen.generate({ ...prefs, length: 10, ...Gen.presetFor(10), restEx: 0, restRound: 0, seed: daySeed(t + (client?.id || "") + "-10") });
  }
  $("#start-ten").addEventListener("click", async () => { const w = tenMinuteWorkout(); if (await claim(w)) startPlayer(w); });

  function renderPlan() {
    const p = client.plan || { guides: [], exercises: [], notes: "" };
    const empty = !p.notes && !(p.exercises || []).length && !(p.guides || []).length;
    $("#plan-card").hidden = empty;
    if (empty) return;
    $("#plan-date").textContent = p.updatedAt ? "Updated " + shortDate(p.updatedAt.slice(0, 10)) : "";
    $("#plan").innerHTML = `
      ${p.notes ? `<p class="plan-notes">${esc(p.notes).replace(/\n/g, "<br>")}</p>` : ""}
      ${p.exercises.length ? `<ul class="plan-ex">${p.exercises.map((x) => `<li><b>${esc(x.name)}</b>${x.detail ? `<span>${esc(x.detail)}</span>` : ""}</li>`).join("")}</ul>` : ""}
      ${p.guides.length ? `<div class="guides">${p.guides.filter((g) => GUIDES[g]).map((g) => `
        <button type="button" class="guide" data-guide="${g}"><img src="assets/guides/${g}-thumb.webp" alt="" width="52" height="52" loading="lazy">
        <span><b>${esc(GUIDES[g])}</b><span>Open guide</span></span></button>`).join("")}</div>` : ""}`;
  }

  function ics(a) {
    const start = zonedToUtc(a.date, a.time), end = new Date(start.getTime() + a.minutes * 60e3);
    const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MD Fit//App//EN", "BEGIN:VEVENT", `UID:${a.id}@mdfit`,
      `DTSTAMP:${icsStamp(new Date())}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`, `SUMMARY:${a.typeName} · MD Fit`,
      `LOCATION:${ADDRESS.replace(/,/g, "\\,")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    return URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  }
  const dateBox = (d, tone = "") => `<div class="ev-date ${tone}"><small>${fmtDate(d, { month: "short" })}</small><b>${fmtDate(d, { day: "numeric" })}</b></div>`;
  const apptLi = (a, { cancel = false, cal = false } = {}) => `
    <li class="ev" data-appt="${a.id}">${dateBox(a.date, "gold")}
      <div class="ev-info"><b>${esc(a.typeName)}</b><span>${fmtDate(a.date, { weekday: "short" })} · ${fmtTime(a.time)} · ${a.minutes} min</span>
        ${cal ? `<span><a class="link-sm" href="${ics(a)}" download="mdfit-${a.date}.ics">Add to calendar</a></span>` : ""}
        ${a.meetingLink && a.status === "booked" && a.date >= todayInTz() ? `<span><a class="link-sm join-link" href="${esc(a.meetingLink)}" target="_blank" rel="noopener">Join video visit</a></span>` : ""}</div>
      ${cancel ? `<button type="button" class="ev-act danger" data-cancel>Cancel</button>` : `<span class="muted tiny">${esc(a.status === "booked" ? (a.date >= todayInTz() ? "booked" : "done") : a.status)}</span>`}
    </li>`;
  function renderEvents() {
    const mine = appts.upcoming.slice(0, 3).map((a) => apptLi(a));
    $("#events").innerHTML = mine.join("") ||
      `<li class="muted small">Nothing scheduled. <a class="link-sm" href="/book">Book a visit</a></li>`;
  }

  function renderActivity() {
    const items = [
      ...((stats && stats.recent) || []).map((w) => ({ at: w.completedAt, title: w.title, sub: `${w.minutes} min · ${w.exercises} exercises`, icon: "check" })),
      ...painLog.slice(-5).map((p) => ({ at: p.date + "T12:00:00", title: `Logged ${p.area.toLowerCase()} pain`, sub: `${p.level}/10${p.note ? " · " + p.note : ""}`, icon: "pain" })),
      ...appts.past.filter((a) => a.status !== "cancelled").slice(0, 3).map((a) => ({ at: a.date + "T" + a.time, title: a.typeName, sub: "Visit with Dr. Jared", icon: "visit" }))
    ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
    const ICON = {
      check: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
      pain: '<path d="M12 2a2 2 0 1 1-2 2 2 2 0 0 1 2-2zm-3 20v-7H7.5V9a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v6H15v7z"/>',
      visit: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14z"/>'
    };
    const ago = (iso) => {
      // A timestamp is UTC: convert it to the clinic's date, or a 9 PM workout shows as tomorrow
      const d = String(iso).length > 10 ? todayInTz(new Date(iso)) : String(iso), t = todayInTz();
      return d === t ? "Today" : d === addDays(t, -1) ? "Yesterday" : shortDate(d);
    };
    const html = items.map((x) => `<li class="act"><span class="check"><svg viewBox="0 0 24 24">${ICON[x.icon]}</svg></span>
      <div><b>${esc(x.title)}</b><span>${esc(x.sub)}</span></div><em>${ago(x.at)}</em></li>`).join("");
    $("#activity").innerHTML = html || `<li class="muted small">Finish your first workout and it shows up here.</li>`;
    $("#p-workouts").innerHTML = ((stats && stats.recent) || []).map((w) => `<li class="act"><span class="check"><svg viewBox="0 0 24 24">${ICON.check}</svg></span>
      <div><b>${esc(w.title)}</b><span>${w.minutes} min · ${w.exercises} exercises</span></div><em>${ago(w.completedAt)}</em></li>`).join("")
      || `<li class="muted small">No workouts logged yet.</li>`;
  }

  // Global Home search: ranks across every exercise, pain track, program, condition, treatment, guide and blog
  // post via the pre-built BM25 index. Opens the right destination on tap (video, program, pain track or page).
  const KIND_LABEL = { exercise: "Exercise", "pain-track": "Pain track", program: "Program", condition: "Condition", treatment: "Treatment", area: "Area", guide: "Guide", blog: "Article" };
  const KIND_ICON = { exercise: "▶", "pain-track": "⚡", program: "📋", condition: "🩺", treatment: "✚", area: "📍", guide: "📖", blog: "📰" };
  const qsIn = $("#qsearch"), qsOut = $("#qsearch-results"), qsClear = $("#qsearch-x");
  let qsT = 0;
  function qsRender(hits, q) {
    if (!hits.length) { qsOut.innerHTML = `<p class="qsearch-empty muted">Nothing matches "${esc(q)}". Try "knee pain", "golf" or "shoulder".</p>`; qsOut.hidden = false; return; }
    qsOut.innerHTML = hits.map((h) => `<a class="qsearch-row" data-url="${esc(h.url)}" data-id="${esc(h.id)}" href="${esc(h.url)}">
      <span class="qsearch-ic">${KIND_ICON[h.kind] || "•"}</span>
      <span class="qsearch-txt"><b>${window.MDFitSearch.highlight(esc(h.title), q)}</b><span>${esc(KIND_LABEL[h.kind] || h.kind)}${h.snippet ? " · " + window.MDFitSearch.highlight(esc(h.snippet), q) : ""}</span></span>
    </a>`).join("");
    qsOut.hidden = false;
  }
  // Personalization: favorites and the user's logged pain regions re-rank for them specifically.
  const personal = () => ({ favorites: new Set(lib.favorites || []), painRegions: [...new Set((painLog || []).map((p) => String(p.area || "").toLowerCase()))].slice(0, 6) });
  // Track last query and shown hits so we can log a "noclick" when the user abandons without picking anything.
  let qsLastQ = "", qsLastHits = [], qsClicked = false;
  qsIn && qsIn.addEventListener("input", () => {
    const q = qsIn.value.trim();
    qsClear.hidden = !q;
    clearTimeout(qsT);
    qsT = setTimeout(async () => {
      if (q.length < 2) { qsOut.hidden = true; return; }
      const r = await (window.MDFitSearch ? window.MDFitSearch.search(q, { limit: 12, personal: personal() }) : Promise.resolve({ hits: [] }));
      qsLastQ = q; qsLastHits = r.hits; qsClicked = false;
      qsRender(r.hits, q);
    }, 80);
  });
  qsClear && qsClear.addEventListener("click", () => { qsIn.value = ""; qsOut.hidden = true; qsClear.hidden = true; qsIn.focus(); });
  qsIn && qsIn.addEventListener("blur", () => setTimeout(() => {
    qsOut.hidden = true;
    // Log the no-click so the server knows this query didn't satisfy the user (zero-result signal).
    if (qsLastQ && !qsClicked && window.MDFitSearch) window.MDFitSearch.noClick(qsLastQ, qsLastHits.length);
    qsLastQ = "";
  }, 200));
  qsIn && qsIn.addEventListener("focus", () => { if (qsIn.value.trim().length > 1) qsOut.hidden = false; });
  qsOut && qsOut.addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]"); if (!row) return;
    e.preventDefault();
    const [kind, id] = row.dataset.id.split(":");
    // Log the click with position so CTR aggregation can re-rank for future queries.
    const pos = qsLastHits.findIndex((h) => h.id === row.dataset.id);
    if (qsLastQ && window.MDFitSearch) window.MDFitSearch.click(qsLastQ, row.dataset.id, Math.max(0, pos));
    qsClicked = true;
    qsOut.hidden = true; qsIn.value = "";
    // Exercises jump into the Videos tab and play; programs/pain tracks use hash routing; the rest are site URLs.
    if (kind === "ex") { const ex = EX.find((x) => x.id === id); if (ex) { show("videos"); setTimeout(() => playVideo(ex.id, ex.name, exMeta(ex)), 50); return; } }
    if (kind === "track") { location.hash = `pain/track/${id}`; return; }
    if (kind === "prog") { location.hash = `programs/${id}`; return; }
    if (row.dataset.url) location.href = row.dataset.url;
  });

  const agoMs = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  function renderNotes() {
    const t = todayInTz(), live = [];
    const soon = appts.upcoming.find((a) => a.status !== "cancelled" && a.date <= addDays(t, 2));
    if (soon) live.push({ kind: "visit", title: `Visit ${soon.date === t ? "today" : soon.date === addDays(t, 1) ? "tomorrow" : fmtDate(soon.date, { weekday: "long" })} at ${fmtTime(soon.time)}`, body: soon.typeName, action: "Details", go: "#profile" });
    const p = client.plan;
    if (p && p.updatedAt && p.updatedAt.slice(0, 10) >= addDays(t, -7)) {
      live.push({ kind: "plan", title: "Dr. Jared updated your plan", body: "See \u201cFrom Dr. Jared\u201d on Home.", action: "Open", go: "#home" });
      if (seenStore.get("plan-dot") !== p.updatedAt) { seenStore.set("plan-dot", p.updatedAt); dotFor("#home"); }
    }
    if (stats && stats.streak > 0 && !stats.week[stats.todayIndex]) live.push({ kind: "streak", title: `Keep your ${stats.streak}-day streak going`, body: "Do a workout today.", action: "Start", go: "#generate" });
    const icon = (k) => ({ reward: "🏆", level: "⭐", message: "💬", visit: "📅", plan: "📋", streak: "🔥" })[k] || "🔔";
    const row = (n, i, src) => `<div class="note-row${src === "h" && i < inbox.unseen ? " new" : ""}"><span class="notif-ic">${icon(n.kind)}</span><div class="note-txt"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ""}${n.at ? `<em>${agoMs(n.at)}</em>` : ""}</div>${n.go ? `<button type="button" class="note-go" data-go="${esc(n.go)}">${esc(n.action || "Open")}</button>` : ""}</div>`;
    const count = inbox.unseen + live.length;
    $("#bell .dot").hidden = true;
    const bc = $("#bell .bell-count"); bc.hidden = !count; bc.textContent = count > 9 ? "9+" : count;
    $("#notes").innerHTML = `<div class="notes-head"><b>Notifications</b>${inbox.items.length ? `<button type="button" class="link notes-clear">Clear</button>` : ""}</div>` +
      (live.length || inbox.items.length ? live.map((n, i) => row(n, i, "l")).join("") + inbox.items.map((n, i) => row(n, i, "h")).join("") : `<p class="muted notes-empty">You're all caught up.</p>`);
  }
  $("#bell").addEventListener("click", () => { const open = $("#notes").hidden; $("#notes").hidden = !open; if (open) { renderNotes(); inbox.unseen = 0; seenStore.set("inbox-unseen", 0); const bc = $("#bell .bell-count"); bc.hidden = true; } });
  $("#notes").addEventListener("click", (e) => {
    if (e.target.closest(".notes-clear")) { inbox.items = []; inbox.unseen = 0; saveInbox(); return; }
    const g = e.target.closest("[data-go]"); if (g) { $("#notes").hidden = true; location.hash = g.dataset.go; }
  });

  // ================= Generate: numbered steps, summary and add-ons (MD Fit generator design)
  const ICONS = {
    upper: '<path d="M12 2a3 3 0 1 1-3 3 3 3 0 0 1 3-3zM3 9h18v2h-6v11h-2v-6h-2v6H9V11H3z"/>',
    lower: '<path d="M9 2h6l1 9-1.5 11h-2L12 14l-.5 8h-2L8 11z"/>',
    full: '<path d="M12 2a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 12 2zM21 9h-6v13h-2v-6h-2v6H9V9H3V7h18z"/>',
    core: '<path d="M8 3h8v18H8zm2 2v3h4V5zm0 5v3h4v-3zm0 5v4h4v-4z"/>',
    mobility: '<path d="M13.5 5.5a2 2 0 1 0-2-2 2 2 0 0 0 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2a5.2 5.2 0 0 1-4.5-2.5l-1-1.6a2 2 0 0 0-1.7-1 2 2 0 0 0-.8.2L6 8.3V13h2V9.6z"/>',
    home: '<path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/>',
    gym: '<path d="M20.6 14.9 22 13.4 20.6 12l-3.6 3.6L8.4 7l3.6-3.6L10.6 2 9.1 3.4 7.7 2 5.6 4.1 4.1 2.6 2.7 4.1l1.4 1.4L2 7.7l1.4 1.4L2 10.6 3.4 12 7 8.4l8.6 8.6-3.6 3.6 1.4 1.4 1.4-1.4 1.4 1.4 2.1-2.1 1.5 1.4 1.4-1.4-1.4-1.4 2.1-2.1z"/>',
    outdoor: '<path d="M14 6 10.3 11l2.8 3.8-1.6 1.2C9.8 13.8 7 10 7 10l-6 8h22z"/>',
    office: '<path d="M20 18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H0v2h24v-2zM4 6h16v10H4z"/>'
  };
  const svgIc = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
  const bars = (n) => `<span class="bars-ic" aria-hidden="true">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? "on" : ""}" style="height:${6 + i * 6}px"></i>`).join("")}</span>`;
  const secs = (v) => (v ? `${v} sec` : "None");
  const choice = { ...prefs, restRound: 0, addons: { ...prefs.addons, warmup: false, cooldown: false } };
  // type "cards" = big tiles, "pills" = number chips. Each step reads/writes choice[key].
  const STEPS = [
    { key: "type", title: "Session type", sub: "Rehab sessions use only Dr. Jared's corrective movements, kept gentle. Workouts train strength and conditioning.", type: "cards", items: Gen.TYPES.map((t) => ({ v: t.id, html: `${svgIc(t.id === "rehab" ? "mobility" : "full")}<b>${esc(t.label)}</b><small>${esc(t.hint)}</small>` })) },
    { key: "goal", title: "Focus area", sub: "Choose the primary focus.", type: "cards", items: Gen.GOALS.map((g) => ({ v: g.id, html: `${svgIc(g.icon)}<b>${esc(g.label)}</b>` })) },
    { key: "location", title: "Location", sub: "Where will you be working out?", type: "cards", items: Gen.LOCATIONS.map((l) => ({ v: l.id, html: `${svgIc(l.icon)}<b>${esc(l.label)}</b>` })) },
    { key: "level", title: "Difficulty level", sub: "Match the workout to your current ability.", type: "cards", items: Gen.LEVELS.map((l) => ({ v: l.id, html: `${bars(l.bars)}<b>${l.label}</b><small>${l.hint}</small>` })) },
    { key: "length", title: "Workout length", sub: "Sets exercises, rounds and rest to fit. Fine-tune below.", type: "pills", items: Gen.LENGTHS.map((n) => ({ v: n, html: `<b>${n}</b><small>min</small>` })) },
    { key: "perRound", title: "Exercises per round", sub: "How many different exercises in each round?", type: "pills", items: Gen.PER_ROUND.map((n) => ({ v: n, html: `<b>${n}</b>` })) },
    { key: "rounds", title: "Rounds", sub: "How many total rounds? Pick 1 for one long round with high reps on every movement (reps scale with your level).", type: "pills", items: Gen.ROUNDS.map((n) => ({ v: n, html: n === 1 ? `<b>1</b><small>high reps</small>` : `<b>${n}</b>` })) },
    { key: "restEx", title: "Rest between exercises", sub: "None by default. Add rest if you need it.", type: "pills", items: Gen.REST_EX.map((n) => ({ v: n, html: n ? `<b>${n}</b><small>sec</small>` : `<b>None</b><small>0 sec</small>` })) }
  ];
  const stepHtml = (st, i) => `
    <section class="step" data-key="${st.key}">
      <div class="step-head"><span class="step-num">${i + 1}</span><div><h3>${st.title}</h3><p>${st.sub}</p></div></div>
      <div class="${st.type === "cards" ? "opt-cards" : "pills"}" role="radiogroup" aria-label="${esc(st.title)}">
        ${st.items.map((it) => `<button type="button" class="${st.type === "cards" ? "opt" : "pill"}" role="radio" data-v="${it.v}">${it.html}</button>`).join("")}
      </div>
    </section>`;
  // Steps 1, 4 full width; 2+3, 5+6, 7+8 pair up on wider screens
  $("#steps").innerHTML = [stepHtml(STEPS[0], 0), `<div class="step-pair">${stepHtml(STEPS[1], 1)}${stepHtml(STEPS[2], 2)}</div>`, stepHtml(STEPS[3], 3),
    `<div class="step-pair">${stepHtml(STEPS[4], 4)}${stepHtml(STEPS[5], 5)}</div>`, `<div class="step-pair">${stepHtml(STEPS[6], 6)}${stepHtml(STEPS[7], 7)}</div>`].join("");
  $("#addons").innerHTML = Gen.ADDONS.filter((a) => a.id !== "warmup" && a.id !== "cooldown").map((a) => `<li><button type="button" class="toggle" role="switch" data-addon="${a.id}"><span>${esc(a.label)}</span><i aria-hidden="true"></i></button></li>`).join("");

  function renderChoices() {
    $$("#steps .step").forEach((el) => $$("[data-v]", el).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v) === String(choice[el.dataset.key]))));
    $$("#addons [data-addon]").forEach((b) => b.setAttribute("aria-checked", String(!!choice.addons[b.dataset.addon])));
    const G = Gen.GOALS.find((g) => g.id === choice.goal), Lo = Gen.LOCATIONS.find((l) => l.id === choice.location), Lv = Gen.LEVELS.find((l) => l.id === choice.level);
    const oneRound = choice.rounds === 1 && choice.type !== "rehab" && !G.mobility;
    const est = oneRound ? choice.length : Gen.estimate({ ...choice, warm: 0, cool: 0, restRound: 0 });
    const rows = [["Type", G.label], ["Location", Lo.label], ["Difficulty", Lv.label], ["Estimated time", `${est} min`, "est"],
      ["Exercises per round", choice.perRound], ["Total rounds", oneRound ? "1 · high reps" : choice.rounds], ["Rest between exercises", secs(choice.restEx)]];
    $("#summary").innerHTML = rows.map(([k, v, c]) => `<dt>${k}</dt><dd${c ? ` class="${c}"` : ""}>${esc(v)}</dd>`).join("");
  }
  // Keep the estimate close to the chosen workout length. If the user picks fewer rounds (or fewer exercises
  // per round) than the preset, bump the other knob up so a 30-minute workout stays about 30 minutes.
  const fitLength = () => {
    if (choice.rounds === 1) return; // one round: the reps grow to fill the length instead
    const target = choice.length * 60;
    const estAt = (perRound, rounds) => rounds * (perRound * 45 + Math.max(0, perRound - 1) * choice.restEx);
    const MAX_PR = Math.max(...Gen.PER_ROUND), MAX_R = Math.max(...Gen.ROUNDS);
    while (estAt(choice.perRound, choice.rounds) < target * 0.9 && choice.perRound < MAX_PR) choice.perRound = Gen.PER_ROUND.find((n) => n > choice.perRound) || MAX_PR;
    while (estAt(choice.perRound, choice.rounds) < target * 0.9 && choice.rounds < MAX_R) choice.rounds = Gen.ROUNDS.find((n) => n > choice.rounds) || MAX_R;
  };
  $("#steps").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    const key = b.closest(".step").dataset.key, num = ["length", "perRound", "rounds", "restEx"].includes(key);
    choice[key] = num ? Number(b.dataset.v) : b.dataset.v;
    // A new length picks exercises and rounds to fit it, with no rest (members add rest themselves)
    if (key === "length") { const keepOne = choice.rounds === 1; Object.assign(choice, Gen.presetFor(choice.length), { restEx: 0, restRound: 0 }); if (keepOne) choice.rounds = 1; fitLength(); }
    if (["rounds", "perRound", "restEx"].includes(key)) fitLength();
    renderChoices();
  });
  $("#addons").addEventListener("click", (e) => {
    const b = e.target.closest("[data-addon]");
    if (!b) return;
    choice.addons[b.dataset.addon] = !choice.addons[b.dataset.addon];
    renderChoices();
  });
  $("#randomize").addEventListener("click", () => {
    const any = (arr) => arr[Math.floor(Math.random() * arr.length)];
    choice.goal = any(Gen.GOALS).id; choice.location = any(Gen.LOCATIONS).id; choice.level = any(Gen.LEVELS).id;
    choice.length = any(Gen.LENGTHS); Object.assign(choice, Gen.presetFor(choice.length), { restEx: 0, restRound: 0 }); fitLength();
    renderChoices();
  });

  let current = null;
  const exLi = (e) => `<li><button type="button" class="ex" data-video="${e.id}">${thumbImg(e.id)}
    <span><b>${esc(e.name)}</b><span><span class="sets">${esc(e.sets)}</span> · ${esc(e.region)} · ${esc(e.cat)}</span></span></button></li>`;
  function renderGenerated() {
    const w = current, loc = Gen.LOCATIONS.find((l) => l.id === w.location);
    $("#generated").hidden = false;
    $("#gen-title").textContent = w.title;
    const ex = w.extraMin || { warmup: 0, cooldown: 0 }, on = (k) => !!(w.addons && w.addons[k]) && (w[k + "Opt"] || []).length;
    const extra = (on("warmup") ? ex.warmup : 0) + (on("cooldown") ? ex.cooldown : 0);
    $("#gen-meta").textContent = `About ${w.minutes} min${extra ? ` (+${extra} min ${on("warmup") && on("cooldown") ? "warm-up & cool-down" : on("warmup") ? "warm-up" : "cool-down"})` : ""} · ${w.chipper ? "1 round · high reps" : planLine(w)} · ${w.levelLabel} · ${loc ? loc.label : ""}. Tap any exercise to watch Dr. Jared demo it.${w.note ? " " + w.note : ""}`;
    const swapLi = (block) => (e, i) => `<li class="ex-swap">${exLi(e).slice(4, -5)}<button type="button" class="swap-btn" data-swap="${block}" data-i="${i}" aria-label="Swap ${esc(e.name)} for another movement" title="Swap for another movement"><svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3 1.4-1.4L22 8l-5.6 5.4L15 12l3-3H7zm10 10H6l3 3-1.4 1.4L2 16l5.6-5.4L9 12l-3 3h11z"/></svg></button></li>`;
    const group = (label, list, block, note = "") => list.length ? `<li class="block-tag">${label}${note ? `<span>${note}</span>` : ""}</li>${list.map(swapLi(block)).join("")}` : "";
    $("#gen-list").innerHTML = group("Warm-up · plays first", w.warmup, "Warm-up")
      + group(w.chipper ? "One round · high reps · finish every rep" : `Circuit × ${w.rounds} round${w.rounds === 1 ? "" : "s"}`, w.circuit, "Circuit", [w.restEx && `${w.restEx}s between exercises`, w.restRound && w.rounds > 1 && `${w.restRound}s between rounds`].filter(Boolean).join(" · "))
      + group("Cool-down · plays last", w.cooldown, "Cool-down");
    // Optional extras, not part of the workout's length
    $("#gen-extras").hidden = !(w.warmupOpt || []).length && !(w.cooldownOpt || []).length;
    $("#gen-extras").innerHTML = `<p class="gx-title">Add to your workout</p>${["warmup", "cooldown"].filter((k) => (w[k + "Opt"] || []).length).map((k) => `
      <button type="button" class="gx-btn" role="switch" aria-checked="${!!on(k)}" data-extra="${k}">
        <span class="gx-check" aria-hidden="true"></span>
        <span class="gx-txt"><b>${k === "warmup" ? "Warm-up" : "Cool-down"}</b><small>+${ex[k]} min · ${(w[k + "Opt"] || []).map((e) => esc(e.name)).join(", ")}</small></span>
        <span class="gx-rec">Recommended</span></button>`).join("")}`;
  }
  function generateNow(seed = Date.now(), manual = true) {
    if (manual) earn("generate");
    current = Gen.generate({ ...choice, restRound: 0, seed });
    Object.assign(prefs, choice, { restRound: 0, addons: { ...choice.addons, warmup: false, cooldown: false } });
    store.set(PREFS_KEY, prefs);
    // This becomes today's workout on Home too
    store.set(TODAY_KEY, { date: todayInTz(), workout: current });
    renderToday();
    renderGenerated();
  }
  $("#generate").addEventListener("click", () => {
    if (!access.member && access.freeUsed) return showPaywall();
    generateNow(); $("#generated").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#shuffle").addEventListener("click", () => (!access.member && access.freeUsed ? showPaywall() : generateNow()));
  // Swap one movement for a random alternative that fits the same slot
  $("#gen-list").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-swap]"); if (!b || !current) return;
    ev.stopPropagation();
    const before = current;
    current = Gen.swap(current, b.dataset.swap, Number(b.dataset.i), Date.now());
    if (current === before) return toast("No other movement fits that slot.");
    store.set(TODAY_KEY, { date: todayInTz(), workout: current });
    renderToday(); renderGenerated();
    const li = $$(`#gen-list [data-swap="${b.dataset.swap}"]`)[Number(b.dataset.i)];
    if (li) li.closest("li").classList.add("swapped");
  });
  // Switch the warm-up / cool-down on or off for this workout (it is not remembered: every workout starts without them)
  $("#gen-extras").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-extra]"); if (!b || !current) return;
    const k = b.dataset.extra, onNow = !(current.addons && current.addons[k]);
    current = { ...current, addons: { ...current.addons, [k]: onNow } };
    if (k === "warmup") current.warmup = [...(onNow ? current.warmupOpt : []), ...(current.prep || [])];
    else current.cooldown = onNow ? current.cooldownOpt : [];
    current.exercises = [...current.warmup, ...current.circuit, ...current.cooldown];
    store.set(TODAY_KEY, { date: todayInTz(), workout: current });
    renderToday(); renderGenerated();
  });
  $("#start-gen").addEventListener("click", async () => { if (current && await claim(current)) startPlayer(current); });
  fitLength(); // with no rest, the starting exercises and rounds are stretched to fill the chosen length
  renderChoices();

  // ---- My programs: saved workouts, kept on the account
  const compact = (arr) => arr.map((e) => ({ id: e.id, sets: e.sets }));
  const expand = (arr, block) => arr.map((x) => byId.get(x.id) && { ...byId.get(x.id), sets: x.sets, block }).filter(Boolean);
  const REHAB_CATS = new Set(["Rehabilitation", "Mobility"]);
  function programWorkout(p) {
    const w = p.workout, warmup = expand(w.warmup, "Warm-up"), circuit = expand(w.circuit, "Circuit"), cooldown = expand(w.cooldown, "Cool-down");
    return { ...w, key: "program-" + p.id, title: p.name, warmup, circuit, cooldown, exercises: [...warmup, ...circuit, ...cooldown], perRound: circuit.length, noRest: REHAB_CATS.has(p.category) };
  }
  const programLi = (p, del) => {
    const w = p.workout;
    return `<li class="program" data-program="${p.id}"><span class="pg-ic"><svg viewBox="0 0 24 24"><path d="M15 6H3v2h12zm0 4H3v2h12zM3 16h8v-2H3zM17 6v8.2A3 3 0 1 0 19 17V8h3V6z"/></svg></span>
      <div><b>${esc(p.name)}</b><span>${esc(w.goal)} · ${w.circuit.length} × ${w.rounds} rounds · about ${w.minutes} min</span></div>
      <button type="button" class="ev-act" data-play>Start</button>${del ? `<button type="button" class="icon-btn pg-del" data-del-program aria-label="Delete ${esc(p.name)}"><svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg></button>` : ""}</li>`;
  };
  function renderPrograms() {
    const ps = lib.programs;
    $("#my-programs").hidden = !ps.length;
    $("#program-count").textContent = ps.length ? `${ps.length} saved` : "";
    $("#program-list").innerHTML = ps.map((p) => programLi(p, true)).join("");
    $("#home-programs").hidden = !ps.length;
    $("#home-program-list").innerHTML = ps.slice(0, 3).map((p) => programLi(p, false)).join("");
  }
  document.addEventListener("click", async (e) => {
    const li = e.target.closest("[data-program]");
    if (!li) return;
    const p = lib.programs.find((x) => x.id === li.dataset.program);
    if (!p) return;
    if (e.target.closest("[data-play]")) return startPlayer(programWorkout(p));
    if (e.target.closest("[data-del-program]") && confirm(`Delete "${p.name}" from My Programs?`)) {
      try { lib = await apiAuth("DELETE", `/api/me/programs/${p.id}`); renderPrograms(); } catch (err) { toast(err.message); }
    }
  });
  $("#save-program").addEventListener("click", async () => {
    if (!current) return;
    if (!access.member) return showPaywall("Saving custom plans is part of membership.");
    const name = prompt("Name this program", current.title);
    if (!name || !name.trim()) return;
    const w = current;
    try {
      earn("program"); lib = await apiAuth("POST", "/api/me/programs", { name: name.trim().slice(0, 60), workout: {
        title: w.title, goal: w.goal, goalId: w.goalId, location: w.location, level: w.level, levelLabel: w.levelLabel,
        rounds: w.rounds, restEx: w.restEx, restRound: w.restRound, minutes: w.minutes,
        warmup: compact(w.warmup), circuit: compact(w.circuit), cooldown: compact(w.cooldown) } });
      renderPrograms(); toast(`Saved "${name.trim()}" to My Programs.`);
    } catch (err) { toast(err.message); }
  });

  // ================= Videos: by location first, then Dr. Jared's categories, grouped by primary joint or muscle
  const LIB = window.MDFitLib;
  const TRACK_IDS = new Set(((window.MDFitTracks || {}).TRACKS || []).flatMap((t) => t.levels.flatMap((l) => l.videos.map((v) => v.id))).filter(Boolean));
  const CATS = ["All", "♥ Favorites", ...LIB.CATEGORIES];
  EX.forEach((e) => { e.libCat = LIB.category(e); e.joint = LIB.joint(e); e.muscle = LIB.muscle(e); });
  const LOCS = [{ id: "", label: "Everywhere" }, ...Gen.LOCATIONS.map((l) => ({ id: l.id, label: l.label }))];
  const locIds = Object.fromEntries(Gen.LOCATIONS.map((l) => [l.id, new Set(Gen.byLocation(l.id).map((e) => e.id))]));
  const vf = { q: "", cat: "All", region: "", loc: "", by: "joint", kind: "Exercise" };
  EX.forEach((e) => { e.kind = LIB.kind(e); });
  const catsFor = () => ["All", "♥ Favorites", ...(vf.kind === "All" ? LIB.CATEGORIES : LIB.CAT_BY_KIND[vf.kind])];
  function renderCats() { $("#vid-cats").innerHTML = catsFor().map((c) => `<button type="button" class="chip" role="tab" data-cat="${esc(c)}" aria-selected="${c === vf.cat}">${esc(c)}</button>`).join(""); }
  $("#vid-kind").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]"); if (!b) return;
    vf.kind = b.dataset.kind; vf.cat = "All"; $$("#vid-kind button").forEach((x) => x.setAttribute("aria-selected", x === b));
    $("#vid-kind-note").textContent = KIND_NOTE[vf.kind]; renderCats(); renderVideos();
  });
  const KIND_NOTE = { Exercise: "Strength training and specialty movements for building fitness.", Rehab: "Dr. Jared's corrective work: rehabilitation, stretching and mobility. Keep pain at 3/10 or lower.", All: "Every video in the library." };
  $("#vid-locs").innerHTML = LOCS.map((l) => `<button type="button" role="tab" data-loc="${l.id}" aria-selected="${l.id === ""}">${esc(l.label)}</button>`).join("");
  $("#vid-locs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-loc]"); if (!b) return;
    vf.loc = b.dataset.loc; $$("#vid-locs button").forEach((x) => x.setAttribute("aria-selected", x === b)); renderVideos();
  });
  const groupsFor = () => (vf.by === "joint" ? LIB.JOINTS : LIB.MUSCLES);
  function fillJump() { $("#vid-region").innerHTML = `<option value="">All ${vf.by === "joint" ? "joints" : "muscles"}</option>` + groupsFor().map((r) => `<option>${esc(r)}</option>`).join(""); }
  fillJump();
  $("#vid-by").addEventListener("click", (e) => {
    const b = e.target.closest("[data-by]"); if (!b) return;
    vf.by = b.dataset.by; vf.region = ""; $$("#vid-by button").forEach((x) => x.setAttribute("aria-selected", x === b)); fillJump(); renderVideos();
  });
  $("#vid-count").textContent = EX.length;
  $("#lib-count").textContent = `${EX.length} exercises`;
  renderCats();
  $("#vid-cats").addEventListener("click", (e) => {
    const c = e.target.closest("[data-cat]");
    if (!c) return;
    vf.cat = c.dataset.cat;
    $$("#vid-cats .chip").forEach((x) => x.setAttribute("aria-selected", x === c));
    renderVideos();
  });
  $("#vid-region").addEventListener("change", (e) => { vf.region = e.target.value; renderVideos(); });
  // Debounce the keystrokes: 60 ms is below the human notice threshold but spares us re-rendering on every tap.
  let vqT = 0, vqRank = null;
  $("#vid-search").addEventListener("input", (e) => {
    const q = e.target.value.trim();
    vf.q = q.toLowerCase();
    clearTimeout(vqT);
    vqT = setTimeout(async () => {
      // Rank by relevance only when the query has 2+ characters; otherwise just filter+sort as before.
      vqRank = null;
      if (q.length > 1 && window.MDFitSearch) {
        const { hits } = await MDFitSearch.search(q, { kinds: ["exercise"], limit: 200, personal: personal() });
        vqRank = new Map(hits.map((h, i) => [h.id.slice(3), i])); // id -> rank order
      }
      renderVideos();
    }, 60);
  });
  const isFav = (id) => lib.favorites.includes(id);
  const heart = (id) => `<button type="button" class="heart" data-fav="${id}" aria-pressed="${isFav(id)}" aria-label="${isFav(id) ? "Remove from" : "Add to"} favorites"><svg viewBox="0 0 24 24"><path d="M12 21 10.6 19.7C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z"/></svg></button>`;
  const vcard = (e) => `<div class="vwrap"><button type="button" class="vcard" data-video="${e.id}">${thumbImg(e.id)}<div><b>${esc(e.name)}</b><span>${esc(e.libCat)} · L${e.level}${TRACK_IDS.has(e.id) ? ` · <i class="in-track">Pain track</i>` : ""}</span></div></button>${heart(e.id)}</div>`;
  // Favorites live on the account (not the phone), so they follow the client to any device
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-fav]");
    if (!b) return;
    const id = b.dataset.fav, on = !isFav(id);
    lib.favorites = on ? [id, ...lib.favorites] : lib.favorites.filter((x) => x !== id);
    $$(`[data-fav="${id}"]`).forEach((x) => { x.setAttribute("aria-pressed", on); x.setAttribute("aria-label", `${on ? "Remove from" : "Add to"} favorites`); });
    if (vf.cat === "♥ Favorites") renderVideos();
    try { lib = await apiAuth(on ? "PUT" : "DELETE", `/api/me/favorites/${encodeURIComponent(id)}`); if (on) { toast("Saved to your favorites."); earn("favorite", id); } }
    catch (err) { toast(err.message); }
  });
  function renderVideos() {
    const key = vf.by;
    let list = EX.filter((e) => (vf.kind === "All" || e.kind === vf.kind) && (vf.cat === "All" || (vf.cat === "♥ Favorites" ? isFav(e.id) : e.libCat === vf.cat)) && (!vf.region || e[key] === vf.region)
      && (!vf.loc || locIds[vf.loc].has(e.id))
      && (!vf.q || (vqRank ? vqRank.has(e.id) : [e.name, e.region, e.cat, e.libCat, e.joint, e.muscle].join(" ").toLowerCase().includes(vf.q))));
    // Ranked results come back ordered by relevance; otherwise sort by level then name as before.
    list.sort(vqRank ? (a, b) => (vqRank.get(a.id) ?? 999) - (vqRank.get(b.id) ?? 999) : (a, b) => a.level - b.level || a.name.localeCompare(b.name));
    $("#vgrid").innerHTML = groupsFor().map((g) => {
      const xs = list.filter((e) => e[key] === g);
      return xs.length ? `<section class="vgroup"><h3>${esc(g)} <span>${xs.length}</span></h3><div class="vgrid-in">${xs.map(vcard).join("")}</div></section>` : "";
    }).join("");
    observeCards($("#vgrid"));
    $("#vid-empty").hidden = list.length > 0;
    $("#vid-empty").textContent = vf.cat === "♥ Favorites" && !lib.favorites.length ? "Tap the heart on any video to save it here." : "No exercises match. Try another filter.";
  }

  // ================= Pain tool
  // Body areas; painmuscles.js holds the precise spots and the muscles for each area id.
  const PAIN = {
    front: [
      { id: "head", label: "Head", sub: "Forehead, temples", area: "Neck" },
      { id: "neck", label: "Neck", sub: "Front and sides", area: "Neck" },
      { id: "shoulder", label: "Shoulder", sub: "Front and outside", area: "Shoulder" },
      { id: "chest", label: "Chest & ribs", sub: "Front of rib cage", area: "Other" },
      { id: "elbow", label: "Elbow", sub: "Forearm", area: "Elbow / wrist / hand" },
      { id: "wrist", label: "Wrist & hand", sub: "Fingers, thumb", area: "Elbow / wrist / hand" },
      { id: "hip", label: "Hip & groin", sub: "Front of hip", area: "Hip" },
      { id: "thigh", label: "Thigh", sub: "Quads", area: "Hip" },
      { id: "knee", label: "Knee", sub: "Kneecap, shin", area: "Knee" },
      { id: "ankle", label: "Ankle & foot", sub: "Arch, inner ankle", area: "Ankle / foot" }
    ],
    back: [
      { id: "head-b", label: "Back of head", sub: "Base of skull", area: "Neck" },
      { id: "neck-b", label: "Neck & traps", sub: "Upper traps", area: "Neck" },
      { id: "upper-back", label: "Upper back", sub: "Between shoulder blades", area: "Upper back" },
      { id: "shoulder-b", label: "Shoulder blade", sub: "Back of shoulder", area: "Shoulder" },
      { id: "low-back", label: "Low back", sub: "Lumbar spine", area: "Lower back" },
      { id: "glute", label: "Glutes", sub: "Buttock, outer hip", area: "Hip" },
      { id: "hamstring", label: "Hamstring", sub: "Back of thigh", area: "Hip" },
      { id: "calf", label: "Calf", sub: "Lower leg", area: "Ankle / foot" },
      { id: "heel", label: "Heel & Achilles", sub: "Back of ankle", area: "Ankle / foot" }
    ]
  };
  const ALL_PAIN = [...PAIN.front, ...PAIN.back];
  let side = "front";
  const picked = new Set();
  const personSvg = '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 1 1-2 2 2 2 0 0 1 2-2zm-3 20v-7H7.5V9a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v6H15v7z"/></svg>';
  // Step 1: areas. Step 2: where exactly + what makes it worse. Step 3: ranked muscles (painmuscles.js).
  const MUS = window.MDFitMuscles;
  const spotsPicked = new Set(), aggrPicked = new Set();
  function renderAreas() {
    const _a = $("#areas"); if (!_a) return;
    _a.innerHTML = PAIN[side].map((a) => `<button type="button" class="area" data-area="${a.id}" aria-pressed="${picked.has(a.id)}">
      <span class="aic">${personSvg}</span><span><b>${esc(a.label)}</b><small>${esc(a.sub)}</small></span><span class="radio" aria-hidden="true"></span></button>`).join("");
    const n = picked.size, _pg = $("#pain-go");
    if (_pg) { _pg.disabled = !n; _pg.textContent = n ? "Find the muscles" : "Select an area"; }
    renderRefine();
  }
  const spotKeys = () => ALL_PAIN.filter((a) => picked.has(a.id)).flatMap((a) => {
    const mine = [...spotsPicked].filter((k) => k.startsWith(a.id + "|"));
    return mine.length ? mine : (MUS.SPOTS[a.id] || []).map((s) => `${a.id}|${s[0]}`);
  });
  function renderRefine() {
    const _pr = $("#pain-refine"); if (!_pr) return;
    const areas = ALL_PAIN.filter((a) => picked.has(a.id));
    if (!areas.length) { _pr.innerHTML = ""; return; }
    // Only offer aggravators that matter for the muscles in play
    const tags = [...new Set(MUS.rank(spotKeys()).flatMap((m) => m.worse))];
    _pr.innerHTML = `<div class="card refine">
      <p class="label accent">Narrow it down</p>
      ${areas.map((a) => `<div class="refine-row"><b>${esc(a.label)}: where exactly?</b><div class="pills">${(MUS.SPOTS[a.id] || []).map(([l]) => {
        const k = `${a.id}|${l}`;
        return `<button type="button" class="pill" role="checkbox" data-spot="${esc(k)}" aria-checked="${spotsPicked.has(k)}"><b>${esc(l)}</b></button>`;
      }).join("")}</div></div>`).join("")}
      <div class="refine-row"><b>What makes it worse?</b><div class="pills">${tags.map((t) => `<button type="button" class="pill" role="checkbox" data-aggr="${t}" aria-checked="${aggrPicked.has(t)}"><b>${esc(MUS.AGGRAVATORS[t])}</b></button>`).join("")}</div></div>
      <p class="muted tiny">Optional. Pick any that fit and the list sorts the most likely muscles first.</p></div>`;
  }
  $$(".seg [data-side]").forEach((b) => b.addEventListener("click", () => {
    side = b.dataset.side;
    $$(".seg [data-side]").forEach((x) => x.setAttribute("aria-selected", x === b));
    renderAreas();
  }));
  const _areas = $("#areas");
  if (_areas) _areas.addEventListener("click", (e) => {
    const b = e.target.closest("[data-area]");
    if (!b) return;
    const id = b.dataset.area;
    if (picked.has(id)) { picked.delete(id); [...spotsPicked].forEach((k) => k.startsWith(id + "|") && spotsPicked.delete(k)); } else picked.add(id);
    renderAreas();
  });
  const _refine = $("#pain-refine");
  if (_refine) _refine.addEventListener("click", (e) => {
    const s = e.target.closest("[data-spot]"), g = e.target.closest("[data-aggr]");
    if (s) spotsPicked.has(s.dataset.spot) ? spotsPicked.delete(s.dataset.spot) : spotsPicked.add(s.dataset.spot);
    else if (g) aggrPicked.has(g.dataset.aggr) ? aggrPicked.delete(g.dataset.aggr) : aggrPicked.add(g.dataset.aggr);
    else return;
    renderRefine();
  });
  const byName = new Map(EX.map((e) => [e.name, e]));
  const muscleCard = (m, i) => `
    <article class="card muscle ${i ? "" : "top"}" data-muscle="${m.id}">
      <div class="mc-head"><span class="mc-rank">${i + 1}</span><div><span class="label accent">${i === 0 ? "Most likely" : i < 3 ? "Also likely" : "Also check"}</span><h3>${esc(m.name)}</h3></div></div>
      <p class="mc-why">Matches ${esc(m.spots.join(", ").toLowerCase())}${m.matches.length ? ` · worse with ${esc(m.matches.map((t) => MUS.AGGRAVATORS[t].toLowerCase()).join(", "))}` : ""}</p>
      <p class="mc-ref"><b>Where it sends pain</b>${esc(m.refers)}</p>
      <p class="mc-does"><b>What it does</b>${esc(m.does)}</p>
      <button type="button" class="btn-blue sm mc-report" data-report="${m.id}">Full muscle report &amp; protocol</button>
      <p class="label">Relief videos from Dr. Jared</p>
      <div class="mini-vids">${m.videos.map((n) => byName.get(n)).filter(Boolean).map(vcard).join("")}</div>
      ${m.guide && GUIDES[m.guide] ? `<div class="guides"><button type="button" class="guide" data-guide="${m.guide}"><img src="assets/guides/${m.guide}-thumb.webp" alt="" width="52" height="52" loading="lazy"><span><b>${esc(GUIDES[m.guide])}</b><span>Open Dr. Jared's guide</span></span></button></div>` : ""}
    </article>`;
  const _painGo = $("#pain-go");
  if (_painGo) _painGo.addEventListener("click", () => {
    const areas = ALL_PAIN.filter((a) => picked.has(a.id));
    const list = MUS.rank(spotKeys(), [...aggrPicked]);
    const chosen = [...spotsPicked].map((k) => k.split("|")[1]);
    const logAreas = [...new Set(areas.map((a) => a.area))];
    $("#pain-results").innerHTML = `
      <div class="card result-sum">
        <span class="label accent">Your muscle map</span>
        <h3>${list.length} muscles can send pain to ${esc(areas.map((a) => a.label.toLowerCase()).join(" and "))}</h3>
        <p class="muted small">${chosen.length ? `You picked: ${esc(chosen.join(", "))}. ` : ""}Most likely first. Try the relief videos for the top one or two for a week and log how it feels.</p>
        <div class="log-row"><label>Pain now: <output>5</output>/10<input type="range" min="0" max="10" value="5" aria-label="Pain level"></label>
          ${logAreas.length > 1 ? `<select class="select sm" aria-label="Area">${logAreas.map((x) => `<option>${esc(x)}</option>`).join("")}</select>` : ""}
          <button type="button" class="btn-gold sm" data-log="${esc(logAreas[0])}">Log it</button></div>
      </div>
      ${list.slice(0, 5).map(muscleCard).join("")}
      ${list.length > 5 ? `<details class="more-muscles"><summary>Show ${list.length - 5} more muscles</summary>${list.slice(5).map((m, i) => muscleCard(m, i + 5)).join("")}</details>` : ""}
      <div class="card"><div class="row"><a class="btn-blue sm" href="/book">Book an evaluation</a><button type="button" class="btn-ghost sm" data-goto="videos">More videos</button></div>
      <p class="muted tiny center" style="margin:12px 0 0">Educational only, not a diagnosis. Sudden, severe or worsening pain, chest pain, numbness or weakness needs prompt medical care.</p></div>`;
    $("#pain-results").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const _painResults = $("#pain-results");
  if (_painResults) _painResults.addEventListener("input", (e) => { if (e.target.type === "range") e.target.closest(".log-row").querySelector("output").textContent = e.target.value; });
  if (_painResults) _painResults.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-log]");
    if (!b) return;
    const row = b.closest(".log-row"), sel = $("select", row);
    const top = $(".muscle h3", $("#pain-results"));
    b.disabled = true;
    try {
      await apiAuth("POST", "/api/me/pain", { area: sel ? sel.value : b.dataset.log, level: Number($("input", row).value),
        note: [...spotsPicked].map((k) => k.split("|")[1]).join(", ").slice(0, 300) || (top ? `Top match: ${top.textContent}` : "") });
      await loadPain();
      b.textContent = "Logged"; toast("Saved to your pain tracker.");
      loadRewards(true);
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  // ---- Pick a muscle: full report (anatomy, self-check, look-alikes, red flags, 3-phase protocol) from musclereports.js
  const REPORTS = window.MDFIT_MUSCLE_REPORTS || {};
  const TK = window.MDFitTracks;
  // Pain tracks (Dr. Jared's mapping documents): open goes straight to the videos; Start runs them in order in the player
  const trackWorkout = (t) => {
    const ex = TK.steps(t).filter((v) => v.id).map((v) => ({ ...(byId.get(v.id) || { id: v.id, region: t.region, cat: "Rehab", level: 1, loc: "any" }), name: v.name, sets: "Follow the video", block: v.level.split(" · ")[0] }));
    return { title: `${t.title.split(" →")[0]} pain track`.slice(0, 80), key: `track-${String(t.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60)}`, goal: "Mobility & Recovery", goalId: "mobility", location: "home", level: "beginner", levelLabel: "Pain track",
      rounds: 1, restEx: 0, restRound: 0, minutes: Math.max(5, ex.length * 3), warmup: [], circuit: ex, cooldown: [], exercises: ex, perRound: ex.length, noRest: true };
  };
  function openTrack(id) { TK.ready.then(() => { const t = TK.TRACKS.find((x) => x.id === id); if (t) startPlayer(trackWorkout(t)); }); }
  document.addEventListener("click", (e) => { const c = e.target.closest("[data-track]"); if (c && !e.target.closest(".pm-sheet")) openTrack(c.dataset.track); });
  const GROUPS = [
    ["Head & jaw", ["suboccipitals", "occipitalis", "splenius", "temporalis", "masseter", "scm"]],
    ["Neck", ["upper-trap", "levator", "scalenes"]],
    ["Shoulder: deltoid & rotator cuff", ["ant-delt", "lat-delt", "post-delt", "supraspinatus", "infraspinatus", "teres-minor", "subscapularis", "teres-major"]],
    ["Shoulder: chest side", ["pec-major-clav", "pec-major-stern", "pec-minor", "subclavius", "coracobrachialis", "serratus"]],
    ["Shoulder: blade & upper back", ["middle-trap", "lower-trap", "rhomboid-minor", "rhomboid-major", "lats"]],
    ["Upper arm", ["biceps-long", "biceps-short", "triceps-long", "triceps-lateral", "triceps-medial"]],
    ["Elbow, wrist & hand", ["wrist-ext", "finger-ext", "wrist-flex", "finger-flex", "brachioradialis", "supinator"]],
    ["Ribs & abdomen", ["intercostals", "ext-oblique"]],
    ["Low back & core", ["ql", "iliocostalis", "longissimus", "multifidus", "psoas"]],
    ["Hip & glutes", ["iliacus", "glute-med", "glute-min", "piriformis", "glute-max", "tfl", "adductor-longus", "adductor-magnus"]],
    ["Thigh & knee", ["rectus-femoris", "vastus-intermedius", "vmo", "vastus-lateralis", "biceps-femoris", "medial-hamstrings", "popliteus"]],
    ["Lower leg & foot", ["gastroc", "soleus", "tib-post", "tib-ant", "peroneals", "foot-intrinsics"]]
  ];

  function setMode(mode) {
    $$(".mode-seg [data-mode]").forEach((b) => b.setAttribute("aria-selected", b.dataset.mode === mode));
    const _ma = $("#mode-area"); if (_ma) _ma.hidden = mode !== "area";
    const _mm = $("#mode-muscle"); if (_mm) _mm.hidden = mode !== "muscle";
    $("#muscle-report").hidden = true;
    if (mode === "muscle" && _mm) { renderMap(); renderMuscleList(); }
  }
  $$(".mode-seg [data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  const painSec = $("#pain-secondary");
  if (painSec) painSec.addEventListener("toggle", () => { if (painSec.open && !show.muscleMap) { show.muscleMap = true; renderMap(); renderMuscleList(); } });
  // Tap the muscle on Dr. Jared's anatomy figure (zoomed crops from painmuscles.js MAPS)
  let mapView = "body-front", mapPick = null;
  function renderMap() {
    const _mm = $("#muscle-map"); if (!_mm) return;
    const mp = MUS.MAPS[mapView], [x, y, w, h] = mp.box;
    _mm.innerHTML = `
      <div class="map-tabs">${Object.entries(MUS.MAPS).map(([k, v]) => `<button type="button" class="chip" data-map="${k}" aria-selected="${k === mapView}">${esc(v.label)}</button>`).join("")}</div>
      <div class="map-stage ${mapView.startsWith("body") ? "dense" : ""}" style="aspect-ratio:${w}/${h}">
        <img src="assets/pain/body-figures.webp" alt="" style="width:${(1182 / w) * 100}%;left:${(-x / w) * 100}%;top:${(-y / h) * 100}%">
        ${Object.entries(mp.pts).map(([id, [px, py, deep]]) => `<button type="button" class="mdot ${deep ? "deep" : ""} ${id === mapPick ? "on" : ""}" data-pick="${id}" style="left:${((px - x) / w) * 100}%;top:${((py - y) / h) * 100}%" aria-label="${esc(MUS.MUSCLES[id].name)}${deep ? " (deep)" : ""}"></button>`).join("")}
      </div>
      <div class="map-pick">${mapPick ? `<div><b>${esc(MUS.MUSCLES[mapPick].name)}</b><span>${esc(MUS.MUSCLES[mapPick].refers.split(/[.;]/)[0])}</span></div><button type="button" class="btn-gold sm" data-report="${mapPick}">Open report</button>
          ${TK.forPoint(mapPick).length ? `<div class="pm-tracks"><b>Choose your pain pattern</b><div class="track-list">${TK.forPoint(mapPick).map(TK.card).join("")}</div></div>` : ""}`
        : `<p class="muted small">Tap a point on the muscle that hurts. Navy points are deep muscles under the surface.${mapView.startsWith("body") ? " Use the Shoulder views to zoom in." : ""}</p>`}</div>`;
  }
  const _muscleMap = $("#muscle-map");
  if (_muscleMap) _muscleMap.addEventListener("click", (e) => {
    const t = e.target.closest("[data-map]"), d = e.target.closest("[data-pick]");
    if (t) { mapView = t.dataset.map; mapPick = null; renderMap(); }
    else if (d) { mapPick = d.dataset.pick; renderMap(); }
  });

  function renderMuscleList() {
    const _ms = $("#muscle-search"), _ml = $("#muscle-list"); if (!_ms || !_ml) return;
    const q = _ms.value.trim().toLowerCase();
    const hit = (id) => { const m = MUS.MUSCLES[id]; return !q || (m.name + " " + m.refers + " " + m.does).toLowerCase().includes(q); };
    _ml.innerHTML = GROUPS.map(([g, ids]) => {
      const list = ids.filter(hit);
      return list.length ? `<div class="mgroup"><p class="label">${esc(g)}</p><div class="mchips">${list.map((id) =>
        `<button type="button" class="mchip" data-report="${id}"><b>${esc(MUS.MUSCLES[id].name)}</b><span>${esc(MUS.MUSCLES[id].refers.split(/[.;]/)[0])}</span></button>`).join("")}</div></div>` : "";
    }).join("") || `<p class="muted small center">No muscle matches "${esc(q)}".</p>`;
  }
  const _muscleSearch = $("#muscle-search");
  if (_muscleSearch) _muscleSearch.addEventListener("input", renderMuscleList);
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-report]"); if (b) openReport(b.dataset.report); });

  let report = null, reportFrom = "muscle"; // report = { id, answers: Map(index -> bool) }; reportFrom = mode to go back to
  function openReport(id, push = true) {
    if (!MUS.MUSCLES[id]) return;
    const _rma = $("#mode-area"), _rmm = $("#mode-muscle");
    if (_rma && !_rma.hidden) reportFrom = "area"; else if (_rmm && !_rmm.hidden) reportFrom = "muscle";
    if (location.hash.slice(1).split("/")[0] !== "pain") show("pain");
    if (push) history.pushState(null, "", `#pain/muscle/${id}`);
    report = { id, answers: new Map() };
    const _oma = $("#mode-area"); if (_oma) _oma.hidden = true;
    const _omm = $("#mode-muscle"); if (_omm) _omm.hidden = true;
    $("#muscle-report").hidden = false;
    renderReport();
    window.scrollTo(0, 0);
  }
  const checkScore = () => {
    const r = REPORTS[report.id], qs = (r && r.questions) || [];
    const total = qs.reduce((n, q) => n + q.w, 0), yes = qs.reduce((n, q, i) => n + (report.answers.get(i) ? q.w : 0), 0);
    return { total, yes, answered: report.answers.size, pct: total ? yes / total : 0, n: qs.length };
  };
  function verdict() {
    const s = checkScore(), name = MUS.MUSCLES[report.id].name;
    if (!s.answered) return `<p class="muted small">Answer the questions above to see how well your pain fits ${esc(name)}.</p>`;
    const level = s.pct >= 0.6 ? ["strong", "Strong match"] : s.pct >= 0.3 ? ["possible", "Possible match"] : ["low", "Less likely"];
    const msg = level[0] === "strong" ? `Your answers fit the classic ${esc(name)} pattern. Start the protocol below and track your pain for 1 to 2 weeks.`
      : level[0] === "possible" ? `Some of your answers fit ${esc(name)}. It may be involved alongside another muscle. Try the Calm phase and compare with the other muscles from your area.`
      : `Your answers don't fit ${esc(name)} well. Check the other muscles for your area, or have Dr. Jared assess it in person.`;
    return `<div class="verdict ${level[0]}"><span class="label">Your self-check result</span><b>${level[1]}</b><div class="vbar"><i style="width:${Math.round(s.pct * 100)}%"></i></div>
      <p>${msg}</p><small>${s.answered} of ${s.n} answered · educational self-check, not a medical diagnosis</small></div>`;
  }
  const stepLi = (st) => {
    const ex = st.video && byName.get(st.video);
    return `<li class="pstep">${ex ? `<button type="button" class="pthumb" data-video="${ex.id}" aria-label="Watch ${esc(ex.name)}">${thumbImg(ex.id)}</button>` : `<span class="pthumb none"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z"/></svg></span>`}
      <div><b>${esc(st.name)}</b><span class="dose">${esc(st.dose)}</span><p>${esc(st.how)}</p></div></li>`;
  };
  const PHASES = [["calm", "Phase 1 · Calm it down", "Days 1 to 7"], ["restore", "Phase 2 · Restore", "Weeks 2 to 3"], ["strengthen", "Phase 3 · Strengthen", "Weeks 3 to 6"]];
  function renderReport() {
    const id = report.id, m = MUS.MUSCLES[id], r = REPORTS[id] || {};
    const list = (arr) => `<ul class="rlist">${(arr || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    $("#muscle-report").innerHTML = `
      <button type="button" class="link-sm back-link" data-back>← Back to the Pain Tool</button>
      <header class="hero report-hero"><div><p class="gd-eyebrow">Muscle report</p><h1>${esc(m.name)}</h1><p>${esc(m.does)}</p></div>
        ${m.guide ? `<img src="assets/guides/${m.guide}-thumb.webp" alt="" width="110" height="110">` : ""}</header>
      <div class="report-grid">
        <div class="col-main">
          ${TK.forPoint(id).length ? `<section class="card"><span class="label accent">Dr. Jared's pain tracks for this muscle</span><div class="track-list">${TK.forPoint(id).map(TK.card).join("")}</div></section>` : ""}
          <section class="card"><span class="label accent">Where it sends pain</span><p class="rlead">${esc(m.refers)}</p>
            ${r.symptoms ? `<p class="label">What people usually feel</p>${list(r.symptoms)}` : ""}</section>
          ${r.questions ? `<section class="card"><span class="label accent">Self-check: is it this muscle?</span>
            <ol class="qlist">${r.questions.map((q, i) => `<li><p>${esc(q.q)}</p><div class="yn" data-q="${i}"><button type="button" data-a="1" aria-pressed="${report.answers.get(i) === true}">Yes</button><button type="button" data-a="0" aria-pressed="${report.answers.get(i) === false}">No</button></div></li>`).join("")}</ol>
            <div id="verdict">${verdict()}</div></section>` : ""}
          ${r.tests && r.tests.length ? `<section class="card"><span class="label accent">Quick self-tests</span>${r.tests.map((t) => `<div class="rtest"><b>${esc(t.name)}</b><p>${esc(t.how)}</p><p class="pos"><b>Positive if:</b> ${esc(t.positive)}</p></div>`).join("")}</section>` : ""}
          ${r.protocol ? `<section class="card protocol"><span class="label accent">Dr. Jared's protocol</span>
            ${PHASES.map(([k, t, when]) => (r.protocol[k] || []).length ? `<div class="phase"><div class="phase-head"><b>${t}</b><span>${when}</span><button type="button" class="ev-act" data-phase="${k}">Start</button></div><ol class="psteps">${r.protocol[k].map(stepLi).join("")}</ol></div>` : "").join("")}
            <div class="row"><button type="button" class="btn-gold sm" data-save-protocol>Save to My Programs</button><a class="btn-blue sm" href="/book">Book with Dr. Jared</a></div>
            ${r.expect ? `<p class="expect"><b>What to expect:</b> ${esc(r.expect)}</p>` : ""}</section>` : ""}
        </div>
        <div class="col-side">
          ${r.origin ? `<section class="card"><span class="label accent">Anatomy</span><dl class="anat"><dt>Origin</dt><dd>${esc(r.origin)}</dd><dt>Insertion</dt><dd>${esc(r.insertion)}</dd><dt>Action</dt><dd>${esc(r.action)}</dd><dt>Nerve</dt><dd>${esc(r.nerve)}</dd></dl></section>` : ""}
          <section class="card"><span class="label accent">Often worse with</span><div class="tags">${m.worse.map((w) => `<span>${esc(MUS.AGGRAVATORS[w])}</span>`).join("")}</div>
            ${r.causes ? `<p class="label">What keeps it irritated</p>${list(r.causes)}` : ""}</section>
          ${r.mimics ? `<section class="card"><span class="label accent">Often mistaken for</span>${list(r.mimics)}</section>` : ""}
          ${r.habits ? `<section class="card"><span class="label accent">Daily habits that help</span>${list(r.habits)}</section>` : ""}
          ${r.redFlags ? `<section class="card redflags"><span class="label">Get seen promptly if</span>${list(r.redFlags)}${r.seePro ? `<p class="small">${esc(r.seePro)}</p>` : ""}</section>` : ""}
          ${m.guide && GUIDES[m.guide] ? `<div class="guides"><button type="button" class="guide" data-guide="${m.guide}"><img src="assets/guides/${m.guide}-thumb.webp" alt="" width="52" height="52" loading="lazy"><span><b>${esc(GUIDES[m.guide])}</b><span>Open Dr. Jared's guide</span></span></button></div>` : ""}
          <section class="card"><span class="label accent">Log it</span>
            <div class="log-row"><label>Pain now: <output>5</output>/10<input type="range" min="0" max="10" value="5" aria-label="Pain level"></label><button type="button" class="btn-gold sm" data-report-log>Log it</button></div></section>
        </div>
      </div>
      <p class="muted tiny center">Educational only, not a medical diagnosis. Written for MD Fit patients; your in-person evaluation always comes first.</p>`;
  }
  // Muscle id -> pain-log area (first Pain Tool area whose spots list the muscle)
  const logAreaFor = (id) => {
    for (const a of ALL_PAIN) if ((MUS.SPOTS[a.id] || []).some((s) => s[1].includes(id))) return a.area;
    return "Other";
  };
  function protocolWorkout(phases) {
    const id = report.id, r = REPORTS[id], name = MUS.MUSCLES[id].name;
    const steps = (k) => (r.protocol[k] || []).map((st) => st.video && byName.get(st.video) && { ...byName.get(st.video), sets: st.dose, block: PHASES.find((p) => p[0] === k)[1].split(" · ")[1] }).filter(Boolean);
    const all = phases.flatMap(steps);
    return { title: `${name.split(" (")[0]} protocol`.slice(0, 80), key: `painproto-${String(id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60)}`, goal: "Mobility & Recovery", goalId: "mobility", location: "home", level: "beginner", levelLabel: "Protocol",
      rounds: 1, restEx: 15, restRound: 0, minutes: Math.max(5, all.length * 3), warmup: [], circuit: all, cooldown: [], exercises: all, perRound: all.length };
  }
  $("#muscle-report").addEventListener("click", async (e) => {
    if (e.target.closest("[data-back]")) { history.pushState(null, "", "#pain"); setMode(reportFrom); return; }
    const yn = e.target.closest(".yn [data-a]");
    if (yn) {
      report.answers.set(Number(yn.parentElement.dataset.q), yn.dataset.a === "1");
      $$("button", yn.parentElement).forEach((b) => b.setAttribute("aria-pressed", b === yn));
      $("#verdict").innerHTML = verdict();
      return;
    }
    const ph = e.target.closest("[data-phase]");
    if (ph) {
      const w = protocolWorkout([ph.dataset.phase]);
      if (!w.exercises.length) return toast("This phase is done without videos: follow the written steps.");
      return startPlayer(w);
    }
    if (e.target.closest("[data-save-protocol]")) {
      const w = protocolWorkout(["calm", "restore", "strengthen"]);
      if (!w.circuit.length) return toast("No video steps to save for this protocol.");
      try {
        earn("program"); lib = await apiAuth("POST", "/api/me/programs", { name: w.title.slice(0, 60), workout: { ...w, warmup: [], cooldown: [], circuit: w.circuit.slice(0, 20).map((x) => ({ id: x.id, sets: String(x.sets).slice(0, 30) })) } });
        renderPrograms(); toast(`Saved "${w.title}" to My Programs.`);
      } catch (err) { toast(err.message); }
      return;
    }
    const lg = e.target.closest("[data-report-log]");
    if (lg) {
      const row = lg.closest(".log-row"), s = checkScore();
      lg.disabled = true;
      try {
        await apiAuth("POST", "/api/me/pain", { area: logAreaFor(report.id), level: Number($("input", row).value),
          note: `${MUS.MUSCLES[report.id].name}${s.answered ? ` · self-check ${Math.round(s.pct * 100)}%` : ""}`.slice(0, 300) });
        await loadPain(); lg.textContent = "Logged"; loadRewards(true);
      } catch (err) { toast(err.message); lg.disabled = false; }
    }
  });
  $("#muscle-report").addEventListener("input", (e) => { if (e.target.type === "range") e.target.closest(".log-row").querySelector("output").textContent = e.target.value; });

  // ================= Profile
  function renderProfile() {
    const first = (client.name || "there").split(" ")[0];
    $("#hello-name").textContent = first;
    $("#avatar").textContent = first[0].toUpperCase();
    if ($("#pw-summary")) renderPasswordCard();
    if ($("#phone-nudge")) $("#phone-nudge").hidden = !!(client.phone && String(client.phone).trim());
    $("#p-name").textContent = client.name;
    $("#p-email").textContent = client.email;
    const f = $("#profile-form");
    f.name.value = client.name; f.email.value = client.email; f.phone.value = client.phone || "";
    renderReferral();
  }
  wire($("#profile-form"), async (d) => {
    const r = await apiAuth("PUT", "/api/me", { name: d.name, phone: d.phone }); earn("profile");
    client = r.client; auth.set({ ...auth.get(), client }); renderProfile();
    return { message: "Saved." };
  }, { reset: false });
  wire($("#phone-nudge-form"), async (d) => {
    const phone = String(d.phone || "").trim();
    if (phone.replace(/\D/g, "").length < 10) throw new Error("Enter a 10-digit phone number.");
    const r = await apiAuth("PUT", "/api/me", { name: client.name, phone });
    client = r.client; auth.set({ ...auth.get(), client }); renderProfile();
    const pf = $("#profile-form"); if (pf && pf.phone) pf.phone.value = client.phone || "";
    toast("Phone number saved");
    return { message: "" };
  }, { reset: false });
  // Password: change with the current one, or with a code sent by email. Google sign-ups set their first one with a code.
  function renderPasswordCard() {
    const first = client && client.hasPassword === false;
    $("#pw-summary").textContent = first ? "Set a password" : "Change password";
    $("#pw-intro").hidden = !first;
    $("#pw-current").hidden = first;
    $("#pw-code-row").hidden = !first && !renderPasswordCard.codeSent;
    $("#pw-submit").textContent = first ? "Set password" : "Change password";
    $("#pw-send-code").textContent = first ? "Email me a code" : "Forgot it? Email me a code instead";
  }
  $("#pw-send-code").addEventListener("click", async () => {
    const msg = $("#pw-code-msg"); msg.textContent = "Sending…";
    try {
      const r = await apiAuth("POST", "/api/me/password/code", {});
      renderPasswordCard.codeSent = true; renderPasswordCard();
      msg.textContent = `Code emailed to ${r.to}. Check your inbox (and spam).`;
      $("#password-form").code.focus();
    } catch (err) { msg.textContent = err.message; }
  });
  wire($("#password-form"), async (d) => {
    const body = { password: d.password };
    if (d.code) body.code = d.code; else body.current = d.current;
    const r = await apiAuth("PUT", "/api/me/password", body);
    auth.set(r); client = r.client || { ...client, hasPassword: true }; renderPasswordCard.codeSent = false; renderPasswordCard();
    $("#pw-code-msg").textContent = "";
    return { message: "Password saved. You can now log in with your email and password. Other devices were signed out." };
  });
  // Referral code
  // (one "Refer a friend" card: the code shows right away from the account, the sign-up count once /api/me/referral answers)
  function renderReferral() {
    const code = client.referralCode;
    if (code && $("#ref-code").textContent === "—") $("#ref-code").textContent = code;
  }
  $("#logout").addEventListener("click", () => { auth.clear(); location.href = "/"; });

  async function loadReferral() {
    try {
      const r = await apiAuth("GET", "/api/me/referral");
      if (r.code) {
        $("#ref-code").textContent = r.code;
        $("#ref-stats").textContent = r.referrals ? `${r.referrals} friend${r.referrals === 1 ? "" : "s"} signed up with your code` : "No one has used your code yet — share it!";
      }
    } catch {}
  }
  $("#copy-ref").addEventListener("click", () => {
    const code = $("#ref-code").textContent;
    if (!code || code === "—") return;
    navigator.clipboard.writeText(code).then(() => { toast("Referral code copied!"); $("#copy-ref").textContent = "Copied"; setTimeout(() => ($("#copy-ref").textContent = "Copy"), 2000); }).catch(() => toast("Couldn't copy — long-press the code to select it."));
  });
  $("#share-ref").addEventListener("click", () => {
    earn("share");
    const code = $("#ref-code").textContent;
    if (!code || code === "—") return;
    const url = `${location.origin}/login?signup&ref=${encodeURIComponent(code)}`;
    if (navigator.share) navigator.share({ title: "Join MD Fit", text: `Sign up with my referral code ${code} and get 3 months free!`, url }).catch(() => {});
    else navigator.clipboard.writeText(url).then(() => toast("Share link copied!")).catch(() => toast("Couldn't copy the link."));
  });

  async function loadAppointments() {
    appts = await apiAuth("GET", "/api/me/appointments");
    $("#p-appts").innerHTML = appts.upcoming.map((a) => apptLi(a, { cancel: true, cal: true })).join("") ||
      `<li class="muted small">No visits booked. <button type="button" class="link" id="p-book-empty">Book one</button></li>`;
    $("#p-history").innerHTML = appts.past.slice(0, 20).map((a) => apptLi(a)).join("") || `<li class="muted small">Past visits show up here.</li>`;
  }
  $("#p-appts").addEventListener("click", async (e) => {
    if (e.target.closest("#p-book-empty")) { openBook(); return; }
    const b = e.target.closest("[data-cancel]");
    if (!b || !confirm("Cancel this appointment? The time opens up for someone else.")) return;
    b.disabled = true;
    try { await apiAuth("POST", `/api/me/appointments/${b.closest("[data-appt]").dataset.appt}/cancel`, {}); await loadAppointments(); renderEvents(); renderNotes(); toast("Appointment cancelled."); }
    catch (err) { toast(err.message); b.disabled = false; }
  });

  // In-app booking: pick type → pick day → pick time → confirm. Hits the same APIs as /book, so nothing new on the server.
  const bookDlg = $("#book-dialog");
  const bookState = { type: null, date: "", time: "", availability: null, types: null };
  const fmtDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const fmtMoney = ($$$) => $$$ ? "$" + $$$ : "";
  async function openBook() {
    bookState.type = null; bookState.date = ""; bookState.time = "";
    $("#book-msg").textContent = ""; $("#book-note").value = "";
    $("#book-confirm").disabled = false; // a finished booking left it disabled; the next booking needs it again
    $$("#book-flow .book-step").forEach((s) => { s.hidden = s.dataset.step !== "type"; });
    if (!bookState.types) {
      const site = await window.MDFit.loadSite().catch(() => null);
      // The bookable types are the scheduler's appointment types (the same list as the /book page).
      bookState.types = ((site && site.settings && site.settings.appointmentTypes) || []).filter((t) => t.id && t.name);
    }
    $("#book-types").innerHTML = bookState.types.map((t) => `<button type="button" class="book-type" data-type="${esc(t.id)}">
      <b>${esc(t.name)}</b><span class="muted small">${t.minutes ? esc(t.minutes) + " min" : ""}${t.remote ? " · Video" : ""}</span>
      <p class="small">${esc(t.description || "")}</p></button>`).join("") || `<p class="muted small">Booking is unavailable right now. Call 941-313-0562.</p>`;
    bookDlg.showModal();
  }
  $("#p-book-open").addEventListener("click", openBook);
  bookDlg.addEventListener("click", (e) => { if (e.target === bookDlg) bookDlg.close(); });
  async function loadSlots() {
    const r = await apiAuth("GET", `/api/availability?type=${encodeURIComponent(bookState.type.id)}&days=21`);
    bookState.availability = r;
    const openDays = r.days.filter((d) => d.slots.length);
    if (!openDays.length) { $("#book-dates").innerHTML = `<p class="muted small">No open times in the next 3 weeks. Call 941-313-0562 and we'll fit you in.</p>`; $("#book-times").innerHTML = ""; return; }
    $("#book-dates").innerHTML = openDays.slice(0, 14).map((d) => `<button type="button" class="book-day${d.date === bookState.date ? " on" : ""}" data-date="${d.date}">${fmtDay(d.date)}<span>${d.slots.length} open</span></button>`).join("");
    if (!bookState.date) bookState.date = openDays[0].date;
    renderTimes();
  }
  function renderTimes() {
    const day = bookState.availability.days.find((d) => d.date === bookState.date);
    $("#book-times").innerHTML = day ? day.slots.map((t) => `<button type="button" class="book-time${t === bookState.time ? " on" : ""}" data-time="${t}">${fmtTime(t)}</button>`).join("") : "";
    $$("#book-dates .book-day").forEach((b) => b.classList.toggle("on", b.dataset.date === bookState.date));
  }
  $("#book-types").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-type]"); if (!b) return;
    bookState.type = bookState.types.find((t) => t.id === b.dataset.type);
    $("#book-type-label").textContent = `${bookState.type.name}${bookState.type.minutes ? " · " + bookState.type.minutes + " min" : ""}`;
    $$("#book-flow .book-step").forEach((s) => { s.hidden = s.dataset.step !== "when"; });
    $("#book-dates").innerHTML = `<p class="muted small">Loading times…</p>`;
    try { await loadSlots(); } catch (err) { $("#book-dates").innerHTML = `<p class="muted small">Couldn't load times: ${esc(err.message)}</p>`; }
  });
  // Live: the member socket gets "slots_changed" when a day's times change; refresh the open booking sheet
  if (window.MDFitRT) MDFitRT.on("slots_changed", async () => {
    if (!bookDlg.open || !bookState.type || !bookState.availability) return;
    const picked = bookState.time;
    try { await loadSlots(); } catch { return; }
    const day = bookState.availability.days.find((d) => d.date === bookState.date);
    if (picked && !(day && day.slots.includes(picked)) && !$("#book-flow [data-step=confirm]").hidden) {
      bookState.time = "";
      $$("#book-flow .book-step").forEach((s) => { s.hidden = s.dataset.step !== "when"; });
      toast("That time was just taken. Please pick another.");
    }
  });
  $("#book-back").addEventListener("click", () => { $$("#book-flow .book-step").forEach((s) => { s.hidden = s.dataset.step !== "type"; }); });
  $("#book-dates").addEventListener("click", (e) => { const b = e.target.closest("[data-date]"); if (!b) return; bookState.date = b.dataset.date; bookState.time = ""; renderTimes(); });
  $("#book-times").addEventListener("click", (e) => {
    const b = e.target.closest("[data-time]"); if (!b) return;
    bookState.time = b.dataset.time;
    $("#book-summary").textContent = `${bookState.type.name} · ${fmtDay(bookState.date)} at ${fmtTime(bookState.time)}`;
    $$("#book-flow .book-step").forEach((s) => { s.hidden = s.dataset.step !== "confirm"; });
    // A phone number is required to book; Google sign-in accounts may not have one yet
    $("#book-phone-row").hidden = !!client.phone;
  });
  $("#book-confirm").addEventListener("click", async () => {
    const btn = $("#book-confirm"), msg = $("#book-msg"); msg.textContent = ""; btn.disabled = true;
    try {
      const phone = client.phone || $("#book-phone").value.trim();
      if (!phone) { $("#book-phone").focus(); throw new Error("Add a phone number so Dr. Jared can reach you about the visit."); }
      const payload = { typeId: bookState.type.id, date: bookState.date, time: bookState.time, name: client.name, email: client.email, phone, notes: $("#book-note").value.trim().slice(0, 400) };
      const r = await apiAuth("POST", "/api/appointments", payload);
      $("#book-done-info").textContent = `${bookState.type.name} on ${fmtDay(bookState.date)} at ${fmtTime(bookState.time)}. Your confirmation is in your email.`;
      $$("#book-flow .book-step").forEach((s) => { s.hidden = s.dataset.step !== "done"; });
      earn("booking");
      await loadAppointments(); renderEvents(); renderNotes();
      toast(r.appointment && r.appointment.intakeDone ? "Booked. Your intake documents are already on file." : "Check your email for your intake documents link.");
    } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  });
  $("#book-close-done").addEventListener("click", () => bookDlg.close());

  // Pain tracker
  const pf = $("#pain-form"), pout = $("output", pf);
  pf.area.innerHTML = AREAS.map((a) => `<option>${esc(a)}</option>`).join("");
  pf.level.addEventListener("input", () => (pout.textContent = pf.level.value));
  wire(pf, async (d) => {
    await apiAuth("POST", "/api/me/pain", { area: d.area, level: Number(d.level), note: d.note });
    $("#chart-area").value = d.area;
    await loadPain();
    pf.note.value = "";
    loadRewards(true);
    return { message: "Logged." };
  }, { reset: false });
  $("#chart-area").addEventListener("change", renderChart);

  async function loadPain() {
    painLog = await apiAuth("GET", "/api/me/pain");
    const areas = [...new Set(painLog.map((e) => e.area))];
    const sel = $("#chart-area"), keep = sel.value;
    sel.innerHTML = areas.length ? areas.map((a) => `<option>${esc(a)}</option>`).join("") : `<option>${esc(pf.area.value)}</option>`;
    if (areas.includes(keep)) sel.value = keep;
    else if (areas.length) sel.value = painLog[painLog.length - 1].area;
    $("#entry-count").textContent = painLog.length;
    $("#entries").innerHTML = `<thead><tr><th>Date</th><th>Area</th><th>Pain</th><th>Note</th><th></th></tr></thead><tbody>${
      painLog.length ? painLog.slice().reverse().map((e) => `<tr data-id="${e.id}"><td>${shortDate(e.date)}</td><td>${esc(e.area)}</td><td>${e.level}/10</td><td>${esc(e.note)}</td><td><button type="button" data-del>Delete</button></td></tr>`).join("")
      : `<tr><td colspan="5" class="muted">No entries yet.</td></tr>`}</tbody>`;
    renderChart();
    renderActivity();
    renderCalendar();
  }
  $("#entries").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    await apiAuth("DELETE", `/api/me/pain/${b.closest("tr").dataset.id}`);
    loadPain();
  });

  // Single-series line chart: pain level (0-10) over time for one area. The table under "All entries" is the data view.
  function renderChart() {
    const area = $("#chart-area").value, box = $("#chart");
    const pts = painLog.filter((e) => e.area === area);
    if (pts.length < 2) {
      box.innerHTML = `<p class="empty">${pts.length ? "Log one more day to see your trend." : "Log your pain a few times a week to see your trend here."}</p>`;
      return;
    }
    const W = 640, H = 220, L = 34, R = 16, T = 14, B = 30;
    const t = (d) => Date.parse(d + "T12:00:00Z");
    const x0 = t(pts[0].date), x1 = Math.max(t(pts[pts.length - 1].date), x0 + 864e5);
    const X = (d) => L + ((t(d) - x0) / (x1 - x0)) * (W - L - R);
    const Y = (v) => T + (1 - v / 10) * (H - T - B);
    const xy = pts.map((p) => [X(p.date), Y(p.level)]);
    const grid = [0, 5, 10].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 8}" y="${Y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join("");
    const first = pts[0].date, last = pts[pts.length - 1].date, lastPt = xy[xy.length - 1];
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(area)} pain from ${shortDate(first)} to ${shortDate(last)}: latest ${pts[pts.length - 1].level} out of 10">
      ${grid}
      <text x="${L}" y="${H - 8}" class="axis">${shortDate(first)}</text>
      <text x="${W - R}" y="${H - 8}" class="axis" text-anchor="end">${shortDate(last)}</text>
      <polyline points="${xy.map((p) => p.join(",")).join(" ")}" class="line"/>
      ${xy.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" class="dot"/>`).join("")}
      <text x="${Math.min(lastPt[0], W - R - 4)}" y="${lastPt[1] - 12}" class="last-label" text-anchor="end">${pts[pts.length - 1].level}/10</text>
      ${xy.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="14" class="hit" data-i="${i}" tabindex="0"/>`).join("")}
    </svg><div class="tip" hidden></div>`;
    const tip = $(".tip", box);
    const showTip = (el) => {
      const p = pts[el.dataset.i], r = el.getBoundingClientRect(), br = box.getBoundingClientRect();
      tip.innerHTML = `<b>${p.level}/10</b> · ${shortDate(p.date)}${p.note ? `<br><span>${esc(p.note)}</span>` : ""}`;
      tip.hidden = false;
      tip.style.left = Math.min(Math.max(r.left - br.left + r.width / 2, 70), br.width - 70) + "px";
      tip.style.top = (r.top - br.top) + "px";
    };
    $$(".hit", box).forEach((el) => {
      ["mouseenter", "focus", "click"].forEach((ev) => el.addEventListener(ev, () => showTip(el)));
      ["mouseleave", "blur"].forEach((ev) => el.addEventListener(ev, () => (tip.hidden = true)));
    });
  }

  // Bug reports & feature suggestions (member profile card). Admin sees them under Admin -> Feedback.
  const fbForm = $("#fb-form");
  if (fbForm) {
    const titleLabel = { bug: "What went wrong, in one line?", suggestion: "Your idea, in one line" };
    const bodyLabel = { bug: "Details (what you did, what happened, what you expected)", suggestion: "Describe your suggestion in more detail" };
    const setKind = (k) => {
      fbForm.kind.value = k;
      $("#fb-title-label").textContent = titleLabel[k];
      $("#fb-body-label").textContent = bodyLabel[k];
      $$("#fb-form").forEach(() => {});
      $$(".fb-tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.fbKind === k));
    };
    $$(".fb-tab").forEach((b) => b.addEventListener("click", () => setKind(b.dataset.fbKind)));
    async function loadMine() {
      try {
        const list = await apiAuth("GET", "/api/me/feedback-reports");
        $("#fb-count").textContent = list.length;
        $("#fb-mine-wrap").hidden = !list.length;
        $("#fb-mine").innerHTML = list.map((r) => `<li><div><b>${esc(r.title)}</b><span class="pill ${r.kind}">${r.kind}</span> <span class="pill ${r.status}">${r.status}</span></div><small>${fmtDate(r.createdAt.slice(0, 10))}</small></li>`).join("");
      } catch {}
    }
    let fbSending = false;
    fbForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (fbSending) return; // guard against double-fire
      const msg = $(".form-msg", fbForm), btn = $("button[type=submit]", fbForm);
      if (!fbForm.title.value.trim() || !fbForm.body.value.trim()) { msg.className = "form-msg err"; msg.textContent = "Fill in both fields."; return; }
      fbSending = true; btn.disabled = true; msg.className = "form-msg"; msg.textContent = "Sending…";
      try {
        await apiAuth("POST", "/api/me/feedback-reports", { kind: fbForm.kind.value, title: fbForm.title.value, body: fbForm.body.value, page: location.hash || "/account", userAgent: navigator.userAgent });
        msg.className = "form-msg ok"; msg.textContent = fbForm.kind.value === "bug" ? "Thanks. Dr. Jared will take a look." : "Thanks for the idea. Dr. Jared reads every one.";
        fbForm.reset(); fbForm.kind.value = $(".fb-tab[aria-selected=true]").dataset.fbKind;
        loadMine();
      } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
      fbSending = false; btn.disabled = false;
    });
    loadMine();
  }

  // Install as an app: native prompt where supported; otherwise per-platform steps. Button always visible.
  let installEvt = null;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  const isEdge = /edg/i.test(ua);
  const cards = [...document.querySelectorAll(".install-card")];
  const each = (sel, fn) => cards.forEach((c) => { const el = c.querySelector(sel); if (el) fn(el); });
  const hideCards = () => cards.forEach((c) => { c.hidden = true; });
  const [text, steps] = isIOS
    ? ["Get MD Fit on your Home Screen. One tap to open, full-screen, no App Store needed.", `<li>Tap the <b>Share</b> button (square with arrow) in Safari</li><li>Scroll and tap <b>"Add to Home Screen"</b></li><li>Tap <b>"Add"</b></li>`]
    : isAndroid
    ? ["Install MD Fit as an app on your phone:", `<li>Tap the <b>⋮ menu</b> in Chrome (top right)</li><li>Tap <b>"Add to Home screen"</b> or <b>"Install app"</b></li><li>Tap <b>"Install"</b></li>`]
    : ["Install MD Fit as a desktop app:", isEdge
      ? `<li>Click the <b>⋯ menu</b> (top right)</li><li>Click <b>"Apps" → "Install this site as an app"</b></li>`
      : `<li>Click the <b>install icon</b> in the address bar (or ⋮ menu)</li><li>Click <b>"Install"</b></li>`];
  if (standalone) hideCards();
  each(".install-text", (el) => { el.textContent = text; });
  each(".install-steps", (el) => { el.innerHTML = steps; });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); installEvt = e;
    each(".install-steps-wrap", (el) => { el.hidden = true; });
    each(".install-text", (el) => { el.textContent = "Get one-tap access to MD Fit:"; });
  });
  each(".install-btn", (btn) => btn.addEventListener("click", async () => {
    if (!installEvt) {
      if (isIOS) { $("#a2hs").hidden = false; return; }
      each(".install-steps-wrap", (el) => { el.hidden = false; });
      return;
    }
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (outcome === "accepted") hideCards();
    installEvt = null;
  }));
  window.addEventListener("appinstalled", hideCards);
  $("#a2hs").addEventListener("click", (e) => { if (e.target.id === "a2hs" || e.target.closest(".a2hs-x")) $("#a2hs").hidden = true; });
  // New deploy => new service worker => old file cache cleared and the page reloads once. Logins are kept.
  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  // ================= Workout player: warm-up (once) → circuit rounds (optional rests) → cool-down, auto-advancing
  // Drive serves the raw MP4 (CORS + range requests), so a real <video> can autoplay, loop through the set and move on by itself.
  const driveMp4 = (id) => MDFitVideo.mp4(id);
  const PLAY_KEY = "mdfit.player.v2"; // v2: breaks default off so videos run back to back
  const P = { w: null, steps: [], i: 0, start: 0, tick: null, stall: null, rest: null, done: false, left: 0, paused: false,
    // Sound is on unless the member turned it off themselves (it used to start off, so everyone heard nothing)
    opt: (() => { const o = store.get(PLAY_KEY) || {}; return { breaks: false, ...o, sound: o.soundSet ? !!o.sound : true }; })() };
  const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function buildSteps(w) {
    const out = [];
    w.warmup.forEach((e) => out.push({ e, label: "Warm-up" }));
    for (let r = 1; r <= w.rounds; r++) {
      w.circuit.forEach((e, i) => {
        out.push({ e, label: w.rounds === 1 && e.block !== "Circuit" ? e.block : `Round ${r} of ${w.rounds}` });
        if (!w.noRest && w.restEx && i < w.circuit.length - 1) out.push({ rest: w.restEx, label: "Rest" });
      });
      if (!w.noRest && r < w.rounds && w.restRound) out.push({ rest: w.restRound, label: `Rest before round ${r + 1}` });
    }
    w.cooldown.forEach((e) => out.push({ e, label: "Cool-down" }));
    return out;
  }
  const saveOpt = () => store.set(PLAY_KEY, P.opt);
  const soundBlocked = (on) => { const b = $('#p-opts [data-opt="sound"]'); if (!b) return; b.classList.toggle("blocked", on); b.title = on ? "Tap for sound" : ""; };
  function renderOpts() {
    $$("#p-opts [data-opt]").forEach((b) => { const on = !!P.opt[b.dataset.opt]; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  }
  function goFs(el) { const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen; if (rfs) rfs.call(el).catch(() => {}); }
  // Full screen: whole player on Android/desktop when a workout starts; the video button uses the native
  // full-screen player (on iPhone that's the only true full screen, and it never shows the dark Drive overlay)
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function enterPlayerFs() { const pl = $("#player"); const fn = pl.requestFullscreen || pl.webkitRequestFullscreen; if (fn && !fsEl()) try { const r = fn.call(pl, { navigationUI: "hide" }); if (r && r.catch) r.catch(() => {}); } catch {} }
  function exitPlayerFs() { if (fsEl()) try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {} }
  $("#p-fs").addEventListener("click", () => {
    const v = $("#p-video"), ifr = $("#p-vwrap .p-fallback-iframe");
    if (ifr && ifr.requestFullscreen) { ifr.requestFullscreen().catch(() => {}); return; }
    if (v.webkitEnterFullscreen && !v.hidden) { try { v.webkitEnterFullscreen(); } catch {} return; }
    const t = v.hidden && ifr ? ifr : v; (t.requestFullscreen || t.webkitRequestFullscreen || (() => {})).call(t);
  });
  function startPlayer(w) {
    document.querySelectorAll("dialog[open]").forEach((d) => { try { d.close(); } catch {} });
    enterPlayerFs();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    P.w = w; P.steps = buildSteps(w); P.i = 0; P.start = Date.now(); P.done = false; P.paused = false; P.log = {};
    const pl = $("#player");
    pl.hidden = false;
    document.body.style.overflow = "hidden";
    clearInterval(P.tick);
    P.tick = setInterval(onTick, 1000);
    $("#p-timer").textContent = "0:00";
    const v = $("#p-video");
    v.onended = () => { if (!P.paused && !P.done) advance(); };
    v.onerror = () => { const e = P.steps[P.i] && P.steps[P.i].e; if (e) { v.hidden = true; const ifr = document.createElement("iframe"); ifr.src = `https://drive.google.com/file/d/${encodeURIComponent(e.id)}/preview`; ifr.title = e.name; ifr.allow = "autoplay; fullscreen"; ifr.allowFullscreen = true; ifr.className = "p-fallback-iframe"; $("#p-vwrap").appendChild(ifr); } };
    renderOpts();
    renderStep();
    goFs(pl);
  }
  function exitFs() { const d = document; if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen || (() => {})).call(d); }
  function closePlayer() {
    // Clear "#pain/track/<id>" so picking the same track again changes the hash and starts it
    if (/^#pain\/track\//.test(location.hash)) history.replaceState(null, "", "#pain");
    exitPlayerFs();
    clearInterval(P.tick); clearTimeout(P.stall);
    const v = $("#p-video"); if (v) { v.pause(); v.removeAttribute("src"); v.load(); v.onended = null; v.onerror = null; }
    $("#p-vwrap").hidden = true;
    const ifr = $("#p-vwrap .p-fallback-iframe"); if (ifr) ifr.remove();
    exitFs();
    $("#player").hidden = true;
    $("#p-body").innerHTML = "";
    document.body.style.overflow = "";
  }
  // One clock drives everything: the session timer, the rest countdown and the per-move countdown
  function onTick() {
    if (P.done) return;
    $("#p-timer").textContent = fmtClock(Math.floor((Date.now() - P.start) / 1000));
    if (P.paused) return;
    const st = P.steps[P.i]; if (!st) return;
    if (st.rest) {
      P.left = Math.max(0, P.left - 1);
      const c = $("#p-count"); if (c) c.textContent = P.left;
      const ring = $("#p-ring"); if (ring) ring.style.setProperty("--pct", `${100 - (P.left / P.total) * 100}%`);
      if (P.left <= 0) advance();
    } else if (st.e) {
      P.left++;
      const c = $("#p-count"); if (c) c.textContent = fmtClock(P.left);
      // No "ended" signal for follow-along steps or Drive's fallback player: move on after the set time
      const blind = !st.e.id || $("#p-vwrap .p-fallback-iframe");
      if (blind && P.left >= Math.max(P.total || 0, 20)) advance();
    }
  }
  function advance() { P.i++; skipRests(); renderStep(); }
  function skipRests() { if (!P.opt.breaks) while (P.steps[P.i] && P.steps[P.i].rest) P.i++; }
  function renderStep() {
    const n = P.steps.length;
    if (P.i >= n) return finish();
    const st = P.steps[P.i], next = P.steps.slice(P.i + 1).find((x) => x.e);
    const exNum = P.steps.slice(0, P.i + 1).filter((x) => x.e).length, exTotal = P.steps.filter((x) => x.e).length;
    $("#p-step").textContent = st.e ? `${st.label} · ${exNum} of ${exTotal}` : st.label;
    $("#p-bar").style.width = `${(P.i / n) * 100}%`;
    $("#p-prev").disabled = P.i === 0;
    $("#p-next").textContent = P.i === n - 1 ? "Finish" : st.rest ? "Skip rest" : "Next";
    P.paused = false; $("#p-pause").textContent = "Pause";
    const upNext = next ? `<div class="p-next">Up next: <b>${esc(next.e.name)}</b> · ${esc(next.e.sets)}${next.label !== st.label && next.label === "Cool-down" ? " · cool-down starts" : ""}</div>` : `<div class="p-next">Last one. Finish strong.</div>`;
    const vwrap = $("#p-vwrap"), v = $("#p-video");
    const oldIfr = vwrap.querySelector(".p-fallback-iframe"); if (oldIfr) oldIfr.remove();
    v.hidden = false;
    if (st.rest) {
      vwrap.hidden = true; v.pause();
      P.left = P.total = st.rest;
      $("#p-body").innerHTML = `<div class="p-rest"><p class="p-block">${esc(st.label)}</p><div class="count" id="p-count">${P.left}</div><p>Breathe. Get set for the next move.</p>${upNext}</div>`;
      return;
    }
    const e = st.e;
    P.left = 0; P.total = Gen.stepSecs(e.sets);
    const noVid = !e.id;
    vwrap.hidden = noVid;
    v.muted = !P.opt.sound;
    if (noVid) { v.pause(); v.removeAttribute("src"); v.load(); }
    else v.poster = MDFitVideo.thumb(e.id, 800);
    $("#p-body").innerHTML = `
      <div class="p-info">
        <p class="p-block">${esc(st.label)}</p>
        <h2 class="p-name">${esc(e.name)}</h2>
        <div class="p-setrow">
          <div class="p-ring" id="p-ring" style="--pct:0%"><span id="p-count">0:00</span></div>
          <div><p class="p-sets">${esc(e.sets)}</p><p class="p-meta">${noVid ? "Follow along: no video for this one. Use the timer and go at your own pace." : esc(exMeta(e))}</p></div>
        </div>
        ${st.label.startsWith("Round") || st.label === "Circuit" ? `<label class="p-load">Weight used <input id="p-weight" inputmode="decimal" placeholder="lb" value="${esc((P.log[e.id] || {}).weight || "")}"></label>` : ""}
        ${upNext}
      </div>`;
    if (noVid) return;
    v.loop = false;
    v.src = driveMp4(e.id);
    // No frame within 6 s (Drive refuses the direct MP4, see playVideo; or a stalled download): Drive's player instead
    clearTimeout(P.stall); const si = P.i;
    P.stall = setTimeout(() => { if (P.i === si && !v.hidden && v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && v.onerror) v.onerror(); }, 6000);
    // Seamless sequence: buffer the next exercise video while this one plays
    const nx = P.steps.slice(P.i + 1).find((x) => x.e && x.e.id);
    if (nx && typeof warmVideo === "function") try { warmVideo(nx.e.id, "auto"); } catch {}
    // A browser that blocks sound until a tap: play muted and ask for one tap on Sound
    const pr = v.play(); if (pr) pr.catch((err) => { if (err && err.name === "NotAllowedError" && !v.muted) { v.muted = true; soundBlocked(true); v.play().catch(() => {}); } });
    if (!v.muted) soundBlocked(false);
    const wt = $("#p-weight");
    if (wt) wt.addEventListener("input", () => { P.log[e.id] = { name: e.name, weight: wt.value.trim().slice(0, 12) }; });
  }
  $("#p-pause").addEventListener("click", () => {
    if (P.done) return;
    P.paused = !P.paused;
    $("#p-pause").textContent = P.paused ? "Resume" : "Pause";
    const v = $("#p-video"); if (v) P.paused ? v.pause() : v.play().catch(() => {});
  });
  $("#p-opts").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-opt]"); if (!b) return;
    const k = b.dataset.opt, v = $("#p-video");
    // Sound is on but the browser held it back: this tap turns it on instead of switching it off
    if (k === "sound" && P.opt.sound && v && v.muted && b.classList.contains("blocked")) { v.muted = false; v.play().catch(() => {}); soundBlocked(false); return; }
    P.opt[k] = !P.opt[k]; if (k === "sound") P.opt.soundSet = true; saveOpt(); renderOpts();
    if (k === "sound") { soundBlocked(false); if (v) { v.muted = !P.opt.sound; v.play().catch(() => {}); } }
    if (k === "breaks" && !P.opt.breaks && P.steps[P.i] && P.steps[P.i].rest) { skipRests(); renderStep(); }
  });
  const workoutKey = (w) => w.key || w.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
  async function finish() {
    clearInterval(P.tick);
    const pv = $("#p-video"); if (pv) pv.pause();
    $("#p-vwrap").hidden = true;
    P.done = true;
    const secsUsed = Math.floor((Date.now() - P.start) / 1000), minutes = Math.min(300, Math.max(1, Math.round(secsUsed / 60)));
    $("#p-bar").style.width = "100%";
    $("#p-step").textContent = "Complete";
    $("#p-prev").disabled = true;
    $("#p-next").textContent = "Done";
    $("#p-body").innerHTML = `<div class="p-done"><div class="big-check"><svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></div>
      <h2>Workout complete</h2><p class="muted">${esc(P.w.title)}</p><p class="muted small" id="done-msg">Saving…</p><div id="done-form"></div></div>`;
    const hr = HR.summary(P.start);
    const lifts = Object.values(P.log || {}).filter((l) => l.weight && !isNaN(Number(l.weight))).map((l) => ({ name: l.name, weight: Number(l.weight) }));
    try {
      const r = await apiAuth("POST", "/api/me/workouts", { title: P.w.title.slice(0, 80), goal: P.w.goal, minutes, exercises: Math.min(50, P.w.exercises.length),
        key: workoutKey(P.w), seconds: Math.max(1, Math.min(18000, secsUsed)), lifts, ...(hr ? { hrAvg: hr.avg, hrMax: hr.max, source: HR.name || "Heart-rate strap" } : {}) });
      stats = { ...r.stats, recent: [r.workout, ...((stats && stats.recent) || [])].slice(0, 10) };
      // Heart-rate numbers only appear when a device recorded them; nobody is expected to type them in.
      $("#done-msg").outerHTML = `<div class="stats3"><div><b>${r.stats.streak}</b><span>Day streak</span></div><div><b>${minutes}</b><span>Minutes</span></div><div><b>${r.stats.workouts}</b><span>Workouts</span></div></div>
        ${hr ? `<div class="stats3 dev-stats"><div><b>${hr.avg}</b><span>Avg heart rate</span></div><div><b>${hr.max}</b><span>Max heart rate</span></div><div><b>${esc(HR.name || "Device")}</b><span>Source</span></div></div>` : ""}`;
      allWorkouts.push(r.workout);
      numbersForm($("#done-form"), r.workout, "How hard was that?");
      renderStats(); renderActivity(); renderNotes(); renderCalendar(); renderPerf(); renderMyPlans();
      loadRewards(true);
      document.dispatchEvent(new CustomEvent("mdfit:workout", { detail: r.workout }));
    } catch (err) { $("#done-msg").textContent = "Couldn't save this workout: " + err.message; }
  }

  // ---- Performance: daily vitals + side-by-side comparison of saved workouts
  let vitals = [];
  const VITALS = [["restingHr", "Resting HR", "bpm", -1, true], ["hrv", "HRV", "ms", 1, true], ["vo2max", "VO2 max", "", 1, true], ["weight", "Body weight", "lb", 0, false]];
  const DEVICE_KEYS = ["restingHr", "hrv", "vo2max"];
  // A smart device counts as connected once a heart-rate strap/watch has paired in this browser, or a workout or
  // reading has come in from a device or health app. Until then heart-rate, HRV, VO2 max and calorie fields stay hidden.
  function hasDevice() {
    if (HR.dev) return true;
    try { if (localStorage.getItem("mdfit-device")) return true; } catch {}
    return allWorkouts.some((w) => w.source) || vitals.some((v) => v.source && v.source !== "manual");
  }
  const latestOf = (k) => [...vitals].reverse().find((v) => v[k] !== undefined);
  function spark(k) {
    const pts = vitals.filter((v) => v[k] !== undefined).slice(-30);
    if (pts.length < 2) return "";
    const ys = pts.map((v) => v[k]), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const d = ys.map((y, i) => `${i ? "L" : "M"}${(i / (ys.length - 1)) * 100},${28 - ((y - lo) / span) * 24}`).join(" ");
    return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  function renderPerf() {
    renderCheckin();
    if (!$("#perf-card")) return;
    const dev = hasDevice();
    $(".perf-sub").textContent = dev ? "Heart rate · HRV · VO2 max · weights" : "Body weight · workouts";
    $$(".dev-only", $("#perf-card")).forEach((el) => { el.hidden = !dev; });
    $("#vitals").innerHTML = VITALS.filter(([k, , , , devOnly]) => !devOnly || dev || latestOf(k)).map(([k, label, unit, good]) => {
      const last = latestOf(k), first = vitals.find((v) => v[k] !== undefined);
      const diff = last && first && last !== first ? Math.round((last[k] - first[k]) * 10) / 10 : null;
      const cls = diff === null || !good || !diff ? "" : diff * good > 0 ? "up-good" : "up-bad";
      return `<div class="vital"><span>${label}</span><b>${last ? last[k] : "--"}<small> ${unit}</small></b>${diff !== null ? `<em class="${cls}">${diff > 0 ? "+" : ""}${diff} since ${first.date.slice(5)}</em>` : `<em>${last ? `Logged ${last.date.slice(5)}` : "No readings yet"}</em>`}${spark(k)}</div>`;
    }).join("");
    const ws = [...allWorkouts].reverse();
    const opt = (w) => `<option value="${w.id}">${w.date.slice(5)} · ${esc(w.title)}${w.hrAvg ? ` · ${w.hrAvg} bpm` : ""}</option>`;
    const A = $("#cmp-a"), B = $("#cmp-b"), fresh = renderPerf.n !== ws.length, keepA = fresh ? "" : A.value, keepB = fresh ? "" : B.value;
    renderPerf.n = ws.length;
    A.innerHTML = ws.map(opt).join(""); B.innerHTML = ws.map(opt).join("");
    if (ws.length < 1) { $("#cmp-table").innerHTML = `<p class="muted small">Finish a workout to start comparing sessions.</p>`; $("#cmp-edit-wrap").hidden = true; return; }
    A.value = ws.some((w) => w.id === keepA) ? keepA : ws[0].id;
    const a = ws.find((w) => w.id === A.value);
    const same = ws.find((w) => w.id !== a.id && (w.key ? w.key === a.key : w.title === a.title));
    B.value = ws.some((w) => w.id === keepB) && keepB !== a.id ? keepB : (same || ws.find((w) => w.id !== a.id) || a).id;
    const b = ws.find((w) => w.id === B.value);
    const dur = (w) => w.seconds ? `${Math.floor(w.seconds / 60)}:${String(w.seconds % 60).padStart(2, "0")}` : `${w.minutes} min`;
    const val = (w) => (w.seconds || w.minutes * 60);
    const rows = [["Time", dur, val, -1], ["Avg heart rate", (w) => w.hrAvg && `${w.hrAvg} bpm`, (w) => w.hrAvg, 0], ["Max heart rate", (w) => w.hrMax && `${w.hrMax} bpm`, (w) => w.hrMax, 0],
      ["HRV", (w) => w.hrv && `${w.hrv} ms`, (w) => w.hrv, 1], ["VO2 max", (w) => w.vo2max, (w) => w.vo2max, 1], ["Effort", (w) => w.rpe && `${w.rpe}/10`, (w) => w.rpe, 0], ["Calories", (w) => w.calories, (w) => w.calories, 0]];
    const names = [...new Set([...(a.lifts || []), ...(b.lifts || [])].map((l) => l.name))];
    const liftW = (w, n) => ((w.lifts || []).find((l) => l.name === n) || {}).weight;
    const delta = (x, y, good, fmt = (d) => d) => {
      if (x === undefined || y === undefined || a === b) return "";
      const d = Math.round((x - y) * 10) / 10; if (!d) return `<span class="dz">same</span>`;
      return `<span class="${good ? (d * good > 0 ? "up-good" : "up-bad") : ""}">${d > 0 ? "+" : ""}${fmt(d)}</span>`;
    };
    $("#cmp-table").innerHTML = `<table><thead><tr><th></th><th>${a.date.slice(5)}</th><th>${b.date.slice(5)}</th><th>Change</th></tr></thead><tbody>
      ${rows.filter(([label, show]) => label === "Time" || show(a) || show(b)).map(([label, show, num, good]) => `<tr><th>${label}</th><td>${show(a) ?? "--"}</td><td>${show(b) ?? "--"}</td><td>${delta(num(a), num(b), good, label === "Time" ? (d) => `${Math.round(d)}s` : undefined)}</td></tr>`).join("")}
      ${names.map((n) => `<tr class="lift"><th>${esc(n)}</th><td>${liftW(a, n) ?? "--"}</td><td>${liftW(b, n) ?? "--"}</td><td>${delta(liftW(a, n), liftW(b, n), 1, (d) => `${d} lb`)}</td></tr>`).join("")}
      </tbody></table>${a === b ? `<p class="muted small">Only one session so far. Do this workout again (or save it to My Programs) to compare.</p>` : ""}`;
    $("#cmp-edit-wrap").hidden = false;
    numbersForm($("#cmp-edit"), a, `${a.title} on ${a.date}`);
  }
  // Home daily check-in: weight pre-filled from last reading, one-tap sleep, single save
  const ci = { sleep: null, editing: false };
  const todayKey = () => todayInTz();
  function renderCheckin() {
    const card = $("#checkin"); if (!card) return;
    const f = $("#ci-form"), lastW = latestOf("weight"), today = vitals.filter((v) => v.date === todayKey());
    const tw = [...today].reverse().find((v) => v.weight !== undefined), ts = [...today].reverse().find((v) => v.sleep !== undefined);
    const done = !!(tw || ts) && !ci.editing;
    f.hidden = done; $(".ci-done", card).hidden = !done;
    $("#ci-when").textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (done) {
      const prevW = [...vitals].reverse().find((v) => v.weight !== undefined && v.date !== todayKey());
      const d = tw && prevW ? Math.round((tw.weight - prevW.weight) * 10) / 10 : null;
      $("#ci-summary").innerHTML = [tw ? `<b>${tw.weight} lb</b>${d !== null ? ` <span class="muted">(${d > 0 ? "+" : ""}${d} since ${prevW.date.slice(5)})</span>` : ""}` : "", ts ? `<b>${ts.sleep} h</b> sleep` : ""].filter(Boolean).join(" · ");
      return;
    }
    if (!f.weight.value && lastW) f.weight.value = lastW.weight;
    $("#ci-weight-hint").textContent = lastW ? `Last: ${lastW.weight} lb on ${lastW.date.slice(5)}` : "Optional. Skip it anytime.";
    $$("#ci-sleep button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.h) === ci.sleep)));
  }
  if ($("#checkin")) {
    $("#ci-form").addEventListener("click", (e) => {
      const st = e.target.closest("[data-step]");
      if (st) { const i = $("#ci-form").weight, base = Number(i.value) || Number((latestOf("weight") || {}).weight) || 150; i.value = Math.round((base + Number(st.dataset.step)) * 10) / 10; return; }
      const sb = e.target.closest("[data-h]");
      if (sb) { const h = Number(sb.dataset.h); ci.sleep = ci.sleep === h ? null : h; renderCheckin(); }
    });
    $(".ci-edit").addEventListener("click", () => { ci.editing = true; renderCheckin(); });
    $("#ci-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, msg = $(".ci-msg", f), body = {}, w = f.weight.value.trim();
      if (w) { const n = Number(w); if (!(n >= 50 && n <= 700)) { msg.textContent = "Hmm, that number looks off."; return; } body.weight = n; }
      if (ci.sleep !== null) body.sleep = ci.sleep;
      if (!Object.keys(body).length) { msg.textContent = "Add a weigh-in or tap how you slept."; return; }
      const btn = $(".ci-save", f); btn.disabled = true; msg.textContent = "";
      try { vitals = await apiAuth("POST", "/api/me/vitals", body); ci.editing = false; ci.sleep = null; f.weight.value = ""; renderPerf(); toast("Logged 👍"); loadRewards(true); }
      catch (err) { msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
  }
  $("#cmp-a").addEventListener("change", () => { $("#cmp-b").value = ""; renderPerf(); });
  $("#cmp-b").addEventListener("change", renderPerf);
  $("#vitals-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, body = {};
    ["restingHr", "hrv", "vo2max"].forEach((k) => { const v = f[k].value.trim(); if (v) body[k] = Number(v); });
    try { vitals = await apiAuth("POST", "/api/me/vitals", body); f.reset(); $(".nums-msg", f).textContent = "Saved."; renderPerf(); loadRewards(true); }
    catch (err) { $(".nums-msg", f).textContent = err.message; }
  });

  // Heart rate, HRV, VO2 max and effort for one saved workout (fills in or corrects later)
  function numbersForm(host, w, intro) {
    const f = (k, label, ph, step = 1) => `<label>${label}<input name="${k}" type="number" inputmode="decimal" step="${step}" placeholder="${ph}" value="${w[k] ?? ""}"></label>`;
    host.innerHTML = `<form class="nums-form" novalidate>
      <p class="small">${esc(intro)}</p>
      ${hasDevice() ? `<div class="nums-grid">${f("hrAvg", "Avg heart rate", "bpm")}${f("hrMax", "Max heart rate", "bpm")}${f("hrv", "HRV", "ms")}${f("vo2max", "VO2 max", "ml/kg/min", 0.1)}${f("calories", "Calories", "kcal")}</div>` : ""}
      <div class="rpe" role="radiogroup" aria-label="Effort, 1 easy to 10 max">${Array.from({ length: 10 }, (_, i) => `<button type="button" role="radio" data-rpe="${i + 1}" class="${w.rpe === i + 1 ? "on" : ""}">${i + 1}</button>`).join("")}</div>
      <p class="rpe-cap small muted">Effort: 1 = easy, 10 = all-out</p>
      <button class="btn-gold sm" type="submit">Save</button><span class="nums-msg small"></span></form>`;
    const form = $("form", host); let rpe = w.rpe;
    form.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-rpe]"); if (!b) return;
      rpe = Number(b.dataset.rpe);
      $$("[data-rpe]", form).forEach((x) => x.classList.toggle("on", x === b));
      // Auto-save the effort rating as soon as it's tapped so it doesn't get lost if the
      // player drawer closes before "Save" is tapped. HR/calorie fields still need the Save button.
      const m = $(".nums-msg", form); if (m) m.textContent = "Saving effort…";
      try {
        const up = await apiAuth("PATCH", `/api/me/workouts/${w.id}`, { rpe });
        Object.assign(w, up); const i = allWorkouts.findIndex((x) => x.id === w.id); if (i >= 0) allWorkouts[i] = up;
        if (m) m.textContent = `Effort ${rpe}/10 saved ✓`;
      } catch (err) { if (m) m.textContent = err.message; }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {}; ["hrAvg", "hrMax", "hrv", "vo2max", "calories"].forEach((k) => { const v = form[k] && form[k].value.trim(); if (v) body[k] = Number(v); });
      if (rpe) body.rpe = rpe;
      try {
        const up = await apiAuth("PATCH", `/api/me/workouts/${w.id}`, body);
        Object.assign(w, up); const i = allWorkouts.findIndex((x) => x.id === w.id); if (i >= 0) allWorkouts[i] = up;
        renderPerf(); // may redraw this form, so confirm on whichever form is showing now
        const m = $(".nums-msg", host); if (m) m.textContent = "Saved.";
      } catch (err) { $(".nums-msg", form).textContent = err.message; }
    });
  }

  // Bluetooth heart-rate straps and watches that broadcast HR (Chrome on Android, Mac, Windows; not iPhone Safari)
  const HR = {
    dev: null, name: "", bpm: 0, samples: [],
    supported: () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice),
    async connect() {
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
      const ch = await (await (await dev.gatt.connect()).getPrimaryService("heart_rate")).getCharacteristic("heart_rate_measurement");
      ch.addEventListener("characteristicvaluechanged", (e) => {
        const d = e.target.value, bpm = d.getUint8(0) & 1 ? d.getUint16(1, true) : d.getUint8(1);
        HR.bpm = bpm; HR.samples.push([Date.now(), bpm]); if (HR.samples.length > 20000) HR.samples.shift();
        const el = $("#p-hr b"); if (el) el.textContent = bpm;
      });
      await ch.startNotifications();
      dev.addEventListener("gattserverdisconnected", () => { HR.dev = null; HR.bpm = 0; renderHrBtn(); });
      HR.dev = dev; HR.name = dev.name || "Heart-rate strap"; renderHrBtn();
      try { localStorage.setItem("mdfit-device", HR.name); } catch {}
      renderPerf();
    },
    summary(since) {
      const xs = HR.samples.filter(([t]) => t >= since).map(([, b]) => b).filter((b) => b >= 30 && b <= 230);
      return xs.length < 5 ? null : { avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), max: Math.max(...xs) };
    }
  };
  function renderHrBtn() {
    const b = $("#p-hr"); if (!b) return;
    b.hidden = !HR.supported();
    b.classList.toggle("on", !!HR.dev);
    b.innerHTML = HR.dev ? `♥ <b>${HR.bpm || "--"}</b> bpm` : "♥ Connect heart rate";
  }
  $("#p-hr").addEventListener("click", () => { if (!HR.dev) HR.connect().catch((err) => { if (err.name !== "NotFoundError") toast("Couldn't connect: " + err.message); }); });
  renderHrBtn();

  $("#p-next").addEventListener("click", () => { if (P.done) return closePlayer(); advance(); });
  $("#p-prev").addEventListener("click", () => {
    if (P.done || P.i === 0) return;
    P.i--;
    while (P.i > 0 && P.steps[P.i].rest) P.i--; // back skips over rest screens
    renderStep();
  });
  $("#p-close").addEventListener("click", () => { if (P.done || confirm("End this workout? It won't be saved.")) closePlayer(); });

  // ================= Messages with Dr. Jared (members): poll while open, unread badge otherwise
  let msgPoll = null, msgCount = -1;
  const fmtWhen = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // Messenger: an inbox of conversations (Dr. Jared, live Q&A, 1-on-1 sessions), then the chat itself
  const ago = (iso) => {
    if (!iso) return "";
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return "now"; if (d < 3600) return Math.floor(d / 60) + "m"; if (d < 86400) return Math.floor(d / 3600) + "h";
    if (d < 7 * 86400) return Math.floor(d / 86400) + "d";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  let msgData = null, inThread = false;
  async function renderInbox() {
    let d; try { d = await apiAuth("GET", "/api/me/messages"); } catch { return; }
    msgData = d;
    if (!C) await (contentLoading || loadContent()).catch(() => {});
    const last = d.messages[d.messages.length - 1];
    const rows = [];
    rows.push(`<button type="button" class="convo${d.unread ? " unread" : ""}" data-open="dr">
      <span class="av av-dr"><img src="assets/logo.webp" alt=""></span>
      <span class="cv-main"><b>Dr. Jared Caban</b><span class="cv-prev">${last ? `${last.from === "client" ? "You: " : ""}${esc(last.body)}` : d.member ? "<i>Say hi. Ask about your pain or plan.</i>" : "<i>Members can message Dr. Jared</i>"}</span>
        <span class="cv-tags"><em class="tag">Direct</em>${d.member ? "" : `<em class="tag lock">Members</em>`}</span></span>
      <span class="cv-side"><time>${last ? ago(last.at) : ""}</time>${d.unread ? `<i class="cv-badge">${d.unread}</i>` : ""}</span></button>`);
    const L = C && C.live;
    if (L) {
      const has = L.date && L.date >= todayInTz();
      rows.push(`<button type="button" class="convo" data-goto="learn">
        <span class="av av-cam"><svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z"/></svg></span>
        <span class="cv-main"><b>${esc(L.title)}</b><span class="cv-prev"><i>${has ? `Next live: ${esc(fmtDate(L.date, { weekday: "short", month: "short", day: "numeric" }))}, ${esc(fmtTime(L.time))}` : "Next date coming soon"}</i></span>
          <span class="cv-tags"><em class="tag">Live</em>${L.locked ? `<em class="tag lock">Members</em>` : ""}</span></span>
        <span class="cv-side"><time>${has ? esc(fmtDate(L.date, { month: "short", day: "numeric" })) : ""}</time></span></button>`);
    }
    if (C && C.access === "premium") {
      const m = await apiAuth("GET", "/api/me/meetings").catch(() => null);
      const nx = m && m.meetings.find((x) => x.status === "scheduled");
      rows.push(`<button type="button" class="convo" data-goto="premium">
        <span class="av av-cam"><svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z"/></svg></span>
        <span class="cv-main"><b>1-on-1 with Dr. Jared</b><span class="cv-prev"><i>${nx ? `Scheduled: ${esc(nx.when)}` : m ? `${Math.max(0, m.allowance - m.usedThisMonth)} of ${m.allowance} sessions left this month` : "Request a session"}</i></span>
          <span class="cv-tags"><em class="tag">1-on-1</em></span></span>
        <span class="cv-side"><time></time></span></button>`);
    }
    $("#convos").innerHTML = rows.join("");
    setBadge(d.unread);
  }
  const REACTS = ["👍", "❤️", "😂", "🙏", "💪", "😮"];
  $("#chat-list").addEventListener("click", async (e) => {
    const b = e.target.closest(".bubble"); if (!b) return;
    if (e.target.closest(".react-add")) {
      $$("#chat-list .react-pick").forEach((p) => { if (p !== b.querySelector(".react-pick")) p.hidden = true; });
      const p = b.querySelector(".react-pick"); p.hidden = !p.hidden; return;
    }
    const pick = e.target.closest("[data-emoji]"); if (!pick) return;
    try { await apiAuth("POST", `/api/me/messages/${encodeURIComponent(b.dataset.mid)}/react`, { emoji: pick.dataset.emoji }); loadMessages(false); earn("reaction", b.dataset.mid); }
    catch { toast("Couldn't add that reaction."); }
  });
  if (window.MDFitRT) MDFitRT.on("message_reaction", () => { if (inThread) loadMessages(false); });
  async function loadMessages(scroll) {
    let d; try { d = await apiAuth("GET", "/api/me/messages"); } catch { return; }
    msgData = d;
    $("#msg-gate").hidden = d.member;
    $("#chat-form").hidden = !d.member;
    $("#chat").hidden = !d.member && !d.messages.length;
    const list = $("#chat-list");
    let lastDay = "";
    list.innerHTML = d.messages.length ? d.messages.map((m) => {
      const day = new Date(m.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const sep = day !== lastDay ? `<p class="day-sep">${day}</p>` : ""; lastDay = day;
      const r = m.reactions || {}, shown = [r.client, r.doctor].filter(Boolean);
      return `${sep}<div class="bubble ${m.from === "client" ? "me" : "dr"}" data-mid="${esc(m.id)}"><p>${esc(m.body).replace(/\n/g, "<br>")}</p><span>${new Date(m.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${m.from === "client" && m.read ? " · Seen" : ""}</span>${shown.length ? `<div class="reacts">${shown.map((e) => `<b>${e}</b>`).join("")}</div>` : ""}<button type="button" class="react-add" aria-label="React">☺+</button><div class="react-pick" hidden>${REACTS.map((e) => `<button type="button" data-emoji="${e}" class="${r.client === e ? "on" : ""}">${e}</button>`).join("")}</div></div>`;
    }).join("")
      : `<p class="muted small chat-empty">Start the conversation. Tell Dr. Jared what's going on, where it hurts, or what you'd like help with.</p>`;
    if (scroll || d.messages.length !== msgCount) list.scrollTop = list.scrollHeight;
    msgCount = d.messages.length;
    if (d.unread) { await apiAuth("POST", "/api/me/messages/read", {}).catch(() => {}); setBadge(0); }
  }
  function showThread(on) {
    inThread = on; $("#inbox").hidden = on; $("#thread").hidden = !on;
    if (on) loadMessages(true); else renderInbox();
  }
  function openMessages() {
    showThread(location.hash === "#messages/dr");
    clearInterval(msgPoll); msgPoll = setInterval(() => { if (!document.hidden) (inThread ? loadMessages(false) : renderInbox()); }, 20000);
  }
  $("#convos").addEventListener("click", (e) => { if (e.target.closest('[data-open="dr"]')) { history.pushState(null, "", "#messages/dr"); showThread(true); } });
  $("#msgr-new").addEventListener("click", () => { history.pushState(null, "", "#messages/dr"); showThread(true); setTimeout(() => $("#chat-form textarea").focus(), 50); });
  $("#msgr-back").addEventListener("click", () => { history.pushState(null, "", "#messages"); showThread(false); });
  const growTA = (t) => { t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; };
  $("#chat-form textarea").addEventListener("input", (e) => growTA(e.target));
  function setBadge(n) { const b = $("#msg-badge"); b.hidden = !n; b.textContent = n > 9 ? "9+" : n; $("#more-btn").classList.toggle("has-badge", !!n); const ml = $('#more-list [data-goto="messages"]'); if (ml) ml.dataset.badge = n || ""; }
  const pollUnread = () => apiAuth("GET", "/api/me/messages/unread-count").then((r) => { setBadge(r.unread); notifyMessages(r.unread); renderNotes(); }).catch(() => {});
  if (window.MDFitRT) MDFitRT.on("new_message", () => { if (inThread) loadMessages(false); else pollUnread(); });
  setInterval(() => { if (!document.hidden && $("#view-messages").hidden) pollUnread(); }, 60000);
  $("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target, body = f.body.value.trim(); if (!body) return;
    const btn = $("button", f); btn.disabled = true;
    try { await apiAuth("POST", "/api/me/messages", { body }); f.reset(); growTA(f.body); loadMessages(true); earn("message"); }
    catch (err) { if (/membership/i.test(err.message)) showPaywall("Messaging Dr. Jared is part of membership."); else toast(err.message); }
    finally { btn.disabled = false; }
  });
  $("#chat-form textarea").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#chat-form").requestSubmit(); });

  // ================= Paywall: subscribe, with 30% off the first month for leaving a review
  function renderAccessBadge() {
    const b = $("#free-badge"); if (!b) return;
    b.hidden = access.member;
    b.innerHTML = access.member ? "" : access.freeUsed
      ? `Free account · <button type="button" class="link-sm" data-paywall>Unlock unlimited workouts</button>`
      : `Free account · <b>1 free workout</b> to generate · Pain tools are always free`;
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-paywall]")) showPaywall(); });
  async function showPaywall(reason) {
    if (!C) await (contentLoading || loadContent()).catch(() => {});
    const d = $("#paywall"), tier = C && C.tiers && C.tiers[0], pct = 30;
    const code = access.reviewCode || store.get("mdfit_review_code", null);
    $("#pw-reason").textContent = reason || "You've used your free workout.";
    $("#pw-price").innerHTML = tier ? `Membership from <b>$${tier.price}/month</b>${code ? ` · <span class="pw-deal">$${(tier.price * (100 - pct) / 100).toFixed(2)} your first month</span>` : ""}` : "";
    $("#pw-form").hidden = !!code;
    $("#pw-have").hidden = !code;
    if (code) $("#pw-code").textContent = code;
    d.showModal();
  }
  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target, msg = $(".nums-msg", f);
    const rating = Number((f.querySelector("[name=pwrating]:checked") || {}).value || 0);
    if (!rating) { msg.textContent = "Tap the stars first."; return; }
    try {
      const r = await api("/api/feedback", { name: client.name, email: client.email, rating, text: f.text.value, publish: f.publish.checked });
      access.reviewCode = r.rewardCode; store.set("mdfit_review_code", r.rewardCode);
      showPaywall($("#pw-reason").textContent);
    } catch (err) { msg.textContent = err.message; }
  });
  $("#pw-subscribe").addEventListener("click", () => { $("#paywall").close(); go("premium"); });

  // ================= Member content: programs, lectures + live Q&A, membership & 1-on-1, health tips
  let C = null, contentLoading = null;
  // Programs saved without a photo borrow the closest existing one; the rest draw a branded poster (never a blank box)
  const PROG_ART = [[/mobility/i, "assets/programs/mobility-ladder-new.png"], [/low back|mid-back|lumbar/i, "assets/programs/low-back-new.png"],
    [/hip/i, "assets/programs/hip-new.png"], [/shoulder|rotator/i, "assets/programs/shoulder-new.png"], [/golf/i, "assets/programs/golf-new.png"],
    [/pickleball/i, "assets/programs/pickleball.png"], [/marathon/i, "assets/programs/marathon-new.png"], [/running/i, "assets/programs/running-new.png"],
    [/\bski/i, "assets/programs/ski.png", true]]; // true = the poster already carries its title text; draw nothing over it
  const COMPLETE_POSTERS = new Set([...PROG_ART.filter((x) => x[2]).map((x) => x[1]), "assets/programs/mobility-ladder-poster.png"]);
  const withArt = (d) => { (d && d.programs || []).forEach((p) => { if (!p.image) { const m = PROG_ART.find(([re]) => re.test(p.title || "")); if (m) p.image = m[1]; } }); return d; };
  const loadContent = () => (contentLoading = apiAuth("GET", "/api/me/content").then((d) => (C = withArt(d))).catch(() => api("/api/content").then((d) => (C = withArt({ ...d, access: "free" })))));
  const money = (n) => "$" + Number(n).toLocaleString("en-US");
  const lockBadge = `<span class="lock" title="Members"><svg viewBox="0 0 24 24"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4z"/></svg> Members</span>`;
  const unlockBtn = (what) => `<button type="button" class="btn-gold sm" data-goto="premium">Unlock ${what} with a membership</button>`;
  async function renderContent(tab, sub) {
    if (!C) { await (contentLoading || loadContent()); }
    if (!C) return;
    ({ programs: renderProgramsView, learn: renderLearn, premium: renderPremium, tips: renderTips })[tab](sub);
  }

  // ---- Featured programs: visible to every member (free + paid) on three surfaces so patients who don't know
  // where to start always see Dr. Jared's guided plans. Primary audience is people in pain / unsure what to do,
  // so these pre-made programs are the main conversion lever.
  // Program posters are ~2.5 MB PNGs; serve the WebP size that fits the slot (scripts/program-images.py makes them).
  // If a web copy is missing, fall back to the original instead of dropping the image.
  const progImg = (src, cls, sizes, thumb) => {
    const m = /^\/?assets\/programs\/([\w-]+)\.png$/.exec(src || "");
    const c = cls ? ` class="${cls}"` : "";
    if (!m) return `<img${c} src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`;
    const at = (w) => `assets/programs/web/${m[1]}-${w}.webp`, th = (w) => `assets/programs/web/${m[1]}-thumb-${w}.webp`;
    // Fallbacks, in order: drop the thumb <source>s, then the srcset (use the PNG), then the image itself
    const img = `<img${c} src="${at(640)}" srcset="${at(192)} 192w, ${at(640)} 640w, ${at(1200)} 1200w" sizes="${sizes}" alt="" loading="lazy" decoding="async"`
      + ` onerror="var p=this.parentNode;if(p&&p.tagName==='PICTURE'&&p.querySelector('source')){p.querySelectorAll('source').forEach(function(s){s.remove()})}else if(this.srcset){this.removeAttribute('srcset');this.src='${m[0]}'}else this.remove()">`;
    if (!thumb) return img;
    // Small thumbnails use the square crop of the person (scripts/program-images.py), not the whole poster shrunk down:
    // thumb = { sizes } always, or { media, sizes } only when the media query matches (e.g. phones)
    return `<picture><source${thumb.media ? ` media="${thumb.media}"` : ""} srcset="${th(192)} 192w, ${th(384)} 384w" sizes="${thumb.sizes}">${img}</picture>`;
  };
  // Program photo with the poster text drawn in HTML on top (the photos carry no text of their own). The text is
  // aria-hidden because the card repeats the title for screen readers; it hides itself when the photo is too small.
  const progPoster = (p, cls, sizes, thumb) => `<span class="prog-poster ${cls}${p.image ? "" : " pp-blank"}">${p.image ? progImg(p.image, "", sizes, thumb) : ""}`
    + (COMPLETE_POSTERS.has(String(p.image || "").replace(/^\//, "")) ? "" : `<span class="pp-text" aria-hidden="true">`
    + `<span class="pp-brand"><i>MD</i> FIT${p.category ? " · " + esc(p.category) : ""}</span>`
    + `<span class="pp-title">${esc(String(p.title || "").replace(/^\s*\d+\s*-?\s*weeks?\s*/i, "") || p.title)}</span>`
    + (p.weeks ? `<span class="pp-badge">${esc(p.weeks)}-week program</span>` : "") + `</span>`) + `</span>`;
  function renderFeaturedPrograms() {
    if (!C || !C.programs || !C.programs.length) {
      ["#featured-progs", "#hero-progs"].forEach((s) => { const el = $(s); if (el) el.hidden = true; });
      return;
    }
    // Pick a spread across categories (rehab, sport, mobility, strength) so patients see the full breadth
    const pick = (cat, n) => C.programs.filter((p) => p.category === cat).slice(0, n);
    const featured = [
      ...pick("Rehab Protocols", 2),
      ...pick("Sport Performance", 1),
      ...pick("Mobility", 1),
      ...pick("Strength", 1)
    ].filter(Boolean).slice(0, 5);
    const sidebar = featured.length ? featured : C.programs.slice(0, 5);
    // Hero + profile grids show up to 6 big cards with images; sidebar stays compact at 5 rows.
    const heroList = featured.length ? [...featured, ...C.programs.filter((p) => !featured.includes(p))].slice(0, 6) : C.programs.slice(0, 6);

    const sb = $("#featured-progs"), hero = $("#hero-progs"); // programs live on Home and the Programs tab, not on Profile
    if (sb) {
      sb.hidden = false;
      $("#featured-prog-list").innerHTML = sidebar.map((p) => `
        <li><button type="button" class="fp-item" data-fp="${esc(p.id)}">
          ${p.image ? progImg(p.image, "", "44px", { sizes: "44px" }) : `<span class="fp-ic pp-blank"></span>`}
          <span class="fp-body"><b>${esc(p.title)}</b><span class="muted small">${p.weeks} wks · ${esc(p.level || "all levels")}${p.category ? " · " + esc(p.category) : ""}</span></span>
        </button></li>`).join("");
    }
    const bigCard = (p) => `<button type="button" class="hp-card" data-fp="${esc(p.id)}">
      ${progPoster(p, "hp-img", "(max-width: 820px) 88px, 320px", { media: "(max-width: 820px)", sizes: "88px" })}
      <span class="hp-cat">${esc(p.category || "Program")}</span>
      <b>${esc(p.title)}</b>
      <span class="muted small hp-meta">${p.weeks} weeks · ${esc(p.level || "all levels")}${p.days && p.days.length ? ` · ${freqLabel(p).replace("/week", "/wk")}` : ""}</span>
      ${p.summary ? `<span class="hp-sum small">${esc(p.summary.slice(0, 100))}${p.summary.length > 100 ? "…" : ""}</span>` : ""}
      <span class="hp-go">Start this program →</span>
    </button>`;
    if (hero) { hero.hidden = false; $("#hero-prog-grid").innerHTML = heroList.map(bigCard).join(""); }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fp]"); if (!b) return;
    go("programs/" + b.dataset.fp);
  });

  // ---- Programs: each day is a generator session with a fixed seed, so the same session repeats each week and can be compared
  let progCat = "All";
  // Program exercises named differently from the library -> the library video that shows the same move
  const VIDEO_ALIAS = {
    "Overhead Press (DB)": "Strict Press", "Dumbbell Bench Press": "Bench Press", "Lat Pull-Down": "Lat Pulldown", "Lat Pulldowns": "Lat Pulldown",
    "GHD or BOSU Sit-Ups": "GHD Sit Up", "TRX Body Squat": "TRX Squat", "Hip Thrusts": "Hip Thrust", "RDLs": "Romanian Deadlift",
    "Bulgarian Split Squats": "Bulgarian Split Squat", "Split Squat": "Bulgarian Split Squat", "Walking Lunges": "Walking Lunge", "Forward/Backward Lunge": "Lunges",
    "Dumbbell Rows": "Dumbbell Row", "Incline DB Press": "Incline Bench Press", "Face Pulls": "Face Pull", "Mobility Flow": "Seated Mobility Flow Beginner",
    "Stretch & Mobility": "Seated Mobility Flow Beginner", "Breath Work": "Box Breathing", "Sumo Deadlifts": "Sumo Deadlift", "Step-Ups": "Step Up",
    "Cable Pull-Throughs": "Cable Pull Through", "Glute Kickbacks": "Quadruped Glute Kick", "Landmine Press": "Landmine Press Twist",
    "Seated Cable Row": "Cable Row", "Banded Row": "Dumbbell Row", // "Row" is the rowing machine
    "Lateral Raises": "Lateral Raise", "Plank Variation": "Dynamic Plank", "Sled Push": "Sled Push Pull",
    "Kettlebell Swings": "Kettlebell Swing", "Farmer Carries": "Farmer Carry", "Med Ball Slams": "Med Ball Slam", "Scalene Release": "Standing Scalene Stretch",
    "Rotator Cuff Int/Ext Rotation": "Rotator Cuff External Rotation", "Repeated Shoulder Drop Stretch": "Shoulder Drop Hold",
    "Shoulder Packing Drill": "Floor Slide Scapular Retract", "Scapular Retraction": "Floor Slide Scapular Retract",
    "Hip Dip (Eccentric Control)": "Table Eccentric Hip Drop", "Standing Hip Dip": "Table Eccentric Hip Drop", "Bridge Holds": "Single Leg Glute Bridge",
    "Glute Bridge": "Single Leg Glute Bridge", "Single-Leg Glute Bridge": "Single Leg Glute Bridge", "Standing Hip Hinge": "Dowel Hip Hinge",
    "Cat-Camel": "Cat Cow Desk Variation", "Wall-Supported Hip/Glute Activation": "Constant Glute Engagement", "Couch Stretch w/ Glute Engage": "Couch Stretch",
    "Golf Address Posture Hold": "Standing Posture Reset", "Seated Thoracic Rotation": "Thoracic Rotation Seated", "Golf Club Across-Chest Rot": "Thoracic Rotation Seated",
    "Walkout": "Walk Out", "Open Book Rotation": "Thoracic Open Book", "Assisted Cossack Squat": "Cossack Squat", "Lateral Lunge": "Cossack Squat",
    "Incline Push-Up": "Wall Push Up", "Knee Circles (Dynamic)": "Knee Circles", "Supported Single-Leg RDL": "Glute RDL"
  };
  const progDayWorkout = (p, i) => {
    const d = p.days[i];
    const hasCircuit = Array.isArray(d.circuit) && d.circuit.length;
    const w = Gen.generate({ fixed: true, goal: d.goal, location: p.location, level: p.level, length: d.length, ...Gen.presetFor(d.length),
      ...(d.rounds ? { rounds: d.rounds } : {}), ...(d.restEx !== undefined ? { restEx: d.restEx } : {}), ...(d.restRound !== undefined ? { restRound: d.restRound } : {}),
      addons: { warmup: !hasCircuit, cooldown: !hasCircuit }, seed: p.seed + (d.seedOffset || 0) + i * 101 });
    // Fixed circuit: use exactly the exercises Dr. Jared specified (looked up by name)
    if (Array.isArray(d.circuit) && d.circuit.length) {
      const byName = Object.fromEntries(EX.map((e) => [e.name, e]));
      const chosen = d.circuit.map((x) => { const m = byName[x.ex] || byName[VIDEO_ALIAS[x.ex]]; return m ? { ...m, name: x.ex, sets: x.sets || "" } : { id: "", name: x.ex, sets: x.sets || "" }; }).filter((x) => x.name);
      if (chosen.length) w.circuit = chosen;
    }
    return { ...w, title: `${p.title}: ${d.name}`, levelLabel: lvlName(p.level), key: `prog-${p.id}-d${i}`, noRest: REHAB_CATS.has(p.category) };
  };
  const doneCount = (p, i) => allWorkouts.filter((w) => w.key === `prog-${p.id}-d${i}`).length;
  // Programs are navigated like folders, each step with its own address (back button and links work):
  //   #programs                          all programs; each sport is one folder card
  //   #programs/sport/<Sport>            the sport's levels (Beginner / Intermediate / Advanced)
  //   #programs/sport/<Sport>/<level>    only when a level has more than one program
  //   #programs/<id>                     a program; week-by-week protocols list their weeks
  //   #programs/<id>/<week key>          one week of a protocol
  const LEVEL_ORDER = ["beginner", "intermediate", "advanced", "elite"];
  const sportOf = (p) => p.sport || (p.category === "Sport Performance" ? p.title.split(/\s+/)[0] : "");
  const isSport = (p) => p.category === "Sport Performance" && !!sportOf(p);
  const sportPrograms = (sp) => C.programs.filter((p) => isSport(p) && sportOf(p) === sp);
  // Stored levels stay beginner/intermediate/advanced/elite; members see Beginner · Intermediate · Expert · Pro
  const LEVEL_NAMES = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Expert", elite: "Pro" };
  const lvlName = (l) => LEVEL_NAMES[l] || (l ? l[0].toUpperCase() + l.slice(1) : "");
  const enc = encodeURIComponent;
  // "6 weeks" when each part is one week; otherwise "13 parts" (e.g. Baseline, Week 0, Weeks 1-10, Weeks 11-12)
  const partsLabel = (n, p) => `${n} ${n === p.weeks ? (n === 1 ? "week" : "weeks") : (n === 1 ? "part" : "parts")}`;
  const sportHref = (sp, lvl) => `programs/sport/${enc(sp)}${lvl ? "/" + lvl : ""}`;
  function crumbs(parts) {
    return `<nav class="crumbs" aria-label="You are here">${parts.map(([label, href], i) => (i < parts.length - 1
      ? `<button type="button" class="crumb" data-goto="${esc(href)}">${esc(label)}</button><span class="crumb-sep" aria-hidden="true">›</span>`
      : `<span class="crumb now" aria-current="page">${esc(label)}</span>`)).join("")}</nav>`;
  }
  const progCrumbs = (p) => {
    const sp = isSport(p) && sportOf(p);
    if (!sp) return [["Programs", "programs"], [p.title, `programs/${p.id}`]];
    // A level with several programs (e.g. Marathon › Advanced) gets its own list page between the sport and the program
    const shared = sportPrograms(sp).filter((x) => x.level === p.level).length > 1;
    return [["Programs", "programs"], [sp, sportHref(sp)], ...(shared ? [[lvlName(p.level), sportHref(sp, p.level)], [p.title, `programs/${p.id}`]] : [[lvlName(p.level), `programs/${p.id}`]])];
  };
  const progStats = (p) => {
    const isProto = PROTO.ids.has(p.id), nWeeks = isProto ? ((PROTO.weekCounts || {})[p.id] || p.weeks) : 0;
    const weeksStarted = isProto ? new Set(allWorkouts.filter((w) => String(w.key || "").startsWith(`prog-${p.id}-w`)).map((w) => w.key)).size : 0;
    const sessions = isProto ? nWeeks : perWeekTotal(p) || p.weeks * p.days.length, done = isProto ? weeksStarted : p.days.reduce((n, _, i) => n + doneCount(p, i), 0);
    return { isProto, nWeeks, sessions, done };
  };
  // Programs paced week by week (perWeek: sessions in week 1, 2, …, e.g. the Mobility Ladder's 1, 2, 2, 3, 3) instead of a fixed days × weeks grid
  const perWeekTotal = (p) => (Array.isArray(p.perWeek) && p.perWeek.length ? p.perWeek.reduce((n, x) => n + Number(x || 0), 0) : 0);
  const freqLabel = (p) => { const pw = Array.isArray(p.perWeek) && p.perWeek.length ? p.perWeek.map(Number) : null; if (!pw) return `${p.days.length} day${p.days.length === 1 ? "" : "s"}/week`; const lo = Math.min(...pw), hi = Math.max(...pw); return lo === hi ? `${lo}×/week` : `${lo} to ${hi}×/week`; };
  // Which week (1-based) and which session of that week the n-th finished session (0-based) falls in
  const perWeekPos = (p, done) => { const pw = p.perWeek.map(Number); let left = done; for (let w = 0; w < pw.length; w++) { if (left < pw[w]) return { week: w + 1, session: left + 1, of: pw[w] }; left -= pw[w]; } return { week: pw.length, session: pw[pw.length - 1], of: pw[pw.length - 1], complete: true }; };
  const perWeekPlan = (p) => { const pw = p.perWeek.map(Number), parts = []; for (let i = 0; i < pw.length;) { let j = i; while (j + 1 < pw.length && pw[j + 1] === pw[i]) j++; const n = pw[i], times = n === 1 ? "once" : n === 2 ? "twice" : `${n} times`; parts.push(`${i === j ? `Week ${i + 1}` : `Weeks ${i + 1}-${j + 1}`}: ${times}`); i = j + 1; } return parts.join(" · "); };
  const progBar = (st) => (st.done ? `<span class="pc-bar"><i style="width:${Math.min(100, Math.round((st.done / st.sessions) * 100))}%"></i></span><span class="pc-done">${st.done} of ${st.sessions} ${st.isProto ? "weeks started" : "sessions done"}</span>` : "");
  function programCard(p, opts = {}) {
    const st = progStats(p);
    return `<button type="button" class="prog-card prog-card-img" data-goto="programs/${p.id}">
        ${progPoster(p, "pc-img", "(max-width: 700px) 100vw, 50vw")}
        <span class="pc-cat">${esc(opts.kicker || p.category)}</span>${p.locked ? lockBadge : ""}
        <b>${esc(opts.title || p.title)}</b><p>${esc(p.summary)}</p>
        <span class="pc-meta">${st.isProto ? `${partsLabel(st.nWeeks, p)} · week-by-week plan` : `${p.weeks} weeks · ${freqLabel(p)}`} · ${esc(lvlName(p.level))} · ${esc((Gen.LOCATIONS.find((l) => l.id === p.location) || {}).label || "")}</span>
        ${progBar(st)}
      </button>`;
  }
  function sportCard(sp) {
    const ps = sportPrograms(sp), levels = LEVEL_ORDER.filter((l) => ps.some((p) => p.level === l)), img = ps.find((p) => p.image);
    return `<button type="button" class="prog-card folder-card${img ? " prog-card-img" : ""}" data-goto="${esc(sportHref(sp))}">
        ${img ? progPoster(img, "pc-img", "(max-width: 700px) 100vw, 50vw") : ""}
        <span class="pc-cat">Sport Performance</span>
        <b>${esc(sp)}</b><p>${levels.length > 1 ? `Choose your level: ${levels.map(lvlName).join(" · ")}` : esc((ps[0] || {}).summary || "")}</p>
        <span class="pc-meta">${levels.length} ${levels.length === 1 ? "level" : "levels"} · open folder ›</span>
      </button>`;
  }
  function renderSportFolder(sp, level) {
    const ps = sportPrograms(sp);
    if (!ps.length) { go("programs"); return; }
    $("#prog-grid").hidden = true; $("#prog-cats").hidden = true; $("#prog-detail").hidden = false;
    const box = $("#prog-detail"); box.dataset.id = "";
    const levels = LEVEL_ORDER.filter((l) => ps.some((p) => p.level === l)).concat([...new Set(ps.map((p) => p.level))].filter((l) => !LEVEL_ORDER.includes(l)));
    if (level) {
      const at = ps.filter((p) => p.level === level);
      box.innerHTML = `${crumbs([["Programs", "programs"], [sp, sportHref(sp)], [lvlName(level), ""]])}<div class="prog-grid">${at.map((p) => programCard(p)).join("")}</div>`;
      return;
    }
    box.innerHTML = `${crumbs([["Programs", "programs"], [sp, ""]])}
      <div class="card prog-head"><span class="pc-cat">Sport Performance</span><h2>${esc(sp)}</h2><p class="muted">Pick your level. Each level is its own program, week by week.</p></div>
      <div class="level-list">${levels.map((l) => {
        const at = ps.filter((p) => p.level === l), one = at.length === 1 ? at[0] : null, st = one ? progStats(one) : null;
        return `<button type="button" class="level-card lvl-${esc(l)}" data-goto="${esc(one ? `programs/${one.id}` : sportHref(sp, l))}">
          <span class="lc-level">${esc(lvlName(l))}</span>
          <b>${esc(one ? one.title : `${at.length} programs`)}</b>
          ${one ? `<p>${esc(one.summary)}</p><span class="pc-meta">${st.isProto ? `${partsLabel(st.nWeeks, one)} · week-by-week plan` : `${one.weeks} weeks · ${freqLabel(one)}`}</span>${progBar(st)}` : ""}
          <span class="lc-go" aria-hidden="true">›</span></button>`;
      }).join("")}</div>`;
  }
  function renderProgramsView(path) {
    const seg = String(path || "").split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
    if (!C) return renderContent("programs", path); // opened before the program list arrived: wait for it, then render
    if (seg[0] === "sport" && seg[1]) return renderSportFolder(seg[1], seg[2]);
    const cats = ["All", ...C.categories.filter((c) => C.programs.some((p) => p.category === c))];
    $("#prog-cats").innerHTML = cats.map((c) => `<button type="button" class="chip" data-pcat="${esc(c)}" aria-selected="${c === progCat}">${esc(c)}</button>`).join("");
    const list = C.programs.filter((p) => progCat === "All" || p.category === progCat);
    const sports = [...new Set(list.filter(isSport).map(sportOf))].sort();
    $("#prog-grid").innerHTML = list.filter((p) => !isSport(p)).map((p) => programCard(p)).join("") + sports.map(sportCard).join("");
    const open = seg[0] && C.programs.find((p) => p.id === seg[0]);
    $("#prog-grid").hidden = !!open; $("#prog-cats").hidden = !!open; $("#prog-detail").hidden = !open;
    if (open) renderProgram(open, seg[1]);
  }
  // ---- Week-by-week protocols (Dr. Jared's weekly sheets, written out in full): /data/protocols/<program id>.json
  // Loaded on demand; a program with a protocol file shows a week picker instead of the generic day list.
  const PROTO = { index: null, data: {}, week: {} };
  const protoIndex = () => PROTO.index || (PROTO.index = fetch("/data/protocols/index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : { ids: [] })).catch(() => ({ ids: [] })));
  const loadProtocol = async (id) => {
    if (PROTO.data[id]) return PROTO.data[id];
    const idx = await protoIndex();
    if (!(idx.ids || []).includes(id)) return null;
    const v = idx.version ? `?v=${encodeURIComponent(idx.version)}` : "";
    return (PROTO.data[id] = await fetch(`/data/protocols/${id}.json${v}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  };
  // ids of programs that have a protocol file, once the index has loaded (program cards use it)
  PROTO.ids = new Set();
  protoIndex().then((idx) => { PROTO.ids = new Set(idx.ids || []); PROTO.weekCounts = idx.weeks || {}; if (!$("#view-programs").hidden && !$("#prog-grid").hidden) renderProgramsView(); renderMyPlans(); });
  const protoKey = (p, wkKey) => `prog-${p.id}-w${wkKey}`;
  const protoDone = (p, wkKey) => allWorkouts.filter((w) => w.key === protoKey(p, wkKey)).length;
  // Suggested week: count whole weeks since the first logged session of this protocol; otherwise the first week
  function protoCurrentWeek(p, pr) {
    const keys = pr.weeks.map((w) => w.key);
    if (PROTO.week[p.id] && keys.includes(PROTO.week[p.id])) return PROTO.week[p.id];
    const mine = allWorkouts.filter((w) => String(w.key || "").startsWith(`prog-${p.id}-w`)).map((w) => w.date).filter(Boolean).sort();
    if (!mine.length) return keys[0];
    const days = Math.floor((Date.parse(todayInTz() + "T12:00:00Z") - Date.parse(mine[0] + "T12:00:00Z")) / 864e5);
    // Parts can span weeks ("1-2", "11-12") and a week can be missing (no week 4 sheet): pick the part that covers
    // this week of the program, else the last part that started before it
    const span = (k) => { const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(k); return m ? [Number(m[1]), Number(m[2] || m[1])] : null; };
    const numbered = keys.filter(span);
    if (!numbered.length) return keys[Math.min(keys.length - 1, Math.floor(days / 7))];
    const wkNo = span(numbered[0])[0] + Math.floor(days / 7), lastN = numbered[numbered.length - 1];
    // past the numbered weeks: parts after them (e.g. the marathon taper), one per week
    if (wkNo > span(lastN)[1]) return keys[Math.min(keys.length - 1, keys.indexOf(lastN) + wkNo - span(lastN)[1])];
    return numbered.find((k) => span(k)[0] <= wkNo && wkNo <= span(k)[1]) || numbered.filter((k) => span(k)[0] <= wkNo).pop() || numbered[0];
  }
  // Match a protocol exercise to a library video by name (exact, alias, then the closest name sharing the most words)
  const words = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((x) => x.length > 2 && !["the", "and", "with", "for", "new"].includes(x));
  // Names the word matching paired with the wrong video (e.g. "Wall Sit" -> "Wall Ball Sit Up"): the right video, or none
  const VIDEO_FIX = [
    [/^wall sit\b/i, ""], [/^single[- ]leg rdl\b/i, ""], [/^standing hip extension\b/i, ""], [/^single-arm overhead squat\b/i, ""],
    [/^skater jump to box\b/i, ""], [/^banded external rotation\b/i, "Rotator Cuff External Rotation"],
    [/^rotator cuff rotation in abduction\b/i, "Abducted External Rotation"]
  ];
  function libMatch(name) {
    const byName = Object.fromEntries(EX.map((e) => [e.name.toLowerCase(), e]));
    const fix = VIDEO_FIX.find(([re]) => re.test(String(name).trim()));
    if (fix) return fix[1] ? byName[fix[1].toLowerCase()] || null : null;
    const plain = String(name).replace(/\s*\(.*?\)\s*/g, " ").trim();
    const hit = byName[name.toLowerCase()] || byName[plain.toLowerCase()] || (VIDEO_ALIAS[name] && byName[VIDEO_ALIAS[name].toLowerCase()]) || (VIDEO_ALIAS[plain] && byName[VIDEO_ALIAS[plain].toLowerCase()]);
    if (hit) return hit;
    const want = new Set(words(name)); if (!want.size) return null;
    let best = null, score = 0;
    for (const e of EX) { const w = words(e.name), s = w.filter((x) => want.has(x)).length / Math.max(want.size, w.length); if (s > score) { score = s; best = e; } }
    return score >= 0.6 ? best : null;
  }
  const doseText = (d = {}) => [d.sets && `${d.sets} sets`, d.reps && d.reps, d.hold && `hold ${d.hold}`].filter(Boolean).join(" × ").slice(0, 60);
  function protoWorkout(p, pr, wk, group) {
    const g = group != null && group !== "" ? weekGroups(wk)[Number(group)] : null;
    const list = g ? g.items : wk.exercises, label = g && g.name ? titleCase(g.name) : wk.label;
    const circuit = list.map((x) => { const m = libMatch(x.name); return m ? { ...m, name: x.name, sets: doseText(x.dosage), block: label } : { id: "", name: x.name, sets: doseText(x.dosage), block: label }; });
    return { title: `${pr.title}: ${wk.label}${g ? ` · ${label}` : ""}`, goal: "Rehab", goalId: "mobility", location: p.location, level: p.level, levelLabel: wk.label, rounds: 1, restEx: 20, restRound: 0,
      minutes: Math.max(10, list.length * 5), warmup: [], cooldown: [], circuit, exercises: circuit, perRound: circuit.length, key: protoKey(p, wk.key), noRest: true };
  }
  const sheetSrc = (pr, wk, w) => `assets/protocols/${pr.id}/${encodeURIComponent(wk.key)}-${w}.webp`;
  // Sections the sheets have beyond the standard ones (e.g. "why", "key points") are shown too, so nothing transcribed is hidden
  const STD_EX = new Set(["n", "name", "isNew", "whenToUse", "howTo", "focus", "dosage", "steps", "proTip", "printedNumber", "video"]);
  const STD_WK = new Set(["key", "label", "driveId", "focus", "notes", "exercises", "goal", "principles", "editorNotes"]); // editorNotes: transcription remarks for staff, not shown
  const humanize = (k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  function extraSections(o, std, tag = "h5") {
    return Object.entries(o).filter(([k, v]) => !std.has(k) && v && (typeof v === "string" || (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")))).map(([k, v]) =>
      `<${tag}>${esc(humanize(k))}</${tag}>${typeof v === "string" ? `<p>${esc(v)}</p>` : `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`}`).join("");
  }
  const textList = (arr) => (Array.isArray(arr) ? arr : arr ? [arr] : []).map((x) => (typeof x === "string" ? x : [x.title, x.text].filter(Boolean).join(": ")));
  function protoExerciseCard(x) {
    const d = x.dosage || {}, cells = [["Sets", d.sets], ["Reps", d.reps], ["Tempo", d.tempo], ["Hold", d.hold], ["Frequency", d.frequency], ...Object.entries(d.other || {})].filter(([, v]) => v);
    const list = (title, arr, cls = "") => (arr && arr.length ? `<h5>${title}</h5><ul class="${cls}">${arr.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "");
    return `<article class="pex">
      <header><span class="pex-n">${esc(x.printedNumber || x.n || "")}</span><h4>${esc(x.name)}</h4>${x.isNew ? `<span class="pex-new">New</span>` : ""}</header>
      ${x.whenToUse ? `<h5>When to use</h5><p>${esc(x.whenToUse)}</p>` : ""}
      ${list("How to perform", x.howTo)}
      ${x.steps && x.steps.length ? `<ol class="pex-steps">${x.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      ${list("Focus points", x.focus, "pex-focus")}
      ${cells.length ? `<dl class="pex-dose">${cells.map(([k, v]) => `<div><dt>${esc(k[0].toUpperCase() + k.slice(1))}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
      ${extraSections(x, STD_EX)}
      ${x.proTip ? `<p class="pex-tip"><b>Pro tip:</b> ${esc(x.proTip)}</p>` : ""}
    </article>`;
  }
  // A week's exercises; sport weeks group them by workout (x.workout, e.g. "Workout A: Foundation & Lower Body Control")
  // Sheets print headings in capitals; show them in title case ("WORKOUT A: HIP MOBILITY (20-30 MINUTES)" -> "Workout A: Hip Mobility (20-30 Minutes)")
  const titleCase = (t) => (/[a-z]/.test(t) ? t : t.toLowerCase().replace(/(^|[\s(\/&:+–-])([a-z])/g, (m, a, b) => a + b.toUpperCase()));
  function weekGroups(wk) {
    const groups = [];
    for (const x of wk.exercises) { const g = x.workout || ""; let last = groups[groups.length - 1]; if (!last || last.name !== g) groups.push((last = { name: g, items: [] })); last.items.push(x); }
    return groups;
  }
  function groupedExercises(wk, p) {
    const groups = weekGroups(wk);
    if (groups.length === 1 && !groups[0].name) return `<div class="pex-list">${wk.exercises.map(protoExerciseCard).join("")}</div>`;
    return groups.map((g, i) => `<div class="pex-group-head"><h3 class="pex-group">${esc(titleCase(g.name || "Exercises"))}</h3>
        ${p.locked || g.items.length < 2 ? "" : `<button type="button" class="btn-blue sm" data-pweek-start="${esc(wk.key)}" data-pgroup="${i}"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg> Start</button>`}</div>
      ${g.items[0].workoutNote ? `<p class="muted small pex-group-note">${esc(g.items[0].workoutNote)}</p>` : ""}
      <div class="pex-list">${g.items.map(protoExerciseCard).join("")}</div>`).join("");
  }
  async function renderProtocol(p, weekKey) {
    const box = $("#prog-detail"), pr = await loadProtocol(p.id);
    if (!pr || box.dataset.id !== p.id) return false;
    const pg = pr.progression || {}, focusOf = (k) => ((pg.overview || []).find((o) => String(o.week) === String(k)) || {}).focus || "";
    const section = (title, html) => (html ? `<details class="card proto-more"><summary>${title}</summary>${html}</details>` : "");
    const wk = weekKey && pr.weeks.find((w) => w.key === weekKey);
    const weekHref = (w) => `programs/${p.id}/${enc(w.key)}`;
    if (!wk) {
      // Program overview: the goal, then every week as its own page
      const cur = protoCurrentWeek(p, pr), doneWeeks = pr.weeks.filter((w) => protoDone(p, w.key)).length;
      box.querySelector(".prog-body").innerHTML = `
      ${pr.goal ? `<div class="card proto-goal"><span class="label accent">The goal</span><p>${esc(pr.goal)}</p>${pr.tagline ? `<p class="muted small">${esc(pr.tagline)}</p>` : ""}</div>` : ""}
      <h3 class="proto-h">${partsLabel(pr.weeks.length, p)[0].toUpperCase() + partsLabel(pr.weeks.length, p).slice(1)}, one page each</h3>
      <div class="proto-next"><p class="muted small proto-progress">${doneWeeks} of ${pr.weeks.length} started · open one to see its exercises and sheet</p>
        ${p.locked ? "" : `<button type="button" class="btn-blue sm" data-goto="${esc(weekHref(pr.weeks.find((w) => w.key === cur) || pr.weeks[0]))}">${doneWeeks ? "Continue" : "Start"}: ${esc((pr.weeks.find((w) => w.key === cur) || pr.weeks[0]).label)} ›</button>`}</div>
      <div class="proto-wk-list">${pr.weeks.map((w) => { const n = protoDone(p, w.key), f = focusOf(w.key) || w.focus || ""; return `<button type="button" class="proto-wk${n ? " done" : ""}${w.key === cur ? " cur" : ""}" data-goto="${esc(weekHref(w))}">
        <span class="pw-label">${esc(w.label)}</span>${w.key === cur ? `<span class="pw-next">${n ? "Current" : "Start here"}</span>` : ""}
        ${f ? `<span class="pw-focus">${esc(f)}</span>` : ""}
        <span class="pw-meta">${w.exercises.length} exercise${w.exercises.length === 1 ? "" : "s"}${n ? ` · done ${n}×` : ""}</span><span class="pw-go" aria-hidden="true">›</span></button>`; }).join("")}</div>
      ${section("Key principles", (pr.principles || []).length ? `<dl class="proto-dl">${pr.principles.map((x) => `<div><dt>${esc(x.title)}</dt><dd>${esc(x.text)}</dd></div>`).join("")}</dl>` : "")}
      ${section("Daily basics: do these every day", (pr.dailyBasics || []).length ? `<dl class="proto-dl">${pr.dailyBasics.map((x) => `<div><dt>${esc(x.title)}</dt><dd>${esc(x.text)}</dd></div>`).join("")}</dl>` : "")}
      ${section("How the weeks progress", [
        (pg.overview || []).length ? `<table class="proto-table"><thead><tr><th>Week</th><th>Focus</th></tr></thead><tbody>${pg.overview.map((o) => `<tr><td>${esc(o.week)}</td><td>${esc(o.focus)}</td></tr>`).join("")}</tbody></table>` : "",
        (pg.guidelines || []).length ? `<h5>Progression guidelines</h5><ul>${pg.guidelines.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "",
        (pg.expect || []).length ? `<h5>What to expect</h5><ul>${pg.expect.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "",
        (pg.callouts || []).map((s) => `<p class="prog-notes">${esc(s)}</p>`).join(""),
        pg.remember ? `<h5>Remember</h5><p>${esc(pg.remember)}</p>` : "",
        pg.footer ? `<p class="proto-footer">${esc(pg.footer)}</p>` : ""].join(""))}`;
      return true;
    }
    // One week, on its own page
    const i = pr.weeks.indexOf(wk), prev = pr.weeks[i - 1], next = pr.weeks[i + 1];
    box.innerHTML = `${crumbs([...progCrumbs(p), [wk.label, ""]])}
      <div class="card proto-week">
        <div class="pd-top"><div><span class="label accent">${esc(isSport(p) ? `${sportOf(p)} · ${lvlName(p.level)}` : pr.title)}</span>
          <h2 class="pw-title">${esc(wk.label)}</h2>
          ${focusOf(wk.key) ? `<p class="proto-wgoal"><b>Focus:</b> ${esc(focusOf(wk.key))}</p>` : ""}
          <p class="muted small">${wk.exercises.length} exercise${wk.exercises.length === 1 ? "" : "s"} · ${protoDone(p, wk.key) ? `done ${protoDone(p, wk.key)}×` : weekGroups(wk).some((g) => g.items.length > 1) && weekGroups(wk).length > 1 ? "start a workout below" : weekGroups(wk).length > 1 ? "follow the plan below" : "do this routine daily unless the card says otherwise"}</p></div>
          ${p.locked || !wk.exercises.length || weekGroups(wk).length > 1 ? "" : `<button type="button" class="btn-blue sm" data-pweek-start="${esc(wk.key)}"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg> Start</button>`}</div>
        ${wk.goal ? `<p class="proto-wgoal"><b>This week's goal:</b> ${esc(wk.goal)}</p>` : ""}
        ${wk.focus && wk.focus !== focusOf(wk.key) ? `<p class="proto-wgoal"><b>Focus:</b> ${esc(wk.focus)}</p>` : ""}
        ${textList(wk.principles).length ? `<ul class="proto-wprin">${textList(wk.principles).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        ${wk.notes ? `<p class="prog-notes">${esc(wk.notes).replace(/\n/g, "<br>")}</p>` : ""}
        ${extraSections(wk, STD_WK)}
        ${wk.driveId ? `<button type="button" class="proto-sheet" data-sheet="${esc(wk.key)}" aria-label="Open the ${esc(wk.label)} sheet full size"><img src="${sheetSrc(pr, wk, 960)}" srcset="${sheetSrc(pr, wk, 960)} 960w, ${sheetSrc(pr, wk, 1600)} 1600w" sizes="(max-width: 820px) 100vw, 760px" alt="Dr. Jared's ${esc(pr.title)} sheet, ${esc(wk.label)}" loading="lazy" decoding="async" onerror="this.closest('.proto-sheet').hidden=true"><span>Tap to enlarge</span></button>` : ""}
        ${groupedExercises(wk, p)}
      </div>
      <nav class="proto-pn" aria-label="Other weeks">
        ${prev ? `<button type="button" class="btn-ghost sm" data-goto="${esc(weekHref(prev))}">‹ ${esc(prev.label)}</button>` : "<span></span>"}
        <button type="button" class="btn-ghost sm" data-goto="programs/${p.id}">All weeks</button>
        ${next ? `<button type="button" class="btn-ghost sm" data-goto="${esc(weekHref(next))}">${esc(next.label)} ›</button>` : "<span></span>"}
      </nav>
      ${p.locked ? `<div class="locked-note">${unlockBtn("this program")}</div>` : ""}`;
    return true;
  }
  // Dr. Jared's note when he assigned this program, and the Health Tips that belong to it ("Program resources")
  const assignedOf = (pid) => ((client && client.assignedPrograms) || []).find((x) => x.id === pid);
  // (the note sits above the program so it's the first thing the client reads; resources follow the summary)
  function progNote(p) {
    const a = assignedOf(p.id);
    return a ? `<div class="card prog-assigned"><span class="label accent">From Dr. Jared</span><p>${a.note ? esc(a.note) : "Dr. Jared added this program for you."}</p></div>` : "";
  }
  function progResources(p) {
    const recs = (p.resources || []).map((id) => (C.recommendations || []).find((r) => r.id === id)).filter(Boolean);
    return (recs.length ? `<div class="card prog-res"><span class="label">Program resources</span><ul>${recs.map((r) => `<li><button type="button" class="pr-link" data-tip-open="${esc(r.id)}"><b>${esc(r.title)}</b>${r.area ? `<span class="muted small">${esc(r.area)}</span>` : ""}<span aria-hidden="true">›</span></button></li>`).join("")}</ul></div>` : "");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tip-open]"); if (!b) return;
    const id = b.dataset.tipOpen;
    if (window.MDFitTips && window.MDFitTips.open) window.MDFitTips.open(id); else location.hash = "tips";
  });
  function renderProgram(p, weekKey) {
    $("#prog-detail").dataset.id = p.id;
    renderProgramDays(p);
    // Week-by-week protocol? Swap the day list for its weeks (or the one week asked for) once its file has loaded
    loadProtocol(p.id).then((pr) => { if (pr) renderProtocol(p, weekKey); else if (weekKey) history.replaceState(null, "", "#programs/" + p.id); });
  }
  function renderProgramDays(p) {
    const paced = perWeekTotal(p) > 0, pos = paced ? perWeekPos(p, p.days.reduce((n, _, i) => n + doneCount(p, i), 0)) : null;
    const wk = (i) => (paced ? pos.week : Math.min(p.weeks, doneCount(p, i) + 1));
    $("#prog-detail").innerHTML = `${crumbs(progCrumbs(p))}
      ${progNote(p)}
      <div class="card prog-head prog-head-img">${progPoster(p, "ph-img", "(max-width: 520px) 100vw, 480px")}<span class="pc-cat">${esc(p.category)}</span>${p.locked ? lockBadge : ""}<h2>${esc(p.title)}</h2><p>${esc(p.summary)}</p>
        <p class="muted small">${PROTO.ids.has(p.id) ? `${partsLabel((PROTO.weekCounts || {})[p.id] || p.weeks, p)} · week-by-week plan` : paced ? `${p.weeks} weeks · ${perWeekPlan(p)}` : `${p.weeks} weeks · ${p.days.length} session${p.days.length === 1 ? "" : "s"} a week`} · ${esc(lvlName(p.level))} · ${esc((Gen.LOCATIONS.find((l) => l.id === p.location) || {}).label || "")}</p>
        ${p.notes ? `<p class="prog-notes">${esc(p.notes)}</p>` : ""}
        <button type="button" class="btn-ghost sm save-plan${isSaved(p.id) ? " on" : ""}" data-save-plan="${esc(p.id)}">${isSaved(p.id) ? "Saved to my dashboard ✓" : "Save to my dashboard"}</button></div>
      ${progResources(p)}
      <div class="prog-body">${p.days.map((d, i) => { const w = progDayWorkout(p, i); return `<div class="card prog-day">
        <div class="pd-top"><div><span class="label accent">${paced ? (pos.complete ? `All ${perWeekTotal(p)} sessions done · Week ${p.weeks} of ${p.weeks}` : `Week ${pos.week} of ${p.weeks} · session ${pos.session} of ${pos.of} this week`) : `Day ${i + 1} · Week ${wk(i)} of ${p.weeks}`}</span><h3>${esc(d.name)}</h3>
          <p class="muted small">About ${w.minutes} min · ${w.circuit.length} exercises × ${w.rounds} rounds · warm-up and cool-down included</p></div>
          ${p.locked ? "" : `<button type="button" class="btn-blue sm" data-prog-start="${i}"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg> Start</button>`}</div>
        <ol class="pd-ex">${w.circuit.map((e) => `<li>${esc(e.name)} <span>${esc(e.sets)}</span></li>`).join("")}</ol></div>`; }).join("")}</div>
      ${p.locked ? `<div class="locked-note">${unlockBtn("this program")}</div>` : ""}`;
  }
  $("#sheet-img").addEventListener("click", (e) => e.target.classList.toggle("zoomed"));
  $("#prog-cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pcat]"); if (!b) return;
    progCat = b.dataset.pcat;
    renderProgramsView();
  });
  $("#prog-detail").addEventListener("click", async (e) => {
    const p0 = C.programs.find((x) => x.id === $("#prog-detail").dataset.id); if (!p0) return;
    const ws = e.target.closest("[data-pweek-start]");
    if (ws) { const pr = await loadProtocol(p0.id), wk = pr && pr.weeks.find((w) => w.key === ws.dataset.pweekStart); if (wk && !p0.locked) startPlayer(protoWorkout(p0, pr, wk, ws.dataset.pgroup)); return; }
    const sh = e.target.closest("[data-sheet]");
    if (sh) {
      const pr = await loadProtocol(p0.id), wk = pr && pr.weeks.find((w) => w.key === sh.dataset.sheet); if (!wk) return;
      const dlg = $("#sheet-dialog");
      $("#sheet-title").textContent = `${pr.title} · ${wk.label}`;
      $("#sheet-img").src = sheetSrc(pr, wk, 1600); $("#sheet-img").alt = `${pr.title}, ${wk.label}`; $("#sheet-img").classList.remove("zoomed");
      dlg.showModal(); return;
    }
    const b = e.target.closest("[data-prog-start]"); if (!b) return;
    const p = p0;
    if (p && !p.locked) startPlayer(progDayWorkout(p, Number(b.dataset.progStart)));
  });

  // ---- Learn: live Q&A + lectures
  let lectTopic = "All";
  const embedUrl = (u) => {
    const y = u.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if (y) return `https://www.youtube-nocookie.com/embed/${y[1]}?autoplay=1&rel=0`;
    const d = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
    if (d) return `https://drive.google.com/file/d/${d[1]}/preview`;
    const v = u.match(/vimeo\.com\/(\d+)/);
    if (v) return `https://player.vimeo.com/video/${v[1]}?autoplay=1`;
    return "";
  };
  function liveIcs(L) {
    const start = zonedToUtc(L.date, L.time), end = new Date(start.getTime() + L.minutes * 60000), st = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MD Fit//Live//EN", "BEGIN:VEVENT", `UID:live-${L.date}@mdfit`, `DTSTAMP:${st(new Date())}`, `DTSTART:${st(start)}`, `DTEND:${st(end)}`, `SUMMARY:${L.title}`, `DESCRIPTION:${L.joinUrl || "Join from the Learn tab in the MD Fit app."}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
  }
  let guidesMounted = false;
  function renderLearn() {
    if (!guidesMounted && window.MDFitGuides.mountLibrary) { window.MDFitGuides.mountLibrary($("#learn-guides")); guidesMounted = true; }
    const L = C.live, has = L.date && L.date >= todayInTz();
    $("#live-card").innerHTML = `<div class="live-top"><span class="live-dot"></span><span class="label accent">Monthly live Q&amp;A</span>${L.locked ? lockBadge : ""}</div>
      <h2>${esc(L.title)}</h2>
      ${has ? `<p class="live-when">${esc(fmtDate(L.date))} at ${esc(fmtTime(L.time))} · ${L.minutes} min</p>` : `<p class="live-when">Next date coming soon</p>`}
      <p class="muted small">${esc(L.notes)}</p>
      <div class="live-actions">${L.locked ? unlockBtn("live Q&amp;A") : `${L.joinUrl && has ? `<a class="btn-gold sm" href="${esc(L.joinUrl)}" target="_blank" rel="noopener">Join live</a>` : ""}${has ? `<a class="btn-ghost sm" href="${liveIcs(L)}" download="mdfit-live-qa.ics">Add to calendar</a>` : ""}`}</div>
      ${!L.locked && L.recordings.length ? `<details class="recs"><summary>Past sessions (${L.recordings.length})</summary><ul>${L.recordings.map((r) => `<li><button type="button" class="link-sm" data-lec-url="${esc(r.url)}" data-lec-title="${esc(r.title)}">${esc(r.title)}</button> <span class="muted small">${esc(r.date)}</span></li>`).join("")}</ul></details>` : ""}`;
    const topics = ["All", ...C.topics.filter((t) => C.lectures.some((l) => l.topic === t))];
    $("#lect-topics").innerHTML = topics.map((t) => `<button type="button" class="chip" data-ltopic="${esc(t)}" aria-selected="${t === lectTopic}">${esc(t)}</button>`).join("");
    $("#lect-grid").innerHTML = C.lectures.filter((l) => lectTopic === "All" || l.topic === lectTopic).map((l) => {
      const ready = l.url || l.hasVideo;
      return `<article class="lect">
        <span class="pc-cat">${esc(l.topic)}</span>${l.locked ? lockBadge : ""}
        <h3>${esc(l.title)}</h3><p>${esc(l.summary)}</p>
        <div class="lect-actions">${!ready ? `<span class="soon">Coming soon</span>` : l.locked ? unlockBtn("this lecture") :
          `<button type="button" class="btn-blue sm" data-lec-url="${esc(l.url)}" data-lec-title="${esc(l.title)}"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg> Watch${l.minutes ? ` · ${l.minutes} min` : ""}</button>`}
          ${!l.locked && l.downloadUrl ? `<a class="btn-ghost sm" href="${esc(l.downloadUrl)}" target="_blank" rel="noopener">Download</a>` : ""}</div>
      </article>`;
    }).join("");
  }
  $("#lect-topics").addEventListener("click", (e) => { const b = e.target.closest("[data-ltopic]"); if (!b) return; lectTopic = b.dataset.ltopic; renderLearn(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lec-url]"); if (!b) return;
    const u = b.dataset.lecUrl, em = embedUrl(u);
    earn("lecture", b.dataset.lecTitle);
    if (!em) return window.open(u, "_blank", "noopener");
    $("#lec-title").textContent = b.dataset.lecTitle; $("#lec-frame").src = em;
    $("#lec-meta").innerHTML = `<a href="${esc(u)}" target="_blank" rel="noopener">Open in a new tab</a>`;
    $("#lecture-dialog").showModal();
  });
  $("#lecture-dialog").addEventListener("close", () => ($("#lec-frame").src = "about:blank"));

  // ---- Membership & 1-on-1
  async function renderPremium() {
    const m = C.membership, cur = m && C.tiers.find((t) => t.id === m.tier);
    const req = client && client.membershipRequest;
    $("#my-membership").innerHTML = cur && C.access !== "free"
      ? `<div class="card mem-on"><span class="label accent">Your membership</span><h2>${esc(cur.name)}</h2><p class="muted small">Member since ${esc(m.since)}${m.until ? ` · paid through ${esc(m.until)}` : ""}</p></div><div id="accountability-tracker"></div>`
      : payOn ? `<p class="muted mem-pitch">Pick a membership below. Secure checkout by Stripe; cancel any time from Manage billing.</p>`
      : `<p class="muted mem-pitch">Pick a membership below and tap <b>Request</b>. Dr. Jared confirms it and sends payment details.</p>`;
    if (cur && cur.id === "member" && C.access !== "free") {
      apiAuth("GET", "/api/me/accountability").then((a) => {
        const el = $("#accountability-tracker"); if (!el) return;
        const pct = Math.min(100, Math.round((a.activeDays / a.threshold) * 100));
        el.innerHTML = `<div class="card acct-card"><span class="label accent">Accountability tracker · ${esc(a.month)}</span>
          <div class="acct-progress"><div class="acct-bar"><i style="width:${pct}%"></i></div><span>${a.activeDays} of ${a.threshold} days</span></div>
          ${a.free ? `<p class="acct-free">You hit ${a.threshold} days! This month is <b>free</b>.</p>` : `<p class="acct-owed">$${a.credit.toFixed(2)} off so far · $${a.owed.toFixed(2)} remaining · ${a.threshold - a.activeDays} more day${a.threshold - a.activeDays === 1 ? "" : "s"} to go free</p>`}
        </div>`;
      }).catch(() => {});
    }
    const rc = access.reviewCode || store.get("mdfit_review_code", null);
    if (rc && C.access === "free") $("#my-membership").insertAdjacentHTML("beforeend", `<div class="pw-applied">Your review code <b>${esc(rc)}</b> takes <b>30% off your first month</b>. It's applied automatically when you request a membership.</div>`);
    $("#tier-grid").innerHTML = C.tiers.map((t, i) => `<article class="tier${i === 1 ? " featured" : ""}${cur && cur.id === t.id ? " current" : ""}">
      ${i === 1 ? `<span class="tag">Most popular</span>` : ""}
      <h3>${esc(t.name)}</h3><p class="tier-price"><b>${money(t.price)}</b>/month</p>${rc && C.access === "free" ? `<p class="tier-first">First month ${money(Math.round(t.price * 70) / 100)} with your review code</p>` : ""}
      ${t.meetings ? `<p class="tier-meet">${t.meetings} remote 1-on-1 sessions a month · ${t.meetingMinutes} min each</p>` : ""}
      <ul>${t.perks.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${cur && cur.id === t.id ? `<span class="tier-cur">Your plan</span>` : `<button type="button" class="${i === 1 ? "btn-gold" : "btn-ghost"} sm" data-tier="${t.id}">${payOn ? "Subscribe" : "Request"} ${esc(t.name)}</button>`}
    </article>`).join("");
    renderPayments();
    const mc = $("#meetings-card");
    mc.hidden = C.access !== "premium";
    if (mc.hidden) return;
    const d = await apiAuth("GET", "/api/me/meetings").catch(() => null); if (!d) return;
    $("#meet-left").textContent = `${Math.max(0, d.allowance - d.usedThisMonth)} of ${d.allowance} left this month · ${d.minutes} min each`;
    $("#meet-form button").disabled = d.usedThisMonth >= d.allowance;
    $("#meet-list").innerHTML = d.meetings.map((x) => `<li><b>${esc(x.topic)}</b><span class="pill ${x.status}">${x.status}</span>
      <span class="muted small">${x.when ? esc(x.when) : `Asked for: ${esc(x.times)}`}</span>${x.link && x.status === "scheduled" ? `<a class="btn-gold sm" href="${esc(x.link)}" target="_blank" rel="noopener">Join</a>` : ""}</li>`).join("");
  }
  let payOn = false, pays = null, stripePub = "";
  // Online payments on (keys + webhook set): redraw the plans so they say Subscribe and open checkout in the page
  api("/api/app/config").then((c) => {
    stripePub = c.stripePublishableKey || "";
    payOn = !!(c.features && c.features.payments && stripePub);
    if (payOn && C && $("#tier-grid") && $("#tier-grid").innerHTML) renderPremium().catch(() => {});
  }).catch(() => {});
  if (new URLSearchParams(location.search).get("checkout") === "success") {
    toast("Payment received. Thank you! Your account updates in a moment.");
    history.replaceState(null, "", "/account" + location.hash);
    setTimeout(() => apiAuth("GET", "/api/me/access").then((a) => { access = a; renderAccessBadge(); loadContent().then(() => renderContent("premium")); }).catch(() => {}), 4000);
  }
  async function renderPayments() {
    const host = $("#my-payments"); if (!host) return;
    pays = await apiAuth("GET", "/api/me/payments").catch(() => null);
    if (!pays) return;
    const pl = pays.protocols.filter((p) => p.status !== "pending");
    host.innerHTML = (pays.hasBilling && pays.enabled ? `<button type="button" class="btn-ghost sm" id="manage-billing">Manage billing &amp; cards</button>` : "") +
      (pl.length ? `<div class="card"><span class="label accent">Your protocol plans</span><ul class="proto-list">${pl.map((p) => `<li><b>${esc(p.serviceName)} · ${p.sessions} visit${p.sessions === 1 ? "" : "s"}</b><span>${esc(p.label)} · ${money(p.total)}${p.payments > 1 ? ` · ${p.paid} of ${p.payments} payments` : ""}</span><span class="pill ${p.status}">${esc(p.status)}</span>${p.guarantee ? `<small>Includes the money-back guarantee</small>` : ""}</li>`).join("")}</ul></div>` : "");
  }
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#manage-billing")) return;
    try { location.href = (await apiAuth("POST", "/api/me/billing-portal", {})).url; } catch (err) { toast(err.message); }
  });
  $("#tier-grid").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-tier]"); if (!b) return;
    const t = C.tiers.find((x) => x.id === b.dataset.tier);
    if (payOn) {
      b.disabled = true;
      // Stripe's own checkout, mounted inside MD Fit (no trip to another site); Apple Pay / Google Pay / Link / card
      const label = b.textContent; b.textContent = "Opening secure checkout…";
      try {
        const r = await apiAuth("POST", "/api/me/checkout/membership", { tier: t.id, ui: "embedded", rewardCode: access.reviewCode || store.get("mdfit_review_code", null) || undefined });
        if (r.clientSecret && window.MDFitStripe) {
          try { await window.MDFitStripe.open({ clientSecret: r.clientSecret, publishableKey: stripePub }); }
          catch { try { window.MDFitStripe.close(); } catch {} throw new Error("Secure checkout couldn't load. Check your connection or ad blocker and try again, or call 941-313-0562."); }
        } else if (r.url) location.href = r.url;
      } catch (err) { toast(err.message); }
      b.disabled = false; b.textContent = label;
      return;
    }
    const note = prompt(`Request ${t.name} (${money(t.price)}/month)?\nAdd a note for Dr. Jared (optional):`, "");
    if (note === null) return;
    try { await apiAuth("POST", "/api/me/membership/request", { tier: t.id, note }); b.outerHTML = `<span class="tier-cur">Requested. Dr. Jared will be in touch.</span>`; toast("Request sent to Dr. Jared."); }
    catch (err) { toast(err.message); }
  });
  $("#meet-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    try { await apiAuth("POST", "/api/me/meetings", { topic: f.topic.value, times: f.times.value }); f.reset(); $(".nums-msg", f).textContent = "Requested. You'll get an email when it's scheduled."; renderPremium(); }
    catch (err) { $(".nums-msg", f).textContent = err.message; }
  });

  // ---- Health tips: Dr. Jared's protocol posters, shown as readable articles (`sections`, transcribed from each poster).
  // A tip without sections (one an admin added) stays a poster card that opens full size, or a plain text card.
  let tipArea = "All";
  const driveImg = (id, w) => `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w${w || 600}`;
  // Header photos (real photos, free licenses; full list with links in assets/tips/CREDITS.md). Keyed by tip id.
  const TIP_PHOTOS = {
    "diet-health-shots": { src: "assets/tips/diet-health-shots.webp", alt: "Dried turmeric roots beside a spoon of ground turmeric", by: "formulatehealth", url: "https://www.flickr.com/photos/189590028@N07/50396528903", lic: "CC BY 2.0", licUrl: "https://creativecommons.org/licenses/by/2.0/" },
    "bath-accu-mat": { src: "assets/tips/bath-accu-mat.webp", alt: "Close-up of the spiked discs on an acupressure mat", by: "starpause kid", url: "https://www.flickr.com/photos/58972197@N00/7328508376", lic: "CC BY 2.0", licUrl: "https://creativecommons.org/licenses/by/2.0/" },
    "fitness-erg": { src: "assets/tips/fitness-erg.webp", alt: "A woman stretching in child's pose on a yoga mat", by: "Ivan Radic", url: "https://www.flickr.com/photos/26344495@N05/51287191909", lic: "CC BY 2.0", licUrl: "https://creativecommons.org/licenses/by/2.0/" },
    "mobility-diet-ratios": { src: "assets/tips/mobility-diet-ratios.webp", alt: "A woman in a deep lunge stretch in a bright studio", by: "KMo Foto", url: "https://www.flickr.com/photos/28032587@N06/11278364026", lic: "CC BY 2.0", licUrl: "https://creativecommons.org/licenses/by/2.0/" },
    "psg-protocol": { src: "assets/tips/psg-protocol.webp", alt: "A long rack of dumbbells in a gym", by: "jerryonlife", url: "https://www.flickr.com/photos/34909987@N07/3265269814", lic: "CC BY 2.0", licUrl: "https://creativecommons.org/licenses/by/2.0/" },
    "weekly-tracking": { src: "assets/tips/weekly-tracking.webp", alt: "A hand writing in an open notebook", by: "Nguyen Nguyen (StockSnap)", url: "https://stocksnap.io/photo/notebook-pen-0AXTVI7JB2", lic: "CC0", licUrl: "https://creativecommons.org/publicdomain/zero/1.0/" }
  };
  const tipItem = (x) => typeof x === "string" ? esc(x) : `<b>${esc(x.title)}</b>${x.detail ? `<span>${esc(x.detail)}</span>` : ""}`;
  const tipList = (items, style) => `<ul class="ta-list ta-${esc(style || "bullet")}">${(items || []).map((x) => `<li>${tipItem(x)}</li>`).join("")}</ul>`;
  const TONE = { important: "Important", remember: "Remember", tip: "Tip", warning: "Caution" };
  function tipBlock(b) {
    const h = b.heading ? `<h2 class="ta-h">${esc(b.heading)}</h2>` : "", p = b.text ? `<p class="ta-p">${esc(b.text)}</p>` : "";
    const note = b.note ? `<p class="ta-note">${esc(b.note)}</p>` : "";
    let body = "";
    if (b.type === "list") body = tipList(b.items, b.style);
    else if (b.type === "groups") body = `<div class="ta-groups">${(b.groups || []).map((g) => `<section class="ta-group"><h3>${esc(g.title)}${g.note ? ` <small>${esc(g.note)}</small>` : ""}</h3>${tipList(g.items, g.style)}</section>`).join("")}</div>`;
    else if (b.type === "table") {
      const cols = b.columns || [], rows = b.rows || [];
      const long = rows.some((r) => r.slice(1).some((c) => String(c).length > 18));
      body = cols.length === 2
        // two columns (ingredient + amount, habit + target): a two-sided list that never needs to scroll
        ? `<dl class="ta-kv${long ? " ta-kv-long" : ""}">${cols.length ? `<div class="ta-kv-head"><dt>${esc(cols[0])}</dt><dd>${esc(cols[1])}</dd></div>` : ""}${rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1] || "")}</dd></div>`).join("")}</dl>`
        // wordy tables (exercise, targets, rep scheme) become one card per row on a phone; short numeric ones stay a grid
        : `<div class="ta-table-wrap${rows.some((r) => r.some((c) => String(c).length > 24)) ? " ta-stack" : ""}" tabindex="0" role="region" aria-label="${esc(b.heading || "Table")}"><table class="ta-table"><thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => i ? `<td data-label="${esc(cols[i] || "")}"${String(c).length <= 10 ? ' class="nw"' : ""}>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    else if (b.type === "facts") body = `<div class="ta-facts">${(b.items || []).map((x) => `<div class="ta-fact"><b>${esc(x.title || x)}</b>${x.detail ? `<span>${esc(x.detail)}</span>` : ""}</div>`).join("")}</div>`;
    else if (b.type === "steps") body = `<ol class="ta-steps">${(b.items || []).map((x) => `<li>${tipItem(x)}</li>`).join("")}</ol>`;
    else if (b.type === "callout") {
      const tone = TONE[b.tone] ? b.tone : "tip";
      return `<aside class="ta-callout ta-${tone}"><p class="ta-callout-k">${TONE[tone]}</p>${b.title && b.title.toLowerCase() !== TONE[tone].toLowerCase() ? `<h3>${esc(b.title)}</h3>` : ""}${p}${b.items ? tipList(b.items, "check") : ""}${note}</aside>`;
    }
    else if (b.type === "motto") return `<p class="ta-motto">${esc(b.text)}</p>`;
    return `<section class="ta-block">${h}${p}${body}${note}</section>`;
  }
  function renderTipArticle(r) {
    const ph = TIP_PHOTOS[r.id];
    const hero = ph ? `<figure class="ta-photo"><img src="${ph.src}" alt="${esc(ph.alt)}" width="1024" height="576"></figure>`
      : r.image ? `<figure class="ta-photo ta-poster"><img src="${driveImg(r.image, 1200)}" alt="" width="1024" height="576"></figure>` : "";
    $("#tip-article").innerHTML = `
      <a class="ta-back" href="#tips"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>All health tips</a>
      <article class="ta">
        <header class="ta-head">${hero}<div class="ta-head-text"><span class="ta-area">${esc(r.area)}</span><h1>${esc(r.title)}</h1><p>${esc(r.body)}</p></div></header>
        <div class="ta-body">${(r.sections || []).map(tipBlock).join("")}</div>
        <footer class="ta-foot">
          ${r.image ? `<a class="ta-poster-link" href="${driveImg(r.image, 2400)}" target="_blank" rel="noopener" data-tipimg="${esc(r.image)}" data-tipcap="${esc(r.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14zm-5-7-3 4-2-3-3 4h12z"/></svg>View original poster</a>` : ""}
          ${r.link ? `<a class="ta-poster-link" href="${esc(r.link)}" target="_blank" rel="noopener">More from Dr. Jared</a>` : ""}
          <p class="ta-disclaimer">General guidance from Dr. Jared's programs, not personal medical advice. Ask Dr. Jared before you change your diet, supplements or training if you have a health condition.</p>
          ${ph ? `<p class="ta-credit">Photo: <a href="${ph.url}" target="_blank" rel="noopener">${esc(ph.by)}</a>, <a href="${ph.licUrl}" target="_blank" rel="noopener">${esc(ph.lic)}</a></p>` : ""}
        </footer>
      </article>`;
  }
  function renderTips(sub) {
    const open = sub && C.recommendations.find((r) => r.id === sub && r.sections && r.sections.length);
    $("#tips-list").hidden = !!open; $("#tips-hero").hidden = !!open; $("#tip-article").hidden = !open;
    if (open) { renderTipArticle(open); return; }
    $("#tip-article").innerHTML = "";
    const areas = ["All", ...new Set(C.recommendations.map((r) => r.area))];
    $("#tip-areas").innerHTML = areas.map((a) => `<button type="button" class="chip" data-tarea="${esc(a)}" aria-selected="${a === tipArea}">${esc(a)}</button>`).join("");
    const list = C.recommendations.filter((r) => tipArea === "All" || r.area === tipArea);
    $("#tips").innerHTML = list.map((r) => {
      if (r.sections && r.sections.length) {
        const ph = TIP_PHOTOS[r.id];
        const img = ph ? `<img src="${ph.src}" alt="" loading="lazy" width="1024" height="576">` : r.image ? `<img class="poster" src="${driveImg(r.image, 600)}" alt="" loading="lazy">` : "";
        return `<a class="tip-card tip-art" href="#tips/${encodeURIComponent(r.id)}">${img}<span class="tip-card-body"><span class="ta-area">${esc(r.area)}</span><span class="tip-card-title">${esc(r.title)}</span><span class="tip-card-sum">${esc(r.body)}</span><span class="tip-card-go">Read the protocol <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg></span></span></a>`;
      }
      return r.image
        ? `<button type="button" class="tip-card" data-tipimg="${esc(r.image)}" data-tipcap="${esc(r.title)}"><img src="${driveImg(r.image, 600)}" alt="${esc(r.title)}" loading="lazy"><span class="tip-card-label">${esc(r.title)}</span></button>`
        : `<div class="tip-card tip-text"><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p></div>`;
    }).join("");
  }
  $("#tip-areas").addEventListener("click", (e) => { const b = e.target.closest("[data-tarea]"); if (!b) return; tipArea = b.dataset.tarea; renderTips(); });
  const openPoster = (c) => {
    const lb = $("#tip-lightbox"), img = $("#tip-lb-img");
    img.src = driveImg(c.dataset.tipimg, 1600);
    img.alt = "Original poster: " + c.dataset.tipcap;
    $("#tip-lb-cap").textContent = c.dataset.tipcap;
    lb.showModal();
  };
  $("#view-tips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-tipimg]"); if (!c) return;
    e.preventDefault(); openPoster(c);
  });
  $("#tip-lightbox").addEventListener("click", (e) => { if (e.target === e.currentTarget || e.target.classList.contains("tip-lb-close")) e.currentTarget.close(); });

  // ================= Progress: rewards (XP, levels, badges), calendar, pain tracker
  const BADGE_IC = {
    bolt: '<path d="M7 2v11h3v9l7-12h-4l4-8z"/>', dumbbell: '<path d="M20.6 14.9 22 13.4 20.6 12l-3.6 3.6L8.4 7l3.6-3.6L10.6 2 9.1 3.4 7.7 2 5.6 4.1 4.1 2.6 2.7 4.1l1.4 1.4L2 7.7l1.4 1.4L2 10.6 3.4 12 7 8.4l8.6 8.6-3.6 3.6 1.4 1.4 1.4-1.4 1.4 1.4 2.1-2.1 1.5 1.4 1.4-1.4-1.4-1.4 2.1-2.1z"/>',
    trophy: '<path d="M19 4h-2V2H7v2H5a2 2 0 0 0-2 2v1a5 5 0 0 0 4.4 4.96A5 5 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1a5 5 0 0 0 3.6-3.94A5 5 0 0 0 21 7V6a2 2 0 0 0-2-2zM5 7V6h2v3.8A3 3 0 0 1 5 7zm14 0a3 3 0 0 1-2 2.8V6h2z"/>',
    flame: '<path d="M13.5 1.5s.8 2.7.8 4.6c0 1.9-1.2 3.4-3.1 3.4-1.9 0-3.3-1.5-3.3-3.4l.03-.33C5.9 8 4.7 11.1 4.7 14.4 4.7 18.6 8 22 12 22s7.3-3.4 7.3-7.6c0-5.1-2.4-9.6-5.8-12.9z"/>',
    calendar: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14z"/>',
    clock: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z"/>',
    compass: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm2.2 12.2L6.5 17.5l3.3-7.7 7.7-3.3z"/>',
    pulse: '<path d="M3 13h4l2-6 4 12 2-6h6v-2h-4.6L14 5l-4 12-2-6H3z"/>',
    heart: '<path d="M12 21 10.6 19.7C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z"/>',
    star: '<path d="m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3l5.4 4.7-1.6 7z"/>'
  };
  let boardPeriod = "day", boardLeague = "";
  const PERIOD_UNIT = { day: "XP today", week: "XP this week", month: "XP this month", all: "XP" };
  const PERIOD_EMPTY = { day: "today", week: "this week", month: "this month", all: "yet" };
  async function loadBoard() {
    if (!$("#board")) return;
    let d; try { d = await apiAuth("GET", `/api/me/leaderboard?period=${boardPeriod}${boardLeague ? `&league=${boardLeague}` : ""}`); } catch { return; }
    if (!d || !Array.isArray(d.top)) return;
    $$("#board [data-period]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.period === d.period)));
    const unit = PERIOD_UNIT[d.period] || "XP";
    $("#board-reset").textContent = d.resetsOn ? `${d.period === "day" ? "Resets at midnight" : `Resets ${fmtDate(d.resetsOn, { weekday: "long", month: "short", day: "numeric" })}`}${d.period === "day" ? "" : " at midnight"} · everyone starts from zero` : "Lifetime XP. Never resets.";
    boardLeague = d.league;
    $$("#board [data-league]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.league === d.league)));
    const lname = d.league === "olympic" ? "Olympic League" : d.league === "all" ? "overall ranking" : "Pro League";
    const og = d.olympicXp ? `${Number(d.olympicXp).toLocaleString()} XP` : d.olympicGem || `level ${d.olympicLevel}`;
    $("#board-sub").textContent = d.league === "all" ? "Everyone, both leagues, ranked together. This is your #overall rank on Home."
      : d.myLeague === d.league
      ? (d.league === "olympic" ? "You're in the Olympic League, the top tier. Defend your spot." : `You're in the Pro League. Reach ${og} to move up to the Olympic League.`)
      : (d.league === "olympic" ? `Reach ${og} to compete here.` : "Where everyone starts.");
    $("#board-list").innerHTML = d.top.length ? d.top.map((r) => `<li class="${r.me ? "me" : ""}"><span class="rk rk-${r.rank}">${r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</span><span class="nm">${esc(r.name)}${r.me ? " (you)" : ""}<small>${r.gem ? `${GEM_ICON(r.gem.color, 12)} ${esc(r.gem.name)}` : `Lv ${r.level}`}</small></span><b>${r.score.toLocaleString()}</b></li>`).join("")
      : `<li class="empty muted small">No one in the ${lname} has XP ${PERIOD_EMPTY[d.period] || "yet"}.${d.myLeague === d.league ? " Log a workout, check-in or pain entry to take #1." : ""}</li>`;
    $("#board-me").textContent = d.hidden ? "You're hidden from the leaderboard." : d.me ? (d.me.rank > 10 ? `You're #${d.me.rank} of ${d.total} with ${d.me.score.toLocaleString()} ${unit}.` : "") : "Log anything to join the rankings.";
    $("#board-hide").checked = d.hidden;
  }
  if ($("#board")) {
    $("#board").addEventListener("click", (e) => {
      const b = e.target.closest("[data-period]"); if (b) { boardPeriod = b.dataset.period; loadBoard(); }
      const l = e.target.closest("[data-league]"); if (l) { boardLeague = l.dataset.league; loadBoard(); }
    });
    $("#board-hide").addEventListener("change", async (e) => { try { await apiAuth("PUT", "/api/me/leaderboard/visibility", { hidden: e.target.checked }); } catch {} loadBoard(); });
  }
  const GEM_ICON = (color, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 2 4 9l8 13 8-13z" fill="${color}" stroke="#000" stroke-width=".5"/><path d="M12 2 8 9h8z" fill="rgba(255,255,255,.35)"/><path d="M4 9h16" stroke="rgba(0,0,0,.3)" stroke-width=".8" fill="none"/></svg>`;
  function renderRewards() {
    const r = reward;
    if (!r) return;
    $("#chip-lv").textContent = r.title;
    $("#chip-xp").textContent = `${r.xp.toLocaleString()} XP`;
    // Gemstone rank card in the Progress view
    if (r.rank) {
      const cur = r.rank.current, next = r.rank.next;
      if ($("#rk-gem")) {
        $("#rk-gem").innerHTML = GEM_ICON(cur.color, 48);
        $("#rk-name").textContent = cur.name;
        $("#rk-xp").textContent = `${r.xp.toLocaleString()} XP lifetime`;
        $("#rank-next").innerHTML = next ? `<small class="muted">Next</small><div class="rk-next-row">${GEM_ICON(next.color, 24)}<b>${next.name}</b></div><small class="muted">${r.rank.xpToNext.toLocaleString()} XP to go</small>` : `<b class="rk-max">Max rank reached — 🙌</b>`;
        $("#rk-bar").style.width = Math.round(r.rank.progress * 100) + "%";
        $("#rank-ladder").innerHTML = r.gems.map((g) => `<li class="rl ${g.id === cur.id ? "cur" : r.xp >= g.xp ? "done" : ""}"><span class="rl-gem">${GEM_ICON(g.color, 20)}</span><b>${esc(g.name)}</b><small class="muted">${g.xp.toLocaleString()} XP</small></li>`).join("");
        $("#rk-foot").textContent = "Lifetime achievement — ranks are permanent once earned and are not affected by inactivity.";
      }
    }
    // Streak repairs: show chip with count, offer bridging a broken streak
    if (r.repairs) {
      const chip = $("#repair-chip"); if (chip) {
        chip.hidden = r.repairs.available < 1 && r.repairs.earned < 1;
        $("#repair-n").textContent = r.repairs.available;
      }
      const note = $("#repair-note"); if (note) {
        if (r.repairs.available >= 1) {
          note.hidden = false;
          note.innerHTML = `<small>You have <b>${r.repairs.available}</b> streak repair${r.repairs.available === 1 ? "" : "s"}. Tap any missed day on the calendar to bridge it.</small>`;
        } else note.hidden = true;
      }
    }
    $("#lv-n").textContent = r.level;
    $("#lv-title").textContent = r.title;
    $("#lv-xp").textContent = `${r.xp.toLocaleString()} XP total`;
    const pct = r.nextLevel ? Math.round(((r.xp - r.levelStart) / (r.nextLevel - r.levelStart)) * 100) : 100;
    $("#lv-bar").style.width = pct + "%";
    $("#lv-bar-wrap").setAttribute("aria-valuenow", pct);
    $("#lv-next").textContent = r.nextLevel && r.rank && r.rank.next ? `${(r.nextLevel - r.xp).toLocaleString()} XP to ${r.rank.next.name}` : "Top gem reached";
    // Daily goal ring
    const g = Math.min(1, r.todayXp / r.dailyGoal), C = 2 * Math.PI * 26;
    $("#goal-ring").innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="ring-bg"/><circle cx="32" cy="32" r="26" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - g)}" transform="rotate(-90 32 32)"/></svg>
      <span><b>${r.todayXp}</b>/${r.dailyGoal}</span><small>${g >= 1 ? "Goal met!" : "Today's goal"}</small>`;
    $("#goal-ring").setAttribute("aria-label", `Today's goal: ${r.todayXp} of ${r.dailyGoal} XP`);
    // This week's XP: single-series bars, today highlighted, values on hover/focus via title
    const max = Math.max(r.dailyGoal, ...r.week.map((d) => d.xp)), t = todayInTz();
    $("#xp-week").innerHTML = r.week.map((d) => `<div class="xw ${d.date === t ? "today" : ""} ${d.date > t ? "future" : ""}" title="${fmtDate(d.date, { weekday: "long" })}: ${d.xp} XP" tabindex="0">
      <span class="xw-val">${d.xp || ""}</span><i style="height:${Math.max(4, (d.xp / max) * 100)}%"></i><small>${fmtDate(d.date, { weekday: "narrow" })}</small></div>`).join("");
    const earned = r.badges.filter((b) => b.earned).length;
    $("#badge-count").textContent = `${earned} of ${r.badges.length}`;
    $("#badges").innerHTML = r.badges.slice().sort((a, b) => Number(b.earned) - Number(a.earned)).map((b) => `
      <li class="badge ${b.earned ? "earned" : ""}" title="${esc(b.desc)}">
        <span class="b-ic"><svg viewBox="0 0 24 24">${BADGE_IC[b.icon] || BADGE_IC.star}</svg></span>
        <b>${esc(b.title)}</b><small>${b.earned ? `Earned ${shortDate(b.earnedOn)}` : esc(b.desc)}</small>
        ${b.earned ? "" : `<span class="b-prog"><i style="width:${Math.round((b.progress / b.target) * 100)}%"></i></span>`}
      </li>`).join("");
  }
  // celebrate = compare with the previous totals and announce XP and new badges
  async function loadRewards(celebrate = false) {
    try {
      const prev = reward, next = await apiAuth("GET", "/api/me/rewards");
      reward = next; loadBoard(); notifyRewards(next); renderRewards();
      document.dispatchEvent(new CustomEvent("mdfit:rewards", { detail: next })); // gem card, rank (account-xp.js)
      if (!celebrate || !prev) return;
      const gained = next.xp - prev.xp, newBadges = next.badges.filter((b) => b.earned && !prev.badges.find((x) => x.id === b.id).earned);
      const msgs = [];
      if (gained > 0) msgs.push(`+${gained} XP`);
      if (next.level > prev.level) msgs.push(`New gem! You're now ${next.title}`);
      newBadges.forEach((b) => msgs.push(`Badge unlocked: ${b.title}`));
      if (prev.todayXp < prev.dailyGoal && next.todayXp >= next.dailyGoal) msgs.push("Daily goal reached!");
      if (msgs.length) celebrateToast(msgs);
    } catch {}
  }
  function celebrateToast(msgs) {
    const t = $("#toast");
    t.innerHTML = msgs.map((m, i) => `<div class="${i ? "" : "xp-gain"}">${esc(m)}</div>`).join("");
    t.hidden = false; t.classList.add("celebrate");
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; t.classList.remove("celebrate"); }, 4200);
  }

  // Calendar: workouts, visits and pain logs by day, Monday first
  let calMonth = todayInTz().slice(0, 7), calPick = null;
  const monthAdd = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  function dayItems(d) {
    return [
      ...allWorkouts.filter((w) => w.date === d).map((w) => ({ k: "workout", t: w.title, s: `${w.minutes} min · ${w.exercises} exercises` })),
      ...[...appts.upcoming, ...appts.past].filter((a) => a.date === d && a.status !== "cancelled").map((a) => ({ k: "visit", t: a.typeName, s: `${fmtTime(a.time)} · ${a.minutes} min${a.status === "booked" && d >= todayInTz() ? " · upcoming" : ""}`,
        link: a.status === "booked" && d >= todayInTz() ? a.meetingLink || "" : "", video: /telehealth|video|remote|online/i.test(a.typeName + " " + a.typeId) })),
      ...painLog.filter((p) => p.date === d).map((p) => ({ k: "pain", t: `${p.area} pain ${p.level}/10`, s: p.note || "Pain log" }))
    ];
  }
  function renderCalendar() {
    const [y, m] = calMonth.split("-").map(Number), first = `${calMonth}-01`, t = todayInTz();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = (new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7;
    $("#cal-title").textContent = fmtDate(first, { month: "long", year: "numeric" });
    const cells = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<span class="cal-h">${d}</span>`);
    for (let i = 0; i < lead; i++) cells.push("<span></span>");
    for (let n = 1; n <= days; n++) {
      const d = `${calMonth}-${String(n).padStart(2, "0")}`, kinds = [...new Set(dayItems(d).map((x) => x.k))];
      cells.push(`<button type="button" class="cal-d ${d === t ? "today" : ""} ${d === calPick ? "picked" : ""} ${kinds.includes("workout") ? "has-workout" : ""}" data-day="${d}" aria-label="${fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}${kinds.length ? ": " + kinds.join(", ") : ""}">
        <span>${n}</span><em>${kinds.map((k) => `<i class="k-${k}"></i>`).join("")}</em></button>`);
    }
    $("#cal").innerHTML = cells.join("");
    renderCalDay();
    document.dispatchEvent(new CustomEvent("mdfit:calendar", { detail: { month: calMonth } }));
  }
  function renderCalDay() {
    const d = calPick || todayInTz(), items = dayItems(d);
    const t = todayInTz();
    const repairs = reward && reward.repairs;
    const alreadyRepaired = repairs && repairs.usedDates && repairs.usedDates.includes(d);
    const canRepair = d < t && !items.length && repairs && repairs.available >= 1 && !alreadyRepaired;
    $("#cal-day").innerHTML = `<p class="label">${d === t ? "Today" : fmtDate(d, { weekday: "long", month: "short", day: "numeric" })}</p>` + (items.length
      ? `<ul class="activity">${items.map((x) => `<li class="act"><span class="check k-bg-${x.k}"></span><div><b>${esc(x.t)}</b><span>${esc(x.s)}</span>${
          x.link ? `<a class="btn-blue sm join-link" href="${esc(x.link)}" target="_blank" rel="noopener">Join video visit</a>` : x.video && x.s.includes("upcoming") ? `<span class="muted small">Your video link will be emailed before the visit.</span>` : ""}</div></li>`).join("")}</ul>`
      : `<p class="muted small">Nothing logged. ${d === t ? "A quick workout keeps your streak alive." : ""}</p>`)
      + (alreadyRepaired ? `<p class="muted small"><b>Streak repair applied</b> — this missed day is bridged for your streak.</p>` : "")
      + (canRepair ? `<button type="button" class="btn-gold sm" data-repair="${d}">Use 1 repair to bridge this day</button>` : "");
  }
  document.addEventListener("click", async (e) => {
    const r = e.target.closest("[data-repair]"); if (!r) return;
    try { await apiAuth("POST", "/api/me/repair-streak", { date: r.dataset.repair }); toast("Streak repaired."); await loadRewards(); renderCalDay(); renderCalendar(); }
    catch (err) { toast(err.message); }
  });
  $("#cal").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (b) { calPick = b.dataset.day; renderCalendar(); } });
  $("#cal-prev").addEventListener("click", () => { calMonth = monthAdd(calMonth, -1); renderCalendar(); });
  $("#cal-next").addEventListener("click", () => { calMonth = monthAdd(calMonth, 1); renderCalendar(); });

  // ================= Become a patient: intake documents kept on file with the account (filled at /intake?me=1)
  function loadPatientDocs() {
    apiAuth("GET", "/api/me/intake").then((p) => {
      const card = $("#patient-card");
      card.classList.toggle("done", p.done);
      if (p.done) { $("#pc-title").textContent = "Documents on file ✓"; $("#pc-sub").textContent = "Your intake documents are on file for every visit."; $("#pc-go").textContent = "Update documents"; }
      else if (p.completed) { $("#pc-title").textContent = "Become a patient"; $("#pc-sub").textContent = `${p.completed} of ${p.total} intake documents complete.`; $("#pc-go").textContent = "Continue ›"; }
    }).catch(() => {});
  }

  // ================= My plans on Home: programs Dr. Jared assigned ("From Dr. Jared") + programs the member saved
  function renderMyPlans() {
    const box = $("#my-plans"); if (!box || !C || !client) return;
    const byId = new Map((C.programs || []).map((p) => [p.id, p]));
    const assigned = (client.assignedPrograms || []).filter((x) => byId.has(x.id));
    const saved = (client.pinnedPrograms || []).filter((id) => byId.has(id) && !assigned.some((x) => x.id === id));
    const row = (p, note) => { const st = progStats(p); return `<li><button type="button" class="mp-item" data-fp="${esc(p.id)}">
        ${p.image ? progImg(p.image, "", "56px", { sizes: "56px" }) : `<span class="fp-ic pp-blank"></span>`}
        <span class="mp-body"><b>${esc(p.title)}</b>${note ? `<span class="mp-note">${esc(note)}</span>` : ""}<span class="muted small">${esc(lvlName(p.level))} · ${st.isProto ? partsLabel(st.nWeeks, p) : `${p.weeks} weeks`}${st.done ? ` · ${st.done} of ${st.sessions} ${st.isProto ? "started" : "done"}` : note !== undefined ? " · not started yet" : ""}</span></span>
        <span class="mp-go">Open ›</span></button></li>`; };
    $("#mp-assigned").innerHTML = assigned.length ? `<span class="label accent">From Dr. Jared</span><ul class="mp-list">${assigned.map((x) => row(byId.get(x.id), x.note)).join("")}</ul>` : "";
    $("#mp-saved").innerHTML = saved.length ? `<span class="label">My saved plans</span><ul class="mp-list">${saved.map((id) => row(byId.get(id))).join("")}</ul>` : "";
    box.hidden = !assigned.length && !saved.length;
  }
  const isSaved = (pid) => (client && client.pinnedPrograms || []).includes(pid);
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-save-plan]"); if (!b) return;
    const pid = b.dataset.savePlan, on = isSaved(pid);
    b.disabled = true;
    try {
      const r = await apiAuth(on ? "DELETE" : "PUT", `/api/me/pinned/${encodeURIComponent(pid)}`);
      client.pinnedPrograms = r.pinnedPrograms; auth.set({ ...auth.get(), client });
      b.textContent = on ? "Save to my dashboard" : "Saved to my dashboard ✓"; b.classList.toggle("on", !on);
      toast(on ? "Removed from your dashboard." : "Saved. It's on your Home page.");
      renderMyPlans();
    } catch (err) { toast(err.message); }
    b.disabled = false;
  });

  // ================= Hooks for the XP add-ons (account-xp.js: gem card, workout builder, challenges)
  window.MDFitApp = { startPlayer, go, loadRewards, toast, celebrateToast, exMeta, byId, gemIcon: GEM_ICON, rewards: () => reward,
    showBoard: (period, league) => { boardPeriod = period; boardLeague = league; if (location.hash === "#leaders") loadBoard(); else go("leaders"); } };

  // ================= Load
  show(location.hash.slice(1) || "home");
  if (new URLSearchParams(location.search).get("notes") === "1") { history.replaceState(null, "", location.pathname + location.hash); $("#bell").click(); }
  renderProfile(); renderStats(); renderToday(); renderAreas(); renderPlan();
  (async () => {
    try {
      const r = await apiAuth("GET", "/api/me");
      client = r.client; auth.set({ ...auth.get(), client });
      renderProfile(); renderPlan();
    } catch (err) { toast("Couldn't reach MD Fit right now. Call 941-313-0562 if you need help."); return; }
    const [s, , , sched, wl, lb] = await Promise.allSettled([
      apiAuth("GET", "/api/me/stats"), loadAppointments(), loadPain(), Promise.resolve(), apiAuth("GET", "/api/me/workouts"), apiAuth("GET", "/api/me/library"), loadReferral()
    ]);
    if (s.status === "fulfilled") stats = s.value;
    if (wl.status === "fulfilled") allWorkouts = wl.value;
    apiAuth("GET", "/api/me/vitals").then((v) => { vitals = v; renderPerf(); }).catch(() => renderPerf());
    pollUnread();
    loadPatientDocs();
    apiAuth("GET", "/api/me/access").then((a) => { access = a; renderToday(); renderAccessBadge(); }).catch(() => {});
    loadContent().then(() => { renderFeaturedPrograms(); renderMyPlans(); const t = location.hash.slice(1).split("/"); if (["programs", "learn", "premium", "tips"].includes(t[0])) renderContent(t[0], t[0] === "programs" ? t.slice(1).join("/") : t[1]); });
    if (lb.status === "fulfilled") { lib = lb.value; renderPrograms(); if (!$("#view-videos").hidden) renderVideos(); }
    renderStats(); renderEvents(); renderActivity(); renderNotes(); renderCalendar();
    setTimeout(notifyVisits, 1200);
    loadRewards();
    loadSite().catch(() => {});
  })();
})();
