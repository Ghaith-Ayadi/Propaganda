// Admin > Arena: the same real task on two or three models, for a blind vote.
//
// A round asks each model exactly what the agent would ask it (the Pitcher's
// judging prompt over a tenant's waiting ideas, or the Listener's reading of a
// call) and returns the answers in a shuffled order. The page hides which model
// wrote which until Ayadi picks one; the page saves the vote (arena_votes).
//
// Every call goes through callModel (one model_calls row each, job
// "arena:<agent>"), charged to ARENA_SITE, Ayadi's own tenant, so a benchmark
// never shows up on a customer's cost meter and never runs on a customer's own
// key. A round whose worst case (prompt in full plus every output token at list
// price) is over ARENA_ROUND_CAP_USD is refused before any call.

import { randomInt } from "node:crypto";
import type { Pool } from "pg";
import { callModel } from "../../api/_ai/gateway";
import { HttpError } from "./auth.js";
import { judgePrompt, PITCHER_SYSTEM, parseJudgements } from "./agents/pitcher.js";
import { everyBrief, getSite, ideas as readIdeas, pipelineBriefs, publishedPosts } from "./agents/store.js";
import { readGoals } from "./agents/goals.js";
import { nearest, type Seen } from "./agents/taste.js";
import { extractJson } from "./agents/model.js";
import { CHUNK_CHARS, systemPrompt as listenerSystem, userPrompt as listenerPrompt } from "./listener/extract.js";
import { getSource, readTenant, recentSources } from "./listener/store.js";

export const ARENA_AGENTS = ["pitcher", "listener"] as const;
export type ArenaAgent = (typeof ARENA_AGENTS)[number];

/** The current default, the dark horse, and a top-tier model (/mnt/project-files/models/candidates.md). */
export const ARENA_DEFAULT_MODELS = ["deepseek/deepseek-v4-pro", "xiaomi/mimo-v2.6-pro", "openai/gpt-6-sol"];

const ROUND_CAP_USD = Number(process.env.ARENA_ROUND_CAP_USD ?? 1);
const ARENA_SITE = process.env.ARENA_SITE ?? "verbatimsite000";
const MAX_OUTPUT_TOKENS = 6000;
/** The Pitcher judges this many ideas per call (pitcher.ts JUDGE_CHUNK). */
const IDEAS_PER_ROUND = 25;
const MODEL_RE = /^[a-z0-9-]+\/[a-z0-9.:-]+$/;

export interface ArenaEntry {
  model: string;
  /** The model's answer: parsed JSON when it parsed, else the raw text. */
  answer: unknown;
  raw: string;
  /** Why the answer can't be used by the agent as is ("" when it can). */
  problem: string;
  error: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

export interface ArenaRound {
  agent: ArenaAgent;
  site: string;
  /** What the models were given, in a line: "12 waiting ideas", "Call: Kontra demo". */
  task: string;
  /** Pitcher rounds: the ideas judged, so answers (which name ids) can show titles. */
  ideas: { id: string; title: string }[];
  entries: ArenaEntry[];
  costUsd: number;
}

// ---- prices, for the cap ----

let prices: { at: number; byId: Map<string, { input: number; output: number }> } | null = null;

/** The AI Gateway's list prices per token, cached for an hour. */
async function listPrices(): Promise<Map<string, { input: number; output: number }>> {
  if (prices && Date.now() - prices.at < 3_600_000) return prices.byId;
  const res = await fetch("https://ai-gateway.vercel.sh/v1/models");
  if (!res.ok) throw new HttpError(502, `The AI Gateway's model list answered ${res.status}`);
  const body = (await res.json()) as { data?: { id: string; pricing?: { input?: string; output?: string } }[] };
  const byId = new Map<string, { input: number; output: number }>();
  for (const m of body.data ?? []) {
    const input = Number(m.pricing?.input), output = Number(m.pricing?.output);
    if (Number.isFinite(input) && Number.isFinite(output)) byId.set(m.id, { input, output });
  }
  prices = { at: Date.now(), byId };
  return byId;
}

/** The most a round can cost: the whole prompt in and every allowed output token out, at list price. */
export function worstCase(promptChars: number, models: string[], byId: Map<string, { input: number; output: number }>): number {
  const inTokens = Math.ceil(promptChars / 3);
  let total = 0;
  for (const m of models) {
    const p = byId.get(m);
    if (!p) throw new HttpError(422, `The AI Gateway has no price for ${m}`);
    total += inTokens * p.input + MAX_OUTPUT_TOKENS * p.output;
  }
  return total;
}

// ---- the tasks ----

interface Task {
  task: string;
  ideas: { id: string; title: string }[];
  system: string;
  prompt: string;
  /** Throws a sentence when the answer can't be used as is. */
  check: (answer: unknown) => void;
}

async function pitcherTask(site: string): Promise<Task> {
  const now = new Date();
  const [tenant, briefs, published, every, titles, goals, waiting] = await Promise.all([
    getSite(site),
    pipelineBriefs(site),
    publishedPosts(site, 60),
    everyBrief(site),
    publishedPosts(site, 2000),
    readGoals(site),
    readIdeas(site, null, 40),
  ]);
  const ideas = waiting.filter((i) => i.status === "new").slice(0, IDEAS_PER_ROUND);
  if (!ideas.length) throw new HttpError(422, "This tenant has no ideas waiting to be judged.");
  const seen: Seen[] = [
    ...every.map((b) => ({
      title: b.title,
      kind: (b.status === "rejected" || b.status === "cancelled" ? "rejected" : b.status === "backlog" ? "not_now" : "pipeline") as Seen["kind"],
      date: b.created.slice(0, 10),
      reason: b.reject_reason,
    })),
    ...titles.map((p) => ({ title: p.title, kind: "published" as const, date: (p.published_at ?? "").slice(0, 10), reason: "" })),
  ];
  const existing = [...published.map((p) => `published: ${p.title}`), ...briefs.map((b) => `${b.status}: ${b.title}`)].slice(0, 120);
  const parse = parseJudgements(ideas.map((i) => i.id));
  return {
    ideas: ideas.map((i) => ({ id: i.id, title: i.title })),
    task: `${ideas.length} waiting idea${ideas.length === 1 ? "" : "s"} of ${tenant?.name ?? site}`,
    system: PITCHER_SYSTEM,
    prompt: judgePrompt({ now, tenantName: tenant?.name, goals, existing, ideas, close: new Map(ideas.map((i) => [i.id, nearest(i.title, seen)])) }),
    check: (a) => void parse(a),
  };
}

async function listenerTask(db: Pool, site: string, input: { source?: string; transcript?: string; title?: string }): Promise<Task> {
  const tenant = await readTenant(db, site);
  let title = input.title?.trim() || "Pasted transcript";
  let text = input.transcript ?? "";
  if (input.source) {
    const source = await getSource(site, input.source);
    if (!source) throw new HttpError(404, "No such source for this tenant");
    title = source.title || "untitled";
    text = source.body;
  }
  if (!text.trim()) throw new HttpError(400, "Paste a transcript or pick a call.");
  // One read, as the Listener's first chunk: longer sources are cut, not split.
  text = text.slice(0, CHUNK_CHARS);
  return {
    task: `Call: ${title}`,
    ideas: [],
    system: listenerSystem(tenant.name),
    prompt: listenerPrompt({ title, kind: "call", participants: [], text }),
    check: (a) => {
      const o = a as { ideas?: unknown; facts?: unknown };
      if (!o || typeof o !== "object" || !Array.isArray(o.ideas) || !Array.isArray(o.facts)) {
        throw new Error("The answer needs an ideas list and a facts list.");
      }
    },
  };
}

// ---- a round ----

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function runOne(model: string, t: Task, agent: ArenaAgent): Promise<ArenaEntry> {
  const started = Date.now();
  const entry: ArenaEntry = { model, answer: null, raw: "", problem: "", error: "", costUsd: 0, inputTokens: 0, outputTokens: 0, ms: 0 };
  try {
    const r = await callModel({
      site: ARENA_SITE,
      job: `arena:${agent}`,
      model,
      background: false,
      system: t.system,
      prompt: t.prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    entry.raw = r.text;
    entry.costUsd = r.costUsd;
    entry.inputTokens = r.usage.inputTokens;
    entry.outputTokens = r.usage.outputTokens;
    try {
      entry.answer = extractJson(r.text);
      t.check(entry.answer);
    } catch (err) {
      entry.problem = (err as Error).message;
      entry.answer ??= r.text;
    }
  } catch (err) {
    entry.error = String((err as Error)?.message ?? err).slice(0, 500);
  }
  entry.ms = Date.now() - started;
  return entry;
}

export function checkModels(v: unknown): string[] {
  const models = Array.isArray(v) && v.length ? v : ARENA_DEFAULT_MODELS;
  if (models.length < 2 || models.length > 3) throw new HttpError(400, "Pick two or three models.");
  for (const m of models) if (typeof m !== "string" || !MODEL_RE.test(m)) throw new HttpError(400, `Bad model id: ${String(m)}`);
  if (new Set(models).size !== models.length) throw new HttpError(400, "Pick different models.");
  return models as string[];
}

export async function runRound(
  db: Pool,
  input: { agent: ArenaAgent; site: string; models: string[]; source?: string; transcript?: string; title?: string },
): Promise<ArenaRound> {
  const t = input.agent === "pitcher" ? await pitcherTask(input.site) : await listenerTask(db, input.site, input);
  const worst = worstCase(t.system.length + t.prompt.length, input.models, await listPrices());
  if (worst > ROUND_CAP_USD) {
    throw new HttpError(422, `This round could cost up to $${worst.toFixed(2)}, over the $${ROUND_CAP_USD.toFixed(2)} cap. Drop the priciest model or pick a shorter call.`);
  }
  const entries = shuffle(await Promise.all(input.models.map((m) => runOne(m, t, input.agent))));
  const costUsd = Math.round(entries.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6;
  return { agent: input.agent, site: input.site, task: t.task, ideas: t.ideas, entries, costUsd };
}

/** The calls a superadmin can pick for a Listener round: the tenant's latest. */
export async function arenaSources(site: string) {
  return recentSources(site, 20);
}
