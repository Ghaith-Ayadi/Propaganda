// Append-only version history.
// Versions are written directly to Supabase (small row, infrequent) — no Dexie staging.
// Pulled into Dexie via the sync engine so the UI is offline-readable.

import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { updatePost } from "@/lib/posts";
import type { Post, PostVersion } from "@/types";

export type VersionAuthor = "user" | "mcp:claude-code" | "migration";

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

  const { data, error } = await supabase
    .from("post_versions")
    .insert({
      post_id: post.id,
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
      created_by: createdBy,
      message: message ?? null,
    })
    .select()
    .single();

  if (error) {
    // Race: someone else inserted the same version number. Refresh from server and bump.
    if (error.code === "23505") {
      await pullVersionsForPost(post.id);
      return snapshotVersion(post, createdBy, message);
    }
    console.error("snapshotVersion failed:", error);
    return null;
  }

  const v = fromVersionRow(data as VersionRow);
  await db.versions.put(v);
  return v;
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
