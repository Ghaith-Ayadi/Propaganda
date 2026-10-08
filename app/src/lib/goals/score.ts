// Goal scoring: the arithmetic of the goal model (reviews/goal-model.md).
// Pure functions over stored daily facts and one goal version's targets.
// The daily DBOS job will run exactly this to fill goal_scores; a goal change
// runs it again over the whole quarter. The UI never computes scores itself,
// it reads them (today: from the placeholder adapter, which calls this).

import type { ConsistencyNow, Day, GoalKind, GoalTargets, Grade, QuarterKey, ScorePoint } from "./types";
import { quarterDays } from "./quarter";

/** One published post, as the daily facts record it. */
export interface PublishedFact {
  day: Day;
  topics: string[];
  origin: "internal" | "external";
  /** false = a bonus post (news, calls), counted on top of the plan. */
  planned: boolean;
}

export interface ReadershipFact {
  day: Day;
  pageviews: number;
  sessions: number;
  readingSeconds: number;
  postsRead: number;
}

export interface RankingFact {
  day: Day;
  positions: Record<string, number | null>;
  aiMentions: number;
}

export interface ConsistencyFact {
  day: Day;
  contentClean: number | null;
  kbClean: number | null;
}

export interface QuarterFacts {
  published: PublishedFact[];
  readership: ReadershipFact[];
  ranking: RankingFact[];
  consistency: ConsistencyFact[];
}

export function pct(n: number, d: number): number {
  return d <= 0 ? 0 : (n / d) * 100;
}

/**
 * Volume: planned posts published ÷ the quarter's total. Can pass 100%.
 *
 * OPEN RULE, held for Ayadi until the daily scoring job is built: this counts
 * only planned posts and reports bonus posts (news, calls) on the side, after
 * the cold-start doc's "0% opportunistic, bonus on top". The approved goal model
 * (reviews/goal-model.md) counts every published post. Don't reuse this in the
 * job before he picks one.
 */
export function volumeScore(published: PublishedFact[], t: GoalTargets["volume"]) {
  const planned = published.filter((p) => p.planned);
  const byTopic: Record<string, number> = {};
  // A post in two topics counts in each topic, once in the total.
  for (const p of planned) for (const topic of p.topics) byTopic[topic] = (byTopic[topic] ?? 0) + 1;
  const onTarget = t.topics.filter((x) => (byTopic[x.name] ?? 0) >= x.low).length;
  return {
    published: planned.length,
    bonus: published.length - planned.length,
    byTopic,
    percent: pct(planned.length, t.total),
    topicsOnTarget: onTarget,
    topicCount: t.topics.length,
  };
}

/** Coverage: each side capped at its goal before combining, so one side can't hide the other. */
export function coverageScore(published: PublishedFact[], t: GoalTargets["coverage"]) {
  const internal = published.filter((p) => p.origin === "internal").length;
  const external = published.filter((p) => p.origin === "external").length;
  const total = t.internal + t.external;
  return {
    internal,
    external,
    internalPercent: Math.min(100, pct(internal, t.internal)),
    externalPercent: Math.min(100, pct(external, t.external)),
    combined: pct(Math.min(internal, t.internal) + Math.min(external, t.external), total),
  };
}

export function grade(clean: number | null): Grade | null {
  if (clean == null) return null;
  if (clean >= 0.95) return "A";
  if (clean >= 0.85) return "B";
  if (clean >= 0.7) return "C";
  if (clean >= 0.5) return "D";
  return "F";
}

export function consistencyNow(f: ConsistencyFact | undefined): ConsistencyNow {
  return {
    contentClean: f?.contentClean ?? null,
    kbClean: f?.kbClean ?? null,
    contentGrade: grade(f?.contentClean ?? null),
    kbGrade: grade(f?.kbClean ?? null),
  };
}

export function rankingPageOne(positions: Record<string, number | null>, queries: string[]): number {
  return queries.filter((q) => {
    const p = positions[q];
    return p != null && p <= 10;
  }).length;
}

/**
 * The daily score series for a quarter: each day recomputed from the facts up to
 * that day with the given targets. This is the "a goal change recalculates the
 * quarter" rule: the old line isn't kept, the graph marks the change instead.
 */
export function scoreSeries(
  quarter: QuarterKey,
  until: Day,
  facts: QuarterFacts,
  targets: GoalTargets,
): Record<GoalKind, ScorePoint[]> {
  const days = quarterDays(quarter, until);
  const queries = targets.ranking.searches.map((s) => s.query);
  const out: Record<GoalKind, ScorePoint[]> = { volume: [], coverage: [], consistency: [], readership: [], ranking: [] };
  let readingSeconds = 0;
  const rByDay = new Map(facts.readership.map((r) => [r.day, r]));
  const rankByDay = new Map(facts.ranking.map((r) => [r.day, r]));
  const consByDay = new Map(facts.consistency.map((c) => [c.day, c]));
  for (const day of days) {
    const pub = facts.published.filter((p) => p.day <= day);
    out.volume.push({ day, value: volumeScore(pub, targets.volume).percent });
    out.coverage.push({ day, value: coverageScore(pub, targets.coverage).combined });
    const c = consByDay.get(day);
    if (c?.contentClean != null) out.consistency.push({ day, value: c.contentClean * 100 });
    readingSeconds += rByDay.get(day)?.readingSeconds ?? 0;
    out.readership.push({ day, value: Math.round(readingSeconds / 60) });
    const r = rankByDay.get(day);
    if (r) out.ranking.push({ day, value: rankingPageOne(r.positions, queries) });
  }
  return out;
}

/** Pace for the weekly check: actual ÷ (target × share of the quarter elapsed). */
export function pace(actual: number, target: number, elapsed: number): number {
  const expected = target * elapsed;
  return expected <= 0 ? 1 : actual / expected;
}
