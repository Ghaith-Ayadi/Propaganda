// Local-first sync engine. Ported from Anderson with the table swapped to `posts`.
//
// Trigger model:
//  - scheduleSync() debounces by 2s of idle (PRD §4)
//  - flushSync() forces a push (window blur / before unload)
//  - runSync() runs once (push pending -> pull updated > cursor)
//
// Identity: every record is created locally with its final PocketBase id (see
// lib/pocketbase.ts newId), so a push is "create if never synced, else update"
// and nothing is ever re-keyed. The server owns `updated`; conflicts resolve by
// server clock, and a dirty local edit newer than the server's copy wins locally
// until it is pushed.

import { db } from "@/lib/db";
import { fieldError, httpStatus, pb, pbDateToMs } from "@/lib/pocketbase";
import { fromRecord, toRecord, type PostRecord } from "@/lib/posts";
import { fromBriefRecord, toBriefRecord, type BriefRecord } from "@/lib/plan/briefs";
import { fromTemplateRecord, toTemplateRecord, type BriefTemplateRecord } from "@/lib/plan/templates";
import { pullAllVersions, pushPendingVersions } from "@/lib/versions";
import { fromCollectionRecord, type CollectionRecord } from "@/lib/collections";
import type { Table } from "dexie";

const DEBOUNCE_MS = 2000;

let currentUserId: string | null = null;
let syncInFlight = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let onSyncComplete: (() => void) | null = null;

export function setSyncUser(userId: string | null) {
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
    await pushTable(db.posts, "posts", toRecord, fromRecord);
    // After posts: versions staged against a not-yet-synced post can only go
    // out once that post exists server-side.
    await pushPendingVersions();
    await pushTable(db.briefs, "briefs", toBriefRecord, fromBriefRecord);
    await pushTable(db.briefTemplates, "brief_templates", toTemplateRecord, fromTemplateRecord);
    await pullTable(db.posts, "posts", "lastPullPb.posts", fromRecord);
    await pullAllVersions();
    await pullCollections();
    await pullTable(db.briefs, "briefs", "lastPullPb.briefs", fromBriefRecord);
    await pullTable(db.briefTemplates, "brief_templates", "lastPullPb.brief_templates", fromTemplateRecord);
    onSyncComplete?.();
  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    syncInFlight = false;
  }
}

interface Synced {
  id: string;
  updatedAt: number;
  syncedAt?: number | null;
  dirty?: boolean;
}

interface Stamped {
  id: string;
  updated: string;
}

/**
 * Push every dirty row of a table. Failures are isolated per row: one rejected
 * record (validation, network) stays dirty and retries next sync without
 * blocking the rest of the queue.
 */
async function pushTable<L extends Synced, R extends Stamped>(
  table: Table<L, string>,
  collection: string,
  toBody: (local: L) => Record<string, unknown>,
  fromRec: (r: R) => Omit<L, "syncedAt" | "dirty">,
): Promise<void> {
  const all = await table.toArray();
  const pending = all.filter((p) => p.dirty || !p.syncedAt || p.updatedAt > (p.syncedAt ?? 0));
  if (!pending.length) return;

  const col = pb.collection<R>(collection);
  for (const local of pending) {
    const body = toBody(local);
    let saved: R;
    try {
      if (local.syncedAt) {
        try {
          saved = await col.update(local.id, body);
        } catch (err) {
          if (httpStatus(err) !== 404) throw err;
          saved = await col.create({ id: local.id, ...body }); // deleted elsewhere; the local edit wins
        }
      } else {
        try {
          saved = await col.create({ id: local.id, ...body });
        } catch (err) {
          if (!fieldError(err, "id")) throw err;
          saved = await col.update(local.id, body); // an earlier attempt did land
        }
      }
    } catch (err) {
      console.error(`Push failed for ${collection}/${local.id}:`, err);
      continue;
    }
    await table.put({ ...(fromRec(saved) as L), syncedAt: Date.now(), dirty: false });
  }
}

/** Pull everything whose `updated` is newer than the stored cursor. */
async function pullTable<L extends Synced, R extends Stamped>(
  table: Table<L, string>,
  collection: string,
  cursorKey: string,
  fromRec: (r: R) => Omit<L, "syncedAt" | "dirty">,
): Promise<void> {
  const meta = await db.syncMeta.get(cursorKey);
  const since = typeof meta?.value === "string" ? meta.value : "1970-01-01T00:00:00.000Z";

  let records: R[];
  try {
    records = await pb.collection<R>(collection).getFullList({
      filter: pb.filter("updated > {:since}", { since: new Date(since) }),
      sort: "updated",
    });
  } catch (err) {
    console.error(`Pull ${collection} failed:`, err);
    return;
  }
  if (!records.length) return;

  const now = Date.now();
  let maxMs = Date.parse(since);
  await db.transaction("rw", table, async () => {
    for (const r of records) {
      const serverMs = pbDateToMs(r.updated) ?? 0;
      if (serverMs > maxMs) maxMs = serverMs;
      const local = await table.get(r.id);
      // Don't clobber a dirty local edit with a stale server pull.
      if (local?.dirty && local.updatedAt > serverMs) continue;
      await table.put({ ...(fromRec(r) as L), syncedAt: now, dirty: false });
    }
  });
  await db.syncMeta.put({ key: cursorKey, value: new Date(maxMs).toISOString() });
}

async function pullCollections(): Promise<void> {
  // Full replace: collections are small and deletes must propagate to Dexie.
  let records: CollectionRecord[];
  try {
    records = await pb.collection<CollectionRecord>("collections").getFullList({ sort: "position" });
  } catch (err) {
    console.error("Pull collections failed:", err);
    return;
  }
  const now = Date.now();
  await db.transaction("rw", db.collections, async () => {
    await db.collections.clear();
    for (const r of records) {
      await db.collections.put({ ...fromCollectionRecord(r), syncedAt: now, dirty: false });
    }
  });
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

export type { PostRecord, BriefRecord, BriefTemplateRecord };
