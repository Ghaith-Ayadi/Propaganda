// Public-blog reads. No Dexie, no sync engine: this view is read-only and
// visited by anonymous readers. Row-level security lets anyone read published
// posts, collections and redirects, nothing else.

import { useEffect, useState } from "react";
import { dateToMs, fetchAll, must, publicSb } from "@/lib/supabase";
import { collectionSlugOf, slugify } from "@/lib/slug";
import type { Collection } from "@/types";

// Inline the record mapper so the blog bundle doesn't pull in the editor's
// Dexie schema. Same shape as lib/collections.ts:fromCollectionRecord.
interface CollectionRecord {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  position: number;
  is_hidden: boolean;
  created: string;
  updated: string;
}
function fromCollectionRecord(r: CollectionRecord): Collection {
  return {
    name: r.name,
    slug: r.slug ?? "",
    emoji: r.emoji || null,
    description: r.description || null,
    position: r.position,
    isHidden: !!r.is_hidden,
    createdAt: dateToMs(r.created) ?? Date.now(),
    updatedAt: dateToMs(r.updated) ?? Date.now(),
  };
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  type: string;
  subtitle: string | null;
  excerpt: string | null;
  content: string;
  publishedAt: number | null;
  updatedAt: number;
  wordCount: number | null;
  collectionSeq: number | null;
  status: "draft" | "done" | "published" | "";
}

interface BlogPostRecord {
  id: string;
  slug: string;
  title: string;
  type: string;
  subtitle: string;
  excerpt: string;
  content_md: string;
  published_at: string | null;
  updated: string;
  word_count: number;
  collection_seq: number;
  status: "draft" | "done" | "published" | "";
}

function fromBlogRecord(r: BlogPostRecord): BlogPost {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title ?? "",
    type: r.type,
    subtitle: r.subtitle || null,
    excerpt: r.excerpt || null,
    content: r.content_md ?? "",
    publishedAt: dateToMs(r.published_at),
    updatedAt: dateToMs(r.updated) ?? Date.now(),
    wordCount: r.word_count || null,
    collectionSeq: r.collection_seq || null,
    status: r.status,
  };
}

const PUBLIC_FIELDS =
  "id,slug,title,type,subtitle,excerpt,content_md,published_at,updated,word_count,collection_seq,status";

// A site's published posts. Undated ones sort as PocketBase sorted its "":
// last when newest first, first when oldest first.
const publishedPosts = (siteId: string) =>
  publicSb.from("posts").select(PUBLIC_FIELDS).eq("site", siteId).eq("status", "published");
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
            publishedPosts(siteId)
              .order("published_at", { ascending: false, nullsFirst: false })
              .order("id")
              .range(from, to),
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
  return one<BlogPostRecord>(publishedPosts(siteId).eq("id", id).maybeSingle());
}

/** A post by its address, /<collection slug>/<post slug>, or where that address now points. */
export async function fetchPostAt(siteId: string, collection: string, slug: string): Promise<ReaderFetch> {
  const col = await one<CollectionRecord>(
    publicSb.from("collections").select("*").eq("site", siteId).eq("slug", collection).maybeSingle(),
  );
  let record: BlogPostRecord | null = null;
  if (col) {
    record = await firstOf<BlogPostRecord>(publishedPosts(siteId).eq("type", col.name).eq("slug", slug).order("id").limit(1));
  } else {
    // Posts whose collection has no record live under their type, slugified.
    const bySlug = (await must(publishedPosts(siteId).eq("slug", slug).order("id")).catch(() => [])) as BlogPostRecord[];
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
    publishedPosts(siteId).eq("slug", slug).order("published_at", { ascending: true, nullsFirst: true }).order("id").limit(1),
  );
  if (bySlug) return addressOf(siteId, bySlug);
  const byCode = await firstOf<BlogPostRecord>(publishedPosts(siteId).eq("post_id", slug).order("id").limit(1));
  if (byCode) return addressOf(siteId, byCode);
  const r = await firstOf<RedirectRecord>(redirectAt(siteId).eq("slug", slug).limit(1));
  const moved = r ? await publishedById(siteId, r.post) : null;
  return moved ? addressOf(siteId, moved) : { kind: "missing" };
}

/** A post's address from the blog's loaded collections (no request). */
export function blogAddress(post: BlogPost, cols: Collection[]): { collection: string; slug: string } {
  return { collection: collectionSlugOf(post.type, cols), slug: post.slug };
}
