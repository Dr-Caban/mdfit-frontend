// Builds the compact layout: a copy of every spacing and type-size declaration in the member app's stylesheets, in
// the same order and at the same specificity (the condition sits inside :where()), with the roomy values tightened.
// Because the copy is complete and ordered, the cascade resolves exactly as it does in the comfortable layout.
//   - padding, margin and gaps from 8px to 39px shrink by about a quarter; smaller ones and large structural offsets
//     (40px and up, anything in calc()/env()/var()) stay, so nothing slides under the fixed bars
//   - things you tap keep their padding, so no touch target shrinks
//   - type of 15px and up comes down a step; smaller type and form fields (16px stops iOS zooming) stay
// Usage: node gen-compact.js > generated-compact.css
const fs = require("fs"), path = require("path");
const ROOT = require("path").join(__dirname, "..", ".."), FILES = ["app/app.css", "account.css", "guides.css"], SCOPE = ":where(html[data-layout=compact])";
function parse(css) { css = css.replace(/\/\*[\s\S]*?\*\//g, ""); const out = [];
  (function block(src, wraps) { let i = 0; while (i < src.length) { const open = src.indexOf("{", i); if (open < 0) break; const semi = src.indexOf(";", i);
    if (semi >= 0 && semi < open && src.slice(i, semi).trim().startsWith("@")) { i = semi + 1; continue; }
    const prelude = src.slice(i, open).trim(); let depth = 1, j = open + 1; for (; j < src.length && depth; j++) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; }
    const body = src.slice(open + 1, j - 1);
    if (/^@(media|supports|container|layer)/.test(prelude)) block(body, [...wraps, prelude]); else if (!prelude.startsWith("@")) out.push({ sel: prelude.replace(/\s+/g, " "), decls: decls(body), wraps });
    i = j; } })(css, []); return out; }
function decls(body) { const list = []; let depth = 0, cur = ""; for (const ch of body) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === ";" && !depth) { list.push(cur); cur = ""; } else cur += ch; } if (cur.trim()) list.push(cur);
  return list.map((d) => { const k = d.indexOf(":"); return k < 0 ? null : { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() }; }).filter(Boolean); }

const half = (n) => Math.round(n * 2) / 2;
const space = (n) => { const a = Math.abs(n); if (a < 8 || a >= 40) return n; const to = a >= 20 ? a * .7 : a >= 12 ? a * .72 : a * .78; return Math.sign(n) * Math.max(6, half(to)); };
const type = (n) => (n < 15 ? n : half(n * .88 + .8));
// plain px numbers only: anything inside ( ) is left alone
const outside = (v, fn) => { let depth = 0, out = "", buf = ""; const flush = () => { out += buf.replace(/(-?\d*\.?\d+)px/g, (m, n) => fn(parseFloat(n)) + "px"); buf = ""; };
  for (const ch of v) { if (ch === "(") { if (!depth) flush(); depth++; out += ch; } else if (ch === ")") { depth--; out += ch; } else if (depth) out += ch; else buf += ch; } flush(); return out; };
const lastCompound = (s) => s.trim().split(/\s*[>+~]\s*|\s+/).pop();
const TAPPED = /(^|[^\w-])(button|a|input|select|textarea|summary|label)(?![\w-])|btn|chip|pill|\.opt(?![\w-])|tab|\.seg(?![\w-])|link|\[role|toggle|switch|\.q(?![\w-])|convo|-card(?![\w-])|\.program(?![\w-])|\.cal-d(?![\w-])|more-|\.ex(?![\w-])|\.vcard|\.pr-|\.fp-item|\.notif|\.yn(?![\w-])|\.bell|\.tier|range|\.book-|\.hb-|\.lect(?![\w-])/;
// a full-bleed picture whose negative margin cancels the padding of a tappable card (which keeps its padding)
const PAIRED = /\.pc-img(?![\w-])/;
const FIELD = /(^|[^\w-])(input|select|textarea)(?![\w-])/;
const isPad = (p) => /^padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(p);
const isGap = (p) => /^(margin(-(top|right|bottom|left|inline|block)(-(start|end))?)?|gap|row-gap|column-gap)$/.test(p);

const rules = FILES.flatMap((f) => parse(fs.readFileSync(path.join(ROOT, f), "utf8")));
const out = []; let lastWrap = "", total = 0, changed = 0;
const push = (wraps, text) => { const w = wraps.join(" { "); if (w !== lastWrap) { if (lastWrap) out.push("}".repeat(lastWrap.split(" { ").length)); if (w) out.push(w + " {"); lastWrap = w; } out.push(text); };
for (const r of rules) {
  const parts = r.sel.split(",").map((s) => s.trim()), tapped = parts.some((s) => TAPPED.test(lastCompound(s))), field = parts.some((s) => FIELD.test(s) || TAPPED.test(s)), keep = []; // type on or inside something you tap stays its size
  for (const d of r.decls) {
    let prop = d.prop, v = d.value;
    if (isPad(prop)) { if (!tapped) v = outside(v, (n) => (Math.abs(n) >= 28 ? n : space(n))); } // 28px and up is usually room kept for an icon or badge
    else if (isGap(prop)) { if (!PAIRED.test(r.sel)) v = outside(v, space); }
    else if (prop === "font-size") { if (!field) v = outside(v, type); }
    else if (prop === "font") { // only the size is copied, so the rest of the shorthand is untouched
      const m = v.match(/(?:^|\s)(-?\d*\.?\d+px|\d*\.?\d+(?:r?em|%)|inherit|small|medium|large|smaller|larger)(?=\s*\/|\s|$)/);
      const fn = m ? null : v.match(/(?:clamp|calc|min|max)\((?:[^()]|\([^()]*\))*\)/); // a computed size is copied as it is
      if (!m && !fn) continue; prop = "font-size"; v = fn ? fn[0] : /px$/.test(m[1]) && !field ? outside(m[1], type) : m[1];
      if (v === d.value) { /* font: inherit */ }
    } else continue;
    total++; if (v !== (d.prop === "font" ? (d.value.match(/(-?\d*\.?\d+px)/) || [])[1] : d.value)) changed++;
    keep.push(`${prop}: ${v}`);
  }
  if (!keep.length) continue;
  push(r.wraps, `${parts.map((s) => (/^(html|:root)(?![\w-])/.test(s) ? SCOPE + s.replace(/^(html|:root)/, "") : `${SCOPE} ${s}`)).join(", ")} { ${keep.join("; ")}; }`);
}
if (lastWrap) out.push("}".repeat(lastWrap.split(" { ").length));
process.stdout.write(out.join("\n") + "\n");
process.stderr.write(`compact: declarations ${total}, changed ${changed}\n`);
