// Google Search Console, read with a service account (docs/search-console.md).
// One Domain property (GSC_PROPERTY, default sc-domain:propaganda.pub) holds
// every hosted blog; a tenant's own queries are that property filtered to its
// host. A custom domain is another property and needs its owner's own grant,
// so it reads as nothing here. The API is free, so nothing goes to the cost log.
//
// GSC_SERVICE_ACCOUNT_JSON is the service account's JSON key, base64 (raw JSON
// works too). Without it every function here answers null and the Strategist
// plans from DataForSEO alone.

import { createSign } from "node:crypto";
import type { Keyword } from "./strategy.js";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/webmasters/v3";
/** Search Console lags two to three days: a window ends three days back. */
const LAG_DAYS = 3;
export const WINDOW_DAYS = 90;
const MIN_IMPRESSIONS = 10;

interface ServiceKey {
  client_email: string;
  private_key: string;
}

function serviceKey(): ServiceKey | null {
  const raw = (process.env.GSC_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) return null;
  try {
    const key = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as Partial<ServiceKey>;
    return key.client_email && key.private_key ? { client_email: key.client_email, private_key: key.private_key } : null;
  } catch {
    return null;
  }
}

export function gscConfigured(): boolean {
  return serviceKey() !== null;
}

export function gscProperty(): string {
  return process.env.GSC_PROPERTY || "sc-domain:propaganda.pub";
}

/** The host `site` is read under, or null: a host outside the property (a custom domain) is not ours to read. */
export function gscHost(blog: string): string | null {
  const host = blog.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const root = gscProperty().replace(/^sc-domain:/, "");
  return host && host.endsWith(`.${root}`) ? host : null;
}

const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** The signed request for an access token (RS256, one hour). */
export function tokenAssertion(key: ServiceKey, now: number): string {
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key.private_key);
  return `${head}.${body}.${b64(sig)}`;
}

let cached: { token: string; until: number } | null = null;

async function accessToken(key: ServiceKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.until > now + 60) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: tokenAssertion(key, now) }),
  });
  if (!res.ok) throw new Error(`Search Console sign-in failed: HTTP ${res.status}`);
  const out = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!out.access_token) throw new Error("Search Console sign-in gave no token");
  cached = { token: out.access_token, until: now + (out.expires_in ?? 3600) };
  return cached.token;
}

export interface GscRow {
  query: string;
  clicks: number;
  impressions: number;
  /** Average position over the window. */
  position: number;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The queries a host's pages showed for in the last WINDOW_DAYS, most seen first (500 at most). */
export async function blogQueries(host: string, today: Date = new Date()): Promise<GscRow[] | null> {
  const key = serviceKey();
  if (!key) return null;
  const end = new Date(today.getTime() - LAG_DAYS * 86_400_000);
  const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * 86_400_000);
  const res = await fetch(`${API}/sites/${encodeURIComponent(gscProperty())}/searchAnalytics/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken(key)}` },
    body: JSON.stringify({
      startDate: day(start),
      endDate: day(end),
      dimensions: ["query"],
      dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "page", operator: "includingRegex", expression: `^https://${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/` }] }],
      rowLimit: 500,
    }),
  });
  if (!res.ok) throw new Error(`Search Console read failed: HTTP ${res.status}`);
  const out = (await res.json()) as { rows?: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[] };
  return (out.rows ?? [])
    .filter((r) => r.keys?.[0] && typeof r.impressions === "number" && typeof r.position === "number")
    .map((r) => ({ query: r.keys![0]!, clicks: r.clicks ?? 0, impressions: r.impressions!, position: r.position! }))
    .sort((a, b) => b.impressions - a.impressions);
}

export interface SearchConsole {
  days: number;
  clicks: number;
  impressions: number;
  /** Everything their pages showed for, as keywords with real positions, most seen first. */
  seen: Keyword[];
  /** Page two or three (average position 11 to 30): the cheapest wins. */
  striking: Keyword[];
  /** Seen often and barely ranked (past 30): searches their posts do not answer. */
  unanswered: Keyword[];
}

function asKeyword(r: GscRow): Keyword {
  return { keyword: r.query, volume: null, difficulty: null, position: Math.max(1, Math.round(r.position)), clicks: r.clicks, impressions: r.impressions };
}

/** What a read of the queries says: no row under MIN_IMPRESSIONS counts as a signal. */
export function insights(rows: GscRow[], limit = 15): SearchConsole {
  const strong = rows.filter((r) => r.impressions >= MIN_IMPRESSIONS);
  return {
    days: WINDOW_DAYS,
    clicks: rows.reduce((n, r) => n + r.clicks, 0),
    impressions: rows.reduce((n, r) => n + r.impressions, 0),
    seen: rows.map(asKeyword),
    striking: strong.filter((r) => r.position > 10 && r.position <= 30).slice(0, limit).map(asKeyword),
    unanswered: strong.filter((r) => r.position > 30).slice(0, limit).map(asKeyword),
  };
}

/** Their blog's Search Console read, or null when it is not set up, not a hosted blog, or has no data yet. */
export async function searchConsoleFor(blog: string): Promise<SearchConsole | null> {
  const host = gscHost(blog);
  if (!host || !gscConfigured()) return null;
  const rows = await blogQueries(host);
  return rows && rows.length ? insights(rows) : null;
}
