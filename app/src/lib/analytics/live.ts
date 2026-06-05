// Live analytics adapter: fetches real aggregates from the Cloudflare Worker
// (/query) and maps them onto the same panel contracts the simulator returns.
// hook.ts picks sim vs. live; panels never know which served them.
//
// The Worker holds the CF read token; the browser only holds the query gate
// key (VITE_ANALYTICS_QUERY_KEY). That key is shipped in the admin bundle,
// which is itself unauthenticated today — so it raises the bar without being
// real auth. Tech debt: replace with Supabase-auth'd requests when AuthGate
// is enabled.

import { useEffect, useState } from "react";
import type {
  BucketRow,
  DateRangePreset,
  HitsAndTime,
  ReferrerBucket,
  ReferrerBucketRow,
  SiteViewsResult,
} from "./types";

const BASE = (import.meta.env.VITE_ANALYTICS_URL as string | undefined)?.replace(/\/$/, "");
const KEY = import.meta.env.VITE_ANALYTICS_QUERY_KEY as string | undefined;
const TENANT = (import.meta.env.VITE_ANALYTICS_TENANT as string) || "verbatim";

/** Whether a live backend is configured. When false, live hooks return null. */
export const liveConfigured = !!BASE;

function headers(): HeadersInit | undefined {
  return KEY ? { "x-analytics-key": KEY } : undefined;
}

/** Fetch JSON from the Worker. `path` null disables the fetch (sim mode). */
function useJson<T>(path: string | null): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!path || !BASE) {
      setData(null);
      return;
    }
    let cancelled = false;
    const sep = path.includes("?") ? "&" : "?";
    fetch(`${BASE}${path}${sep}tenant=${encodeURIComponent(TENANT)}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setData(j && (j as { error?: unknown }).error ? null : (j as T));
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return data;
}

interface MixRow {
  key: string;
  value: number;
  pct: number;
}

export interface LiveTopRow {
  postSlug: string;
  views: number;
  series: { day: string; value: number }[];
}

export function useLiveSiteViews(range: DateRangePreset, enabled: boolean): SiteViewsResult | null {
  return useJson<SiteViewsResult>(enabled ? `/query?metric=site&range=${range}` : null);
}

export function useLiveTopPosts(
  range: DateRangePreset,
  limit: number,
  enabled: boolean,
): LiveTopRow[] | null {
  return useJson<LiveTopRow[]>(enabled ? `/query?metric=top&range=${range}&limit=${limit}` : null);
}

export function useLiveReferrerMix(
  range: DateRangePreset,
  enabled: boolean,
): ReferrerBucketRow[] | null {
  const rows = useJson<MixRow[]>(enabled ? `/query?metric=referrer&range=${range}` : null);
  if (!rows) return null;
  return rows.map((r) => ({
    bucket: r.key as ReferrerBucket,
    label: REFERRER_LABELS[r.key] ?? "Other sites",
    value: r.value,
    pct: r.pct,
  }));
}

export function useLiveCountryMix(range: DateRangePreset, enabled: boolean): BucketRow[] | null {
  const rows = useJson<MixRow[]>(enabled ? `/query?metric=country&range=${range}` : null);
  if (!rows) return null;
  return rows.slice(0, 10).map((r) => ({
    label: `${flag(r.key)}  ${COUNTRY_NAMES[r.key] ?? r.key}`,
    value: r.value,
    pct: r.pct,
  }));
}

export function useLiveDeviceMix(range: DateRangePreset, enabled: boolean): BucketRow[] | null {
  const rows = useJson<MixRow[]>(enabled ? `/query?metric=device&range=${range}` : null);
  if (!rows) return null;
  return rows.map((r) => ({ label: titleCase(r.key), value: r.value, pct: r.pct }));
}

// --- all-time hits bundle (shared, fetched once) ---------------------------
// PostTable calls usePostHitsTime per row, so a per-row fetch would be N
// requests. Instead fetch the whole {posts, collections} map once, cache it
// module-side, and let every row read from the cache.

interface HitsBundle {
  posts: Record<string, HitsAndTime>;
  collections: Record<string, HitsAndTime>;
}

let hitsCache: HitsBundle | null = null;
let hitsInflight = false;
const hitsSubs = new Set<() => void>();

function loadHits() {
  if (!BASE || hitsCache || hitsInflight) return;
  hitsInflight = true;
  fetch(`${BASE}/query?metric=hits&tenant=${encodeURIComponent(TENANT)}`, { headers: headers() })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && !(j as { error?: unknown }).error) {
        hitsCache = j as HitsBundle;
        hitsSubs.forEach((f) => f());
      }
    })
    .catch(() => {})
    .finally(() => {
      hitsInflight = false;
    });
}

function useHitsBundle(enabled: boolean): HitsBundle | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const fn = () => force((n) => n + 1);
    hitsSubs.add(fn);
    loadHits();
    return () => {
      hitsSubs.delete(fn);
    };
  }, [enabled]);
  return enabled ? hitsCache : null;
}

export function useLivePostHitsTime(
  postSlug: string | null | undefined,
  enabled: boolean,
): HitsAndTime | null {
  const bundle = useHitsBundle(enabled && !!postSlug);
  if (!enabled || !postSlug) return null;
  return bundle?.posts[postSlug] ?? { hits: 0, seconds: 0 };
}

export function useLiveCollectionHitsTime(
  collectionName: string | null | undefined,
  enabled: boolean,
): HitsAndTime | null {
  const bundle = useHitsBundle(enabled && !!collectionName);
  if (!enabled || !collectionName) return null;
  return bundle?.collections[collectionName] ?? { hits: 0, seconds: 0 };
}

// --- label maps (mirror the simulator's wording) ---------------------------

const REFERRER_LABELS: Record<string, string> = {
  direct: "Direct / unknown",
  "search:google": "Google search",
  "search:bing": "Bing search",
  "search:other": "Search (other)",
  "social:twitter": "Twitter / X",
  "social:bluesky": "Bluesky",
  "social:hn": "Hacker News",
  "social:other": "Social (other)",
  email: "Email / newsletter",
  other: "Other sites",
};

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  CA: "Canada",
  FR: "France",
  NL: "Netherlands",
  AU: "Australia",
  IN: "India",
  PL: "Poland",
  BR: "Brazil",
  MA: "Morocco",
  TN: "Tunisia",
  JP: "Japan",
  ES: "Spain",
  IT: "Italy",
  SE: "Sweden",
  XX: "Unknown",
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function flag(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return "🏳️";
  return cc
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + (c.charCodeAt(0) - 65)))
    .join("");
}
