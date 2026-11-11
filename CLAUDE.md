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
