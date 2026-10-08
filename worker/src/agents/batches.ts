// The plan's batches (strategist-cold-start-and-pacing.md, section 3). Ayadi's
// rules, 2026-10-08:
//   - Content is always batched, at the tenant's cadence: weekly (the
//     default: equal weekly batches through the quarter's first two months, a
//     double batch at the start) or flood (everything at once). A person can
//     ask for the next batch any time.
//   - Every source feeds the batches (the plan, the Scout, the Listener), and
//     every approved post counts toward the quarter's target.
//   - A batch's quota counts APPROVED briefs. The Pitcher over-pitches (about
//     2 per slot, then the tenant's real approval rate); a short batch is
//     topped up the next morning; approvals over the quota shrink later
//     batches, and once approvals reach the target the rest are cancelled.
//     What's left is always target minus approved.
// The pure arithmetic is here; pitcher.ts runs it.

import type { BatchCadence, BatchRow } from "./store.js";

const DAY = 86_400_000;

/** Statuses that mean a person approved the brief. */
export const APPROVED = ["todo", "in_progress", "in_review", "scheduled", "done"];

/** A batch's quota when the tenant has neither goals nor a plan yet. */
export const DEFAULT_QUOTA = 3;

/** The end of the release window: two months into the quarter. */
export function releaseEnd(quarterStart: Date): Date {
  const end = new Date(quarterStart);
  end.setUTCMonth(end.getUTCMonth() + 2);
  return end;
}

/**
 * Share of the Pitcher's pitches the tenant approves. Until there are 6
 * decisions, a half: two pitches per slot. Kept between a quarter (4 per slot,
 * at most) and 1.
 */
export function approvalRate(decided: { status: string }[]): number {
  const counted = decided.filter((d) => d.status === "rejected" || APPROVED.includes(d.status));
  if (counted.length < 6) return 0.5;
  const rate = counted.filter((d) => APPROVED.includes(d.status)).length / counted.length;
  return Math.min(Math.max(rate, 0.25), 1);
}

/** Pitches to send for `short` more approvals, given those still undecided. */
export function pitchesFor(short: number, undecided: number, rate: number): number {
  if (short <= 0) return 0;
  return Math.max(Math.ceil(short / rate) - undecided, 0);
}

export interface BatchCount extends BatchRow {
  /** Briefs in this batch approved so far. */
  approved: number;
  /** Briefs in this batch still waiting for a decision. */
  undecided: number;
}

export const isOpen = (b: BatchRow) => b.state === "in_review" || b.state === "topping_up";

export interface QuarterView {
  /** The quarter's Volume target; null until the tenant has goals. */
  target: number | null;
  /** Briefs approved this quarter, from any source. */
  approved: number;
  batches: BatchCount[];
  /** The plan's ideas still waiting (the target when there are no goals). */
  planWaiting: number;
  cadence: BatchCadence;
  quarterStart: Date;
  now: Date;
}

/**
 * Approvals the quarter still needs that no open batch is already after:
 * target minus approved, minus what open batches are still short. Null when
 * there's no target and no plan to stand in for one.
 */
export function unassigned(v: QuarterView): number | null {
  const short = v.batches.filter(isOpen).reduce((n, b) => n + Math.max(b.quota - b.approved, 0), 0);
  if (v.target !== null) return Math.max(v.target - v.approved - short, 0);
  if (v.planWaiting > 0) return v.planWaiting;
  return null;
}

/** The next batch's quota (0: nothing to send). */
export function nextQuota(v: QuarterView): number {
  const left = unassigned(v);
  if (left === null) return DEFAULT_QUOTA;
  if (left <= 0) return 0;
  if (v.cadence === "flood") return left;
  const end = releaseEnd(v.quarterStart);
  if (v.now >= end) return left; // past the window: the rest at once
  // Weekly release points left, this one included.
  const slots = Math.max(Math.ceil((end.getTime() - v.now.getTime()) / (7 * DAY)), 1);
  // The first batch counts twice: the head start.
  const released = v.batches.filter((b) => b.released_at).length;
  if (released === 0) return Math.min(left, Math.ceil((2 * left) / (slots + 1)));
  return Math.min(left, Math.ceil(left / slots));
}

/** The quarter's target is met: nobody reviews pitches the plan no longer needs. */
export function targetMet(v: QuarterView): boolean {
  return v.target !== null && v.approved >= v.target;
}
