# Cohort — what was built, what was verified, and what was not

**Nov 11, 2026.** Written for someone checking this work who was not there when it was done.

## The short version

- A database foundation exists: three migrations (375 lines of SQL) that put tenant isolation,
  discipline separation, sensitivity tiers, note locking, booking-overlap prevention and an append-only
  chained audit ledger **into Postgres itself**, below any application code.
- 33 tests pass, each a real query against a real PostgreSQL 16.15 database rebuilt from empty.
- Separately, the clinic site has a working `/workspace` page on its existing backend (see the last section).
- **There is no application.** No API, no login, no encryption code, no hosting. Nothing here stores or
  could store patient data, and nothing here is HIPAA compliant. See `HIPAA-STATUS.md`: 0 of 84 items
  complete, 7 with tested groundwork.

## How to rerun everything

Needs a PostgreSQL 16 server and a superuser to run the migrations.

```bash
PGHOST=/tmp PGPORT=5433 PGUSER=<superuser> db/test/run.sh
```

It drops and recreates a `cohort_test` database, applies every migration in order, loads fixtures, and
runs the tests. Expected last line: `33 passed, 0 failed`. A failure exits non-zero.

## Why the tests can be trusted

Three choices make a pass mean something:

1. **Tests connect as `cohort_app`**, a role that owns no tables and is not a superuser. Postgres skips
   row-level security for table owners and superusers, so testing as either would pass no matter what.
   The run prints `superuser=false bypassrls=false` for the role before the tests start.
2. **No test query filters by practice.** Every isolation result comes from the database policy alone,
   which is the situation a forgotten `WHERE` clause in application code would create.
3. **A negative control** reads the same table as a superuser and gets both practices' rows. That shows
   the isolation passes are caused by the policies and not by empty tables.

Fixtures (`db/test/seed.sql`): two practices; in the first, two staff in different disciplines and four
notes covering T1, T2 and a locked note.

## What each group proves

| Group | Tests | What a pass means |
|---|---|---|
| Tenant isolation | 5 | A session for one practice gets zero rows from another, for clients and for the ledger. A session with no practice set gets zero rows (fails closed) |
| Discipline segregation | 3 | A behavioral-health session cannot read a bodywork note, and the reverse for encounters |
| Sensitivity tiers | 3 | A T2 note is readable by its author only. A colleague in the same discipline is refused, and can still read T1 |
| Ledger append-only and chained | 5 | UPDATE, DELETE and TRUNCATE on the ledger are refused. An entry whose `prev_hash` is not the current head is refused. Every entry links to the one before |
| Ledger fork race | 3 | Two transactions appending to the same head at the same time: one lands, the other is refused, the chain still links |
| Note locking | 3 | A locked note cannot be changed or deleted. An unlocked one can |
| Note identity | 2 | A note's author and discipline cannot be changed by anyone |
| Write paths | 6 | One practice cannot insert into another, move its own rows to another, or append to another's ledger. Soft delete works and the active-clients view still isolates tenants |
| Double-booking | 2 | An overlapping booking for the same provider is refused even when the start times differ. A non-overlapping one is accepted |
| Negative control | 1 | See above |

## Defects found while verifying, and fixed

The first full run showed 13 failures. All 13 were faults in the test script (it captured `psql`'s `SET`
echoes as output, and one query nested a window function inside an aggregate). The schema was not
changed to make them pass.

A second pass, looking for what the tests did not cover, found three real defects in the schema:

1. **Ledger fork under concurrency.** Two transactions could both read the same head and both append,
   splitting the chain. Fixed with a unique index on `(practice_id, prev_hash)`; covered by the race test.
2. **Soft delete was impossible.** The tenant policy included `deleted_at IS NULL`, and Postgres checks
   an updated row against the read policy, so setting `deleted_at` was rejected. Fixed by keeping the
   policy to tenancy only and adding a `client_active` view.
3. **A note could be taken over.** A colleague able to see an unlocked T1 note could set themselves as
   author and raise it to T2, hiding it from its real author. Fixed with a trigger that freezes author,
   client, practice and discipline.

## What is NOT verified — read before relying on any of this

- **The database trusts the application to say who is asking.** Policies read the practice, staff and
  disciplines from session settings. Anything that can run SQL as `cohort_app` can set those to any
  value. This design protects against query bugs in application code. It does not protect against a
  compromised application server. The data access layer that sets these settings is not written.
- **The chain proves order, not authenticity.** The database checks that each entry names the previous
  hash. It does not check that a hash was computed from the entry's content, and it does not check
  signatures. Test fixtures use fixed bytes for both. The signing service is not written, so anyone with
  insert rights could append false entries that link correctly.
- **Nothing writes to the ledger.** "Every chart view is logged" is a property of code that does not
  exist yet.
- **The daily off-box anchor is a table, not a process.** Removing the newest entries is refused for the
  application role, but a superuser who disables the triggers could do it, and nothing would detect it
  until anchoring exists.
- **Role permissions are not built.** The database separates practices, disciplines and tiers. It does
  not know that a front-desk user may not change a staff member's role. Within a practice, the
  application role can currently update `staff` and `practice` rows.
- **Front-desk scheduling is unresolved.** Encounters are visible by discipline, so a front-desk session
  with no discipline sees no appointments. Scheduling visibility needs to be separated from clinical
  visibility.
- **No encryption.** `body_ciphertext` and `dek_id` are columns. No key service or encryption code exists.
- **Not tested at all:** performance, backup and restore, migrations against existing data, addendum
  rules beyond the table existing, T3 notes specifically (they follow the same rule as T2), consent,
  break-glass.
- **Test environment.** A scratch PostgreSQL 16.15 on a local socket with trust authentication. It says
  nothing about production configuration.

## The clinic workspace at `/workspace`

This is separate from the Cohort product: it is MD Fit's own page, on MD Fit's existing single-practice
backend. `workspace.html` holds the screens and styles from the uploaded prototype in MD Fit's colours;
`workspace-app.js` signs in and reads and writes through the same `/api/admin/*` endpoints as `/admin`.
`/admin` is unchanged.

**Connected: 43 of the backend's 87 admin endpoints.** Sign-in (with the emailed-code step), dashboard,
week calendar with appointment status and notes, classes and class bookings, clients, the client chart
(record, patient notes add and remove, movements prescribe and remove, intake documents, pain log, video
visit scheduling, patient conversion), leads, messages, programs, payments and members (read), newsletter,
reviews and bug reports, team, the audit ledger with its verify check, settings (read), and Insights at
the bottom of the Admin group (analytics with a period selector, site search, email alerts, and an Audit tab).

**Not connected: the other 44.** Mostly editing screens: settings, content, classes and daily activities
editors, hours and calendar sync, messages to many people, two-step sign-in setup, client contact, plan,
program and membership edits, CSV downloads, email log, push devices, video migration. Each affected
screen links to the matching `/admin` screen instead.

**Shown as "Not connected" because the backend has nothing for them:** private clinical notes, signing
and sensitivity tiers, AI scribe, built-in video, a form builder, food journals and meal plans,
medication lists, sharing consent, extra staff accounts and roles.

Tested in Chromium against the real backend run locally with made-up people:

| Check | Result |
|---|---|
| Walk-through of 49 steps: wrong password refused, sign in, all 21 screens, 8 chart tabs, Insights period and Audit tab, add and remove a note, prescribe and remove a movement, view documents, schedule a video visit, send a message, change a lead, save an appointment, verify the ledger, search, sign out | 49 of 49 |
| API calls during the walk-through | 37 distinct; the only refusals were the two the test provokes on purpose (wrong password, video visit with no link) |
| HTML typed into a client's name | Shown as text, not run |
| Sign-out | Names gone from the page, token gone from the browser |
| The site's layout rule on the sign-in screen at its five widths, and on all 21 screens and 6 chart tabs signed in at 320, 390 and 1366 | 92 of 92 |
| `scripts/seo/check.js` for the whole site | 237 pages ok |

Protections match `/admin`: private path in `middleware.js`, no-cache and noindex headers in
`vercel.json`, `Disallow` in `robots.txt`, signs out after 15 idle minutes, nothing clinical kept in
browser storage.

Not tested: the emailed-code sign-in step, the 6 connected endpoints the walk-through does not reach
(cancelling a class booking, deleting a lead, removing a subscriber, the two review and report updates,
patient conversion), dark theme, Safari and Firefox, keyboard-only and screen-reader use, and live
updates (this page refreshes on navigation; `/admin` also listens on a socket).
