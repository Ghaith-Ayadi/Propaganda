// Public-blog reads against Supabase. No Dexie, no sync engine — this view
// is read-only and visited by anonymous readers.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Collection } from "@/types";

// Inline the row mapper so the blog bundle doesn't pull in the editor's
// Dexie schema. Same shape as lib/collections.ts:fromCollectionRow.
interface CollectionRow {
  name: string;
  emoji: string | null;
  description: string | null;
  position: number;
  is_hidden: boolean | null;
  created_at: string;
  updated_at: string;
}
function fromCollectionRow(r: CollectionRow): Collection {
  return {
    name: r.name,
    emoji: r.emoji,
    description: r.description,
    position: r.position,
    isHidden: r.is_hidden ?? false,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export interface BlogPost {
  id: number;
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
  status: "draft" | "published" | null;
}

interface BlogPostRow {
  id: number;
  slug: string;
  title: string;
  type: string;
  subtitle: string | null;
  excerpt: string | null;
  content_md: string | null;
  published_at: string | null;
  updated_at: string;
  word_count: number | null;
  collection_seq: number | null;
  status: "draft" | "published" | null;
}

function fromBlogRow(r: BlogPostRow): BlogPost {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title ?? "",
    type: r.type,
    subtitle: r.subtitle,
    excerpt: r.excerpt,
    content: r.content_md ?? "",
    publishedAt: r.published_at ? new Date(r.published_at).getTime() : null,
    updatedAt: new Date(r.updated_at).getTime(),
    wordCount: r.word_count,
    collectionSeq: r.collection_seq,
    status: r.status,
  };
}

const PUBLIC_COLUMNS =
  "id, slug, title, type, subtitle, excerpt, content_md, published_at, updated_at, word_count, collection_seq, status";

export function useBlogData(): {
  loading: boolean;
  collections: Collection[];
  posts: BlogPost[];
  error: string | null;
} {
  const [loading, setLoading] = useState(true);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [colRes, postRes] = await Promise.all([
          supabase.from("collections").select("*").order("position"),
          supabase
            .from("posts")
            .select(PUBLIC_COLUMNS)
            .eq("status", "published")
            .order("published_at", { ascending: false }),
        ]);
        if (colRes.error) throw colRes.error;
        if (postRes.error) throw postRes.error;
        if (cancelled) return;
        setCollections((colRes.data ?? []).map((r) => fromCollectionRow(r as CollectionRow)));
        setPosts((postRes.data ?? []).map((r) => fromBlogRow(r as BlogPostRow)));
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

  return { loading, collections, posts, error };
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
  let { data } = await supabase
    .from("posts")
    .select(PUBLIC_COLUMNS)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data) {
    ({ data } = await supabase
      .from("posts")
      .select(PUBLIC_COLUMNS)
      .eq("post_id", slug)
      .eq("status", "published")
      .maybeSingle());
  }
  if (!data) return { kind: "missing" };
  const row = data as BlogPostRow;
  // Check the collection's visibility before exposing the post.
  const { data: col } = await supabase
    .from("collections")
    .select("is_hidden")
    .eq("name", row.type)
    .maybeSingle();
  if (col?.is_hidden) return { kind: "hidden" };
  return { kind: "post", post: fromBlogRow(row) };
}
