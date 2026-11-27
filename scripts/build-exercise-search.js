#!/usr/bin/env node
// Adds every library movement to data/search-index.json, so site search finds it as well as the library tab does.
//
//   node scripts/build-exercise-search.js
//
// Why this exists: scripts/seo/build.js refreshes the index for the pages it generates and nothing refreshed the
// exercise entries, so a movement added after the index was last built (63 of 222 on 27 Nov 2026, "Scalene Stretch"
// among them) could be played but never searched for. This only ADDS entries that are missing, plus the ones in
// EXTRA below, whose extra words are how a member (or a program) refers to the same clip by another name.
// Entries are built the way the existing ones are: title x3, keywords x2, expanded through the index's synonyms.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const F = path.join(ROOT, "data", "search-index.json");

// Other names for a clip that already has an entry. Keyed by Drive id.
const EXTRA = {
  // The shoulder program and pain tracks call the clip filed as "Eccentric Scalene Drop" this (it says "the eccentric dumbbell drop").
  "1mLoiufsNDNa-4V4c-6f0DP6b9DBbE3_B": ["Eccentric Dumbbell Shrug Drop", "dumbbell shrug drop", "shrug drop", "shoulder drop"],
  // The program's weeks 5 and 6 step: tilt, rotate, tuck.
  "1Asjbv7VTBS7h4GhOEoDXqM1UnxprIDpR": ["Scalene Stretch Three Part", "three part", "tilt rotate tuck", "shoulder program"]
};

const sb = { window: {} };
vm.createContext(sb);
for (const f of ["app/exercises.js", "app/library.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb);
const EX = sb.window.MDFIT_EXERCISES, LIB = sb.window.MDFitLib;

const idx = JSON.parse(fs.readFileSync(F, "utf8"));
const syn = {};
for (const [k, vs] of Object.entries(idx.synonyms)) { syn[k] = [k, ...vs]; for (const v of vs) syn[v] = syn[v] || [k, ...vs]; }
const stop = new Set(idx.stopwords);
const tok = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter((t) => !stop.has(t));

const item = (e) => {
  const kw = [e.region, e.cat, LIB.kind(e), LIB.category(e), LIB.joint(e), LIB.muscle(e), ...(EXTRA[e.id] || [])];
  const tf = {}, add = (t, w) => { for (const x of syn[t] || [t]) tf[x] = (tf[x] || 0) + w; };
  tok(e.name).forEach((t) => add(t, 3));
  kw.flatMap(tok).forEach((t) => add(t, 2));
  return { id: `ex:${e.id}`, kind: "exercise", title: e.name, url: "/account#videos", snippet: `${e.cat} · ${e.region} · Level ${e.level}`,
    kw, tf, len: Object.values(tf).reduce((a, b) => a + b, 0), boost: 1 };
};

const have = new Set(idx.items.map((i) => i.id));
const redo = new Set(Object.keys(EXTRA).map((id) => `ex:${id}`));
const fresh = EX.filter((e) => e.id && (!have.has(`ex:${e.id}`) || redo.has(`ex:${e.id}`)));
const items = [...idx.items.filter((i) => !fresh.some((e) => i.id === `ex:${e.id}`)), ...fresh.map(item)];

const df = {};
for (const it of items) for (const t of Object.keys(it.tf)) df[t] = (df[t] || 0) + 1;
const out = { ...idx, version: new Date().toISOString().slice(0, 10), docs: items.length, avgLen: items.reduce((a, i) => a + i.len, 0) / items.length, df, items };
fs.writeFileSync(F, JSON.stringify(out));
console.log(`search index: ${fresh.length} exercise entries added or refreshed, ${items.length} documents in all`);
