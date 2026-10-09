// Failed runs, grouped, from the worker's failure log (worker/src/failures.ts,
// served under /worker/v1/failures). The worker records every run that fails,
// groups repeats by fingerprint and files each group as one ticket.
//
// The types copy worker/src/failures.ts and worker/src/tickets.ts; keep them in step.

import type { Client } from "@/lib/supabase";
import { call } from "@/lib/admin/runs";

export type TicketKind = "notion" | "github";

export interface Ticket {
  kind: TicketKind;
  ref: string;
  url: string;
}

export type FailureStatus = "new" | "filed" | "ignored";

export interface FailureGroup {
  fingerprint: string;
  workflow: string;
  step: string | null;
  signature: string;
  title: string;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  sites: string[];
  models: string[];
  latestRun: string;
  latestError: string;
  status: FailureStatus;
  tickets: Ticket[];
  reportedCount: number;
  reportedAt: number | null;
  processError: string | null;
}

export interface FailureView {
  runId: string;
  step: string | null;
  stepId: number | null;
  site: string | null;
  error: string;
  models: string[];
  cost: number;
  calls: number;
  unpriced: number;
  failedAt: number;
}

export function listFailures(
  client: Client,
  status?: FailureStatus,
): Promise<{ groups: FailureGroup[]; sinks: TicketKind[]; environment: string }> {
  return call(client, "FAILURES-LOAD", `/failures${status ? `?status=${status}` : ""}`);
}

export function getFailure(client: Client, fingerprint: string): Promise<{ group: FailureGroup; failures: FailureView[] }> {
  return call(client, "FAILURES-LOAD", `/failures/${encodeURIComponent(fingerprint)}`);
}

/** Record new failures and file them now, instead of waiting for the minute's sweep. */
export function sweepFailures(client: Client): Promise<{ added: number; filed: number; noted: number }> {
  return call(client, "FAILURES-LOAD", "/failures/sweep", { method: "POST" });
}

export function fileFailure(client: Client, fingerprint: string): Promise<{ filed: number; noted: number; group: FailureGroup }> {
  return call(client, "FAILURE-FILE", `/failures/${encodeURIComponent(fingerprint)}/file`, { method: "POST" });
}

export function ignoreFailure(client: Client, fingerprint: string, ignored: boolean): Promise<{ group: FailureGroup }> {
  return call(client, "FAILURE-FILE", `/failures/${encodeURIComponent(fingerprint)}/ignore`, {
    method: "POST",
    body: JSON.stringify({ ignored }),
  });
}
