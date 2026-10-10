// Where a tenant's first day stands, read from its own data: the settings it
// saved, the Strategist's requests and proposals, the first pitches on the
// board and the first article. Nothing here is stored as "the step": reload
// the page, or open it on another device, and it lands on the same place.
//
//   onboarding.business      "Your business" was confirmed (a timestamp)
//   onboarding.firstArticle  the post published from Getting started
//   onboarding.after         "guide": they chose to carry on with the first batch
//   onboarding.completed     finished ("I got it"): the page leaves the nav

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { useLatestProposal, useStrategistState } from "@/lib/goals/useGoals";
import { usePipeline } from "@/lib/pipeline/store";
import type { PipelineItem } from "@/lib/pipeline/types";
import type { Proposal } from "@/lib/goals/types";
import type { StrategistState } from "@/lib/goals/live";

export type StepId = "business" | "strategy" | "planning" | "plan" | "pitches" | "drafts" | "publish";

export interface TimelineStep {
  id: StepId;
  label: string;
  /** About how long it takes. */
  minutes: number;
  /** An agent's step: it runs while the person does something else. */
  agent?: boolean;
}

export const TIMELINE: TimelineStep[] = [
  { id: "business", label: "Your business", minutes: 2 },
  { id: "strategy", label: "Your strategy", minutes: 5 },
  { id: "planning", label: "The Strategist writes your plan", minutes: 3, agent: true },
  { id: "plan", label: "Review and approve the plan", minutes: 5 },
  { id: "pitches", label: "Your first pitches", minutes: 10 },
  { id: "drafts", label: "The Writer drafts the strongest 3", minutes: 5, agent: true },
  { id: "publish", label: "Publish your first article", minutes: 5 },
];

export const MAX_ROUNDS = 5;
export const STRATEGIST = "agent:strategist";

export interface FirstDay {
  /** False until the settings and the goals have answered once. */
  ready: boolean;
  step: StepId;
  done: Set<StepId>;
  /** What's running now (a person's step, and an agent's beside it). */
  active: Set<StepId>;
  strategist: StrategistState | null;
  proposal: Proposal | null;
  /** The Strategist is writing (a first plan or a revision). */
  planning: boolean;
  /** The newest request failed and nothing replaced it. */
  failed: string | null;
  firstPitches: PipelineItem[];
  /** Post id → the draft has words in it. */
  drafted: Map<string, boolean>;
  firstArticle: string | null;
  after: "guide" | null;
  completed: boolean;
}

export function useFirstDay(): FirstDay {
  const business = useSetting<string>("onboarding.business", "");
  const firstArticle = useSetting<string>("onboarding.firstArticle", "") || null;
  const after = useSetting<string>("onboarding.after", "") === "guide" ? "guide" : null;
  const completed = !!useSetting<string>("onboarding.completed", "");
  const strategist = useStrategistState();
  const proposal = useLatestProposal();
  const { items, loading } = usePipeline();

  const firstPitches = useMemo(
    () => items.filter((i) => i.pitchedBy === STRATEGIST).sort((a, b) => a.createdAt - b.createdAt),
    [items],
  );
  const postIds = firstPitches.map((p) => p.postId).filter(Boolean) as string[];
  const posts = useLiveQuery(() => db.posts.bulkGet(postIds), [postIds.join(",")], []);
  const drafted = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const p of posts) if (p) m.set(p.id, !!p.content.trim());
    return m;
  }, [posts]);

  return useMemo(() => {
    const running = strategist?.status === "requested" || strategist?.status === "running";
    const failed = strategist?.status === "failed" ? strategist.error || "The Strategist stopped." : null;
    const sent = proposal?.status === "sent";
    const approved = proposal?.status === "approved";
    const planning = running || proposal?.status === "changes_requested";

    const done = new Set<StepId>();
    if (business || strategist) done.add("business");
    if (strategist) done.add("strategy");
    if ((sent || approved) && !planning) done.add("planning");
    if (approved) done.add("plan");
    const draftsReady = firstPitches.filter((p) => p.postId && drafted.get(p.postId)).length;
    const draftsStarted = firstPitches.filter((p) => p.postId).length;
    if (approved && draftsStarted > 0 && draftsReady >= draftsStarted) done.add("drafts");
    if (firstArticle) {
      done.add("pitches");
      done.add("drafts");
      done.add("publish");
    }

    let step: StepId;
    if (!strategist && !proposal) step = business ? "strategy" : "business";
    else if (approved) step = firstArticle && after !== "guide" ? "publish" : "pitches";
    else if (sent && !planning) step = "plan";
    else step = "planning";

    const active = new Set<StepId>([step]);
    if (step === "pitches" && !done.has("drafts")) active.add("drafts");
    if (completed) for (const t of TIMELINE) done.add(t.id);

    return {
      ready: !loading,
      step,
      done,
      active,
      strategist,
      proposal,
      planning: !!planning,
      failed: failed && !sent && !approved ? failed : null,
      firstPitches,
      drafted,
      firstArticle,
      after,
      completed,
    };
  }, [business, firstArticle, after, completed, strategist, proposal, firstPitches, drafted, loading]);
}

/** The minutes left on the timeline (an agent's step beside a person's doesn't add). */
export function minutesLeft(done: Set<StepId>, active: Set<StepId>): number {
  const personBusy = TIMELINE.some((t) => active.has(t.id) && !t.agent);
  return TIMELINE.filter((t) => !done.has(t.id) && !(t.agent && personBusy && !active.has(t.id))).reduce((n, t) => n + t.minutes, 0);
}
