// Verbose owns its own IndexedDB, separate from the core `db`. This keeps the
// module self-contained: core's schema never references writing activity, so
// deleting src/features/verbose leaves no orphaned tables or migrations behind.

import Dexie, { type Table } from "dexie";
import { verboseDbName } from "@/lib/scope";

export interface DayActivity {
  day: string; // local-day key, "YYYY-MM-DD"
  words: number; // gross words written that day
}

class VerboseDB extends Dexie {
  activity!: Table<DayActivity, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ activity: "day" });
  }
}

// One cache per (account, site), like the core database; the pre-multi-tenant
// "verbose" database is kept for the scope that adopted "verbatim-pb".
let current: { name: string; db: VerboseDB } | null = null;

/** The active scope's activity cache. */
export function vdb(): VerboseDB {
  const name = verboseDbName();
  if (!current || current.name !== name) current = { name, db: new VerboseDB(name) };
  return current.db;
}
