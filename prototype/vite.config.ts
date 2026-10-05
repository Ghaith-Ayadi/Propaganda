import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Throwaway 0.2 prototype. `npm run build` makes one dist/index.html.
// `npm run build:artifact` bundles React in too, for publishing as an artifact.
export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), viteSingleFile()],
  esbuild: {
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    jsxInject: `import React from "react"`,
  },
  build: {
    assetsInlineLimit: 1_000_000,
    // Default build keeps React on the CDN (index.html loads it). `--mode artifact`
    // bundles React in, so the single file works with no network at all.
    rollupOptions:
      mode === "artifact"
        ? { output: { format: "iife" } }
        : {
            external: ["react", "react-dom", "react-dom/client"],
            output: {
              format: "iife",
              globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" },
            },
          },
  },
}));
