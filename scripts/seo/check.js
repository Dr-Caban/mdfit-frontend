// SEO quality gates for every public page. Fails (exit 1) on: title > 60 chars, missing/duplicate description,
// missing canonical, JSON-LD that doesn't parse, a generated page under 700 words, two sibling pages more than
// 40% similar (body text only, excluding header, footer, quote and link lists), an internal link to nothing,
// a public page missing from the sitemap, or a sitemap URL that doesn't resolve.
//   node scripts/seo/check.js
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..");
const APP_PAGES = new Set(["account.html", "admin.html", "login.html", "intake.html", "cancel.html", "app-return.html"]);
const GENERATED = /^(muscles|pain|activities|exercises|programs)\//;
const MIN_WORDS = Number(process.env.SEO_MIN_WORDS || 700), MAX_SIM = Number(process.env.SEO_MAX_SIM || 0.4);
const problems = [];
const fail = (f, m) => problems.push(`${f}: ${m}`);

const pages = [];
(function walk(d) { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
  if (e.isDirectory()) { if (!/^[._]|^(node_modules|scripts|data|assets|app|docs)$/.test(e.name)) walk(path.join(d, e.name)); }
  else if (e.name.endsWith(".html")) { const rel = path.join(d, e.name).replace(/\\/g, "/").replace(/^\.\//, ""); if (!APP_PAGES.has(rel)) pages.push(rel); }
} })(".");
const urlOf = (rel) => "/" + rel.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
const redirects = new Set((JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")).redirects || []).map((r) => r.source));
const exists = (href) => {
  const p = href.replace(/[#?].*$/, "");
  if (!p || p === "/") return true;
  if (redirects.has(p)) return true;
  const rel = p.replace(/^\//, "");
  return ["", ".html", "/index.html"].some((suf) => fs.existsSync(path.join(root, rel + suf)));
};
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const bodyText = (s) => { const m = s.match(/<main[\s\S]*?<\/main>/); if (!m) return ""; return text(m[0].replace(/<blockquote[\s\S]*?<\/blockquote>/g, " ").replace(/<ul class="cd-links">[\s\S]*?<\/ul>/g, " ").replace(/<div class="cd-cta">[\s\S]*?<\/div>/g, " ").replace(/<ol class="cd-steps">[\s\S]*?<\/ol>/g, (x) => /Assess\./.test(x) ? " " : x)
  // the standard self-pay FAQ is deliberately identical everywhere, like the 5-step method and the CTA
  .replace(/<details class="cd-faq"><summary>Do you take insurance\?<\/summary>[\s\S]*?<\/details>/g, " ")); };
const shingles = (t) => { const w = t.toLowerCase().match(/[a-z0-9']+/g) || [], out = new Set(); for (let i = 0; i + 4 <= w.length; i++) out.add(w.slice(i, i + 4).join(" ")); return out; };
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };

const descs = new Map(), bodies = {};
const sitemap = new Set([...fs.readFileSync(path.join(root, "sitemap.xml"), "utf8").matchAll(/<loc>https:\/\/www\.mymdfit\.com([^<]*)<\/loc>/g)].map((m) => m[1]));
for (const rel of pages) {
  const s = fs.readFileSync(path.join(root, rel), "utf8"), url = urlOf(rel);
  const title = (s.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const tlen = title.replace(/&amp;/g, "&").length;
  if (!title) fail(rel, "no <title>"); else if (tlen > 60) fail(rel, `title is ${tlen} chars: ${title}`);
  const desc = (s.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  if (!desc) fail(rel, "no meta description"); else { if (descs.has(desc)) fail(rel, `description duplicates ${descs.get(desc)}`); descs.set(desc, rel); }
  if (!/<link rel="canonical" href="https:\/\/www\.mymdfit\.com/.test(s) && !/noindex/.test(s)) fail(rel, "no canonical");
  for (const [, ld] of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(ld); } catch (e) { fail(rel, `JSON-LD does not parse: ${e.message}`); } }
  for (const [, href] of s.matchAll(/href="(\/[^"#?]*)[^"]*"/g)) if (!exists(href)) fail(rel, `links to ${href}, which doesn't exist`);
  if (!/noindex/.test(s) && !sitemap.has(url) && !/^\/(privacy-policy|terms|events|book)$/.test(url)) fail(rel, `not in sitemap.xml (${url})`);
  const b = bodyText(s), n = (b.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
  const generated = GENERATED.test(rel) || fs.existsSync(path.join(root, "data/seo/pages", rel.includes("/") ? rel.split("/")[0] : "landing", path.basename(rel, ".html") + ".json"));
  if (generated && !/index\.html$/.test(rel) && n < MIN_WORDS) fail(rel, `only ${n} words`);
  (bodies[path.dirname(rel)] ||= []).push({ rel, sh: shingles(b), n });
}
for (const [dir, list] of Object.entries(bodies)) {
  if (dir === ".") continue;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (/index\.html$/.test(list[i].rel) || /index\.html$/.test(list[j].rel)) continue;
    const sim = jaccard(list[i].sh, list[j].sh);
    if (sim > MAX_SIM) fail(list[i].rel, `${Math.round(sim * 100)}% similar to ${list[j].rel}`);
  }
}
for (const u of sitemap) if (!exists(u)) fail("sitemap.xml", `${u} does not resolve`);
if (problems.length) { console.log(problems.join("\n")); console.log(`\n${problems.length} problem(s) across ${pages.length} pages`); process.exit(1); }
console.log(`seo check: ${pages.length} pages ok`);
