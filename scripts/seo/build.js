// Generates the SEO pages from data, then refreshes the site header, sitemap and search index.
//   node scripts/seo/build.js            (everything)
//   node scripts/seo/build.js muscles    (one group: muscles | pain | content | hubs)
// Sources: painmuscles.js, musclereports.js, paintracks.js, painpatterns.js, app/exercises.js, data/seo/*.json,
// data/seo/pages/**/*.json (see docs/SEO-CONTENT-SPEC.md). Output: /muscles/*, /pain/*, /activities/*, /conditions/<new>,
// /blog/<new>, the six landing pages and the three hubs. Re-run after any data change; never edit the output by hand.
"use strict";
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const L = require("./lib");
const { esc, attr, data, muscleUrl, painUrl, findExercise, thumb, quote, REVIEW, RATING, RATING_P, BOOK_ROW, CTA, withInsuranceFaq, crumbs, breadcrumbLd, faqLd, faqHtml, linkList, stepsHtml, ABOUT_DR, page, webPage, SITE, TODAY } = L;

const { M, AGGRAVATORS, SPOTS, rank, reports, tracks, patterns, slugs, pain, guides } = data;
const generated = []; // { url, title, kind, snippet, kw, priority, file }

// ---------- helpers
const spotKey = (a, l) => `${a}|${l}`;
const painBySpot = new Map(pain.pages.flatMap((p) => p.spots.map(([a, l]) => [spotKey(a, l), p])));
const painForMuscle = (id) => { // pain-location pages this muscle refers to, most common first
  const hits = [];
  for (const area in SPOTS) for (const [label, ids] of SPOTS[area]) { const i = ids.indexOf(id); if (i >= 0) { const p = painBySpot.get(spotKey(area, label)); if (p) hits.push({ p, i }); } }
  return [...new Map(hits.sort((a, b) => a.i - b.i).map((h) => [h.p.slug, h.p])).values()];
};
const foldedForMuscle = (id) => { const out = []; for (const k in pain.folded) { const [a, l] = k.split("|"); const s = (SPOTS[a] || []).find((x) => x[0] === l); if (s && s[1].includes(id)) out.push(pain.folded[k]); } return [...new Set(out)]; };
const tracksForMuscle = (id) => tracks.filter((t) => t.pts.includes(id));
const regionOf = (id) => { const t = tracksForMuscle(id)[0]; return t ? t.region : (painForMuscle(id)[0] || { region: "Body" }).region; };
const patternHtml = (trackId, alt) => patterns.has(trackId) ? patterns.html(trackId, alt).replace(/href="assets\//g, 'href="/assets/').replace('class="pp "', 'class="pp pp-2"') : "";
const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
const sentence = (s) => String(s).trim().replace(/\.?$/, ".");
const exerciseCard = (name) => { const e = findExercise(name); return e ? `<a href="/account#videos" title="Watch ${attr(e.name)} in the free MD Fit app"><img src="${thumb(e.id, 160)}" alt="" width="64" height="64" loading="lazy" referrerpolicy="no-referrer"> ${esc(e.name)}</a>` : esc(name); };
const videoLink = (name) => { const e = findExercise(name); return e ? `<a href="/account#videos">${esc(e.name)}</a>` : esc(name); };
const PHASE = { calm: "Phase 1 · Calm it down", restore: "Phase 2 · Restore movement", strengthen: "Phase 3 · Strengthen" };
const shortName = (name) => name.replace(/\s*\([^)]*\)/g, "").replace(/,\s*/, " ").replace(/\s+/g, " ").trim();

// ---------- Muscle pages (Phase 1)
function muscleFaq(id, m, r, locs) {
  const n = shortName(m.name), where = locs[0] ? locs[0].name.toLowerCase() : "nearby areas";
  const out = [
    { q: `Can a tight ${n.toLowerCase()} cause pain at the ${where}?`, a: `Often, yes. ${sentence(m.refers)} That referred pain is why it gets blamed on the joint or the spot that hurts instead of the muscle.` },
    { q: `How long does ${n.toLowerCase()} pain take to settle?`, a: sentence(r.expect) },
    { q: `When should I see someone about it?`, a: sentence(r.seePro) }
  ];
  if (r.mimics && r.mimics.length) out.push({ q: `What else can feel like ${n.toLowerCase()} pain?`, a: `${r.mimics.slice(0, 3).join(", ")}. An evaluation separates muscle pain from these, and anything that needs a physician is referred on.` });
  return out;
}
function buildMuscle(id) {
  const m = M[id], r = reports[id], slug = slugs[id], url = muscleUrl(id);
  const name = m.name, short = shortName(name), locs = painForMuscle(id), folded = foldedForMuscle(id), trk = tracksForMuscle(id);
  const title = [`${short} Pain & Trigger Points | MD Fit`, `${short} Pain & Relief | MD Fit`, `${short} Pain | MD Fit`].find((t) => t.length <= 60);
  const description = `${short}: where it refers pain, symptoms, self-check and Dr. Jared Caban's 3-phase relief plan with free exercise videos. MD Fit, Sarasota FL.`.slice(0, 160);
  const faq = withInsuranceFaq(muscleFaq(id, m, r, locs));
  const neighbors = [...new Set(trk.flatMap((t) => t.pts))].filter((x) => x !== id && M[x]).slice(0, 6);
  const siblings = neighbors.length ? neighbors : Object.keys(M).filter((x) => x !== id && regionOf(x) === regionOf(id)).slice(0, 6);
  const trail = [{ name: "Home", href: "/" }, { name: "Muscles", href: "/muscles/" }, { name: short, href: url }];
  const body = `    ${crumbs(trail)}
    <h1>${esc(short)} Pain: Symptoms, Trigger Points &amp; Relief</h1>
    ${RATING_P}
    <p class="cd-lead">${esc(sentence(m.does))} ${esc(sentence(m.refers))}</p>
    ${quote(REVIEW)}
    ${BOOK_ROW}
    <h2>Where the ${esc(short.toLowerCase())} sends pain</h2>
    <p>${esc(sentence(m.refers))} ${locs.length ? `People usually come in describing pain at the ${locs.map((p) => `<a href="${painUrl(p.slug)}">${esc(p.name.toLowerCase())}</a>`).join(", ").replace(/, ([^,]*)$/, " or $1")}.` : ""}${folded.length ? ` It is also a common hidden driver behind ${folded.map((u) => `<a href="${u}">${esc(data.titles[u] || u)}</a>`).join(" and ")}.` : ""}</p>
    ${trk.length && patterns.has(trk[0].id) ? `<p>Dr. Jared's referred-pain drawing for this track (red = where it hurts, × = where the trigger point usually sits):</p>\n    ${patternHtml(trk[0].id, `${trk[0].title} referred pain pattern`)}` : ""}
    <h2>What the ${esc(short.toLowerCase())} does</h2>
    <p>${esc(sentence(r.action))}</p>
    <ul><li><b>Starts at:</b> ${esc(r.origin)}</li><li><b>Attaches to:</b> ${esc(r.insertion)}</li><li><b>Nerve supply:</b> ${esc(r.nerve)}</li></ul>
    <h2>Symptoms people describe</h2>
    <ul>${li(r.symptoms)}</ul>
    <h2>What makes it worse</h2>
    <p>${esc(m.worse.map((w) => AGGRAVATORS[w] || w).join(" · "))}. If two or more of those match your day, this muscle moves up the list.</p>
    <h2>Quick self-check</h2>
    <p>Education, not a diagnosis. The more of these that ring true, the more likely the ${esc(short.toLowerCase())} is involved:</p>
    <ul>${li(r.questions.map((q) => q.q))}</ul>
    ${r.tests && r.tests.length ? r.tests.map((t) => `<p><b>${esc(t.name)}.</b> ${esc(sentence(t.how))} <i>Suggests this muscle if:</i> ${esc(sentence(t.positive))}</p>`).join("\n    ") : ""}
    <h2>What it gets mistaken for</h2>
    <ul>${li(r.mimics)}</ul>
    <h2>Common causes</h2>
    <ul>${li(r.causes)}</ul>
    <h2>Dr. Jared's 3-phase relief plan</h2>
    <p>Work through the phases in order and move on when the current one feels easy and pain-free. Every video is in the free MD Fit app.</p>
    ${Object.entries(r.protocol).map(([ph, items]) => `<h3>${esc(PHASE[ph] || ph)}</h3>
    <ol class="cd-steps">${items.map((it) => `<li><b>${esc(it.name)}</b>${it.video && findExercise(it.video) && it.video.toLowerCase() !== it.name.toLowerCase() ? ` (video: ${videoLink(it.video)})` : it.video && findExercise(it.video) ? ` (${videoLink("video")})` : ""} · ${esc(it.dose)}<br>${esc(it.how)}</li>`).join("")}</ol>`).join("\n    ")}
    <p>Suggested library videos for this muscle: ${m.videos.map(videoLink).join(", ")}.</p>
    <h2>Habits that help</h2>
    <ul>${li(r.habits)}</ul>
    <h2>What to expect</h2>
    <p>${esc(sentence(r.expect))}</p>
    <h2>When to see a professional</h2>
    <p>${esc(sentence(r.seePro))} Get urgent care for any of these:</p>
    <ul>${li(r.redFlags)}</ul>
    ${m.guide && guides[m.guide] ? `<h2>Dr. Jared's guide</h2><p>This muscle is covered in depth in <a href="/guides/${m.guide}">${esc(guides[m.guide])}</a>, a free illustrated guide with its own video routine.</p>` : ""}
    <h2>How MD Fit treats ${esc(short.toLowerCase())} pain</h2>
    ${stepsHtml()}
    ${ABOUT_DR}
    ${faqHtml(faq)}
    ${CTA}
    ${linkList(siblings.map(muscleUrl), "Nearby muscles")}
    ${linkList([...locs.slice(0, 6).map((p) => painUrl(p.slug)), ...folded], "Where this muscle hurts")}`;
  const graph = [webPage({ url, title, description, about: { "@type": "Muscle", name, ...(r.action ? { muscleAction: r.action } : {}), ...(r.origin ? { origin: r.origin } : {}), ...(r.insertion ? { insertion: r.insertion } : {}), ...(r.nerve ? { nerve: r.nerve } : {}) } }), faqLd(faq), breadcrumbLd(trail)];
  L.write(`muscles/${slug}.html`, page({ url, title, description, body, graph, section: "muscles" }));
  generated.push({ url, title: `${short} pain`, kind: "muscle", snippet: m.refers.slice(0, 150), kw: [name, ...locs.map((p) => p.name), ...r.mimics.slice(0, 3)], priority: 0.7, file: `muscles/${slug}.html`, region: regionOf(id), short });
}
function buildMuscleHub() {
  const url = "/muscles/", title = "Muscle Pain Library: 67 Muscles Explained | MD Fit";
  const description = "Every muscle Dr. Jared treats: where each one refers pain, symptoms, self-checks and a free 3-phase relief plan. Find the muscle behind your pain.";
  const byRegion = {};
  for (const id of Object.keys(M)) (byRegion[regionOf(id)] ||= []).push(id);
  const trail = [{ name: "Home", href: "/" }, { name: "Muscles", href: url }];
  const body = `    ${crumbs(trail)}
    <h1>The Muscle Library</h1>
    ${RATING_P}
    <p class="cd-lead">Pain is usually felt somewhere other than the muscle causing it. These pages explain, muscle by muscle, where each one sends pain, how to check it and what to do, drawn from Dr. Jared Caban's referred-pain work in the clinic.</p>
    <p>Start from where it hurts with the <a href="/pain/">pain-location pages</a>, or pick a muscle below. Each page has symptoms, a self-check, look-alikes, red flags and a three-phase relief plan with free videos.</p>
    ${Object.entries(byRegion).sort((a, b) => a[0].localeCompare(b[0])).map(([region, ids]) => `<h2>${esc(region)}</h2>
    <ul class="cd-grid">${ids.map((id) => `<li><a href="${muscleUrl(id)}"><b>${esc(shortName(M[id].name))}</b><span>${esc(M[id].refers.split(/(?<=\.)\s/)[0].slice(0, 110))}</span></a></li>`).join("")}</ul>`).join("\n    ")}
    ${CTA}`;
  const graph = [{ "@type": "CollectionPage", url: SITE + url, name: title, description, mainEntity: { "@type": "ItemList", itemListElement: Object.keys(M).map((id, i) => ({ "@type": "ListItem", position: i + 1, name: M[id].name, url: SITE + muscleUrl(id) })) } }, breadcrumbLd(trail)];
  L.write("muscles/index.html", page({ url, title, description, body, graph, section: "muscles" }));
  generated.push({ url, title: "Muscle library", kind: "hub", snippet: description, kw: ["muscles", "trigger points", "referred pain"], priority: 0.8, file: "muscles/index.html" });
}

// ---------- Pain-location pages (Phase 2)
const REGION_NOTE = {
  "Head & face": "Head and face pain is one of the most common places for referred muscle pain to be mistaken for something else. The neck muscles, the jaw muscles and the trapezius all send pain into the head, which is why a headache can start in a shoulder that has been hunched over a phone. Posture, clenching and stress are the usual drivers; the pattern (one side, behind the eye, temple, forehead) is the clue to which muscle.",
  "Back of head": "The small muscles at the base of the skull and the long neck muscles refer pain up and over the head. Hours of looking down at a screen, sleeping on a stack of pillows, or holding the head still against stress loads them all day. The relief work is gentle: these muscles respond to release and slow, controlled movement, not force.",
  "Neck": "The neck carries the head, roughly the weight of a bowling ball, and every inch it drifts forward adds load to the muscles at the back and sides. Pain here is often referred from the scalenes, levator scapulae and upper trapezius, which also send pain into the shoulder, arm and head. Breathing pattern, desk setup and how you carry bags all matter.",
  "Shoulder": "The top of the shoulder is a crossroads: the trapezius, levator scapulae and rotator cuff all meet here, and neck muscles refer into it too. Pain that lives here without a clear injury is usually muscular and improves once the shoulder blade moves well again and the neck muscles stop guarding.",
  "Chest & ribs": "Chest and rib pain has to be cleared by a physician first, every time. Once the heart and lungs are ruled out, the muscles of the chest wall, the scalenes in the neck and the muscles between the ribs are frequent sources, often from breathing patterns, coughing, posture or pressing exercises. They respond well to release and breathing work.",
  "Shoulder (front)": "The front of the shoulder is where the biceps, pectorals and the front of the deltoid all converge, and the rotator cuff muscles behind the shoulder refer pain forward into it. That is why so much front-shoulder pain is blamed on the joint when the driver is a tight muscle at the back or in the chest. Overhead work, pressing and sleeping on the arm are the usual aggravators.",
  "Shoulder (back)": "Pain at the back of the shoulder usually comes from the rotator cuff muscles that sit on the shoulder blade, the rear deltoid or the long head of the triceps. These muscles work hardest when you reach behind you, carry at your side or hold the arm up for long periods, and they refer pain down the back of the arm.",
  "Upper back": "The upper back is where tight chest muscles pull the shoulder blades apart and the muscles between the blades strain to hold on. Pain here is often referred from the scalenes in the neck as well as the rhomboids and middle trapezius. Desk work, driving and phone use are the usual loads; a stronger mid-back and a more open chest usually settle it.",
  "Elbow & forearm": "Most elbow and forearm pain is tendon and muscle overload from gripping, typing and lifting: the wrist extensors on the outside, the flexors on the inside, the triceps at the point of the elbow and the biceps at the front. Neck and shoulder muscles can refer here too, which is why elbow pain sometimes will not settle until the shoulder is treated.",
  "Wrist & hand": "Hand and wrist pain is frequently referred from the forearm muscles and, further up, from the scalenes and pectoralis minor, which can also cause tingling in the fingers. Which fingers are involved is a useful clue. True nerve problems need a physician, so persistent numbness or weakness is always checked.",
  "Low back": "Low back pain is the most common reason people walk into MD Fit, and the spine itself is rarely the source. The quadratus lumborum, the deep back extensors, the hip flexors and the glutes all refer pain here, driven by sitting, lifting and how you hinge. Serious red flags are listed below; once they are excluded, movement and strength are the treatment.",
  "Buttock & hip": "The buttock and outer hip are where the gluteal muscles, the piriformis and the quadratus lumborum send pain, and from here pain often runs down the leg in a sciatica-like pattern. Sitting, stairs and side-sleeping are the usual aggravators. Strong, well-timed glutes are the fix for most of it.",
  "Hip (front)": "Front-of-hip and groin pain in adults is usually the hip flexors (psoas and iliacus), the adductors and the front of the quadriceps, shortened by sitting and then asked to sprint, swing or climb. The hip joint itself can be involved, so pain that catches, locks or limits rotation is assessed carefully.",
  "Thigh": "Thigh pain is mostly muscular: the quadriceps at the front, the tensor fasciae latae and vastus lateralis on the outside, the adductors on the inside. Hip flexor and gluteal trigger points also refer into the thigh. Sudden pain during sprinting or a kick is a strain and is handled differently from a slow-building ache.",
  "Back of thigh": "Hamstring-area pain comes from the hamstrings themselves, from the piriformis and gluteus minimus referring down the leg, and from the adductor magnus on the inside. Sitting on hard seats, sprinting and bending with straight knees are the common loads. Nerve-related pain down the leg is screened for first.",
  "Knee": "Most knee pain without a clear injury comes from the quadriceps, the adductors and the hip muscles that control the knee from above, plus the popliteus and calf behind it. Where exactly it hurts, and whether stairs, squatting or sitting provoke it, points to the muscle. Swelling, locking or giving way need a physician's assessment.",
  "Calf": "Calf pain is usually the gastrocnemius or soleus, but the gluteus minimus and peroneals refer here too, so a calf that will not settle may have its driver at the hip. A blood clot can mimic a calf strain and is a medical emergency; the warning signs are listed below.",
  "Ankle & foot": "Foot and ankle pain often starts higher up: the tibialis posterior, the calf muscles and the peroneals refer into the arch, heel and sides of the ankle, and the small foot muscles tighten from unsupportive shoes and hard floors. Strength and mobility of the calf and foot, plus footwear, settle most of it."
};
const FLAGS = {
  head: ["A sudden, severe headache unlike any you have had, or the worst headache of your life: call 911.", "Headache with fever and a stiff neck, confusion, slurred speech, weakness or numbness on one side, or loss of vision: call 911.", "Head pain after a fall or blow to the head, especially with vomiting or drowsiness: emergency care.", "Jaw or face pain with chest pressure, shortness of breath or sweating can be a heart attack: call 911."],
  neck: ["Neck pain with fever and a stiff neck, or with confusion: call 911.", "Neck pain after a car crash or fall, or with weakness, numbness or clumsiness in the arms or legs: get checked urgently.", "Neck or arm pain with chest pressure, shortness of breath, sweating or nausea can be a heart attack: call 911.", "Pain that is constant, worse at night, with unexplained weight loss: see a physician."],
  chest: ["Chest, upper-back or arm pain with pressure, shortness of breath, sweating, nausea or pain spreading to the jaw or arm can be a heart attack: call 911 now, do not stretch it out.", "Sudden sharp chest pain with trouble breathing can be a lung problem: call 911.", "Chest-wall pain after a fall or impact with trouble breathing: emergency care.", "MD Fit treats chest-wall and rib muscle pain only after a physician has ruled out the heart and lungs."],
  abdomen: ["Belly pain with fever, vomiting, blood in the stool or urine, or a rigid belly: emergency care.", "Pain that is constant, severe and not changed by position or movement is not a muscle pattern: see a physician.", "Side pain with fever, burning urination or blood in the urine can be a kidney problem: see a physician promptly.", "In pregnancy, any new abdominal pain should be checked by your OB."],
  back: ["Loss of bladder or bowel control, or numbness in the groin or inner thighs: call 911.", "Leg weakness that is getting worse, or numbness spreading down both legs: emergency care.", "Back pain with fever, chills or unexplained weight loss, or that is constant and not eased by any position: see a physician.", "Back pain after a fall or crash, or if you have osteoporosis or take steroids: get checked for a fracture."],
  leg: ["A swollen, warm, red or tender calf, especially after travel, surgery or bed rest, can be a blood clot: call 911 or go to the ER.", "Sudden severe calf pain with a pop, and you cannot push off the foot: urgent care.", "Leg pain with numbness in the groin or loss of bladder or bowel control: call 911.", "Coldness, paleness or no pulse in the foot: emergency care."],
  groin: ["Groin pain with a lump that will not push back in, vomiting or fever can be a hernia emergency: go to the ER.", "Groin or lower belly pain with fever, burning urination or blood in the urine: see a physician.", "In pregnancy, new pelvic or groin pain should be checked by your OB.", "A fall followed by inability to bear weight: get an X-ray."],
  hand: ["Numbness or weakness in the hand that is spreading or constant, or dropping things: see a physician for nerve testing.", "A cold, pale or blue hand, or sudden severe pain: emergency care.", "Hand pain with chest pressure, shortness of breath or sweating can be a heart attack: call 911.", "Swelling, redness and fever in a joint: urgent care."],
  default: ["Pain after a fall or impact with deformity, or you cannot bear weight or use the limb: get an X-ray.", "A joint that is hot, red, swollen and painful, especially with fever: urgent care.", "Numbness, pins and needles or weakness that is spreading or constant: see a physician.", "Pain that is constant, worse at night and not changed by movement or position: see a physician."]
};
// Each muscle's detailed notes (symptoms, self-check, causes, look-alikes) appear on the one pain page where it ranks
// highest, so neighbouring pages that share muscles don't repeat the same text. Other pages get its one-line pattern.
const HOME = (() => {
  const best = {};
  for (const p of pain.pages) for (const m of rank(p.spots.map(([a, l]) => spotKey(a, l)))) if (!best[m.id] || m.score > best[m.id].score) best[m.id] = { slug: p.slug, score: m.score };
  // every page owns at least one muscle: a page with none takes its best-ranked muscle from a page that owns two or more
  const owns = (slug) => Object.values(best).filter((b) => b.slug === slug).length;
  for (const p of pain.pages) {
    if (owns(p.slug)) continue;
    for (const m of rank(p.spots.map(([a, l]) => spotKey(a, l)))) if (M[m.id] && owns(best[m.id].slug) >= 2) { best[m.id] = { slug: p.slug, score: m.score }; break; }
  }
  return best;
})();
const INTROS = fs.existsSync(path.join(L.root, "data/seo/pain-intros.json")) ? L.readJson("data/seo/pain-intros.json") : {};
function buildPain(p) {
  const url = painUrl(p.slug), keys = p.spots.map(([a, l]) => spotKey(a, l));
  const ranked = rank(keys).filter((m) => M[m.id]).slice(0, 8);
  const owned = ranked.filter((m) => HOME[m.id] && HOME[m.id].slug === p.slug);
  const intro = INTROS[p.slug] || {};
  const lead4 = [...owned, ...ranked.filter((m) => !owned.includes(m))].slice(0, 4);
  // tracks ranked by how many of this page's leading muscles they cover (owned muscles count double)
  const cover = (t) => t.pts.reduce((n, id) => n + (owned.some((m) => m.id === id) ? 2 : lead4.some((m) => m.id === id) ? 1 : 0), 0);
  const sortedTracks = tracks.filter((t) => cover(t) > 0).sort((a, b) => cover(b) - cover(a));
  const ownedTracks = sortedTracks.filter((t) => t.pts.some((id) => owned.some((m) => m.id === id))).slice(0, 2);
  const trk = ownedTracks.length ? ownedTracks : sortedTracks.slice(0, 1);
  const aggr = [...new Set((owned.length ? owned : ranked.slice(0, 2)).flatMap((m) => m.worse))];
  const lower = p.name.toLowerCase();
  const at = /^(where|right )/i.test(lower) ? lower : `at the ${lower}`; // "pain where the neck meets the shoulder"
  const SMALL = new Set(["at", "the", "of", "or", "and", "beside", "behind", "below", "on", "in", "meets"]);
  const tc = (str) => str.split(" ").map((w, i) => (i > 0 && SMALL.has(w.replace(/[()]/g, ""))) ? w : w.replace(/^\(?[a-z]/, (c) => c.toUpperCase())).join(" ");
  const base = tc(`pain ${at}`); // "Pain Where the Neck Meets the Shoulder"
  const t2 = [`${base}: Causes & Relief | MD Fit`, `${base} | MD Fit`].find((t) => t.length <= 60);
  const description = `Pain ${at}: the muscles that most often refer pain here, what makes it worse, a free exercise track and the warning signs. From Dr. Jared Caban, MD Fit Sarasota.`.slice(0, 160);
  const flags = FLAGS[p.flags] || FLAGS.default;
  const nearby = pain.pages.filter((x) => x.region === p.region && x.slug !== p.slug).map((x) => painUrl(x.slug));
  const related = [...new Set(ranked.flatMap((m) => foldedForMuscle(m.id)))].slice(0, 4);
  // detail comes from the muscles this page "owns"; if it owns none, from its top muscle only (short form)
  const detail = owned.length ? owned.slice(0, 2) : [ranked[0]];
  const top = detail[0], second = detail[1], rep = reports[top.id], rep2 = second ? reports[second.id] : null;
  const uniq = (arr) => [...new Set(arr)];
  const take = (k, n1, n2) => uniq([...((rep[k]) || []).slice(0, owned.length ? n1 : 2), ...((rep2 && rep2[k]) || []).slice(0, n2)]);
  const symptoms = take("symptoms", 4, 3), causes = take("causes", 4, 2), mimics = take("mimics", 3, 2);
  const checks = uniq([...(rep.questions || []).slice(0, owned.length ? 3 : 2).map((q) => q.q), ...((rep2 && rep2.questions) || []).slice(0, 2).map((q) => q.q)]);
  const faq = [
    { q: `Why does it hurt ${at} if nothing is wrong there?`, a: `Muscles refer pain: a tight band in one muscle sends a predictable pattern of pain somewhere else. For pain ${at}, the usual sources are the ${ranked.slice(0, 3).map((m) => shortName(m.name).toLowerCase()).join(", ")}.` },
    { q: `How long does ${shortName(top.name).toLowerCase()} pain usually take to settle?`, a: sentence(rep.expect) },
    { q: `What makes it more likely to be the ${shortName(top.name).toLowerCase()}?`, a: `It is worse with ${top.worse.map((w) => (AGGRAVATORS[w] || w).toLowerCase()).join(", ")}, and pressing into the muscle reproduces the pain you know. ${sentence(top.refers)}` },
    { q: `When should I book instead of working on it myself?`, a: sentence(rep.seePro) }
  ].concat(withInsuranceFaq([]));
  const trail = [{ name: "Home", href: "/" }, { name: "Pain locations", href: "/pain/" }, { name: p.name, href: url }];
  const body = `    ${crumbs(trail)}
    <h1>Pain ${esc(at)}: What's Causing It</h1>
    ${RATING_P}
    <p class="cd-lead">${esc(intro.intro || `Pain ${at} very often starts in a muscle somewhere else. Below are the muscles that most commonly send pain here, how to tell them apart, and the free track Dr. Jared uses to settle it.`)}</p>
    ${quote(REVIEW)}
    ${BOOK_ROW}
    ${intro.differs ? `<h2>Is it this, or something next to it?</h2>\n    <p>${esc(intro.differs)}</p>` : ""}
    ${intro.scenario ? `<p><i>${esc(intro.scenario)}</i></p>` : ""}
    <h2>Muscles that commonly refer pain here</h2>
    <p>Ranked the way the MD Fit pain map ranks them, most common first:</p>
    <ol class="cd-steps">${ranked.map((m) => `<li><b><a href="${muscleUrl(m.id)}">${esc(shortName(m.name))}</a>.</b> ${esc(owned.includes(m) ? sentence(m.refers) : sentence(m.refers.split(/[;.]/)[0]))}${owned.includes(m) ? ` <i>Worse with:</i> ${esc(m.worse.map((w) => (AGGRAVATORS[w] || w).toLowerCase()).join(", "))}.` : ""}</li>`).join("")}</ol>
    ${trk.filter((t) => patterns.has(t.id)).slice(0, 2).map((t) => `<h2>Match your pattern: ${esc(t.title)}</h2>
    <p>${esc(t.note)} Red marks where the pain is felt, × where the trigger point usually sits.</p>
    ${patternHtml(t.id, `${t.title} referred pain pattern`)}`).join("\n    ")}
    <h2>What people with this pain describe</h2>
    <p>Taken from Dr. Jared's notes on the ${esc(shortName(top.name).toLowerCase())}${second ? ` and the ${esc(shortName(second.name).toLowerCase())}, the two most common sources here` : ", the most common source here"}:</p>
    <ul>${li(symptoms)}</ul>
    <h2>Quick self-check</h2>
    <p>Education, not a diagnosis. The more of these that ring true, the more likely the top muscles are involved:</p>
    <ul>${li(checks)}</ul>
    <h2>How it usually starts</h2>
    <ul>${li(causes)}</ul>
    <h2>What it gets mistaken for</h2>
    <p>${esc(mimics.join("; "))}. An evaluation separates muscle pain from these, and anything that needs a physician is referred on.</p>
    <h2>What makes it worse, and what that tells you</h2>
    <ul>${aggr.slice(0, 6).map((w) => `<li><b>${esc(AGGRAVATORS[w] || w)}.</b> Points toward the ${esc(ranked.filter((m) => m.worse.includes(w)).slice(0, 3).map((m) => shortName(m.name).toLowerCase()).join(", "))}.</li>`).join("")}</ul>
    ${trk.length ? `<h2>Free exercise track${trk.length > 1 ? "s" : ""}</h2>
    <p>Dr. Jared's pain tracks for this area, in the order he uses them. Start at Level 1 and move on when it feels easy and pain-free; every video is free in the MD Fit app.</p>
    ${trk.slice(0, 2).map((t) => `<p><b>${esc(t.title)}</b> · ${t.levels.length} level${t.levels.length > 1 ? "s" : ""}</p>
    <ol class="cd-steps">${t.levels.map((lv) => `<li><b>${esc(lv.title)}:</b> ${lv.videos.map((v) => v.id ? videoLink(v.name) : esc(v.name) + " (coming soon)").join(", ")}</li>`).join("")}</ol>`).join("\n    ")}` : ""}
    <h2>Warning signs: get medical care, not a stretch</h2>
    <ul>${li(flags)}</ul>
    <h2>How MD Fit finds the source</h2>
    ${stepsHtml()}
    ${ABOUT_DR}
    ${faqHtml(faq)}
    ${CTA}
    ${linkList(nearby, `Other places it hurts: ${p.region}`)}
    ${linkList(related, "Related conditions")}`;
  const graph = [webPage({ url, title: t2, description, about: { "@type": "MedicalSymptom", name: `Pain ${at}` } }), faqLd(faq), breadcrumbLd(trail)];
  L.write(`pain/${p.slug}.html`, page({ url, title: t2, description, body, graph, section: "pain" }));
  generated.push({ url, title: `Pain ${at}`, kind: "pain", snippet: `Muscles that refer pain ${at}: ${ranked.slice(0, 3).map((m) => shortName(m.name)).join(", ")}`, kw: [p.name, p.region, ...ranked.slice(0, 4).map((m) => m.name)], priority: 0.7, file: `pain/${p.slug}.html` });
}
function buildPainHub() {
  const url = "/pain/", title = "Where Does It Hurt? Pain by Location | MD Fit";
  const description = "Pick where it hurts and see the muscles that most often refer pain there, what makes it worse, warning signs and Dr. Jared's free exercise track for that area.";
  const byRegion = {};
  for (const p of pain.pages) (byRegion[p.region] ||= []).push(p);
  const trail = [{ name: "Home", href: "/" }, { name: "Pain locations", href: url }];
  const body = `    ${crumbs(trail)}
    <h1>Where Does It Hurt?</h1>
    ${RATING_P}
    <p class="cd-lead">Pick the spot. Each page lists the muscles that most often send pain there, drawn from Dr. Jared Caban's pain map, plus the free exercise track for that area and the warning signs that mean see a physician instead.</p>
    <p>Prefer to start from the muscle? Use the <a href="/muscles/">muscle library</a>. For a named problem, see <a href="/conditions/">conditions we treat</a>.</p>
    ${Object.entries(byRegion).map(([region, ps]) => `<h2>${esc(region)}</h2>
    <p>${esc(REGION_NOTE[region] || "")}</p>
    <ul class="cd-grid">${ps.map((p) => `<li><a href="${painUrl(p.slug)}"><b>${esc(p.name)}</b><span>${esc(rank(p.spots.map(([a, l]) => spotKey(a, l))).slice(0, 3).map((m) => shortName(m.name)).join(", "))}</span></a></li>`).join("")}</ul>`).join("\n    ")}
    ${linkList(LANDING, "Local pages")}
    <h2>Covered on condition pages</h2>
    <ul class="cd-links">${Object.entries(pain.folded).map(([k, u]) => `<li><a href="${u}">${esc(k.split("|")[1])}</a></li>`).join("")}</ul>
    ${CTA}`;
  const graph = [{ "@type": "CollectionPage", url: SITE + url, name: title, description, mainEntity: { "@type": "ItemList", itemListElement: pain.pages.map((p, i) => ({ "@type": "ListItem", position: i + 1, name: p.name, url: SITE + painUrl(p.slug) })) } }, breadcrumbLd(trail)];
  L.write("pain/index.html", page({ url, title, description, body, graph, section: "pain" }));
  generated.push({ url, title: "Pain by location", kind: "hub", snippet: description, kw: ["pain map", "where does it hurt"], priority: 0.8, file: "pain/index.html" });
}

// ---------- Content pages from JSON (Phases 3, 4, 5 and the six landing upgrades)
const GROUP = { conditions: { dir: "conditions", crumb: ["Conditions", "/conditions/"], section: "conditions" }, activities: { dir: "activities", crumb: ["Activities", "/activities/"], section: "activities" },
  landing: { dir: "", crumb: null, section: "" }, blog: { dir: "blog", crumb: ["Blog", "/blog/"], section: "blog" } };
function loadContent() {
  const out = [];
  for (const g of Object.keys(GROUP)) {
    const d = path.join(L.root, "data/seo/pages", g);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) out.push(JSON.parse(fs.readFileSync(path.join(d, f), "utf8")));
  }
  return out;
}
const LEGACY_SPORTS = [["/golf-performance-sarasota", "Golf", "Hips, thoracic rotation and the swing."], ["/pickleball-injury-rehab-sarasota", "Pickleball", "Shoulders, elbows, Achilles and knees."], ["/running-injury-sarasota", "Running", "Shins, Achilles, knees and hips."]];
const LANDING = ["/best-rehab-near-me-sarasota", "/golf-performance-sarasota", "/pickleball-injury-rehab-sarasota", "/post-op-knee-rehab-sarasota", "/post-op-shoulder-rehab-sarasota", "/running-injury-sarasota"];
const AREAS = ["/areas/sarasota", "/areas/bradenton", "/areas/lakewood-ranch", "/areas/venice", "/areas/osprey"];
const allConditionUrls = () => fs.readdirSync(path.join(L.root, "conditions")).filter((f) => f.endsWith(".html") && f !== "index.html").map((f) => `/conditions/${f.replace(".html", "")}`).sort();
let allContent = [];
function buildContent(p) {
  const g = GROUP[p.group], url = g.dir ? `/${g.dir}/${p.slug}` : `/${p.slug}`;
  const trail = [{ name: "Home", href: "/" }, ...(g.crumb ? [{ name: g.crumb[0], href: g.crumb[1] }] : []), { name: p.h1.replace(/ in Sarasota, FL$/, ""), href: url }];
  const muscles = (p.muscles || []).filter((id) => M[id]), locs = (p.pain || []).filter((s) => pain.pages.some((x) => x.slug === s));
  const isBlog = p.group === "blog";
  const body = `    ${crumbs(trail)}
    <h1>${esc(p.h1)}</h1>
    ${isBlog ? `<p class="muted small">By Dr. Jared Caban, MD, MSc, CEP · Published ${esc(p.datePublished)}${p.dateModified && p.dateModified !== p.datePublished ? ` · Updated ${esc(p.dateModified)}` : ""}</p>` : RATING_P}
    <p class="cd-lead">${esc(p.lead)}</p>
    ${isBlog ? "" : `${quote(REVIEW)}\n    ${BOOK_ROW}`}
    ${p.sections.map((s) => `<h2>${esc(s.h2)}</h2>\n    ${s.html.trim()}`).join("\n    ")}
    ${muscles.length ? `<h2>Muscles behind this pain</h2>
    <ul>${muscles.map((id) => `<li><a href="${muscleUrl(id)}">${esc(shortName(M[id].name))}</a>: ${esc(M[id].refers.split(/(?<=\.)\s/)[0])}</li>`).join("")}</ul>` : ""}
    ${!isBlog ? `<h2>How MD Fit ${p.group === "activities" ? "works with you" : `treats ${esc(p.h1.replace(/ (Treatment|Recovery|Rehab|Relief|Support|Care)? ?in Sarasota, FL$/, "").toLowerCase())}`}</h2>
    ${stepsHtml(p.steps)}` : ""}
    ${p.timeline ? `<h2>What to expect</h2>\n    <p>${esc(p.timeline)}</p>` : ""}
    <h2>${isBlog ? "Red flags: see a physician, not a stretch" : "When to get medical care first"}</h2>
    <ul>${li(p.redFlags)}</ul>
    ${p.guides && p.guides.length ? `<h2>Free guides from Dr. Jared</h2><ul>${p.guides.filter((x) => guides[x]).map((x) => `<li><a href="/guides/${x}">${esc(guides[x])}</a></li>`).join("")}</ul>` : ""}
    ${isBlog ? "" : ABOUT_DR}
    ${faqHtml(isBlog ? p.faq : withInsuranceFaq(p.faq))}
    ${isBlog ? CTA.replace("Ready to get out of pain?", "Want this handled in person?") : CTA}
    ${linkList(locs.map(painUrl), "Where it hurts")}
    ${linkList(p.related, isBlog ? "Read next" : "Related")}
    ${p.group === "conditions" ? linkList(allConditionUrls().filter((u) => u !== url), "Other conditions we treat") : ""}
    ${p.group === "activities" ? linkList([...LEGACY_SPORTS.map((x) => x[0]), ...allContent.filter((c) => c.group === "activities" && c.slug !== p.slug).map((c) => `/activities/${c.slug}`)], "Other sports and lifestyles") : ""}
    ${isBlog ? linkList([...allContent.filter((c) => c.group === "blog" && c.slug !== p.slug).map((c) => `/blog/${c.slug}`), "/blog/what-is-a-cep"], "More from the blog") : ""}`;
  const about = p.about ? { "@type": p.about.type, name: p.about.name } : null;
  const graph = isBlog
    ? [{ "@type": "BlogPosting", "@id": SITE + url, url: SITE + url, headline: p.h1, description: p.description, datePublished: p.datePublished, dateModified: p.dateModified || p.datePublished,
      author: { "@id": `${SITE}/#dr-jared` }, publisher: { "@id": `${SITE}/#clinic` }, mainEntityOfPage: SITE + url, image: `${SITE}/assets/logo.webp` }, faqLd(p.faq), breadcrumbLd(trail)]
    : [webPage({ url, title: p.title, description: p.description, about }), faqLd(withInsuranceFaq(p.faq)), breadcrumbLd(trail)];
  const file = `${g.dir ? g.dir + "/" : ""}${p.slug}.html`;
  L.write(file, page({ url, title: p.title, description: p.description, body, graph, section: g.section }));
  generated.push({ url, title: p.h1.replace(/ in Sarasota, FL$/, ""), kind: p.group === "conditions" ? "condition" : p.group === "activities" ? "activity" : p.group, snippet: p.lead.slice(0, 150), kw: [...(p.sections || []).slice(0, 4).map((s) => s.h2), ...(p.about ? [p.about.name] : [])], priority: p.group === "blog" ? 0.6 : 0.8, file, date: p.datePublished });
  return { url, p };
}
function buildActivitiesHub(items) {
  const url = "/activities/", title = "Rehab & Performance by Sport and Lifestyle | MD Fit";
  const description = "Golf, pickleball, tennis, running, cycling, swimming, lifting, desk work, seniors and snowbirds: the injuries each brings and how MD Fit keeps you moving.";
  const legacy = LEGACY_SPORTS;
  const trail = [{ name: "Home", href: "/" }, { name: "Activities", href: url }];
  const body = `    ${crumbs(trail)}
    <h1>Rehab &amp; Performance by Activity</h1>
    ${RATING_P}
    <p class="cd-lead">Every sport and every stage of life loads the body its own way. These pages cover the pains each one brings, the muscles behind them and how Dr. Jared keeps you doing what you love.</p>
    <ul class="cd-grid">${[...legacy.map(([u, b, s]) => ({ u, b, s })), ...items.map(({ url: u, p }) => ({ u, b: p.h1.replace(/ in Sarasota(, FL)?$/, ""), s: p.lead.split(/(?<=\.)\s/)[0].slice(0, 110) }))].map((x) => `<li><a href="${x.u}"><b>${esc(x.b)}</b><span>${esc(x.s)}</span></a></li>`).join("")}</ul>
    ${CTA}
    ${linkList(LANDING, "Local pages")}
    ${linkList(AREAS, "Where our clients come from")}`;
  const graph = [{ "@type": "CollectionPage", url: SITE + url, name: title, description }, breadcrumbLd(trail)];
  L.write("activities/index.html", page({ url, title, description, body, graph, section: "activities" }));
  generated.push({ url, title: "Activities", kind: "hub", snippet: description, kw: ["sports", "golf", "pickleball", "tennis", "running"], priority: 0.8, file: "activities/index.html" });
}
// Existing hub pages get the new entries appended to their grids (conditions hub, blog hub)
function appendToHub(file, entries, marker) {
  const f = path.join(L.root, file);
  let s = fs.readFileSync(f, "utf8");
  const start = s.indexOf(`<!-- seo:${marker} -->`), end = s.indexOf(`<!-- /seo:${marker} -->`);
  const block = `<!-- seo:${marker} -->${entries.map((e) => `<li><a href="${e.url}"><b>${esc(e.b)}</b><span>${esc(e.s)}</span></a></li>`).join("")}<!-- /seo:${marker} -->`;
  if (start >= 0 && end > start) s = s.slice(0, start) + block + s.slice(end + `<!-- /seo:${marker} -->`.length);
  else s = s.replace(/(<ul class="cd-grid">[\s\S]*?)(<\/ul>)/, `$1${block}$2`);
  fs.writeFileSync(f, s);
}
// Condition pages that absorbed a pain-map spot get a "muscles that cause pain here" section (idempotent)
function addMusclesToConditionPages() {
  const byUrl = {};
  for (const [k, u] of Object.entries(pain.folded)) { const [a, l] = k.split("|"); const s = (SPOTS[a] || []).find((x) => x[0] === l); if (s) (byUrl[u] ||= new Set(s[1])).forEach(() => {}); for (const id of s ? s[1] : []) byUrl[u].add(id); }
  for (const [u, ids] of Object.entries(byUrl)) {
    const f = path.join(L.root, u.slice(1) + ".html");
    if (!fs.existsSync(f)) continue;
    let s = fs.readFileSync(f, "utf8");
    const block = `<!-- seo:muscles --><h2>Muscles that commonly cause pain here</h2>
    <p>On the MD Fit pain map, these are the muscles that most often refer pain to this area, most common first. Each has its own page with symptoms, a self-check and a free relief plan.</p>
    <ul>${[...ids].filter((id) => M[id]).map((id) => `<li><a href="${muscleUrl(id)}">${esc(shortName(M[id].name))}</a>: ${esc(M[id].refers.split(/(?<=\.)\s/)[0])}</li>`).join("")}</ul>
    <!-- /seo:muscles -->`;
    if (s.includes("<!-- seo:muscles -->")) s = s.replace(/<!-- seo:muscles -->[\s\S]*?<!-- \/seo:muscles -->/, block);
    else s = s.replace(/(\n\s*)<h2>Frequently asked questions<\/h2>/, `$1${block}$1<h2>Frequently asked questions</h2>`);
    fs.writeFileSync(f, s);
  }
}

// ---------- Sitemap and search index
function updateSitemap() {
  const f = path.join(L.root, "sitemap.xml");
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/\n?<!-- seo:generated -->[\s\S]*?<!-- \/seo:generated -->/, "");
  const have = new Set([...s.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const add = generated.filter((g) => !have.has(SITE + g.url)).map((g) => `  <url><loc>${SITE}${g.url}</loc><lastmod>${g.date || TODAY}</lastmod><priority>${g.priority.toFixed(1)}</priority></url>`);
  // regenerated landing pages already in the sitemap: bump lastmod
  for (const g of generated.filter((x) => have.has(SITE + x.url))) s = s.replace(new RegExp(`(<loc>${(SITE + g.url).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}</loc><lastmod>)[^<]+`), `$1${TODAY}`);
  s = s.replace(/\n?<\/urlset>\s*$/, `\n<!-- seo:generated -->\n${add.join("\n")}\n<!-- /seo:generated -->\n</urlset>\n`);
  fs.writeFileSync(f, s);
  return add.length;
}
function updateSearchIndex() {
  const f = path.join(L.root, "data/search-index.json");
  const idx = JSON.parse(fs.readFileSync(f, "utf8"));
  const syn = {}; for (const [k, vs] of Object.entries(idx.synonyms)) { syn[k] = [k, ...vs]; for (const v of vs) syn[v] = syn[v] || [k, ...vs]; }
  const stop = new Set(idx.stopwords);
  const tok = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter((t) => !stop.has(t));
  const KIND_ID = { muscle: "muscle", pain: "pain", condition: "cond", activity: "activity", landing: "landing", blog: "blog", hub: "hub" };
  const keep = idx.items.filter((it) => !generated.some((g) => it.url === g.url));
  const items = generated.map((g) => {
    const tf = {}, add = (t, w) => { for (const x of syn[t] || [t]) tf[x] = (tf[x] || 0) + w; };
    tok(g.title).forEach((t) => add(t, 5)); (g.kw || []).flatMap(tok).forEach((t) => add(t, 2)); tok(g.snippet).forEach((t) => add(t, 1));
    const len = Object.values(tf).reduce((a, b) => a + b, 0);
    return { id: `${KIND_ID[g.kind] || g.kind}:${g.url.replace(/^\/|\/$/g, "").replace(/\//g, "-")}`, kind: g.kind, title: g.title, url: g.url, snippet: g.snippet, kw: g.kw || [], tf, len, boost: g.kind === "hub" ? 1.1 : 1.2 };
  });
  const all = [...keep, ...items];
  const df = {}; for (const it of all) for (const t of Object.keys(it.tf)) df[t] = (df[t] || 0) + 1;
  const out = { ...idx, version: TODAY, docs: all.length, avgLen: all.reduce((a, it) => a + it.len, 0) / all.length, df, items: all };
  fs.writeFileSync(f, JSON.stringify(out));
  return items.length;
}

// ---------- Run
const only = process.argv[2];
const want = (g) => !only || only === g;
if (want("muscles")) { for (const id of Object.keys(M)) buildMuscle(id); buildMuscleHub(); }
if (want("pain")) { for (const p of pain.pages) buildPain(p); buildPainHub(); }
let content = [];
if (want("content")) {
  allContent = loadContent();
  content = allContent.map(buildContent);
  const acts = content.filter((c) => c.p.group === "activities");
  buildActivitiesHub(acts);
  appendToHub("conditions/index.html", content.filter((c) => c.p.group === "conditions").map(({ url, p }) => ({ url, b: p.h1.replace(/ (Treatment |Recovery |Rehab |Relief |Support |Care )?in Sarasota, FL$/, ""), s: p.lead.split(/(?<=\.)\s/)[0].slice(0, 110) })), "conditions");
  appendToHub("blog/index.html", content.filter((c) => c.p.group === "blog").map(({ url, p }) => ({ url, b: p.h1, s: p.description.slice(0, 110) })), "blog");
  addMusclesToConditionPages();
  // The conditions hub points at the three new hubs (idempotent)
  const hubFile = path.join(L.root, "conditions/index.html");
  let hub = fs.readFileSync(hubFile, "utf8");
  const hubBlock = `<!-- seo:hubs --><p>Not sure what to call it? Start from <a href="/pain/">where it hurts</a>, look up <a href="/muscles/">the muscle</a> behind it, or see what we treat for <a href="/activities/">your sport or stage of life</a>. New to MD Fit? Read <a href="/best-rehab-near-me-sarasota">what to expect from a first visit</a>, or find <a href="/areas/">directions from your town</a>: <a href="/areas/sarasota">Sarasota</a>, <a href="/areas/bradenton">Bradenton</a>, <a href="/areas/lakewood-ranch">Lakewood Ranch</a>, <a href="/areas/venice">Venice</a> and <a href="/areas/osprey">Osprey</a>.</p><!-- /seo:hubs -->`;
  hub = hub.includes("<!-- seo:hubs -->") ? hub.replace(/<!-- seo:hubs -->[\s\S]*?<!-- \/seo:hubs -->/, hubBlock) : hub.replace(/(<p class="cd-lead">[\s\S]*?<\/p>)/, `$1\n    ${hubBlock}`);
  fs.writeFileSync(hubFile, hub);
}
if (!only) {
  execFileSync(process.execPath, [path.join(L.root, "scripts/site-header.js")], { stdio: "inherit" });
  const sm = updateSitemap(), si = updateSearchIndex();
  execFileSync(process.execPath, [path.join(L.root, "scripts/version-assets.js")], { stdio: "inherit" });
  console.log(`seo build: ${generated.length} pages generated, ${sm} added to the sitemap, ${si} search-index entries refreshed`);
} else console.log(`seo build (${only}): ${generated.length} pages`);
