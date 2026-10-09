// The count beside Inbox in the nav: what waits on the person. While flags,
// pitches and knowledge come from the placeholder (inbox/placeholder.ts), only
// the live part counts, so no tenant sees example items in the nav. This reads
// Dexie directly rather than useInbox(), to keep the placeholder out of the
// main chunk. When the live source lands, count its open items here too, and
// set `urgent` when any open flag has urgency "high" (the shell turns the chip
// red then, as the Flags tab does).

//
// The Strategist's proposal waiting on approval counts too: one small count
// query (not the goals adapter, which would join the main chunk), every minute.

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { activeSite } from "@/lib/scope";
import { sb } from "@/lib/supabase";
import type { BadgeValue } from "@/lib/routes";

const PROPOSAL_POLL_MS = 60_000;

function useProposalsWaiting(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const site = activeSite()?.id;
      if (!site) return;
      const { count: n, error } = await sb.from("strategy_proposals").select("id", { count: "exact", head: true }).eq("site", site).eq("status", "sent");
      // A failed read leaves the count as it was: the nav is not where errors show.
      if (live && !error) setCount(n ?? 0);
    };
    void read();
    const timer = setInterval(() => void read(), PROPOSAL_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [activeSite()?.id]);
  return count;
}

export function useInboxBadge(): BadgeValue {
  const reviews = useLiveQuery(() => db.briefs.where("status").equals("in_review").count(), [], 0);
  const proposals = useProposalsWaiting();
  const count = reviews + Math.min(proposals, 1);
  return count ? { count, urgent: false } : null;
}
