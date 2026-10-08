// How agent work starts: every run belongs to a tenant (a site, in the
// schema), recorded as the workflow attribute `site` so the Runs page can show
// and filter it, and goes through one queue so the box (2 vCPU, shared with
// the database) and the subscription never take more than a few at once.
//
// Chat hands work to an agent by name (POST /agents/:name, api/_chat/dispatch.ts).
// An agent's thread registers its workflow here with registerAgent(); a name
// nobody registered answers 404, which Chat reads as "not running yet".

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
  return startWithAttributes({ site }, workflow, ...args);
}

function startWithAttributes<Args extends unknown[], R>(
  attributes: Record<string, string>,
  workflow: (...args: Args) => Promise<R>,
  ...args: Args
): Promise<WorkflowHandle<R>> {
  return DBOS.startWorkflow(workflow, { queueName: AGENT_QUEUE, workflowAttributes: attributes })(...args);
}

/** What Chat sends with a hand-off (the body of POST /agents/:name). */
export interface DispatchInput {
  /** The tenant: Chat has checked the person is a member. */
  site: string;
  /** The ask, in the person's words or Chat's restatement. */
  task: string;
  /** Who asked: the auth user id. */
  requestedBy: string;
  /** The Chat conversation the result goes back to. */
  conversation: string;
}

/** The names Chat may dispatch to (api/_chat/dispatch.ts DISPATCHABLE). */
export const AGENT_NAMES = ["strategist", "listener", "scout", "pitcher", "writer", "checker"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

type AgentWorkflow = (input: DispatchInput) => Promise<unknown>;
const agents = new Map<AgentName, AgentWorkflow>();

/**
 * Make `workflow` (a DBOS.registerWorkflow result taking a DispatchInput) the
 * one Chat starts for `name`. Call it at module load, from a file main.ts
 * imports, so it is registered before launch.
 */
export function registerAgent(name: AgentName, workflow: AgentWorkflow): void {
  if (agents.has(name)) throw new Error(`agent ${name} is registered twice`);
  agents.set(name, workflow);
}

export function isAgentName(name: string): name is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(name);
}

/** The run started for `name`, or null when no workflow is registered for it. */
export async function dispatchAgent(name: AgentName, input: DispatchInput): Promise<WorkflowHandle<unknown> | null> {
  const workflow = agents.get(name);
  if (!workflow) return null;
  // The conversation and the asker are attributes too, so Chat (and the Runs
  // page) can find every run a conversation started.
  return startWithAttributes(
    { site: input.site, agent: name, conversation: input.conversation, requestedBy: input.requestedBy },
    workflow,
    input,
  );
}
