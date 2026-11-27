#!/usr/bin/env node
// Writes docs/LIBRARY-STATUS.txt: every movement in the library and whether it actually plays.
//
//   node scripts/library-status.js            # against the live API
//   node scripts/library-status.js api.json   # against a saved GET /api/videos body
//
// "Plays" means the movement's Drive id is in bunny.map — the backend only publishes a guid once
// Bunny confirms a 720p MP4, so presence in that map is the one trustworthy answer. A movement in
// app/exercises.js that is absent from the map is in the catalog but not yet watchable.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "LIBRARY-STATUS.txt");
const API = "https://www.mymdfit.com/api/videos";

async function published(arg) {
  if (arg) return JSON.parse(fs.readFileSync(arg, "utf8"));
  // the edge refuses curl-ish agents, so ask as a browser would
  const r = await fetch(API, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" } });
  if (!r.ok) throw new Error(`GET /api/videos -> HTTP ${r.status}`);
  return r.json();
}

(async () => {
  const api = await published(process.argv[2]);
  const onBunny = new Set(Object.keys((api.bunny && api.bunny.map) || {}));
  if (!onBunny.size) throw new Error("the published map came back empty — refusing to write a report saying nothing plays");

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "app", "exercises.js"), "utf8"), sandbox);
  const EX = sandbox.window.MDFIT_EXERCISES;

  const plays = EX.filter((e) => onBunny.has(e.id));
  const rows = EX.map((e) => `${onBunny.has(e.id) ? "video" : "NO   "}  ${e.region.padEnd(14)} ${e.cat.padEnd(14)} L${e.level}  ${e.name}`).sort();

  const body = [
    "MD Fit exercise library — every movement and whether it plays",
    `Generated ${new Date().toISOString().slice(0, 10)} by scripts/library-status.js`,
    "from app/exercises.js against GET /api/videos (bunny.map).",
    "",
    `${EX.length} movements, ${plays.length} playable, ${EX.length - plays.length} not yet.`,
    "",
    ...(EX.length - plays.length ? ["Not yet playable:", ...EX.filter((e) => !onBunny.has(e.id)).map((e) => `  ${e.name} (${e.region} / ${e.cat})`), ""] : []),
    ...rows
  ].join("\n") + "\n";

  fs.writeFileSync(OUT, body);
  console.log(`docs/LIBRARY-STATUS.txt: ${EX.length} movements, ${plays.length} playable`);
})().catch((e) => { console.error(e.message); process.exit(1); });
