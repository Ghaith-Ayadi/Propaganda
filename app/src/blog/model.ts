// The public blog's data shapes and the mappers from the API's rows, pure of
// any client: blog/data.ts (the browser, through supabase-js) and
// blog/server/ (the rendering function, through PostgREST directly) read the
// same rows and build the same objects, so the markup they render matches.

import { collectionSlugOf } from "@/lib/slug";
import type { Collection } from "@/types";

/** A timestamp column to milliseconds (lib/supabase.ts has the same; that module needs the browser's env). */
export function dateToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// Same shape as lib/collections.ts:fromCollectionRecord, inlined so the blog
// bundle doesn't pull in the editor's Dexie schema.
export interface CollectionRecord {
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

export function fromCollectionRecord(r: CollectionRecord): Collection {
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
  /** The site's post number (supabase/migrations/*_addresses.sql). */
  number: number | null;
  status: "draft" | "done" | "published" | "";
}

export interface BlogPostRecord {
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
  number: number;
  status: "draft" | "done" | "published" | "";
}

/** The columns a public read of `posts` selects. */
export const PUBLIC_POST_FIELDS =
  "id,slug,title,type,subtitle,excerpt,content_md,published_at,updated,word_count,collection_seq,number,status";

export function fromBlogRecord(r: BlogPostRecord): BlogPost {
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
    number: r.number || null,
    status: r.status,
  };
}

/** A post's address from the blog's loaded collections (no request). */
export function blogAddress(post: BlogPost, cols: Collection[]): { collection: string; slug: string } {
  return { collection: collectionSlugOf(post.type, cols), slug: post.slug };
}
