---
description: Get exercise footage from Drive onto Bunny Stream and publish it for Web, Android and Apple
argument-hint: "[status | upload | verify | all]  (default: status)"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, mcp__Google_Drive__search_files, mcp__Google_Drive__get_file_metadata, mcp__Railway__get-logs, mcp__Railway__list-variables, mcp__Railway__describe-service, mcp__Railway__connect-service-source
---

<!-- This file IS the /video-upload slash command. It lives in docs/ only because this session was not
     permitted to write under .claude/. To switch it on:
         mkdir -p .claude/commands && cp docs/VIDEO-UPLOAD.md .claude/commands/video-upload.md
     After that `/video-upload` appears in the slash-command menu in any session on this repo. -->

# Video upload run

Getting footage from Drive onto Bunny Stream, recorded in the backend, and in front of members on all three
platforms. Run `$ARGUMENTS` (default `status`).

**Never start at the upload step.** Every failed run in this project's history failed at preflight or on a
known trap, not in the upload itself. Work the phases in order and report what each one found.

## Where things are

| | |
|---|---|
| Footage | Google Drive, `MDFIT media` — Drive file IDs are the catalog keys |
| Backend | `/home/user/dr-caban/mdfit-backend` — `lib/videos.js` (sync), `lib/bunny.js` (client) |
| Frontend | `/home/user/mdfit-frontend` — `common.js` (`MDFitVideo`), `app/exercises.js` (catalog) |
| Bunny library | `805934`, pull zone `vz-03938ec5-16f.b-cdn.net`, collection **"In app"** |
| Railway | project `a5871163-a3f5-423a-ba07-124fcb4bc2d7`, service `bf11cde9-e643-4dd4-85e2-544978b7f7f0` |
| Env vars | `BUNNY_STREAM_API_KEY`, `_LIBRARY_ID`, `_HOSTNAME`, `_COLLECTION` (defaults to `In app`) |

Keys live in Railway only. Do not print one, copy one into a file, or paste one into chat — not even
partially. Never edit permissions or secrets from a session.

**The backend is the one place every client reads from.** The iOS and Android apps are not edited by this
command — and the iOS app is not to be touched from these sessions at all. What a run owes them is a correct
record in the backend, which they already consume. See *Phase 5*.

## Phase 0 — viewing from Drive

Drive is the source of truth for footage, and reorganizing it is safe: **file IDs never change on rename or
move, and sharing is per file**, so folders can be restructured without breaking playback.

- Find footage with `mcp__Google_Drive__search_files` (`mimeType:"video/mp4"`); results page, so page them.
- Check `size` on anything you intend to upload. Three plantar-fascia clips are **0 bytes** — they upload
  "successfully" and are useless.
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
- **Do not read a quota wall into a failure.** The believed Cloudinary cap was three ordinary bugs and zero
  quota errors in the logs. Check `mcp__Railway__get-logs` before blaming a plan limit.

## House rules that apply here

- Branch → PR → Vercel preview → merge. One session merges at a time.
- Railway does **not** auto-deploy: after a backend push that should go live, call
  `mcp__Railway__connect-service-source`. Do not do that for an unmerged feature branch.
- After any frontend JS/CSS edit, run `node scripts/version-assets.js` before committing.
- SEO pages are generated — see `docs/SEO-PLAN.md`.
- Nothing here is a reason to delete anything.
