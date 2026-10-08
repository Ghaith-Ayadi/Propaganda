import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { execSync } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";

// Short commit SHA for the /version panel. On Vercel the build env provides the
// full SHA; locally we read it from git. Empty string if neither is available.
function gitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "";
  }
}

// ── Dev-only API middleware ──────────────────────────────────────────────────
// Handles /api/* routes in `vite dev` so the Gemini key stays server-side
// (never in the browser bundle). In production these are Vercel functions.


function localApiPlugin(serverEnv: Record<string, string>): Plugin {
  return {
    name: "local-api",
    configureServer(server: ViteDevServer) {
      // /api/upload — mirrors api/upload.ts (a Vercel function in prod) so image
      // uploads work under `vite dev`, which doesn't run the serverless routes.
      server.middlewares.use("/api/upload", async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        const token = serverEnv["BLOB_READ_WRITE_TOKEN"];
        if (!token) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "BLOB_READ_WRITE_TOKEN not set in .env.local" }));
          return;
        }
        try {
          // Buffer the raw body and let undici's web Request parse the multipart.
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const webReq = new Request("http://localhost/api/upload", {
            method: "POST",
            headers: req.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          });
          const formData = await webReq.formData();
          const file = formData.get("file");
          if (!(file instanceof File)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing or invalid file field" }));
            return;
          }
          const year = new Date().getFullYear();
          const ts = Date.now().toString(36);
          const safeName =
            file.name
              .replace(/\.[^.]+$/, "")
              .toLowerCase()
              .replace(/[^a-z0-9-]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 40) || "file";
          const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
          const pathname = `${year}/${ts}-${safeName}.${ext}`;
          const { put } = await import("@vercel/blob");
          const blob = await put(pathname, file, {
            access: "public",
            token,
            cacheControlMaxAge: 31_536_000,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ url: blob.url }));
        } catch (err) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Upload failed", detail: String(err) }));
        }
      });

      // No model call outside the cost-logging gateway (api/_ai/gateway.ts): the
      // dev server does not call a model itself. Run `vercel dev` to try quotes.
      server.middlewares.use("/api/extract-quotes", (_req, res) => {
        res.writeHead(501, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Quote extraction runs through the cost-logging gateway: use vercel dev" }));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Local dev: hoist VITE_* from the monorepo root .env files (one place for app + scripts).
  // CI / Vercel: those vars come from process.env — merge them so they aren't lost.
  const root = path.resolve(__dirname, "..");
  const fileEnv = loadEnv(mode, root, "VITE_");
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.startsWith("VITE_")),
  ) as Record<string, string>;
  const env = { ...fileEnv, ...processEnv };

  // Load all env vars (including server-only ones like GEMINI_API_KEY) for the
  // local API middleware. These are NEVER injected into the client bundle.
  const serverEnv = loadEnv(mode, root, "");

  return {
    plugins: [
      localApiPlugin(serverEnv),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        // EditorApp registers the worker itself: blogs never load it.
        injectRegister: false,
        includeAssets: ["favicon.svg"],
        manifest: {
          // Stable identity pinned to the admin app so the installed PWA is the
          // writing tool, not the public reader.
          id: "/admin",
          name: "Verbatim",
          short_name: "Verbatim",
          description: "Local-first writing.",
          theme_color: "#0a0a0a",
          background_color: "#0a0a0a",
          display: "standalone",
          // The installed PWA is the writing tool, not the public reader.
          start_url: "/admin",
          scope: "/",
          icons: [
            { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
        },
        workbox: {
          // Cache the shell. API requests pass through; Dexie holds the data.
          navigateFallback: "/index.html",
          // The backend shares this origin (Caddy sends /auth/v1, /rest/v1 and
          // /realtime/v1 to Supabase, /api/* to the app's functions and, until
          // it retires, PocketBase), so page loads there must reach the
          // network. Otherwise the worker answers Google's callback
          // (/auth/v1/callback) with the app shell, the code never reaches the
          // auth server and sign-in hangs.
          navigateFallbackDenylist: [/^\/auth\/v1\//, /^\/rest\/v1\//, /^\/realtime\/v1\//, /^\/api\//, /^\/_\//],
          globPatterns: ["**/*.{js,css,html,svg,ico,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    define: {
      ...Object.fromEntries(
        Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
      ),
      // Build/deploy metadata for the /version panel (see lib/version.ts).
      "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()),
      "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(gitSha()),
      "import.meta.env.VITE_DEPLOY_ENV": JSON.stringify(process.env.VERCEL_ENV || mode),
    },
    server: {
      port: process.env.PORT ? Number(process.env.PORT) : 5173,
      // vercel.json's PostHog rewrites, for `vite dev` (lib/telemetry.ts).
      proxy: {
        "/ingest/static": {
          target: "https://eu-assets.i.posthog.com",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ingest/, ""),
        },
        "/ingest": {
          target: "https://eu.i.posthog.com",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/ingest/, ""),
        },
      },
    },
  };
});
