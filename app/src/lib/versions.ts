// Append-only version history.
// Offline-first, same contract as posts: a snapshot is written to Dexie first
// and pushed to Supabase straight after. If that push can't happen (no network,
// or the post itself hasn't been INSERTed yet) the row stays `dirty` and the
// sync engine retries it, so a snapshot is never lost to a failed request.

import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { updatePost } from "@/lib/posts";
import type { Post, PostVersion } from "@/types";

export type VersionAuthor = "user" | "mcp:claude-code" | "migration";

// Postgres unique-violation; on post_versions it is either the pkey (our own
// row, already pushed) or the (post_id, version) pair (another writer).
const UNIQUE_VIOLATION = "23505";

interface VersionRow {
  id: string;
  post_id: number;
  version: number;
  content: string;
  attributes: Record<string, unknown>;
  created_at: string;
  created_by: VersionAuthor;
  message: string | null;
}

export function fromVersionRow(r: VersionRow): PostVersion {
  return {
    id: r.id,
    postId: r.post_id,
    version: r.version,
    content: r.content,
    attributes: r.attributes ?? {},
    createdAt: new Date(r.created_at).getTime(),
    createdBy: r.created_by,
    message: r.message,
  };
}

export async function snapshotVersion(
  post: Post,
  createdBy: VersionAuthor = "user",
  message?: string,
): Promise<PostVersion | null> {
  // Compute next version number from local cache (good enough; unique constraint
  // on (post_id, version) will reject duplicates if we race with another writer).
  const latest = await db.versions
    .where("[postId+version]")
    .between([post.id, -Infinity], [post.id, Infinity])
    .reverse()
    .first();
  const nextVersion = (latest?.version ?? 0) + 1;

  // Mint the id here rather than letting Postgres do it, so the row is complete
  // locally and the eventual INSERT is the same row rather than a second one.
  const staged: PostVersion = {
    id: crypto.randomUUID(),
    postId: post.id,
    version: nextVersion,
    content: post.content,
    attributes: {
      title: post.title,
      slug: post.slug,
      type: post.type,
      status: post.status,
      category: post.category,
      tags: post.tags,
      publishedAt: post.publishedAt,
    },
    createdAt: Date.now(),
    createdBy,
    message: message ?? null,
    dirty: true,
  };
  await db.versions.put(staged);

  // A negative post id means the post is still local-only; the FK would reject
  // this. `insertNewPost` re-points the row after the post lands, and the next
  // sync pushes it.
  if (post.id >= 0) await pushVersion(staged);

  return (await db.versions.get(staged.id)) ?? staged;
}

function toVersionRow(v: PostVersion): VersionRow {
  return {
    id: v.id,
    post_id: v.postId,
    version: v.version,
    content: v.content,
    attributes: v.attributes,
    // Send the authored timestamp rather than letting the server default it, so
    // history reads in the order it was written, not the order it was uploaded.
    created_at: new Date(v.createdAt).toISOString(),
    created_by: v.createdBy,
    message: v.message,
  };
}

/**
 * INSERT one staged version and clear its dirty flag. Returns false when the row
 * still needs a retry (offline, or its post isn't on the server yet).
 *
 * The only expected conflict is the unique (post_id, version) pair, which means
 * another writer took that number while we were offline. We renumber past what
 * the server has and retry once — an append-only log doesn't care that a version
 * number moved, only that nothing is dropped.
 */
async function pushVersion(v: PostVersion): Promise<boolean> {
  if (v.postId < 0) return false;

  const { error } = await supabase.from("post_versions").insert(toVersionRow(v));
  if (!error) {
    await db.versions.put({ ...v, dirty: false });
    return true;
  }

  if (error.code === UNIQUE_VIOLATION) {
    // Our own row already made it to the server on an earlier attempt.
    if (error.message.includes("post_versions_pkey")) {
      await db.versions.put({ ...v, dirty: false });
      return true;
    }
    await pullVersionsForPost(v.postId);
    const latest = await db.versions
      .where("[postId+version]")
      .between([v.postId, -Infinity], [v.postId, Infinity])
      .reverse()
      .first();
    const renumbered = { ...v, version: Math.max(latest?.version ?? 0, v.version) + 1 };
    const retry = await supabase.from("post_versions").insert(toVersionRow(renumbered));
    if (retry.error) {
      console.error(`Version push failed for post ${v.postId}:`, retry.error.message);
      return false;
    }
    await db.versions.put({ ...renumbered, dirty: false });
    return true;
  }

  // Network failure or something unrecoverable — keep it dirty and retry later.
  console.error(`Version push failed for post ${v.postId}:`, error.message);
  return false;
}

/**
 * Flush every version still staged locally. Called by the sync engine after
 * posts are pushed, so versions belonging to a just-INSERTed post go out in the
 * same cycle.
 */
export async function pushPendingVersions(): Promise<void> {
  const pending = (await db.versions.toArray()).filter((v) => v.dirty);
  for (const v of pending) await pushVersion(v);
}

export async function pullVersionsForPost(postId: number): Promise<void> {
  const { data, error } = await supabase
    .from("post_versions")
    .select("*")
    .eq("post_id", postId)
    .order("version", { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  await db.transaction("rw", db.versions, async () => {
    for (const row of data ?? []) await db.versions.put(fromVersionRow(row as VersionRow));
  });
}

export async function pullAllVersions(): Promise<void> {
  const lastIso = await db.syncMeta.get("lastVersionPullIso");
  const cursor = typeof lastIso?.value === "string" ? lastIso.value : "1970-01-01T00:00:00.000Z";
  const { data, error } = await supabase
    .from("post_versions")
    .select("*")
    .gt("created_at", cursor)
    .order("created_at", { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  if (!data?.length) return;
  let maxIso = cursor;
  await db.transaction("rw", db.versions, async () => {
    for (const raw of data) {
      const r = raw as VersionRow;
      if (r.created_at > maxIso) maxIso = r.created_at;
      await db.versions.put(fromVersionRow(r));
    }
  });
  await db.syncMeta.put({ key: "lastVersionPullIso", value: maxIso });
}

export async function revertToVersion(postId: number, version: number): Promise<void> {
  const v = await db.versions
    .where("[postId+version]")
    .equals([postId, version])
    .first();
  if (!v) return;
  const current = await db.posts.get(postId);
  if (!current) return;
  // Snapshot the current state first so revert is itself undoable.
  await snapshotVersion(current, "user", `Pre-revert snapshot (was at v${version})`);
  await updatePost(postId, {
    content: v.content,
    title: (v.attributes as Record<string, string>).title ?? current.title,
  });
}
