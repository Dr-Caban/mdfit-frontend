# MD Fit — SEO plan, status and rules

**Site:** https://www.mymdfit.com · **Repo:** `Dr-Caban/mdfit-frontend` (Vercel) · **API:** `Dr-Caban/mdfit-backend` (Railway)
**Owner sign-off required** before any clinical page goes live (see Status).

## For a new session: read this first

1. Pages in `/muscles`, `/pain`, `/activities`, the new `/conditions/*` and `/blog/*` and the six landing pages are **generated**.
   Edit the data (`painmuscles.js`, `musclereports.js`, `data/seo/**`) or the generator (`scripts/seo/build.js`), then run
   `node scripts/seo/build.js`. Never edit those HTML files by hand; the next build overwrites them.
2. Content pages are JSON: `data/seo/pages/<group>/<slug>.json`, format in `docs/SEO-CONTENT-SPEC.md`,
   checked with `node scripts/seo/validate-page.js <files>`.
3. Before a commit: `node scripts/seo/check.js` (titles ≤ 60, unique descriptions, canonical, JSON-LD, ≥ 700 words,
   < 40% similarity between siblings, no dead links, sitemap complete). CI runs the mobile layout check on every push.
4. **Hard rules:** no UI or CSS changes for SEO pages (they reuse the condition-page template); one URL per search intent;
   no doorway "city × condition" pages; no AI-padded filler; no medical diagnosis claims; red-flag/911 language on
   every pain page; nothing clinical goes live without Dr. Jared's OK; work on a branch, open a PR, verify the Vercel
   preview, then merge; one Claude session merges at a time.
5. Review count: change `data/google-reviews.json`, then `node scripts/seo/sync-review-count.js` (rewrites all pages).
6. **The build must be idempotent.** Running `node scripts/seo/build.js` with no data change must produce no diff in
   any of the 423 generated pages. Three outputs still carry the build date and are the known exception:
   `docs/SEO-OVERVIEW.md` (a dated report, fine), `data/search-index.json` (`version`, harmless) and `sitemap.xml`,
   which rewrites all 359 `<lastmod>` values and should be changed to keep a page's date when its HTML has not changed.
   Nothing in a page may be derived from the date the build ran. In particular `lastReviewed` is published only when
   the data records a real sign-off date (`reviewedOn` on a page's JSON, or `{"approved":true,"on":"YYYY-MM-DD"}` in
   `data/seo/approved.json`); with no date on record a page carries `reviewedBy` and no `lastReviewed`. It previously
   defaulted to the build date, which re-dated 352 pages on every run and claimed a clinician had re-reviewed them.
7. **A page links its siblings selectively, never all of them.** Each condition page once listed all 113 others and
   each activity page all 77, about 19,000 links that said nothing about what was related and buried the curated
   "Related" block. `nearestSiblings()` in `scripts/seo/build.js` now picks up to 8 siblings that share muscles or
   pain locations and then links the hub, which indexes every page in the group. Keep that shape.

## Status

| Phase | What | State | Notes |
|---|---|---|---|
| 0 | Technical fixes (Google sees real data, 4 duplicate pages → 301, 37 titles, zoom, AI search bots) | **Live** | Merged to `main` 2026-11-09 (commit 2b001c1). |
| 1 | Muscle library: `/muscles/` + 100 pages | **Live, signed off** | Generated from `painmuscles.js` + `musclereports.js`. `data/seo/approved.json` records the sign-off; pages carry `reviewedBy`. |
| 2 | Pain locations: `/pain/` + 58 pages | **Live, signed off** | 8 spots folded into existing condition pages (those pages gained a "Muscles that commonly cause pain here" section). Sign-off in `data/seo/approved.json`. |
| 3 | 111 condition pages + 6 landing-page upgrades | **Live, signed off** | Every `data/seo/pages/{conditions,landing}/*.json` reads `reviewStatus: "approved"`. 3 condition pages are still hand-written HTML (`achilles-tendon-pain`, `pelvic-floor-rehab`, `piriformis-syndrome`) and are the thinnest in the group at ~500 words; convert them to JSON when they are next touched. |
| 4 | `/activities/` hub + 77 activity/audience pages | **Live, signed off** | Golf, pickleball and running stay at their existing URLs and are linked from the hub. |
| 5 | Blog: 15 posts; cadence 2–4 a month | **Partly migrated** | The 4 JSON posts average ~1,480 words and link muscles, pain and conditions as the process below requires. The 10 hand-written posts are 396–555 words and link none of them; migrate or merge them. |
| 6 | Off-site (Google Business Profile, Search Console, citations, backlinks, reviews, social) | **Owner checklist below** | Nothing here is code. |
| 7 | Measure and prune | **Process below** | Needs Search Console verified first. |

### Release plan (the owner's call)

Everything above is on branch `seo/phases-1-7` behind a pull request with a Vercel preview. Recommended order:
1. Merge the tooling and the Phase 3 landing-page upgrades right away (they replace thin pages at the same URLs).
2. Release muscles in batches as Dr. Jared signs them off: the 24 muscles that already have a guide first, then the rest.
3. Release pain pages after the chest/abdomen/head pages are reviewed.
4. Release conditions and activities after the list is approved.
To hold a group back, delete (or move out) its generated folder before merging and rebuild without it; the sitemap and
search index regenerate from what exists.

## Phase 5 — blog process

- Topics come from (a) the self-check questions in `musclereports.js`, (b) Sarasota seasons (snowbird season Nov–Apr,
  pickleball leagues, golf season), (c) Search Console queries with impressions but no strong page.
- Write `data/seo/pages/blog/<slug>.json` (750–1100 words, self-check, what to do this week, red flags), validate, build.
- Every post links at least one muscle page, one pain-location page and one condition page, plus the booking CTA.
- Schema is `BlogPosting` with Dr. Jared as author; `dateModified` is bumped when a post is revised.

## Phase 6 — owner checklist (off-site)

- [ ] **Google Business Profile:** primary category and secondary categories reviewed; every service listed with its page URL;
  clinic and treatment photos; a post a week; Q&A seeded with the FAQs from the condition pages.
- [ ] **Google Search Console** and **Bing Webmaster Tools**: verify `www.mymdfit.com`, submit `https://www.mymdfit.com/sitemap.xml`,
  request indexing for `/`, `/conditions/sciatica`, `/conditions/chronic-pain`, `/treatments/medical-massage`, then the new hubs
  `/muscles/`, `/pain/`, `/activities/` when they go live. Start this **now**, before the new pages launch.
- [ ] **Citations:** identical name, address, phone (MD Fit · 3214 Clark Road, Sarasota, FL 34231 · 941-313-0562) on Apple Business
  Connect, Bing Places, Yelp, Facebook and the health directories the practice qualifies for.
- [ ] **Local links:** Sarasota golf and pickleball clubs and leagues, running clubs, the Chamber of Commerce, partner gyms, local press.
- [ ] **Reviews:** ask every happy client for a Google review; no incentive of any kind (the review discount was removed).
- [ ] **Social:** add Instagram / TikTok / YouTube URLs to the `sameAs` list in the homepage schema once the accounts exist.
- [ ] **Wording decision:** `/treatments/medical-massage` says Dr. Jared "is also a physician" and the schema uses `Physician`.
  The owner said MD Fit is not a physician practice; decide whether those should change (not changed).

## Phase 7 — measure and prune

- Monthly: Search Console → Performance, filtered by page group (`/conditions/`, `/treatments/`, `/areas/`, `/muscles/`, `/pain/`,
  `/activities/`, `/blog/`): impressions, clicks, average position, top queries. Evaluations booked per landing page come from the
  site's own `/api/hit` analytics in Admin.
- After 3 months: pages with near-zero impressions are improved (better title/intro, more internal links) or merged.
- After 6 months: pages still not ranking are merged into their parent with a 301 in `vercel.json` and removed from the sitemap
  and search index (delete the JSON or the muscle/pain entry and rebuild). Fewer strong pages beat many weak ones.

## Never building

Organ pages; generic bone pages; city × condition doorway pages; AI-padded filler. Health sites are judged strictest, and a
scaled-content penalty can hit the whole domain.

## Page inventory

Counts come from `node scripts/seo/overview.js`, which writes `docs/SEO-OVERVIEW.md`. Re-run it after any build;
the numbers below are from 2026-11-21 and the generated doc is the source of truth.

| Group | Pages | Source |
|---|---|---|
| Homepage, treatments, service areas, guides, other | 29 | hand-written |
| Conditions (hub + 114) | 115 | 111 JSON + 3 hand-written |
| Muscles (hub + 100) | 101 | generated |
| Pain locations (hub + 58) | 59 | generated |
| Activities & audiences (hub + 77) | 78 | JSON + hub |
| Local landing pages | 6 | JSON |
| Blog (hub + 14) | 15 | 4 JSON + 10 hand-written |
| **Total public pages** | **403** | all 403 in the sitemap |

The app, workspace, visit, referral, valuation, login and intake pages are `noindex` and are not counted here.

Appendices (muscle and pain-location URL lists) are the data files: `data/seo/muscle-slugs.json`, `data/seo/pain-locations.json`.
