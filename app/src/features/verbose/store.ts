// Local-first writing-activity store. Dexie (`vdb`) is the instant cache the
// heatmap reads from; Supabase (`public.writing_activity`) is the source of
// truth, updated through an atomic increment RPC so concurrent edits accumulate
// rather than clobber. Tenant-scoped throughout.

import { supabase } from "@/lib/supabase";
import { vdb } from "./db";

const TENANT = (import.meta.env.VITE_ANALYTICS_TENANT as string) || "verbatim";

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

/** Record `delta` words written on `day` (gross; non-positive is ignored). */
export async function addWords(delta: number, day: string = dayKey()): Promise<void> {
  if (delta <= 0) return;
  const cur = (await vdb.activity.get(day))?.words ?? 0;
  await vdb.activity.put({ day, words: cur + delta });
  emit();
  try {
    await supabase.rpc("increment_writing_activity", {
      p_tenant: TENANT,
      p_day: day,
      p_delta: delta,
    });
  } catch (err) {
    // Offline or table missing — local cache still reflects the write.
    console.warn("[verbose] remote increment failed:", err);
  }
}

/** Pull the full history from Supabase into the local cache (reconcile by max). */
export async function pullAll(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("writing_activity")
      .select("day, words")
      .eq("tenant", TENANT);
    if (error) throw error;
    await vdb.transaction("rw", vdb.activity, async () => {
      for (const r of data ?? []) {
        const day = String((r as { day: string }).day).slice(0, 10);
        const remote = (r as { words: number }).words ?? 0;
        const local = (await vdb.activity.get(day))?.words ?? 0;
        await vdb.activity.put({ day, words: Math.max(local, remote) });
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
  const channel = supabase
    .channel("verbose:writing_activity")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "writing_activity" },
      (payload) => {
        const row = payload.new as { tenant?: string; day?: string; words?: number };
        if (!row?.day || row.tenant !== TENANT) return;
        const day = String(row.day).slice(0, 10);
        void vdb.activity.put({ day, words: row.words ?? 0 }).then(emit);
      },
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}
