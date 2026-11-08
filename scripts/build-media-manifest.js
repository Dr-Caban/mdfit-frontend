#!/usr/bin/env node
// Rebuilds data/media-manifest.json, the list the API's Cloudinary sync copies from (backend lib/videos.js).
// The exercise-library section is generated from app/exercises.js + app/library.js so a video added to the library
// is copied to Cloudinary at the next sync (within 6 hours, or Admin → Copy to Cloudinary). Every other section
// (pain tracks, lectures, intros, images) is kept exactly as it is in the current file.
//   node scripts/build-media-manifest.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "media-manifest.json");

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ["app/exercises.js", "app/library.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox);
const EX = sandbox.window.MDFIT_EXERCISES, LIB = sandbox.window.MDFitLib;
if (!Array.isArray(EX) || !LIB) throw new Error("app/exercises.js or app/library.js did not load");

const slug = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
const LOC = { any: "Anywhere", gym: "Gym", home: "Home", outdoor: "Outdoor" };

const cur = JSON.parse(fs.readFileSync(OUT, "utf8"));
const keep = cur.assets.filter((a) => a.purpose !== "exercise-library");
// A video already in the manifest keeps its entry exactly (its Cloudinary path must not move, and some carry extra
// pain-track tags); only videos new to the library get a generated entry.
const have = new Map(cur.assets.filter((a) => a.purpose === "exercise-library").map((a) => [a.key, a]));
const seg = (s) => String(s).replace(/\s*&\s*/g, "-and-").replace(/\s+/g, "-");
let added = 0;
const lib = EX.map((e) => {
  if (have.has(e.id)) return have.get(e.id);
  added++;
  const kind = LIB.kind(e), category = LIB.category(e), joint = LIB.joint(e), muscle = LIB.muscle(e), loc = LOC[e.loc] || "Anywhere";
  const folder = `mdfit/videos/exercise-library/${seg(kind)}/${seg(e.region)}/${seg(e.cat)}`;
  return {
    key: e.id, source: "drive", drive_id: e.id, type: "video", purpose: "exercise-library",
    public_id: `${folder}/${slug(e.name)}`, display_name: e.name,
    tags: ["mdfit", "type:video", "purpose:exercise-library", `kind:${slug(kind)}`, `region:${slug(e.region)}`, `category:${slug(e.cat)}`,
      `library-category:${slug(category)}`, `level:${e.level}`, `location:${slug(loc)}`, `joint:${slug(joint)}`, `muscle:${slug(muscle)}`, ...(e.seated ? ["seated"] : [])],
    context: { name: e.name, purpose: "Exercise library", kind, region: e.region, category: e.cat, library_category: category, level: String(e.level),
      location: loc, joint, muscle, seated: e.seated ? "yes" : "no", drive_id: e.id },
    folder
  };
});
// Same order as before: library videos first (in library order), then everything else as it was
const assets = [...lib, ...keep];
const version = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, JSON.stringify({ version, count: assets.length, assets }));
console.log(`media manifest: ${lib.length} library videos (${added} new) + ${keep.length} other assets = ${assets.length} (version ${version})`);
