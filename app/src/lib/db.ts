import Dexie, { type Table } from "dexie";
import type { Collection, Post, PostVersion } from "@/types";
import type { Brief, BriefTemplate } from "@/lib/plan/types";

interface SyncMetaRow {
  key: string;
  value: unknown;
}

// A new database for the PocketBase era: post ids changed from Postgres
// integers to PocketBase record ids, and Dexie cannot change a primary key's
// type in place. The server is the source of truth, so a fresh cache costs one
// full pull. The old "verbatim-db" is dropped below so it stops taking space.
class VerbatimDB extends Dexie {
  posts!: Table<Post, string>;
  versions!: Table<PostVersion, string>;
  collections!: Table<Collection, string>;
  briefs!: Table<Brief, string>;
  briefTemplates!: Table<BriefTemplate, string>;
  syncMeta!: Table<SyncMetaRow, string>;

  constructor() {
    super("verbatim-pb");

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

export const db = new VerbatimDB();

// The Supabase-era cache. Nothing in it is needed: everything was migrated
// server-side and the first sync repopulates this database.
void Dexie.delete("verbatim-db").catch(() => undefined);
