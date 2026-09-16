// Record<->domain mappers and the local post repository (writes go to Dexie,
// scheduleSync() pushes to PocketBase on idle).

import { db } from "@/lib/db";
import { httpStatus, msToPbDate, newId, pb, pbDateToMs } from "@/lib/pocketbase";
import { scheduleSync } from "@/lib/sync";
import { snapshotVersion } from "@/lib/versions";
import { emitPostContentSaved } from "@/lib/postEvents";
import type { Post, PostStatus } from "@/types";

/** A `posts` record as PocketBase returns it. Empty text is "", empty number 0, empty date "". */
export interface PostRecord {
  id: string;
  legacy_id: number;
  title: string;
  slug: string;
  post_id: string;
  type: string;
  status: PostStatus | "";
  subtitle: string;
  done_at: string;
  published_at: string;
  excerpt: string;
  category: string;
  tags: string[] | null;
  content_md: string;
  notion_id: string;
  favorited: boolean;
  collection_seq: number;
  word_count: number;
  shareable_quotes: string[] | null;
  created: string;
  updated: string;
}

export function fromRecord(r: PostRecord): Post {
  return {
    id: r.id,
    title: r.title ?? "",
    slug: r.slug ?? "",
    postId: r.post_id || null,
    type: r.type,
    status: r.status || null,
    subtitle: r.subtitle || null,
    doneAt: pbDateToMs(r.done_at),
    publishedAt: pbDateToMs(r.published_at),
    excerpt: r.excerpt || null,
    category: r.category || null,
    // Fall back to the legacy single category when tags were never set, so old
    // posts surface their category as a tag without any data migration.
    tags: r.tags ?? (r.category ? [r.category] : []),
    content: r.content_md ?? "",
    notionId: r.notion_id || null,
    favorited: !!r.favorited,
    collectionSeq: r.collection_seq || null,
    wordCount: r.word_count || null,
    shareableQuotes: r.shareable_quotes ?? null,
    createdAt: pbDateToMs(r.created) ?? Date.now(),
    updatedAt: pbDateToMs(r.updated) ?? Date.now(),
  };
}

/** The writable fields. The id travels separately: on create it is the id we minted locally. */
export function toRecord(p: Post) {
  return {
    title: p.title,
    slug: p.slug,
    post_id: p.postId ?? "",
    type: p.type,
    status: p.status ?? "",
    subtitle: p.subtitle ?? "",
    done_at: msToPbDate(p.doneAt),
    published_at: msToPbDate(p.publishedAt),
    excerpt: p.excerpt ?? "",
    category: p.category ?? "",
    tags: p.tags ?? [],
    content_md: p.content,
    notion_id: p.notionId ?? "",
    favorited: p.favorited,
    collection_seq: p.collectionSeq ?? 0,
    word_count: p.wordCount ?? 0,
    shareable_quotes: p.shareableQuotes ?? null,
  };
}

// ---- local mutations ----

export async function updatePost(
  id: string,
  patch: Partial<Omit<Post, "id" | "createdAt">>,
): Promise<void> {
  const existing = await db.posts.get(id);
  if (!existing) return;

  // Auto-derive slug from title while the post is unpublished and the slug
  // hasn't been manually customised. "Customised" is judged against the slug we
  // would have derived from the *previous* title, not against postId: titles
  // save per keystroke, so comparing to postId only ever matched the very first
  // character and left the slug stuck there ("m" for "My brief").
  if (
    patch.title !== undefined &&
    (existing.status ?? "draft") !== "published" &&
    !patch.slug
  ) {
    const { slugify, dedupeSlug, isDerivedSlug } = await import("@/lib/postId");
    if (isDerivedSlug(existing.slug, existing.title, existing.postId)) {
      const taken = new Set(
        (await db.posts.toArray())
          .filter((p) => p.id !== id)
          .map((p) => p.slug)
          .filter(Boolean),
      );
      // A blank title falls back to the post_id code, matching a fresh draft.
      const base = patch.title.trim() ? slugify(patch.title) : existing.postId;
      if (base) patch = { ...patch, slug: dedupeSlug(base, taken) };
    }
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

export async function toggleFavorite(id: string): Promise<void> {
  const p = await db.posts.get(id);
  if (!p) return;
  await updatePost(id, { favorited: !p.favorited });
}

/**
 * Assemble a brand-new local draft and stage it in Dexie. Offline-first: no
 * network. The post gets its final PocketBase id right here (ids are minted on
 * the client) and `dirty: true`, so it renders immediately and `pushPending`
 * creates it server-side on the next sync. Shared by createPost /
 * duplicatePost / the command-palette new-post.
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
    id: newId(),
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
 * first (works offline); sync creates it server-side with the same id.
 * Returns the local post immediately.
 */
export async function createPost(
  type: string,
  fields: { title?: string; content?: string } = {},
): Promise<Post | null> {
  return stageNewPost(type, fields);
}

/**
 * Duplicate a post in the same collection. Same offline-first path as
 * createPost.
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
 * Hard delete. Versions cascade server-side through the relation.
 */
export async function deletePost(id: string): Promise<void> {
  try {
    await pb.collection("posts").delete(id);
  } catch (err) {
    // 404: the post was never pushed, so there is nothing on the server to delete.
    if (httpStatus(err) !== 404) {
      console.error("deletePost failed:", err);
      return;
    }
  }
  await db.posts.delete(id);
  await db.versions.where("postId").equals(id).delete();
}

export async function setPostStatus(id: string, status: PostStatus): Promise<void> {
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
