// Model calls for the agents: always through the gateway (api/_ai/gateway.ts),
// which checks the tenant's budget and writes the cost log with this run's
// workflow and step. Each call is a modelStep, so a usage limit stalls the run
// instead of failing it (src/limits.ts).

import { DBOS } from "@dbos-inc/dbos-sdk";
import { callModel, DEFAULT_MODEL, setWorkflowContext, type Reasoning } from "../../../api/_ai/gateway";
import { emptyAnswerOf, modelStep } from "../limits.js";

let wired = false;

/** Once, at start: every logged call then carries its DBOS workflow and step. */
export function wireGateway(): void {
  if (wired) return;
  wired = true;
  setWorkflowContext(() => ({ workflowId: DBOS.workflowID ?? null, stepId: DBOS.stepID ?? null }));
}

/**
 * Model ids as the AI SDK / AI Gateway spells them. Both tiers are the gateway's
 * DEFAULT_MODEL (DeepSeek V4 Pro, Ayadi 2026-10-09) until a benchmark says a
 * job needs another; on a tenant's own Anthropic key it runs as BYOK_MODEL.
 * The Strategist is the exception (Ayadi, 2026-10-10, after the blind test of
 * the first PPGD proposal): Claude Fable 5.1, the one document that sets a
 * tenant's quarter, $0.30 to $0.80 a run. On a tenant's own key it is Fable
 * on that key.
 */
export const MODELS = {
  base: process.env.AGENT_MODEL_BASE || DEFAULT_MODEL,
  advanced: process.env.AGENT_MODEL_ADVANCED || DEFAULT_MODEL,
  strategist: process.env.AGENT_MODEL_STRATEGIST || "anthropic/claude-fable-5.1",
};

export interface Ask {
  site: string;
  job: string;
  model: string;
  system: string;
  prompt: string;
  /** Tokens for the answer; the gateway adds room for thinking on top. */
  maxOutputTokens?: number;
  /** How hard the model thinks first; unset is the provider's default. */
  reasoning?: Reasoning;
}

/** One model call as one step. Background work: it stops at the tenant's budget. */
export async function askText(step: string, ask: Ask): Promise<string> {
  return modelStep(step, async () => (await callModel({ ...ask, background: true })).text);
}

/**
 * One model call that must answer with JSON, checked by `parse` (which throws
 * with a sentence the model can act on). A bad answer is retried once with the
 * problem attached, as its own step. An answer that never came (the model
 * thought until its budget ran out) is asked again with less thinking.
 */
export async function askJson<T>(step: string, ask: Ask, parse: (value: unknown) => T): Promise<T> {
  let problem: string;
  let again = ask;
  let first: string | null = null;
  try {
    first = await askText(step, ask);
  } catch (err) {
    if (!emptyAnswerOf(err)) throw err;
    problem = "you spent your whole budget thinking and wrote nothing. Think briefly, then answer";
    again = { ...ask, reasoning: "low" };
  }
  if (first !== null) {
    try {
      return parse(extractJson(first));
    } catch (err) {
      problem = (err as Error).message;
    }
  }
  const retry = await askText(`${step} (again)`, {
    ...again,
    prompt: `${ask.prompt}\n\nYour previous answer could not be used: ${problem!}\nAnswer again with the JSON only.`,
  });
  return parse(extractJson(retry));
}

/** The JSON value in a model's answer, ignoring fences and any prose around it. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  if (!cleaned) throw new Error("The answer was empty.");
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
