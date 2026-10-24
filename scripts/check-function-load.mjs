// Builds api/ the way Vercel does (`vercel build`, offline, no project needed) and loads
// every built function the way its Lambda runtime does: without require() of ES modules; then
// checks that dynamic routes (api/x/[id].ts) are not shadowed by vercel.json's rewrites.
// A function that imports an ES-only package (ai, @ai-sdk/*) from CommonJS output crashes on
// load in production (ERR_REQUIRE_ESM, Vercel's FUNCTION_INVOCATION_FAILED page) while every
// unit test passes under tsx. Run: npm run check:function-load (from api/). ~20 s.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VERCEL = "vercel@63.1.2"; // the version deploy-app.yml builds with
const root = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "fn-load-"));
try {
  cpSync(join(root, "api"), join(work, "api"), { recursive: true });
  // The repo's own rewrites, without its install and build commands.
  const repoConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  mkdirSync(join(work, "public"));
  writeFileSync(join(work, "public", "index.html"), "ok");
  writeFileSync(join(work, "vercel.json"), JSON.stringify({ rewrites: repoConfig.rewrites ?? [], outputDirectory: "public", framework: null }));
  mkdirSync(join(work, ".vercel"));
  writeFileSync(
    join(work, ".vercel", "project.json"),
    JSON.stringify({ projectId: "prj_x", orgId: "team_x", settings: { framework: null, nodeVersion: "22.x", outputDirectory: "public" } }),
  );
  execFileSync("npx", ["--yes", VERCEL, "build", "--prod"], { cwd: work, stdio: ["ignore", "ignore", "inherit"] });

  const out = join(work, ".vercel", "output", "functions");
  const funcs = readdirSync(out, { recursive: true }).filter((p) => String(p).endsWith(".func"));
  if (funcs.length === 0) throw new Error("vercel build produced no functions");
  const failed = [];
  for (const f of funcs) {
    const dir = join(out, String(f));
    const { handler } = JSON.parse(readFileSync(join(dir, ".vc-config.json"), "utf8"));
    const entry = join(dir, handler);
    if (!existsSync(entry)) throw new Error(`${f}: handler ${handler} missing`);
    try {
      // CommonJS output loads with require(); ES-module output with import().
      execFileSync(
        process.execPath,
        ["--no-experimental-require-module", "--input-type=module", "-e", `await import(${JSON.stringify(entry)})`],
        { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
      );
      console.log(`ok   ${f}`);
    } catch (e) {
      failed.push(f);
      console.error(`FAIL ${f}\n${String(e.stderr ?? e).split("\n").slice(0, 8).join("\n")}`);
    }
  }
  // A dynamic function (api/x/[id].ts) is reached through a route that vercel.json's own
  // rewrites come before: a catch-all rewrite to the app shadows it, the app's index.html comes
  // back for an API call ("Unexpected token '<'"), and nothing in the function ever runs.
  const config = JSON.parse(readFileSync(join(work, ".vercel", "output", "config.json"), "utf8"));
  const routes = config.routes.slice(config.routes.findIndex((r) => r.handle === "filesystem") + 1);
  for (const f of funcs) {
    const name = String(f).replace(/\.func$/, "");
    if (!name.includes("[")) continue; // a plain path is served by the filesystem, before any rewrite
    const url = `/api/${name}`.replace(/\[[^\]]+\]/g, "a1b2c3d4e5f6g7h").replace(/^\/api\/api\//, "/api/");
    const hit = routes.find((r) => r.src && !r.has && new RegExp(r.src).test(url));
    if (!hit?.dest?.includes(`/${name}`)) {
      failed.push(name);
      console.error(`FAIL ${name}: ${url} is answered by ${hit?.dest ?? "nothing"} before its function`);
    } else console.log(`ok   route ${url}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} function(s) crash on load the way Lambda runs them.`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
