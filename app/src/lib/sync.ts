// Local-first sync engine. Ported from Anderson with the table swapped to `posts`.
//
// Trigger model:
//  - scheduleSync() debounces by 2s of idle (PRD §4)
//  - flushSync() forces a push (window blur / before unload)
//  - runSync() runs once (push pending → pull updated_at > cursor)

import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { fromRow, toRow, type PostRow } from "@/lib/posts";
import { fromBriefRow, toBriefRow, type BriefRow } from "@/lib/plan/briefs";
import { fromTemplateRow, toTemplateRow, type BriefTemplateRow } from "@/lib/plan/templates";
import { pullAllVersions, pushPendingVersions } from "@/lib/versions";
import { fromCollectionRow } from "@/lib/collections";
import { postSlug } from "@/lib/postId";
import type { Post } from "@/types";

const LAST_PULL_KEY = "lastPullIso";
const LAST_BRIEF_PULL_KEY = "lastBriefPullIso";
const LAST_TEMPLATE_PULL_KEY = "lastTemplatePullIso";
const DEBOUNCE_MS = 2000;

let currentUserId: number | null = null;
let syncInFlight = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let onSyncComplete: (() => void) | null = null;

export function setSyncUser(userId: number | null) {
  currentUserId = userId;
}

export function setSyncListener(listener: (() => void) | null) {
  onSyncComplete = listener;
}

export function scheduleSync() {
  if (currentUserId == null) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void runSync();
  }, DEBOUNCE_MS);
}

export function flushSync(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  return runSync();
}

export async function runSync(): Promise<void> {
  if (currentUserId == null || syncInFlight) return;
  syncInFlight = true;
  try {
    await pushPending();
    // After pushPending: versions staged against a local-only post can only go
    // out once that post has its real server id.
    await pushPendingVersions();
    await pushBriefs();
    await pushBriefTemplates();
    await pullChanges();
    await pullAllVersions();
    await pullCollections();
    await pullBriefs();
    await pullBriefTemplates();
    onSyncComplete?.();
  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    syncInFlight = false;
  }
}

async function pushPending(): Promise<void> {
  const all = await db.posts.toArray();
  const pending = all.filter((p) => p.dirty || !p.syncedAt || p.updatedAt > (p.syncedAt ?? 0));
  if (!pending.length) return;

  // New posts (negative temp id) have never been to the server, which owns the
  // id sequence — they must INSERT (no id) so Postgres assigns one, then get the
  // temp id swapped for the real one. Everything else is an in-place upsert.
  const news = pending.filter((p) => p.id < 0);
  const existing = pending.filter((p) => p.id >= 0);

  for (const p of news) {
    // Isolate failures: one bad insert (network drop, constraint) must not
    // block the rest of the queue. It stays dirty and retries next sync.
    try {
      await insertNewPost(p);
    } catch (err) {
      console.error(`Insert failed for local post ${p.id}:`, err);
    }
  }

  if (!existing.length) return;

  // Fast path: one batch upsert. PostgREST fails the whole batch if any single
  // row is rejected (e.g. a bad enum value), so on error we fall back to
  // per-row upserts — a single poison row can't silently block all syncing.
  const rows = existing.map(toRow);
  const batch = await supabase.from("posts").upsert(rows).select();
  const saved: PostRow[] = [];
  if (batch.error) {
    console.error("Batch push failed, retrying row-by-row:", batch.error);
    for (const p of existing) {
      const { data, error } = await supabase.from("posts").upsert(toRow(p)).select();
      if (error) {
        console.error(`Push failed for post ${p.id} (${p.status}):`, error.message);
        continue;
      }
      if (data?.[0]) saved.push(data[0] as PostRow);
    }
  } else {
    saved.push(...((batch.data ?? []) as PostRow[]));
  }

  const now = Date.now();
  await db.transaction("rw", db.posts, async () => {
    for (const raw of saved) {
      const server = fromRow(raw);
      await db.posts.put({ ...server, syncedAt: now, dirty: false });
    }
  });
}

// Postgres error codes we handle specially when inserting a locally-created post.
const FK_VIOLATION = "23503"; // e.g. collection deleted while we were offline
const UNIQUE_VIOLATION = "23505"; // e.g. another device already took this slug/seq

/**
 * INSERT a post the server has never seen and swap its temp id for the real one.
 *
 * Recovers from the two things that can go wrong after an offline stretch:
 *  - the target collection was deleted → retarget to "Uncategorized"
 *  - slug/seq was taken by another device → re-derive the seq from the server
 * On a network error the row throws out to pushPending, stays dirty, and retries.
 */
async function insertNewPost(local: Post): Promise<void> {
  const tempId = local.id;
  const row = toRow(local);
  delete (row as { id?: number }).id; // let Postgres assign the real id

  let res = await supabase.from("posts").insert(row).select().single();

  if (res.error?.code === FK_VIOLATION) {
    // Collection gone. Move to Uncategorized and re-key the post_id to match.
    const seq = await nextServerSeq("Uncategorized");
    row.type = "Uncategorized";
    row.collection_seq = seq;
    row.post_id = postSlug("Uncategorized", seq);
    if (row.slug === local.postId) row.slug = row.post_id; // untitled draft
    res = await supabase.from("posts").insert(row).select().single();
  } else if (res.error?.code === UNIQUE_VIOLATION) {
    // Another device took this slug/seq. Re-derive from the server and retry.
    const seq = await nextServerSeq(local.type);
    row.collection_seq = seq;
    row.post_id = postSlug(local.type, seq);
    if (row.slug === local.postId) row.slug = row.post_id;
    res = await supabase.from("posts").insert(row).select().single();
  }

  if (res.error) {
    // Non-recoverable (bad enum, RLS, …). Leave it dirty; log and move on.
    console.error(`Insert new post failed for ${tempId}:`, res.error.message);
    return;
  }

  const server = fromRow(res.data as PostRow);
  const now = Date.now();
  await db.transaction("rw", db.posts, db.versions, async () => {
    await db.posts.delete(tempId);
    await db.posts.put({ ...server, syncedAt: now, dirty: false });
    // Re-point any local version rows that referenced the temp id.
    const vs = await db.versions.where("postId").equals(tempId).toArray();
    for (const v of vs) {
      await db.versions.delete(v.id);
      await db.versions.put({ ...v, postId: server.id });
    }
  });

  // If the author is looking at the just-created post, follow it to its real id
  // so the open editor doesn't 404 out from under them.
  if (typeof window !== "undefined" && window.location.hash === `#/post/${tempId}`) {
    window.location.replace(`#/post/${server.id}`);
  }
}

/** Next collection_seq for `type`, read straight from the server (authoritative). */
async function nextServerSeq(type: string): Promise<number> {
  const { data } = await supabase
    .from("posts")
    .select("collection_seq")
    .eq("type", type)
    .order("collection_seq", { ascending: false })
    .limit(1);
  const max = (data?.[0] as { collection_seq: number | null } | undefined)?.collection_seq ?? 0;
  return max + 1;
}

async function pullChanges(): Promise<void> {
  const meta = await db.syncMeta.get(LAST_PULL_KEY);
  const lastPullIso = typeof meta?.value === "string" ? meta.value : "1970-01-01T00:00:00.000Z";

  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .gt("updated_at", lastPullIso)
    .order("updated_at", { ascending: true });
  if (error) {
    console.error("Pull failed:", error);
    return;
  }
  if (!data?.length) return;

  const now = Date.now();
  let maxIso = lastPullIso;
  await db.transaction("rw", db.posts, async () => {
    for (const raw of data) {
      const row = raw as PostRow;
      if (row.updated_at > maxIso) maxIso = row.updated_at;
      const local = await db.posts.get(row.id);
      // Don't clobber a dirty local edit with a stale server pull.
      if (local?.dirty && local.updatedAt > new Date(row.updated_at).getTime()) continue;
      const incoming = fromRow(row);
      await db.posts.put({ ...incoming, syncedAt: now, dirty: false });
    }
  });
  await db.syncMeta.put({ key: LAST_PULL_KEY, value: maxIso });
}

async function pullCollections(): Promise<void> {
  // Full replace — collections are small and deletes must propagate to Dexie.
  const { data, error } = await supabase
    .from("collections")
    .select("*")
    .order("position", { ascending: true });
  if (error) {
    console.error("Pull collections failed:", error);
    return;
  }
  const now = Date.now();
  await db.transaction("rw", db.collections, async () => {
    await db.collections.clear();
    for (const raw of data ?? []) {
      const row = raw as Parameters<typeof fromCollectionRow>[0];
      await db.collections.put({ ...fromCollectionRow(row), syncedAt: now, dirty: false });
    }
  });
}

async function pushBriefs(): Promise<void> {
  const all = await db.briefs.toArray();
  const pending = all.filter((b) => b.dirty || !b.syncedAt || b.updatedAt > (b.syncedAt ?? 0));
  if (!pending.length) return;

  const rows = pending.map(toBriefRow);
  const { data, error } = await supabase.from("briefs").upsert(rows).select();
  if (error) {
    console.error("Push briefs failed:", error);
    return;
  }

  const now = Date.now();
  await db.transaction("rw", db.briefs, async () => {
    for (const raw of data ?? []) {
      const server = fromBriefRow(raw as BriefRow);
      await db.briefs.put({ ...server, syncedAt: now, dirty: false });
    }
  });
}

async function pullBriefs(): Promise<void> {
  const meta = await db.syncMeta.get(LAST_BRIEF_PULL_KEY);
  const lastPullIso = typeof meta?.value === "string" ? meta.value : "1970-01-01T00:00:00.000Z";

  const { data, error } = await supabase
    .from("briefs")
    .select("*")
    .gt("updated_at", lastPullIso)
    .order("updated_at", { ascending: true });
  if (error) {
    console.error("Pull briefs failed:", error);
    return;
  }
  if (!data?.length) return;

  const now = Date.now();
  let maxIso = lastPullIso;
  await db.transaction("rw", db.briefs, async () => {
    for (const raw of data) {
      const row = raw as BriefRow;
      if (row.updated_at > maxIso) maxIso = row.updated_at;
      const local = await db.briefs.get(row.id);
      if (local?.dirty && local.updatedAt > new Date(row.updated_at).getTime()) continue;
      await db.briefs.put({ ...fromBriefRow(row), syncedAt: now, dirty: false });
    }
  });
  await db.syncMeta.put({ key: LAST_BRIEF_PULL_KEY, value: maxIso });
}

async function pushBriefTemplates(): Promise<void> {
  const all = await db.briefTemplates.toArray();
  const pending = all.filter((t) => t.dirty || !t.syncedAt || t.updatedAt > (t.syncedAt ?? 0));
  if (!pending.length) return;

  const rows = pending.map(toTemplateRow);
  const { data, error } = await supabase.from("brief_templates").upsert(rows).select();
  if (error) {
    console.error("Push brief templates failed:", error);
    return;
  }

  const now = Date.now();
  await db.transaction("rw", db.briefTemplates, async () => {
    for (const raw of data ?? []) {
      const server = fromTemplateRow(raw as BriefTemplateRow);
      await db.briefTemplates.put({ ...server, syncedAt: now, dirty: false });
    }
  });
}

async function pullBriefTemplates(): Promise<void> {
  const meta = await db.syncMeta.get(LAST_TEMPLATE_PULL_KEY);
  const lastPullIso = typeof meta?.value === "string" ? meta.value : "1970-01-01T00:00:00.000Z";

  const { data, error } = await supabase
    .from("brief_templates")
    .select("*")
    .gt("updated_at", lastPullIso)
    .order("updated_at", { ascending: true });
  if (error) {
    console.error("Pull brief templates failed:", error);
    return;
  }
  if (!data?.length) return;

  const now = Date.now();
  let maxIso = lastPullIso;
  await db.transaction("rw", db.briefTemplates, async () => {
    for (const raw of data) {
      const row = raw as BriefTemplateRow;
      if (row.updated_at > maxIso) maxIso = row.updated_at;
      const local = await db.briefTemplates.get(row.id);
      if (local?.dirty && local.updatedAt > new Date(row.updated_at).getTime()) continue;
      await db.briefTemplates.put({ ...fromTemplateRow(row), syncedAt: now, dirty: false });
    }
  });
  await db.syncMeta.put({ key: LAST_TEMPLATE_PULL_KEY, value: maxIso });
}

export async function resetSyncState() {
  await db.syncMeta.clear();
  await db.posts.clear();
}

// ---- lifecycle wiring (call from App) ----

let installed = false;
export function installLifecycleHandlers() {
  if (installed) return;
  installed = true;
  window.addEventListener("blur", () => void flushSync());
  window.addEventListener("beforeunload", () => void flushSync());
  window.addEventListener("focus", () => void runSync());
}
