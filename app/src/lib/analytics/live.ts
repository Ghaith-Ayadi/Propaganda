// Live analytics adapter: fetches real aggregates via /api/analytics (which
// proxies to the Cloudflare Worker's /query) and maps them onto the same
// panel contracts the simulator returns. hook.ts picks sim vs. live; panels
// never know which served them.
//
// The Worker's query gate key used to ship in the browser bundle
// (VITE_ANALYTICS_QUERY_KEY) — any visitor could read any tenant's numbers.
// It's now server-only (api/analytics.ts): the browser sends its PocketBase
// session + the active site id, and the function checks membership, looks up
// that site's tenant, and attaches the real key itself.

import { useEffect, useState } from "react";
import { pb } from "@/lib/pocketbase";
import { onScopeReset, siteId } from "@/lib/scope";
import type {
  BucketRow,
  DateRangePreset,
  HitsAndTime,
  ReferrerBucket,
  ReferrerBucketRow,
  SiteViewsResult,
} from "./types";

// Still just an env presence check — whether a live backend exists at all.
// The key that used to live here now lives only on the server.
const BASE = !!(import.meta.env.VITE_ANALYTICS_URL as string | undefined);

/** Whether a live backend is configured. When false, live hooks return null. */
export const liveConfigured = BASE;

function headers(): HeadersInit {
  return { Authorization: pb.authStore.token };
}

/** Build an /api/analytics URL from a Worker-shaped `path?query` string. */
function apiUrl(pathAndQuery: string): string | null {
  let site: string;
  try {
    site = siteId();
  } catch {
    return null;
  }
  const [pathname, query = ""] = pathAndQuery.split("?");
  const params = new URLSearchParams(query);
  params.set("site", site);
  params.set("path", pathname);
  return `/api/analytics?${params.toString()}`;
}

/** Fetch JSON via the analytics proxy. `path` null disables the fetch (sim mode). */
function useJson<T>(path: string | null): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    const url = path && BASE ? apiUrl(path) : null;
    if (!url) {
      setData(null);
      return;
    }
    let cancelled = false;
    fetch(url, { headers: headers() })
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

// The bundle is keyed to whichever site was active when it was fetched — on
// an account/site switch it's stale (wrong tenant), so drop it and let
// subscribers refetch for the new scope.
onScopeReset(() => {
  hitsCache = null;
  hitsInflight = false;
  hitsSubs.forEach((f) => f());
  if (hitsSubs.size > 0) loadHits();
});

function loadHits() {
  if (!BASE || hitsCache || hitsInflight) return;
  const url = apiUrl("/query?metric=hits");
  if (!url) return;
  hitsInflight = true;
  fetch(url, { headers: headers() })
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
