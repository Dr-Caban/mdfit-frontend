// Adds ?v=<content hash> to every local .css/.js link in the frontend HTML so browsers
// (especially iPhone Safari) always fetch the current file after a deploy. Run after editing CSS/JS:
//   node scripts/version-assets.js
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const htmls = [...fs.readdirSync(root).filter((f) => f.endsWith(".html")).map((f) => path.join(root, f)),
  ...fs.readdirSync(path.join(root, "guides")).filter((f) => f.endsWith(".html")).map((f) => path.join(root, "guides", f))];
const hash = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
for (const html of htmls) {
  let s = fs.readFileSync(html, "utf8");
  const out = s.replace(/(src|href)="(\/?)([\w./-]+\.(?:css|js))(?:\?v=[\w]+)?"/g, (m, attr, slash, rel) => {
    const file = slash ? path.join(root, rel) : path.join(path.dirname(html), rel);
    return fs.existsSync(file) ? `${attr}="${slash}${rel}?v=${hash(file)}"` : m;
  });
  if (out !== s) { fs.writeFileSync(html, out); console.log("versioned", path.relative(root, html)); }
}

// Stamp the service worker with a hash of every shipped CSS/JS file so each deploy gets a new cache name;
// the worker then deletes old caches and open pages reload once (logins live in localStorage and are untouched).
const all = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!/^[._]|^(node_modules|scripts)$/.test(f.name)) walk(p); } else if (/\.(css|js|html)$/.test(f.name) && f.name !== "sw.js") all.push(p); } })(root);
const build = crypto.createHash("sha1").update(all.sort().map((f) => fs.readFileSync(f)).join("")).digest("hex").slice(0, 10);
const swPath = path.join(root, "sw.js"), sw = fs.readFileSync(swPath, "utf8");
// The offline app shell is every local script and stylesheet account.html loads (so the installed app opens offline).
const appHtml = fs.readFileSync(path.join(root, "account.html"), "utf8");
const shell = ["/account", ...new Set([...appHtml.matchAll(/(?:src|href)="(\/?[\w./-]+\.(?:css|js))(?:\?v=\w+)?"/g)]
  .map((m) => "/" + m[1].replace(/^\//, "")).filter((f) => !f.startsWith("/_vercel/") && fs.existsSync(path.join(root, f)))), "/assets/logo.webp"];
const swOut = sw.replace(/const CACHE = "[^"]*";/, `const CACHE = "mdfit-${build}";`)
  .replace(/const SHELL = \[[^\]]*\];/, `const SHELL = ${JSON.stringify(shell)};`);
if (swOut !== sw) { fs.writeFileSync(swPath, swOut); console.log("sw cache", build); }
