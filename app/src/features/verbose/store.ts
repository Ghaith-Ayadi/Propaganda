// Local-first writing-activity store. Dexie (`vdb`) is the instant cache the
// heatmap reads from; the server (`writing_activity`) is the source of truth,
// updated through an atomic increment (the increment_writing_activity
// function) so concurrent edits accumulate rather than clobber. Site-scoped
// throughout.

import { fetchAll, must, sb } from "@/lib/supabase";
import { siteId } from "@/lib/scope";
import { vdb } from "./db";

interface ActivityRecord {
  id: string;
  site: string;
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
  await must(sb.rpc("increment_writing_activity", { p_site: siteId(), p_day: day, p_delta: delta }));
}

/** Record `delta` words written on `day` (gross; non-positive is ignored). */
export async function addWords(delta: number, day: string = dayKey()): Promise<void> {
  if (delta <= 0) return;
  const cache = vdb();
  const cur = (await cache.activity.get(day))?.words ?? 0;
  await cache.activity.put({ day, words: cur + delta });
  emit();
  try {
    await incrementRemote(day, delta);
  } catch (err) {
    // Offline or signed out: the local cache still reflects the write.
    console.warn("[verbose] remote increment failed:", err);
  }
}

/** Pull the full history from the server into the local cache (reconcile by max). */
export async function pullAll(): Promise<void> {
  try {
    const cache = vdb();
    const client = sb;
    const site = siteId();
    const records = await fetchAll<Pick<ActivityRecord, "id" | "day" | "words">>((from, to) =>
      client.from("writing_activity").select("id,day,words").eq("site", site).order("day").order("id").range(from, to),
    );
    if (cache !== vdb()) return; // switched site meanwhile
    await cache.transaction("rw", cache.activity, async () => {
      for (const r of records) {
        const day = String(r.day).slice(0, 10);
        const local = (await cache.activity.get(day))?.words ?? 0;
        await cache.activity.put({ day, words: Math.max(local, r.words ?? 0) });
      }
    });
    emit();
  } catch (err) {
    console.warn("[verbose] pull failed:", err);
  }
}

export async function getActivityMap(): Promise<Map<string, number>> {
  const rows = await vdb().activity.toArray();
  return new Map(rows.map((r) => [r.day, r.words]));
}

/** Live cross-tab/device updates. Returns an unsubscribe. */
export function installRealtime(): () => void {
  let cancelled = false;
  const client = sb;
  const site = siteId();
  const cache = vdb();
  // An activity row is a few small columns, so the event carries all of it.
  const channel = client
    .channel(`activity:${site}:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "writing_activity", filter: `site=eq.${site}` }, (e) => {
      if (cancelled || e.eventType === "DELETE") return;
      const row = e.new as ActivityRecord;
      if (row.site !== site) return;
      const day = String(row.day).slice(0, 10);
      void cache.activity.put({ day, words: row.words ?? 0 }).then(emit);
    })
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR") console.warn("[verbose] realtime failed:", err);
    });
  return () => {
    cancelled = true;
    void client.removeChannel(channel);
  };
}
