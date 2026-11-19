#!/usr/bin/env node
// Records the spoken lines of the first-open tour (account-tour.js) with an ElevenLabs voice, one small file per beat,
// into assets/tour/NN.mp3. Run it again whenever a line in the tour changes; only changed or missing lines are made
// unless --all is given (the text each file was made from is kept beside it, in assets/tour/lines.json).
//
//   ELEVENLABS_API_KEY=... node scripts/tour-voice.js <voice id> [--all]
//
// The key is read from the environment and never written anywhere. The voice must be one the practice has the right
// to use (the tour's voice is a clone of Dr. Jared's own, made with his agreement).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, ".."), out = path.join(root, "assets", "tour");
const [voice, flag] = process.argv.slice(2), key = process.env.ELEVENLABS_API_KEY;
if (!voice || !/^[A-Za-z0-9]{10,40}$/.test(voice)) { console.error("usage: ELEVENLABS_API_KEY=... node scripts/tour-voice.js <voice id> [--all]"); process.exit(1); }
if (!key) { console.error("ELEVENLABS_API_KEY is not set."); process.exit(1); }

// The lines come from the tour itself, so the voice can never say something the bubble does not
const win = {}; vm.runInNewContext(fs.readFileSync(path.join(root, "account-tour.js"), "utf8"), { window: win, document: { querySelector: () => null, querySelectorAll: () => [] }, console });
const lines = win.MDFitTour.script(); // every beat, and every other moment the tour speaks
fs.mkdirSync(out, { recursive: true });
const book = path.join(out, "lines.json"); let made = {}; try { made = JSON.parse(fs.readFileSync(book, "utf8")); } catch {}
const mark = require("crypto").createHash("sha256").update(voice).digest("hex").slice(0, 10); // which voice the files were made with, without naming it in a served file
if (made.voice !== mark) made = { voice: mark, lines: {} };

(async () => {
  let n = 0;
  for (const l of lines) {
    const file = path.join(out, l.id + ".mp3");
    if (flag !== "--all" && made.lines[l.id] === l.text && fs.existsSync(file)) continue;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_96`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: l.text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }) });
    if (!res.ok) { console.error(`${l.id}: ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); made.lines[l.id] = l.text; n++;
    console.log(`${l.id}.mp3  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  "${l.text}"`);
  }
  for (const id of Object.keys(made.lines)) if (!lines.some((l) => l.id === id)) { delete made.lines[id]; try { fs.unlinkSync(path.join(out, id + ".mp3")); } catch {} }
  fs.writeFileSync(book, JSON.stringify(made, null, 1) + "\n");
  console.log(`${n} line${n === 1 ? "" : "s"} recorded, ${lines.length} in the tour.`);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
