// Shared pieces for the SEO page generators: site constants, the condition-page template, data loaders.
// Pages are generated into the same template the hand-written condition pages use (guides.css + conditions.css,
// the shared site header, cd-* classes). No new CSS or layout: see docs/SEO-PLAN.md ground rules.
"use strict";
const fs = require("fs"), path = require("path");

const root = path.join(__dirname, "..", "..");
const SITE = "https://www.mymdfit.com";
const MAPS_URL = "https://maps.google.com/?cid=18426672193642042879";
const TODAY = process.env.SEO_DATE || new Date().toISOString().slice(0, 10);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const attr = esc;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const readJson = (p) => JSON.parse(read(p));
const write = (rel, s) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// Google rating, shared by every page (sync with scripts/seo/sync-review-count.js)
const google = readJson("data/google-reviews.json");
const RATING = { value: Number(google.rating).toFixed(1).replace(/\.0$/, ".0"), count: google.count };
const RATING_LINE = `★★★★★ ${RATING.value} · ${RATING.count} Google reviews`;
const REVIEW = google.reviews[0];
const quote = (r) => `<blockquote class="cd-review"><p>&ldquo;${esc(r.text.length > 300 ? r.text.slice(0, 300).replace(/\s+\S*$/, "") + "…" : r.text)}&rdquo;</p><cite>&mdash; ${esc(r.author)}, Google review</cite></blockquote>`;

// Load the browser-side data files in Node (they attach to window)
function loadWindowScript(rel) {
  const w = {};
  const fn = new Function("window", "document", read(rel));
  fn(w, { createElement: () => ({ style: {} }), addEventListener() {}, querySelector: () => null, body: {} });
  return w;
}
const data = (() => {
  const m = loadWindowScript("painmuscles.js").MDFitMuscles;
  const reports = loadWindowScript("musclereports.js").MDFIT_MUSCLE_REPORTS;
  const exercises = loadWindowScript("app/exercises.js").MDFIT_EXERCISES;
  const tracksSrc = read("paintracks.js").match(/const TRACKS = (\[[\s\S]*?\]);\n/)[1];
  const tracks = JSON.parse(tracksSrc);
  const patterns = loadWindowScript("painpatterns.js").MDFitPatterns;
  const slugs = readJson("data/seo/muscle-slugs.json");
  const pain = readJson("data/seo/pain-locations.json");
  const guides = {};
  for (const f of fs.readdirSync(path.join(root, "guides")).filter((x) => x.endsWith(".html"))) {
    const s = read("guides/" + f), t = s.match(/<title>([^<]*)<\/title>/);
    guides[f.replace(".html", "")] = (t ? t[1] : f).replace(/\s*[|·].*$/, "").replace(/&amp;/g, "&");
  }
  const titles = {}; // url -> page title (for link text), every public page
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/^[._]|^(node_modules|scripts|data|assets|app)$/.test(e.name)) walk(path.join(d, e.name)); }
    else if (e.name.endsWith(".html")) {
      const rel = path.join(d, e.name).replace(/\\/g, "/"), url = "/" + rel.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
      const s = read(rel), h = s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      if (h) titles[url] = h[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/ Treatment in Sarasota, FL$| in Sarasota, FL$/, "");
    } } };
  walk(".");
  return { M: m.MUSCLES, AGGRAVATORS: m.AGGRAVATORS, SPOTS: m.SPOTS, rank: m.rank, reports, exercises, tracks, patterns, slugs, pain, guides, titles };
})();

const muscleUrl = (id) => `/muscles/${data.slugs[id]}`;
const painUrl = (slug) => `/pain/${slug}`;
const exByName = new Map(data.exercises.map((e) => [e.name.toLowerCase(), e]));
const findExercise = (name) => name ? exByName.get(String(name).toLowerCase()) || null : null;
const thumb = (id, w = 320) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;

// The clinic node and Dr. Jared node, copied from the live homepage schema so every page shares the same @ids.
// The homepage carries MORE THAN ONE ld+json block and Dr. Jared is not in the first, so read them all: reading only
// the first left his node undefined and put a null in the @graph of every generated page.
const homeGraph = [...read("index.html").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .flatMap((m) => { try { const j = JSON.parse(m[1]); return j["@graph"] || [j]; } catch { return []; } });
const CLINIC = homeGraph.find((n) => n["@id"] === `${SITE}/#clinic`);
const DR = homeGraph.find((n) => n["@id"] === `${SITE}/#dr-jared`);
if (!CLINIC || !DR) throw new Error("index.html no longer defines #clinic and #dr-jared in its ld+json; fix that before building.");

const crumbs = (items) => `<p class="cd-crumbs">${items.map((c, i) => c.href && i < items.length - 1 ? `<a href="${attr(c.href)}">${esc(c.name)}</a>` : esc(c.name)).join(" › ")}</p>`;
const breadcrumbLd = (items) => ({ "@type": "BreadcrumbList", itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, ...(c.href ? { item: SITE + c.href } : {}) })) });
const faqLd = (faq) => faq && faq.length ? { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) } : null;
const faqHtml = (faq) => faq && faq.length ? `<h2>Frequently asked questions</h2>\n${faq.map((f) => `    <details class="cd-faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n")}` : "";
// A page can name a related page that has not been written yet; it is left out until it exists, then appears by itself.
const pageExists = (u) => { const rel = String(u).split(/[?#]/)[0].replace(/^\/+/, ""); if (!rel) return true;
  const f = rel.endsWith("/") ? rel + "index.html" : rel + ".html";
  if (fs.existsSync(path.join(root, f))) return true;
  const m = rel.match(/^(conditions|activities|blog)\/([a-z0-9-]+)$/) || (/^[a-z0-9-]+$/.test(rel) ? [0, "landing", rel] : null);
  return !!m && fs.existsSync(path.join(root, "data/seo/pages", m[1], m[2] + ".json")); };
const linkList = (urls, title) => {
  const items = urls.filter((u) => (data.titles[u] || /^\/(muscles|pain|activities|conditions|blog)\//.test(u)) && pageExists(u)).map((u) => `<li><a href="${attr(u)}">${esc(data.titles[u] || u)}</a></li>`);
  return items.length ? `<h2>${esc(title)}</h2>\n    <ul class="cd-links">${items.join("")}</ul>` : "";
};
// MD Fit does not bill insurance. Said the same way everywhere (FAQ + CTA line) so no page implies otherwise.
const INSURANCE_FAQ = { q: "Do you take insurance?", a: "No. MD Fit is a self-pay practice and does not bill insurance. You pay at the visit and receive an itemized receipt; no referral is needed. An evaluation is $300 (about 90 minutes) and follow-ups are $150. Paying directly is what lets Dr. Jared spend a full session with you, with no visit caps set by an insurer." };
const withInsuranceFaq = (faq) => (faq || []).some((f) => /insurance/i.test(f.q)) ? faq : [...(faq || []), INSURANCE_FAQ];
const CTA = `<div class="cd-cta"><h2>Ready to get out of pain?</h2><p>Serving Sarasota, Bradenton, Lakewood Ranch, Venice, Siesta Key and Osprey. Self-pay practice: no insurance paperwork, no referral needed.</p><a class="cd-btn" href="/book?type=eval">Book an evaluation</a> <a class="cd-btn ghost" href="/book?type=call">Free phone consult</a></div>`;
const BOOK_ROW = `<p><a class="cd-btn" href="/book?type=eval">Book an evaluation</a> <a class="cd-btn ghost" href="tel:+19413130562">Call 941-313-0562</a></p>`;
const RATING_P = `<p class="cd-rating"><a href="${MAPS_URL}" rel="noopener">${RATING_LINE}</a></p>`;
const STEPS = [["Assess.", "A hands-on evaluation of how you move and which muscles reproduce your pain."], ["Release.", "Targeted soft-tissue work on the muscle at the source."],
  ["Correct.", "Mobility and movement fixes so the problem stops coming back."], ["Assign homework.", "Short daily video routines in the free MD Fit app."],
  ["Strengthen.", "Progressive strength work so you stay pain-free and keep doing what you love."]];
const stepsHtml = (steps) => `<ol class="cd-steps">\n${(steps || STEPS.map(([b, text]) => ({ b, text }))).map((s) => `      <li><b>${esc(s.b)}</b> ${esc(s.text)}</li>`).join("\n")}\n    </ol>`;
const ABOUT_DR = `<h2>About Dr. Jared Caban</h2>
    <p>Dr. Jared Caban, MD, MSc, CEP, CCEP, LMT, leads every plan at MD Fit on Clark Road in Sarasota, combining medical training, clinical exercise physiology and hands-on medical massage.</p>`;

// Whole page. `graph` is the page-specific JSON-LD nodes (MedicalWebPage etc.); the clinic node is added first.
function page({ url, title, description, body, graph, section, robots }) {
  if (title.length > 60) throw new Error(`title over 60 chars: ${title}`);
  // filter(Boolean): a node that could not be built is left out rather than written as null
  const ld = { "@context": "https://schema.org", "@graph": [CLINIC, DR, ...graph].filter(Boolean) };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}">
  <link rel="canonical" href="${SITE}${url}">${robots ? `\n  <meta name="robots" content="${robots}">` : ""}
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}${url}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:image" content="${SITE}/assets/logo.webp">
  <meta name="theme-color" content="#0A1A2E">
  <link rel="icon" href="/assets/icon-64.png" type="image/png">
  <style>/* Self-hosted: loading these from Google cost two cross-origin hops and swapped the font in half a second
    later, reflowing every heading. Inline so there is no extra stylesheet to fetch before the faces are known.
    Both families are OFL-licensed. Montserrat is one variable file covering 400-800; Baskerville's roman covers
    400 and 700. Latin subset. Filenames carry a content hash, so they are cached for good (see vercel.json). */
@font-face{font-family:"Montserrat";font-style:normal;font-weight:400 800;font-display:swap;src:url("/assets/fonts/montserrat-var.a5ec5492.woff2") format("woff2")}
@font-face{font-family:"Libre Baskerville";font-style:normal;font-weight:400 700;font-display:swap;src:url("/assets/fonts/libre-baskerville.b1bcbff3.woff2") format("woff2")}</style>
  <link rel="stylesheet" href="/guides.css">
  <link rel="stylesheet" href="/conditions.css">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
  <link rel="stylesheet" href="/site-header.css">
  <script src="/site-header.js" defer></script>
</head>
<body class="gd-page cd-page">
  <!-- site-header -->
  <!-- /site-header -->
  <main class="cd-main"${section ? ` data-section="${section}"` : ""}>
${body}
  </main>
  <footer class="cd-foot"><p><b>MD Fit</b> · 3214 Clark Road, Sarasota, FL 34231 · <a href="tel:+19413130562">941-313-0562</a> · Mon–Fri 8 AM–4 PM</p>
  <p><a href="${MAPS_URL}" rel="noopener">★ ${RATING.value} on Google (${RATING.count} reviews)</a> · <a href="/privacy-policy">Privacy</a> · <a href="/terms">Terms</a></p>
  <p class="cd-fine">Educational information, not a diagnosis. In an emergency, call 911.</p></footer>
  <script src="/config.js"></script>
  <script src="/analytics.js" defer></script>
  <script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
`;
}

// "lastReviewed" and "reviewedBy" say a named clinician checked this page. They go in ONLY when Dr. Jared has
// actually signed the page off (`reviewed: true`, from the page's own reviewStatus or data/seo/approved.json).
// A draft page is still a real page; it just does not carry his name. Never default this to true.
const webPage = ({ url, title, description, about, lastReviewed, reviewed = false }) => ({
  "@type": "MedicalWebPage", url: SITE + url, name: title, description,
  ...(reviewed ? { lastReviewed: lastReviewed || TODAY, reviewedBy: { "@id": `${SITE}/#dr-jared` } } : {}),
  provider: { "@id": `${SITE}/#clinic` }, ...(about ? { about } : {})
});

const words = (html) => (String(html).replace(/<[^>]+>/g, " ").match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;

module.exports = { pageExists, INSURANCE_FAQ, withInsuranceFaq, root, SITE, MAPS_URL, TODAY, esc, attr, read, readJson, write, data, muscleUrl, painUrl, findExercise, thumb, quote, REVIEW, RATING, RATING_LINE,
  crumbs, breadcrumbLd, faqLd, faqHtml, linkList, CTA, BOOK_ROW, RATING_P, stepsHtml, ABOUT_DR, page, webPage, words };
