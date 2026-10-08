// PLACEHOLDER ADAPTER: example goal targets, scores, drift notes and Launch
// for Home, until the goal model's tables exist (goals, goal_topics,
// goal_searches, goal_scores, drift_notes, content_batches; see the goal model
// and the Strategist docs in project files). Lines are deterministic shapes
// over the real quarter so the page reads like a real one. data.ts imports
// this; the live adapter replaces it there.

import type { DayPoint } from "@/lib/analytics/types";
import { addDays, dayKey, type Quarter } from "@/components/shared/quarter";
import type { HomePlaceholder } from "./data";

/** A slow climb toward `to` by quarter end, with a little day-to-day wobble. */
function climb(days: string[], from: number, to: number, wobble: number, seed: number): DayPoint[] {
  const n = 91;
  return days.map((day, i) => {
    const t = i / n;
    const eased = 1 - Math.pow(1 - t, 1.6);
    const noise = Math.sin((i + seed) * 1.7) * wobble + Math.sin((i + seed) * 0.37) * wobble * 0.6;
    return { day, value: Math.max(0, from + (to - from) * eased + noise) };
  });
}

export const placeholderHome: HomePlaceholder = {
  volumeTarget: 18,
  volumeTopics: { onTarget: 2, of: 3 },
  coverage: (days) => climb(days, 20, 90, 1.2, 3),
  consistency: (days) => climb(days, 80, 92, 1.5, 7),
  grades: { content: "C", kb: "B" },
  readership: (days) =>
    days.map((day, i) => ({ day, value: Math.round(40 + i * 1.8 + Math.max(0, Math.sin(i * 0.9) * 35) + (i % 7 === 2 ? 60 : 0)) })),
  rankingTargets: 10,
  ranking: (days) => days.map((day, i) => ({ day, value: i < 9 ? 0 : i < 30 ? 1 : 2 })),
  // The quarter's goals were adjusted once, two weeks in.
  changes: (q: Quarter) => [dayKey(addDays(q.start, 14))],
  drift: [
    {
      id: "drift-volume",
      goal: "volume",
      severity: "warning",
      message: "Volume is behind the pace: 1 post published where the pace says 3. Batch 2 has waited on review for 4 days.",
      action: { label: "Review batch 2", page: "inbox", rest: "pitches" },
    },
    {
      id: "drift-consistency",
      goal: "consistency",
      severity: "info",
      message: "Two posts name the pricing tiers two ways. Fixing them lifts the content grade from C to B.",
      action: { label: "Work the flags", page: "inbox", rest: "flags" },
    },
  ],
  launch: {
    day: 14,
    live: 9,
    planned: 15,
    clusters: [
      { name: "Month-end close", live: 6, planned: 8 },
      { name: "Approvals", live: 3, planned: 7 },
    ],
    indexed: 7,
    why: "A new blog has no authority yet. The first month builds a library in two topics so Google and readers can tell what you're about. Rankings come in months 3 to 6.",
  },
};
