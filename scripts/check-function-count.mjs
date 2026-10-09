// Fails when api/ holds more Vercel functions than the Hobby plan deploys
// (12): over the limit, the production deploy is refused. Every script file
// under api/ is a function unless its name or a folder on its path starts with
// _ or ., so helpers go in _folders and tools outside api/.
// Run: npm run check:functions (from api/).
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LIMIT = 12;
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** True when Vercel deploys this path (relative to api/) as a function. */
export function isFunction(path) {
  const parts = path.split("/");
  if (parts.some((p) => p.startsWith("_") || p.startsWith(".") || p === "node_modules")) return false;
  return SCRIPT.test(path) && !path.endsWith(".d.ts");
}

export function listFunctions(apiDir) {
  return readdirSync(apiDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(apiDir, join(e.parentPath, e.name)).split("\\").join("/"))
    .filter(isFunction)
    .sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = listFunctions(resolve(import.meta.dirname, "..", "api"));
  if (found.length > LIMIT) {
    console.error(`api/ has ${found.length} functions; Vercel's Hobby plan deploys at most ${LIMIT}:`);
    for (const f of found) console.error(`  api/${f}`);
    console.error("Move helpers into an _folder and tools out of api/.");
    process.exit(1);
  }
  console.log(`ok: ${found.length} of ${LIMIT} functions`);
}
