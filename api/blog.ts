// Vercel serverless function: every page of every public blog, rendered.
//
// Caddy on the box proxies each blog host (<slug>.propaganda.pub, a custom
// domain) to this deployment and adds X-Propaganda-Host with the host the
// reader asked for; vercel.json sends every request carrying that header
// here, static files aside. The work is in the bundle app/vite.ssr.config.ts
// builds from app/src/blog/server/ (api/_blog/dist/entry.js, built with the
// app): which site, which page, the rows from PostgREST, the HTML with its
// head, or the sitemap, feed and robots.txt. The browser then loads the app
// as before and takes the page over.
//
// Should rendering fail (the API down, the bundle missing), the reader gets
// the plain shell and the app renders in the browser as it did before this
// function existed; the failure is reported.
//
// Env (all optional; the bundle carries the build's values):
//   SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY
//   VITE_PLATFORM_DOMAIN (propaganda.pub), VITE_APP_HOST (app.<platform domain>)

import { report } from "./_telemetry.js";

type Entry = typeof import("./_blog/dist/entry.js");

let entry: Promise<Entry> | null = null;
const load = (): Promise<Entry> => (entry ??= import("./_blog/dist/entry.js"));

export async function GET(request: Request): Promise<Response> {
  let mod: Entry;
  try {
    mod = await load();
  } catch (err) {
    entry = null;
    await report(err, "blog", { stage: "load" });
    return new Response("<!doctype html><title>Propaganda</title>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  try {
    return await mod.handle(request, {
      apiUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
      apiKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
      platformDomain: process.env.VITE_PLATFORM_DOMAIN,
      appHost: process.env.VITE_APP_HOST,
    });
  } catch (err) {
    await report(err, "blog", { stage: "render", path: new URL(request.url).pathname });
    return mod.fallback("failed");
  }
}

export const HEAD = GET;
