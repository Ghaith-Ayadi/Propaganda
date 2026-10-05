// Local-first sync engine. Ported from Anderson with the table swapped to `posts`.
//
// Trigger model:
//  - scheduleSync() debounces by 2s of idle (PRD §4)
//  - flushSync() forces a push (window blur / before unload / scope switch)
//  - runSync() runs once (push pending -> pull updated > cursor)
//
// Identity: every record is created locally with its final id (see
// lib/supabase.ts newId), so a push is "create if never synced, else update"
// and nothing is ever re-keyed. The server owns `updated`; conflicts resolve by
// server clock, and a dirty local edit newer than the server's copy wins locally
// until it is pushed.
//
// Pulls read everything with `updated` after the stored cursor, minus a few
// seconds: Postgres commits concurrently, so a row stamped just before the
// cursor can still be committing when a pull runs. Re-reading the overlap is
// harmless (the same rows, put again under the same dirty guard).
//
// Scope: a run captures the active client and database once, at its start, and
// uses only those (a `Ctx`), so switching account or site mid-run can't mix
// them. Pushes carry `site: db.siteId` (the database's own site) and pulls are
// filtered to it: published posts of other sites are publicly readable and
// must never land in this site's cache.

import { db, type VerbatimDB } from "@/lib/db";
import { dateToMs, fetchAll, fetchSince, isUniqueViolation, must, sb, type Client } from "@/lib/supabase";
import { fromRecord, toRecord, type PostRecord } from "@/lib/posts";
import { fromBriefRecord, toBriefRecord, type BriefRecord } from "@/lib/plan/briefs";
import { fromTemplateRecord, toTemplateRecord, type BriefTemplateRecord } from "@/lib/plan/templates";
import { pullAllVersions, pushPendingVersions } from "@/lib/versions";
import { fromCollectionRecord, type CollectionRecord } from "@/lib/collections";
import { reportError } from "@/lib/telemetry";
import type { Table } from "dexie";

const DEBOUNCE_MS = 2000;
/** How far behind the cursor a pull starts reading again (see the header). */
export const PULL_OVERLAP_MS = 5000;

export interface Ctx {
  sb: Client;
  db: VerbatimDB;
  site: string;
}

/** The active client + database, captured together. */
export function captureCtx(): Ctx {
  return { sb, db, site: db.siteId };
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

// A run asked for while one is going on this database: run again after it, so
// a write made during a push isn't left waiting for the next trigger.
const again = new Set<VerbatimDB>();

export async function runSync(): Promise<void> {
  if (!enabled || !usable(db)) return;
  if (running.has(db)) {
    again.add(db);
    return;
  }
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
      await reconcileEpoch(ctx);
      await pullTable(ctx, ctx.db.posts, "posts", CURSOR_KEYS[0], fromRecord);
      await pullNumbers(ctx);
      await pullAllVersions(ctx);
      await pullCollections(ctx);
      await pullTable(ctx, ctx.db.briefs, "briefs", CURSOR_KEYS[1], fromBriefRecord);
      await pullTable(ctx, ctx.db.briefTemplates, "brief_templates", CURSOR_KEYS[2], fromTemplateRecord);
      if (ctx.db === db) onSyncComplete?.();
    } catch (err) {
      reportError("Sync failed", err);
    }
  })();
  const tracked: Promise<void> = run.finally(() => {
    if (running.get(ctx.db) === tracked) running.delete(ctx.db);
    if (again.delete(ctx.db) && ctx.db === db) scheduleSync();
  });
  running.set(ctx.db, tracked);
  return tracked;
}

interface Synced {
  id: string;
  updatedAt: number;
  syncedAt?: number | null;
  dirty?: boolean;
  pushedUpdatedAt?: number;
}

/**
 * Whether a local row stays as it is rather than take a server copy stamped
 * `serverMs`: it has an unpushed edit, and the server copy is older than that
 * edit or one this device pushed itself (see pushTable).
 */
export function keepsLocal(local: Synced | undefined, serverMs: number): boolean {
  return !!local?.dirty && (local.updatedAt > serverMs || (local.pushedUpdatedAt ?? 0) >= serverMs);
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

  for (const local of pending) {
    // The database's site, never the "active" one: see the header.
    const body = { ...toBody(local), site: ctx.site };
    let saved: R;
    try {
      saved = await saveRow<R>(ctx.sb, collection, local.id, body, !!local.syncedAt);
    } catch (err) {
      reportError("Push failed", err, { collection, record_id: local.id });
      continue;
    }
    // Edited again while the request was out (a status click, a keystroke):
    // keep that edit, still dirty, for the next push. Only an untouched row
    // takes the server's copy.
    await ctx.db.transaction("rw", table, async () => {
      const now = await table.get(local.id);
      if (now && now.updatedAt !== local.updatedAt) {
        const stamp = dateToMs(saved.updated) ?? 0;
        await table.update(local.id, (row) => {
          row.pushedUpdatedAt = stamp;
        });
        return;
      }
      await table.put({ ...(fromRec(saved) as L), syncedAt: Date.now(), dirty: false });
    });
  }
}

const EPOCH_KEY = "dataEpoch";
const CURSOR_KEYS = ["lastPullSb.posts", "lastPullSb.briefs", "lastPullSb.brief_templates", "lastVersionPullSb"];
// Checked once per database per page load: a load of the content (the
// PocketBase import, a re-import after a rollback) happens with the app closed.
const epochChecked = new WeakSet<VerbatimDB>();

/**
 * After the server's content was loaded anew (public.data_epoch moved), the
 * stored cursors are meaningless: loaded rows keep their original `updated`,
 * older than any cursor, and rows the load didn't bring back are simply gone.
 * So: forget the cursors (the pulls that follow read the whole site again) and
 * drop synced posts and versions the server no longer has. Anything still
 * waiting to be pushed is kept, and was pushed just before this runs. Briefs
 * and templates keep their rows: the planner's demo ones are local on purpose.
 */
async function reconcileEpoch(ctx: Ctx): Promise<void> {
  const { db, sb, site } = ctx;
  if (epochChecked.has(db)) return;
  let epoch: number;
  try {
    epoch = Number(await must(sb.rpc("data_epoch")));
  } catch (err) {
    reportError("Epoch check failed", err);
    return;
  }
  if ((await db.syncMeta.get(EPOCH_KEY))?.value === epoch) {
    epochChecked.add(db);
    return;
  }
  const idsOf = async (table: string) =>
    new Set(
      (
        await fetchAll<{ id: string }>((from, to) => sb.from(table).select("id").eq("site", site).order("id").range(from, to))
      ).map((r) => r.id),
    );
  let posts: Set<string>, versions: Set<string>;
  try {
    [posts, versions] = await Promise.all([idsOf("posts"), idsOf("post_versions")]);
  } catch (err) {
    reportError("Epoch reconcile failed", err);
    return;
  }
  await db.transaction("rw", db.posts, db.versions, db.syncMeta, async () => {
    await db.posts.bulkDelete(await db.posts.filter((p) => !p.dirty && !posts.has(p.id)).primaryKeys());
    await db.versions.bulkDelete(await db.versions.filter((v) => !v.dirty && !versions.has(v.id)).primaryKeys());
    await db.syncMeta.bulkDelete(CURSOR_KEYS);
    await db.syncMeta.put({ key: EPOCH_KEY, value: epoch });
  });
  epochChecked.add(db);
}

/**
 * Create or update one row. A row that was synced before is updated, and
 * created again if it is gone (deleted elsewhere: the local edit wins); one
 * that never was is created, or updated if an earlier attempt did land.
 */
async function saveRow<R>(client: Client, table: string, id: string, body: Record<string, unknown>, synced: boolean): Promise<R> {
  const update = async () => ((await must(client.from(table).update(body).eq("id", id).select())) as R[])[0];
  const insert = async () => (await must(client.from(table).insert({ id, ...body }).select().single())) as R;
  if (synced) return (await update()) ?? insert();
  try {
    return await insert();
  } catch (err) {
    if (!isUniqueViolation(err, `${table}_pkey`)) throw err;
    const updated = await update();
    if (!updated) throw err;
    return updated;
  }
}

/** Pull everything whose `updated` is newer than the stored cursor (less the overlap). */
async function pullTable<L extends Synced, R extends Stamped>(
  ctx: Ctx,
  table: Table<L, string>,
  collection: string,
  cursorKey: string,
  fromRec: (r: R) => Omit<L, "syncedAt" | "dirty">,
): Promise<void> {
  const { db, sb } = ctx;
  const meta = await db.syncMeta.get(cursorKey);
  const since = typeof meta?.value === "string" ? meta.value : "1970-01-01T00:00:00.000Z";
  const from = new Date(Math.max(0, Date.parse(since) - PULL_OVERLAP_MS)).toISOString();

  let records: R[];
  try {
    records = await fetchSince<R>(() => sb.from(collection).select("*").eq("site", ctx.site), "updated", from);
  } catch (err) {
    reportError("Pull failed", err, { collection });
    return;
  }
  if (!records.length) return;

  const now = Date.now();
  let maxMs = Date.parse(since);
  await db.transaction("rw", table, async () => {
    for (const r of records) {
      const serverMs = dateToMs(r.updated) ?? 0;
      if (serverMs > maxMs) maxMs = serverMs;
      const local = await table.get(r.id);
      // Don't clobber a dirty local edit with a stale server pull.
      if (keepsLocal(local, serverMs)) continue;
      await table.put({ ...(fromRec(r) as L), syncedAt: now, dirty: false });
    }
  });
  await db.syncMeta.put({ key: cursorKey, value: new Date(maxMs).toISOString() });
}

/**
 * Post numbers for posts this device already has. The PocketBase migration
 * that introduced them (1758000007) didn't bump `updated`, on purpose: a bump
 * would make every device re-download its posts over unsynced drafts. So the
 * incremental pull never brought them; fetch just id -> number and fill in
 * that one field. Numbers never change, so this runs only while some are
 * missing.
 */
async function pullNumbers(ctx: Ctx): Promise<void> {
  const { db, sb } = ctx;
  const missing = await db.posts.filter((p) => !p.number && !!p.syncedAt).count();
  if (!missing) return;
  let rows: { id: string; number: number }[];
  try {
    rows = await fetchAll<{ id: string; number: number }>((from, to) =>
      sb.from("posts").select("id,number").eq("site", ctx.site).gt("number", 0).order("id").range(from, to),
    );
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

export async function pullCollections(ctx: Ctx): Promise<void> {
  const { db, sb } = ctx;
  // Full replace: collections are small and deletes must propagate to Dexie.
  let records: CollectionRecord[];
  try {
    records = await fetchAll<CollectionRecord>((from, to) =>
      sb.from("collections").select("*").eq("site", ctx.site).order("position").order("id").range(from, to),
    );
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
