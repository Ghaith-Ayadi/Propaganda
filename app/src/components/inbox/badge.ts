// The count beside Inbox in the nav: what waits on the person. While flags,
// pitches and knowledge come from the placeholder (inbox/placeholder.ts), only
// the live part counts, so no tenant sees example items in the nav. This reads
// Dexie directly rather than useInbox(), to keep the placeholder out of the
// main chunk. When the live source lands, count its open items here too, and
// set `urgent` when any open flag has urgency "high" (the shell turns the chip
// red then, as the Flags tab does).

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { BadgeValue } from "@/lib/routes";

export function useInboxBadge(): BadgeValue {
  const reviews = useLiveQuery(() => db.briefs.where("status").equals("in_review").count(), [], 0);
  return reviews ? { count: reviews, urgent: false } : null;
}
