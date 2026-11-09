// Keeps the Google rating and review count the same on every page. Reads data/google-reviews.json (rating, count)
// and rewrites every place the numbers appear: hero text, meta descriptions, rating lines, footers and JSON-LD.
//   node scripts/seo/sync-review-count.js            (after updating data/google-reviews.json)
// Then run node scripts/version-assets.js if any HTML changed.
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..");
const g = JSON.parse(fs.readFileSync(path.join(root, "data/google-reviews.json"), "utf8"));
const rating = Number(g.rating).toFixed(1), count = Number(g.count);
if (!(count > 0) || !(rating > 0)) throw new Error("google-reviews.json needs rating and count");
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) { if (!/^[._]|^(node_modules|scripts|data|assets|app)$/.test(e.name)) walk(p); } else if (e.name.endsWith(".html")) files.push(p); } })(root);
let changed = 0;
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  const out = s
    .replace(/(★★★★★|&#9733;&#9733;&#9733;&#9733;&#9733;) \d\.\d (·|&middot;) \d+ Google reviews/g, `$1 ${rating} $2 ${count} Google reviews`)
    .replace(/★ \d\.\d from \d+ Google reviews/g, `★ ${rating} from ${count} Google reviews`)
    .replace(/★ \d\.\d on Google \(\d+ reviews\)/g, `★ ${rating} on Google (${count} reviews)`)
    .replace(/\d\.\d from \d+ Google reviews/g, `${rating} from ${count} Google reviews`)
    .replace(/\d+\+? Google reviews averaging \d\.\d stars/g, `${count} Google reviews averaging ${rating} stars`)
    .replace(/with \d+\+ Google reviews/g, `with ${count}+ Google reviews`)
    .replace(/"ratingValue":"\d(\.\d)?","reviewCount":\d+/g, `"ratingValue":"${Number(rating) % 1 ? rating : Number(rating)}","reviewCount":${count}`);
  if (out !== s) { fs.writeFileSync(f, out); changed++; }
}
console.log(`review count: ${rating} / ${count} written to ${changed} page(s)`);
