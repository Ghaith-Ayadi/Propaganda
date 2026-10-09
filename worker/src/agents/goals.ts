// What the Pitcher rates ideas against: the quarter's goals (reviews/goal-model.md)
// and the state of the pipeline. The goals tables come with the Goals build;
// until then a run can carry the goals in its input, and without any the
// Pitcher still has the reasons that don't need targets (timeliness, a gap in
// what the tenant has said, search demand, an empty week).

import { latestGoals, latestPositions, settings } from "./strategy-store.js";

export interface TopicGoal {
  name: string;
  /** The range for the quarter; `low` is what counts as on target. */
  low: number;
  high: number;
}

export interface Goals {
  /** "2026-Q4" */
  quarter: string;
  /** Posts this quarter, split by topic. */
  volume: { total: number; topics: TopicGoal[] };
  /** Posts planned from the tenant's own knowledge vs outside demand. */
  coverage: { internal: number; external: number };
  /** The 10 target searches, with today's Google position (null when not in the top 100). */
  searches: { query: string; position: number | null }[];
  /** Posts a week the team can review; empty weeks are counted against it. */
  perWeek: number;
}

/** Where the quarter stands: what's published or in the pipeline, per topic and per side. */
export interface Standing {
  byTopic: Record<string, number>;
  internal: number;
  external: number;
  /** ISO weeks (YYYY-Www) from now to the end of the quarter with fewer posts planned than perWeek. */
  emptyWeeks: string[];
}

/**
 * The tenant's approved goals for this quarter (the newest goal_versions row,
 * written when they approve a Strategist proposal), or null. Coverage is no
 * longer a goal (2026-10-08): it reads as zero, which moves nothing in fit.ts.
 */
export async function readGoals(site: string, now = new Date()): Promise<Goals | null> {
  const { label } = quarterOf(now);
  const row = await latestGoals(site, label);
  if (!row) return null;
  const t = row.targets;
  const [positions, set] = await Promise.all([latestPositions(site), settings(site, ["strategist.reviewPerMonth"])]);
  return {
    quarter: label,
    volume: {
      total: Number(t.volume?.total) || 0,
      topics: (t.volume?.topics ?? []).map((x) => ({ name: x.name, low: Number(x.low) || 0, high: Number(x.high) || 0 })),
    },
    coverage: { internal: 0, external: 0 },
    searches: (t.ranking?.searches ?? []).map((s) => ({ query: s.query, position: positions.get(s.query.toLowerCase()) ?? null })),
    perWeek: Math.max(1, Math.round((parseInt(String(set["strategist.reviewPerMonth"] ?? ""), 10) || 8) / 4.33)),
  };
}

export const INTERNAL_ORIGINS = new Set(["calls", "team", "plan"]);

export function sideOf(origin: string): "internal" | "external" {
  return INTERNAL_ORIGINS.has(origin) ? "internal" : "external";
}

export function quarterOf(d: Date): { label: string; start: Date; end: Date } {
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1));
  return { label: `${d.getUTCFullYear()}-Q${q + 1}`, start, end };
}

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export interface CountedPost {
  topics: string[];
  origin: string;
  /** YYYY-MM-DD it is (or was) published, or "" when not planned yet. */
  date: string;
}

export function standing(posts: CountedPost[], perWeek: number, now: Date): Standing {
  const byTopic: Record<string, number> = {};
  let internal = 0;
  let external = 0;
  const perWeekCount = new Map<string, number>();
  for (const p of posts) {
    // A post in two topics counts in both, once in the total (goal-model.md).
    for (const t of new Set(p.topics)) byTopic[t] = (byTopic[t] ?? 0) + 1;
    if (sideOf(p.origin) === "internal") internal++;
    else external++;
    if (p.date) {
      const w = isoWeek(new Date(`${p.date}T12:00:00Z`));
      perWeekCount.set(w, (perWeekCount.get(w) ?? 0) + 1);
    }
  }
  const emptyWeeks: string[] = [];
  if (perWeek > 0) {
    const { end } = quarterOf(now);
    const seen = new Set<string>();
    for (let d = new Date(now); d < end; d = new Date(d.getTime() + 86_400_000)) {
      const w = isoWeek(d);
      if (seen.has(w)) continue;
      seen.add(w);
      if ((perWeekCount.get(w) ?? 0) < perWeek) emptyWeeks.push(w);
    }
  }
  return { byTopic, internal, external, emptyWeeks };
}
