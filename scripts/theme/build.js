// Writes /app-theme.css: the member app's black theme and compact layout.
//
// Most of that file is a copy, made here, of the colour (gen.js) and spacing (gen-compact.js) declarations in the three
// stylesheets the app loads: app/app.css, account.css and guides.css. So after changing any of those three, run
//   node scripts/theme/build.js
// and then node scripts/version-assets.js, or the black theme and compact layout drift from the white one.
// The hand-written parts are in scripts/theme/parts/. Do not edit app-theme.css by hand.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const here = __dirname, part = (f) => fs.readFileSync(path.join(here, "parts", f), "utf8"), run = (f) => execFileSync(process.execPath, [path.join(here, f)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const css = part("00-head.css") + run("gen.js") + part("20-manual.css") + part("30-compact.css") + run("gen-compact.js") + part("40-compact-manual.css");
const out = path.join(here, "..", "..", "app-theme.css");
const same = fs.existsSync(out) && fs.readFileSync(out, "utf8") === css;
if (!same) fs.writeFileSync(out, css);
console.log(`app-theme.css ${same ? "is up to date" : "written"} (${css.length} bytes)`);
