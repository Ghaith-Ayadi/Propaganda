// Verbatim analytics Worker.
//
// Two jobs, one Worker (service consolidation):
//   POST /collect  — ingest a page-view beacon, writeDataPoint to Analytics Engine.
//   GET  /query    — read aggregates back out via the AE SQL API, shaped for
//                    the admin dashboard. Holds the CF token as a secret so it
//                    never reaches the browser.
//
// Event schema (dataset `verbatim_events`):
//   index1 = tenant id (sampling key; every query filters on it)
//   blob1  = event type ("view")
//   blob2  = post id / slug ("" for non-post pages)
//   blob3  = path
//   blob4  = referrer bucket (direct | search:google | social:hn | ...)
//   blob5  = referrer host (raw, "" if direct)
//   blob6  = country (ISO-2, "XX" unknown)
//   blob7  = device (mobile | tablet | desktop)
//   blob8  = session id
//   blob9  = collection name ("" for non-post)
//   double1 = duration seconds
//   double2 = scroll pct (0..1)
//   double3 = 1 (literal-count helper; counts use sum(_sample_interval))

export interface Env {
  AE: AnalyticsEngineDataset;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string; // read-scoped (Account Analytics Read)
  ANALYTICS_QUERY_KEY?: string; // shared secret gating /query (tech debt: replace with real auth)
}

const DATASET = "verbatim_events";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return cors(req, new Response(null, { status: 204 }));
    if (url.pathname === "/collect") return handleCollect(req, env);
    if (url.pathname === "/query") return cors(req, await handleQuery(req, env, url));
    return new Response("verbatim-analytics up\n");
  },
};

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

interface Beacon {
  t?: string; // tenant
  e?: string; // event
  p?: string; // post id/slug
  c?: string; // collection
  path?: string;
  r?: string; // document.referrer
  sid?: string; // session id
  d?: number; // duration seconds
  sc?: number; // scroll pct 0..1
}

async function handleCollect(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  let b: Beacon;
  try {
    b = JSON.parse(await req.text()) as Beacon;
  } catch {
    return new Response(null, { status: 204 }); // swallow garbage; never block the reader
  }

  const cf = (req as unknown as { cf?: { country?: string } }).cf;
  const country = (cf?.country || "XX").toUpperCase();
  const device = deviceFromUA(req.headers.get("user-agent") || "");
  const { bucket, host } = bucketReferrer(b.r || "");

  env.AE.writeDataPoint({
    indexes: [(b.t || "verbatim").slice(0, 96)],
    blobs: [
      (b.e || "view").slice(0, 32),
      (b.p || "").slice(0, 128),
      (b.path || "").slice(0, 256),
      bucket,
      host.slice(0, 128),
      country,
      device,
      (b.sid || "").slice(0, 64),
      (b.c || "").slice(0, 128),
    ],
    doubles: [clampNum(b.d, 0, 86_400), clampNum(b.sc, 0, 1), 1],
  });

  // sendBeacon ignores the body; 204 keeps it a no-op for the reader.
  return new Response(null, { status: 204 });
}

function clampNum(v: unknown, lo: number, hi: number): number {
  const n = typeof v === "number" && isFinite(v) ? v : 0;
  return Math.max(lo, Math.min(hi, n));
}

function deviceFromUA(ua: string): "mobile" | "tablet" | "desktop" {
  if (/\b(iPad|Tablet)\b/i.test(ua)) return "tablet";
  if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

function bucketReferrer(ref: string): { bucket: string; host: string } {
  if (!ref) return { bucket: "direct", host: "" };
  let host = "";
  try {
    host = new URL(ref).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return { bucket: "direct", host: "" };
  }
  const map: [RegExp, string][] = [
    [/(^|\.)google\./, "search:google"],
    [/(^|\.)bing\.com$/, "search:bing"],
    [/(^|\.)duckduckgo\.com$/, "search:other"],
    [/(^|\.)(twitter\.com|x\.com|t\.co)$/, "social:twitter"],
    [/(^|\.)bsky\.app$/, "social:bluesky"],
    [/(^|\.)news\.ycombinator\.com$/, "social:hn"],
    [/(^|\.)(facebook\.com|reddit\.com|linkedin\.com|lobste\.rs)$/, "social:other"],
  ];
  for (const [re, bucket] of map) if (re.test(host)) return { bucket, host };
  return { bucket: "other", host };
}

// ---------------------------------------------------------------------------
// Query (AE SQL → dashboard shapes)
// ---------------------------------------------------------------------------

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, all: 90 };

async function handleQuery(req: Request, env: Env, url: URL): Promise<Response> {
  if (env.ANALYTICS_QUERY_KEY) {
    const key = req.headers.get("x-analytics-key") || url.searchParams.get("key");
    if (key !== env.ANALYTICS_QUERY_KEY) return json({ error: "unauthorized" }, 401);
  }

  const tenant = esc((url.searchParams.get("tenant") || "verbatim").slice(0, 96));
  const metric = url.searchParams.get("metric") || "";
  const range = url.searchParams.get("range") || "30d";
  const days = RANGE_DAYS[range] ?? 30;
  const where = `index1 = '${tenant}' AND blob1 = 'view'`;

  try {
    switch (metric) {
      case "site":
        return json(await querySite(env, where, days));
      case "top":
        return json(
          await queryTop(env, where, days, clampInt(url.searchParams.get("limit"), 10, 1, 50)),
        );
      case "referrer":
        return json(await queryMix(env, where, days, "blob4"));
      case "country":
        return json(await queryMix(env, where, days, "blob6"));
      case "device":
        return json(await queryMix(env, where, days, "blob7"));
      case "hits":
        return json(await queryHits(env, where));
      default:
        return json({ error: "unknown metric" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
}

interface DayPoint {
  day: string;
  value: number;
}

async function querySite(env: Env, where: string, days: number) {
  // current + previous totals in one pass over a 2x window
  const totals = await sql<{ cur: number; prev: number }>(
    env,
    `SELECT
       sum(if(timestamp > now() - INTERVAL '${days}' DAY, _sample_interval, 0)) AS cur,
       sum(if(timestamp <= now() - INTERVAL '${days}' DAY, _sample_interval, 0)) AS prev
     FROM ${DATASET}
     WHERE ${where} AND timestamp > now() - INTERVAL '${days * 2}' DAY`,
  );
  const rows = await sql<{ day: string; value: number }>(
    env,
    `SELECT toDate(timestamp) AS day, sum(_sample_interval) AS value
     FROM ${DATASET}
     WHERE ${where} AND timestamp > now() - INTERVAL '${days}' DAY
     GROUP BY day ORDER BY day`,
  );
  return {
    total: num(totals[0]?.cur),
    previousTotal: num(totals[0]?.prev),
    series: fillSeries(rows, days),
  };
}

async function queryTop(env: Env, where: string, days: number, limit: number) {
  const tops = await sql<{ slug: string; views: number }>(
    env,
    `SELECT blob2 AS slug, sum(_sample_interval) AS views
     FROM ${DATASET}
     WHERE ${where} AND blob2 != '' AND timestamp > now() - INTERVAL '${days}' DAY
     GROUP BY slug ORDER BY views DESC LIMIT ${limit}`,
  );
  if (tops.length === 0) return [];
  const slugs = tops.map((t) => `'${esc(t.slug)}'`).join(",");
  const series = await sql<{ slug: string; day: string; value: number }>(
    env,
    `SELECT blob2 AS slug, toDate(timestamp) AS day, sum(_sample_interval) AS value
     FROM ${DATASET}
     WHERE ${where} AND blob2 IN (${slugs}) AND timestamp > now() - INTERVAL '14' DAY
     GROUP BY slug, day ORDER BY day`,
  );
  const byslug = new Map<string, DayPoint[]>();
  for (const r of series) {
    const arr = byslug.get(r.slug) ?? [];
    arr.push({ day: r.day, value: num(r.value) });
    byslug.set(r.slug, arr);
  }
  return tops.map((t) => ({
    postSlug: t.slug,
    views: num(t.views),
    series: fillSeries(byslug.get(t.slug) ?? [], 14),
  }));
}

async function queryMix(env: Env, where: string, days: number, col: string) {
  const rows = await sql<{ k: string; value: number }>(
    env,
    `SELECT ${col} AS k, sum(_sample_interval) AS value
     FROM ${DATASET}
     WHERE ${where} AND timestamp > now() - INTERVAL '${days}' DAY
     GROUP BY k ORDER BY value DESC`,
  );
  const total = rows.reduce((s, r) => s + num(r.value), 0) || 1;
  return rows
    .filter((r) => r.k)
    .map((r) => ({ key: r.k, value: num(r.value), pct: num(r.value) / total }));
}

async function queryHits(env: Env, where: string) {
  const posts = await sql<{ slug: string; hits: number; seconds: number }>(
    env,
    `SELECT blob2 AS slug, sum(_sample_interval) AS hits,
            sum(double1 * _sample_interval) AS seconds
     FROM ${DATASET}
     WHERE ${where} AND blob2 != ''
     GROUP BY slug`,
  );
  const collections = await sql<{ name: string; hits: number; seconds: number }>(
    env,
    `SELECT blob9 AS name, sum(_sample_interval) AS hits,
            sum(double1 * _sample_interval) AS seconds
     FROM ${DATASET}
     WHERE ${where} AND blob9 != ''
     GROUP BY name`,
  );
  const pmap: Record<string, { hits: number; seconds: number }> = {};
  for (const p of posts) pmap[p.slug] = { hits: num(p.hits), seconds: Math.round(num(p.seconds)) };
  const cmap: Record<string, { hits: number; seconds: number }> = {};
  for (const c of collections)
    cmap[c.name] = { hits: num(c.hits), seconds: Math.round(num(c.seconds)) };
  return { posts: pmap, collections: cmap };
}

// ---------------------------------------------------------------------------
// AE SQL transport
// ---------------------------------------------------------------------------

async function sql<T>(env: Env, query: string): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "text/plain" },
      body: query,
    },
  );
  if (!res.ok) throw new Error(`AE SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: T[] };
  return body.data ?? [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : 0;
}

function clampInt(v: string | null, def: number, lo: number, hi: number): number {
  const n = v == null ? def : parseInt(v, 10);
  return Math.max(lo, Math.min(hi, isFinite(n) ? n : def));
}

/** Pad a sparse day series to a continuous run ending today (UTC). */
function fillSeries(rows: { day: string; value: number }[], days: number): DayPoint[] {
  const byday = new Map(rows.map((r) => [r.day, num(r.value)]));
  const out: DayPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, value: byday.get(key) ?? 0 });
  }
  return out;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cors(req: Request, res: Response): Response {
  const origin = req.headers.get("Origin") || "*";
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "x-analytics-key, content-type");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}
