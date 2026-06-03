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
import { pullAllVersions } from "@/lib/versions";
import { fromCollectionRow } from "@/lib/collections";

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

  const rows = pending.map(toRow);
  const { data, error } = await supabase.from("posts").upsert(rows).select();
  if (error) {
    console.error("Push failed:", error);
    return;
  }

  const now = Date.now();
  await db.transaction("rw", db.posts, async () => {
    for (const raw of data ?? []) {
      const server = fromRow(raw as PostRow);
      await db.posts.put({ ...server, syncedAt: now, dirty: false });
    }
  });
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
