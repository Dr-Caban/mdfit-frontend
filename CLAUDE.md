# mdfit-frontend — notes for Claude sessions

- Static site on Vercel; `/api/*` is proxied by `middleware.js` to the Railway API. Hand-off and inventory: `docs/HANDOFF.md`.
- **SEO pages are generated.** Read `docs/SEO-PLAN.md` before touching anything under `/muscles`, `/pain`, `/activities`,
  the newer `/conditions/*` and `/blog/*`, or the six `*-sarasota.html` landing pages. Edit the data, run
  `node scripts/seo/build.js`, then `node scripts/seo/check.js`.
- Shared header: `node scripts/site-header.js`. After CSS/JS edits: `node scripts/version-assets.js`.
- `/workspace` is the practice workspace: `workspace.html` (screens and styles) plus `workspace-app.js` (talks to the same
  `/api/admin/*` endpoints as `/admin`). `/admin` is separate and unchanged.
- Work on a branch → pull request → Vercel preview → merge. One session merges at a time. Never edit permissions or
  secrets from here; all keys live in Vercel/Railway.
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
