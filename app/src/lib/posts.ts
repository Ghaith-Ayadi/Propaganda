// Row<->domain mappers and the local post repository (writes go to Dexie,
// scheduleSync() pushes to Supabase on idle).

import { db } from "@/lib/db";
import { scheduleSync } from "@/lib/sync";
import { snapshotVersion } from "@/lib/versions";
import type { Post, PostStatus } from "@/types";

export interface PostRow {
  id: number;
  title: string;
  slug: string;
  post_id: string | null;
  type: string;
  status: PostStatus | null;
  subtitle: string | null;
  done_at: string | null;
  published_at: string | null;
  excerpt: string | null;
  category: string | null;
  content_md: string | null;
  notion_id: string | null;
  favorited: boolean;
  collection_seq: number | null;
  word_count: number | null;
  shareable_quotes: string[] | null;
  created_at: string;
  updated_at: string;
}

const isoToMs = (s: string | null): number | null => (s ? new Date(s).getTime() : null);
const msToIso = (n: number | null): string | null => (n ? new Date(n).toISOString() : null);

export function fromRow(r: PostRow): Post {
  return {
    id: r.id,
    title: r.title ?? "",
    slug: r.slug ?? "",
    postId: r.post_id ?? null,
    type: r.type,
    status: r.status,
    subtitle: r.subtitle ?? null,
    doneAt: isoToMs(r.done_at),
    publishedAt: isoToMs(r.published_at),
    excerpt: r.excerpt,
    category: r.category,
    content: r.content_md ?? "",
    notionId: r.notion_id,
    favorited: !!r.favorited,
    collectionSeq: r.collection_seq ?? null,
    wordCount: r.word_count ?? null,
    shareableQuotes: r.shareable_quotes ?? null,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export function toRow(p: Post): Partial<PostRow> {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    post_id: p.postId ?? null,
    type: p.type,
    status: p.status,
    subtitle: p.subtitle ?? null,
    done_at: msToIso(p.doneAt),
    published_at: msToIso(p.publishedAt),
    excerpt: p.excerpt,
    category: p.category,
    content_md: p.content,
    notion_id: p.notionId,
    favorited: p.favorited,
    collection_seq: p.collectionSeq ?? null,
    word_count: p.wordCount ?? null,
    shareable_quotes: p.shareableQuotes ?? null,
  };
}

// ---- local mutations ----

export async function updatePost(
  id: number,
  patch: Partial<Omit<Post, "id" | "createdAt">>,
): Promise<void> {
  const existing = await db.posts.get(id);
  if (!existing) return;

  // Auto-derive slug from title while the post is unpublished and slug
  // hasn't been manually customised (i.e., slug still equals postId).
  if (
    patch.title !== undefined &&
    (existing.status ?? "draft") !== "published" &&
    !patch.slug &&
    existing.postId &&
    existing.slug === existing.postId
  ) {
    const { slugify } = await import("@/lib/postId");
    patch = { ...patch, slug: slugify(patch.title) };
  }

  const next: Post = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    dirty: true,
  };
  await db.posts.put(next);
  scheduleSync();
}

export async function toggleFavorite(id: number): Promise<void> {
  const p = await db.posts.get(id);
  if (!p) return;
  await updatePost(id, { favorited: !p.favorited });
}

/**
 * Create a blank draft post in `type` (a collection name). The server assigns
 * the integer id; the collection_seq is computed client-side. Mirrors the
 * command-palette "new post" flow so a brief can spin up its linked post.
 */
export async function createPost(
  type: string,
  fields: { title?: string; content?: string } = {},
): Promise<Post | null> {
  const { supabase } = await import("@/lib/supabase");
  const { postSlug } = await import("@/lib/postId");

  const peers = await db.posts.where("type").equals(type).toArray();
  const nextSeq = peers.reduce((m, p) => Math.max(m, p.collectionSeq ?? 0), 0) + 1;
  const pid = postSlug(type, nextSeq);

  const { data, error } = await supabase
    .from("posts")
    .insert({
      title: fields.title ?? "",
      slug: pid,
      post_id: pid,
      type,
      status: "draft",
      content_md: fields.content ?? "",
      collection_seq: nextSeq,
    })
    .select()
    .single();
  if (error) {
    console.error("createPost failed:", error);
    return null;
  }
  const post = fromRow(data as PostRow);
  await db.posts.put({ ...post, syncedAt: Date.now(), dirty: false });
  return post;
}

/**
 * Duplicate a post in the same collection. Server assigns a new integer id;
 * we compute the next collection_seq client-side.
 */
export async function duplicatePost(source: import("@/types").Post): Promise<import("@/types").Post | null> {
  const { supabase } = await import("@/lib/supabase");
  const { postSlug } = await import("@/lib/postId");

  const peers = await db.posts.where("type").equals(source.type).toArray();
  const nextSeq = peers.reduce((m, p) => Math.max(m, p.collectionSeq ?? 0), 0) + 1;

  const pid = postSlug(source.type, nextSeq);
  const { data, error } = await supabase
    .from("posts")
    .insert({
      title: source.title ? `${source.title} (copy)` : "",
      slug: pid,
      post_id: pid,
      type: source.type,
      status: "draft",
      content_md: source.content,
      collection_seq: nextSeq,
      category: source.category,
    })
    .select()
    .single();
  if (error) {
    console.error("duplicatePost failed:", error);
    return null;
  }
  const post = fromRow(data as PostRow);
  await db.posts.put({ ...post, syncedAt: Date.now(), dirty: false });
  return post;
}

/**
 * Hard delete. Versions cascade via the DB FK.
 */
export async function deletePost(id: number): Promise<void> {
  const { supabase } = await import("@/lib/supabase");
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) {
    console.error("deletePost failed:", error);
    return;
  }
  await db.posts.delete(id);
  await db.versions.where("postId").equals(id).delete();
}

export async function setPostStatus(id: number, status: PostStatus): Promise<void> {
  const before = await db.posts.get(id);
  const patch: Partial<Post> = { status };
  const now = Date.now();

  // doneAt: stamp on first transition out of draft (whether going to "done" or skipping straight to "published")
  if ((status === "done" || status === "published") && before && !before.doneAt) {
    patch.doneAt = now;
  }
  if (status === "published" && before && !before.publishedAt) {
    patch.publishedAt = now;
  }

  await updatePost(id, patch);

  // Snapshot version on meaningful status transitions
  const snapshotMessage = status === "done" ? "Done" : status === "published" ? "Published" : null;
  if (snapshotMessage && before?.status !== status) {
    const after = await db.posts.get(id);
    if (after) {
      await snapshotVersion(after, "user", snapshotMessage);
    }
  }
}
