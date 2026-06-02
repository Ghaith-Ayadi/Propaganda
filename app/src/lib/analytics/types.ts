// Shared analytics types. Stable contract that every panel consumes — the
// live (CF AE) adapter and the simulated adapter both return these shapes.

export type DateRangePreset = "7d" | "30d" | "90d" | "all";

/** A single day's value in a time series. `day` is a YYYY-MM-DD string. */
export interface DayPoint {
  day: string;
  value: number;
}

export interface SiteViewsResult {
  total: number;
  previousTotal: number; // same-length window ending where this one starts
  series: DayPoint[];
}

export interface TopPostRow {
  postSlug: string;
  title: string;
  collection: string;
  emoji: string | null;
  views: number;
  series: DayPoint[]; // 14-day mini sparkline
}

export interface BucketRow {
  label: string;
  value: number;
  pct: number; // 0..1
}

export type ReferrerBucket =
  | "direct"
  | "search:google"
  | "search:bing"
  | "social:twitter"
  | "social:bluesky"
  | "social:hn"
  | "email"
  | "other";

export interface ReferrerBucketRow extends BucketRow {
  bucket: ReferrerBucket;
}
