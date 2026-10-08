// The worker's read-only pool, for the Listener's workflows (main.ts sets it once).
import type { Pool } from "pg";

let pool: Pool | null = null;

export function setListenerDb(p: Pool): void {
  pool = p;
}

export function listenerDb(): Pool {
  if (!pool) throw new Error("The Listener's database pool isn't set");
  return pool;
}
