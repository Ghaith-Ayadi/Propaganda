// Unified analytics hook contract. Every dashboard panel reads through
// these hooks. Two adapters under the hood:
//   - simulated: in-memory dataset (./dataset.ts), gated on `useSimMode()`
//   - live:      real aggregates from the CF Worker (./live.ts)
//
// Sim mode wins when active (for demos / screenshots). Otherwise live data is
// returned when a backend is configured; if neither, hooks return null and
// panels render their empty state. Panels never know which backend served them.

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { collectionDisplay } from "@/lib/collections";
import type { Collection, Post } from "@/types";
import { useSimMode } from "./sim";
import { getSimDataset } from "./dataset";
import {
  useLiveCollectionHitsTime,
  useLiveCountryMix,
  useLiveDeviceMix,
  useLivePostHitsTime,
  useLiveReferrerMix,
  useLiveSiteViews,
  useLiveTopPosts,
} from "./live";
import type {
  BucketRow,
  DateRangePreset,
  HitsAndTime,
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
  const live = useLiveSiteViews(range, !sim);
  if (sim) return getSimDataset(posts, collections).siteViews(range);
  return live;
}

export function useTopPosts(range: DateRangePreset, limit = 10): TopPostRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  const live = useLiveTopPosts(range, limit, !sim);
  if (sim) return getSimDataset(posts, collections).topPosts(range, limit);
  if (!live) return null;
  // Enrich raw {postSlug, views, series} with title/collection/emoji from the
  // local DB — same fields the simulator's TopPostRow carries.
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  return live.map((r) => {
    const post = bySlug.get(r.postSlug);
    const type = post?.type ?? "";
    return {
      postSlug: r.postSlug,
      title: post?.title || r.postSlug,
      collection: type,
      emoji: type ? collectionDisplay(type, collections).emoji : null,
      views: r.views,
      series: r.series,
    };
  });
}

export function useReferrerMix(range: DateRangePreset): ReferrerBucketRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  const live = useLiveReferrerMix(range, !sim);
  if (sim) return getSimDataset(posts, collections).referrerMix(range);
  return live;
}

export function useCountryMix(range: DateRangePreset): BucketRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  const live = useLiveCountryMix(range, !sim);
  if (sim) return getSimDataset(posts, collections).countryMix(range);
  return live;
}

export function useDeviceMix(range: DateRangePreset): BucketRow[] | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  const live = useLiveDeviceMix(range, !sim);
  if (sim) return getSimDataset(posts, collections).deviceMix(range);
  return live;
}

/** All-time hits + total reading-seconds for one post. */
export function usePostHitsTime(postSlug: string | null | undefined): HitsAndTime | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  const live = useLivePostHitsTime(postSlug, !sim);
  if (sim) return postSlug ? getSimDataset(posts, collections).postHitsTime(postSlug) : null;
  return live;
}

/** All-time hits + total reading-seconds for a collection. */
export function useCollectionHitsTime(
  collectionName: string | null | undefined,
): HitsAndTime | null {
  const sim = useSimMode();
  const { posts, collections } = usePostsAndCollections();
  const live = useLiveCollectionHitsTime(collectionName, !sim);
  if (sim)
    return collectionName
      ? getSimDataset(posts, collections).collectionHitsTime(collectionName)
      : null;
  return live;
}
