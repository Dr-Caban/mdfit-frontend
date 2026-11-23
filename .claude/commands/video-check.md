---
description: Read-only video run — search Drive, report what is published, waiting, blocked or undecided. Writes nothing.
argument-hint: "[nothing, or a folder name to narrow to]"
allowed-tools: Bash, Read, Grep, Glob, mcp__Google_Drive__search_files, mcp__Google_Drive__get_file_metadata, mcp__Railway__get-logs, mcp__Railway__list-variables, mcp__Railway__get-status
---

# /video-check — the reading workflow

**This is one of two video commands, and it is the one that changes nothing.** Say so in your first line back:
*"Running /video-check — reading only, nothing will be written."* The other command, `/video-place`, is the only
one that writes. Never slide from this one into that one: if reading turns up work to do, report it and stop.

Authority for all of this is `docs/VIDEO-UPLOAD.md`. Read it before you start. Its **"Ask before you commit"**
section is the owner's standing rule, and the short version is: **if a placement was not asked for, you ask.**

## What this command does

1. **Search Drive yourself.** The owner does not hand you a listing — you build it.
   - Folder ids are already committed in `data/drive-folders.json`, and Drive ids never change on rename or
     move, so you do not re-discover the tree. Search only for the video files:
     `'1WFdWQyD1_EbmTQYEHwZHibOor1ouGyua' in ancestors and mimeType contains 'video/'`
     with `excludeContentSnippets: true` and `pageSize: 100`. It pages — keep going until there is no
     `nextPageToken` (about four pages today). Results are large, so let them spill to a file and read them
     with `jq` rather than into the conversation.
   - Write the files out as `{ "files": [ { "id", "title", "parentId", "mod", "size" } ] }`. `size` comes from
     `get_file_metadata` as `fileSize`; fetch it for anything you are about to call a candidate, because it is
     the only way to catch a zero-byte clip or one over the API's cap before a run wastes an hour.
   - If a folder has appeared that is not in `data/drive-folders.json`, add it there — that is the one write
     this command may make, and it is a fact about Drive, not a placement.
2. **Fetch the published map:** `GET https://www.mymdfit.com/api/videos` with a browser user-agent (the edge
   refuses `curl`'s own). Save it; it is what tells *published* from *still encoding*.
3. **Run the intake:** `node scripts/video-intake.js --drive <files.json> --api <videos.json>`
4. **Listen to anything unnamed.** A camera-named clip is not an unknown: Dr. Jared says the
   movement's name in the first seconds. Follow *Identifying an unnamed clip* in the runbook —
   thumbnail, size check, then `pip install faster-whisper` and
   `python3 -I scripts/video-stt.py clip.mp4 --head 12`, which transcribes in this container.
   Never send a clip or a link to one to an outside service. Delete the video once the audio is out.
   This is the owner's standing instruction for every clip from 22 Nov 2026 onward.
5. **Report what it says**, in its own terms: published, still encoding, already decided, not for publishing,
   needs renaming in Drive, waiting on a decision. For anything waiting, give the owner the clip name, its
   Drive folder and its id, and say plainly what you need from them for each one — usage and placement.
6. **Stop there.** No catalog edit, no manifest rebuild, no commit, no push, no deploy, no "sync now".

## Checking the hosts while you are here

- Railway: `get-status` on project `a5871163-a3f5-423a-ba07-124fcb4bc2d7`, and `list-variables` on service
  `bf11cde9-e643-4dd4-85e2-544978b7f7f0` for the `BUNNY_STREAM_*` names. **Never echo a value.**
- A Bunny playback URL checked by hand needs a referrer: the pull zone has allowed-referrer protection on, so
  `-e https://www.mymdfit.com/` or you get a 403 that looks exactly like a broken upload.
