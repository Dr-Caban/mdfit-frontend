#!/usr/bin/env node
// Video intake: what is in Drive, what is in the catalog, what Bunny has published, and what is still waiting on a
// decision. This is the first step of a video run (docs/VIDEO-UPLOAD.md, Phase 0) and the only step that proposes
// catalog entries.
//
//   node scripts/video-intake.js --drive drive.json                    # report (writes nothing)
//   node scripts/video-intake.js --drive drive.json --api videos.json  # report, with Bunny's published map
//   node scripts/video-intake.js --drive drive.json --confirm ok.json --write
//
// It NEVER invents a placement. A clip reaches app/exercises.js only when --confirm names it with every field filled
// in, by a person. That is the owner's standing rule; see the "Ask before you commit" section of docs/VIDEO-UPLOAD.md.
//
// --drive takes a listing of the Drive folder, which a session writes with the Google Drive tools:
//   { "folders": [ { "id": …, "title": …, "parentId": … } ],
//     "files":   [ { "id": …, "title": "Pallof Press.mp4", "parentId": …, "mod": "2026-11-10", "size": 12424485 } ] }
// "size" is optional but worth having: get_file_metadata returns it as fileSize, and it is the only way to catch a
// zero-byte clip or one too big for the API before a run spends an hour finding out.
// --api takes the body of GET /api/videos, so the report can tell "published" from "waiting on Bunny".
// --confirm takes the owner's decisions:
//   [ { "id": "<drive id>", "name": "Pallof Press", "region": "Core", "cat": "Activation",
//       "level": 2, "loc": "any", "seated": false } ]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CATALOG = path.join(ROOT, "app", "exercises.js");
const FOLDERS = path.join(ROOT, "data", "drive-folders.json");       // folder ids, which never change
const PLACEMENTS = path.join(ROOT, "data", "video-placements.json"); // decisions already taken

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf("--" + name); return i === -1 ? null : argv[i + 1]; };
const has = (name) => argv.includes("--" + name);
const drivePath = flag("drive");
if (!drivePath) {
  console.error("usage: node scripts/video-intake.js --drive <listing.json> [--api <videos.json>] [--confirm <decisions.json> --write]");
  process.exit(2);
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// ---------------------------------------------------------------- the catalog, and the codes it already uses
// Region and category codes are not invented here: they are read back out of the catalog, so a new entry can only use
// a region and a category the app already knows how to file.
function loadCatalog() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CATALOG, "utf8"), sandbox);
  const ex = sandbox.window.MDFIT_EXERCISES;
  if (!Array.isArray(ex)) throw new Error("app/exercises.js did not define window.MDFIT_EXERCISES");
  const rc = {}, cc = {};
  for (const e of ex) { if (e.region) rc[e.region] = e.rc; if (e.cat) cc[e.cat] = e.cc; }
  return { ex, rc, cc, intros: sandbox.window.MDFIT_INTROS || {} };
}

// ---------------------------------------------------------------- the Drive tree
// Folder numbers are the organization, and they carry the usage. "5 New Footage - Needs Names" is the inbox; 7, 8, 9
// and 99 are deliberately not published. Anything whose bucket we cannot read is reported, never assumed.
const BUCKETS = {
  1: { usage: "exercise-library", publish: true, note: "library exercise — region is the next folder down" },
  2: { usage: "pain-track", publish: true, note: "pain-tool track — needs the track and level it belongs to" },
  3: { usage: "program", publish: true, note: "program block — usually an existing library movement, filmed again" },
  4: { usage: "intro-or-lecture", publish: true, note: "intro, testimonial or lecture — not a library exercise" },
  5: { usage: "needs-name", publish: false, note: "inbox: nothing here can be placed until it is named" },
  6: { usage: "protocol", publish: true, note: "protocol week — usually an existing library movement" },
  7: { usage: "full-session", publish: false, note: "long-form session recording, not a library clip" },
  8: { usage: "reference-image", publish: false, note: "reference and design files" },
  9: { usage: "unused", publish: false, note: "empty folders kept for reference" },
  99: { usage: "duplicate", publish: false, note: "duplicates — never published" }
};
const RAW_NAME = /^\d{8}_\d{6}$/;              // straight off the camera: 20261111_132836
const TAKE = /\((?:take|t)\s*\d+\)\s*$/i;      // "Pallof Press (take 2)"
// The API downloads each file to disk before it goes up, and refuses anything over MEDIA_MAX_MB (500 by default).
// A file over that never uploads however many runs it is given, and a zero-byte file uploads "fine" and is useless.
const MAX_MB = Number(flag("max-mb")) || 500;

function tree(listing) {
  // A listing need only carry the files. Folder ids never change on rename or move, so the map is a committed
  // fixture: a run searches Drive for videos and takes the folder names from here.
  const known = (listing.folders && listing.folders.length) ? listing.folders
    : fs.existsSync(FOLDERS) ? readJson(FOLDERS).folders : [];
  const folders = new Map(known.map((f) => [f.id, f]));
  const pathOf = (file) => {
    const out = [];
    let p = file.parentId, guard = 0;
    while (p && folders.has(p) && guard++ < 24) { out.unshift(folders.get(p).title); p = folders.get(p).parentId; }
    return out;
  };
  const bucketOf = (segs) => {
    for (const s of segs) {
      const m = /^(\d{1,2})\s+(.*)$/.exec(s);
      if (m && BUCKETS[Number(m[1])]) return { n: Number(m[1]), label: s, ...BUCKETS[Number(m[1])] };
    }
    return null;
  };
  return { pathOf, bucketOf };
}

// ---------------------------------------------------------------- the report
function classify(listing, cat, api) {
  const { pathOf, bucketOf } = tree(listing);
  const inCatalog = new Set(cat.ex.map((e) => e.id));
  const published = new Set(api && api.bunny && api.bunny.map ? Object.keys(api.bunny.map) : []);
  const manifest = readJson(path.join(ROOT, "data", "media-manifest.json"));
  const inManifest = new Set(manifest.assets.map((a) => a.drive_id).filter(Boolean));

  // A movement filmed again for a program or a track usually has a library entry already, under its own Drive id.
  // Publishing the new file would give the app two videos for one movement, so the report says so and lets the owner
  // decide: a second entry, a replacement, or nothing at all.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // "Standing Hip Abduction/Adduction" in the catalog and "Standing Hip Abduction and Adduction" in Drive are one
  // movement, and an exact comparison calls the second one new. So compare a looser key too, with the joining words
  // dropped. Only joiners: "with", "to" and "drop" change which movement it is ("Eccentric Toe Reach" is not
  // "Eccentric Toe Reach With Rotation"), so they stay. A loose hit is reported as a likeness to confirm, never as
  // a settled fact.
  const loose = (s) => norm(s).split(" ").filter((w) => w !== "and" && w !== "the" && w !== "a").join(" ");
  const byName = new Map(), byLoose = new Map();
  for (const e of cat.ex) {
    if (!byName.has(norm(e.name))) byName.set(norm(e.name), e);
    if (!byLoose.has(loose(e.name))) byLoose.set(loose(e.name), e);
  }

  // Decisions already taken are not open work. Without this ledger every run re-asks about the same clips, and the
  // owner answers the same question for ever.
  const settledBy = new Map();
  if (fs.existsSync(PLACEMENTS)) for (const s of readJson(PLACEMENTS).settled || []) settledBy.set(s.id, s);

  const rows = [];
  const seen = new Set();
  for (const f of listing.files || []) {
    if (seen.has(f.id)) continue;            // Drive paging can hand the same file back twice
    seen.add(f.id);
    const segs = pathOf(f);
    const bucket = bucketOf(segs);
    const base = String(f.title || "").replace(/\.[a-z0-9]+$/i, "");
    const mb = f.size == null ? null : Number(f.size) / 1048576;
    const blocked = mb === 0 ? "zero bytes in Drive"
      : mb != null && mb > MAX_MB ? `${mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : Math.round(mb) + " MB"} — over the ${MAX_MB} MB the API accepts`
      : RAW_NAME.test(base) ? "unnamed camera file"
      : TAKE.test(base) ? "an alternate take" : null;
    const name = base.replace(TAKE, "").trim();
    const exact = byName.get(norm(name)) || null;
    const already = exact || byLoose.get(loose(name)) || null;
    const near = !!already && !exact;
    rows.push({
      id: f.id, title: f.title, name, mod: f.mod || "",
      segs, bucket, blocked, settled: settledBy.get(f.id) || null,
      already: already ? { id: already.id, name: already.name, region: already.region, cat: already.cat, level: already.level, near } : null,
      region: bucket && bucket.n === 1 && cat.rc[segs[segs.indexOf(bucket.label) + 1]] ? segs[segs.indexOf(bucket.label) + 1] : null,
      state: published.has(f.id) ? "published" : inManifest.has(f.id) ? "awaiting-bunny" : inCatalog.has(f.id) ? "in-catalog" : "unplaced"
    });
  }
  return rows;
}

function report(rows) {
  const count = (fn) => rows.filter(fn).length;
  const L = (s) => console.log(s);
  L("");
  L(`Drive videos seen: ${rows.length}`);
  L(`  published on Bunny:        ${count((r) => r.state === "published")}`);
  L(`  in the manifest, encoding: ${count((r) => r.state === "awaiting-bunny")}`);
  L(`  unplaced:                  ${count((r) => r.state === "unplaced")}`);

  // A clip in the manifest that Bunny has not published is usually just encoding. If it is also too big or empty, it
  // is not encoding and never will be, and a run that waits for it waits for ever.
  const waiting = rows.filter((r) => r.state === "awaiting-bunny");
  if (waiting.length) {
    L("");
    L(`In the manifest, not yet published by Bunny (${waiting.length}):`);
    for (const r of waiting) L(`        ${r.name}${r.blocked ? `  — ${r.blocked}: this one will never upload as it stands` : "  — encoding, or waiting on a retry"}`);
  }

  const unplaced = rows.filter((r) => r.state === "unplaced");
  const skip = unplaced.filter((r) => r.bucket && !r.bucket.publish);
  const done = unplaced.filter((r) => r.settled && r.bucket && r.bucket.publish);
  const noName = unplaced.filter((r) => !r.settled && r.bucket && r.bucket.publish && r.blocked);
  const noBucket = unplaced.filter((r) => !r.settled && !r.bucket);
  const cand = unplaced.filter((r) => !r.settled && r.bucket && r.bucket.publish && !r.blocked);

  if (done.length) {
    const by = {};
    for (const r of done) (by[r.settled.decision] = by[r.settled.decision] || []).push(r);
    L("");
    L(`Already decided, so not open work (${done.length}) — from data/video-placements.json:`);
    for (const [k, v] of Object.entries(by)) L(`  ${String(v.length).padStart(4)}  ${k}`);
  }

  if (skip.length) {
    L("");
    L(`Not for publishing (${skip.length}) — by folder, so you can see nothing is being quietly dropped:`);
    const by = {};
    for (const r of skip) (by[r.bucket.label] = by[r.bucket.label] || []).push(r);
    for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
      L(`  ${String(v.length).padStart(4)}  ${k}  (${BUCKETS[/^(\d{1,2})/.exec(k)[1]].note})`);
  }
  if (noName.length) {
    L("");
    L(`Cannot be proposed until renamed in Drive (${noName.length}):`);
    for (const r of noName.slice(0, 40)) L(`        ${r.title}  — ${r.blocked}  [${r.segs.slice(-2).join("/")}]`);
    if (noName.length > 40) L(`        … and ${noName.length - 40} more`);
  }
  if (noBucket.length) {
    L("");
    L(`Outside the numbered folders, so the usage is unknown (${noBucket.length}):`);
    for (const r of noBucket.slice(0, 20)) L(`        ${r.title}  [${r.segs.join("/") || "no folder"}]`);
    if (noBucket.length > 20) L(`        … and ${noBucket.length - 20} more`);
  }
  if (cand.length) {
    const dup = cand.filter((r) => r.already), fresh = cand.filter((r) => !r.already);
    // The same movement filmed for three different tracks is three Drive files and one movement. Count the distinct
    // names too, or "13 new" reads as thirteen things to film a decision for when it is ten.
    const nm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const distinct = new Set(fresh.map((r) => nm(r.name)));
    const twice = new Map();
    for (const r of cand) twice.set(nm(r.name), (twice.get(nm(r.name)) || 0) + 1);
    L("");
    L(`Waiting on a decision from you (${cand.length}) — grouped by Drive folder.`);
    L(`  ${fresh.length} are new to the library (${distinct.size} distinct name${distinct.size === 1 ? "" : "s"}); ${dup.length} share a name with an entry it already has.`);
    const by = {};
    for (const r of cand) (by[r.segs.join(" / ")] = by[r.segs.join(" / ")] || []).push(r);
    for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
      L(`  ${k}   [${v[0].bucket.usage}]`);
      for (const r of v) L(`      ${r.already ? "~" : "+"} ${r.name}${r.region ? "  (region: " + r.region + ")" : ""}   ${r.id}` +
        (r.already ? `\n          ${r.already.near ? `looks like the library's "${r.already.name}"` : "already in the library"} as ${r.already.region} / ${r.already.cat} / level ${r.already.level}  (${r.already.id})${r.already.near ? " — confirm before treating this file as new" : ""}` : "") +
        (twice.get(nm(r.name)) > 1 ? `\n          this name is on ${twice.get(nm(r.name))} of the files below — one movement, filmed for more than one place` : ""));
    }
    L("");
    L("  +  the library has no entry under this name");
    L("  ~  the library already plays a video for this name, so this file is a second take of it: it needs a decision");
    L("     (leave it in Drive, add it as a separate entry, or replace the entry's id) before anything is published.");
    L("");
    L("None of these is placed until you say so. Confirm with a decisions file:");
    L('  [{"id":"<drive id>","name":"…","region":"Core","cat":"Activation","level":2,"loc":"any","seated":false}]');
    L("  node scripts/video-intake.js --drive drive.json --confirm ok.json --write");
  }
  L("");
  return { cand, skip, noName, noBucket };
}

// ---------------------------------------------------------------- writing confirmed entries
// Every field must be present and must already be in use elsewhere in the catalog. A decision that is short of
// anything is refused by name — a half-filled row is not a confirmation.
const LOCS = ["any", "gym", "home", "outdoor"];

function applyDecisions(decisions, cat, rows, write) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const have = new Set(cat.ex.map((e) => e.id));
  const problems = [];
  const entries = [];
  for (const d of decisions) {
    const where = d.id || d.name || "(an entry with no id)";
    if (!d.id) { problems.push(`${where}: no Drive id`); continue; }
    if (have.has(d.id)) { problems.push(`${where}: already in the catalog`); continue; }
    if (!byId.has(d.id)) { problems.push(`${where}: not in the Drive listing`); continue; }
    if (!d.name || !String(d.name).trim()) { problems.push(`${where}: no name`); continue; }
    if (!cat.rc[d.region]) { problems.push(`${where}: region "${d.region}" is not one the app files (${Object.keys(cat.rc).join(", ")})`); continue; }
    if (!cat.cc[d.cat]) { problems.push(`${where}: category "${d.cat}" is not one the app files (${Object.keys(cat.cc).join(", ")})`); continue; }
    if (!Number.isInteger(d.level) || d.level < 1 || d.level > 9) { problems.push(`${where}: level must be a whole number 1-9`); continue; }
    if (!LOCS.includes(d.loc)) { problems.push(`${where}: loc must be one of ${LOCS.join(", ")}`); continue; }
    if (typeof d.seated !== "boolean") { problems.push(`${where}: seated must be true or false`); continue; }
    entries.push({ id: d.id, name: String(d.name).trim(), region: d.region, rc: cat.rc[d.region], cat: d.cat, cc: cat.cc[d.cat], level: d.level, loc: d.loc, seated: d.seated });
  }
  if (problems.length) {
    console.error(`\n${problems.length} decision(s) are not complete, so nothing was written:`);
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  if (!entries.length) { console.log("No new entries in the decisions file."); return; }

  // Keep the catalog's order: regions in the order they already appear, each new entry at the end of its region.
  const order = [];
  for (const e of cat.ex) if (!order.includes(e.region)) order.push(e.region);
  const out = [];
  const pending = entries.slice();
  for (const region of order) {
    for (const e of cat.ex) if (e.region === region) out.push(e);
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].region === region) out.push(...pending.splice(i, 1));
  }
  out.push(...pending);   // a region the catalog has never used goes last

  console.log(`\n${entries.length} confirmed entr${entries.length === 1 ? "y" : "ies"}:`);
  for (const e of entries) console.log(`  + ${e.name}  ${e.region} / ${e.cat} / level ${e.level} / ${e.loc}${e.seated ? " / seated" : ""}  ${e.id}`);
  if (!write) { console.log("\n(dry run — pass --write to put these in app/exercises.js)"); return; }

  const src = fs.readFileSync(CATALOG, "utf8");
  const line = "window.MDFIT_EXERCISES = " + JSON.stringify(out) + ";";
  const next = src.replace(/window\.MDFIT_EXERCISES\s*=\s*\[[\s\S]*?\];/, line);
  if (next === src) throw new Error("could not find the window.MDFIT_EXERCISES assignment to replace");
  fs.writeFileSync(CATALOG, next);
  console.log(`\napp/exercises.js: ${cat.ex.length} -> ${out.length} entries`);
  console.log("Next, in order:");
  console.log("  node scripts/build-media-manifest.js     # puts them in data/media-manifest.json");
  console.log("  node scripts/version-assets.js           # app/exercises.js changed");
  console.log("Then commit, open the pull request, and confirm the deploy. Bunny picks them up within 6 hours of");
  console.log("the manifest going live (or at once with \"sync now\" in the workspace), and each guid is published");
  console.log("only after Bunny has a 720p MP4.");
}

// ---------------------------------------------------------------- run
const listing = readJson(drivePath);
const cat = loadCatalog();
const api = flag("api") ? readJson(flag("api")) : null;
const rows = classify(listing, cat, api);
const confirmPath = flag("confirm");
if (confirmPath) {
  report(rows);
  applyDecisions(readJson(confirmPath), cat, rows, has("write"));
} else {
  report(rows);
  if (flag("json")) { fs.writeFileSync(flag("json"), JSON.stringify(rows, null, 1)); console.log(`(full rows written to ${flag("json")})`); }
}
