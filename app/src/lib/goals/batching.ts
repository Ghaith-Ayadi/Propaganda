// Batching (Ayadi, 2026-10-08): content always comes in batches, whatever the
// quarter's size (50 posts or 400). Two cadences:
// - weekly (recommended): equal weekly batches through the first two months of
//   the quarter, with a double batch at the start for a head start;
// - flood: everything at once.
// The tenant can always ask for the next batch early. Pure functions, no I/O.

import type { BatchCadence, Day, QuarterKey } from "./types";
import { addDays, daysBetween, weekStart } from "./quarter";

/** Weekly batches stop at the end of the quarter's second month (week 8). */
export const WEEKLY_UNTIL_WEEK = 8;

export interface BatchSlot {
  due: Day;
  size: number;
}

/**
 * Split `count` posts into batches starting at `firstDue`.
 * Weekly: one slot per week until the end of week 8 (at least one), the first
 * slot worth two. Flood: one slot. Empty slots are dropped.
 */
export function planBatches(cadence: BatchCadence, quarter: QuarterKey, firstDue: Day, count: number): BatchSlot[] {
  if (count <= 0) return [];
  if (cadence === "flood") return [{ due: firstDue, size: count }];
  const until = weekStart(quarter, WEEKLY_UNTIL_WEEK + 1);
  const weeks = Math.max(1, Math.ceil(daysBetween(firstDue, until) / 7));
  const shares = weeks + 1; // the first batch is a double
  const slots: BatchSlot[] = [];
  let given = 0;
  for (let w = 0; w < weeks; w++) {
    const upto = Math.round((count * (w === 0 ? 2 : w + 2)) / shares);
    slots.push({ due: addDays(firstDue, w * 7), size: upto - given });
    given = upto;
  }
  return slots.filter((s) => s.size > 0);
}

/** What we tell the tenant when they switch cadence. Ayadi's words, 2026-10-08. */
export const CADENCE_RATIONALE =
  "We can give you everything at once. Your briefs and drafts don't change with how you review the posts inside a batch. Your feedback on a batch does shape the next one, a lot: the Pitcher reads what you approved and rejected before it writes the next batch.";

export const CADENCE_COPY: Record<BatchCadence, { label: string; hint: string }> = {
  weekly: {
    label: "Weekly",
    hint: "Equal batches every week through the first two months, with a double batch to start.",
  },
  flood: {
    label: "Flood",
    hint: "Everything at once.",
  },
};
