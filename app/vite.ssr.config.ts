// The blog's rendering bundle: src/blog/server/entry.tsx and everything it
// imports (React, react-dom/server, react-markdown, the blog's components,
// the built shell and the blog's stylesheets as strings) in one ES module,
// api/_blog/dist/entry.js, which api/blog.ts loads. Built right after the
// app (package.json "build"), so the shell it embeds is this build's.
//
// Nothing is left external: the function's package (api/) has none of the
// app's dependencies, and Vercel bundles the function from this one file.

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  // The same env the app was built with (vite.config.ts): VITE_* from the
  // repo's .env files, overridden by the process (CI, Vercel, the dev box).
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
      ssr: "src/blog/server/entry.tsx",
      outDir: path.resolve(__dirname, "../api/_blog/dist"),
      emptyOutDir: true,
      copyPublicDir: false,
      target: "node22",
      minify: false,
      sourcemap: false,
      rollupOptions: { output: { entryFileNames: "entry.js", format: "es" } },
    },
    ssr: { noExternal: true, target: "node" },
  };
});
