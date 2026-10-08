// Navigation and live titles shared by the board and the calendar panel.

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "@/components/base/toast/toast";
import { db } from "@/lib/db";
import { go, goPage } from "@/lib/route";
import { ensureDraft } from "@/lib/pipeline/store";
import type { PipelineItem } from "@/lib/pipeline/types";
import { reportError } from "@/lib/telemetry";

/**
 * Where clicking an item goes: a pitch opens its brief; anything being written
 * or reviewed opens its post (review is a tab there), creating the draft first
 * for an example item that has none; a scheduled post opens its post if any.
 */
export async function openItem(item: PipelineItem) {
  if (item.stage === "pitched") return goPage("pipeline", `pitch/${item.id}`);
  if (item.stage === "writing" || item.stage === "in_review") {
    try {
      const postId = await ensureDraft(item.id);
      if (postId) return go({ view: "post", id: postId });
    } catch (err) {
      reportError("pipeline.openItem", err);
    }
    return toast.add({ type: "error", title: "Couldn't open the draft", description: "Try again in a moment." });
  }
  if (item.postId) return go({ view: "post", id: item.postId });
  toast.add({ title: "Example post", description: "This one has no draft behind it." });
}

/** Live titles: once a draft exists, its title in the editor wins over the pitch's. */
export function usePostTitles(items: PipelineItem[]): Map<string, string> {
  const ids = items.map((i) => i.postId).filter((x): x is string => !!x);
  const posts = useLiveQuery(() => db.posts.bulkGet(ids), [ids.join(",")], []);
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const p of posts) if (p?.title) m.set(p.id, p.title);
    return m;
  }, [posts]);
}
