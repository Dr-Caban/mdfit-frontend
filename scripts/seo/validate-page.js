// Validates one or more SEO content JSON files against docs/SEO-CONTENT-SPEC.md.
//   node scripts/seo/validate-page.js data/seo/pages/conditions/*.json
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..");
const slugs = JSON.parse(fs.readFileSync(path.join(root, "data/seo/muscle-slugs.json"), "utf8"));
const pain = new Set(JSON.parse(fs.readFileSync(path.join(root, "data/seo/pain-locations.json"), "utf8")).pages.map((p) => p.slug));
const guides = new Set(fs.readdirSync(path.join(root, "guides")).filter((f) => f.endsWith(".html")).map((f) => f.replace(".html", "")));
const GROUPS = { conditions: "/conditions/", activities: "/activities/", landing: "/", blog: "/blog/" };
const text = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
const words = (s) => (text(s).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;

function validate(file) {
  const errs = [];
  let p;
  try { p = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return [`${file}: not JSON (${e.message})`]; }
  const e = (m) => errs.push(`${path.relative(root, file)}: ${m}`);
  if (!GROUPS[p.group]) e(`group must be one of ${Object.keys(GROUPS).join(", ")}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug || "")) e("slug must be lowercase-with-dashes");
  if (path.basename(file, ".json") !== p.slug) e("file name must equal slug");
  if (!p.title || p.title.length > 60) e(`title must be <= 60 chars (${(p.title || "").length})`);
  if (!/ \| MD Fit$/.test(p.title || "")) e('title must end with " | MD Fit"');
  if (!p.h1) e("h1 missing");
  if (!p.description || p.description.length < 110 || p.description.length > 160) e(`description must be 110–160 chars (${(p.description || "").length})`);
  if (!p.lead) e("lead missing");
  if (!Array.isArray(p.sections) || p.sections.length < 4 || p.sections.length > 10) e("sections: 4–10 required");
  for (const s of p.sections || []) {
    if (!s.h2 || !s.html) e("every section needs h2 and html");
    const bad = (s.html || "").match(/<(?!\/?(p|ul|ol|li|b|a)\b)[a-z][^>]*>/gi);
    if (bad) e(`section "${s.h2}" uses disallowed tags: ${[...new Set(bad)].slice(0, 3).join(" ")}`);
    for (const [, href] of (s.html || "").matchAll(/href="([^"]+)"/g)) if (!/^(\/|tel:|https:\/\/maps\.google\.com)/.test(href)) e(`section "${s.h2}" links off-site: ${href}`);
  }
  if (p.steps !== null && p.steps !== undefined && !(Array.isArray(p.steps) && p.steps.length === 5 && p.steps.every((s) => s.b && s.text))) e("steps must be null or 5 {b,text} items");
  if (!Array.isArray(p.redFlags) || p.redFlags.length < 3 || p.redFlags.length > 6) e("redFlags: 3–6 required");
  if (!Array.isArray(p.faq) || p.faq.length < 3 || p.faq.length > 5 || !p.faq.every((f) => f.q && f.a)) e("faq: 3–5 {q,a} required");
  if (p.group !== "blog") {
    if (!Array.isArray(p.muscles) || p.muscles.length < 2 || p.muscles.length > 6) e("muscles: 2–6 ids required");
    if (!Array.isArray(p.pain) || p.pain.length < 1 || p.pain.length > 4) e("pain: 1–4 slugs required");
  }
  for (const m of p.muscles || []) if (!slugs[m]) e(`unknown muscle id "${m}"`);
  for (const s of p.pain || []) if (!pain.has(s)) e(`unknown pain slug "${s}"`);
  for (const g of p.guides || []) if (!guides.has(g)) e(`unknown guide "${g}"`);
  if (!Array.isArray(p.related) || p.related.length < 3 || p.related.length > 8) e("related: 3–8 URLs required");
  for (const r of p.related || []) if (!/^\/[a-z0-9/-]*$/.test(r)) e(`related URL must be a site path: ${r}`);
  if (p.group === "blog" && !/^\d{4}-\d{2}-\d{2}$/.test(p.datePublished || "")) e("blog needs datePublished YYYY-MM-DD");
  if (p.reviewStatus !== "draft" && p.reviewStatus !== "approved") e('reviewStatus must be "draft" or "approved"');
  const n = words(p.lead) + (p.sections || []).reduce((a, s) => a + words(s.html), 0) + (p.faq || []).reduce((a, f) => a + words(f.q) + words(f.a), 0) + (p.redFlags || []).reduce((a, s) => a + words(s), 0) + words(p.timeline);
  if (n < 700) e(`only ${n} words of page text; 700 required`);
  const all = [p.lead, ...(p.sections || []).map((s) => text(s.html)), ...(p.faq || []).map((f) => f.a)].join(" ");
  if (/\b(cure|cures|guaranteed|diagnos(e|es|is) (you|your))\b/i.test(all)) e("avoid cure/guarantee/diagnosis claims");
  return errs;
}
const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node scripts/seo/validate-page.js <json files>"); process.exit(2); }
let bad = 0;
for (const f of files) { const errs = validate(f); if (errs.length) { bad++; console.log(errs.join("\n")); } else console.log(`ok  ${path.relative(root, f)}`); }
if (bad) process.exit(1);
module.exports = { validate, words, text };
