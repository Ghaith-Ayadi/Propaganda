// The single rich dataset loaded by `/simulateTraffic`. Built once per
// (posts, collections) snapshot and memoized. All factories pull from
// this object so every panel sees a consistent world.

import type { Collection, Post } from "@/types";
import { mulberry32 } from "./prng";
import { SIM_SEED } from "./sim";
import {
  buildCountryMix,
  buildDeviceMix,
  buildPostBaselines,
  buildPostDailySeries,
  buildReferrerMix,
  buildTopPosts,
  previousRangeTotal,
  rangeTotal,
  siteDailySeries,
  SIM_DAYS,
  type PostBaseline,
} from "./factories";
import type { BucketRow, DateRangePreset, DayPoint, ReferrerBucketRow, SiteViewsResult, TopPostRow } from "./types";

function rangeDays(preset: DateRangePreset): number | "all" {
  switch (preset) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90; // clamped by SIM_DAYS, fine
    case "all": return "all";
  }
}

export interface SimDataset {
  baselines: PostBaseline[];
  perPostSeries: Map<string, DayPoint[]>;
  siteSeries: DayPoint[];

  siteViews(range: DateRangePreset): SiteViewsResult;
  topPosts(range: DateRangePreset, limit?: number): TopPostRow[];
  referrerMix(range: DateRangePreset): ReferrerBucketRow[];
  countryMix(range: DateRangePreset): BucketRow[];
  deviceMix(range: DateRangePreset): BucketRow[];
}

let cache: { posts: Post[]; collections: Collection[]; dataset: SimDataset } | null = null;

export function getSimDataset(posts: Post[], collections: Collection[]): SimDataset {
  // Trivial referential-identity memo. Posts/collections come from
  // useLiveQuery so the references are stable across renders until the
  // underlying tables change.
  if (cache && cache.posts === posts && cache.collections === collections) {
    return cache.dataset;
  }

  const rng = mulberry32(SIM_SEED);
  const baselines = buildPostBaselines(posts, collections, rng);
  const perPostSeries = buildPostDailySeries(baselines, rng);
  const siteSeries = siteDailySeries(perPostSeries);

  const dataset: SimDataset = {
    baselines,
    perPostSeries,
    siteSeries,

    siteViews(range) {
      const days = rangeDays(range);
      return {
        total: rangeTotal(siteSeries, days),
        previousTotal: previousRangeTotal(siteSeries, days),
        series: days === "all" ? siteSeries : siteSeries.slice(-days),
      };
    },

    topPosts(range, limit = 10) {
      return buildTopPosts(baselines, perPostSeries, rangeDays(range)).slice(0, limit);
    },

    referrerMix(range) {
      const total = rangeTotal(siteSeries, rangeDays(range));
      return buildReferrerMix(total, mulberry32(SIM_SEED ^ 0xa1));
    },

    countryMix(range) {
      const total = rangeTotal(siteSeries, rangeDays(range));
      return buildCountryMix(total, mulberry32(SIM_SEED ^ 0xb2));
    },

    deviceMix(range) {
      const total = rangeTotal(siteSeries, rangeDays(range));
      return buildDeviceMix(total, mulberry32(SIM_SEED ^ 0xc3));
    },
  };

  cache = { posts, collections, dataset };
  return dataset;
}

export { SIM_DAYS };
