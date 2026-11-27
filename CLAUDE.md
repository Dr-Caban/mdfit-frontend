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
- **Video uploads — `/video-check` (reads) and `/video-place` (writes).** Two commands, and which one you are in
  is stated in every reply during a run: `/video-check` searches Drive and reports, writing nothing; `/video-place`
  places clips the owner has confirmed, commits, and asks before the deploy. `/video-upload` is the whole run.
  When asked for any of them, to upload or migrate videos, to get footage
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
  nothing ever publishes; keep Token Authentication OFF until a client signs URLs. Never print or copy a key. Its **"Ask before you
  commit"** section is the owner's standing rule: never guess a clip's placement or usage, and never commit, push
  or deploy on one that is unconfirmed — ask.
  From 22 Nov 2026, every new clip is **identified by listening to it**: Dr. Jared says the movement's name in
  the first seconds, so `scripts/video-stt.py` transcribes it in-container (never an outside service) rather
  than anyone naming it from a thumbnail. And a library placement wires a clip into **no** protocol or
  programme: those reference movements by name, and that is a separate, separately confirmed edit.
  From 25 Nov 2026, **every video change is monitored** under `docs/MONITORING.md` — a deployed video change
  restarts the review's 72-hour clock and puts it back on the 6-hourly schedule. See Phase 7 of
  `docs/VIDEO-UPLOAD.md` for what counts as a video change and what the run owes the review.
- **DO NOT TOUCH after compliancy is set.** This is a live patient EMR. The compliance safeguards are locked: read the
  "DO NOT TOUCH" section of `README.md` here and in `mdfit-backend` before editing anything near sign-in, sessions,
  roles and permissions, the audit ledger, encryption, the chart, patient-rights records, the Compliance screen, or the
  agreement locks. Change them only when the owner asks for that exact change in the session; never as a side effect.
- **Every EMR change is monitored (owner's rule, Nov 2026).** After any change to the EMR, workspace, API or member app
  goes live, the protocol in `docs/MONITORING.md` applies: review every 6 hours until 72 hours pass with no failure and
  no further change, then once every 24 hours; a failure or a new change starts it again. The scheduled task
  "MD Fit endpoint failure review" does this and restarts its own clock at every deploy. Before finishing a session
  that shipped a change, confirm that task exists and is enabled (list scheduled tasks); if it is missing, create it
  from `docs/MONITORING.md`. Never pause, loosen or delete it unless the owner asks in the session.
- Only `mdfit-frontend` and `mdfit-backend` are worked on from these sessions. **Do not touch the iOS app.**
