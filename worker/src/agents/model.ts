// Model calls for the agents: always through the gateway (api/_ai/gateway.ts),
// which checks the tenant's budget and writes the cost log with this run's
// workflow and step. Each call is a modelStep, so a usage limit stalls the run
// instead of failing it (src/limits.ts).

import { DBOS } from "@dbos-inc/dbos-sdk";
import { callModel, DEFAULT_MODEL, setGatewayFetch, setWorkflowContext, type Reasoning } from "../../../api/_ai/gateway";
import { config } from "../config.js";
import { gatewayFetch } from "../net.js";
import { emptyAnswerOf, modelStep } from "../limits.js";

let wired = false;

/** Once, at start: every logged call then carries its DBOS workflow and step. */
export function wireGateway(): void {
  if (wired) return;
  wired = true;
  setWorkflowContext(() => ({ workflowId: DBOS.workflowID ?? null, stepId: DBOS.stepID ?? null }));
  setGatewayFetch(gatewayFetch(config.modelTimeoutSeconds));
}

/**
 * Model ids as the AI SDK / AI Gateway spells them. Both tiers are the gateway's
 * DEFAULT_MODEL (DeepSeek V4 Pro, Ayadi 2026-10-09) until a benchmark says a
 * job needs another. (Tenants' own keys are off since 2026-10-18: every call
 * runs on our gateway; see gateway.ts byokOn.)
 * Two exceptions (Ayadi, 2026-10-14, after the blind benchmarks on PPGD): the
 * Strategist, the one document that sets a tenant's quarter, is Claude Opus 5.5
 * (about $0.21 a run at medium effort, less with prompt caching), and the first
 * pitches are Claude Sonnet 5.5. It was Fable 5.1 for both since 2026-10-10.
 * The Writer's draft and revision run on Qwen3.7 Plus (Ayadi, 2026-10-17, after
 * four blind rounds against Opus 5.5, Sonnet 5.5, GPT-5.6 Sol and DeepSeek V4
 * Pro: it tied the best draft in both rounds it ran, at about $0.02 a draft
 * against $0.19 for Opus; about three minutes a draft). The Writer's other
 * calls (research plan, rules, style) stay on the base tier.
 */
export const MODELS = {
  base: process.env.AGENT_MODEL_BASE || DEFAULT_MODEL,
  advanced: process.env.AGENT_MODEL_ADVANCED || DEFAULT_MODEL,
  strategist: process.env.AGENT_MODEL_STRATEGIST || "anthropic/claude-opus-5.5",
  /** The first pitches of a plan (workflows/first-day.ts). */
  pitcher: process.env.AGENT_MODEL_PITCHER || "anthropic/claude-sonnet-5.5",
  /** The Writer's draft and revision (agents/writer.ts). */
  writer: process.env.AGENT_MODEL_WRITER || "alibaba/qwen3.7-plus",
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
  /** Cache the prompt on an Anthropic model (gateway.ts CallOptions.cache). */
  cache?: boolean;
  /** Text after the (cached) prompt: a retry's problem goes here so the prompt stays a cache hit. */
  suffix?: string;
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
    ...appended(ask, `Your previous answer could not be used: ${problem!}\nAnswer again with the JSON only.`),
  });
  return parse(extractJson(retry));
}

/**
 * The ask's prompt with `text` after it. A cached ask keeps its prompt as it was
 * and carries the text as its suffix, so the retry reads the prompt from the cache.
 */
export function appended(ask: Ask, text: string): { prompt: string; suffix?: string } {
  return ask.cache ? { prompt: ask.prompt, suffix: `${ask.suffix ?? ""}\n\n${text}` } : { prompt: `${ask.prompt}${ask.suffix ?? ""}\n\n${text}` };
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
