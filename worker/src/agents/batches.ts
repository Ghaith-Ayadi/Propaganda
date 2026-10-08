// How many planned pitches go out in the next batch. Ayadi's rule
// (2026-10-08): content is always batched, and the tenant picks the cadence.
//   - weekly (the default): equal weekly batches through the first two months
//     of the quarter, with a double batch at the start for a head start.
//   - flood: everything at once.
// Either way a person can ask for the next batch early (Chat). The batch sizes
// come from what's left and the weeks left, so a plan that grows mid-quarter,
// or a batch asked for early, evens out over the remaining weeks.

import type { BatchCadence } from "./store.js";

const DAY = 86_400_000;

/** The end of the release window: two months into the quarter. */
export function releaseEnd(quarterStart: Date): Date {
  const end = new Date(quarterStart);
  end.setUTCMonth(end.getUTCMonth() + 2);
  return end;
}

export interface BatchPlan {
  /** Planned ideas still waiting for a batch. */
  remaining: number;
  /** Batches already out this quarter. */
  released: number;
  cadence: BatchCadence;
  quarterStart: Date;
  now: Date;
}

/** The next batch's size (0: nothing to send). */
export function batchSize(p: BatchPlan): number {
  if (p.remaining <= 0) return 0;
  if (p.cadence === "flood") return p.remaining;
  const end = releaseEnd(p.quarterStart);
  if (p.now >= end) return p.remaining; // past the window: the rest at once
  // Weekly release points left, this one included.
  const slots = Math.max(Math.ceil((end.getTime() - p.now.getTime()) / (7 * DAY)), 1);
  // The first batch counts twice: the head start.
  if (p.released === 0) return Math.min(p.remaining, Math.ceil((2 * p.remaining) / (slots + 1)));
  return Math.min(p.remaining, Math.ceil(p.remaining / slots));
}
