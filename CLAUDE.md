# mdfit-frontend — notes for Claude sessions

- Static site on Vercel; `/api/*` is proxied by `middleware.js` to the Railway API. Hand-off and inventory: `docs/HANDOFF.md`.
- **SEO pages are generated.** Read `docs/SEO-PLAN.md` before touching anything under `/muscles`, `/pain`, `/activities`,
  the newer `/conditions/*` and `/blog/*`, or the six `*-sarasota.html` landing pages. Edit the data, run
  `node scripts/seo/build.js`, then `node scripts/seo/check.js`.
- Shared header: `node scripts/site-header.js`. After CSS/JS edits: `node scripts/version-assets.js`.
- **Member app looks.** `app-theme.css` (black theme, compact layout) is generated: after changing `app/app.css`,
  `account.css` or `guides.css`, run `node scripts/theme/build.js`, then `version-assets.js`. Never edit it by hand;
  the hand-written parts are in `scripts/theme/parts/`. `app-theme.js` applies the saved choice before first paint.
- **Solomon** (the cloud in the member app, formerly "the MD Fit guide") is `mdfit-guide.js` + `mdfit-guide.css`; the server side is
  `lib/guide.js` and `lib/guide-ai.js` in the backend. What a member types is understood on the device and is never
  sent, unless the owner has switched "AI answers" on in the workspace (Insights → Solomon). Keep the line of
  small print under the box true in both modes.
- `/admin` is the practice workspace: `workspace.html` (screens and styles) plus `workspace-app.js`, served at both
  `/admin` (a rewrite in `vercel.json`) and `/workspace`. The earlier admin is `admin-classic.html` + `admin.js` at
  `/admin-classic`; it stays until every setting it holds has a screen in the workspace. Patients join video visits at
  `/visit` (`visit.html` + `visit.js`). Icons in the workspace are inline SVG only: no emoji or text glyphs.
- Work on a branch → pull request → Vercel preview → merge. One session merges at a time. All keys live in
  Vercel/Railway. A session may set or change Railway/Vercel variables (CLI or MCP) only when the user asks for that
  change in the session: set exactly what was asked, never print, copy or log a key's value, take a secret's value only
  from the user (never invent or reuse one), and say afterwards which names changed. Never change GitHub, Railway,
  Vercel or Stripe account permissions or API-key scopes from here.
- **Platform overview and the logs.** `platform.js` draws one panel shown in all three consoles — the workspace
  (Admin → Platform), `/manager` and `/dev`: growth, faults, what is running, the parts of the platform, where each
  log lives, and who can see what. The developer console's **Logs** tab reads the server's own log
  (`/api/admin/logs*`, 90 days on the Railway volume): day, level and text filters, copy the lines, download the
  day. Those routes are owner-only on the server — a Manager or Developer sign-in gets the counts, not the lines,
  because a logged path can name a client's record. The panel also keeps a per-browser fault recorder
  (`mdfit_faults` in localStorage); nothing is sent anywhere. **The console switch in every header** also comes
  from this file — `MDFitPlatform.consoles(me)`: one list, so all three headers agree. Each chip is lit by the
  permission its console needs (`settings` → Admin, `partner` → Manager), not by a role name, since roles are only
  presets over permissions; Client portal is listed for everyone, and the developer console is the exception the
  server gates by role. See `docs/SYSTEM-INDEX.md`.
- **Video uploads — `/video-upload`.** When asked to `/video-upload`, to upload or migrate videos, to get footage
  from Drive onto Bunny, or to publish video for the web/Android/Apple apps: **read `docs/VIDEO-UPLOAD.md` first
  and follow its phases in order.** Treat that file as the command; do not improvise a run, and do not start at the
  upload step — every failed run so far failed at preflight or on a known trap, not in the upload.
  The parts worth knowing before you open it: footage lives in Drive (`MDFIT media`); the backend
  (`dr-caban/mdfit-backend`, `lib/videos.js` + `lib/bunny.js`) downloads each file, streams it up to the Bunny
  library `805934` into the collection **"In app"**, and publishes the guid at `/api/videos` **only once Bunny
  confirms a 720p MP4 exists** — publishing earlier hands members a URL that 404s. Drive IDs are the catalog keys
  and never change on rename or move, so reorganizing Drive cannot break playback. Start at
  `GET /api/admin/videos/status` and read its `mirror` block. Before blaming a quota, check the logs: the believed
  Cloudinary cap was three ordinary bugs and zero quota errors. MP4 Fallback must be ON in the Bunny library or
  nothing ever publishes; keep Token Authentication OFF until a client signs URLs. Never print or copy a key.
- Only `mdfit-frontend` and `mdfit-backend` are worked on from these sessions. **Do not touch the iOS app.**
