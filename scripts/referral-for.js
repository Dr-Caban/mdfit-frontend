#!/usr/bin/env node
// A copy of the partner proposal (referral.html) prepared for one partner, as one self-contained file: the partner's
// name and the account holder's first name are built in, and the logo and fonts are inside the file, so the copy plays
// the same from the site, from a download, or with no connection.
//
//   node scripts/referral-for.js "Orangetheory Fitness" "Emily" referral-emily.html
//
// Never edit the copy by hand: change referral.html and run this again.
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const [partner, contact, out] = process.argv.slice(2);
if (!partner || !out || !/^referral-[a-z0-9-]+\.html$/.test(out)) { console.error('usage: node scripts/referral-for.js "Partner name" "First name" referral-<name>.html'); process.exit(1); }

let html = fs.readFileSync(path.join(root, "referral.html"), "utf8");
const TYPES = { ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
const inline = (file) => `data:${TYPES[path.extname(file)]};base64,${fs.readFileSync(path.join(root, file)).toString("base64")}`;
// every asset the page points at goes inside the file
html = html.replace(/(src|href)="(assets\/[^"]+)"/g, (_, attr, file) => `${attr}="${inline(file)}"`).replace(/url\("(assets\/[^"]+)"\)/g, (_, file) => `url("${inline(file)}")`);
if (/["(]assets\//.test(html)) { console.error("an asset was left outside the file"); process.exit(1); }
const who = JSON.stringify({ partner, contact: contact || "" }).replace(/</g, "\\u003c");
const mark = "<script>\n(() => {";
if (html.split(mark).length !== 2) { console.error("referral.html: the page script was not found where expected"); process.exit(1); }
html = html.replace(mark, `<script>window.MDFIT_PROPOSAL = ${who};</script>\n${mark}`)
  .replace("<!DOCTYPE html>", `<!DOCTYPE html>\n<!-- Made by scripts/referral-for.js from referral.html. Do not edit: change referral.html and run it again. -->`);
fs.writeFileSync(path.join(root, out), html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB, prepared for ${partner}${contact ? " (" + contact + ")" : ""}`);
