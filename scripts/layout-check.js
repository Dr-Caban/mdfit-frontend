// Mobile layout guard. Serves this site and runs the API locally, then loads every HTML page at phone, tablet and desktop widths and
// every account screen (with a seeded hostile-input client) at 320-2560px. Fails if anything is wider than the screen,
// pokes out of its card, a program image outgrows its card or most of the screen, a page throws, user text runs as HTML, or an HTML page
// links a CSS/JS file that doesn't exist. Account screens are checked again with account.css blocked, so the layout
// must hold even if a stylesheet fails to load.
//   BACKEND_DIR=../mdfit-backend node scripts/layout-check.js   (a checkout of Dr-Caban/mdfit-backend with `npm ci`,
//   and the playwright package with Chromium)
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const { chromium } = require("playwright");

const WEB_DIR = path.join(__dirname, ".."), API = "http://localhost:3000", WEB_PORT = 8080;
const BACKEND_DIR = path.resolve(process.env.BACKEND_DIR || path.join(WEB_DIR, "..", "mdfit-backend"));
// 1366-2560px also covers desktop users zooming the browser out (zooming out = a wider screen)
const PAGE_WIDTHS = [[320, 568], [390, 844], [768, 1024], [1366, 900], [2560, 1440]];
const APP_WIDTHS = [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [1366, 900], [2560, 1440]];
const VIEWS = ["home", "generate", "videos", "programs", "programs:first", "learn", "premium", "messages", "tips", "pain", "progress", "profile"];
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

function htmlFiles() {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/^[._]|^(node_modules|scripts)$/.test(e.name)) walk(p); } else if (e.name.endsWith(".html")) out.push(p);
  });
  walk(WEB_DIR);
  return out.sort();
}
const routeOf = (file) => "/" + path.relative(WEB_DIR, file).replace(/\\/g, "/").replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "");

function missingAssets(files) {
  for (const html of files) {
    const s = fs.readFileSync(html, "utf8");
    for (const [, ref] of s.matchAll(/(?:src|href)="([^"]+\.(?:css|js))(?:\?[^"]*)?"/g)) {
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith("/_vercel/")) continue; // /_vercel/* is served by Vercel itself
      const file = ref.startsWith("/") ? path.join(WEB_DIR, ref) : path.join(path.dirname(html), ref);
      if (!fs.existsSync(file)) fail(path.relative(WEB_DIR, html), `links ${ref}, which doesn't exist`);
    }
  }
}

function serveSite() {
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
  proc.kill(); throw new Error("API did not start from " + BACKEND_DIR);
}

// A client whose name, notes and workout carry HTML and unbreakable words: none of it may run as HTML or push past
// a card (user text is escaped and long words wrap)
async function seedClient() {
  const post = async (url, body, token) => (await fetch(API + url, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Safari", ...(token ? { authorization: "Bearer " + token } : {}) } })).json();
  const sess = await post("/api/clients/login", { name: "<img src=x onerror=window.__pwn=1><b>Bold</b>\"> Supercalifragilisticexpialidocious_Wellington_Smith", email: "layout-check@example.com", password: "layout-check-123" });
  if (!sess.token) throw new Error("couldn't log in a test client: " + JSON.stringify(sess));
  await post("/api/me/pain", { area: "Lower back", level: 6, note: "</textarea><script>window.__pwn=1</script><img src=x onerror=window.__pwn=1> Sharp pain after sitting through a long drive; better after the mobility routine. https://example.com/a-very-long-link-without-spaces-to-check-wrapping" }, sess.token);
  await post("/api/me/pain", { area: "Elbow / wrist / hand", level: 3, note: "" }, sess.token);
  await post("/api/me/workouts", { title: "<img src=x onerror=window.__pwn=1>Workout_with_a_very_long_name_and_no_spaces_at_all_anywhere", goal: "Strength", minutes: 47, exercises: 8 }, sess.token);
  return sess;
}

// Runs in the page. Reports anything past the screen edge or out of its card (unless an inner scroller/clipper holds
// it), and program images taller than 60% of the screen.
function measure() {
  const vw = document.documentElement.clientWidth, vh = innerHeight, out = [];
  const shown = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
  const name = (el) => el.tagName.toLowerCase() + [...el.classList].map((c) => "." + c).join("") + (el.id ? "#" + el.id : "");
  const clipped = (el, stop) => {
    for (let p = el.parentElement; p && p !== stop; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") return p;
    }
    return null;
  };
  for (const el of document.querySelectorAll("body *")) {
    const b = el.getBoundingClientRect();
    if (!b.width || b.right <= vw + 1 || !shown(el)) continue;
    const c = clipped(el, document.body);
    if (!c || c.getBoundingClientRect().right > vw + 1) out.push(`${name(el)} reaches ${Math.round(b.right)}px on a ${vw}px screen`);
  }
  for (const card of document.querySelectorAll(".card, .hp-card, .prog-card, .fp-item")) {
    if (!shown(card)) continue;
    const cb = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("*")) {
      if (!shown(el)) continue;
      const b = el.getBoundingClientRect();
      if (!b.width || (b.right <= cb.right + 1 && b.left >= cb.left - 1)) continue;
      const media = /^(img|video|canvas|iframe)$/i.test(el.tagName);
      const inner = clipped(el, card.parentElement);
      if (!media && inner && card.contains(inner)) continue;
      out.push(`${name(el)} pokes ${Math.round(Math.max(b.right - cb.right, cb.left - b.left))}px out of ${name(card)}`);
    }
  }
  for (const img of document.querySelectorAll(".hp-img, .pc-img, .ph-img, .fp-item img")) {
    if (!shown(img)) continue;
    const b = img.getBoundingClientRect();
    if (b.height > vh * 0.6) out.push(`${name(img)} is ${Math.round(b.height)}px tall on a ${vh}px screen`);
  }
  // Button, tab and nav labels must not split a word across lines ("St / ar / t")
  for (const el of document.querySelectorAll("button, .btn, [role=tab], nav a")) {
    if (!shown(el) || el.closest(".prog-card, .hp-card, .fp-item")) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      for (const m of t.data.matchAll(/\S{2,25}/g)) {
        const r = document.createRange(); r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length);
        const tops = new Set([...r.getClientRects()].filter((b) => b.width).map((b) => Math.round(b.top)));
        if (tops.size > 1) out.push(`${name(el)} splits the word "${m[0]}" across lines`);
      }
    }
  }
  return [...new Set(out)].slice(0, 25);
}

(async () => {
  const files = htmlFiles();
  missingAssets(files);
  // /account has its own screen loop below; /app-return immediately bounces to the mdfit:// app scheme, which a
  // headless browser can't follow, so "load" never fires
  const pages = files.map(routeOf).filter((r) => r !== "/account" && r !== "/app-return");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdfit-layout-"));
  const server = serveSite(), api = await startApi(dataDir), browser = await chromium.launch();
  try {
    const sess = await seedClient();
    const check = async ([w, h], routes, views, { blockAccountCss = false } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 1024 ? { isMobile: true, hasTouch: true } : {}), serviceWorkers: "block" });
      await ctx.addInitScript((s) => { try { localStorage.setItem("mdfit_client", s); } catch {} }, JSON.stringify(sess));
      const tag = `${w}px${blockAccountCss ? " without account.css" : ""}`;
      const page = await ctx.newPage();
      let errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      if (blockAccountCss) await page.route(/account\.css/, (r) => r.abort());
      const report = async (where) => {
        for (const m of await page.evaluate(measure)) fail(`${where} at ${tag}`, m); if (await page.evaluate(() => window.__pwn || document.querySelector("b")?.textContent === "Bold")) fail(`${where} at ${tag}`, "INJECTED HTML RAN");
        errors.forEach((e) => fail(`${where} at ${tag}`, "page error: " + e)); errors = [];
      };
      // "load" then a bounded wait for quiet: the homepage and app keep a heartbeat / realtime connection open,
      // so "networkidle" alone never arrives and the whole check used to time out on the first page
      const open = async (url) => { await page.goto(url, { waitUntil: "load" }); await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); };
      for (const r of routes) {
        await open(`http://localhost:${WEB_PORT}${r}`);
        await page.waitForTimeout(300);
        await report(r);
      }
      if (views.length) {
        await open(`http://localhost:${WEB_PORT}/account`);
        await page.waitForTimeout(600);
        for (const v of views) {
          if (v === "programs:first") await page.evaluate(() => { const b = document.querySelector("#prog-grid .prog-card"); if (b) b.click(); });
          else await page.evaluate((x) => { location.hash = x; }, v);
          await page.waitForTimeout(700);
          await report(`/account#${v === "programs:first" ? "programs/<first>" : v}`);
        }
      }
      await ctx.close();
    };
    for (const size of PAGE_WIDTHS) await check(size, pages, []);
    for (const size of APP_WIDTHS) await check(size, [], VIEWS);
    await check([390, 844], [], ["home", "programs", "programs:first", "profile"], { blockAccountCss: true });
    console.log(`Checked ${pages.length} pages at ${PAGE_WIDTHS.map(([w]) => w).join("/")}px and ${VIEWS.length} account screens at ${APP_WIDTHS.map(([w]) => w).join("/")}px.`);
  } finally {
    await browser.close(); api.kill(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`Layout check failed (${failures.length}):\n- ` + failures.join("\n- "));
    process.exit(1);
  }
  console.log("Layout check passed.");
})().catch((e) => { console.error(e); process.exit(1); });
