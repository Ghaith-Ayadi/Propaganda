// Row<->domain mappers and the local post repository (writes go to Dexie,
// scheduleSync() pushes to Supabase on idle).

import { db } from "@/lib/db";
import { scheduleSync } from "@/lib/sync";
import { snapshotVersion } from "@/lib/versions";
import { emitPostContentSaved } from "@/lib/postEvents";
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
  tags: string[] | null;
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
    // Fall back to the legacy single category when tags were never set, so old
    // posts surface their category as a tag without any data migration.
    tags: r.tags ?? (r.category ? [r.category] : []),
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
    tags: p.tags ?? null,
    content_md: p.content,
    notion_id: p.notionId,
    favorited: p.favorited,
    collection_seq: p.collectionSeq ?? null,
    word_count: p.wordCount ?? null,
    shareable_quotes: p.shareableQuotes ?? null,
  };
}

// ---- local mutations ----

/**
 * Mint the next local-only id for a post the server hasn't seen yet.
 *
 * Server ids are positive and serial. We use *negative* ids for posts created
 * locally (typically offline): the sign is an unambiguous "needs INSERT" flag
 * that can never collide with a server id. `pushPending` INSERTs these, gets the
 * real id back, and swaps it in. Ids decrease monotonically so concurrent local
 * drafts stay distinct.
 */
export async function nextTempId(): Promise<number> {
  const smallest = await db.posts.orderBy("id").first();
  return Math.min(0, smallest?.id ?? 0) - 1;
}

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
    const { slugify, dedupeSlug } = await import("@/lib/postId");
    const taken = new Set(
      (await db.posts.toArray())
        .filter((p) => p.id !== id)
        .map((p) => p.slug)
        .filter(Boolean),
    );
    patch = { ...patch, slug: dedupeSlug(slugify(patch.title), taken) };
  }

  const next: Post = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    dirty: true,
  };
  await db.posts.put(next);
  scheduleSync();

  // Announce body saves so optional modules can react. Only fires when the
  // patch carried a word count (i.e. the editor saved content, not a title or
  // status tweak). Harmless no-op when nothing is subscribed.
  if (patch.wordCount !== undefined) {
    emitPostContentSaved({
      id,
      prevWordCount: existing.wordCount,
      wordCount: patch.wordCount ?? null,
    });
  }
}

export async function toggleFavorite(id: number): Promise<void> {
  const p = await db.posts.get(id);
  if (!p) return;
  await updatePost(id, { favorited: !p.favorited });
}

/**
 * Assemble a brand-new local draft and stage it in Dexie. Offline-first: no
 * network — the post gets a negative temp id and `dirty: true`, so it renders
 * immediately and `pushPending` INSERTs it (assigning the real id) on the next
 * sync. Shared by createPost / duplicatePost / the command-palette new-post.
 */
async function stageNewPost(
  type: string,
  fields: {
    title?: string;
    content?: string;
    category?: string | null;
    tags?: string[] | null;
  } = {},
): Promise<Post> {
  const { postSlug, slugify, dedupeSlug } = await import("@/lib/postId");

  const peers = await db.posts.where("type").equals(type).toArray();
  const nextSeq = peers.reduce((m, p) => Math.max(m, p.collectionSeq ?? 0), 0) + 1;
  const pid = postSlug(type, nextSeq);

  // Slug defaults to a sluggified title; blank drafts fall back to the post_id
  // code until the author types a title (updatePost re-derives it then).
  const title = fields.title ?? "";
  const taken = new Set((await db.posts.toArray()).map((p) => p.slug).filter(Boolean));
  const slug = title.trim() ? dedupeSlug(slugify(title), taken) : pid;

  const now = Date.now();
  const post: Post = {
    id: await nextTempId(),
    title,
    slug,
    postId: pid,
    type,
    status: "draft",
    subtitle: null,
    doneAt: null,
    publishedAt: null,
    excerpt: null,
    category: fields.category ?? null,
    tags: fields.tags ?? [],
    content: fields.content ?? "",
    notionId: null,
    favorited: false,
    collectionSeq: nextSeq,
    wordCount: null,
    shareableQuotes: null,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    dirty: true,
  };
  await db.posts.put(post);
  scheduleSync();
  return post;
}

/**
 * Create a blank draft post in `type` (a collection name). Written to Dexie
 * first with a temp id (works offline); the server assigns the real id when
 * sync pushes it. Returns the local post immediately.
 */
export async function createPost(
  type: string,
  fields: { title?: string; content?: string } = {},
): Promise<Post | null> {
  return stageNewPost(type, fields);
}

/**
 * Duplicate a post in the same collection. Same offline-first path as
 * createPost — the copy gets a temp id and is INSERTed on next sync.
 */
export async function duplicatePost(source: Post): Promise<Post | null> {
  return stageNewPost(source.type, {
    title: source.title ? `${source.title} (copy)` : "",
    content: source.content,
    category: source.category,
    tags: source.tags?.length ? source.tags : null,
  });
}

/**
 * Hard delete. Versions cascade via the DB FK.
 */
export async function deletePost(id: number): Promise<void> {
  // A negative id means the post was never pushed — there's nothing on the
  // server to delete, so drop it locally (works offline).
  if (id >= 0) {
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase.from("posts").delete().eq("id", id);
    if (error) {
      console.error("deletePost failed:", error);
      return;
    }
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
