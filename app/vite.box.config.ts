// The blog renderer for the box: src/blog/server/box.ts and everything it
// imports in one file, app/dist-box/box.js, which Bedrock builds into the
// propaganda-blog image (compose/propaganda-supabase) and runs (see box.ts). Unlike vite.ssr.config.ts it embeds no shell: the box fetches the
// deployment's own at run time, so this build needs no `vite build` first.

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const root = path.resolve(__dirname, "..");
  const fileEnv = loadEnv(mode, root, "VITE_");
  const processEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("VITE_"))) as Record<string, string>;
  const env = { ...fileEnv, ...processEnv };
  return {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    define: {
      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
      ssr: "src/blog/server/box.ts",
      outDir: path.resolve(__dirname, "dist-box"),
      emptyOutDir: true,
      copyPublicDir: false,
      target: "node22",
      minify: false,
      sourcemap: false,
      rollupOptions: { output: { entryFileNames: "box.js", format: "es" } },
    },
    ssr: { noExternal: true, target: "node" },
  };
});
