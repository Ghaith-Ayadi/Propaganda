// Navigation and live titles shared by the board, the week panel and the review screen.

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "@/components/base/toast/toast";
import { db } from "@/lib/db";
import { go, goPage } from "@/lib/route";
import type { PipelineItem } from "@/lib/pipeline/types";

/** Where clicking an item goes: pitches open the brief, reviews the review screen, the rest the draft. */
export function openItem(item: PipelineItem) {
  if (item.stage === "pitched") goPage("pipeline", `pitch/${item.id}`);
  else if (item.stage === "in_review") goPage("pipeline", `review/${item.id}`);
  else if (item.postId) go({ view: "post", id: item.postId });
  else toast.add({ title: "Example post", description: "This one has no draft behind it yet." });
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
