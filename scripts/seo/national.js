// National phases (see docs/SEO-PLAN.md, phases N3–N12): exercise library, program pages, membership, author page,
// pain finder and llms.txt. Called by scripts/seo/build.js (group "national"); pushes into the shared `generated` list
// so the sitemap and search index pick the pages up. Same template and CSS as every other generated page.
// Sources: app/exercises.js, musclereports.js (written cues and doses), data/protocols/*.json (program content),
// data/seo/app-content.json (snapshot of live tiers and program metadata from GET /api/content), data/youtube.json.
"use strict";
const fs = require("fs"), path = require("path");
const L = require("./lib");
const { esc, attr, data, muscleUrl, findExercise, RATING_P, BOOK_ROW, CTA, crumbs, breadcrumbLd, faqLd, faqHtml, page, webPage, SITE, TODAY, write, readJson, words, withInsuranceFaq } = L;
const { M, reports } = data;

const app = readJson("data/seo/app-content.json");
const yt = fs.existsSync(path.join(L.root, "data/youtube.json")) ? readJson("data/youtube.json") : { channel: "", videos: {} };
const MIN_WORDS = 700;
// Same counting rule as scripts/seo/check.js, so a page the generator publishes always passes the gate
const checkWords = (html) => (html.replace(/<blockquote[\s\S]*?<\/blockquote>/g, " ").replace(/<ul class="cd-links">[\s\S]*?<\/ul>/g, " ").replace(/<div class="cd-cta">[\s\S]*?<\/div>/g, " ")
  .replace(/<details class="cd-faq"><summary>Do you take insurance\?<\/summary>[\s\S]*?<\/details>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
const slug = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mLink = (id) => `<a href="${muscleUrl(id)}">${esc(M[id].name.replace(/\s*\([^)]*\)/g, ""))}</a>`;
const PHASE = { calm: "calm-it-down phase", restore: "restore-movement phase", strengthen: "strengthen phase" };
const LOC = { home: "at home", gym: "in a gym", any: "at home or in a gym" };
const listJoin = (a) => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const ytLink = (name) => { const id = (yt.videos || {})[name]; return id ? ` <a href="https://www.youtube.com/watch?v=${attr(id)}" rel="noopener">Watch on YouTube</a>.` : ""; };

// ---------- Exercise library (N3)
// Single-exercise pages need written steps from Dr. Jared and a public video; until then the library is published as
// region pages that pool the real cues and doses already written in the muscle relief plans.
const GROUPS = [
  { slug: "neck-and-posture", name: "Neck & Posture", regions: ["Neck", "Desk & posture"], focus: "the neck, the base of the skull and the desk-posture muscles between the shoulder blades" },
  { slug: "shoulders", name: "Shoulder", regions: ["Shoulders", "Upper body"], focus: "the rotator cuff, the deltoids, the chest and the muscles that steer the shoulder blade" },
  { slug: "arms-elbows-wrists", name: "Arm, Elbow & Wrist", regions: ["Arms", "Wrists"], focus: "the biceps, triceps and the forearm muscles behind tennis and golfer's elbow" },
  { slug: "spine-and-core", name: "Spine & Core", regions: ["Spine", "Core"], focus: "the low and mid back, the deep spinal muscles and the abdominal wall" },
  { slug: "hips", name: "Hip", regions: ["Hips"], focus: "the glutes, hip flexors, deep hip rotators and adductors" },
  { slug: "legs-knees-ankles", name: "Leg, Knee & Ankle", regions: ["Legs", "Knees", "Ankles"], focus: "the quads, hamstrings, calves, shins and the small muscles of the foot" },
  { slug: "full-body", name: "Full-Body", regions: ["Full body"], focus: "whole-body strength, conditioning and movement patterns" }
];
const usesByExercise = (() => {
  const out = new Map();
  for (const [id, r] of Object.entries(reports)) for (const [ph, arr] of Object.entries(r.protocol || {})) for (const x of arr) {
    const e = findExercise(x.video || x.name); if (!e || !M[id]) continue;
    if (!out.has(e.name)) out.set(e.name, []);
    out.get(e.name).push({ id, ph, how: (x.how || "").trim(), dose: (x.dose || "").trim() });
  }
  for (const [id, m] of Object.entries(M)) for (const v of m.videos || []) { const e = findExercise(v); if (!e) continue; if (!out.has(e.name)) out.set(e.name, []); if (!out.get(e.name).some((u) => u.id === id)) out.get(e.name).push({ id, ph: "", how: "", dose: "" }); }
  return out;
})();
const exerciseHtml = (e) => {
  const uses = usesByExercise.get(e.name) || [];
  const muscles = [...new Set(uses.map((u) => u.id))];
  const cues = []; const seen = new Set();
  for (const u of uses) if (u.how && !seen.has(u.how)) { seen.add(u.how); cues.push(u); }
  const meta = [`level ${e.level} of 3`, e.cat.toLowerCase(), LOC[e.loc] || "", e.seated ? "done seated" : ""].filter(Boolean).join(", ");
  let h = `<p><b id="${slug(e.name)}">${esc(e.name)}</b> (${esc(meta)}).`;
  if (!cues.length) h += ` The video is in the free MD Fit app${muscles.length ? `; it appears in the relief plans for ${listJoin(muscles.map(mLink))}` : ""}.${ytLink(e.name)}</p>`;
  else {
    h += `${ytLink(e.name)}</p>\n    <ul>${cues.slice(0, 4).map((u) => `<li>For the ${mLink(u.id)}${u.ph ? ` (${PHASE[u.ph] || u.ph})` : ""}: ${esc(u.how.replace(/\.?$/, "."))}${u.dose ? ` Dose: ${esc(u.dose)}.` : ""}</li>`).join("")}</ul>`;
    const rest = muscles.filter((id) => !cues.slice(0, 4).some((c) => c.id === id));
    if (rest.length) h += `\n    <p>Also used in the relief plans for ${listJoin(rest.map(mLink))}.</p>`;
  }
  return h;
};
function buildExerciseGroup(g, list) {
  const url = `/exercises/${g.slug}`;
  const title = [`${g.name} Exercises: Dr. Jared's Library | MD Fit`, `${g.name} Exercises | MD Fit`].find((t) => t.length <= 60);
  const withCues = list.filter((e) => (usesByExercise.get(e.name) || []).some((u) => u.how));
  const muscles = [...new Set(list.flatMap((e) => (usesByExercise.get(e.name) || []).map((u) => u.id)))];
  const cats = [...new Set(list.map((e) => e.cat))];
  const description = `${list.length} ${g.name.toLowerCase()} exercises from Dr. Jared Caban's video library, with his cues and doses for ${g.focus.split(",")[0]}. Free videos in the MD Fit app.`.slice(0, 160);
  const trail = [{ name: "Home", href: "/" }, { name: "Exercises", href: "/exercises/" }, { name: `${g.name} exercises`, href: url }];
  const faq = withInsuranceFaq([
    { q: `Can I do these ${g.name.toLowerCase()} exercises on my own?`, a: `Yes, they are the same exercises Dr. Jared assigns as homework. Start with the level 1 versions, keep every repetition pain-free, and stop anything that causes sharp, shooting or worsening pain. If you are not sure which muscle is behind your pain, start with the pain-location pages or book an evaluation.` },
    { q: "Where are the videos?", a: `Every exercise on this page has a video in the free MD Fit app, under Videos. Members also get them inside full programs with a week-by-week progression.` },
    { q: "How often should I do them?", a: `Follow the dose listed next to each cue. Where no dose is listed, the exercise is used inside a program or an in-clinic plan, where the dose depends on the person.` }
  ]);
  const body = `    ${crumbs(trail)}
    <h1>${esc(g.name)} Exercises</h1>
    ${RATING_P}
    <p class="cd-lead">These are the ${list.length} ${esc(g.name.toLowerCase())} exercises in Dr. Jared Caban's video library, the same ones he assigns as homework at MD Fit in Sarasota. They work on ${esc(g.focus)}.</p>
    ${BOOK_ROW}
    <h2>How to use this page</h2>
    <p>Exercises are grouped by type (${esc(listJoin(cats.map((c) => c.toLowerCase())))}). Where Dr. Jared has written cues for an exercise in one of the muscle relief plans, they are shown here with the dose, and each cue names the muscle it is aimed at. ${withCues.length} of the ${list.length} exercises have written cues so far; the rest are listed with the muscles they are used for, and every one has a video in the free MD Fit app.</p>
    <p>Pain usually comes from a muscle somewhere other than where it hurts, so the best exercise depends on the source. If you are not sure which muscle is involved, start from <a href="/pain/">where it hurts</a> or the <a href="/muscles/">muscle library</a>, and follow the three-phase plan on that page: calm it down, restore movement, then strengthen.</p>
${cats.map((c) => `    <h2>${esc(c)} exercises</h2>\n    ${list.filter((e) => e.cat === c).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).map(exerciseHtml).join("\n    ")}`).join("\n")}
    <h2>Stop and get checked if</h2>
    <ul><li>An exercise causes sharp, shooting or steadily worsening pain, or pain that lasts into the next day.</li><li>You have numbness, tingling or weakness that is new or spreading.</li><li>Pain follows a fall, an accident or a blow.</li><li>You have chest pain, shortness of breath or sudden severe headache: call 911.</li></ul>
    ${faqHtml(faq)}
    ${CTA}
    <h2>Muscles these exercises work on</h2>
    <ul class="cd-links">${muscles.slice(0, 24).map((id) => `<li>${mLink(id)}</li>`).join("")}</ul>
    <h2>More exercise groups</h2>
    <ul class="cd-links">${GROUPS.filter((x) => x.slug !== g.slug && x.published).map((x) => `<li><a href="/exercises/${x.slug}">${esc(x.name)} exercises</a></li>`).join("")}<li><a href="/programs/">Week-by-week programs</a></li></ul>`;
  const graph = [webPage({ url, title, description, about: { "@type": "ExercisePlan", name: `${g.name} exercises`, exerciseType: cats.join(", ") } }),
    { "@type": "ItemList", name: `${g.name} exercises`, numberOfItems: list.length, itemListElement: list.map((e, i) => ({ "@type": "ListItem", position: i + 1, name: e.name, url: `${SITE}${url}#${slug(e.name)}` })) }, faqLd(faq), breadcrumbLd(trail)];
  return { url, title, description, html: page({ url, title, description, body, graph, section: "exercises" }), n: checkWords(body), list, kw: [g.name, ...g.regions, ...cats, "exercises", "stretches"] };
}
function buildExercises(generated) {
  const ex = data.exercises;
  // decide which groups are substantial enough to publish
  const built = GROUPS.map((g) => { const list = ex.filter((e) => g.regions.includes(e.region)); g.published = true; return { g, list }; });
  const pages = built.map(({ g, list }) => ({ g, r: buildExerciseGroup(g, list) }));
  for (const p of pages) p.g.published = p.r.n >= MIN_WORDS;
  const out = pages.filter((p) => p.g.published).map(({ g, list }) => ({ g, r: buildExerciseGroup(g, ex.filter((e) => g.regions.includes(e.region))) })); // rebuild with final cross-links
  const dir = path.join(L.root, "exercises");
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith(".html")) fs.unlinkSync(path.join(dir, f));
  for (const { g, r } of out) { write(`exercises/${g.slug}.html`, r.html); generated.push({ url: r.url, title: r.title, kind: "exercise", snippet: r.description, kw: r.kw, priority: 0.6, file: `exercises/${g.slug}.html` }); }
  // hub: every exercise, grouped; unpublished groups are listed in full here
  const url = "/exercises/", title = "Exercise Library: 159 Rehab & Strength Videos | MD Fit";
  const description = `Dr. Jared Caban's ${ex.length} rehab, mobility and strength exercises by body region, with his written cues and doses. Free videos in the MD Fit app.`;
  const trail = [{ name: "Home", href: "/" }, { name: "Exercises", href: url }];
  const groupBlock = (g) => { const list = ex.filter((e) => g.regions.includes(e.region)); const pub = out.some((o) => o.g === g);
    return `    <h2>${pub ? `<a href="/exercises/${g.slug}">${esc(g.name)} exercises</a>` : `${esc(g.name)} exercises`} (${list.length})</h2>\n    <p>${list.map((e) => pub ? `<a href="/exercises/${g.slug}#${slug(e.name)}">${esc(e.name)}</a>` : esc(e.name)).join(" · ")}</p>`; };
  const body = `    ${crumbs(trail)}
    <h1>The Exercise Library</h1>
    ${RATING_P}
    <p class="cd-lead">Every exercise Dr. Jared Caban uses at MD Fit, ${ex.length} in all, grouped by body region. Each has a video in the free MD Fit app, and most come with the cues and doses he writes into his muscle relief plans.</p>
    <p>Start from <a href="/pain/">where it hurts</a> or the <a href="/muscles/">muscle behind it</a> to find the right exercises for your pain, or follow a <a href="/programs/">week-by-week program</a>. Outside the Sarasota area? The full library, programs and remote sessions with Dr. Jared are in the <a href="/membership">MD Fit app</a>.${yt.channel ? ` Short demos are also on <a href="${attr(yt.channel)}" rel="noopener">Dr. Jared's YouTube channel</a>.` : ""}</p>
${GROUPS.map(groupBlock).join("\n")}
    ${CTA}`;
  const graph = [{ "@type": "CollectionPage", url: SITE + url, name: title, description, mainEntity: { "@type": "ItemList", itemListElement: out.map(({ g, r }, i) => ({ "@type": "ListItem", position: i + 1, name: `${g.name} exercises`, url: SITE + r.url })) } }, breadcrumbLd(trail)];
  if (title.length > 60) throw new Error("exercise hub title too long");
  write("exercises/index.html", page({ url, title, description, body, graph, section: "exercises" }));
  generated.push({ url, title, kind: "hub", snippet: description, kw: ["exercises", "stretches", "rehab exercises", "videos"], priority: 0.7, file: "exercises/index.html" });
  return { published: out.map((o) => o.g.slug), held: GROUPS.filter((g) => !out.some((o) => o.g === g)).map((g) => g.slug) };
}

// ---------- Program pages (N12): public summary + week-1 preview; the full program stays in the app
const plain = (s) => String(s || "").replace(/\s+/g, " ").trim();
const tc = (s) => /[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
const dataGaps = [];
function buildProgram(id, meta, p) {
  const url = `/programs/${id}`;
  const name = meta.title || tc(p.title);
  // the title is the program's real length; some data files are missing weeks (flagged by the build)
  const titled = Number((String(meta.title || p.title).match(/(\d+)[- ]Week/i) || [])[1]) || 0;
  const weeks = titled || (p.weeks || []).length;
  if (titled && titled !== (p.weeks || []).length) dataGaps.push(`${id}: title says ${titled} weeks, data has ${(p.weeks || []).length}`);
  const title = [`${name} | MD Fit`, `${name.replace(/^\d+-Week /, "")} Program | MD Fit`, `${name.slice(0, 50).replace(/\s+\S*$/, "")} | MD Fit`].find((t) => t.length <= 60);
  const w1 = (p.weeks || [])[0] || {};
  const ov = ((p.progression || {}).overview || []).filter((o) => o.focus || o.title);
  const principles = [...(p.principles || []), ...(w1.principles || [])].filter((x, i, a) => x && (x.title || x.text) && a.findIndex((y) => (y.title || y.text) === (x.title || x.text)) === i).slice(0, 8);
  const ex1 = (w1.exercises || []).filter((e) => e && e.name);
  const doseText = (d) => !d ? "" : [d.sets && `${d.sets} sets`, d.reps && `${d.reps} reps`, d.hold && `hold ${d.hold}`, d.tempo && `tempo ${d.tempo}`, d.frequency, d.other].filter(Boolean).join(", ");
  const summary = plain(meta.summary).replace(/\s*Phase \d[\s\S]*$/, "") || plain(p.tagline);
  const description = `${name}: ${weeks} weeks, ${meta.level || "all levels"}, ${meta.location === "gym" ? "gym" : "at home"}. Dr. Jared Caban's week-by-week plan, with week 1 free to preview.`.slice(0, 160);
  const trail = [{ name: "Home", href: "/" }, { name: "Programs", href: "/programs/" }, { name: name.replace(/ Protocol$| Program$/, ""), href: url }];
  const faq = withInsuranceFaq([
    { q: "How do I get the full program?", a: `Week 1 is on this page. All ${weeks} weeks, with the videos for every exercise and progress tracking, are in the MD Fit app with a membership. Patients at the Sarasota clinic may be assigned it as part of their plan.` },
    { q: "Can I do it without seeing Dr. Jared first?", a: "Many people do, especially with the remote 1-on-1 options in the app. If you have pain you can't explain, recent surgery, or symptoms in the red-flag list, get evaluated first." },
    { q: "What if an exercise hurts?", a: "Stop it. Every MD Fit program works inside a pain-free range; discomfort from effort is fine, sharp or worsening pain is not. Go back to the previous week's version or contact Dr. Jared." }
  ]);
  const body = `    ${crumbs(trail)}
    <h1>${esc(name)}</h1>
    ${RATING_P}
    <p class="cd-lead">${esc(summary || plain(p.tagline))}</p>
    <p><a class="cd-btn" href="/membership">Get the full program in the app</a> <a class="cd-btn ghost" href="/book?type=eval">Book an evaluation in Sarasota</a></p>
    <h2>At a glance</h2>
    <ul><li><b>Length:</b> ${weeks} weeks</li>${meta.level ? `<li><b>Level:</b> ${esc(meta.level)}</li>` : ""}<li><b>Where:</b> ${esc(meta.location === "gym" ? "a gym" : "at home")}</li>${meta.category ? `<li><b>Type:</b> ${esc(meta.category)}</li>` : ""}${p.tagline ? `<li><b>Aim:</b> ${esc(tc(plain(p.tagline)))}</li>` : ""}</ul>
${ov.length ? `    <h2>Week by week</h2>\n    <ol>${ov.map((o) => `<li><b>Week ${esc(o.week)}${o.title ? `: ${esc(tc(o.title))}` : ""}.</b> ${esc(plain(o.focus))}</li>`).join("")}</ol>` : ""}
${(p.dailyBasics || []).length ? `    <h2>Daily basics</h2>\n    <ul>${p.dailyBasics.map((x) => `<li>${esc(plain(typeof x === "string" ? x : [x.title, x.text].filter(Boolean).join(": ")))}</li>`).join("")}</ul>` : ""}
${((p.progression || {}).guidelines || []).length ? `    <h2>Guidelines</h2>\n    <ul>${p.progression.guidelines.map((x) => `<li>${esc(plain(typeof x === "string" ? x : [x.title, x.text].filter(Boolean).join(": ")))}</li>`).join("")}</ul>` : ""}
${((p.progression || {}).expect || []).length ? `    <h2>What to expect</h2>\n    <ul>${p.progression.expect.map((x) => `<li>${esc(plain(typeof x === "string" ? x : [x.title, x.text].filter(Boolean).join(": ")))}</li>`).join("")}</ul>` : ""}
${((p.progression || {}).callouts || []).length ? `    <p>${p.progression.callouts.map((c) => `<b>${esc(plain(c))}</b>`).join(" ")}</p>` : ""}
${principles.length ? `    <h2>The rules of this program</h2>\n    <ul>${principles.map((x) => `<li>${x.title ? `<b>${esc(tc(x.title))}.</b> ` : ""}${esc(plain(x.text))}</li>`).join("")}</ul>` : ""}
${(() => { const blocks = [...String(w1.notes || "").matchAll(/(WORKOUT [A-Z]) FOCUS:\s*\n((?:- .*\n?)+)/g)]; return blocks.length ? `    <h2>How week 1 is organized</h2>\n    <ul>${blocks.map((b) => `<li><b>${esc(tc(b[1]))}:</b> ${esc(b[2].trim().split(/\n/).map((x) => x.replace(/^-\s*/, "").trim()).join("; "))}.</li>`).join("")}</ul>` : ""; })()}
    <h2>Week 1 preview${w1.focus ? `: ${esc(tc(plain(w1.focus).split(":")[0]))}` : ""}</h2>
    ${w1.goal ? `<p>${esc(plain(w1.goal))}</p>` : ""}
${ex1.map((e) => `    <p><b>${esc(e.name)}</b>${doseText(e.dosage) ? ` (${esc(doseText(e.dosage))})` : ""}${e.why ? `. ${esc(plain(e.why))}` : ""}${e.whenToUse ? ` When to use it: ${esc(plain(e.whenToUse))}` : ""}</p>${(() => { const st = [...(e.howTo || []), ...(e.steps || [])].map((x) => plain(typeof x === "string" ? x : x.text || x.title || "")).filter((x, i, a) => x && a.indexOf(x) === i); return st.length ? `\n    <ol>${st.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""; })()}${(e.focus || []).length ? `\n    <p>Focus: ${esc(e.focus.map((f) => plain(typeof f === "string" ? f : f.text || "")).filter(Boolean).join("; "))}.</p>` : ""}${e.proTip ? `\n    <p><b>Tip:</b> ${esc(plain(e.proTip))}</p>` : ""}`).join("\n")}
    ${(p.progression || {}).remember ? `<p><b>Remember:</b> ${esc(plain(p.progression.remember))}</p>` : ""}
    <h2>Stop and get checked if</h2>
    <ul><li>An exercise causes sharp, shooting or worsening pain, or pain that lasts into the next day.</li><li>You have new numbness, tingling or weakness.</li><li>You are recovering from surgery and your surgeon has not cleared you for this kind of exercise.</li><li>You have chest pain, shortness of breath or a sudden severe headache: call 911.</li></ul>
    ${faqHtml(faq)}
    ${CTA}`;
  const graph = [webPage({ url, title, description, about: { "@type": "ExercisePlan", name, ...(meta.category ? { exerciseType: meta.category } : {}), activityDuration: `P${weeks}W` } }), faqLd(faq), breadcrumbLd(trail)];
  return { url, title, description, html: page({ url, title, description, body, graph, section: "programs" }), n: checkWords(body), name, meta, weeks };
}
function buildPrograms(generated) {
  const idx = readJson("data/protocols/index.json");
  const meta = Object.fromEntries(app.programs.map((p) => [p.id, p]));
  const built = idx.ids.map((id) => buildProgram(id, meta[id] || {}, readJson(`data/protocols/${id}.json`)));
  // same similarity rule as check.js (4-word shingles, body text, max 40%): a near-copy of a kept program is held
  const sh = (html) => { const t = html.match(/<main[\s\S]*?<\/main>/)[0].replace(/<blockquote[\s\S]*?<\/blockquote>|<ul class="cd-links">[\s\S]*?<\/ul>|<div class="cd-cta">[\s\S]*?<\/div>/g, " ").replace(/<details class="cd-faq"><summary>Do you take insurance\?<\/summary>[\s\S]*?<\/details>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").toLowerCase().match(/[a-z0-9']+/g) || []; const o = new Set(); for (let i = 0; i + 4 <= t.length; i++) o.add(t.slice(i, i + 4).join(" ")); return o; };
  const jac = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };
  const ok = [], held = [];
  for (const b of [...built].sort((x, y) => x.url.length - y.url.length)) { // base programs (shortest id) win over their variants
    if (b.n < MIN_WORDS) { held.push(b); continue; }
    b.sh = sh(b.html); const twin = ok.find((k) => jac(k.sh, b.sh) > 0.4);
    if (twin) { b.n = `${b.n} words, but ${Math.round(jac(twin.sh, b.sh) * 100)}% like ${twin.url}`; held.push(b); } else ok.push(b);
  }
  const dir = path.join(L.root, "programs");
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith(".html")) fs.unlinkSync(path.join(dir, f));
  for (const b of ok) { const f = `programs/${b.url.split("/").pop()}.html`; write(f, b.html); generated.push({ url: b.url, title: b.title, kind: "program", snippet: b.description, kw: [b.name, b.meta.category || "", "program", "protocol"], priority: 0.6, file: f }); }
  const url = "/programs/", title = "Rehab & Performance Programs by Dr. Jared | MD Fit";
  const description = `${ok.length} week-by-week programs from Dr. Jared Caban: knee, hip, shoulder, low back, elbow, plantar fasciitis, golf, pickleball, running and more.`;
  const trail = [{ name: "Home", href: "/" }, { name: "Programs", href: url }];
  const body = `    ${crumbs(trail)}
    <h1>Programs</h1>
    ${RATING_P}
    <p class="cd-lead">Dr. Jared Caban's week-by-week programs, the same ones he assigns to patients at MD Fit. Each page shows the plan at a glance and the full first week; the complete program, with videos and progress tracking, is in the MD Fit app.</p>
    <p><a class="cd-btn" href="/membership">See membership</a> <a class="cd-btn ghost" href="/exercises/">Browse the exercise library</a></p>
    <ul class="cd-grid">${ok.map((b) => `<li><a href="${b.url}"><b>${esc(b.name)}</b><span>${b.weeks} weeks${b.meta.level ? ` · ${esc(b.meta.level)}` : ""}${b.meta.category ? ` · ${esc(b.meta.category)}` : ""}</span></a></li>`).join("")}</ul>
    ${CTA}`;
  const graph = [{ "@type": "CollectionPage", url: SITE + url, name: title, description, mainEntity: { "@type": "ItemList", itemListElement: ok.map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, url: SITE + b.url })) } }, breadcrumbLd(trail)];
  write("programs/index.html", page({ url, title, description, body, graph, section: "programs" }));
  generated.push({ url, title, kind: "hub", snippet: description, kw: ["programs", "protocols", "rehab program"], priority: 0.7, file: "programs/index.html" });
  return { published: ok.map((b) => b.url), held: held.map((b) => `${b.url} (${typeof b.n === "number" ? b.n + " words" : b.n})`) };
}

// ---------- Membership (N12)
function buildMembership(generated) {
  const url = "/membership", title = "MD Fit App Membership: Rehab From Anywhere | MD Fit";
  const description = "Dr. Jared Caban's programs, video library, live Q&A and remote 1-on-1 sessions in the MD Fit app, for people anywhere in the US. Plans from $" + Math.min(...app.tiers.map((t) => t.price)) + "/month.";
  const trail = [{ name: "Home", href: "/" }, { name: "Membership", href: url }];
  const money = (n) => "$" + (Number.isInteger(n) ? n : n.toFixed(2));
  const faq = withInsuranceFaq([
    { q: "Do I need to live near Sarasota?", a: "No. The app and the remote sessions work anywhere in the United States. If you are near Sarasota you can also see Dr. Jared in person at the clinic on Clark Road." },
    { q: "Is the app free?", a: "Yes, the MD Fit app is free to download and use for the pain tool and the exercise videos Dr. Jared assigns. A membership unlocks every premade program, the full lecture library, the monthly live Q&A and the progress tools; the Premium plans add scheduled remote sessions." },
    { q: "How do remote sessions work?", a: "Premium plans include scheduled 30-minute remote sessions with Dr. Jared each month, plus direct messaging. He builds a custom program for you and adjusts it as you progress." },
    { q: "Is this a replacement for seeing a doctor?", a: "No. MD Fit is exercise-based rehabilitation and coaching. It works alongside your medical care, and Dr. Jared will tell you when something needs a specialist." }
  ]);
  const body = `    ${crumbs(trail)}
    <h1>Rehab and Training With Dr. Jared, From Anywhere</h1>
    ${RATING_P}
    <p class="cd-lead">The MD Fit app puts Dr. Jared Caban's programs, video library and coaching on your phone, so you can follow the same plans his Sarasota patients use from anywhere in the US.</p>
    <p><a class="cd-btn" href="/login">Create a free account</a> <a class="cd-btn ghost" href="/?site=1#pricing">See plans and checkout</a></p>
    <h2>What you get in the app</h2>
    <ul><li><b>Pain tool.</b> Tap where it hurts and pick the pattern that matches, then get Dr. Jared's exercise track for it.</li><li><b>${data.exercises.length} exercise videos.</b> The full <a href="/exercises/">exercise library</a>, the same exercises assigned as homework in the clinic.</li><li><b>Programs.</b> Week-by-week plans for knees, hips, shoulders, low back, elbows, feet, golf, pickleball, running and more. See them on the <a href="/programs/">programs page</a>.</li><li><b>Workout builder.</b> Build your own sessions or use the generator, and track progress over time.</li><li><b>Lectures and live Q&amp;A.</b> Dr. Jared explains the why behind the exercises.</li></ul>
    <h2>Plans</h2>
${app.tiers.map((t) => `    <p><b>${esc(t.name)}: ${money(t.price)} a month.</b></p>\n    <ul>${(t.perks || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("\n")}
    <p>Prices as listed in the app; checkout is handled securely by Stripe.</p>
    <h2>Who it is for</h2>
    <p>People with muscle and joint pain who want a clear plan, people recovering after surgery once their surgeon has cleared them for exercise, and active people (golfers, pickleball players, runners) who want to move better and stay healthy. If you are near Sarasota, an in-person <a href="/book?type=eval">evaluation</a> is the fastest way to find the source of your pain; the app then carries your homework between visits.</p>
    <h2>Find your starting point</h2>
    <p>Not sure where to begin? Start from <a href="/pain/">where it hurts</a>, read about <a href="/muscles/">the muscle behind it</a>, or pick a <a href="/programs/">program</a> for your goal. Meet <a href="/dr-jared-caban">Dr. Jared</a>.</p>
    ${faqHtml(faq)}
    ${CTA}`;
  const graph = [{ "@type": "WebPage", url: SITE + url, name: title, description, provider: { "@id": `${SITE}/#clinic` },
    mainEntity: { "@type": "Service", name: "MD Fit app membership", provider: { "@id": `${SITE}/#clinic` }, areaServed: { "@type": "Country", name: "United States" },
      offers: app.tiers.map((t) => ({ "@type": "Offer", name: t.name, price: String(t.price), priceCurrency: "USD", url: SITE + url })) } }, faqLd(faq), breadcrumbLd(trail)];
  write("membership.html", page({ url, title, description, body, graph, section: "membership" }));
  generated.push({ url, title, kind: "landing", snippet: description, kw: ["membership", "app", "online rehab", "remote", "telehealth"], priority: 0.8, file: "membership.html" });
}

// ---------- Author page (N10)
function buildAuthor(generated) {
  const url = "/dr-jared-caban", title = "Dr. Jared Caban, MD, MSc, CCEP, LMT | MD Fit";
  const description = "Dr. Jared Caban leads MD Fit in Sarasota: medical doctorate, Master's in performance, Certified Clinical Exercise Physiologist and Licensed Massage Therapist.";
  const trail = [{ name: "Home", href: "/" }, { name: "Dr. Jared Caban", href: url }];
  const same = ["https://www.facebook.com/MDFitSRQ/", ...(yt.channel ? [yt.channel] : [])];
  const body = `    ${crumbs(trail)}
    <h1>Dr. Jared Caban</h1>
    ${RATING_P}
    <p class="cd-lead">Dr. Jared Caban completed his medical doctorate in 2017 and holds a Master's degree in performance. He is a Certified Clinical Exercise Physiologist (CCEP) and a Licensed Massage Therapist (LMT), and he leads every plan at MD Fit on Clark Road in Sarasota.</p>
    ${BOOK_ROW}
    <h2>Credentials</h2>
    <ul><li><b>MD, MSc.</b> Medical doctorate and a Master's in performance.</li><li><b>CCEP.</b> Certified Clinical Exercise Physiologist.</li><li><b>LMT.</b> Licensed Massage Therapist (medical massage).</li><li><b>1-on-1.</b> Every session at MD Fit is coached by Dr. Jared.</li></ul>
    <h2>His approach</h2>
    <p>MD Fit is his answer to the gap between the clinic and the gym: a hybrid of rehabilitation, performance and recovery. Instead of chasing symptoms, he finds the muscle at the source of the pain, corrects the movement pattern behind it, and builds the strength to keep it from coming back.</p>
    <p>Every plan follows the same five steps: assess, release, correct, assign homework, strengthen. The training itself moves through range of motion, stability, mobility, strength and dynamic strength, in that order, because skipping a step makes the body compensate, and compensation is where pain comes from.</p>
    <h2>What he writes and reviews</h2>
    <p>The clinical pages on this site are drawn from Dr. Jared's own referred-pain work and exercise prescriptions: the <a href="/muscles/">muscle library</a>, the <a href="/pain/">pain-location pages</a>, the <a href="/conditions/">conditions we treat</a>, the <a href="/exercises/">exercise library</a>, the <a href="/programs/">programs</a> and the <a href="/blog/">blog</a>. Each clinical page shows the date it was last reviewed.</p>
    <h2>Work with Dr. Jared</h2>
    <p>In Sarasota, book an <a href="/book?type=eval">evaluation</a> at the clinic (3214 Clark Road, Sarasota, FL 34231). Anywhere in the US, follow his programs and book remote 1-on-1 sessions through the <a href="/membership">MD Fit app</a>.${yt.channel ? ` Short exercise demos are on his <a href="${attr(yt.channel)}" rel="noopener">YouTube channel</a>.` : ""}</p>
    ${CTA}`;
  const graph = [{ "@type": "ProfilePage", url: SITE + url, name: title, description, mainEntity: { "@id": `${SITE}/#dr-jared` }, dateModified: TODAY }, breadcrumbLd(trail)];
  write("dr-jared-caban.html", page({ url, title, description, body, graph, section: "author" }).replace(`"@id":"${SITE}/#dr-jared"`, `"@id":"${SITE}/#dr-jared","sameAs":${JSON.stringify(same)}`));
  generated.push({ url, title, kind: "landing", snippet: description, kw: ["Dr. Jared Caban", "about", "credentials"], priority: 0.7, file: "dr-jared-caban.html" });
}

// ---------- llms.txt (N11, an experiment: plain list of the key pages for AI tools)
function buildLlms(sections) {
  const lines = ["# MD Fit", "", "> Physical rehabilitation and pain treatment in Sarasota, FL, led by Dr. Jared Caban (MD, MSc, CCEP, LMT), plus an app with programs and remote sessions for people anywhere in the US. Educational content, not a diagnosis.", "",
    "## Start here", `- [Muscle library](${SITE}/muscles/): where each of 67 muscles refers pain, self-checks and a 3-phase relief plan`, `- [Pain locations](${SITE}/pain/): which muscles cause pain in each spot`, `- [Conditions](${SITE}/conditions/)`, `- [Exercise library](${SITE}/exercises/)`, `- [Programs](${SITE}/programs/)`, `- [Membership and remote care](${SITE}/membership)`, `- [Dr. Jared Caban](${SITE}/dr-jared-caban)`, `- [Book an evaluation](${SITE}/book)`, "",
    "## Practice facts", "- MD Fit, 3214 Clark Road, Sarasota, FL 34231. 941-313-0562. Mon–Fri 8 AM–4 PM.", "- Self-pay practice: no insurance billing, no referral needed.", ...sections];
  fs.writeFileSync(path.join(L.root, "llms.txt"), lines.join("\n") + "\n");
}

// ---------- Pain finder (N6): the homepage pain map, unchanged, on its own linkable page with a written guide below
function buildPainFinder(generated) {
  const url = "/pain-finder", title = "Pain Finder: Which Muscle Is Causing My Pain? | MD Fit";
  const description = "Tap where it hurts on the body map, pick the pattern that matches your pain, and see which muscles commonly cause it, with Dr. Jared's free exercise track.";
  const home = L.read("index.html");
  const section = home.match(/<section id="pain-map"[\s\S]*?<\/section>/)[0].replace(/(src|srcset)="assets\//g, '$1="/assets/').replace(/, assets\//g, ", /assets/").replace(/href="#book"/g, 'href="/book?type=eval"').replace('<h2 class="h2">', '<h1 class="h2">').replace(/(<h1 class="h2">[^<]*)<\/h2>/, "$1</h1>");
  const css = (home.match(/<link rel="stylesheet" href="styles\.css\?v=[^"]+">/) || ['<link rel="stylesheet" href="/styles.css">'])[0].replace('href="styles', 'href="/styles');
  const wanted = ["config.js", "common.js", "painmuscles.js", "painpatterns.js", "paintracks.js", "guides.js", "painmap.js"];
  const scripts = wanted.map((f) => (home.match(new RegExp(`<script src="${f.replace(".", "\\.")}(\\?v=[^"]+)?"><\\/script>`)) || [`<script src="${f}"></script>`])[0].replace('src="', 'src="/')).join("\n  ");
  const trail = [{ name: "Home", href: "/" }, { name: "Pain finder", href: url }];
  const faq = withInsuranceFaq([
    { q: "Why does the pain finder point to a muscle somewhere else?", a: "Muscles often refer pain away from themselves. A tight upper trapezius can cause a headache at the temple, and a gluteus minimus can send pain down the outside of the leg. The map is built from those referral patterns." },
    { q: "Is this a diagnosis?", a: "No. It shows which muscles commonly cause pain in the spot you choose, so you know where to start. A hands-on evaluation is what confirms the source." },
    { q: "Do I need an account?", a: "No. The map and the exercise videos it suggests are free, with no sign-up." }
  ]);
  const text = `    ${crumbs(trail)}
    <h2>How the pain finder works</h2>
    <p>Pain is often felt somewhere other than the muscle causing it. Dr. Jared Caban built this map from the referred-pain patterns he uses in the clinic: tap the area that hurts, choose the picture that looks most like your pain, and the finder lists the muscles that most often send pain there, in order, with a free exercise track for each pattern.</p>
    <h2>Read more about your pain</h2>
    <p>Every spot on the map has its own page in the <a href="/pain/">pain-location library</a>, and every muscle it names has a page in the <a href="/muscles/">muscle library</a> with symptoms, a self-check, look-alikes and a three-phase relief plan. The exercises are in the <a href="/exercises/">exercise library</a>, and full week-by-week plans are on the <a href="/programs/">programs page</a>.</p>
    <h2>Get checked instead if</h2>
    <ul><li>You have chest pain, shortness of breath, a sudden severe headache, or weakness or numbness on one side of the body: call 911.</li><li>Pain followed a fall, an accident or a blow.</li><li>You have new numbness, tingling or weakness, or loss of bladder or bowel control.</li><li>Pain comes with fever, unexplained weight loss, or is worse at night no matter how you lie.</li></ul>
    ${faqHtml(faq)}
    ${CTA}`;
  const graph = [{ "@type": ["WebApplication", "MedicalWebPage"], url: SITE + url, name: title, description, applicationCategory: "HealthApplication", operatingSystem: "Any (web)", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, provider: { "@id": `${SITE}/#clinic` }, reviewedBy: { "@id": `${SITE}/#dr-jared` }, lastReviewed: TODAY }, faqLd(faq), breadcrumbLd(trail)];
  let html = page({ url, title, description, body: text, graph, section: "pain-finder" });
  html = html.replace('<link rel="stylesheet" href="/guides.css">', `${css}\n  <link rel="stylesheet" href="/guides.css">`)
    .replace('<main class="cd-main" data-section="pain-finder">', `${section.replace(/^/gm, "  ")}\n  <main class="cd-main" data-section="pain-finder">`)
    .replace('  <script src="/config.js"></script>\n', `  ${scripts}\n`);
  write("pain-finder.html", html);
  generated.push({ url, title, kind: "landing", snippet: description, kw: ["pain finder", "which muscle is causing my pain", "pain map", "referred pain"], priority: 0.8, file: "pain-finder.html" });
}

function build(generated) {
  const ex = buildExercises(generated);
  const pr = buildPrograms(generated);
  buildMembership(generated);
  buildAuthor(generated);
  buildPainFinder(generated);
  buildLlms([`- [Pain finder](${SITE}/pain-finder): tap where it hurts to see which muscles commonly cause it`]);
  console.log(`national: exercise groups published ${ex.published.join(", ")}${ex.held.length ? `; held on the hub only (under ${MIN_WORDS} words): ${ex.held.join(", ")}` : ""}`);
  if (dataGaps.length) console.log(`national: program data gaps (week files missing): ${[...new Set(dataGaps)].join("; ")}`);
  console.log(`national: ${pr.published.length} program pages${pr.held.length ? `; held (under ${MIN_WORDS} words): ${pr.held.join(", ")}` : ""}`);
}
module.exports = { build };
