# Cohort — what was built, what was verified, and what was not

**Nov 11, 2026.** Written for someone checking this work who was not there when it was done.

## The short version

- A database foundation exists: three migrations (375 lines of SQL) that put tenant isolation,
  discipline separation, sensitivity tiers, note locking, booking-overlap prevention and an append-only
  chained audit ledger **into Postgres itself**, below any application code.
- 33 tests pass, each a real query against a real PostgreSQL 16.15 database rebuilt from empty.
- A preview of the screens is installed at `/workspace-preview`: MD Fit branding, no sample data, no backend.
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

## The workspace preview page

`workspace-preview.html` at the repository root, served at `/workspace-preview`, is the uploaded Universal
EMR prototype with three changes:

1. **MD Fit branding.** Colours and fonts from the site's own stylesheet: white surfaces, light blue
   `#7AAFD7` for fills, navy `#0A1A2E` for text, Libre Baskerville and Montserrat. Light blue fails
   contrast as small text on white, so accent-coloured text uses the brand's darker blue `#2F6E9E`.
   All colours sit in one block at the top, so another practice's branding is a change to that block.
2. **All sample data removed.** No made-up clients, staff, appointments, notes, messages, invoices,
   prices, revenue figures, audit entries or statuses. Every list is empty and every screen shows an
   empty state. Dates come from the real calendar.
3. **No action pretends to work.** Every button that would need a server shows one message: "Preview
   only: not connected yet, so nothing was saved or sent." A bar at the top of every screen says the page
   is not connected and asks people not to enter patient information. The Security screen shows every
   control as "Not set up".

It is kept away from search engines (`noindex`, and `Disallow` in `robots.txt`) and nothing on the site
links to it.

Checked in Chromium:

| Check | Result |
|---|---|
| All 18 screens load | 18 of 18, no script errors |
| The site's own layout rule (from `scripts/layout-check.js`) on the default screen at its five widths | Passes at 320, 390, 768, 1366 and 2560 |
| The same rule on all 18 screens at 320, 390 and 1366 | 54 of 54 pass |
| Every visible button on every screen clicked (60 clicks) | No errors; the only message any action produced was the preview notice |
| Search for the removed sample names, figures and claims in the file | None left |
| `scripts/seo/check.js` for the whole site | 238 pages ok |

Phone-width defects found in the original prototype and fixed: the calendar, form builder, payments
table and client-app mock-up all ran off a phone screen, and one label ran out of its card on desktop.

Not checked: dark theme, Safari and Firefox, keyboard-only and screen-reader use. The site's full
layout job in CI also needs the backend, so it has not been run here; only its page rule has.
