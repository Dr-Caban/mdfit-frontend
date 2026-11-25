# MD Fit monitoring

How the live system is watched, what counts as a failure, and what to do about one. Written Nov 25, 2026.
This is a live patient EMR: monitoring reads logs and checks that pages answer. It never signs in to patient data,
never prints a key, and never lowers a safeguard to look at something.

## The rule

**Every change to the EMR is monitored this way** (owner's rule, Nov 25, 2026). A change is anything that goes live:
a deploy of the backend, the workspace, the member app or the site. No change is exempt, whichever session ships it.

A session that ships a change must, before it finishes:

1. Confirm the scheduled task below exists and is enabled (ask to list scheduled tasks).
2. If it is missing, create it again from "The task's prompt" at the end of this file.
3. Leave it running. It is paused, loosened or deleted only when the owner asks for that in the session.

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

## The task's prompt

If the scheduled task is ever missing, create one named **MD Fit endpoint failure review**, every 6 hours
(`0 */6 * * *`), with this prompt:

```
Scheduled review of MD Fit, on the owner's rules (Nov 25, 2026):
(A) monitor every 6 hours until there are 72 hours of no failures after a change. (B) After 72 hours with no changes,
monitor once every 24 hours. If a bug is found, repeat the process. Count the Google reviews failure until it is fixed.

RULES
- Phase A: every 6 hours. The 72-hour clock starts at the most recent change (the newest production deployment of
  the backend on Railway or the site on Vercel) or the most recent failure, whichever is later.
- Phase B: after 72 hours with no failure and no change, switch this task to once every 24 hours.
- In either phase, a failure or a new change sends it back to Phase A with the clock restarted.

REVIEW
1. Railway project a5871163-a3f5-423a-ba07-124fcb4bc2d7, service bf11cde9-e643-4dd4-85e2-544978b7f7f0: list
   deployments (newest time; any FAILED or CRASHED); read deploy logs filtered "@level:error OR @level:warn" and http
   logs for 5xx since the previous review. Vercel: the newest production deployment's time.
2. Live check with a browser user agent: https://www.mymdfit.com/api/health is {"ok":true}; /api/videos and /api/site
   answer 200.
3. Failures and non-failures: as listed in docs/MONITORING.md ("What counts as a failure").
4. A bug in MD Fit's code is fixed the usual way (branch, tests, pull request, merge, redeploy), never by weakening a
   safeguard. That deploy is a change: the clock restarts.
5. Work the phase out from the deploy and log times, then set this task's schedule if it is not already right:
   Phase A "0 */6 * * *"; Phase B "CRON_TZ=America/New_York 47 8 * * *".
6. Report briefly: failures (or none), changes since the last review (or none), Google reviews status, the phase and
   hours clean out of 72, and anything the owner needs to do. Never print keys or patient data.
```
