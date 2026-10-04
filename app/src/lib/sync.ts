// Local-first sync engine. Ported from Anderson with the table swapped to `posts`.
//
// Trigger model:
//  - scheduleSync() debounces by 2s of idle (PRD §4)
//  - flushSync() forces a push (window blur / before unload / scope switch)
//  - runSync() runs once (push pending -> pull updated > cursor)
//
// Identity: every record is created locally with its final PocketBase id (see
// lib/pocketbase.ts newId), so a push is "create if never synced, else update"
// and nothing is ever re-keyed. The server owns `updated`; conflicts resolve by
// server clock, and a dirty local edit newer than the server's copy wins locally
// until it is pushed.
//
// Scope: a run captures the active client and database once, at its start, and
// uses only those (a `Ctx`), so switching account or site mid-run can't mix
// them. Pushes carry `site: db.siteId` (the database's own site) and pulls are
// filtered to it: published posts of other sites are publicly readable and
// must never land in this site's cache.

import type PocketBase from "pocketbase";
import { db, type VerbatimDB } from "@/lib/db";
import { fieldError, httpStatus, pb, pbDateToMs } from "@/lib/pocketbase";
import { fromRecord, toRecord, type PostRecord } from "@/lib/posts";
import { fromBriefRecord, toBriefRecord, type BriefRecord } from "@/lib/plan/briefs";
import { fromTemplateRecord, toTemplateRecord, type BriefTemplateRecord } from "@/lib/plan/templates";
import { pullAllVersions, pushPendingVersions } from "@/lib/versions";
import { fromCollectionRecord, type CollectionRecord } from "@/lib/collections";
import { reportError } from "@/lib/telemetry";
import type { Table } from "dexie";

const DEBOUNCE_MS = 2000;

export interface Ctx {
  pb: PocketBase;
  db: VerbatimDB;
  site: string;
}

/** The active client + database, captured together. */
export function captureCtx(): Ctx {
  return { pb, db, site: db.siteId };
}

let enabled = false;
// One run at a time per database. Different databases (the site just left,
// still pushing, and the site just opened) may sync concurrently.
const running = new Map<VerbatimDB, Promise<void>>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let onSyncComplete: (() => void) | null = null;

/** On while a scope is mounted; off while switching or signed out. */
export function setSyncEnabled(on: boolean) {
  enabled = on;
  if (!on && debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function setSyncListener(listener: (() => void) | null) {
  onSyncComplete = listener;
}

export function scheduleSync() {
  if (!enabled) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void runSync();
  }, DEBOUNCE_MS);
}

function usable(d: VerbatimDB | null): d is VerbatimDB {
  return Boolean(d && d.isOpen());
}

/**
 * Push now. Waits for a run already in flight on this database, then runs
 * again, so everything written before the call is pushed when it resolves (if
 * the network allows).
 */
export async function flushSync(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (!usable(db)) return;
  const ctx = captureCtx();
  await running.get(ctx.db)?.catch(() => undefined);
  await start(ctx, "full");
}

export async function runSync(): Promise<void> {
  if (!enabled || !usable(db) || running.has(db)) return;
  await start(captureCtx(), "full");
}

/**
 * Push a scope's pending writes without blocking the caller: used when leaving
 * a site, so switching is instant and the drafts still reach the server,
 * pinned to the database (and site) they were written in.
 */
export function pushInBackground(ctx: Ctx): Promise<void> {
  const previous = running.get(ctx.db);
  return (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => start(ctx, "push"));
}

/** Resolves when no sync is running on any database. */
export async function waitForSyncIdle(): Promise<void> {
  while (running.size) await Promise.allSettled([...running.values()]);
}

function start(ctx: Ctx, mode: "full" | "push"): Promise<void> {
  const run = (async () => {
    try {
      await pushTable(ctx, ctx.db.posts, "posts", toRecord, fromRecord);
      // After posts: versions staged against a not-yet-synced post can only go
      // out once that post exists server-side.
      await pushPendingVersions(ctx);
      await pushTable(ctx, ctx.db.briefs, "briefs", toBriefRecord, fromBriefRecord);
      await pushTable(ctx, ctx.db.briefTemplates, "brief_templates", toTemplateRecord, fromTemplateRecord);
      if (mode === "push") return;
      await pullTable(ctx, ctx.db.posts, "posts", "lastPullPb.posts", fromRecord);
      await pullNumbers(ctx);
      await pullAllVersions(ctx);
      await pullCollections(ctx);
      await pullTable(ctx, ctx.db.briefs, "briefs", "lastPullPb.briefs", fromBriefRecord);
      await pullTable(ctx, ctx.db.briefTemplates, "brief_templates", "lastPullPb.brief_templates", fromTemplateRecord);
      if (ctx.db === db) onSyncComplete?.();
    } catch (err) {
      reportError("Sync failed", err);
    }
  })();
  const tracked: Promise<void> = run.finally(() => {
    if (running.get(ctx.db) === tracked) running.delete(ctx.db);
  });
  running.set(ctx.db, tracked);
  return tracked;
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
  ctx: Ctx,
  table: Table<L, string>,
  collection: string,
  toBody: (local: L) => Record<string, unknown>,
  fromRec: (r: R) => Omit<L, "syncedAt" | "dirty">,
): Promise<void> {
  const all = await table.toArray();
  const pending = all.filter((p) => p.dirty || !p.syncedAt || p.updatedAt > (p.syncedAt ?? 0));
  if (!pending.length) return;

  const col = ctx.pb.collection<R>(collection);
  for (const local of pending) {
    // The database's site, never the "active" one: see the header.
    const body = { ...toBody(local), site: ctx.site };
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
      reportError("Push failed", err, { collection, record_id: local.id });
      continue;
    }
    await table.put({ ...(fromRec(saved) as L), syncedAt: Date.now(), dirty: false });
  }
}

/** Pull everything whose `updated` is newer than the stored cursor. */
async function pullTable<L extends Synced, R extends Stamped>(
  ctx: Ctx,
  table: Table<L, string>,
  collection: string,
  cursorKey: string,
  fromRec: (r: R) => Omit<L, "syncedAt" | "dirty">,
): Promise<void> {
  const { db, pb } = ctx;
  const meta = await db.syncMeta.get(cursorKey);
  const since = typeof meta?.value === "string" ? meta.value : "1970-01-01T00:00:00.000Z";

  let records: R[];
  try {
    records = await pb.collection<R>(collection).getFullList({
      filter: pb.filter("site = {:site} && updated > {:since}", { site: ctx.site, since: new Date(since) }),
      sort: "updated",
    });
  } catch (err) {
    reportError("Pull failed", err, { collection });
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

/**
 * Post numbers for posts this device already has. The migration that
 * introduced them (1758000007) didn't bump `updated`, on purpose: a bump would
 * make every device re-download its posts over unsynced drafts. So the
 * incremental pull never brings them; fetch just id -> number and fill in that
 * one field. Numbers never change, so this runs only while some are missing.
 */
async function pullNumbers(ctx: Ctx): Promise<void> {
  const { db, pb } = ctx;
  const missing = await db.posts.filter((p) => !p.number && !!p.syncedAt).count();
  if (!missing) return;
  let rows: { id: string; number: number }[];
  try {
    rows = await pb.collection("posts").getFullList<{ id: string; number: number }>({
      filter: pb.filter("site = {:site} && number > 0", { site: ctx.site }),
      fields: "id,number",
      batch: 1000,
    });
  } catch (err) {
    reportError("Pull failed", err, { collection: "posts.number" });
    return;
  }
  await db.transaction("rw", db.posts, async () => {
    for (const r of rows) {
      const local = await db.posts.get(r.id);
      // update() touches only `number`: dirty edits and their timestamps stay as they are.
      if (local && !local.number) await db.posts.update(r.id, { number: r.number });
    }
  });
}

async function pullCollections(ctx: Ctx): Promise<void> {
  const { db, pb } = ctx;
  // Full replace: collections are small and deletes must propagate to Dexie.
  let records: CollectionRecord[];
  try {
    records = await pb.collection<CollectionRecord>("collections").getFullList({
      filter: pb.filter("site = {:site}", { site: ctx.site }),
      sort: "position",
    });
  } catch (err) {
    reportError("Pull failed", err, { collection: "collections" });
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
