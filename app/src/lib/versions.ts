// Append-only version history.
// Offline-first, same contract as posts: a snapshot is written to Dexie first
// and pushed to PocketBase straight after. If that push can't happen (no
// network, or the post itself hasn't reached the server yet) the row stays
// `dirty` and the sync engine retries it, so a snapshot is never lost to a
// failed request.

import { fieldError, msToPbDate, newId, pb, pbDateToMs } from "@/lib/pocketbase";
import { db } from "@/lib/db";
import { updatePost } from "@/lib/posts";
import type { Post, PostVersion } from "@/types";

export type VersionAuthor = "user" | "mcp:claude-code" | "migration";

/** A `post_versions` record as PocketBase returns it. */
export interface VersionRecord {
  id: string;
  post: string;
  version: number;
  content: string;
  attributes: Record<string, unknown> | null;
  created_by: VersionAuthor;
  message: string;
  /** When the snapshot was taken on the author's device. `created` is when the server received it. */
  authored: string;
  created: string;
}

export function fromVersionRecord(r: VersionRecord): PostVersion {
  return {
    id: r.id,
    postId: r.post,
    version: r.version,
    content: r.content,
    attributes: r.attributes ?? {},
    createdAt: pbDateToMs(r.authored) ?? pbDateToMs(r.created) ?? Date.now(),
    createdBy: r.created_by,
    message: r.message || null,
  };
}

function toVersionRecord(v: PostVersion) {
  return {
    id: v.id,
    post: v.postId,
    version: v.version,
    content: v.content,
    attributes: v.attributes,
    created_by: v.createdBy,
    message: v.message ?? "",
    // Send the authored timestamp so history reads in the order it was
    // written, not the order it was uploaded.
    authored: msToPbDate(v.createdAt),
  };
}

const versions = () => pb.collection<VersionRecord>("post_versions");

export async function snapshotVersion(
  post: Post,
  createdBy: VersionAuthor = "user",
  message?: string,
): Promise<PostVersion | null> {
  // Compute next version number from local cache (good enough; the unique index
  // on (post, version) will reject duplicates if we race with another writer).
  const latest = await db.versions
    .where("[postId+version]")
    .between([post.id, -Infinity], [post.id, Infinity])
    .reverse()
    .first();
  const nextVersion = (latest?.version ?? 0) + 1;

  // Mint the id here, so the row is complete locally and the eventual create is
  // the same row rather than a second one.
  const staged: PostVersion = {
    id: newId(),
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

  // A post that has never been synced is not on the server yet; the relation
  // would be rejected. The sync engine pushes posts first, then versions.
  if (post.syncedAt) await pushVersion(staged);

  return (await db.versions.get(staged.id)) ?? staged;
}

/**
 * Create one staged version and clear its dirty flag. Returns false when the
 * row still needs a retry (offline, or its post isn't on the server yet).
 *
 * The only expected conflict is the unique (post, version) pair, which means
 * another writer took that number while we were offline. We renumber past what
 * the server has and retry once: an append-only log doesn't care that a version
 * number moved, only that nothing is dropped.
 */
async function pushVersion(v: PostVersion): Promise<boolean> {
  try {
    await versions().create(toVersionRecord(v));
    await db.versions.put({ ...v, dirty: false });
    return true;
  } catch (err) {
    // Our own row already made it to the server on an earlier attempt.
    if (fieldError(err, "id")) {
      await db.versions.put({ ...v, dirty: false });
      return true;
    }
    // The post is not on the server yet: keep the version dirty, retry next sync.
    if (fieldError(err, "post")) return false;

    if (fieldError(err, "version")) {
      await pullVersionsForPost(v.postId);
      const latest = await db.versions
        .where("[postId+version]")
        .between([v.postId, -Infinity], [v.postId, Infinity])
        .reverse()
        .first();
      const renumbered = { ...v, version: Math.max(latest?.version ?? 0, v.version) + 1 };
      try {
        await versions().create(toVersionRecord(renumbered));
        await db.versions.put({ ...renumbered, dirty: false });
        return true;
      } catch (retryErr) {
        console.error(`Version push failed for post ${v.postId}:`, retryErr);
        return false;
      }
    }

    // Network failure or something unrecoverable: keep it dirty and retry later.
    console.error(`Version push failed for post ${v.postId}:`, err);
    return false;
  }
}

/**
 * Flush every version still staged locally. Called by the sync engine after
 * posts are pushed, so versions belonging to a just-created post go out in the
 * same cycle.
 */
export async function pushPendingVersions(): Promise<void> {
  const pending = (await db.versions.toArray()).filter((v) => v.dirty);
  for (const v of pending) await pushVersion(v);
}

export async function pullVersionsForPost(postId: string): Promise<void> {
  let records: VersionRecord[];
  try {
    records = await versions().getFullList({
      filter: pb.filter("post = {:p}", { p: postId }),
      sort: "version",
    });
  } catch (err) {
    console.error(err);
    return;
  }
  await db.transaction("rw", db.versions, async () => {
    for (const r of records) await db.versions.put(fromVersionRecord(r));
  });
}

const VERSION_CURSOR_KEY = "lastVersionPullPb";

export async function pullAllVersions(): Promise<void> {
  const meta = await db.syncMeta.get(VERSION_CURSOR_KEY);
  const since = typeof meta?.value === "string" ? meta.value : "1970-01-01T00:00:00.000Z";
  let records: VersionRecord[];
  try {
    records = await versions().getFullList({
      filter: pb.filter("created > {:since}", { since: new Date(since) }),
      sort: "created",
    });
  } catch (err) {
    console.error(err);
    return;
  }
  if (!records.length) return;
  let maxMs = Date.parse(since);
  await db.transaction("rw", db.versions, async () => {
    for (const r of records) {
      const ms = pbDateToMs(r.created) ?? 0;
      if (ms > maxMs) maxMs = ms;
      await db.versions.put(fromVersionRecord(r));
    }
  });
  await db.syncMeta.put({ key: VERSION_CURSOR_KEY, value: new Date(maxMs).toISOString() });
}

export async function revertToVersion(postId: string, version: number): Promise<void> {
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
