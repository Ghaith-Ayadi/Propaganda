// Unified analytics hook contract. Every dashboard panel reads through
// these hooks. Two adapters under the hood:
//   - simulated: in-memory dataset (./dataset.ts), gated on `useSimMode()`
//   - live: stubbed out for now. When the CF Worker + AE come online,
//           wire real queries here behind the same interface.
//
// Panels never know or care which backend served them.

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Collection, Post } from "@/types";
import { useSimMode } from "./sim";
import { getSimDataset } from "./dataset";
import type {
  BucketRow,
  DateRangePreset,
  ReferrerBucketRow,
  SiteViewsResult,
  TopPostRow,
} from "./types";

function usePostsAndCollections(): { posts: Post[]; collections: Collection[] } {
  const posts = useLiveQuery(() => db.posts.toArray(), [], [] as Post[]);
  const collections = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );
  return { posts, collections };
}

export function useSiteViews(range: DateRangePreset): SiteViewsResult | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  if (!sim) return null; // live not implemented yet — panels render empty state
  const ds = getSimDataset(posts, collections);
  return ds.siteViews(range);
}

export function useTopPosts(range: DateRangePreset, limit = 10): TopPostRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  if (!sim) return null;
  const ds = getSimDataset(posts, collections);
  return ds.topPosts(range, limit);
}

export function useReferrerMix(range: DateRangePreset): ReferrerBucketRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  if (!sim) return null;
  const ds = getSimDataset(posts, collections);
  return ds.referrerMix(range);
}

export function useCountryMix(range: DateRangePreset): BucketRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  if (!sim) return null;
  const ds = getSimDataset(posts, collections);
  return ds.countryMix(range);
}

export function useDeviceMix(range: DateRangePreset): BucketRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  if (!sim) return null;
  const ds = getSimDataset(posts, collections);
  return ds.deviceMix(range);
}
