// The Goals data boundary. The pages talk to a GoalsAdapter through the hooks in
// lib/goals/useGoals.ts and never know where the data lives.
//
// Today the only adapter is the PLACEHOLDER (lib/goals/placeholder.ts): sample
// data in memory, nothing reaches the server. When the goal tables land
// (goals, goal_topics, goal_searches, goal_scores, strategy_proposals,
// content_batches, tenant_plan_files; draft schema in the PR that added this
// file), a Supabase adapter implements this interface and replaces it here.

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
   * Real adapter: tenant_profile.answers (draft table in the PR).
   */
  strategyAnswers(siteId: string): StrategyAnswers;
  saveStrategyAnswers(siteId: string, answers: StrategyAnswers): Promise<void>;
}

export const goalsAdapter: GoalsAdapter = placeholderAdapter;
