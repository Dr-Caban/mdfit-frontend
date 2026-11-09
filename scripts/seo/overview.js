// SEO overview of every public page: one table per page group with title, title length, description length,
// words of page text, inbound internal links, schema types, sitemap membership and review status.
//   node scripts/seo/overview.js            → writes docs/SEO-OVERVIEW.md and prints the group summary
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..");
const APP = new Set(["account.html", "admin.html", "login.html", "intake.html", "cancel.html", "app-return.html"]);
const pages = [];
(function walk(d) { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
  if (e.isDirectory()) { if (!/^[._]|^(node_modules|scripts|data|assets|app|docs)$/.test(e.name)) walk(path.join(d, e.name)); }
  else if (e.name.endsWith(".html")) { const rel = path.join(d, e.name).replace(/\\/g, "/").replace(/^\.\//, ""); if (!APP.has(rel)) pages.push(rel); }
} })(".");
const urlOf = (rel) => "/" + rel.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const body = (s) => { const m = s.match(/<main[\s\S]*?<\/main>/) || s.match(/<body[\s\S]*?<\/body>/); return m ? text(m[0].replace(/<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>|<nav[\s\S]*?<\/nav>/g, " ")) : ""; };
const words = (t) => (t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
const sitemap = new Set([...fs.readFileSync(path.join(root, "sitemap.xml"), "utf8").matchAll(/<loc>https:\/\/www\.mymdfit\.com([^<]*)<\/loc>/g)].map((m) => m[1]));
const review = {}; // url -> reviewStatus from the JSON data
const pd = path.join(root, "data/seo/pages");
if (fs.existsSync(pd)) for (const g of fs.readdirSync(pd)) for (const f of fs.readdirSync(path.join(pd, g))) { const p = JSON.parse(fs.readFileSync(path.join(pd, g, f), "utf8")); review[g === "landing" ? `/${p.slug}` : `/${g}/${p.slug}`] = p.reviewStatus; }
const groupOf = (url) => url === "/" ? "Home" : /^\/(conditions|treatments|areas|guides|blog|muscles|pain|activities)\//.test(url) ? url.split("/")[1] : /-sarasota$/.test(url) ? "landing" : "other";
const GEN = new Set(["muscles", "pain", "activities"]);
const rows = [], inbound = {};
for (const rel of pages) {
  const s = fs.readFileSync(path.join(root, rel), "utf8"), url = urlOf(rel);
  for (const [, href] of s.matchAll(/href="(\/[^"#?]*)[^"]*"/g)) { const u = href.replace(/\/$/, "") || "/"; if (u !== url.replace(/\/$/, "")) inbound[u] = (inbound[u] || 0) + 1; }
  const title = ((s.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/&amp;/g, "&");
  const desc = ((s.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "").replace(/&amp;/g, "&");
  const types = new Set();
  for (const [, ld] of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { const j = JSON.parse(ld); for (const n of j["@graph"] || [j]) if (n && n["@type"]) types.add([].concat(n["@type"])[0]); } catch {} }
  const h1 = ((s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  const g = groupOf(url);
  rows.push({ url, group: g, title, tlen: title.length, dlen: desc.length, words: words(body(s)), types: [...types].filter((t) => !/MedicalClinic|Person/.test(t)).join(", "), sitemap: sitemap.has(url) || sitemap.has(url + "/"), noindex: /noindex/.test(s), review: review[url] || (GEN.has(g) ? "draft" : "live"), h1, generated: GEN.has(g) || !!review[url] });
}
for (const r of rows) r.inbound = inbound[r.url.replace(/\/$/, "") || "/"] || 0;
const ORDER = ["Home", "conditions", "treatments", "areas", "landing", "activities", "muscles", "pain", "guides", "blog", "other"];
const LABEL = { Home: "Homepage", conditions: "Conditions", treatments: "Treatments", areas: "Service areas", landing: "Local landing pages", activities: "Activities & audiences", muscles: "Muscle library", pain: "Pain locations", guides: "Guides", blog: "Blog", other: "Other" };
const groups = ORDER.filter((g) => rows.some((r) => r.group === g)).map((g) => { const rs = rows.filter((r) => r.group === g); const avg = (k) => Math.round(rs.reduce((a, r) => a + r[k], 0) / rs.length);
  return { g, n: rs.length, words: avg("words"), minWords: Math.min(...rs.map((r) => r.words)), tlen: Math.max(...rs.map((r) => r.tlen)), inbound: avg("inbound"), orphans: rs.filter((r) => r.inbound === 0).length, review: rs.filter((r) => r.review === "draft").length, sitemap: rs.filter((r) => r.sitemap).length, rs }; });
const issues = [];
for (const r of rows) {
  if (r.tlen > 60) issues.push(`${r.url}: title ${r.tlen} chars`);
  if (r.dlen && (r.dlen < 110 || r.dlen > 160)) issues.push(`${r.url}: description ${r.dlen} chars`);
  if (!r.dlen) issues.push(`${r.url}: no description`);
  if (r.generated && r.words < 700 && !/\/$/.test(r.url)) issues.push(`${r.url}: ${r.words} words`);
  if (r.inbound < 2 && !r.noindex) issues.push(`${r.url}: only ${r.inbound} internal link${r.inbound === 1 ? "" : "s"} pointing at it`);
  if (!r.sitemap && !r.noindex) issues.push(`${r.url}: not in sitemap`);
}
const today = new Date().toISOString().slice(0, 10);
let md = `# MD Fit — SEO overview of every public page\n\nGenerated ${today} by \`node scripts/seo/overview.js\` from the files in this repo. ${rows.length} public pages, ${sitemap.size} in the sitemap.\n\n`;
md += `## By group\n\n| Group | Pages | Avg words | Min words | Longest title | Avg inbound links | Orphans | Awaiting clinical review | In sitemap |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const g of groups) md += `| ${LABEL[g.g]} | ${g.n} | ${g.words} | ${g.minWords} | ${g.tlen} | ${g.inbound} | ${g.orphans} | ${g.review} | ${g.sitemap}/${g.n} |\n`;
md += `| **Total** | **${rows.length}** | ${Math.round(rows.reduce((a, r) => a + r.words, 0) / rows.length)} | | | | ${rows.filter((r) => r.inbound === 0).length} | ${rows.filter((r) => r.review === "draft").length} | ${rows.filter((r) => r.sitemap).length}/${rows.length} |\n\n`;
md += `Words = text inside the page's main content (header, footer and menus excluded). Inbound links = other pages on this site linking to the page. "Awaiting clinical review" = generated from Dr. Jared's data and marked draft until he signs off.\n\n`;
md += `## Issues to fix (${issues.length})\n\n${issues.length ? issues.map((i) => `- ${i}`).join("\n") : "None."}\n\n`;
for (const g of groups) {
  md += `## ${LABEL[g.g]} (${g.n})\n\n| URL | Title | Title len | Desc len | Words | Inbound | Schema | Status |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of g.rs.sort((a, b) => a.url.localeCompare(b.url))) md += `| ${r.url} | ${r.title.replace(/\|/g, "\\|")} | ${r.tlen} | ${r.dlen} | ${r.words} | ${r.inbound} | ${r.types} | ${r.noindex ? "noindex" : r.review} |\n`;
  md += "\n";
}
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs/SEO-OVERVIEW.md"), md);
console.log(`pages ${rows.length} · sitemap ${sitemap.size} · issues ${issues.length}`);
for (const g of groups) console.log(`${LABEL[g.g].padEnd(24)} ${String(g.n).padStart(3)} pages · avg ${g.words} words · orphans ${g.orphans} · draft ${g.review}`);
