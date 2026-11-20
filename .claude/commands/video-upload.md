---
description: Full video run from the runbook — footage from Drive onto Bunny and published for Web, Android and Apple.
argument-hint: "[status | upload | verify | all]  (default: status)"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, mcp__Google_Drive__search_files, mcp__Google_Drive__get_file_metadata, mcp__Railway__get-logs, mcp__Railway__list-variables, mcp__Railway__describe-service, mcp__Railway__connect-service-source
---

# /video-upload — the whole run

`docs/VIDEO-UPLOAD.md` **is** this command. Read it and follow its phases in order; it is not a reference to
skim. Do not improvise a run and do not start at the upload step: every failed run in this project's history
failed at preflight or on a known trap, never in the upload itself.

**Two commands, two workflows — say which one you are in, in your first line back, every time.**

| | |
|---|---|
| **`/video-check`** | reads and reports. Searches Drive, says what is published, encoding, blocked or undecided. Writes nothing. |
| **`/video-place`** | writes. Places clips the owner has confirmed, rebuilds the manifest, commits, and asks before the deploy. |

This command spans both, so be explicit about which half you are in at any moment, and never cross from
reading into writing without the owner's confirmation in hand.

The rule that outranks everything else here is the runbook's **"Ask before you commit"** section:
**if a placement was not asked for, you ask.** Never guess where a clip goes or what it is for, and never
commit, push or deploy on one that is unconfirmed.
