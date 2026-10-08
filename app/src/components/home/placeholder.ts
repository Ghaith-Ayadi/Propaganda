// PLACEHOLDER ADAPTER: example goal targets, scores and the Launch campaign
// for Home, until the goal model's tables exist (goals, goal_topics,
// goal_searches, goal_scores, campaigns or content_batches; see the goal model
// and the Strategist docs in project files). Lines are deterministic shapes
// over the real quarter so the page reads like a real one. data.ts imports
// this; the live adapter replaces it there.

import type { DayPoint } from "@/lib/analytics/types";
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
  volumeTopics: [
    { name: "Month-end close", published: 6, pitched: 9, target: 8 },
    { name: "Approvals", published: 3, pitched: 5, target: 7 },
    { name: "Audit trail", published: 0, pitched: 2, target: 3 },
  ],
  consistency: (days) => climb(days, 80, 92, 1.5, 7),
  grades: { content: "C", kb: "B", contentTarget: "B", kbTarget: "A" },
  readership: (days) =>
    days.map((day, i) => ({ day, value: Math.round(40 + i * 1.8 + Math.max(0, Math.sin(i * 0.9) * 35) + (i % 7 === 2 ? 60 : 0)) })),
  rankingTargets: 10,
  rankingGoal: 2,
  ranking: (days) => days.map((day, i) => ({ day, value: i < 3 ? 0 : i < 6 ? 1 : 2 })),
  campaigns: [
    {
      id: "launch",
      name: "Launch",
      description: "15 posts in two topics over the first 30 days",
      day: 14,
      days: 30,
      objectives: [
        { label: "Posts live", value: 9, target: 15 },
        { label: "Month-end close", value: 6, target: 8 },
        { label: "Approvals", value: 3, target: 7 },
        { label: "Indexed by Google", value: 7, target: 15 },
      ],
      why: "A new blog has no authority yet. The first month builds a library in two topics so Google and readers can tell what you're about. Rankings come in months 3 to 6.",
    },
  ],
};
