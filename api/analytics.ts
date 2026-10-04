// Vercel serverless function — proxies dashboard analytics reads to the
// Cloudflare Worker (analytics-worker/) so the query gate key never ships in
// the client bundle. The browser only needs a valid PocketBase session and
// membership in the target site; this resolves that site's analytics tenant
// server-side and forwards the request with the real key.
//
// GET /api/analytics?site=<siteId>&path=/query&metric=...&range=...
//
// Env:
//   PB_URL / VITE_PB_URL   — PocketBase (to look up the site's tenant)
//   ANALYTICS_URL          — the Worker's base URL
//   ANALYTICS_QUERY_KEY    — the Worker's shared secret (x-analytics-key)

import { requireMember } from "./_auth";
import { withTelemetry } from "./_telemetry";

const PB_URL = process.env.PB_URL || process.env.VITE_PB_URL;

// Only forward requests to worker paths/metrics we know about — this is a
// proxy with an upstream secret attached, not an open relay.
const ALLOWED_PATHS = new Set(["/query"]);
const ALLOWED_METRICS = new Set(["site", "top", "referrer", "country", "device", "hits"]);

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const site = url.searchParams.get("site") || "";

  let auth;
  try {
    auth = await requireMember(request, site);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: "Auth failed" }, 500);
  }

  const analyticsBase = process.env.ANALYTICS_URL?.replace(/\/$/, "");
  const analyticsKey = process.env.ANALYTICS_QUERY_KEY;
  if (!analyticsBase) {
    return json({ error: "Analytics not configured" }, 503);
  }

  const path = url.searchParams.get("path") || "";
  if (!ALLOWED_PATHS.has(path)) {
    return json({ error: "Unknown path" }, 400);
  }
  const metric = url.searchParams.get("metric") || "";
  if (path === "/query" && metric && !ALLOWED_METRICS.has(metric)) {
    return json({ error: "Unknown metric" }, 400);
  }

  // Look up the site's analytics tenant — never trust a tenant from the client.
  let tenant: string;
  try {
    const res = await fetch(`${PB_URL}/api/collections/sites/records/${site}`, {
      headers: { Authorization: auth.token },
    });
    if (!res.ok) return json({ error: "Site not found" }, 404);
    const record = (await res.json()) as { analytics_tenant?: string };
    tenant = record.analytics_tenant || "";
  } catch {
    return json({ error: "Site lookup failed" }, 502);
  }
  if (!tenant) {
    return json({ error: "Site has no analytics tenant" }, 404);
  }

  // Forward every param except `site` and `path` (our own routing params).
  const forward = new URLSearchParams(url.searchParams);
  forward.delete("site");
  forward.delete("path");
  forward.set("tenant", tenant);

  let upstream: Response;
  try {
    upstream = await fetch(`${analyticsBase}${path}?${forward.toString()}`, {
      headers: analyticsKey ? { "x-analytics-key": analyticsKey } : undefined,
    });
  } catch {
    return json({ error: "Analytics request failed" }, 502);
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = withTelemetry("analytics", handle);
