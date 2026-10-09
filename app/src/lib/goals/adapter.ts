// The Goals data boundary. The pages talk to a GoalsAdapter through the hooks in
// lib/goals/useGoals.ts and never know where the data lives.
//
// Two adapters: the LIVE one on the Strategist's tables (lib/goals/live.ts,
// supabase/migrations/20261009000070_strategist.sql), and the PLACEHOLDER
// (lib/goals/placeholder.ts: sample data in memory) while a server doesn't
// have those tables yet. goalsAdapter below sends each call to the live one
// as soon as the server answers that the tables exist.

import type {
  BatchCadence,
  BatchPlan,
  GoalVersion,
  Launch,
  PlanDrop,
  Proposal,
  ProposalEdit,
  QuarterGoals,
  QuarterKey,
  StrategyAnswers,
  TenantGoalsContext,
} from "./types";
import { placeholderAdapter } from "./placeholder";
import { liveAdapter } from "./live";
import { UI_PREVIEW } from "@/lib/preview";

export interface GoalsAdapter {
  /** True while the data is sample data. The pages say so on screen. */
  readonly placeholder: boolean;
  subscribe(onChange: () => void): () => void;
  /** Bumps on every change; the hooks re-read on a new value. */
  version(): number;

  context(): TenantGoalsContext;
  /** The quarters the picker offers, oldest first. */
  quarters(): QuarterKey[];
  quarterGoals(quarter: QuarterKey): QuarterGoals;
  /** The latest proposal for a quarter that isn't superseded, if any. */
  proposal(quarter: QuarterKey): Proposal | null;
  launch(): Launch | null;
  batchPlan(quarter: QuarterKey): BatchPlan | null;
  planDrop(): PlanDrop;

  /** Approve writes a new goal version and recalculates the quarter's scores. */
  approveProposal(id: string, edited: Proposal, edits: ProposalEdit[]): Promise<GoalVersion>;
  /** Ask the Strategist for a revision. */
  requestChanges(id: string, note: string): Promise<void>;
  /** Save the plan drop: pasted text plus files (PDF, Word, Markdown, spreadsheets, images). */
  savePlanDrop(text: string, files: File[]): Promise<PlanDrop>;
  removePlanFile(id: string): Promise<void>;
  /**
   * The tenant's batching cadence. Re-batches what hasn't reached the inbox yet; delivered batches stay.
   * Real adapter: update agent_settings.batch_cadence ('weekly' | 'flood', one row per site; PR #43).
   */
  setBatchCadence(cadence: BatchCadence): Promise<void>;
  /**
   * Bring the next batch forward to today. Returns its number, or null when every batch is out.
   * Real adapter: a Chat dispatch to "pitcher" with "next batch" in the task (PR #43).
   */
  requestNextBatch(quarter: QuarterKey): Promise<number | null>;

  /**
   * The onboarding answers the Strategist starts from, per site. Not in
   * app_settings (public): competitor lists and plans are private.
   * Real adapter: tenant_profile.answers (draft shape in this PR's body).
   */
  strategyAnswers(siteId: string): StrategyAnswers;
  saveStrategyAnswers(siteId: string, answers: StrategyAnswers): Promise<void>;
}

/**
 * The real tables, always, outside the UI preview: a tenant with no goals sees
 * an empty page, never samples. In the UI preview (no server), the placeholder.
 */
const sample = () => UI_PREVIEW;
const pick = (): GoalsAdapter => (sample() ? placeholderAdapter : liveAdapter);

export const goalsAdapter: GoalsAdapter = {
  get placeholder() {
    return sample();
  },
  // The preview has no server: it never subscribes to the live tables.
  subscribe: (cb) => (UI_PREVIEW ? placeholderAdapter.subscribe(cb) : liveAdapter.subscribe(cb)),
  version: () => (UI_PREVIEW ? placeholderAdapter.version() : liveAdapter.version()),
  context: () => pick().context(),
  quarters: () => pick().quarters(),
  quarterGoals: (q) => pick().quarterGoals(q),
  proposal: (q) => pick().proposal(q),
  launch: () => pick().launch(),
  batchPlan: (q) => pick().batchPlan(q),
  planDrop: () => pick().planDrop(),
  approveProposal: (id, edited, edits) => pick().approveProposal(id, edited, edits),
  requestChanges: (id, note) => pick().requestChanges(id, note),
  savePlanDrop: (text, files) => pick().savePlanDrop(text, files),
  removePlanFile: (id) => pick().removePlanFile(id),
  setBatchCadence: (c) => pick().setBatchCadence(c),
  requestNextBatch: (q) => pick().requestNextBatch(q),
  strategyAnswers: (site) => pick().strategyAnswers(site),
  saveStrategyAnswers: (site, answers) => pick().saveStrategyAnswers(site, answers),
};

/** Ask the Strategist for a proposal. A no-op on the placeholder (nothing to run). */
export async function askStrategist(kind: "onboarding" | "quarterly" | "revision", note = "", quarter?: QuarterKey): Promise<string | null> {
  return sample() ? null : liveAdapter.askStrategist(kind, note, quarter);
}

/** The newest request's state while the tables are live: "requested", "running", "failed", ... */
export function strategistState() {
  return sample() ? null : liveAdapter.strategistState();
}
