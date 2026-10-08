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
  /** The post the ask is about, when Chat knows it (a 15-character id). */
  post: string | null;
}

/** The names Chat may dispatch to (api/_chat/dispatch.ts DISPATCHABLE). */
export const AGENT_NAMES = ["strategist", "listener", "scout", "pitcher", "writer", "checker"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * How an agent takes a hand-off: start its run and return the run id, or null
 * when the ask names nothing it can work on (the route answers 422). Most
 * agents are one line: `(input) => startForDispatch("scout", scout, input)`.
 * One that derives its run from the work (the Checker's "checker-<version>")
 * starts it its own way and returns that id.
 */
export type AgentHandler = (input: DispatchInput) => Promise<string | null>;
const agents = new Map<AgentName, AgentHandler>();

/**
 * Make `handler` the one Chat's hand-offs to `name` go to. Call it at module
 * load, from a file main.ts imports, so it is there before the server starts.
 */
export function registerAgent(name: AgentName, handler: AgentHandler): void {
  if (agents.has(name)) throw new Error(`agent ${name} is registered twice`);
  agents.set(name, handler);
}

/**
 * Tests only: one more name the route accepts, for the demo agent. Pick one no
 * real agent will ever use ("__test"), so it can't collide with one. Never set on the box.
 */
const TEST_AGENT = process.env.WORKER_TEST_AGENT || null;

export function isAgentName(name: string): name is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(name) || (TEST_AGENT !== null && name === TEST_AGENT);
}

/** The attributes a dispatched run carries, so Chat and the Runs page can find every run a conversation started. */
export function dispatchAttributes(name: AgentName, input: DispatchInput): Record<string, string> {
  return { site: input.site, agent: name, conversation: input.conversation, requestedBy: input.requestedBy };
}

/** Start `workflow` (taking the DispatchInput) for a hand-off to `name`; returns the run id. */
export async function startForDispatch(
  name: AgentName,
  workflow: (input: DispatchInput) => Promise<unknown>,
  input: DispatchInput,
): Promise<string> {
  const handle = await startWithAttributes(dispatchAttributes(name, input), workflow, input);
  return handle.workflowID;
}

/**
 * The hand-off's run id; undefined when no agent is registered for `name`
 * (404, "not running yet"), null when it found nothing to work on (422).
 */
export async function dispatchAgent(name: AgentName, input: DispatchInput): Promise<string | null | undefined> {
  const handler = agents.get(name);
  if (!handler) return undefined;
  return handler(input);
}
