// Public-blog reads against PocketBase. No Dexie, no sync engine: this view is
// read-only and visited by anonymous readers. The collection rules let anyone
// list published posts and collections, nothing else.

import { useEffect, useState } from "react";
import { publicPb, pbDateToMs } from "@/lib/pocketbase";
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
    createdAt: pbDateToMs(r.created) ?? Date.now(),
    updatedAt: pbDateToMs(r.updated) ?? Date.now(),
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
  /** The site's post number (pb_hooks/addresses.pb.js). */
  number: number | null;
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
  published_at: string;
  updated: string;
  word_count: number;
  collection_seq: number;
  number: number;
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
    publishedAt: pbDateToMs(r.published_at),
    updatedAt: pbDateToMs(r.updated) ?? Date.now(),
    wordCount: r.word_count || null,
    collectionSeq: r.collection_seq || null,
    number: r.number || null,
    status: r.status,
  };
}

const PUBLIC_FIELDS =
  "id,slug,title,type,subtitle,excerpt,content_md,published_at,updated,word_count,collection_seq,number,status";

const posts = () => publicPb.collection<BlogPostRecord>("posts");
const collections = () => publicPb.collection<CollectionRecord>("collections");

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
        const siteFilter = publicPb.filter("site = {:site}", { site: siteId });
        const [colRecords, postRecords] = await Promise.all([
          collections().getFullList({ filter: siteFilter, sort: "position" }),
          posts().getFullList({
            filter: publicPb.filter('site = {:site} && status = "published"', { site: siteId }),
            sort: "-published_at",
            fields: PUBLIC_FIELDS,
          }),
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

const redirects = () => publicPb.collection<RedirectRecord>("post_redirects");
const published = (siteId: string, extra: string, params: Record<string, string>) =>
  publicPb.filter(`site = {:site} && status = "published" && ${extra}`, { site: siteId, ...params });

async function collectionNamed(siteId: string, name: string): Promise<CollectionRecord | null> {
  return collections()
    .getFirstListItem(publicPb.filter("site = {:site} && name = {:n}", { site: siteId, n: name }))
    .catch(() => null);
}

/** Where a post lives: its collection's slug (or its type slugified, for legacy posts without one) and its slug. */
async function addressOf(siteId: string, record: BlogPostRecord): Promise<ReaderFetch> {
  const col = await collectionNamed(siteId, record.type);
  return { kind: "moved", collection: col?.slug || slugify(record.type) || "collection", slug: record.slug };
}

async function publishedById(siteId: string, id: string): Promise<BlogPostRecord | null> {
  return posts()
    .getFirstListItem(published(siteId, "id = {:id}", { id }), { fields: PUBLIC_FIELDS })
    .catch(() => null);
}

/** A post by its address, /<collection slug>/<post slug>, or where that address now points. */
export async function fetchPostAt(siteId: string, collection: string, slug: string): Promise<ReaderFetch> {
  const col = await collections()
    .getFirstListItem(publicPb.filter("site = {:site} && slug = {:c}", { site: siteId, c: collection }))
    .catch(() => null);
  let record: BlogPostRecord | null = null;
  if (col) {
    record = await posts()
      .getFirstListItem(published(siteId, "type = {:t} && slug = {:s}", { t: col.name, s: slug }), { fields: PUBLIC_FIELDS })
      .catch(() => null);
  } else {
    // Posts whose collection has no record live under their type, slugified.
    const bySlug = await posts()
      .getFullList({ filter: published(siteId, "slug = {:s}", { s: slug }), fields: PUBLIC_FIELDS })
      .catch(() => [] as BlogPostRecord[]);
    record = bySlug.find((r) => slugify(r.type) === collection) ?? null;
  }
  if (record) {
    if (col?.is_hidden) return { kind: "hidden" };
    return { kind: "post", post: fromBlogRecord(record) };
  }
  // An old address: the post moved (new slug or collection) after it was published.
  const r = await redirects()
    .getFirstListItem(publicPb.filter("site = {:site} && collection = {:c} && slug = {:s}", { site: siteId, c: collection, s: slug }))
    .catch(() => null);
  const moved = r ? await publishedById(siteId, r.post) : null;
  return moved ? addressOf(siteId, moved) : { kind: "missing" };
}

/**
 * A post by the address it had before collections were part of it, /p/<slug>:
 * always "moved" (or missing). Also takes the legacy post_id code ("THM·08"),
 * and a slug the post has since left behind.
 */
export async function fetchLegacyPost(siteId: string, slug: string): Promise<ReaderFetch> {
  const bySlug = await posts()
    .getFullList({ filter: published(siteId, "slug = {:s}", { s: slug }), sort: "published_at", fields: PUBLIC_FIELDS })
    .catch(() => [] as BlogPostRecord[]);
  if (bySlug[0]) return addressOf(siteId, bySlug[0]);
  const byCode = await posts()
    .getFirstListItem(published(siteId, "post_id = {:s}", { s: slug }), { fields: PUBLIC_FIELDS })
    .catch(() => null);
  if (byCode) return addressOf(siteId, byCode);
  const r = await redirects()
    .getFirstListItem(publicPb.filter("site = {:site} && slug = {:s}", { site: siteId, s: slug }))
    .catch(() => null);
  const moved = r ? await publishedById(siteId, r.post) : null;
  return moved ? addressOf(siteId, moved) : { kind: "missing" };
}

/** A post's address from the blog's loaded collections (no request). */
export function blogAddress(post: BlogPost, cols: Collection[]): { collection: string; slug: string } {
  return { collection: collectionSlugOf(post.type, cols), slug: post.slug };
}
