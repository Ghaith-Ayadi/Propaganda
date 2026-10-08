// Model calls for the agents: always through the gateway (api/_ai/gateway.ts),
// which checks the tenant's budget and writes the cost log with this run's
// workflow and step. Each call is a modelStep, so a usage limit stalls the run
// instead of failing it (src/limits.ts).

import { DBOS } from "@dbos-inc/dbos-sdk";
import { callModel, setWorkflowContext } from "../../../api/_ai/gateway";
import { modelStep } from "../limits.js";

let wired = false;

/** Once, at start: every logged call then carries its DBOS workflow and step. */
export function wireGateway(): void {
  if (wired) return;
  wired = true;
  setWorkflowContext(() => ({ workflowId: DBOS.workflowID ?? null, stepId: DBOS.stepID ?? null }));
}

/** Model ids as the AI SDK / AI Gateway spells them. Sonnet is the base, Opus the advanced tier (agents.md). */
export const MODELS = {
  base: process.env.AGENT_MODEL_BASE ?? "anthropic/claude-sonnet-5.5",
  advanced: process.env.AGENT_MODEL_ADVANCED ?? "anthropic/claude-opus-5.5",
};

export interface Ask {
  site: string;
  job: string;
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}

/** One model call as one step. Background work: it stops at the tenant's budget. */
export async function askText(step: string, ask: Ask): Promise<string> {
  return modelStep(step, async () => (await callModel({ ...ask, background: true })).text);
}

/**
 * One model call that must answer with JSON, checked by `parse` (which throws
 * with a sentence the model can act on). A bad answer is retried once with the
 * problem attached, as its own step.
 */
export async function askJson<T>(step: string, ask: Ask, parse: (value: unknown) => T): Promise<T> {
  const first = await askText(step, ask);
  try {
    return parse(extractJson(first));
  } catch (err) {
    const retry = await askText(`${step} (again)`, {
      ...ask,
      prompt: `${ask.prompt}\n\nYour previous answer could not be used: ${(err as Error).message}\nAnswer again with the JSON only.`,
    });
    return parse(extractJson(retry));
  }
}

/** The JSON value in a model's answer, ignoring fences and any prose around it. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const open = cleaned[start];
    const end = cleaned.lastIndexOf(open === "[" ? "]" : "}");
    if (start < 0 || end <= start) throw new Error("The answer had no JSON in it.");
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error("The answer's JSON did not parse.");
    }
  }
}

// ---- small checkers for parse functions ----

export function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} must be an object.`);
  return v as Record<string, unknown>;
}

export function str(v: unknown, what: string, opts: { optional?: boolean; max?: number } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return "";
    throw new Error(`${what} is missing.`);
  }
  if (typeof v !== "string") throw new Error(`${what} must be a string.`);
  return opts.max ? v.slice(0, opts.max) : v;
}

export function arr(v: unknown, what: string, opts: { optional?: boolean } = {}): unknown[] {
  if (v === undefined || v === null) {
    if (opts.optional) return [];
    throw new Error(`${what} is missing.`);
  }
  if (!Array.isArray(v)) throw new Error(`${what} must be a list.`);
  return v;
}

export function strs(v: unknown, what: string, opts: { optional?: boolean } = {}): string[] {
  return arr(v, what, opts).map((x, i) => str(x, `${what}[${i}]`));
}
