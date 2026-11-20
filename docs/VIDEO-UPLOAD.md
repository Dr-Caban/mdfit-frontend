---
description: Get exercise footage from Drive onto Bunny Stream and publish it for Web, Android and Apple
argument-hint: "[status | upload | verify | all]  (default: status)"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, mcp__Google_Drive__search_files, mcp__Google_Drive__get_file_metadata, mcp__Railway__get-logs, mcp__Railway__list-variables, mcp__Railway__describe-service, mcp__Railway__connect-service-source
---

<!-- The commands are switched on and live in .claude/commands/ :
         /video-check   read-only: search Drive, report, write nothing
         /video-place   writing: place confirmed clips, rebuild the manifest, commit, ask before the deploy
         /video-upload  the whole run, this file
     This file stays the authority for all three. -->

# Video upload run

Getting footage from Drive onto Bunny Stream, recorded in the backend, and in front of members on all three
platforms. Run `$ARGUMENTS` (default `status`).

**Never start at the upload step.** Every failed run in this project's history failed at preflight or on a
known trap, not in the upload itself. Work the phases in order and report what each one found.

## Ask before you commit (owner, Nov 2026)

These are the owner's standing rules for every video run. They outrank convenience and they outrank a plan
already agreed earlier in a session.

1. **No guessing where a video goes or what it is for.** A new clip needs its placement (region, category,
   level, location, seated or not — or, for a protocol clip, which protocol and which week) and its usage
   (exercise library, pain track, protocol sheet, lecture, app intro). If any of that is not confirmed by the
   owner, **stop and ask**. Do not infer it from the file name, the Drive folder, a sibling clip, or what
   looks obvious.
2. **Nothing is committed or pushed on an unconfirmed placement.** No commit, no push, no pull request, no
   manifest rebuild — the work waits in the session until the owner answers. A session may read Drive, Bunny,
   Railway and the catalog freely while it waits; reading is never the thing to ask about.
3. **Confirm before deployment.** Say what will go live, for which videos, and on which branch, and get a
   yes. That covers merging a pull request, and it covers anything that makes the backend pick the change up
   (`connect-service-source`, "sync now" in the workspace).
4. **A partial answer is not a full one.** If the owner confirms some clips and not others, ship the
   confirmed ones and leave the rest uncommitted, named, in the session's report.
5. **When in doubt, ask once, plainly, with the list.** One question naming every clip and what is missing
   for each beats a run that guesses and a run that stalls silently.

6. **Say which of the two workflows you are in, every time.** `/video-check` reads and reports and writes
   nothing; `/video-place` writes, commits and asks before the deploy. State which one in the first line of
   every reply during a run, and never cross from reading into writing without a confirmation in hand. Mixing
   them up is how an unconfirmed clip gets committed by accident.

## Where things are

| | |
|---|---|
| Footage | Google Drive, `MDFIT media` — Drive file IDs are the catalog keys |
| Backend | `/home/user/dr-caban/mdfit-backend` — `lib/videos.js` (sync), `lib/bunny.js` (client) |
| Frontend | `/home/user/mdfit-frontend` — `common.js` (`MDFitVideo`), `app/exercises.js` (catalog) |
| Intake | `scripts/video-intake.js` — Drive vs catalog vs manifest vs Bunny; proposes, never places |
| Folder ids | `data/drive-folders.json` — the Drive tree; ids never change, so a run searches only for files |
| Decisions | `data/video-placements.json` — placements already taken, so no session re-asks |
| Bunny library | `805934`, pull zone `vz-03938ec5-16f.b-cdn.net`, collection **"In app"** |
| Railway | project `a5871163-a3f5-423a-ba07-124fcb4bc2d7`, service `bf11cde9-e643-4dd4-85e2-544978b7f7f0` |
| Env vars | `BUNNY_STREAM_API_KEY`, `_LIBRARY_ID`, `_HOSTNAME`, `_COLLECTION` (defaults to `In app`) |

Keys live in Railway only. Do not print one, copy one into a file, or paste one into chat — not even
partially. Never edit permissions or secrets from a session.

**The backend is the one place every client reads from.** The iOS and Android apps are not edited by this
command — and the iOS app is not to be touched from these sessions at all. What a run owes them is a correct
record in the backend, which they already consume. See *Phase 5*.

## Phase 0 — intake: what is in Drive, and what the catalog already has

Drive is the source of truth for footage, and reorganizing it is safe: **file IDs never change on rename or
move, and sharing is per file**, so folders can be restructured without breaking playback.

**There is no "already uploaded" folder, and there should not be one.** Drive says what a clip *is*; whether
it has been published is a fact about the manifest and Bunny, not about Drive, and `/api/videos` already
knows it. Moving files to record upload state would be a second copy of that fact, kept by hand, free to
drift. `scripts/video-intake.js` joins the two instead.

### How `MDFIT media / MD Fit Library` is organized

The numbered top-level folders are the organization, and the number carries the usage:

| Folder | What is in it | Published? |
|---|---|---|
| `1 Exercise Library` | library movements, in region subfolders (`Knees`, `Hips & Glutes`, …) | yes |
| `2 Pain Tool – Tracks by Body Region` | `<Region> — Referred Pain` tracks | yes |
| `3 Programs` | `Dream Lean 12` (per-day folders), `PSG Hypertrophy Program` | yes |
| `4 Intros, Testimonials & Lectures` | app intros, lectures, `Video Testimonials` | yes |
| `5 New Footage – Needs Names` | the inbox: nothing here can be placed until it is named | no |
| `6 Protocols – by Condition` | `Plantar Fasciitis — 4 Week`, `12 Week Full Mobility System / Track A`,… | yes |
| `7 Full Session Recordings` | long-form sessions, not library clips | no |
| `8 Reference Images and Design Files` | stills and design files | no |
| `9 Unused Empty Folders` | kept for reference | no |
| `99 Duplicates` | second takes, set aside on purpose | **never** |

### Running the intake

The session writes a listing of the Drive tree, then the script joins it to the catalog, the manifest and
Bunny's published map. It writes nothing on its own.

```
node scripts/video-intake.js --drive drive.json --api videos.json
```

- `--drive` is `{folders:[{id,title,parentId}], files:[{id,title,parentId,mod,size}]}`, built from
  `mcp__Google_Drive__search_files` (page it — `'<folder id>' in ancestors and mimeType contains 'video/'`)
  plus `get_file_metadata` for the folder names. Include `size` (`fileSize`) when you have it.
- `--api` is the body of `GET /api/videos`, so the report can tell *published* from *still encoding*.

What the report tells you, and why each line is there:

- **In the manifest, not yet published** — normally just encoding. If a clip is also over the API's
  500 MB cap (`MEDIA_MAX_MB`) or zero bytes, it is not encoding and no number of runs will change that.
- **Not for publishing** — counted by folder, so you can see nothing is being quietly dropped.
- **Cannot be proposed until renamed** — unnamed camera files (`20261111_132836.mp4`) and `(take 2)` clips.
  A file named like that has no placement anyone can confirm, so it is not offered as a candidate at all.
- **Waiting on a decision** — grouped by Drive folder, with `+` for a name the library has never had and
  `~` for one it already plays under a different Drive id. `~` matters: a movement filmed again for a
  program or a track is **one movement and two files**, and publishing the second gives the app two videos
  for one name. Leave it in Drive, add it as its own entry, or replace the existing entry's id — but decide,
  do not let it ride.

The same name on several candidate files is the same story one level down: `Standing Hip Abduction and
Adduction` filmed for three tracks is three Drive files and one movement.

### Placing a confirmed clip

Only the owner's confirmation puts a clip in the catalog (see *Ask before you commit*):

```
node scripts/video-intake.js --drive drive.json --confirm ok.json --write
```

`ok.json` is a list of complete decisions, and *complete* is enforced — a missing field, a region or
category the app does not already file, a level outside 1–9, a Drive id that is not in the listing or is
already in the catalog: each is refused by name and nothing is written.

```json
[{"id":"<drive id>","name":"Pike Bear Walk","region":"Core","cat":"Activation","level":3,
  "loc":"any","seated":false}]
```

Regions and categories are read back out of `app/exercises.js`, so a new entry can only use ones the app
already knows how to file. Run it without `--write` first: it prints what it would add and changes nothing.
Afterwards: `node scripts/build-media-manifest.js`, then `node scripts/version-assets.js`, then commit.

Still true, and still worth checking:

- A movement with `id: null` in the catalog is a deliberate "coming soon" marker for footage not yet filmed.
  It is not a missing upload.
- A large unshared file returns an **HTML warning page** instead of bytes; the sync falls back to the Drive
  API for those. A "video" that is actually HTML is this.

## Phase 1 — preflight

Each of these has silently wasted a full run before.

1. **MP4 Fallback must be ON** in the Bunny library (Encoding tab). Without it Bunny never produces
   `play_720p.mp4`, the readiness gate never publishes a guid, and every upload sits at `bunnyPending`
   forever. `status()` in `lib/bunny.js` reports `has720: false` — that is this, not a slow encode.
2. **Railway env vars present**, via `mcp__Railway__list-variables` (names only — never echo values).
3. **Disk headroom.** Each file is downloaded to `os.tmpdir()` before going up, so a 430 MB clip needs
   ~430 MB free. Writable disk is a fixed per-session allowance, so `df` "Avail" misleads. Clear build
   artifacts and stale clones if it is tight — deletes still succeed while writes fail.
4. **Token Authentication** (Security tab): if on, unsigned playback URLs 403. No client signs them today, so
   it must stay off until they do — and that is one decision for Web, Android and Apple together.

## Phase 2 — inventory

Find out what actually needs uploading rather than assuming:

```
GET /api/admin/videos/status      # admin auth
```

Read the `mirror` block: `{videos, onBoth, bunnyPending, bunnyMissing, failed}`.

- `bunnyMissing` — never uploaded. These are the work.
- `bunnyPending` — uploaded, Bunny has not finished a 720p MP4. Wait, do not re-upload. If it does not clear,
  go back to preflight item 1.
- `failed` — recorded failures, retried only with `{retryFailed: true}`.

`window.MDFIT_EXERCISES` in `app/exercises.js` is the catalog; the manifest is what the backend syncs. They
are not the same length and never have been — do not treat the difference as missing uploads.

## Phase 3 — upload

```
POST /api/admin/videos/migrate    {}                      # everything missing
POST /api/admin/videos/migrate    {retryFailed: true}      # also re-attempt recorded failures
```

Then poll `GET /api/admin/videos/status` until `job.finishedAt` is set. Use a single `until` condition rather
than a `sleep` loop.

Each video is created in the **"In app"** collection, then the bytes are streamed up — never read whole; a
buffered body costs the entire file in RSS on a 1 GB container (`test/bunny-stream.test.js` holds that line
at 149 MB vs 3 MB for a 64 MB file). If the collections API is down the upload still proceeds unfiled: the
folder is cosmetic, the guid is not.

## Phase 4 — readiness

A guid reaches `/api/videos` **only** after Bunny confirms a 720p MP4 exists. A just-uploaded video is
therefore correctly invisible for a few minutes.

Readiness also gates visibility: `MDFitVideo.playable(id)` is false for anything not in a published map, and
the library, category chips, jump list, care plan, runner, pain tracks and guides all hide or down-grade it
rather than offering a player. **While no map is held at all** — API down, first load — `MDFitVideo.mapped()`
is false and nothing is hidden. Do not "fix" that; it is the safe fallback.

## Phase 5 — publishing to Web, Android and Apple

One upload serves all three, so the record the backend keeps is the deliverable. `GET /api/videos` returns:

```
bunny: {
  host:  "vz-03938ec5-16f.b-cdn.net",
  map:   { "<key>": "<guid>" },        // only videos Bunny has encoded
  res:   { "<key>": ["360p","720p"] }, // what Bunny actually produced
  paths: { hls:   "https://{host}/{guid}/playlist.m3u8",
           mp4:   "https://{host}/{guid}/play_{res}.mp4",
           thumb: "https://{host}/{guid}/thumbnail.jpg",
           preferred: "720p" }
}
```

| | Who needs it |
|---|---|
| `hls` | **Apple** (App Store review expects HLS for long-form over cellular); Android and Web play it too |
| `mp4` | Web today; Android; a plain `<video>` tag anywhere |
| `thumb` | all three |

Clients fill the templates — they must not hard-code the host or the URL shape, so moving the pull zone is
one env var rather than three app releases. `res` exists so a client picks a rendition instead of assuming
720p. If a platform needs a field the backend does not publish, **say so and stop** rather than inventing a
client-side convention: a URL shape baked into a shipped app cannot be taken back.

## Phase 6 — verify

Do not report success off the job counters alone.

1. `GET /api/videos` — confirm the new keys are in `bunny.map` and have entries in `bunny.res`.
2. Fetch real playback URLs for at least two new guids and check they return video bytes, not HTML or a 403 —
   the MP4 **and** the HLS manifest.
3. Confirm the count members see moved: the library header and the Home card both read from the gated list.

## Known traps

- **Zero-byte Drive files** upload "successfully" and are useless. Check `size` first.
- **Assets with no source.** `Eccentric Dumbbell Shrug Drop` has no `drive_id` and no `url`; it fails every
  run. That is data, not a bug in the sync.
- **Slashes in display names** were rejected by the upload API and looked exactly like a quota error.
- **The pull zone refuses a request with no `Referer`.** Allowed-referrer protection is on, so a playback URL
  fetched with no referrer gets a Bunny **403** while the same URL from `https://www.mymdfit.com/` returns 200
  (checked 20 Nov 2026). Web is fine. A native player sends no `Referer`, so this — not Token Authentication —
  is what would break the iOS and Android apps, and it is one decision for all three platforms. Verifying a
  guid by hand from a session means sending the referrer, or a 403 reads as a broken upload.
- **A clip can be too big to ever upload.** The API downloads each file before sending it on and refuses
  anything over `MEDIA_MAX_MB` (500 by default). `Hormones, Cortisol and Longevity Lecture.mp4` is 5.04 GB and
  `Cortisol and Progesterone Lecture (take 2).mp4` is 3.69 GB: both sit in the manifest unpublished and will
  stay there. A lecture that size wants compressing, or uploading to Bunny directly, not another sync run.
- **The automatic sync never retries a clip that failed.** A failed asset keeps its strike and `autoSync`
  skips it for good; only "retry failed" in the workspace (`{retryFailed: true}`) tries again. A clip that is
  small, named and still unpublished is usually this, not a slow encode.
- **Do not read a quota wall into a failure.** The believed Cloudinary cap was three ordinary bugs and zero
  quota errors in the logs. Check `mcp__Railway__get-logs` before blaming a plan limit.

## House rules that apply here

- Branch → PR → Vercel preview → merge. One session merges at a time.
- Railway does **not** auto-deploy: after a backend push that should go live, call
  `mcp__Railway__connect-service-source`. Do not do that for an unmerged feature branch.
- After any frontend JS/CSS edit, run `node scripts/version-assets.js` before committing.
- SEO pages are generated — see `docs/SEO-PLAN.md`.
- Nothing here is a reason to delete anything.
