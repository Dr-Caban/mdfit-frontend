# mdfit-frontend — notes for Claude sessions

- Static site on Vercel; `/api/*` is proxied by `middleware.js` to the Railway API. Hand-off and inventory: `docs/HANDOFF.md`.
- **SEO pages are generated.** Read `docs/SEO-PLAN.md` before touching anything under `/muscles`, `/pain`, `/activities`,
  the newer `/conditions/*` and `/blog/*`, or the six `*-sarasota.html` landing pages. Edit the data, run
  `node scripts/seo/build.js`, then `node scripts/seo/check.js`.
- Shared header: `node scripts/site-header.js`. After CSS/JS edits: `node scripts/version-assets.js`.
- Work on a branch → pull request → Vercel preview → merge. One session merges at a time. Never edit permissions or
  secrets from here; all keys live in Vercel/Railway.
- **Video uploads: run `/video-upload`** (`.claude/commands/video-upload.md`) — the full orchestration from Drive to
  Bunny Stream to Web/Android/Apple. Do not improvise one. The short version, when the command is not to hand:
  footage lives in Drive (`MDFIT media`); the backend (`dr-caban/mdfit-backend`, `lib/videos.js` + `lib/bunny.js`)
  downloads each file, streams it up to the Bunny library `805934` into the collection **"In app"**, and publishes
  the guid at `/api/videos` **only once Bunny confirms a 720p MP4 exists** — publishing earlier hands members a URL
  that 404s. Drive IDs are the catalog keys and never change on rename or move, so reorganizing Drive cannot break
  playback. Before blaming a quota, check the logs: the believed Cloudinary cap was three ordinary bugs and zero
  quota errors. Start at `GET /api/admin/videos/status` and read its `mirror` block, never at the upload step.
- Readiness gates visibility: `MDFitVideo.playable(id)` is false for anything not in a published map, and the
  library, chips, jump list, care plan, runner, pain tracks and guides hide or down-grade it rather than offering a
  player. When no map is held at all (API down, first load) `MDFitVideo.mapped()` is false and **nothing** is
  hidden — that is the safe fallback, not a bug.
- Only `mdfit-frontend` and `mdfit-backend` are worked on from these sessions. **Do not touch the iOS app.**
