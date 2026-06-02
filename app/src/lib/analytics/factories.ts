// Mock data factories. Composed by ./dataset.ts into the single rich
// dataset that `/simulateTraffic` loads. Every factory takes a seeded
// `rng` so output is deterministic across reloads.

import type { Collection, Post } from "@/types";
import { collectionDisplay } from "@/lib/collections";
import { powerLaw, randInt, weightedPick } from "./prng";
import type { DayPoint, ReferrerBucket, ReferrerBucketRow, TopPostRow, BucketRow } from "./types";

// Calendar window: 30 days ending today. Same for every panel — so
// time-series panels line up across the dashboard.
export const SIM_DAYS = 30;

export function daysAgoStr(daysAgo: number, now = Date.now()): string {
  const d = new Date(now - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Per-post permanent baseline. Power-law-distributed so a handful of
 * posts dominate. One post is forced to be "viral" (10× normal) and
 * one is the "HN spike" post that gets an anomaly day.
 */
export interface PostBaseline {
  postSlug: string;
  title: string;
  collection: string;
  emoji: string | null;
  baseDaily: number; // average views/day for this post
  avgSecondsPerVisit: number; // synthesized: how long the typical visitor lingers
  isViral: boolean;
  isHnSpike: boolean;
}

export function buildPostBaselines(
  posts: Post[],
  collections: Collection[],
  rng: () => number,
): PostBaseline[] {
  // Prefer published posts as the "main" content. Drafts get tiny numbers.
  const ordered = [...posts].sort((a, b) => {
    const ap = a.status === "published" ? 0 : 1;
    const bp = b.status === "published" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt);
  });

  // Reserve indexes for special posts. Picked deterministically from the
  // top published posts so the same posts always play the same role.
  const viralIdx = 2; // 3rd published post: the viral one
  const hnIdx = 5;    // 6th published post: the HN-spike one

  return ordered.map((p, i) => {
    const isViral = i === viralIdx && p.status === "published";
    const isHnSpike = i === hnIdx && p.status === "published";
    // Power-law: tiny number, blown up. Top posts ~30/day, long tail ~0.1/day.
    const rank01 = powerLaw(rng, 2.2);
    let baseDaily = 0.3 + rank01 * 30;
    if (p.status !== "published") baseDaily *= 0.05; // drafts: scraps
    if (isViral) baseDaily = 60 + rng() * 20; // sustained high
    const d = collectionDisplay(p.type, collections);

    // Avg time per visit: most posts 60–180s. Viral and HN-spike posts get
    // less attention per visitor (skim / driveby). Tiny posts shorter too.
    let avgSecondsPerVisit = 60 + rng() * 120;
    if (isViral) avgSecondsPerVisit = 25 + rng() * 35;
    else if (isHnSpike) avgSecondsPerVisit = 30 + rng() * 30;
    else if ((p.wordCount ?? 0) < 200) avgSecondsPerVisit = 20 + rng() * 40;
    else if ((p.wordCount ?? 0) > 1500) avgSecondsPerVisit = 180 + rng() * 240;

    return {
      postSlug: p.slug,
      title: p.title || "Untitled",
      collection: p.type,
      emoji: d.emoji,
      baseDaily,
      avgSecondsPerVisit,
      isViral,
      isHnSpike,
    };
  });
}

/** Total hits per post over the whole simulated window. */
export function buildPostHits(perPostSeries: Map<string, DayPoint[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [slug, series] of perPostSeries) {
    out.set(slug, series.reduce((s, p) => s + p.value, 0));
  }
  return out;
}

/** Total reading-time seconds per post: hits × avgSecondsPerVisit. */
export function buildPostReadSeconds(
  baselines: PostBaseline[],
  postHits: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of baselines) {
    const hits = postHits.get(b.postSlug) ?? 0;
    out.set(b.postSlug, Math.round(hits * b.avgSecondsPerVisit));
  }
  return out;
}

/** Roll per-post numbers up to per-collection. */
export function buildCollectionTotals(
  baselines: PostBaseline[],
  postHits: Map<string, number>,
  postSeconds: Map<string, number>,
): Map<string, { hits: number; seconds: number }> {
  const out = new Map<string, { hits: number; seconds: number }>();
  for (const b of baselines) {
    const cur = out.get(b.collection) ?? { hits: 0, seconds: 0 };
    cur.hits += postHits.get(b.postSlug) ?? 0;
    cur.seconds += postSeconds.get(b.postSlug) ?? 0;
    out.set(b.collection, cur);
  }
  return out;
}

/**
 * Per-post per-day time series for the SIM_DAYS window. Applies:
 *   - weekday/weekend rhythm (weekend −30%)
 *   - viral lift (a 7-day plateau around day 18, then decay)
 *   - HN spike (a single ~11× day at day 23 for the HN-spike post)
 *   - noise
 */
export function buildPostDailySeries(
  baselines: PostBaseline[],
  rng: () => number,
  now = Date.now(),
): Map<string /* postSlug */, DayPoint[]> {
  const out = new Map<string, DayPoint[]>();
  for (const b of baselines) {
    const series: DayPoint[] = [];
    for (let d = SIM_DAYS - 1; d >= 0; d--) {
      const date = new Date(now - d * 86_400_000);
      const weekday = date.getDay(); // 0..6, 0 = Sun
      const isWeekend = weekday === 0 || weekday === 6;
      let v = b.baseDaily;
      if (isWeekend) v *= 0.7;

      // Viral plateau: days 21..15 ago, lifted ×3, then taper.
      const daysAgo = d;
      if (b.isViral) {
        if (daysAgo >= 15 && daysAgo <= 21) v *= 3.0;
        else if (daysAgo < 15) v *= 1.2 + (15 - daysAgo) * 0.04;
      }
      // HN spike: one day, ~11× normal.
      if (b.isHnSpike && daysAgo === 6) v *= 11;

      // Noise: ±30%.
      v *= 0.7 + rng() * 0.6;
      series.push({ day: date.toISOString().slice(0, 10), value: Math.max(0, Math.round(v)) });
    }
    out.set(b.postSlug, series);
  }
  return out;
}

/** Sum a date range from the full series. `range` in days, or `all`. */
export function rangeTotal(series: DayPoint[], days: number | "all"): number {
  const slice = days === "all" ? series : series.slice(-days);
  return slice.reduce((s, p) => s + p.value, 0);
}

/** Same-length preceding window (for delta computations). */
export function previousRangeTotal(series: DayPoint[], days: number | "all"): number {
  if (days === "all") return 0;
  const cutoff = series.length - days;
  const start = Math.max(0, cutoff - days);
  return series.slice(start, cutoff).reduce((s, p) => s + p.value, 0);
}

/** Aggregate every post's daily series into a site-wide daily series. */
export function siteDailySeries(perPost: Map<string, DayPoint[]>): DayPoint[] {
  const acc = new Map<string, number>();
  for (const series of perPost.values()) {
    for (const p of series) acc.set(p.day, (acc.get(p.day) ?? 0) + p.value);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, value]) => ({ day, value }));
}

// --- buckets ---------------------------------------------------------------

const REFERRER_TEMPLATE: ReadonlyArray<{ bucket: ReferrerBucket; label: string; weight: number }> = [
  { bucket: "direct", label: "Direct / unknown", weight: 38 },
  { bucket: "search:google", label: "Google search", weight: 26 },
  { bucket: "search:bing", label: "Bing search", weight: 3 },
  { bucket: "social:twitter", label: "Twitter / X", weight: 9 },
  { bucket: "social:bluesky", label: "Bluesky", weight: 5 },
  { bucket: "social:hn", label: "Hacker News", weight: 12 }, // bumped by the HN spike
  { bucket: "email", label: "Email / newsletter", weight: 4 },
  { bucket: "other", label: "Other sites", weight: 3 },
];

export function buildReferrerMix(totalViews: number, rng: () => number): ReferrerBucketRow[] {
  // Jitter the template weights a touch so it doesn't look too clean.
  const weights = REFERRER_TEMPLATE.map((r) => ({
    ...r,
    weight: r.weight * (0.85 + rng() * 0.3),
  }));
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  return weights
    .map((w) => {
      const pct = w.weight / sum;
      return { bucket: w.bucket, label: w.label, value: Math.round(totalViews * pct), pct };
    })
    .sort((a, b) => b.value - a.value);
}

const COUNTRIES: ReadonlyArray<{ code: string; label: string; weight: number }> = [
  { code: "US", label: "United States", weight: 32 },
  { code: "GB", label: "United Kingdom", weight: 9 },
  { code: "DE", label: "Germany", weight: 7 },
  { code: "CA", label: "Canada", weight: 6 },
  { code: "FR", label: "France", weight: 5 },
  { code: "NL", label: "Netherlands", weight: 4 },
  { code: "AU", label: "Australia", weight: 4 },
  { code: "IN", label: "India", weight: 4 },
  { code: "PL", label: "Poland", weight: 3 },
  { code: "BR", label: "Brazil", weight: 3 },
  { code: "MA", label: "Morocco", weight: 2 },
  { code: "JP", label: "Japan", weight: 2 },
];

export function buildCountryMix(totalViews: number, rng: () => number): BucketRow[] {
  const weights = COUNTRIES.map((c) => ({ ...c, weight: c.weight * (0.85 + rng() * 0.3) }));
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  return weights
    .map((c) => {
      const pct = c.weight / sum;
      return { label: `${flag(c.code)}  ${c.label}`, value: Math.round(totalViews * pct), pct };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

const DEVICES: ReadonlyArray<{ label: string; weight: number }> = [
  { label: "Mobile", weight: 62 },
  { label: "Desktop", weight: 33 },
  { label: "Tablet", weight: 5 },
];

export function buildDeviceMix(totalViews: number, rng: () => number): BucketRow[] {
  const weights = DEVICES.map((d) => ({ ...d, weight: d.weight * (0.9 + rng() * 0.2) }));
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  return weights.map((d) => ({
    label: d.label,
    value: Math.round(totalViews * (d.weight / sum)),
    pct: d.weight / sum,
  }));
}

// Country code → emoji flag.
function flag(cc: string): string {
  return cc
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + (c.charCodeAt(0) - 65)))
    .join("");
}

// Re-exported helper — keep weightedPick reachable from dataset code.
export { weightedPick, randInt };

/** Build TopPostRow[] from baselines + per-post series. */
export function buildTopPosts(
  baselines: PostBaseline[],
  perPostSeries: Map<string, DayPoint[]>,
  days: number | "all",
): TopPostRow[] {
  return baselines
    .map<TopPostRow>((b) => {
      const series = perPostSeries.get(b.postSlug) ?? [];
      const sparkSeries = series.slice(-14);
      return {
        postSlug: b.postSlug,
        title: b.title,
        collection: b.collection,
        emoji: b.emoji,
        views: rangeTotal(series, days),
        series: sparkSeries,
      };
    })
    .sort((a, b) => b.views - a.views);
}
