// Verbose owns its own IndexedDB, separate from the core `db`. This keeps the
// module self-contained: core's schema never references writing activity, so
// deleting src/features/verbose leaves no orphaned tables or migrations behind.

import Dexie, { type Table } from "dexie";

export interface DayActivity {
  day: string; // local-day key, "YYYY-MM-DD"
  words: number; // gross words written that day
}

class VerboseDB extends Dexie {
  activity!: Table<DayActivity, string>;
  constructor() {
    super("verbose");
    this.version(1).stores({ activity: "day" });
  }
}

export const vdb = new VerboseDB();
