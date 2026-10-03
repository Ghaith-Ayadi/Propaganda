// Record<->domain mappers and the local post repository (writes go to Dexie,
// scheduleSync() pushes to the server on idle).

import { beginWrite, db as activeDb } from "@/lib/db";
import { dateToMs, msToDate, must, newId, sb as activeSb } from "@/lib/supabase";
import { scheduleSync } from "@/lib/sync";
import { dedupe, hasAddress, titleSlug } from "@/lib/slug";
import { announcePublished } from "@/lib/publish";
import { snapshotVersion } from "@/lib/versions";
import { emitPostContentSaved } from "@/lib/postEvents";
import type { Post, PostStatus } from "@/types";

/** A `posts` row. Empty text is "", empty number 0 (as in PocketBase days), empty date null. */
export interface PostRecord {
  id: string;
  legacy_id: number;
  /** Assigned by the server (supabase/migrations, the address triggers); never sent back. */
  number: number;
  title: string;
  slug: string;
  post_id: string;
  type: string;
  status: PostStatus | "";
  subtitle: string;
  done_at: string | null;
  published_at: string | null;
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
    number: r.number || null,
    title: r.title ?? "",
    slug: r.slug ?? "",
    postId: r.post_id || null,
    type: r.type,
    status: r.status || null,
    subtitle: r.subtitle || null,
    doneAt: dateToMs(r.done_at),
    publishedAt: dateToMs(r.published_at),
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
    createdAt: dateToMs(r.created) ?? Date.now(),
    updatedAt: dateToMs(r.updated) ?? Date.now(),
  };
}

/**
 * The writable fields. The id travels separately: on create it is the id we
 * minted locally. `number` is the server's alone and never sent.
 */
export function toRecord(p: Post) {
  return {
    title: p.title,
    slug: p.slug,
    post_id: p.postId ?? "",
    type: p.type,
    status: p.status ?? "",
    subtitle: p.subtitle ?? "",
    done_at: msToDate(p.doneAt),
    published_at: msToDate(p.publishedAt),
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
  const done = beginWrite();
  try {
    await updatePostIn(activeDb, id, patch);
  } finally {
    done();
  }
}

async function updatePostIn(
  // Captured once, by the caller: a scope switch mid-call must not move the write.
  db: typeof activeDb,
  id: string,
  patch: Partial<Omit<Post, "id" | "createdAt">>,
): Promise<void> {
  const existing = await db.posts.get(id);
  if (!existing) return;

  // Until a post has a public address, its slug is its title's: the address is
  // fixed when it's first published (setPostStatus), not before.
  if (patch.title !== undefined && patch.slug === undefined && !hasAddress(existing)) {
    patch = { ...patch, slug: titleSlug(patch.title) };
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
  // Captured once: a scope switch mid-call must not move the write.
  const db = activeDb;
  const p = await db.posts.get(id);
  if (!p) return;
  await updatePost(id, { favorited: !p.favorited });
}

/**
 * Assemble a brand-new local draft and stage it in Dexie. Offline-first: no
 * network. The post gets its final id right here (ids are minted on
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
  // Captured once: a scope switch mid-call must not move the write.
  const db = activeDb;
  const { postSlug } = await import("@/lib/postId");

  const peers = await db.posts.where("type").equals(type).toArray();
  const nextSeq = peers.reduce((m, p) => Math.max(m, p.collectionSeq ?? 0), 0) + 1;
  const pid = postSlug(type, nextSeq);

  // The slug follows the title until the post is first published.
  const title = fields.title ?? "";
  const slug = titleSlug(title);

  const now = Date.now();
  const post: Post = {
    id: newId(),
    number: null, // the server hands it out on the first push
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
 * Hard delete. Versions and redirects cascade server-side through their foreign keys.
 */
export async function deletePost(id: string): Promise<void> {
  // Captured once: a scope switch mid-call must not move the write.
  const db = activeDb;
  const sb = activeSb;
  try {
    // A post that was never pushed matches nothing: there is nothing to delete.
    await must(sb.from("posts").delete().eq("id", id));
  } catch (err) {
    console.error("deletePost failed:", err);
    return;
  }
  await db.posts.delete(id);
  await db.versions.where("postId").equals(id).delete();
}

export async function setPostStatus(id: string, status: PostStatus): Promise<void> {
  // Captured once: a scope switch mid-call must not move the write.
  const db = activeDb;
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
  // First publish: the post gets its address. The slug stops following the
  // title here, made unique among the collection's public posts. The server
  // also counts old addresses kept as redirects, and adds a -2 if it must.
  if (status === "published" && before && !hasAddress(before)) {
    const taken = new Set(
      (await db.posts.where("type").equals(before.type).toArray())
        .filter((p) => p.id !== id && hasAddress(p))
        .map((p) => p.slug),
    );
    patch.slug = dedupe(titleSlug(before.title), taken);
  }

  await updatePost(id, patch);
  if (status === "published" && before && before.status !== "published") announcePublished(db, id);

  // Snapshot version on meaningful status transitions
  const snapshotMessage = status === "done" ? "Done" : status === "published" ? "Published" : null;
  if (snapshotMessage && before?.status !== status) {
    const after = await db.posts.get(id);
    if (after) {
      await snapshotVersion(after, "user", snapshotMessage);
    }
  }
}
