# MD Fit monitoring

How the live system is watched, what counts as a failure, and what to do about one. Written Nov 25, 2026.
This is a live patient EMR: monitoring reads logs and checks that pages answer. It never signs in to patient data,
never prints a key, and never lowers a safeguard to look at something.

## The scheduled review

One scheduled task, **"MD Fit endpoint failure review"**, runs in the owner's Claude Code session and reports there.

| Phase | When | How often |
|---|---|---|
| **A. Active** | After any change or any failure | Every 6 hours |
| **B. Passive** | After 72 hours with no failure and no change | Every 24 hours (8:47 AM Eastern) |

- The 72-hour clock starts at the most recent **change** (a production deploy of the backend on Railway or the site on
  Vercel) or the most recent **failure**, whichever is later.
- In either phase, a failure found or a new change deployed sends it back to Phase A with the clock restarted.
- Each review works the phase out from the real deploy and log times, so a missed review does not break the count.
- If a failure is a bug in MD Fit's code, the review fixes it the usual way (branch, tests, pull request, merge,
  redeploy). That deploy is a change, so the clock restarts.

To see, pause or change it: in Claude Code, ask to "list scheduled tasks", or change the rules by telling the session
what you want. The task's rules live in its prompt, not in the code.

## What each review does

1. **Deployments** (Railway): the newest deployment's time, and whether any is `FAILED` or `CRASHED`.
2. **Server log** (Railway): warnings and errors since the last review.
3. **Request log** (Railway): any `5xx` answer from the API.
4. **Site deployments** (Vercel): the newest production deployment's time.
5. **Live check**, with a browser user agent:
   - `https://www.mymdfit.com/api/health` answers `{"ok":true}`
   - `/api/videos` and `/api/site` answer `200`

## What counts as a failure

| Counts | Why |
|---|---|
| Any `5xx` from the API | The server could not do what it was asked |
| An error-level application log | Something broke inside a request or a job |
| A crash or restart that was not a deploy | The server went down on its own |
| A `FAILED` or `CRASHED` deployment | A change did not go live |
| Health check not ok | The API is not answering |
| `media upload failed`, `media sync failed` | A video could not be copied (should not recur: see below) |
| Audit or store errors | The record of who did what, or the data files, could not be written |
| `google_reviews_failed` | Google is refusing the reviews key. Counted until fixed (owner's rule) |

| Does not count | Why |
|---|---|
| `npm error ... signal SIGTERM` at the moment of a deploy | The old container being stopped. Every deploy prints it |
| `401`, `403`, `404`, `429` from MD Fit's own API | Refusals working as designed: no sign-in, no permission, not found, too many tries |
| Bot probes (`HEAD /`, `GET /api/`) | Outside noise the edge guard and the API already refuse |

## SEO changes

The checks above watch the API and the server. An SEO change cannot break `/api/health`; it breaks pages, canonicals,
schema, the sitemap and the `noindex` on the app screens. So an SEO change is monitored on its own terms as well.

An SEO change reaching production is a **change** under the rules above: it is a production deploy of the site on
Vercel, so the clock restarts and the review returns to Phase A. Nothing extra is needed to make that happen.

### Before the merge (the gate)

Run in the branch, and do not merge until all five pass:

| Check | Pass |
|---|---|
| `node scripts/seo/build.js` then `node scripts/seo/check.js` | `seo check: N pages ok` |
| `node scripts/seo/build.js` twice more, then compare every HTML file | no file differs (the build is idempotent) |
| `node scripts/seo/overview.js` | `issues 0`, `orphans 0`, pages and sitemap counts equal |
| `git status` for `*.css` | no CSS changed (SEO pages reuse the condition-page template) |
| The branch's Vercel preview | the changed page types load and look right |

Two build outputs are **expected** to differ when the build runs on a later day, and neither is a failure:
`data/search-index.json` (its `version` is the build date) and `docs/SEO-OVERVIEW.md` (it is a dated report).
`sitemap.xml` also rewrites all 359 of its `<lastmod>` values to the build date. That one **is** a known problem, not
an exception to accept: it tells Google every page changed today whenever anyone runs the build, which trains Google to
ignore the field. Until `scripts/seo/build.js` keeps a page's existing `<lastmod>` when its HTML has not changed, read
a sitemap diff as noise rather than as evidence that pages changed.

### After the deploy

All of it with a browser user agent, as in the live check above.

| Check | Pass |
|---|---|
| `/robots.txt` | 200; `GPTBot` `CCBot` `ClaudeBot` `Google-Extended` `Bytespider` `Amazonbot` still disallowed; `/account` `/visit` `/shared` `/api/` `/login` still disallowed |
| `/sitemap.xml` | 200, `<loc>` count matches what the build reported |
| One real URL per changed group: `/`, `/conditions/frozen-shoulder`, `/muscles/gluteus-medius`, `/pain/forehead`, `/activities/bench-press`, `/blog/pain-behind-the-knee` | each 200, with one `rel="canonical"` and at least one `application/ld+json` |
| `/account`, `/visit`, `/shared`, `/workspace`, `/intake`, `/cancel` | each still carries a `noindex` robots meta |
| `/login` | it has **no** robots meta by design; it is covered by `Disallow: /login` in `robots.txt`. Check the disallow, not the page |
| `/admin` and `/workspace` | answering 404 to a plain request is correct: they are gated so only a real browser session gets them. Not a failure |
| Two redirects from `vercel.json`, e.g. `/sciatica-treatment-sarasota` and `/privacy` | still redirect to the right target. Vercel serves these as `308`, which is permanent and equivalent to `301` here |

Pick the per-group URLs from `sitemap.xml` rather than guessing a slug. Pain pages are named for anatomy
(`/pain/forehead`, `/pain/temple`), never for a condition, so a guessed URL like `/pain/sciatica-pain` 404s and looks
like a failure when nothing is wrong.

### What counts as an SEO failure

| Counts | Why |
|---|---|
| `check.js` reports anything but ok | The gate exists to be believed |
| The build is not idempotent | A page changed with no data change; something is derived from the build date |
| A URL that was in the sitemap now answers 404 or 5xx | A page Google has indexed disappeared |
| An indexable page lost its canonical or its JSON-LD | The page is still served but no longer legible to search |
| **An app, workspace, visit or account screen lost `noindex`** | Patient-facing screens becoming indexable. Treat this as urgent, not as an SEO problem |
| `robots.txt` lost a disallow, or a 301 stopped redirecting | A safeguard or a ranking that was already paid for |
| The sitemap count fell without a deletion being intended | Pages dropped out of the index silently |

| Does not count | Why |
|---|---|
| A page's word count or internal link count changing | The expected result of an SEO change |
| `lastReviewed` absent from a page | Correct: it is published only when the data records a real sign-off date |
| Rankings or impressions moving | Not a failure. That is Phase 7 measurement, not monitoring |

A failed gate is fixed in the branch and never merged around. A failure found after a deploy is a change once fixed, so
the clock restarts on the fix.

## Known open item: Google reviews

Google answers `403: Permission denied on the service` for the key in `GOOGLE_PLACES_API_KEY`. The site keeps showing
the last good rating and reviews, and the server asks again at most every 6 hours while refused. Only the owner can fix
it, in Google Cloud:

1. console.cloud.google.com, the project the key belongs to.
2. APIs & Services, Library: **Places API** and **Places API (New)** enabled.
3. APIs & Services, Credentials: the key's restrictions allow the Places API.
4. Billing: the project's billing account is active (a lapsed one gives this same refusal).

It is treated as fixed when 24 hours pass with no `google_reviews_failed` line while the site was in use.

## Videos that cannot be copied

Three files cannot go through the automatic sync and are no longer retried by it (they were re-logged every 6 hours):

- `eccentric-dumbbell-shrug-drop`: no source file (no Drive id).
- Two lectures of 5.0 GB and 3.7 GB: over the 500 MB this server can carry. Upload them to Bunny directly, or export a
  smaller file.

They stay on the workspace's failed list; "retry failed" there tries them again once the file is fixed. See
`docs/VIDEO-UPLOAD.md`.

## Safeguard checks (run on a test copy, never on live data)

These are run by a session when asked for a compliance review, against a throwaway copy with invented patients.

| Check | What it proves |
|---|---|
| Backend test suite (`node --test`) | Every feature's own tests, including sign-in, roles, audit, compliance, import |
| Safeguard probe (24 checks) | No route answers without sign-in; patients are walled off; role limits hold; the audit ledger verifies and cannot be edited; data on disk is encrypted; no patient details in logs; agreement locks hold |
| New-surface probe (15 checks) | Import is owner-only; add-client and invite need the Clients permission; the compliance checklist carries no patient identifiers |
| Click sweeps | Every button and form in the chart and on each workspace screen, against a real local backend |

## What the software checks for itself

- **Compliance checklist** (workspace, Compliance): 16 HIPAA and Florida requirements, each worked out from what the
  system is doing right now. It reports encryption, automatic logoff, backup, audit-ledger integrity and the records
  the practice still owes.
- **Audit review** (workspace, Compliance, Audit review): who did what in the last 30 days, for the owner to read and
  sign off monthly.
- **Security & audit** (workspace): the full ledger, and a button that verifies its chain.
- **Developer console** (`/dev`): system status, usage and activity totals, with no patient data.

## What monitoring cannot see

- **Who has access to the GitHub repositories.** Installed apps and collaborators are only visible in the GitHub
  account's own security log (Settings, Security log; Applications; Installations).
- **Anything behind a sign-in on the live system.** Reviews never sign in to production.
- **Whether `DATA_ENC_KEY` is set**, other than through the Compliance checklist's Encryption row, which only the
  owner can open.

## Do not

- Do not lower or switch off a safeguard to investigate something. Reproduce it on a test copy.
- Do not print, copy or log a key or any patient detail.
- Do not treat a quiet log as proof of a fix: confirm the thing that was failing now succeeds.
