#!/usr/bin/env node
// Bakes the Blob image map into common.js from data/blob-images.json.
//
//   node scripts/build-blob-images.js
//
// Why baked and not fetched: MDFitVideo.thumb() is synchronous and pain patterns draw on first paint. A map that
// arrived over the network would show a slow Drive thumbnail first and swap it — a flicker on a clinical page.
//
// Only the `drive` half goes in. thumb() is only ever called with a Drive id; the `site` half is recorded in the
// JSON for completeness, but those files are served straight from /assets by the pages themselves.
//
// After running this, run `node scripts/version-assets.js` — common.js has changed.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data", "blob-images.json");
const TARGET = path.join(ROOT, "common.js");
const START = "  // BLOB_IMG_START";
const END = "  // BLOB_IMG_END";

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const drive = data.drive || {};
const ids = Object.keys(drive).sort();
if (!ids.length) throw new Error("data/blob-images.json has no drive entries — refusing to bake an empty map");

for (const id of ids) {
  const url = drive[id];
  if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(url))
    throw new Error(`not a public Blob URL, refusing: ${id} -> ${url}`);
}

const body = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(drive[id])}`).join(",\n");
const block = `${START}\n  const BLOB_IMG = {\n${body}\n  };\n${END}`;

const src = fs.readFileSync(TARGET, "utf8");
const a = src.indexOf(START), b = src.indexOf(END);
if (a === -1 || b === -1) throw new Error("markers BLOB_IMG_START / BLOB_IMG_END not found in common.js");
const next = src.slice(0, a) + block + src.slice(b + END.length);
if (next === src) { console.log("blob images: already up to date"); process.exit(0); }
fs.writeFileSync(TARGET, next);
console.log(`blob images: ${ids.length} baked into common.js from ${path.relative(ROOT, DATA)}`);
console.log("now run: node scripts/version-assets.js");
