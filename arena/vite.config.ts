import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The Arena is its own app, deployed apart from product releases (docs/arena.md).
// It reuses the product's theme tokens (../app/src/styles) so it looks the same.
// In dev, /auth/v1, /rest/v1 and /worker/v1 go to ARENA_BACKEND (default: the
// dev box), the same rewrites vercel.json makes in production.
export default defineConfig(() => {
  const backend = process.env.ARENA_BACKEND ?? "https://app.dev.propaganda.pub";
  const proxy = Object.fromEntries(
    ["/auth/v1", "/rest/v1", "/worker/v1"].map((p) => [p, { target: backend, changeOrigin: true }]),
  );
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: process.env.PORT ? Number(process.env.PORT) : 5174,
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(__dirname, "../app/src/styles")] },
      proxy,
    },
  };
});
