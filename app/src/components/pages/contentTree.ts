// Content's channels (Blog, Social, Email: rows under Content in the drawer)
// and their sub-channels. Blog's sub-channels are the tenant's collections,
// the page's tabs; the other channels come after 0.2. useContentTree() is the
// same as a nav tree, for a PageRoute's useChildren.

import { BookOpen01, Mail01, Share07 } from "@untitledui/icons";
import type { NavNode } from "@/lib/routes";

export const CHANNELS = [
  { id: "blog", label: "Blog", icon: BookOpen01, live: true },
  { id: "social", label: "Social", icon: Share07, live: false },
  { id: "email", label: "Email", icon: Mail01, live: false },
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

/** The drawer's rows under Content. Collections are the page's tabs, not rows here. */
export function useContentTree(): NavNode[] {
  return CONTENT_NODES;
}

const CONTENT_NODES: NavNode[] = CHANNELS.map<NavNode>((c) =>
  c.live
    ? { id: c.id, label: c.label, icon: c.icon, rest: contentRest(c.id) }
    : { id: c.id, label: c.label, icon: c.icon, note: "later" },
);
