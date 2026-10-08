// Content's channels (the page's tabs) and sub-channels (its drawer). Blog's
// sub-channels are the tenant's collections; the other channels come after 0.2.
// useContentTree() builds the same as a nav tree, for a PageRoute's
// useChildren; the nav doesn't use it since the drawer took over.

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen01, Briefcase01, Mail01, Phone01, Share07 } from "@untitledui/icons";
import { db } from "@/lib/db";
import type { NavNode } from "@/lib/routes";
import type { Collection, Post } from "@/types";

export const CHANNELS = [
  { id: "blog", label: "Blog", icon: BookOpen01, live: true },
  { id: "social", label: "Social", icon: Share07, live: false },
  { id: "email", label: "Email", icon: Mail01, live: false },
  { id: "sales", label: "Sales", icon: Briefcase01, live: false },
  { id: "app", label: "App", icon: Phone01, live: false },
] as const;

export type ChannelId = (typeof CHANNELS)[number]["id"];

/** "blog/Guides" → { channel: "blog", sub: "Guides" }. */
export function parseContentRest(rest: string | null): { channel: ChannelId; sub: string | null } {
  const [head, ...tail] = (rest ?? "").split("/");
  const channel = CHANNELS.find((c) => c.id === head)?.id ?? "blog";
  const sub = tail.length ? decodeURIComponent(tail.join("/")) : null;
  return { channel, sub };
}

export function contentRest(channel: ChannelId, sub?: string | null): string {
  return sub ? `${channel}/${encodeURIComponent(sub)}` : channel;
}

export function useContentTree(): NavNode[] {
  const collections = useLiveQuery(
    () => db.collections.orderBy("position").toArray(),
    [],
    [] as Collection[],
  );
  // Counts only: the type of every post, not the posts.
  const types = useLiveQuery(
    async () => {
      const m = new Map<string, number>();
      await db.posts.each((p: Post) => {
        if (p.type) m.set(p.type, (m.get(p.type) ?? 0) + 1);
      });
      return m;
    },
    [],
    new Map<string, number>(),
  );

  return useMemo(
    () =>
      CHANNELS.map<NavNode>((c) =>
        c.live
          ? {
              id: c.id,
              label: c.label,
              icon: c.icon,
              rest: contentRest(c.id),
              children: collections.map((col) => ({
                id: `${c.id}:${col.name}`,
                label: col.name,
                emoji: col.emoji,
                rest: contentRest(c.id, col.name),
                count: types.get(col.name) ?? 0,
              })),
            }
          : { id: c.id, label: c.label, icon: c.icon, note: "later" },
      ),
    [collections, types],
  );
}
