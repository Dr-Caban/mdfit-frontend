---
description: Writing video run — place clips the owner has confirmed, rebuild the manifest, commit. Only ever runs on confirmed placements.
argument-hint: "the clips the owner confirmed, or nothing to be shown what is still open"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, mcp__Google_Drive__search_files, mcp__Google_Drive__get_file_metadata, mcp__Railway__get-logs, mcp__Railway__connect-service-source
---

# /video-place — the writing workflow

**This is the other of the two video commands, and it is the one that writes.** Say so in your first line back:
*"Running /video-place — this writes to the catalog and commits, on confirmed placements only."* `/video-check`
reads and reports; this one changes the repository. Keep them apart in your own head and in what you tell the
owner, every time.

Authority is `docs/VIDEO-UPLOAD.md`, and its **"Ask before you commit"** section governs this command
completely. The rule in one line: **if a placement was not asked for, you ask.** Not inferred from a file name,
not from the Drive folder, not from a sibling clip, not from what is obviously right.

## What counts as confirmed

A clip is confirmed when the owner has given, in this session, all of: its **name**, and for a library
movement its **region**, **category**, **level**, **location** and whether it is **seated**; or, for anything
else, which **usage** it has (pain track and which track, protocol and which week, program and which day,
app intro, lecture, testimonial).

Anything short of that is not confirmed. A clip the owner mentioned but did not place is not confirmed. A clip
whose placement you worked out yourself is not confirmed. **Ask, with the list, and wait.**

## The run

1. **Start from a reading pass.** Run `/video-check`'s steps (search Drive, fetch `/api/videos`, run the
   intake) so you are placing against what is true now, not what a report said yesterday.
2. **Write the decisions file** from what the owner actually said — their words, not your reading of them:
   ```json
   [{"id":"<drive id>","name":"Pike Bear Walk","region":"Core","cat":"Activation","level":3,
     "loc":"any","seated":false}]
   ```
3. **Dry run first**, always: `node scripts/video-intake.js --drive files.json --confirm ok.json`
   It prints what it would add and changes nothing. A refusal names the clip and what is missing — take that
   back to the owner, do not fill the gap in yourself.
4. **Write it:** add `--write`. This touches `app/exercises.js` only, and only for library movements. A pain
   track, protocol, program, intro, lecture or testimonial lives in the hand-kept sections of
   `data/media-manifest.json`, so that is an edit you make by hand and describe before you make it.
5. **Then, in order:**
   ```
   node scripts/build-media-manifest.js
   node scripts/version-assets.js
   ```
6. **Record the decision** in `data/video-placements.json`, so the next session inherits it instead of asking
   again: the clip's id, name, Drive folder, the decision, why, the date and that it came from the owner.
   A decision only ever goes in here after the owner has given it.
7. **Commit on the session's branch**, and say what is in the commit. Then **ask before the deploy**: name the
   clips going live and the branch, and get a yes. That covers merging and it covers anything that makes the
   backend pick it up (`connect-service-source`, "sync now").
8. **Afterwards**, Bunny takes it from there: the API re-reads the manifest within 6 hours and publishes each
   guid once Bunny confirms a 720p MP4. Verify as Phase 6 of the runbook says — the keys in `bunny.map` with
   entries in `bunny.res`, and real playback URLs returning video bytes (send the referrer, or you will get a
   403 from the pull zone's referrer protection and read it as a broken upload).

## Stop and ask instead of writing when

- a clip is over `MEDIA_MAX_MB` (500 MB) or zero bytes — it will never upload, and another run will not fix it;
- the library already plays a video under that name — one movement, two files, and which one wins is the
  owner's call;
- the clip is an unnamed camera file or a `(take 2)` — it needs renaming in Drive first;
- the owner confirmed some clips and not others — place the confirmed ones, and name the rest as still open.
