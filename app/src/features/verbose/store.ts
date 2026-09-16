// Local-first writing-activity store. Dexie (`vdb`) is the instant cache the
// heatmap reads from; PocketBase (`writing_activity`) is the source of truth,
// updated through an atomic server-side increment (pb_hooks route on Bedrock)
// so concurrent edits accumulate rather than clobber. Tenant-scoped throughout.

import { pb } from "@/lib/pocketbase";
import { vdb } from "./db";

const TENANT = (import.meta.env.VITE_ANALYTICS_TENANT as string) || "verbatim";

interface ActivityRecord {
  id: string;
  tenant: string;
  day: string;
  words: number;
}

/** Local-day key "YYYY-MM-DD" (not UTC, so day boundaries match the writer). */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const listeners = new Set<() => void>();
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

/** Notify subscribers after a direct cache write (e.g. backfill). */
export function notifyChanged() {
  emit();
}

/** Add `delta` words to `day` on the server, atomically. Requires a session. */
export async function incrementRemote(day: string, delta: number): Promise<void> {
  await pb.send("/api/verbose/increment", {
    method: "POST",
    body: { tenant: TENANT, day, delta },
  });
}

/** Record `delta` words written on `day` (gross; non-positive is ignored). */
export async function addWords(delta: number, day: string = dayKey()): Promise<void> {
  if (delta <= 0) return;
  const cur = (await vdb.activity.get(day))?.words ?? 0;
  await vdb.activity.put({ day, words: cur + delta });
  emit();
  try {
    await incrementRemote(day, delta);
  } catch (err) {
    // Offline or signed out: the local cache still reflects the write.
    console.warn("[verbose] remote increment failed:", err);
  }
}

/** Pull the full history from PocketBase into the local cache (reconcile by max). */
export async function pullAll(): Promise<void> {
  try {
    const records = await pb.collection<ActivityRecord>("writing_activity").getFullList({
      filter: pb.filter("tenant = {:t}", { t: TENANT }),
      fields: "id,day,words",
    });
    await vdb.transaction("rw", vdb.activity, async () => {
      for (const r of records) {
        const day = String(r.day).slice(0, 10);
        const local = (await vdb.activity.get(day))?.words ?? 0;
        await vdb.activity.put({ day, words: Math.max(local, r.words ?? 0) });
      }
    });
    emit();
  } catch (err) {
    console.warn("[verbose] pull failed:", err);
  }
}

export async function getActivityMap(): Promise<Map<string, number>> {
  const rows = await vdb.activity.toArray();
  return new Map(rows.map((r) => [r.day, r.words]));
}

/** Live cross-tab/device updates. Returns an unsubscribe. */
export function installRealtime(): () => void {
  let cancelled = false;
  let unsubscribe: (() => Promise<void>) | null = null;
  void pb
    .collection<ActivityRecord>("writing_activity")
    .subscribe(
      "*",
      (e) => {
        if (e.action === "delete" || e.record.tenant !== TENANT) return;
        const day = String(e.record.day).slice(0, 10);
        void vdb.activity.put({ day, words: e.record.words ?? 0 }).then(emit);
      },
      { filter: pb.filter("tenant = {:t}", { t: TENANT }) },
    )
    .then((fn) => {
      if (cancelled) void fn();
      else unsubscribe = fn;
    })
    .catch((err) => console.warn("[verbose] realtime failed:", err));
  return () => {
    cancelled = true;
    void unsubscribe?.();
  };
}
