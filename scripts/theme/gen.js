// Builds the "shadow copy" part of app-theme.css: every colour-carrying declaration in the member app's three
// stylesheets, in the same order and with the same specificity (the theme condition sits inside :where(), which adds
// none), with each colour mapped to its black-theme value. Because the copy is complete and ordered, the cascade
// resolves exactly as it does in the white theme.
// Usage: node gen.js > generated.css
const fs = require("fs"), path = require("path");
const ROOT = require("path").join(__dirname, "..", "..");
const FILES = ["app/app.css", "account.css", "guides.css"];
const SCOPE = ":where(html[data-theme=black])";

// ---------- a small CSS reader: rules with their at-rule wrappers ----------
function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  function block(src, wraps) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i); if (open < 0) break;
      const semi = src.indexOf(";", i);
      if (semi >= 0 && semi < open && src.slice(i, semi).trim().startsWith("@")) { i = semi + 1; continue; } // @import, @charset
      const prelude = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; j < src.length && depth; j++) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; }
      const body = src.slice(open + 1, j - 1);
      if (/^@(media|supports|container|layer)/.test(prelude)) block(body, [...wraps, prelude]);
      else if (prelude.startsWith("@")) { /* @keyframes, @font-face: left alone */ }
      else out.push({ sel: prelude.replace(/\s+/g, " "), decls: decls(body), wraps });
      i = j;
    }
  }
  block(css, []);
  return out;
}
function decls(body) {
  const list = []; let depth = 0, cur = "";
  for (const ch of body) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === ";" && !depth) { list.push(cur); cur = ""; } else cur += ch; }
  if (cur.trim()) list.push(cur);
  return list.map((d) => { const k = d.indexOf(":"); return k < 0 ? null : { prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() }; }).filter(Boolean);
}

// ---------- colour maths ----------
const NAMED = { white: "#ffffff", black: "#000000" };
function toRgba(tok) {
  let t = tok.trim().toLowerCase(); if (NAMED[t]) t = NAMED[t];
  if (t[0] === "#") { let h = t.slice(1); if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }; }
  const m = t.match(/^rgba?\(([^)]+)\)$/); if (!m) return null;
  const p = m[1].split(/[\s,\/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x)));
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
}
function hsl({ r, g, b }) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return { h, s, l }; }
function fromHsl(h, s, l) { const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return "#" + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const navyish = (c) => { const x = hsl(c); return x.l < .3 && x.h > 195 && x.h < 235 && x.s > .25; };
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

// what each kind of use becomes in the black theme. Returns [newText, staysLight]
function mapBg(tok) {
  const c = toRgba(tok); if (!c) return [tok, false]; const x = hsl(c);
  if (c.a < 1) {
    if (c.a === 0) return [tok, false];
    if (navyish(c)) return [c.a <= .3 ? `rgba(255,255,255,${+(c.a * 1.1).toFixed(3)})` : tok, false]; // a navy wash on a light card; black scrims stay
    if (x.l > .85 && c.a >= .6) return [`rgba(21,24,30,${c.a})`, false];
    return [tok, false];
  }
  if (x.l >= .965 && x.s < .35) return ["var(--card)", false];
  if (x.l >= .84 && x.h >= 25 && x.h <= 65 && x.s < .5) return [x.l >= .94 ? "var(--bg)" : "var(--card-2)", false]; // the brand creams are neutrals, not tints
  if (x.l >= .84 && x.s < .28) return ["var(--card-2)", false];
  if (x.l >= .8) return [fromHsl(x.h, Math.min(x.s, .5) * .8, .15), false];
  if (x.l >= .3) { if (x.s < .15) return [fromHsl(x.h, x.s, Math.max(.2, Math.min(.42, 1 - x.l))), false]; return [tok, lum(c) > .3]; }
  if (navyish(c)) return [x.l < .14 ? "var(--t-deep)" : x.l < .2 ? "var(--navy-2)" : "var(--navy-3)", false];
  return [tok, false];
}
function mapInk(tok) {
  const c = toRgba(tok); if (!c) return tok; const x = hsl(c);
  if (c.a === 0) return tok;
  if (c.a < 1) return x.l < .35 ? `rgba(243,241,235,${Math.min(1, +(c.a + .12).toFixed(3))})` : tok;
  if (x.l < .22 && (x.s < .2 || navyish(c))) return "var(--navy)";
  if (x.l < .5 && x.s < .15) return x.l > .36 ? "var(--muted)" : "var(--text)";
  if (x.l < .5) return fromHsl(x.h, Math.min(1, x.s * .9), .72);
  return tok;
}
function mapEdge(tok) {
  const c = toRgba(tok); if (!c) return tok; const x = hsl(c);
  if (c.a < 1) return x.l < .3 ? `rgba(255,255,255,${+Math.min(1, c.a * 1.4).toFixed(3)})` : tok;
  if (x.l >= .8) return x.s < .3 ? "var(--line)" : fromHsl(x.h, x.s * .6, .3);
  if (x.l >= .3 && x.s < .15) return fromHsl(x.h, x.s, Math.max(.25, Math.min(.45, 1 - x.l)));
  if (navyish(c)) return "var(--navy)";
  return tok;
}

// A gradient built from strong mid-tones (a gold coin, a coloured badge) is an object, not a surface: left as drawn
const drawn = (v) => /gradient/.test(v) && (v.match(COLOR_RE) || []).some((t) => { const c = toRgba(t); if (!c || c.a < 1) return false; const x = hsl(c); return x.s >= .35 && x.l >= .3 && x.l < .8; });
// Screens that are already dark by design in white (the level-up celebration): copied unchanged
const LEAVE = /(^|[\s>+~,])\.ms(-[\w-]+)?(?![\w-])/;
const isBg = (p) => p.startsWith("background");
const isEdge = (p) => (p.startsWith("border") && !/radius|collapse|spacing/.test(p)) || p.startsWith("outline") || p === "column-rule";
const isInk = (p) => ["color", "fill", "stroke", "caret-color", "-webkit-text-fill-color", "text-decoration-color"].includes(p);
const wanted = (p) => isBg(p) || isEdge(p) || isInk(p);
const SELECTED = /\[aria-(checked|selected|pressed|current)="?(true|page)"?\]|\.(on|active|sel|is-on|picked|current)(?![\w-])|:checked/;
const lastCompound = (s) => s.trim().split(/\s*[>+~]\s*|\s+/).pop();
const compounds = (s) => s.trim().split(/\s*[>+~]\s*|\s+/);
const LIGHT_TOKENS = /var\(--(gold|gold-hover|accent|accent-hover|accent-bright)\)/;
const DEEP_TOKENS = /var\(--navy\)/;

const rules = FILES.flatMap((f) => parse(fs.readFileSync(path.join(ROOT, f), "utf8")).map((r) => ({ ...r, file: f })));

// pass 1: which rules keep (or gain) a light fill, so text on them stays dark
const lightKeys = new Set(), selectedKeys = new Set(), lightFull = [], selectedFull = [];
const keyed = (c) => /[.#\[]/.test(c); // a bare tag ("b", "small") says nothing about where it sits
for (const r of rules) {
  const bg = r.decls.filter((d) => d.prop === "background" || d.prop === "background-color");
  if (!bg.length) continue;
  const v = bg[bg.length - 1].value;
  const sel = r.sel.split(",").map((s) => s.trim());
  const deep = DEEP_TOKENS.test(v) || (v.match(COLOR_RE) || []).some((t) => { const c = toRgba(t); return c && c.a === 1 && navyish(c) && hsl(c).l < .14; });
  r.selected = deep && sel.every((s) => SELECTED.test(lastCompound(s)));
  r.light = r.selected || LIGHT_TOKENS.test(v) || (v.match(COLOR_RE) || []).some((t) => mapBg(t)[1]);
  if (r.light) sel.forEach((s) => { lightFull.push(s); if (keyed(lastCompound(s))) lightKeys.add(lastCompound(s)); });
  if (r.selected) sel.forEach((s) => { selectedFull.push(s); if (keyed(lastCompound(s))) selectedKeys.add(lastCompound(s)); });
}
const inside = (s, keys, full) => { s = s.trim(); return compounds(s).slice(0, -1).some((c) => keys.has(c)) || full.some((f) => s.startsWith(f + " ") || s.startsWith(f + ">")); };
const underSelected = (r) => r.selected || r.sel.split(",").every((s) => inside(s, selectedKeys, selectedFull));
if (process.argv.includes("--selected")) { console.log(rules.filter((r) => r.selected).map((r) => r.file + " | " + r.sel).join("\n")); process.exit(0); }
const onLight = (r) => r.light || r.sel.split(",").every((s) => inside(s, lightKeys, lightFull));

// pass 2: write the copy
const out = []; let lastWrap = "";
const push = (wraps, text) => { const w = wraps.join(" { "); if (w !== lastWrap) { if (lastWrap) out.push("}".repeat(lastWrap.split(" { ").length)); if (w) out.push(w + " {"); lastWrap = w; } out.push(text); };
let total = 0, changed = 0;
for (const r of rules) {
  const light = onLight(r), keep = [], leave = LEAVE.test(r.sel);
  for (const d of r.decls) {
    if (!wanted(d.prop)) continue;
    let v = d.value;
    if (leave || (isBg(d.prop) && drawn(v))) { /* as it is in white */ }
    else if (isBg(d.prop)) {
      if (r.selected) v = v.replace(DEEP_TOKENS, "var(--gold)").replace(COLOR_RE, (t) => { const c = toRgba(t); return c && c.a === 1 && navyish(c) ? "var(--gold)" : mapBg(t)[0]; });
      else v = v.replace(/var\(--navy\)/g, "var(--t-deep)").replace(COLOR_RE, (t) => mapBg(t)[0]);
      v = v.replace(/var\(--err\)/g, "#c62828").replace(/var\(--ok\)/g, "#2e7d4f"); // fills keep their strength; white text sits on them
    } else if (isInk(d.prop)) {
      if (light) v = v.replace(/var\(--(navy|heading)\)/g, "#0A1A2E").replace(/var\(--text\)/g, "#2b2b2e").replace(/var\(--muted\)/g, "#4a4a4f").replace(/var\(--accent-text\)/g, "#1F5580").replace(/var\(--card\)/g, "#0A1A2E");
      else v = v.replace(/var\(--card\)/g, "#ffffff").replace(/var\(--bg\)/g, "#F6F4EE").replace(/var\(--card-2\)/g, "#F3EFE6").replace(COLOR_RE, (t) => mapInk(t));
      // on a selected (now gold) item, and inside one, what was light-on-navy becomes dark-on-gold
      if (underSelected(r)) v = v.replace(/var\(--(on-navy|gold|accent-bright|accent)\)/g, "#2b2b2e").replace(COLOR_RE, (t) => { const c = toRgba(t); return c && hsl(c).l > .55 ? (hsl(c).s < .2 && hsl(c).l > .9 ? "#0A1A2E" : "#2b2b2e") : t; });
    } else {
      if (r.selected) v = v.replace(DEEP_TOKENS, "var(--gold)").replace(COLOR_RE, (t) => { const c = toRgba(t); return c && c.a === 1 && navyish(c) ? "var(--gold)" : mapEdge(t); });
      else v = v.replace(COLOR_RE, (t) => mapEdge(t));
    }
    total++; if (v !== d.value) changed++;
    keep.push(`${d.prop}: ${v}`);
  }
  if (!keep.length) continue;
  const sel = r.sel.split(",").map((s) => { s = s.trim(); if (/^(html|:root)\b/.test(s)) return `${SCOPE}${s.replace(/^(html|:root)/, "")}`.replace(/^(\S+)$/, "$1") ; return `${SCOPE} ${s}`; }).join(", ");
  push(r.wraps, `${sel} { ${keep.join("; ")}; }`);
}
if (lastWrap) out.push("}".repeat(lastWrap.split(" { ").length));
process.stdout.write(out.join("\n") + "\n");
process.stderr.write(`rules ${rules.length}, colour declarations ${total}, changed ${changed}, light fills ${lightKeys.size}\n`);
