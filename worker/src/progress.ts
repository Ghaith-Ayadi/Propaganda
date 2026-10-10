// GET /progress/strategist?site=: what a tenant's member sees while the
// Strategist works on day one (onboarding/first-day-flow.md, stage 2), read
// from DBOS's record of the runs. Read-only, and only the newest proposal of
// a site the caller is a member of (http.ts checks site_members first).
// The app's copy of the shape: the Getting started page.

import { DBOS, type WorkflowStatus } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { planSteps, PLAN_STEPS, type StepState } from "./agents/first-day.js";
import { DRAFTS_EVENT, PLAN_EVENT, firstDraftsId, firstPitchesId, type FirstPitchesResult, type TopicResult } from "./workflows/first-day.js";

export interface StrategistProgress {
  /** The site's newest strategy_proposals row. */
  proposalId: string | null;
  status: "requested" | "running" | "sent" | "approved" | "failed" | "superseded" | null;
  /** The five lines, in order. */
  steps: { label: string; state: StepState }[];
  /** That proposal's first pitches; null before they start (or when it gets none). */
  pitches: { topicsDone: number; topics: number; written: number } | null;
  /** The drafts started when the plan was approved; [] before. */
  drafts: { briefId: string; state: "running" | "done" | "failed" }[];
}

const IN_FLIGHT = new Set(["PENDING", "ENQUEUED", "DELAYED"]);
const FINISHED = new Set(["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);

async function statuses(ids: string[], loadOutput = false): Promise<Map<string, WorkflowStatus>> {
  if (!ids.length) return new Map();
  const rows = await DBOS.listWorkflows({ workflowIDs: ids, loadInput: false, loadOutput });
  return new Map(rows.map((w) => [w.workflowID, w]));
}

async function event<T>(workflowID: string, key: string): Promise<T | null> {
  return (await DBOS.getEvent<T>(workflowID, key, { timeoutSeconds: 0 })) ?? null;
}

export async function strategistProgress(db: Pool, site: string): Promise<StrategistProgress> {
  const { rows } = await db.query<{ id: string; status: StrategistProgress["status"]; run_id: string }>(
    "select id, status, run_id from public.strategy_proposals where site = $1 order by created desc limit 1",
    [site],
  );
  const row = rows[0];
  if (!row) return { proposalId: null, status: null, steps: PLAN_STEPS.map((label) => ({ label, state: "waiting" })), pitches: null, drafts: [] };

  const runId = row.run_id || `strategist-${row.id}`;
  const steps = ((await DBOS.listWorkflowSteps(runId).catch(() => undefined)) ?? []).map((s) => ({
    name: s.name,
    done: Boolean(s.completedAtEpochMs) && !s.error,
  }));

  // The first pitches: one child per topic (the plan event names them).
  let pitches: StrategistProgress["pitches"] = null;
  const parent = (await statuses([firstPitchesId(row.id)], true)).get(firstPitchesId(row.id));
  if (parent && !(parent.status === "SUCCESS" && (parent.output as FirstPitchesResult | undefined)?.skipped)) {
    const plan = await event<{ topics: string[]; children: string[] }>(parent.workflowID, PLAN_EVENT);
    const children = await statuses(plan?.children ?? [], true);
    let topicsDone = 0;
    let written = 0;
    for (const w of children.values()) {
      if (FINISHED.has(w.status)) topicsDone++;
      if (w.status === "SUCCESS") written += Number((w.output as TopicResult | undefined)?.written) || 0;
    }
    pitches = { topicsDone, topics: plan?.children.length ?? 0, written };
  }

  // The drafts started on approval.
  const started = (await event<{ briefId: string; runId: string }[]>(firstDraftsId(row.id), DRAFTS_EVENT).catch(() => null)) ?? [];
  const runs = await statuses(started.map((d) => d.runId));
  const drafts = started.map((d) => {
    const s = runs.get(d.runId)?.status ?? "ENQUEUED";
    return { briefId: d.briefId, state: (IN_FLIGHT.has(s) ? "running" : s === "SUCCESS" ? "done" : "failed") as "running" | "done" | "failed" };
  });

  return { proposalId: row.id, status: row.status, steps: planSteps(row.status, steps), pitches, drafts };
}
