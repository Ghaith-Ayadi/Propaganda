// Public-blog reads. No Dexie, no sync engine: this view is read-only and
// visited by anonymous readers. Row-level security lets anyone read published
// posts, collections and redirects, nothing else.

import { useEffect, useState } from "react";
import { fetchAll, must, publicSb } from "@/lib/supabase";
import { slugify } from "@/lib/slug";
import type { Collection } from "@/types";

import {
  blogAddress,
  fromBlogRecord,
  fromCollectionRecord,
  PUBLIC_POST_FIELDS as PUBLIC_FIELDS,
  PUBLIC_POST_FIELDS_BEFORE_0190,
  missingContentUpdated,
  type BlogPost,
  type BlogPostRecord,
  type CollectionRecord,
} from "./model";

export { blogAddress, type BlogPost };

// A site's published posts. Undated ones sort as PocketBase sorted its "":
// last when newest first, first when oldest first.
const publishedPosts = (siteId: string, fields: string = postFields) =>
  // Typed as the full list: the legacy list is the same minus one optional column.
  publicSb.from("posts").select(fields as typeof PUBLIC_FIELDS).eq("site", siteId).eq("status", "published");
// The app can run ahead of the schema (the box follows the release tag): a server from
// before migration 20261010000190 rejects `content_updated`, so read without it from then on.
let postFields: string = PUBLIC_FIELDS;
type PostsResult<T> = { data: T; error: { message: string; code?: string } | null; status: number };
async function posts<T>(run: (fields: string) => PromiseLike<PostsResult<T>>): Promise<PostsResult<T>> {
  const r = await run(postFields);
  if (r.error && postFields === PUBLIC_FIELDS && missingContentUpdated(r.error)) {
    postFields = PUBLIC_POST_FIELDS_BEFORE_0190;
    return run(postFields);
  }
  return r;
}
const one = async <T,>(query: PromiseLike<{ data: unknown; error: { message: string } | null; status: number }>): Promise<T | null> =>
  ((await must(query).catch(() => null)) as T | null) ?? null;
const firstOf = async <T,>(query: PromiseLike<{ data: unknown; error: { message: string } | null; status: number }>): Promise<T | null> =>
  (((await must(query).catch(() => null)) as T[] | null) ?? [])[0] ?? null;

export function useBlogData(siteId: string): {
  loading: boolean;
  collections: Collection[];
  posts: BlogPost[];
  error: string | null;
} {
  const [loading, setLoading] = useState(true);
  const [cols, setCols] = useState<Collection[]>([]);
  const [items, setItems] = useState<BlogPost[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [colRecords, postRecords] = await Promise.all([
          fetchAll<CollectionRecord>((from, to) =>
            publicSb.from("collections").select("*").eq("site", siteId).order("position").order("id").range(from, to),
          ),
          fetchAll<BlogPostRecord>((from, to) =>
            posts((f) =>
              publishedPosts(siteId, f)
                .order("published_at", { ascending: false, nullsFirst: false })
                .order("id")
                .range(from, to),
            ),
          ),
        ]);
        if (cancelled) return;
        setCols(colRecords.map(fromCollectionRecord));
        setItems(postRecords.map(fromBlogRecord));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  return { loading, collections: cols, posts: items, error };
}

/**
 * What the Reader gets for a URL: the post; where it lives now (an old address,
 * which it replaces in the URL bar); or a sentinel. Hidden-ness is resolved
 * here so the Reader never holds the body of a post in a private collection.
 */
export type ReaderFetch =
  | { kind: "post"; post: BlogPost }
  | { kind: "moved"; collection: string; slug: string }
  | { kind: "hidden" }
  | { kind: "missing" };

interface RedirectRecord {
  post: string;
}

const redirectAt = (siteId: string) => publicSb.from("post_redirects").select("post").eq("site", siteId);

async function collectionNamed(siteId: string, name: string): Promise<CollectionRecord | null> {
  return one<CollectionRecord>(publicSb.from("collections").select("*").eq("site", siteId).eq("name", name).maybeSingle());
}

/** Where a post lives: its collection's slug (or its type slugified, for legacy posts without one) and its slug. */
async function addressOf(siteId: string, record: BlogPostRecord): Promise<ReaderFetch> {
  const col = await collectionNamed(siteId, record.type);
  return { kind: "moved", collection: col?.slug || slugify(record.type) || "collection", slug: record.slug };
}

async function publishedById(siteId: string, id: string): Promise<BlogPostRecord | null> {
  return one<BlogPostRecord>(posts((f) => publishedPosts(siteId, f).eq("id", id).maybeSingle()));
}

/** A post by its address, /<collection slug>/<post slug>, or where that address now points. */
export async function fetchPostAt(siteId: string, collection: string, slug: string): Promise<ReaderFetch> {
  const col = await one<CollectionRecord>(
    publicSb.from("collections").select("*").eq("site", siteId).eq("slug", collection).maybeSingle(),
  );
  let record: BlogPostRecord | null = null;
  if (col) {
    record = await firstOf<BlogPostRecord>(posts((f) => publishedPosts(siteId, f).eq("type", col.name).eq("slug", slug).order("id").limit(1)));
  } else {
    // Posts whose collection has no record live under their type, slugified.
    const bySlug = (await must(posts((f) => publishedPosts(siteId, f).eq("slug", slug).order("id"))).catch(() => [])) as BlogPostRecord[];
    record = bySlug.find((r) => slugify(r.type) === collection) ?? null;
  }
  if (record) {
    if (col?.is_hidden) return { kind: "hidden" };
    return { kind: "post", post: fromBlogRecord(record) };
  }
  // An old address: the post moved (new slug or collection) after it was published.
  const r = await firstOf<RedirectRecord>(redirectAt(siteId).eq("collection", collection).eq("slug", slug).limit(1));
  const moved = r ? await publishedById(siteId, r.post) : null;
  return moved ? addressOf(siteId, moved) : { kind: "missing" };
}

/**
 * A post by the address it had before collections were part of it, /p/<slug>:
 * always "moved" (or missing). Also takes the legacy post_id code ("THM·08"),
 * and a slug the post has since left behind.
 */
export async function fetchLegacyPost(siteId: string, slug: string): Promise<ReaderFetch> {
  const bySlug = await firstOf<BlogPostRecord>(
    posts((f) => publishedPosts(siteId, f).eq("slug", slug).order("published_at", { ascending: true, nullsFirst: true }).order("id").limit(1)),
  );
  if (bySlug) return addressOf(siteId, bySlug);
  const byCode = await firstOf<BlogPostRecord>(posts((f) => publishedPosts(siteId, f).eq("post_id", slug).order("id").limit(1)));
  if (byCode) return addressOf(siteId, byCode);
  const r = await firstOf<RedirectRecord>(redirectAt(siteId).eq("slug", slug).limit(1));
  const moved = r ? await publishedById(siteId, r.post) : null;
  return moved ? addressOf(siteId, moved) : { kind: "missing" };
}
