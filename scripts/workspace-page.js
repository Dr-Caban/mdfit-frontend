#!/usr/bin/env node
// Builds workspace.html from admin.html: the same markup and the same scripts (so every admin endpoint works
// exactly as it does on /admin), with the workspace skin (workspace.css) layered on top.
//
// Run after editing admin.html, then run scripts/version-assets.js:
//   node scripts/workspace-page.js
//   node scripts/workspace-page.js --check    exits 1 if workspace.html is out of date (for CI)
//
// workspace.html is generated. Do not edit it by hand; change admin.html, workspace.css or this script.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "admin.html"), "utf8");

const swap = (s, from, to) => {
  if (!s.includes(from)) { console.error(`workspace-page: admin.html no longer contains: ${from}`); process.exit(1); }
  return s.replace(from, to);
};
// Version stamps (?v=...) are added back by scripts/version-assets.js; strip them so --check compares like with like.
const bare = (s) => s.replace(/\?v=[0-9a-f]+/g, "");

let out = src;
out = swap(out, "<title>MD Fit Admin</title>", "<title>MD Fit Workspace</title>");
out = swap(out, '<body class="admin">', '<body class="admin ws">');
out = swap(out, "<h1>Admin</h1>", "<h1>Workspace</h1>");
out = swap(out, '<span class="brand-sub">Admin</span>', '<span class="brand-sub">Workspace</span>');
out = out.replace(/(<link rel="stylesheet" href="admin\.css[^"]*">)/, '$1\n  <link rel="stylesheet" href="workspace.css">');
if (!out.includes('href="workspace.css"')) { console.error("workspace-page: could not place the workspace stylesheet"); process.exit(1); }
out = out.replace(/<head>/, "<head>\n  <!-- Generated from admin.html by scripts/workspace-page.js. Do not edit by hand. -->");

const file = path.join(root, "workspace.html");
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (bare(cur) !== bare(out)) { console.error("workspace.html is out of date: run node scripts/workspace-page.js"); process.exit(1); }
  console.log("workspace page: up to date");
} else {
  fs.writeFileSync(file, out);
  console.log("workspace page: written from admin.html");
}
