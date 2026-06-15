// One-time seed so the heatmap isn't blank on first run: attribute each
// existing post's current word count to the day it was created. Guarded by an
// app_settings flag so it runs once globally (across devices), not per browser.

import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import { vdb } from "./db";
import { dayKey, notifyChanged } from "./store";

const TENANT = (import.meta.env.VITE_ANALYTICS_TENANT as string) || "verbatim";
const FLAG = "verbose.backfilledAt";

export async function backfillOnce(): Promise<void> {
  if (getSetting<string>(FLAG)) return;

  const posts = await db.posts.toArray();
  const byDay = new Map<string, number>();
  for (const p of posts) {
    const wc = p.wordCount ?? 0;
    if (wc <= 0) continue;
    const day = dayKey(new Date(p.createdAt));
    byDay.set(day, (byDay.get(day) ?? 0) + wc);
  }
  if (byDay.size === 0) {
    await setSetting(FLAG, new Date().toISOString());
    return;
  }

  for (const [day, words] of byDay) {
    const local = (await vdb.activity.get(day))?.words ?? 0;
    await vdb.activity.put({ day, words: Math.max(local, words) });
    try {
      await supabase.rpc("increment_writing_activity", {
        p_tenant: TENANT,
        p_day: day,
        p_delta: words,
      });
    } catch (err) {
      console.warn("[verbose] backfill increment failed:", err);
    }
  }
  await setSetting(FLAG, new Date().toISOString());
  notifyChanged();
}
