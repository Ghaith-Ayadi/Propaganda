// How a pitch rates: one-line reasons from the goals, no score out of 100
// (goal-model.md, "Rating a pitch"). Code decides the reasons from what the
// model judged about the idea plus the goals and the pipeline, so the same
// facts always give the same fit. The shapes match the pipeline UI
// (app/src/lib/pipeline/types.ts and fit.ts, PR #30): the UI recomputes the
// grade from these reasons and gets the same answer.

import { sideOf, type Goals, type Standing } from "./goals.js";

export type ReasonKind = "demand" | "mix" | "cadence" | "timeliness" | "gap" | "duplicate";
export type GoalKey = "volume" | "coverage" | "consistency" | "readership" | "ranking";
export type FitGrade = "strong" | "fair" | "weak";

export interface FitReason {
  kind: ReasonKind;
  text: string;
  counts: boolean;
}

export interface GoalEffect {
  goal: GoalKey;
  moves: boolean;
  note: string;
}

/** What the model judged about one idea. Code turns it into reasons. */
export interface Judgement {
  topics: string[];
  /** One of the target searches this post would rank for, or "". */
  targetSearch: string;
  /** True when it's tied to news or a date and loses value after `expiresAt`. */
  timely: boolean;
  expiresAt: string;
  /** It answers something the tenant claims without backing, or a question customers keep asking. */
  answersGap: string;
  /** Evidence of search demand ("2.4k searches a month for ..."), or "". */
  demand: string;
  /** Title of a published or pipeline post it repeats, or "". */
  duplicateOf: string;
  /** A flagged post it would replace, or "". */
  replacesFlagged: string;
}

export function fitScore(reasons: FitReason[]): number {
  let n = 0;
  for (const r of reasons) {
    if (r.kind === "duplicate") n -= 1;
    else if (r.counts) n += 1;
  }
  return n;
}

export function fitGrade(reasons: FitReason[]): FitGrade {
  const n = fitScore(reasons);
  if (n >= 3) return "strong";
  if (n >= 1) return "fair";
  return "weak";
}

export interface Rated {
  reasons: FitReason[];
  goals: GoalEffect[];
  grade: FitGrade;
  /** No reason counts: the idea is not pitched (rejected with "no reason yet", kept). */
  pitch: boolean;
}

export function rate(j: Judgement, origin: string, goals: Goals | null, st: Standing, nextEmptyWeek: string | null): Rated {
  const reasons: FitReason[] = [];
  const effects: GoalEffect[] = [];
  const side = sideOf(origin);

  // A post the goals want: one in a goal topic (any post, before there are
  // goals). Only those earn the empty-week and coverage reasons.
  const inGoalTopic = !goals || j.topics.some((t) => goals.volume.topics.some((g) => g.name.toLowerCase() === t.toLowerCase()));

  // Volume: a topic under its target, or a topic already at the top of its range.
  let volumeMoves = false;
  if (goals) {
    for (const t of j.topics) {
      const g = goals.volume.topics.find((x) => x.name.toLowerCase() === t.toLowerCase());
      if (!g) continue;
      const have = st.byTopic[g.name] ?? 0;
      if (have < g.low) {
        reasons.push({ kind: "mix", text: `${g.name} is under target: ${have} of ${g.low} to ${g.high} this quarter.`, counts: true });
        volumeMoves = true;
      } else if (have >= g.high) {
        reasons.push({ kind: "duplicate", text: `${g.name} is already at the top of its range (${have} of ${g.high}).`, counts: false });
      }
    }
  }
  if (nextEmptyWeek && inGoalTopic) {
    reasons.push({ kind: "cadence", text: `Fills an empty week (${nextEmptyWeek}).`, counts: true });
    volumeMoves = true;
  }
  effects.push({ goal: "volume", moves: volumeMoves, note: volumeMoves ? "Counts toward a topic or week that's short." : "Counts toward the total." });

  // Coverage: the side this idea comes from is behind its goal.
  let coverageMoves = false;
  if (goals && inGoalTopic) {
    const goal = side === "internal" ? goals.coverage.internal : goals.coverage.external;
    const have = side === "internal" ? st.internal : st.external;
    if (goal > 0 && have < goal) {
      const label = side === "internal" ? "From what you know" : "From outside demand";
      reasons.push({ kind: "mix", text: `${label}, which is behind: ${have} of ${goal} planned.`, counts: true });
      coverageMoves = true;
    }
  }
  effects.push({ goal: "coverage", moves: coverageMoves, note: side === "internal" ? "An internal post (your calls, team or plan)." : "An external post (search, news, watched sites)." });

  // Ranking: one of the 10 target searches we're not on page one for.
  let rankingMoves = false;
  if (j.targetSearch && goals) {
    const s = goals.searches.find((x) => x.query.toLowerCase() === j.targetSearch.toLowerCase());
    if (s && (s.position === null || s.position > 10)) {
      reasons.push({
        kind: "demand",
        text: `Targets "${s.query}", where you're ${s.position === null ? "not in the top 100" : `at #${s.position}`}.`,
        counts: true,
      });
      rankingMoves = true;
    }
  }
  if (j.demand) reasons.push({ kind: "demand", text: j.demand, counts: !rankingMoves });
  effects.push({ goal: "ranking", moves: rankingMoves, note: rankingMoves ? `Aims at "${j.targetSearch}".` : "No target search." });

  // Consistency: replaces a flagged post.
  if (j.replacesFlagged) reasons.push({ kind: "gap", text: `Replaces a flagged post: ${j.replacesFlagged}.`, counts: true });
  effects.push({ goal: "consistency", moves: Boolean(j.replacesFlagged), note: j.replacesFlagged ? "Replaces a flagged post." : "Checked against the knowledge base when written." });

  if (j.timely) reasons.push({ kind: "timeliness", text: `Timely: worth less after ${j.expiresAt || "the news moves on"}.`, counts: true });
  if (j.answersGap) reasons.push({ kind: "gap", text: j.answersGap, counts: true });
  if (j.duplicateOf) reasons.push({ kind: "duplicate", text: `Overlaps with "${j.duplicateOf}".`, counts: false });

  // Readership never rates a pitch.
  effects.push({ goal: "readership", moves: false, note: "Measured after it's published." });

  const grade = fitGrade(reasons);
  return { reasons, goals: effects, grade, pitch: fitScore(reasons) >= 1 };
}
