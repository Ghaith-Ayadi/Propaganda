// How agent work starts: every run belongs to a tenant (a site, in the
// schema), recorded as the workflow attribute `site` so the Runs page can show
// and filter it, and goes through one queue so the box (2 vCPU, shared with
// the database) and the subscription never take more than a few at once.

import { DBOS, type WorkflowHandle } from "@dbos-inc/dbos-sdk";

export const AGENT_QUEUE = "agents";

/** Called once, after DBOS.launch(). */
export async function registerQueues(): Promise<void> {
  await DBOS.registerQueue(AGENT_QUEUE, { workerConcurrency: 3 });
}

/** Start `workflow` for tenant `site` on the agents queue. */
export function startForTenant<Args extends unknown[], R>(
  site: string,
  workflow: (...args: Args) => Promise<R>,
  ...args: Args
): Promise<WorkflowHandle<R>> {
  return DBOS.startWorkflow(workflow, { queueName: AGENT_QUEUE, workflowAttributes: { site } })(...args);
}
