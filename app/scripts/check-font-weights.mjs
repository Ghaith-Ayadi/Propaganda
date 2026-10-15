// Nothing in Propaganda is heavier than 600 (Ayadi, 2026-10-15). Fails on a
// font weight above 600 in the app's source: Tailwind font-bold/extrabold/black,
// `font-weight: 700+` or `bold`, `fontWeight`/`weight`/`strong` set to 700+, and
// Google/Fontshare font loads that ask for 700+.
//
//   node scripts/check-font-weights.mjs        (from app/, or `npm run check:weights`)
//
// A line may opt out with `weights-ok` in a comment (a font file that merely
// contains heavier masters, say).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exts = new Set([".ts", ".tsx", ".css", ".html", ".js", ".cjs", ".mjs"]);
const skip = new Set(["node_modules", "dist", "dist-harness", "dev-dist"]);

const rules = [
  [/\bfont-(bold|extrabold|black)\b/, "Tailwind heavy font weight"],
  [/font-weight\s*:\s*(bold|bolder|6[1-9]\d|[7-9]\d\d|1000)\b/i, "CSS font-weight above 600"],
  // `font-weight: 400 900` and `weight: "100 900"` ranges in @font-face / theme data.
  [/font-weight\s*:\s*\d+\s+(6[1-9]\d|[7-9]\d\d|1000)\b/i, "font-face weight range above 600"],
  [/\bfontWeight\s*[:=]\s*[{"']?\s*(bold|bolder|6[1-9]\d|[7-9]\d\d|1000)\b/, "fontWeight above 600"],
  [/\b(weight|strong)\s*:\s*(6[1-9]\d|[7-9]\d\d|1000)\b/, "theme weight above 600"],
  [/--[\w-]*weight[\w-]*\s*:\s*(6[1-9]\d|[7-9]\d\d|1000)\b/, "weight variable above 600"],
  [/wght@[^"'\s)]*?([7-9]00)\b/, "font load asks for 700+"],
  [/\.\.([7-9]00)\b/, "variable font load goes to 700+"],
  [/zodiak@[^"'\s&]*\b[7-9]00\b/i, "Fontshare load asks for 700+"],
];

const found = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (exts.has(name.slice(name.lastIndexOf(".")))) scan(path);
  }
}
function scan(path) {
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    if (line.includes("weights-ok")) return;
    for (const [re, why] of rules) {
      if (re.test(line)) {
        found.push(`${relative(root, path)}:${i + 1}  ${why}\n    ${line.trim().slice(0, 160)}`);
        break;
      }
    }
  });
}

for (const d of ["src", "public", "index.html"]) {
  const p = join(root, d);
  try {
    statSync(p).isDirectory() ? walk(p) : scan(p);
  } catch {}
}

if (found.length) {
  console.error(`Font weight above 600 (the cap is 600, no exceptions):\n\n${found.join("\n")}\n`);
  process.exit(1);
}
console.log("No font weight above 600.");
