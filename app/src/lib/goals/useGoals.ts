// Typed hooks over the goals adapter (lib/goals/adapter.ts). Components read
// goals only through these, so swapping the placeholder for the real tables
// touches one file.

import { useMemo, useSyncExternalStore } from "react";
import { askStrategist, goalsAdapter, strategistState } from "./adapter";
import type { BatchPlan, Launch, PlanDrop, Proposal, QuarterGoals, QuarterKey, StrategyAnswers, TenantGoalsContext } from "./types";

function useVersion(): number {
  return useSyncExternalStore(goalsAdapter.subscribe, goalsAdapter.version);
}

export function useGoalsContext(): TenantGoalsContext {
  const v = useVersion();
  return useMemo(() => goalsAdapter.context(), [v]);
}

export function useQuarters(): QuarterKey[] {
  const v = useVersion();
  return useMemo(() => goalsAdapter.quarters(), [v]);
}

export function useQuarterGoals(quarter: QuarterKey): QuarterGoals {
  const v = useVersion();
  return useMemo(() => goalsAdapter.quarterGoals(quarter), [v, quarter]);
}

export function useProposal(quarter: QuarterKey): Proposal | null {
  const v = useVersion();
  return useMemo(() => goalsAdapter.proposal(quarter), [v, quarter]);
}

/**
 * The Strategist's proposal waiting on the tenant (sent, not yet approved), in
 * any quarter the app shows, or null. Home's banner and the Inbox read it.
 */
export function useWaitingProposal(): Proposal | null {
  const v = useVersion();
  return useMemo(() => {
    for (const q of goalsAdapter.quarters()) {
      const p = goalsAdapter.proposal(q);
      if (p?.status === "sent") return p;
    }
    return null;
  }, [v]);
}

export function useLaunch(): Launch | null {
  const v = useVersion();
  return useMemo(() => goalsAdapter.launch(), [v]);
}

export function useBatchPlan(quarter: QuarterKey): BatchPlan | null {
  const v = useVersion();
  return useMemo(() => goalsAdapter.batchPlan(quarter), [v, quarter]);
}

export function usePlanDrop(): PlanDrop {
  const v = useVersion();
  return useMemo(() => goalsAdapter.planDrop(), [v]);
}

export function useStrategyAnswers(siteId: string): StrategyAnswers {
  const v = useVersion();
  return useMemo(() => goalsAdapter.strategyAnswers(siteId), [v, siteId]);
}

export const goalsActions = {
  saveStrategyAnswers: goalsAdapter.saveStrategyAnswers,
  approveProposal: goalsAdapter.approveProposal,
  requestChanges: goalsAdapter.requestChanges,
  savePlanDrop: goalsAdapter.savePlanDrop,
  removePlanFile: goalsAdapter.removePlanFile,
  setBatchCadence: goalsAdapter.setBatchCadence,
  requestNextBatch: goalsAdapter.requestNextBatch,
  askStrategist,
};

/** True while the page shows sample data (the server has no goal tables yet). */
export function useGoalsArePlaceholder(): boolean {
  useVersion();
  return goalsAdapter.placeholder;
}

/** The Strategist's newest request ("requested", "running", "failed", ...), or null. */
export function useStrategistState() {
  const v = useVersion();
  return useMemo(() => strategistState(), [v]);
}
