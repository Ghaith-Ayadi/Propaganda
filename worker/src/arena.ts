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
// key. Only Ayadi's own tenants (ARENA_TENANTS) can be picked, and a round
// runs as background work, so Verbatim's budget stops it. A round whose worst case (prompt in full plus every output token at list
// price) is over ARENA_ROUND_CAP_USD is refused before any call.

import { randomInt } from "node:crypto";
import type { Pool } from "pg";
import { callModel, gatewayListPrices, thinkingBudget } from "../../api/_ai/gateway";
import { HttpError } from "./auth.js";
import { judgePrompt, PITCHER_SYSTEM, parseJudgements } from "./agents/pitcher.js";
import { everyBrief, getSite, ideas as readIdeas, pipelineBriefs, publishedPosts } from "./agents/store.js";
import { readGoals } from "./agents/goals.js";
import { nearest, type Seen } from "./agents/taste.js";
import { extractJson } from "./agents/model.js";
import { CHUNK_CHARS, systemPrompt as listenerSystem, userPrompt as listenerPrompt } from "./listener/extract.js";
import { getSource, readTenant, recentSources } from "./listener/store.js";
import { CHAT_MAX_STEPS, CHAT_OUTPUT_TOKENS, chatCases, loadChatCase, replayChat, type ChatBefore, type ChatCase } from "./arena-chat.js";
import { briefBlock, parseDraft, writerSystem } from "./agents/writer-prompt.js";
import { claimsFor, renderClaims } from "./agents/kb.js";
import { getBrief, personVoice, voiceGuide } from "./agents/store.js";
import { voiceFor } from "./agents/voice.js";

export const ARENA_AGENTS = ["pitcher", "listener", "writer", "chat"] as const;
export type ArenaAgent = (typeof ARENA_AGENTS)[number];

/** The current default, its cheaper Qwen rival, and a top-tier model (/mnt/project-files/models/candidates.md). */
export const ARENA_DEFAULT_MODELS = ["deepseek/deepseek-v4-pro", "alibaba/qwen3.7-plus", "openai/gpt-6-sol"];
/** Writing rounds (Ayadi 2026-10-14): four rivals, each writing the same piece. */
export const ARENA_WRITER_MODELS = ["deepseek/deepseek-v4-pro", "openai/gpt-6.1-sol", "moonshotai/kimi-k3", "alibaba/qwen3.8-max"];
/** A writing round is one piece by every rival: a full post each, so it gets its own cap. */
const WRITER_ROUND_CAP_USD = Number(process.env.ARENA_WRITER_ROUND_CAP_USD ?? 2);
const WRITER_OUTPUT_TOKENS = 8000;
/** Chat replays (Ayadi, 2026-10-14): the model Chat runs on, and the ones to weigh it against. */
export const ARENA_CHAT_MODELS = ["deepseek/deepseek-v4-pro", "anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "moonshotai/kimi-k3", "alibaba/qwen3.8-max"];
/** A replayed turn takes up to CHAT_MAX_STEPS model calls per rival. */
const CHAT_ROUND_CAP_USD = Number(process.env.ARENA_CHAT_ROUND_CAP_USD ?? 6);

const ROUND_CAP_USD = Number(process.env.ARENA_ROUND_CAP_USD ?? 1);
const ARENA_SITE = process.env.ARENA_SITE ?? "verbatimsite000";
const MAX_OUTPUT_TOKENS = 6000;
/** The Pitcher judges this many ideas per call (pitcher.ts JUDGE_CHUNK). */
const IDEAS_PER_ROUND = 25;
const MODEL_RE = /^[a-z0-9-]+\/[a-z0-9.:-]+$/;
/**
 * The tenants a round may read: Ayadi's own. Named by site slug, so a tenant
 * that signs up again (PPGD, 2026-10-14) is still his; ARENA_TENANTS adds ids.
 * A customer's ideas and calls never go to models it didn't agree to, so a slug
 * counts only while a superadmin is a member of that site.
 */
const ARENA_TENANT_IDS = (process.env.ARENA_TENANTS ?? "verbatimsite000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ARENA_TENANT_SLUGS = (process.env.ARENA_TENANT_SLUGS ?? "verbatim,ppgd")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** The ids a round may read now. Without a database (the in-process test) only the ids. */
export async function arenaTenantIds(db: Pool | null): Promise<string[]> {
  if (!db || !ARENA_TENANT_SLUGS.length) return ARENA_TENANT_IDS;
  const { rows } = await db.query<{ id: string }>(`select s.id from public.sites s
      where s.slug = any($1)
        and exists (select 1 from public.site_members m join private.superadmins a on a.user_id = m.user_id where m.site = s.id)`,
    [ARENA_TENANT_SLUGS]);
  return [...new Set([...ARENA_TENANT_IDS, ...rows.map((r) => r.id)])];
}

export async function arenaTenants(db: Pool): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; name: string }>("select id, name from public.sites where id = any($1) order by name", [await arenaTenantIds(db)]);
  return rows;
}

async function checkTenant(db: Pool | null, site: string): Promise<void> {
  if (!(await arenaTenantIds(db)).includes(site)) throw new HttpError(403, "The Arena runs only on your own tenants (Verbatim, PPGD).");
}

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
  /** Chat replays: what the model looked up and offered, in order. */
  calls?: { tool: string; input: unknown; result: string }[];
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
  /** Chat replays: the operator's message the models were given. */
  input?: string;
  /** Chat replays: the reply as it ran when captured. */
  before?: ChatBefore | null;
}

// ---- prices, for the cap ----

let prices: { at: number; byId: Map<string, { input: number; output: number }> } | null = null;

/** The AI Gateway's list prices per token, cached for an hour. */
async function listPrices(): Promise<Map<string, { input: number; output: number }>> {
  if (prices && Date.now() - prices.at < 3_600_000) return prices.byId;
  let byId: Map<string, { input: number; output: number }>;
  try {
    byId = await gatewayListPrices();
  } catch (err) {
    throw new HttpError(502, (err as Error).message);
  }
  prices = { at: Date.now(), byId };
  return byId;
}

/** The most a round can cost: the whole prompt in and every allowed output token out, at list price. */
export function worstCase(promptChars: number, models: string[], byId: Map<string, { input: number; output: number }>, outputTokens = MAX_OUTPUT_TOKENS, steps = 1): number {
  const inTokens = Math.ceil(promptChars / 3);
  let total = 0;
  for (const m of models) {
    const p = byId.get(m);
    if (!p) throw new HttpError(422, `The AI Gateway has no price for ${m}`);
    // The gateway lets a call think on top of its answer budget: count all of it.
    total += steps * (inTokens * p.input + thinkingBudget(outputTokens)! * p.output);
  }
  return total;
}

// ---- the tasks ----

interface Task {
  task: string;
  ideas: { id: string; title: string }[];
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  capUsd?: number;
  steps?: number;
  /** Chat replays: the captured turn, run with Chat's tools. */
  chat?: { site: string; c: ChatCase };
  input?: string;
  before?: ChatBefore | null;
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

async function writerTask(site: string, briefId: string | undefined): Promise<Task> {
  if (!briefId) throw new HttpError(400, "Pick a brief to write.");
  const brief = await getBrief(site, briefId);
  if (!brief) throw new HttpError(404, "No such brief for this tenant");
  const [tenant, guide, own, claims] = await Promise.all([
    getSite(site),
    voiceGuide(site),
    personVoice(site),
    claimsFor(site, [brief.title, brief.angle, ...(brief.outline ?? []).map((l) => l.text)].filter(Boolean), 8),
  ]);
  const voice = own || voiceFor(guide);
  return {
    task: `Write: ${brief.title}`,
    ideas: [],
    system: writerSystem(voice),
    // The Writer's own draft prompt (agents/writer.ts) without its web research
    // or reviewer edits, so every rival gets the same input and nothing varies by search.
    prompt: `Write the full post for ${tenant?.name ?? "the tenant"} from this brief.

${briefBlock(brief)}

What the tenant knows (knowledge base; the only source for facts about the tenant):
${renderClaims(claims)}

Write the whole post in Markdown: no H1 (the title is separate), H2 subheads. Use no outside sources or links. The subtitle is the post's one short description (one or two sentences): it is shown under the title, on listings and in the page meta, so the body never repeats it, and no standfirst or italic summary line goes at the top of the body. The body opens with the argument itself. Then list the facts about the tenant you needed and didn't have.

Answer with JSON only: {"title": "...", "subtitle": "the short description", "markdown": "...", "missingFacts": ["..."]}`,
    maxOutputTokens: WRITER_OUTPUT_TOKENS,
    capUsd: WRITER_ROUND_CAP_USD,
    check: (a) => void parseDraft(a),
  };
}

async function chatTask(site: string, caseId: string | undefined): Promise<Task> {
  if (!caseId) throw new HttpError(400, "Pick a conversation turn to replay.");
  const c = await loadChatCase(site, caseId);
  return {
    task: `Chat: ${c.user.slice(0, 80)}`,
    ideas: [],
    system: c.system,
    prompt: [...c.history.map((m) => String(m.content)), c.user].join("\n"),
    maxOutputTokens: CHAT_OUTPUT_TOKENS,
    steps: CHAT_MAX_STEPS,
    capUsd: CHAT_ROUND_CAP_USD,
    chat: { site, c },
    input: c.user,
    before: c.before,
    check: () => {},
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
  if (t.chat) {
    try {
      const r = await replayChat({ c: t.chat.c, site: t.chat.site, arenaSite: ARENA_SITE, model });
      entry.raw = r.text;
      entry.answer = r.text;
      entry.calls = r.calls;
      entry.costUsd = r.costUsd;
      if (!r.text) entry.problem = "The model ended its turn without a reply.";
    } catch (err) {
      entry.error = String((err as Error)?.message ?? err).slice(0, 500);
    }
    entry.ms = Date.now() - started;
    return entry;
  }
  try {
    const r = await callModel({
      site: ARENA_SITE,
      job: `arena:${agent}`,
      model,
      // Background: Verbatim's monthly budget is a hard stop for rounds.
      background: true,
      system: t.system,
      prompt: t.prompt,
      maxOutputTokens: t.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
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

export function checkModels(v: unknown, agent: ArenaAgent = "pitcher"): string[] {
  const most = agent === "chat" ? 5 : agent === "writer" ? 4 : 3;
  const models = Array.isArray(v) && v.length ? v : agent === "chat" ? ARENA_CHAT_MODELS : agent === "writer" ? ARENA_WRITER_MODELS : ARENA_DEFAULT_MODELS;
  if (models.length < 2 || models.length > most) throw new HttpError(400, `Pick two to ${["", "", "two", "three", "four", "five"][most]} models.`);
  for (const m of models) if (typeof m !== "string" || !MODEL_RE.test(m)) throw new HttpError(400, `Bad model id: ${String(m)}`);
  if (new Set(models).size !== models.length) throw new HttpError(400, "Pick different models.");
  return models as string[];
}

export async function runRound(
  db: Pool | null,
  input: { agent: ArenaAgent; site: string; models: string[]; source?: string; transcript?: string; title?: string; brief?: string; turn?: string },
): Promise<ArenaRound> {
  await checkTenant(db, input.site);
  const t =
    input.agent === "pitcher"
      ? await pitcherTask(input.site)
      : input.agent === "writer"
        ? await writerTask(input.site, input.brief)
        : input.agent === "chat"
          ? await chatTask(input.site, input.turn)
          : await listenerTask(db!, input.site, input);
  const worst = worstCase(t.system.length + t.prompt.length, input.models, await listPrices(), t.maxOutputTokens, t.steps);
  const cap = t.capUsd ?? ROUND_CAP_USD;
  if (worst > cap) {
    throw new HttpError(422, `This round could cost up to $${worst.toFixed(2)}, over the $${cap.toFixed(2)} cap. Drop the priciest model or pick a shorter call.`);
  }
  const entries = shuffle(await Promise.all(input.models.map((m) => runOne(m, t, input.agent))));
  const costUsd = Math.round(entries.reduce((s, e) => s + e.costUsd, 0) * 1e6) / 1e6;
  return { agent: input.agent, site: input.site, task: t.task, ideas: t.ideas, entries, costUsd, ...(t.chat ? { input: t.input, before: t.before } : {}) };
}

/** The calls a superadmin can pick for a Listener round (the tenant's latest), or the briefs for a writing round. */
export async function arenaSources(db: Pool, site: string, agent: ArenaAgent = "listener") {
  await checkTenant(db, site);
  if (agent === "writer") return writerBriefs(site);
  if (agent === "chat") return chatCases(site);
  return recentSources(site, 20);
}

/** The pieces a writing round can use: the tenant's approved briefs, oldest first. */
export async function writerBriefs(site: string): Promise<{ id: string; title: string; status: string }[]> {
  const briefs = await pipelineBriefs(site);
  return briefs
    .filter((b) => b.status === "todo" || b.status === "in_progress")
    .reverse()
    .map((b) => ({ id: b.id, title: b.title, status: b.status }));
}
