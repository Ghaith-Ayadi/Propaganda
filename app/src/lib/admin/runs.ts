// Agent runs, from the worker's Runs API (worker/src/http.ts, served on the
// API host under /worker/v1). The worker reads DBOS's record of every workflow
// and joins the cost log on the workflow id; it checks the superadmin flag on
// every request, with the Admin account's own session.
//
// The types copy worker/src/runs.ts; keep both in step.

import { SUPABASE_URL, type Client } from "@/lib/supabase";
import { AppError } from "@/lib/errors";

const WORKER_URL = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? `${SUPABASE_URL}/worker/v1`;

export type RunState = "queued" | "running" | "stalled" | "done" | "failed" | "cancelled";

export interface Cost {
  usd: number;
  calls: number;
  unpriced: number;
}

export interface Stall {
  /** usage-limit: our Claude subscription. tenant-key: the tenant's own Anthropic key failed. */
  reason: "usage-limit" | "tenant-key";
  /** For tenant-key: Anthropic's answer. */
  message?: string;
  step: string;
  since: number;
  until: number;
}

export interface RunSummary {
  id: string;
  name: string;
  state: RunState;
  status: string;
  site: string | null;
  createdAt: number;
  updatedAt: number | null;
  completedAt: number | null;
  stall: Stall | null;
  error: string | null;
  cost: Cost | null;
  parentId: string | null;
  forkedFrom: string | null;
  recoveryAttempts: number;
  queue: string | null;
}

/** "retried": failed, and the run tried again after a wait; "skipped": failed for good, and the run carried on without it. */
export type StepState = "done" | "failed" | "stalled" | "running" | "retried" | "skipped";

export interface StepView {
  id: number;
  name: string;
  state: StepState;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  childId: string | null;
  cost: Cost | null;
  /** For a retried or skipped step: what happened next ("trying again in 5 min"). */
  note?: string;
}

export interface RunDetail extends RunSummary {
  input: unknown;
  output: unknown;
  steps: StepView[];
  retry: "resume" | "fork" | null;
  cancellable: boolean;
}

/** The worker answered with an error status (or not at all: status 0). */
export class WorkerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}

/** One request to the worker as this Admin account; failures carry `code`. */
export async function call<T>(client: Client, code: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) throw new AppError(code, "This Admin account is signed out. Sign in again.");
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch (err) {
    throw new AppError(code, "Couldn't reach the worker.", new WorkerError(0, String(err)));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const cause = new WorkerError(res.status, body?.error ?? res.statusText);
    if (res.status === 403) throw new AppError(code, "The worker doesn't know this account as a superadmin.", cause);
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new AppError(code, "The worker isn't running.", cause);
    throw new AppError(code, body?.error ?? "The worker refused the request.", cause);
  }
  return (await res.json()) as T;
}

export interface RunFilter {
  state?: RunState;
  site?: string;
  limit?: number;
  offset?: number;
}

export function listRuns(client: Client, f: RunFilter = {}): Promise<{ runs: RunSummary[]; costLog: boolean }> {
  const q = new URLSearchParams();
  if (f.state) q.set("state", f.state);
  if (f.site) q.set("site", f.site);
  q.set("limit", String(f.limit ?? 50));
  if (f.offset) q.set("offset", String(f.offset));
  return call(client, "RUNS-LOAD", `/runs?${q}`);
}

export function getRun(client: Client, id: string): Promise<RunDetail> {
  return call(client, "RUNS-LOAD", `/runs/${encodeURIComponent(id)}`);
}

export function retryRun(client: Client, id: string): Promise<{ id: string; how: "resume" | "fork" }> {
  return call(client, "RUN-RETRY", `/runs/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

export function cancelRun(client: Client, id: string): Promise<{ ok: true }> {
  return call(client, "RUN-CANCEL", `/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function startDemoRun(client: Client, opts: { stallSeconds?: number; fail?: boolean }): Promise<{ id: string }> {
  return call(client, "RUN-DEMO", "/runs/demo", { method: "POST", body: JSON.stringify(opts) });
}

/** What Admin's Run now can start (worker/src/triggers.ts). */
export interface Trigger {
  id: string;
  agent: string;
  label: string;
  detail: string;
  /** tenant: for the picked tenant. all: one run across every tenant with that connection. */
  scope: "tenant" | "all";
}

export function listTriggers(client: Client): Promise<{ triggers: Trigger[]; tenants: { id: string; name: string }[] }> {
  return call(client, "RUN-NOW", "/triggers");
}

/** Start a trigger now; returns the runs it started (none when there was nothing to do). */
export function runTrigger(client: Client, id: string, site: string | null): Promise<{ runs: string[] }> {
  return call(client, "RUN-NOW", `/triggers/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(site ? { site } : {}) });
}
