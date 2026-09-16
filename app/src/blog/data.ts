// Public-blog reads against PocketBase. No Dexie, no sync engine: this view is
// read-only and visited by anonymous readers. The collection rules let anyone
// list published posts and collections, nothing else.

import { useEffect, useState } from "react";
import { pb, pbDateToMs } from "@/lib/pocketbase";
import type { Collection } from "@/types";

// Inline the record mapper so the blog bundle doesn't pull in the editor's
// Dexie schema. Same shape as lib/collections.ts:fromCollectionRecord.
interface CollectionRecord {
  id: string;
  name: string;
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
    status: r.status,
  };
}

const PUBLIC_FIELDS =
  "id,slug,title,type,subtitle,excerpt,content_md,published_at,updated,word_count,collection_seq,status";

const posts = () => pb.collection<BlogPostRecord>("posts");
const collections = () => pb.collection<CollectionRecord>("collections");

export function useBlogData(): {
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
          collections().getFullList({ sort: "position" }),
          posts().getFullList({ filter: 'status = "published"', sort: "-published_at", fields: PUBLIC_FIELDS }),
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
  }, []);

  return { loading, collections: cols, posts: items, error };
}

/**
 * Reader fetch result: either the post, or a sentinel saying the collection
 * is hidden. We resolve hidden-ness server-side so the Reader never holds
 * the body of a private post in memory.
 */
export type ReaderFetch =
  | { kind: "post"; post: BlogPost }
  | { kind: "hidden" }
  | { kind: "missing" };

/** Get a single post by slug for the reader view. */
export async function fetchPostBySlug(slug: string): Promise<ReaderFetch> {
  // Primary lookup by slug. Fall back to the immutable post_id code
  // (e.g. "THM·08") so links shared before slugs were derived from titles
  // keep resolving.
  let record = await posts()
    .getFirstListItem(pb.filter('slug = {:s} && status = "published"', { s: slug }), { fields: PUBLIC_FIELDS })
    .catch(() => null);
  if (!record) {
    record = await posts()
      .getFirstListItem(pb.filter('post_id = {:s} && status = "published"', { s: slug }), { fields: PUBLIC_FIELDS })
      .catch(() => null);
  }
  if (!record) return { kind: "missing" };
  // Check the collection's visibility before exposing the post.
  const col = await collections()
    .getFirstListItem(pb.filter("name = {:n}", { n: record.type }), { fields: "is_hidden" })
    .catch(() => null);
  if (col?.is_hidden) return { kind: "hidden" };
  return { kind: "post", post: fromBlogRecord(record) };
}
