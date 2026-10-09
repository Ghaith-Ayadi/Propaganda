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


/** Which api/ file Vercel would run for a /api/chat path (file-system routing). */
function chatRoute(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/api/chat") return "chat/index.ts";
  if (p === "/api/chat/remember") return "chat/remember.ts";
  if (p === "/api/chat/conversations") return "chat/conversations/index.ts";
  if (/^\/api\/chat\/conversations\/[^/]+$/.test(p)) return "chat/conversations/[id].ts";
  if (/^\/api\/chat\/conversations\/[^/]+\/messages$/.test(p)) return "chat/conversations/[id]/messages.ts";
  return null;
}

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

      // /api/model-key (BYOK) runs the real function, loaded through Vite's SSR
      // loader, so the Anthropic key card works on localhost. Needs api/'s
      // packages (npm ci in api/) and SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
      // MODEL_KEY_SECRET in .env.local; the key it sends never reaches the bundle.
      server.middlewares.use("/api/model-key", async (req, res) => {
        try {
          for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MODEL_KEY_SECRET", "SUPABASE_ANON_KEY"]) {
            if (serverEnv[k] && !process.env[k]) process.env[k] = serverEnv[k];
          }
          const mod = (await server.ssrLoadModule(path.resolve(__dirname, "../api/model-key.ts"))) as Record<
            string,
            ((r: Request) => Promise<Response>) | undefined
          >;
          const handler = mod[req.method ?? "GET"];
          if (!handler) {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const webRes = await handler(
            new Request(`http://localhost/api/model-key${req.url && req.url !== "/" ? req.url : ""}`, {
              method: req.method,
              headers: req.headers as Record<string, string>,
              body: chunks.length ? Buffer.concat(chunks) : undefined,
            }),
          );
          res.writeHead(webRes.status, { "Content-Type": "application/json" });
          res.end(await webRes.text());
        } catch (err) {
          res.writeHead(502, { "Content-Type": "application/json" });
          // Never echo a pasted key back, even in dev.
          const detail = String(err).replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-…");
          res.end(JSON.stringify({ error: "model-key failed in dev", detail }));
        }
      });

      // /api/chat/* — the Chat agent's functions, run in-process so the Chat
      // page works on localhost. Each request loads the function module through
      // Vite (edits apply without a restart) and bridges Node's request to the
      // Web Request the function expects; the reply streams through as it comes.
      // The model is still reached only through the gateway those functions use.
      server.middlewares.use("/api/chat", async (req, res) => {
        const url = new URL(req.originalUrl ?? req.url ?? "/", "http://localhost");
        const file = chatRoute(url.pathname);
        const method = req.method ?? "GET";
        if (!file) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        // Server-only keys from .env files, for the functions (never the bundle).
        for (const [k, v] of Object.entries(serverEnv)) if (process.env[k] === undefined) process.env[k] = v;
        try {
          const mod = (await server.ssrLoadModule(path.resolve(__dirname, "../api", file))) as Record<
            string,
            ((r: Request) => Promise<Response>) | undefined
          >;
          const handler = mod[method];
          if (!handler) {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          // The browser leaving (Stop, a closed tab) aborts the function's request.
          const gone = new AbortController();
          res.on("close", () => {
            if (!res.writableFinished) gone.abort();
          });
          const response = await handler(
            new Request(url, {
              method,
              headers: req.headers as Record<string, string>,
              body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
              signal: gone.signal,
            }),
          );
          res.writeHead(response.status, Object.fromEntries(response.headers));
          if (!response.body) return void res.end();
          const reader = response.body.getReader();
          gone.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        } catch (err) {
          if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Function failed", detail: String(err) }));
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

// ── Sample data ships in the UI preview only ─────────────────────────────────
// The placeholder adapters hold fictional tenants (Ledgerline, Tidewell, a
// scripted Chat). Outside VITE_UI_PREVIEW=1 the app never reads them
// (lib/preview.ts), so they must not be in the bundle at all: this marks them
// free of side effects (dead branches drop them), then fails the build if one
// is still in a chunk, or if any chunk still carries a sample tenant's words.
const SAMPLE_MODULES = [
  "src/lib/pipeline/adapter.ts",
  "src/lib/goals/placeholder.ts",
  "src/lib/knowledge/placeholder.ts",
  "src/components/home/placeholder.ts",
  "src/components/inbox/placeholder.ts",
];
const SAMPLE_WORDS = ["Ledgerline", "Tidewell", "Maya Okafor", "Brightwater", "This is a placeholder answer", "a typographer's desk"];

function samplesOnlyInPreview(preview: boolean): Plugin {
  const isSample = (id: string) => SAMPLE_MODULES.some((m) => id.split(path.sep).join("/").endsWith(m));
  return {
    name: "samples-only-in-preview",
    apply: "build",
    transform(code, id) {
      if (!preview && isSample(id)) return { code, map: null, moduleSideEffects: false };
      return null;
    },
    generateBundle(_options, bundle) {
      if (preview) return;
      const leaks: string[] = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) if (isSample(id) && chunk.modules[id].renderedLength > 0) leaks.push(`${chunk.fileName}: ${id}`);
        for (const w of SAMPLE_WORDS) if (chunk.code.includes(w)) leaks.push(`${chunk.fileName}: "${w}"`);
      }
      if (leaks.length) this.error(`Sample data in a production bundle (only VITE_UI_PREVIEW=1 may ship it):\n  ${leaks.join("\n  ")}`);
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
      samplesOnlyInPreview(env.VITE_UI_PREVIEW === "1"),
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
