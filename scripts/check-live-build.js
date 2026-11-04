// Fails when the live site isn't serving this branch's latest commit, e.g. when the domain is attached to a Vercel
// project that stopped deploying. Every response carries x-mdfit-build (set in frontend/middleware.js).
//   SITE=https://mymdfit.com EXPECTED_SHA=<commit> WAIT_MINUTES=6 node scripts/check-live-build.js
const { execFileSync } = require("child_process");
const site = (process.env.SITE || "https://mymdfit.com").replace(/\/+$/, "");
const expected = process.env.EXPECTED_SHA || execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
const waitMs = Number(process.env.WAIT_MINUTES || 6) * 60e3;
const atLeast = (live) => {
  if (expected.startsWith(live)) return true;
  try { execFileSync("git", ["merge-base", "--is-ancestor", expected, live], { stdio: "ignore" }); return true; } catch { return false; }
};

(async () => {
  const deadline = Date.now() + waitMs;
  let live = "", status = 0;
  for (;;) {
    try {
      const r = await fetch(site + "/", { headers: { "user-agent": "Mozilla/5.0 (Macintosh) MDFitBuildCheck" } });
      status = r.status; live = r.headers.get("x-mdfit-build") || "";
    } catch (e) { status = 0; live = ""; }
    if (live && atLeast(live)) { console.log(`${site} is serving ${live} (expected ${expected.slice(0, 12)} or newer).`); return; }
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 20e3));
  }
  console.error(live
    ? `${site} is serving build ${live}, not ${expected.slice(0, 12)} or newer. The domain's Vercel project isn't deploying this branch.`
    : `${site} sent no x-mdfit-build header (HTTP ${status}). It's serving a build from before the header existed, or a Vercel project that doesn't deploy this branch.`);
  process.exit(1);
})();
