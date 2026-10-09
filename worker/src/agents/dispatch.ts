// Finds the agents' work in the app's database and starts a run for each
// piece (kb/read.ts pendingWork: post versions to check, re-checks, contests to
// draft, proposals to rule on). Polling, every WORKER_DISPATCH_SECONDS: the app
// stays offline-first and needs no call to the worker, and a missed tick is
// caught by the next one. Each run's id comes from its work, so a piece of work
// runs once however many ticks see it; a failed run stays failed until it's
// retried from Admin > Runs.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { config } from "../config.js";
import { findPost, latestVersion, pendingWork, type Work } from "../kb/read.js";
import { AGENT_QUEUE, dispatchAttributes, registerAgent, startOnceForTenant, type DispatchInput } from "../workflows/agents.js";
import { checkPost, draftContest, recheckPost } from "./checker.js";
import { guardian } from "./guardian.js";

export function runId(w: Work): string {
  switch (w.kind) {
    case "check":
      return `checker-${w.id}`;
    case "recheck":
      return `recheck-${w.id}`;
    case "contest":
      return `contest-${w.id}`;
    case "guardian":
      return `guardian-${w.id}-${w.round}`;
  }
}

/**
 * One look for work. Returns the run ids it asked for (existing ones included).
 * Admin's Run now passes a tenant and no settle time: that tenant's work, now.
 */
export async function dispatchOnce(site: string | null = null, settleSeconds = config.settleSeconds): Promise<string[]> {
  const started: string[] = [];
  for (const w of await pendingWork(settleSeconds, 20, site)) {
    const id = runId(w);
    switch (w.kind) {
      case "check":
        await startOnceForTenant(w.site, id, checkPost, w.id);
        break;
      case "recheck":
        await startOnceForTenant(w.site, id, recheckPost, w.id);
        break;
      case "contest":
        await startOnceForTenant(w.site, id, draftContest, w.id);
        break;
      case "guardian":
        await startOnceForTenant(w.site, id, guardian, w.id, w.round);
        break;
    }
    started.push(id);
  }
  return started;
}

/** Look for work now and every `config.dispatchSeconds` after. Returns a stop function. */
export function startDispatcher(): () => void {
  if (config.dispatchSeconds <= 0) return () => {};
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await dispatchOnce();
    } catch (err) {
      DBOS.logger.error(`dispatcher: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), config.dispatchSeconds * 1000);
  return () => clearInterval(timer);
}

/**
 * Chat's hand-off (POST /agents/checker): read a post, by id or the post of
 * this tenant whose title the request names. Its newest version is checked
 * under the dispatcher's run id, so asking twice (or the dispatcher getting
 * there first) reads it once. Returns the run id, or null when no post
 * matches (the route answers 422).
 */
export async function startCheckOnRequest(input: DispatchInput): Promise<string | null> {
  const id = input.post ?? (await findPost(input.site, input.task));
  if (!id) return null;
  const v = await latestVersion(id);
  if (!v || v.site !== input.site) return null;
  const handle = await DBOS.startWorkflow(checkPost, {
    workflowID: runId({ kind: "check", site: input.site, id: v.id, round: 0 }),
    queueName: AGENT_QUEUE,
    workflowAttributes: dispatchAttributes("checker", input),
  })(v.id);
  return handle.workflowID;
}

registerAgent("checker", startCheckOnRequest);
