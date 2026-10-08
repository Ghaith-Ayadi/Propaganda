// The Runs page's data: DBOS's own record of every workflow (through its
// management API, not raw SQL on its tables, so a DBOS upgrade can't break
// it) joined with the cost log (public.model_calls) on the workflow id.
//
// The wire format is copied in app/src/lib/admin/runs.ts; keep both in step.

import { DBOS, type WorkflowStatus, type WorkflowStatusString } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { HttpError } from "./auth.js";
import { STALL_EVENT, tenantKeyOf, usageLimitOf, type Stall } from "./limits.js";

type StepInfo = NonNullable<Awaited<ReturnType<typeof DBOS.listWorkflowSteps>>>[number];

/** What a person reads, folded from DBOS's statuses plus the stall event. */
export type RunState = "queued" | "running" | "stalled" | "done" | "failed" | "cancelled";

export interface Cost {
  usd: number;
  calls: number;
  /** Calls whose model had no price: the total is a floor. */
  unpriced: number;
}

export interface RunSummary {
  id: string;
  name: string;
  state: RunState;
  /** DBOS's own status, for the curious. */
  status: string;
  site: string | null;
  createdAt: number;
  updatedAt: number | null;
  completedAt: number | null;
  stall: Stall | null;
  error: string | null;
  /** null when the cost log can't be read (not deployed yet). */
  cost: Cost | null;
  parentId: string | null;
  forkedFrom: string | null;
  recoveryAttempts: number;
  queue: string | null;
}

export type StepState = "done" | "failed" | "stalled" | "running";

export interface StepView {
  id: number;
  name: string;
  state: StepState;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  childId: string | null;
  cost: Cost | null;
}

export interface RunDetail extends RunSummary {
  input: unknown;
  output: unknown;
  steps: StepView[];
  /** What retry would do now, or null when it can't. */
  retry: "resume" | "fork" | null;
  cancellable: boolean;
}

const STATES: Record<RunState, WorkflowStatusString[]> = {
  queued: ["ENQUEUED", "DELAYED"],
  running: ["PENDING"],
  stalled: ["PENDING"],
  done: ["SUCCESS"],
  failed: ["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"],
  cancelled: ["CANCELLED"],
};

const ACTIVE = new Set(["PENDING", "ENQUEUED", "DELAYED"]);

function messageOf(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as { name?: unknown; message?: unknown };
    const msg = typeof e.message === "string" ? e.message : JSON.stringify(err);
    return typeof e.name === "string" && e.name !== "Error" ? `${e.name}: ${msg}` : msg;
  }
  return String(err);
}

function stateOf(status: string, stall: Stall | null): RunState {
  switch (status) {
    case "PENDING":
      return stall ? "stalled" : "running";
    case "ENQUEUED":
    case "DELAYED":
      return "queued";
    case "SUCCESS":
      return "done";
    case "CANCELLED":
      return "cancelled";
    default:
      return "failed";
  }
}

async function stallOf(w: WorkflowStatus): Promise<Stall | null> {
  if (w.status !== "PENDING") return null;
  return (await DBOS.getEvent<Stall | null>(w.workflowID, STALL_EVENT, { timeoutSeconds: 0 })) ?? null;
}

type CostRow = { workflow_id: string; step_id: number | null; usd: string; calls: string; unpriced: string };

/**
 * Cost per workflow (and per step when `bySteps`). null when public.model_calls
 * isn't there yet: the page says "no cost log" instead of showing $0.
 */
async function costs(db: Pool, ids: string[], bySteps: boolean): Promise<Map<string, Cost> | null> {
  if (ids.length === 0) return new Map();
  const step = bySteps ? "step_id" : "null::integer";
  try {
    const r = await db.query<CostRow>(
      `select workflow_id, ${step} as step_id, sum(cost_usd)::text as usd, count(*)::text as calls,
              count(*) filter (where not priced)::text as unpriced
         from public.model_calls where workflow_id = any($1) group by 1, 2`,
      [ids],
    );
    const out = new Map<string, Cost>();
    for (const row of r.rows) {
      const key = bySteps ? `${row.workflow_id}#${row.step_id}` : row.workflow_id;
      out.set(key, { usd: Number(row.usd), calls: Number(row.calls), unpriced: Number(row.unpriced) });
    }
    return out;
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return null;
    throw err;
  }
}

const NO_COST: Cost = { usd: 0, calls: 0, unpriced: 0 };

function summary(w: WorkflowStatus, stall: Stall | null, cost: Map<string, Cost> | null): RunSummary {
  const site = w.attributes && typeof w.attributes.site === "string" ? w.attributes.site : null;
  return {
    id: w.workflowID,
    name: w.workflowName,
    state: stateOf(w.status, stall),
    status: w.status,
    site,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt ?? null,
    completedAt: w.completedAt ?? null,
    stall,
    error: messageOf(w.error),
    cost: cost ? (cost.get(w.workflowID) ?? NO_COST) : null,
    parentId: w.parentWorkflowID ?? null,
    forkedFrom: w.forkedFrom ?? null,
    recoveryAttempts: w.recoveryAttempts ?? 0,
    queue: w.queueName ?? null,
  };
}

export interface ListQuery {
  state?: RunState;
  site?: string;
  name?: string;
  limit?: number;
  offset?: number;
}

export async function listRuns(db: Pool, q: ListQuery): Promise<{ runs: RunSummary[]; costLog: boolean }> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const rows = await DBOS.listWorkflows({
    status: q.state ? STATES[q.state] : undefined,
    workflowName: q.name || undefined,
    attributes: q.site ? { site: q.site } : undefined,
    limit,
    offset: q.offset ?? 0,
    sortDesc: true,
    loadInput: false,
    loadOutput: false,
  });
  const stalls = await Promise.all(rows.map(stallOf));
  const cost = await costs(
    db,
    rows.map((w) => w.workflowID),
    false,
  );
  let runs = rows.map((w, i) => summary(w, stalls[i] ?? null, cost));
  // "running" and "stalled" are both PENDING to DBOS.
  if (q.state === "running" || q.state === "stalled") runs = runs.filter((r) => r.state === q.state);
  return { runs, costLog: cost !== null };
}

function stepState(s: StepInfo): StepState {
  if (s.error) return usageLimitOf(s.error) !== null || tenantKeyOf(s.error) !== null ? "stalled" : "failed";
  return s.completedAtEpochMs ? "done" : "running";
}

/** Where a fork should start: the step that failed, so the ones before it (and what they cost) are kept. */
function forkStep(steps: StepInfo[]): number {
  const failed = steps.find((s) => s.error && usageLimitOf(s.error) === null && tenantKeyOf(s.error) === null);
  if (failed) return failed.functionID;
  // The workflow's own code threw after its last step: replay from that step.
  return steps.length ? Math.max(...steps.map((s) => s.functionID)) : 0;
}

function retryOf(status: string): RunDetail["retry"] {
  if (status === "ERROR") return "fork";
  if (status === "CANCELLED" || status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED") return "resume";
  return null;
}

// DBOS records its own calls as steps. The stall's bookkeeping is noise on the
// page; a durable sleep is a real wait, shown as one.
const HIDDEN_STEPS = new Set(["DBOS.now", "DBOS.setEvent", "DBOS.getEvent"]);
const STEP_NAMES: Record<string, string> = { "DBOS.sleep": "wait" };

async function statusOf(id: string): Promise<WorkflowStatus> {
  const [w] = await DBOS.listWorkflows({ workflowIDs: [id], loadInput: true, loadOutput: true });
  if (!w) throw new HttpError(404, "No such run");
  return w;
}

export async function getRun(db: Pool, id: string): Promise<RunDetail> {
  const w = await statusOf(id);
  const steps = (await DBOS.listWorkflowSteps(id)) ?? [];
  const stall = await stallOf(w);
  const [runCost, stepCost] = await Promise.all([costs(db, [id], false), costs(db, [id], true)]);
  return {
    ...summary(w, stall, runCost),
    input: w.input ?? null,
    output: w.output ?? null,
    steps: steps.filter((s) => !HIDDEN_STEPS.has(s.name)).map((s) => ({
      id: s.functionID,
      name: STEP_NAMES[s.name] ?? s.name,
      state: stepState(s),
      error: messageOf(s.error),
      startedAt: s.startedAtEpochMs ?? null,
      completedAt: s.completedAtEpochMs ?? null,
      childId: s.childWorkflowID,
      cost: stepCost ? (stepCost.get(`${id}#${s.functionID}`) ?? NO_COST) : null,
    })),
    retry: retryOf(w.status),
    cancellable: ACTIVE.has(w.status),
  };
}

/**
 * Retry a run that ended badly. A failed run is forked from the step that
 * failed: a new run (new id, "forked from" the old one) that keeps every step
 * before it, so finished model calls aren't paid for twice. A cancelled run,
 * or one DBOS gave up recovering, resumes under its own id.
 */
export async function retryRun(id: string): Promise<{ id: string; how: "resume" | "fork" }> {
  const w = await statusOf(id);
  const how = retryOf(w.status);
  if (!how) throw new HttpError(409, `A ${stateOf(w.status, null)} run can't be retried`);
  if (how === "resume") {
    await DBOS.resumeWorkflow(id);
    return { id, how };
  }
  const steps = (await DBOS.listWorkflowSteps(id)) ?? [];
  const handle = await DBOS.forkWorkflow(id, forkStep(steps), { queueName: w.queueName });
  return { id: handle.workflowID, how };
}

export async function cancelRun(id: string): Promise<void> {
  const w = await statusOf(id);
  if (!ACTIVE.has(w.status)) throw new HttpError(409, "Only a queued, running or stalled run can be cancelled");
  await DBOS.cancelWorkflow(id, { cancelChildren: true });
}
