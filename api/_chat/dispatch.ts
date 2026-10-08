// Handing work to the other agents. They run as DBOS workflows on the worker
// (worker/, PR #27), which starts one per tenant on its agents queue. The
// worker's dispatch route (worker/src/http.ts) is the contract below;
// until it is deployed and WORKER_DISPATCH_URL is set, a hand-off says the
// agent isn't running yet and the Chat agent tells the person so.
//
//   POST {WORKER_DISPATCH_URL}/agents/{agent}
//   Authorization: Bearer {WORKER_DISPATCH_SECRET}
//   { site, task, requestedBy, conversation }  ->  202 { runId }
//   404 the agent isn't registered yet, 422 no tenant or nothing to work on,
//   503 the worker has no secret set

import type { AgentName } from "./types";

/** The agents Chat can hand work to (agents.md). The Guardian is reached through Remember only. */
export const DISPATCHABLE = ["strategist", "listener", "scout", "pitcher", "writer", "checker"] as const;
export type Dispatchable = (typeof DISPATCHABLE)[number] & AgentName;

export type DispatchResult = { started: true; runId: string } | { started: false; reason: string };

export async function dispatch(
  agent: Dispatchable,
  req: { site: string; task: string; requestedBy: string; conversation: string },
): Promise<DispatchResult> {
  const base = process.env.WORKER_DISPATCH_URL;
  const secret = process.env.WORKER_DISPATCH_SECRET;
  if (!base || !secret) return { started: false, reason: "not running yet" };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/agents/${agent}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.status === 404) return { started: false, reason: "not running yet" };
    if (res.status === 422) return { started: false, reason: "there was nothing for it to work on in that ask" };
    if (res.status === 503) return { started: false, reason: "the worker has no dispatch secret set yet" };
    if (!res.ok) return { started: false, reason: `the worker answered ${res.status}` };
    const { runId } = (await res.json()) as { runId?: string };
    return runId ? { started: true, runId } : { started: false, reason: "the worker sent no run id" };
  } catch {
    return { started: false, reason: "the worker is unreachable" };
  }
}
