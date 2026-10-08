// Calendar-quarter arithmetic for goals. Pure functions, no I/O.
// Quarter = 13 weeks; "week" is the week of the quarter, starting at 1.
// The join-week rule and the next-quarter clock are from
// agents/strategist-cold-start-and-pacing.md, sections 4 and 5.

import type { Day, JoinState, QuarterKey } from "./types";

export const QUARTER_WEEKS = 13;

export function toDay(d: Date): Day {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function fromDay(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: Day, n: number): Day {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

export function daysBetween(a: Day, b: Day): number {
  return Math.round((fromDay(b).getTime() - fromDay(a).getTime()) / 86_400_000);
}

export function quarterOf(day: Day): QuarterKey {
  const d = fromDay(day);
  return `${d.getFullYear()}-Q${(Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4}`;
}

export function parseQuarter(key: QuarterKey): { year: number; q: 1 | 2 | 3 | 4 } {
  const [y, q] = key.split("-Q");
  return { year: Number(y), q: Number(q) as 1 | 2 | 3 | 4 };
}

export function quarterStart(key: QuarterKey): Day {
  const { year, q } = parseQuarter(key);
  return toDay(new Date(year, (q - 1) * 3, 1));
}

export function quarterEnd(key: QuarterKey): Day {
  const { year, q } = parseQuarter(key);
  return toDay(new Date(year, q * 3, 0));
}

export function shiftQuarter(key: QuarterKey, n: number): QuarterKey {
  const { year, q } = parseQuarter(key);
  const i = year * 4 + (q - 1) + n;
  return `${Math.floor(i / 4)}-Q${((i % 4) + 1) as 1 | 2 | 3 | 4}`;
}

/** "Q4 2026" */
export function quarterLabel(key: QuarterKey): string {
  const { year, q } = parseQuarter(key);
  return `Q${q} ${year}`;
}

/** Week of the quarter a day falls in, 1 to 13 (the last few days fold into 13). */
export function weekOfQuarter(day: Day): number {
  const start = quarterStart(quarterOf(day));
  return Math.min(QUARTER_WEEKS, Math.floor(daysBetween(start, day) / 7) + 1);
}

/** First day of a given week of the quarter. */
export function weekStart(key: QuarterKey, week: number): Day {
  return addDays(quarterStart(key), (week - 1) * 7);
}

/** Every day of the quarter, up to and including `until` when given. */
export function quarterDays(key: QuarterKey, until?: Day): Day[] {
  const out: Day[] = [];
  const end = until && until < quarterEnd(key) ? until : quarterEnd(key);
  for (let d = quarterStart(key); d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Share of the quarter elapsed at `day`, 0..1. */
export function elapsedShare(key: QuarterKey, day: Day): number {
  const total = daysBetween(quarterStart(key), quarterEnd(key)) + 1;
  const done = Math.max(0, Math.min(total, daysBetween(quarterStart(key), day) + 1));
  return done / total;
}

/**
 * The join-week rule (Ayadi, 2026-10-07):
 * weeks 1-4 full targets; 5-8 prorated by weeks left ÷ 13; 9-13 no goals this
 * quarter, the first full quarter is the next one.
 *
 * OPEN RULE, held for Ayadi: a new tenant joining in weeks 5 to 8 also runs the
 * 15-post Launch, which can be more than the prorated target (week 6: 24 → 13).
 * The placeholder takes the larger of the two; the real rule isn't decided.
 */
export function joinState(joinedAt: Day): JoinState {
  const key = quarterOf(joinedAt);
  const week = weekOfQuarter(joinedAt);
  if (week <= 4) return { kind: "full", week };
  if (week <= 8) {
    const weeksLeft = QUARTER_WEEKS - week;
    return { kind: "prorated", week, weeksLeft, factor: weeksLeft / QUARTER_WEEKS, from: weekStart(key, week + 1) };
  }
  const next = shiftQuarter(key, 1);
  return { kind: "next_quarter", week, firstQuarter: next, startsOn: quarterStart(next) };
}

/** The next-quarter clock: draft at week 9, approve by week 11, batch 1 in week 13. */
export function nextQuarterClock(key: QuarterKey) {
  return {
    draftOn: weekStart(key, 9),
    nagFrom: weekStart(key, 10),
    approveBy: weekStart(key, 11),
    firstBatchBy: weekStart(key, 13),
  };
}

/** "3 Nov" */
export function shortDate(day: Day): string {
  return fromDay(day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
