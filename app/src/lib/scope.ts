// The active scope: which account is talking to the server, and which site the
// editor is showing. Everything site-specific keys off this.
//
// A scope owns one Supabase client (the account's) and one Dexie database
// (the account + site pair). Activating a scope swaps the live `pb` and `db`
// bindings; the editor tree is remounted by components/Workspace.tsx.
//
// DATA SAFETY on switch (see Workspace.tsx for the sequence):
//   1. the editor tree unmounts, and its unmount handlers start their last saves;
//   2. waitForWrites() lets every tracked write started under the old scope land
//      in the old database (milliseconds: IndexedDB, no network);
//   3. the bindings move, and the old scope's pending writes are pushed in the
//      background with the client + database captured before the move
//      (sync.pushInBackground), so the switch never waits on the network.
// Sync reads `db.siteId` from the database it captured, so even a row that
// somehow landed in the wrong database is pushed to the site that database
// belongs to (a duplicate at worst, never a loss or an overwrite).
// Old database handles stay open for that background push; they are cheap.

import Dexie from "dexie";
import { LEGACY_DB_NAME, VerbatimDB, setActiveDb } from "@/lib/db";
import { setActiveClient } from "@/lib/supabase";
import { clientFor, type Account, type SiteRef } from "@/lib/accounts";

/** The site every pre-multi-tenant record was backfilled into (PocketBase migration 1758000006). */
export const VERBATIM_SITE_ID = "verbatimsite000";

const ACTIVE_KEY = "propaganda:active";
const LEGACY_CLAIM_KEY = "propaganda:legacy-db";

export interface Scope {
  account: Account;
  site: SiteRef;
  dbName: string;
}

let current: Scope | null = null;

export function currentScope(): Scope | null {
  return current;
}

/** The active site's id. Only valid inside the editor (a scope is active). */
export function siteId(): string {
  if (!current) throw new Error("No active site");
  return current.site.id;
}

export function activeSite(): SiteRef | null {
  return current?.site ?? null;
}

export interface ActivePointer {
  userId: string;
  siteId: string;
}

export function readActivePointer(): ActivePointer | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as ActivePointer) : null;
  } catch {
    return null;
  }
}

function writeActivePointer(p: ActivePointer): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

// ---- local database naming ----

function legacyClaim(): string | null {
  try {
    return localStorage.getItem(LEGACY_CLAIM_KEY);
  } catch {
    return null;
  }
}

/**
 * Adopt the single-tenant database ("verbatim-pb") for this account's Verbatim
 * scope, if nobody on this browser has yet. Its rows are Verbatim's (that was
 * the only site), so whichever Verbatim member opens the app first gets it,
 * unsynced drafts included. Never adopted for any other site.
 */
async function maybeClaimLegacy(userId: string, site: SiteRef): Promise<void> {
  if (site.id !== VERBATIM_SITE_ID || legacyClaim()) return;
  let exists = false;
  try {
    exists = await Dexie.exists(LEGACY_DB_NAME);
  } catch {
    return;
  }
  if (!exists) return;
  try {
    localStorage.setItem(LEGACY_CLAIM_KEY, `${userId}:${site.id}`);
  } catch {
    // Without the claim recorded we'd pick a fresh database next time; the
    // legacy one stays untouched either way.
  }
}

export function dbNameFor(userId: string, siteIdValue: string): string {
  if (legacyClaim() === `${userId}:${siteIdValue}`) return LEGACY_DB_NAME;
  return `propaganda-${userId}-${siteIdValue}`;
}

/** Verbose (writing activity) keeps its own cache database, named alongside. */
export function verboseDbName(): string {
  if (!current) throw new Error("No active site");
  return current.dbName === LEGACY_DB_NAME ? "verbose" : `verbose-${current.account.userId}-${current.site.id}`;
}

// ---- per-scope module state ----
// Modules that cache site data in memory register a reset here; it runs on
// every activation, before the new scope's tree mounts.

const resetters = new Set<() => void>();

export function onScopeReset(fn: () => void): () => void {
  resetters.add(fn);
  return () => resetters.delete(fn);
}

const openDbs = new Map<string, VerbatimDB>();

/**
 * Point the app at (account, site). The caller has already drained the old
 * scope (Workspace.tsx); this only swaps bindings and resets caches.
 */
export async function activateScope(account: Account, site: SiteRef): Promise<Scope> {
  await maybeClaimLegacy(account.userId, site);
  const dbName = dbNameFor(account.userId, site.id);

  let next = openDbs.get(dbName);
  if (!next || !next.isOpen()) {
    next = new VerbatimDB(dbName, site.id);
    await next.open();
    openDbs.set(dbName, next);
  }

  setActiveClient(clientFor(account));
  setActiveDb(next);
  current = { account, site, dbName };
  writeActivePointer({ userId: account.userId, siteId: site.id });
  for (const reset of resetters) {
    try {
      reset();
    } catch (err) {
      console.error("scope reset failed:", err);
    }
  }
  return current;
}

/** Refresh the active site's details (after a rename) without switching. */
export function updateActiveSite(site: SiteRef): void {
  if (current && current.site.id === site.id) current = { ...current, site };
}

/** Leave every scope (the last account signed out). */
export function deactivateScope(): void {
  current = null;
  setActiveClient(null);
  for (const reset of resetters) {
    try {
      reset();
    } catch (err) {
      console.error("scope reset failed:", err);
    }
  }
}
