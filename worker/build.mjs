// Builds dist/ with esbuild. The worker imports the model gateway from the
// repo's api/_ai (one logged path to every model, shared with the Vercel
// functions), which tsc can't emit from outside src/; esbuild bundles our own
// code and leaves npm packages as imports, resolved from worker/node_modules.
//
// Entry points besides main.js are the modules the tests import directly.

import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: [
    "src/main.ts",
    "src/limits.ts",
    "src/agents/testing.ts",
    "src/listener/testing.ts",
  ],
  outdir: "dist",
  outbase: "src",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "warning",
});
