# mdfit-frontend — notes for Claude sessions

- Static site on Vercel; `/api/*` is proxied by `middleware.js` to the Railway API. Hand-off and inventory: `docs/HANDOFF.md`.
- **SEO pages are generated.** Read `docs/SEO-PLAN.md` before touching anything under `/muscles`, `/pain`, `/activities`,
  the newer `/conditions/*` and `/blog/*`, or the six `*-sarasota.html` landing pages. Edit the data, run
  `node scripts/seo/build.js`, then `node scripts/seo/check.js`.
- Shared header: `node scripts/site-header.js`. After CSS/JS edits: `node scripts/version-assets.js`.
- Work on a branch → pull request → Vercel preview → merge. One session merges at a time. Never edit permissions or
  secrets from here; all keys live in Vercel/Railway.
- **Video uploads — `/video-upload`.** When a session is asked to `/video-upload`, to upload or migrate videos, to
  get footage from Drive onto Bunny, or to publish video for the web/Android/Apple apps: **read
  `docs/VIDEO-UPLOAD.md` first and follow its phases in order.** Treat that file as the command; do not improvise a
  run, and do not start at the upload step — every failed run so far failed at preflight or on a known trap, not in
  the upload. (It is written as a slash command and will also work as one once it is copied to
  `.claude/commands/video-upload.md`, which sessions are not permitted to write.)
  What it covers, so you know when to reach for it: reading footage from Drive, the four preflight checks, the
  migrate endpoint and its `mirror` counters, the readiness gate, what each platform needs out of `/api/videos`,
  and the traps. The parts worth knowing before you open it:
  footage lives in Drive (`MDFIT media`); the backend (`dr-caban/mdfit-backend`, `lib/videos.js` + `lib/bunny.js`)
  downloads each file, streams it up to the Bunny library `805934` into the collection **"In app"**, and publishes
  the guid at `/api/videos` **only once Bunny confirms a 720p MP4 exists** — publishing earlier hands members a URL
  that 404s. Drive IDs are the catalog keys and never change on rename or move, so reorganizing Drive cannot break
  playback. Before blaming a quota, check the logs: the believed Cloudinary cap was three ordinary bugs and zero
  quota errors. Start at `GET /api/admin/videos/status` and read its `mirror` block, never at the upload step.
  MP4 Fallback must be ON in the Bunny library or nothing ever publishes; keep Token Authentication OFF until a
  client signs URLs. Never print or copy a Bunny/Railway key.
- Readiness gates visibility: `MDFitVideo.playable(id)` is false for anything not in a published map, and the
  library, chips, jump list, care plan, runner, pain tracks and guides hide or down-grade it rather than offering a
  player. When no map is held at all (API down, first load) `MDFitVideo.mapped()` is false and **nothing** is
  hidden — that is the safe fallback, not a bug.
- Only `mdfit-frontend` and `mdfit-backend` are worked on from these sessions. **Do not touch the iOS app.**
