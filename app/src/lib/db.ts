import Dexie, { type Table } from "dexie";
import type { Collection, Post, PostVersion } from "@/types";
import type { Brief, BriefTemplate } from "@/lib/plan/types";

interface SyncMetaRow {
  key: string;
  value: unknown;
}

// One local database per (account, site): lib/scope.ts opens the right one and
// swaps the `db` binding below when the author switches. Every row in a
// database belongs to that database's site, so rows can never leak between
// sites through the cache, and sync stamps pushes with `db.siteId`.
//
// The single-tenant database was "verbatim-pb" (and before it, the
// Supabase-era "verbatim-db", dropped below). "verbatim-pb" is never renamed
// or deleted: it may hold unsynced drafts. lib/scope.ts adopts it as the
// database of the first Verbatim member who opens the app on this browser.
export class VerbatimDB extends Dexie {
  posts!: Table<Post, string>;
  versions!: Table<PostVersion, string>;
  collections!: Table<Collection, string>;
  briefs!: Table<Brief, string>;
  briefTemplates!: Table<BriefTemplate, string>;
  syncMeta!: Table<SyncMetaRow, string>;

  /** The site every row in this database belongs to. */
  readonly siteId: string;

  constructor(name: string, siteId: string) {
    super(name);
    this.siteId = siteId;

    this.version(1).stores({
      posts: "id, slug, postId, status, type, favorited, updatedAt, publishedAt, [type+collectionSeq]",
      versions: "id, postId, [postId+version], createdAt",
      collections: "name, position, updatedAt",
      briefs: "id, status, plannedDate, collectionName, postId, updatedAt",
      briefTemplates: "id, updatedAt",
      syncMeta: "key",
    });
  }
}

export const LEGACY_DB_NAME = "verbatim-pb";

/**
 * The active scope's database. A live binding swapped by lib/scope.ts; code
 * that awaits between reads and writes and must stay in one database captures
 * it first (`const d = db`). Only read after a scope is active.
 */
export let db: VerbatimDB = null as unknown as VerbatimDB;

export function setActiveDb(next: VerbatimDB): void {
  db = next;
}

// ---- in-flight writes ----
// Switching scope waits for writes started under the old scope to finish, so a
// save fired while the editor unmounts lands in the database it was made in.

let pendingWrites = 0;

/** Mark a write as started; call the returned function when it settles. */
export function beginWrite(): () => void {
  pendingWrites++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pendingWrites--;
  };
}

/** Resolve once no tracked write is running and none started for `quietMs`. */
export async function waitForWrites(quietMs = 150): Promise<void> {
  for (;;) {
    while (pendingWrites > 0) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, quietMs));
    if (pendingWrites === 0) return;
  }
}

// The Supabase-era cache. Nothing in it is needed: everything was migrated
// server-side and the first sync repopulates this database.
void Dexie.delete("verbatim-db").catch(() => undefined);
