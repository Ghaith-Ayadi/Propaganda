import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

// ── Dev-only API middleware ──────────────────────────────────────────────────
// Handles /api/* routes in `vite dev` so the Gemini key stays server-side
// (never in the browser bundle). In production these are Vercel functions.

const GEMINI_MODEL = "gemini-2.5-flash-lite";

function localApiPlugin(serverEnv: Record<string, string>): Plugin {
  return {
    name: "local-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/extract-quotes", async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const apiKey = serverEnv["GEMINI_API_KEY"];
        if (!apiKey) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "GEMINI_API_KEY not set in .env.local" }));
          return;
        }

        // Read request body
        const body = await new Promise<string>((resolve) => {
          let data = "";
          req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          req.on("end", () => resolve(data));
        });

        let content: string;
        try {
          const parsed = JSON.parse(body) as { content?: unknown };
          content = typeof parsed.content === "string" ? parsed.content.trim() : "";
          if (!content) throw new Error("empty");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "content is required" }));
          return;
        }

        const prompt = `You are extracting shareable pull-quotes from a piece of writing.

Return the 3 most quotable verbatim spans from the article below.
Rules:
- Copy the text EXACTLY as it appears — do not change a single word, punctuation mark, or capitalisation.
- Spans may be one or two sentences. Do not restrict to single sentences.
- Return ONLY a raw JSON array of 3 strings. No keys, no explanation, no markdown.

Article:
${content}`;

        try {
          const gemRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            },
          );

          const gemData = await gemRes.json() as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
          };
          const raw = gemData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned) as unknown[];
          const candidates = parsed.filter((x): x is string => typeof x === "string");
          const quotes = candidates.filter((q) => content.includes(q));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ quotes }));
        } catch (err) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Gemini call failed", detail: String(err) }));
        }
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
        includeAssets: ["favicon.svg"],
        manifest: {
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
          // Cache the shell. Supabase requests pass through; Dexie holds the data.
          navigateFallback: "/index.html",
          globPatterns: ["**/*.{js,css,html,svg,ico,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    define: Object.fromEntries(
      Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
    ),
    server: { port: process.env.PORT ? Number(process.env.PORT) : 5173 },
  };
});
