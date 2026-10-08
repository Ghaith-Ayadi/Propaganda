// A run that does nothing useful, to see the worker and the Runs page work end
// to end on the box without spending a token: three steps, optionally a
// pretend usage limit on the middle one, optionally a failure at the end.
// Started from Admin (POST /runs/demo) or the test.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { modelStep } from "../limits.js";
import { isAgentName, registerAgent, startForDispatch, type DispatchInput } from "./agents.js";

export interface DemoInput {
  /** When the run was asked for (epoch ms): the pretend limit lasts until startedAt + stallSeconds. */
  startedAt: number;
  stallSeconds?: number;
  fail?: boolean;
}

async function demoRun(input: DemoInput): Promise<string> {
  await DBOS.runStep(async () => "planned", { name: "plan" });

  const draft = await modelStep(
    "draft",
    async () => {
      const until = input.startedAt + (input.stallSeconds ?? 0) * 1000;
      if (Date.now() < until) {
        // What the AI SDK throws when the subscription's window is used up.
        throw Object.assign(new Error("Too Many Requests"), {
          name: "AI_APICallError",
          statusCode: 429,
          responseHeaders: {
            "anthropic-ratelimit-unified-status": "rejected",
            "anthropic-ratelimit-unified-reset": String(Math.ceil(until / 1000)),
          },
        });
      }
      return "drafted";
    },
    { shareLimit: false },
  );

  await DBOS.runStep(
    async () => {
      if (input.fail) throw new Error("The demo was asked to fail here.");
    },
    { name: "finish" },
  );
  return draft;
}

export const demo = DBOS.registerWorkflow(demoRun, { name: "demo" });

// For the end-to-end test only: with WORKER_TEST_AGENT set, Chat's dispatch
// route can start this under that agent name. Never set on the box.
async function demoAgentRun(input: DispatchInput): Promise<string> {
  return DBOS.runStep(async () => `got: ${input.task.slice(0, 40)}`, { name: "acknowledge" });
}
const demoAgent = DBOS.registerWorkflow(demoAgentRun, { name: "demo-agent" });
const testAgent = process.env.WORKER_TEST_AGENT;
if (testAgent && isAgentName(testAgent)) {
  // A task of "nothing" finds nothing to work on, to test the 422.
  registerAgent(testAgent, (input) =>
    input.task === "nothing" ? Promise.resolve(null) : startForDispatch(testAgent, demoAgent, input),
  );
}
