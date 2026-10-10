// Which real-model tests a release has to run: the areas whose code changed since
// the last release.
//
//   node test/live/affected.mjs [--since <tag>] [--all]       (from worker/)
//
// An area's code is every file its entry points load, read from esbuild's own
// import graph (not guessed from folders), plus the files that code reads at run
// time (`new URL("./x", import.meta.url)`), the area's test, the shared test kit
// and the worker's dependencies and build. An area is untouched when none of those
// changed since the tag.
//
// Git can't see a provider changing a model under the same name, the model a box
// is configured with, or settings in the database. So everything runs when there
// is no earlier release, on the first release of a calendar month, and on --all.
//
// Prints a summary; with GITHUB_OUTPUT set, writes `tests` (JSON list of test
// files) and `plan` (one line per area) there.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ROOT = resolve(WORKER, "..");

/** Every agent area. `test: null` is an area with no real-model test yet: reported, never run. */
export const AREAS = [
  { name: "strategist", entries: ["worker/src/workflows/strategist.ts"], test: "worker/test/live/strategist.mjs" },
  { name: "pitch-write", entries: ["worker/src/agents/pitcher.ts", "worker/src/agents/writer.ts", "worker/src/agents/voice.ts"], test: "worker/test/live/pitch-write.mjs" },
  { name: "listener", entries: ["worker/src/workflows/listener.ts"], test: null },
  { name: "kb", entries: ["worker/src/agents/checker.ts", "worker/src/agents/guardian.ts"], test: null },
  { name: "scout", entries: ["worker/src/workflows/scout.ts"], test: null },
  { name: "chat", entries: ["api/_chat/agent.ts"], test: null },
];

/** Changes here touch every area. */
const SHARED = ["worker/test/live/kit.mjs", "worker/test/live/affected.mjs", "worker/package.json", "worker/package-lock.json", "worker/build.mjs", "api/package-lock.json"];

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** The repo-relative files an area's code consists of. */
export async function filesOf(area) {
  const r = await build({
    entryPoints: area.entries.map((e) => join(ROOT, e)),
    absWorkingDir: WORKER,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    metafile: true,
    outdir: "/nonexistent",
    logLevel: "silent",
  });
  const files = new Set();
  for (const input of Object.keys(r.metafile.inputs)) {
    const abs = resolve(WORKER, input);
    files.add(relative(ROOT, abs));
    // Files read at run time next to the code (guardian-policy-v1.md).
    for (const m of readFileSync(abs, "utf8").matchAll(/new URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
      const read = resolve(dirname(abs), m[1]);
      if (existsSync(read)) files.add(relative(ROOT, read));
    }
  }
  if (area.test) files.add(area.test);
  for (const f of SHARED) files.add(f);
  return files;
}

/** Why everything runs, or null. */
function fullRunReason(since, all, now = new Date()) {
  if (all) return "asked for every test";
  if (!since) return "first release";
  const tagged = new Date(git("log", "-1", "--format=%cI", since));
  if (tagged.getUTCFullYear() !== now.getUTCFullYear() || tagged.getUTCMonth() !== now.getUTCMonth()) {
    return `first release of ${now.toISOString().slice(0, 7)}`;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--since");
  const since = at >= 0 ? args[at + 1] || null : null;
  const full = fullRunReason(since, args.includes("--all"));
  const changed = since ? git("diff", "--name-only", `${since}..HEAD`).split("\n").filter(Boolean) : [];

  const plan = [];
  for (const area of AREAS) {
    const files = await filesOf(area);
    const hits = changed.filter((f) => files.has(f));
    const run = Boolean(full) || hits.length > 0;
    const why = full ? full : hits.length ? `${hits.length} changed: ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ", ..." : ""}` : `untouched (${files.size} files)`;
    plan.push({ area: area.name, test: area.test, run: run && Boolean(area.test), line: `${area.name}: ${run ? (area.test ? "run" : "changed, no real-model test yet") : "skip"} (${why})` });
  }
  for (const p of plan) console.log(p.line);
  const tests = plan.filter((p) => p.run).map((p) => p.test);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tests=${JSON.stringify(tests)}\nplan<<EOF\n${plan.map((p) => p.line).join("\n")}\nEOF\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
