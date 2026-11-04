// Mobile layout guard. Serves the frontend and runs the API locally, then loads the public pages and every account
// screen at phone and tablet widths and fails if anything is wider than the screen, if a program image is larger than
// its card or most of the screen, if a page throws, or if an HTML page links a CSS/JS file that doesn't exist.
// The account screens are checked again with account.css blocked, so the layout must hold even if a stylesheet fails.
//   BACKEND_DIR=../mdfit-backend node scripts/layout-check.js   (a checkout of Dr-Caban/mdfit-backend with `npm ci`,
//   and the playwright package with Chromium)
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const { chromium } = require("playwright");

const WEB_DIR = path.join(__dirname, ".."), API = "http://localhost:3000", WEB_PORT = 8080;
const BACKEND_DIR = path.resolve(process.env.BACKEND_DIR || path.join(WEB_DIR, "..", "mdfit-backend"));
const WIDTHS = [[320, 568], [390, 844], [768, 1024]];
const VIEWS = ["home", "generate", "videos", "programs", "learn", "premium", "messages", "tips", "pain", "progress", "profile"];
const first = (dir) => { const f = fs.readdirSync(path.join(WEB_DIR, dir)).find((n) => n.endsWith(".html")); return f ? `/${dir}/${f.replace(/\.html$/, "")}` : null; };
const PAGES = ["/", "/book", "/login", "/privacy-policy", "/golf-performance-sarasota", first("guides"), first("blog"), first("conditions")].filter(Boolean);
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

function missingAssets() {
  const htmls = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/^[._]|^(node_modules|scripts)$/.test(e.name)) walk(p); } else if (e.name.endsWith(".html")) htmls.push(p);
  });
  walk(WEB_DIR);
  for (const html of htmls) {
    const s = fs.readFileSync(html, "utf8");
    for (const [, ref] of s.matchAll(/(?:src|href)="([^"]+\.(?:css|js))(?:\?[^"]*)?"/g)) {
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith("/_vercel/")) continue; // /_vercel/* is served by Vercel itself
      const file = ref.startsWith("/") ? path.join(WEB_DIR, ref) : path.join(path.dirname(html), ref);
      if (!fs.existsSync(file)) fail(path.relative(WEB_DIR, html), `links ${ref}, which doesn't exist`);
    }
  }
}

function serveFrontend() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
  return http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = [p, p + ".html", path.join(p, "index.html")].map((c) => path.join(WEB_DIR, c))
      .find((c) => c.startsWith(WEB_DIR) && fs.existsSync(c) && fs.statSync(c).isFile());
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  }).listen(WEB_PORT);
}

async function startApi(dataDir) {
  const proc = spawn(process.execPath, ["server.js"], { cwd: BACKEND_DIR, stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, PORT: "3000", DATA_DIR: dataDir, SESSION_SECRET: "layout-check-".padEnd(40, "x"), ALLOWED_ORIGINS: `http://localhost:${WEB_PORT}`, BOT_FILTER: "off", LOG_LEVEL: "error" } });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(API + "/api/health")).ok) return proc; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill(); throw new Error("API did not start");
}

// Runs in the page: anything past the right edge that isn't inside its own scrolling/clipping box, and program images
// that are wider than their card or taller than 60% of the screen.
function measure() {
  const vw = document.documentElement.clientWidth, vh = innerHeight, out = [];
  const shown = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
      if (getComputedStyle(p).overflowX !== "visible" && p.getBoundingClientRect().right <= vw + 1) return true;
    return false;
  };
  const name = (el) => el.tagName.toLowerCase() + [...el.classList].map((c) => "." + c).join("") + (el.id ? "#" + el.id : "");
  for (const el of document.querySelectorAll("body *")) {
    const b = el.getBoundingClientRect();
    if (b.width && b.right > vw + 1 && shown(el) && !contained(el)) out.push(`${name(el)} reaches ${Math.round(b.right)}px on a ${vw}px screen`);
  }
  for (const img of document.querySelectorAll(".hp-img, .pc-img, .ph-img, .fp-item img")) {
    if (!shown(img)) continue;
    const b = img.getBoundingClientRect(), card = img.closest("button, .card");
    if (card && b.width > card.getBoundingClientRect().width + 1) out.push(`${name(img)} is ${Math.round(b.width)}px wide, wider than its card`);
    if (b.height > vh * 0.6) out.push(`${name(img)} is ${Math.round(b.height)}px tall on a ${vh}px screen`);
  }
  return [...new Set(out)].slice(0, 8);
}

(async () => {
  missingAssets();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdfit-layout-"));
  const server = serveFrontend(), api = await startApi(dataDir), browser = await chromium.launch();
  try {
    const sess = await (await fetch(API + "/api/clients/login", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Safari" },
      body: JSON.stringify({ name: "Layout Check", email: "layout-check@example.com", password: "layout-check-123" }) })).json();
    if (!sess.token) throw new Error("couldn't log in a test client: " + JSON.stringify(sess));

    const check = async ([w, h], { blockAccountCss = false } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
      await ctx.addInitScript((s) => { try { localStorage.setItem("mdfit_client", s); } catch {} }, JSON.stringify(sess));
      const tag = `${w}px${blockAccountCss ? " without account.css" : ""}`;
      const visit = async (route, views) => {
        const page = await ctx.newPage(), errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        if (blockAccountCss) await page.route(/account\.css/, (r) => r.abort());
        await page.goto(`http://localhost:${WEB_PORT}${route}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        for (const v of views || [null]) {
          if (v) { await page.evaluate((x) => { location.hash = x; }, v); await page.waitForTimeout(700); }
          for (const m of await page.evaluate(measure)) fail(`${route}${v ? "#" + v : ""} at ${tag}`, m);
        }
        errors.forEach((e) => fail(`${route} at ${tag}`, "page error: " + e));
        await page.close();
      };
      if (blockAccountCss) await visit("/account", ["home", "programs", "profile"]);
      else { for (const p of PAGES) await visit(p); await visit("/account", VIEWS); }
      await ctx.close();
    };
    for (const size of WIDTHS) await check(size);
    await check([390, 844], { blockAccountCss: true });
  } finally {
    await browser.close(); api.kill(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`Layout check failed (${failures.length}):\n- ` + failures.join("\n- "));
    process.exit(1);
  }
  console.log(`Layout check passed: ${PAGES.length} pages and ${VIEWS.length} account screens at ${WIDTHS.map(([w]) => w + "px").join(", ")}, plus account screens without account.css.`);
})().catch((e) => { console.error(e); process.exit(1); });
