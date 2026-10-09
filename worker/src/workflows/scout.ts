// The Scout (agents.md #3): once a week per tenant, check the quarter's target
// searches (Google positions and the AI answers), the news and Reddit on the
// focus topics, and the watched sites. Write the week's Ranking facts, and
// hand the Pitcher ideas with their evidence (agent_ideas, through
// handOffIdeas). The base model reads the week's items once; everything else
// is code.
//
// Nothing waits on the Scout, so its searches go on DataForSEO's standard
// queue (slow, cheap): one step posts them all, then the run sleeps durably and
// collects them as they finish. Every paid request is its own step, so a retry
// or a restart never pays for one twice, and the Runs page shows the cost of
// each.
//
// What it follows comes from scout_searches and watched_sites
// (supabase/migrations/20261008000020_scout.sql): the Goals approval writes them.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { callModel } from "../../../api/_ai/gateway";
import { modelStep } from "../limits.js";
import { collectSearches, dataForSeoConfigured, llmMentions, queueSearches, type SerpItem, type SerpRequest } from "../scout/dataforseo.js";
import { extractLinks, fetchPage, newLinks, type PageLink } from "../scout/pages.js";
import { checkAi, checkSearch, type AiCheck, type SearchCheck } from "../scout/ranking.js";
import {
  readPlan,
  saveDay,
  tenantsToScout,
  unseen,
  type Finding,
  type Snapshot,
} from "../scout/store.js";
import { MAX_IDEAS, SYSTEM, buildPrompt, parseIdeas, type Candidate } from "../scout/triage.js";
import { handOffIdeas, type NewIdea } from "../agents/ideas.js";
import { MODELS } from "../agents/model.js";
import { registerAgent, startForDispatch, startForTenantWithId, type DispatchInput } from "./agents.js";

export const SCOUT_MODEL = process.env.SCOUT_MODEL ?? MODELS.base;
/** UTC, Sundays at 06:00: the queue has a day to answer before the Pitcher's Monday 10:00 run. */
export const SCOUT_CRON = process.env.SCOUT_CRON ?? "0 6 * * 0";
/** News older than this isn't news (a week, and a day of slack for the queue). */
const NEWS_MAX_AGE_MS = 8 * 86_400_000;
/** How long the run sleeps between looks at the queue. */
const POLL_SECONDS = Number(process.env.SCOUT_POLL_SECONDS ?? 600);
/** Looks before giving up on what's still queued (a day at the default). */
const MAX_POLLS = Number(process.env.SCOUT_MAX_POLLS ?? 144);
/** The most items one triage call reads. */
const MAX_CANDIDATES = 60;
const ORIGIN = { search: "search", ai: "search", news: "news", reddit: "news", watched: "watched" } as const;

/** A finding as the Pitcher's idea (agent_ideas). */
function toIdea(site: string, f: Finding): NewIdea {
  return {
    title: f.title,
    summary: [f.why, f.topic ? `Topic: ${f.topic}.` : "", f.kind === "reddit" ? "From a Reddit thread." : ""].filter(Boolean).join(" "),
    origin: ORIGIN[f.kind],
    evidence: f.evidence.map((e) => ({
      label: e.title || e.url,
      url: e.url,
      ...(e.published ? { at: e.published } : {}),
      ...(e.position != null ? { detail: `Position ${e.position}` } : {}),
    })),
    sourceAgent: "scout",
    expiresAt: f.expiresAt,
    targetSearch: f.targetSearch ?? "",
    key: `scout:${site}:${f.dedupeKey}`,
  };
}

export interface ScoutInput {
  site: string;
  /** 'YYYY-MM-DD', UTC: the day the facts are for. */
  day: string;
}

export interface ScoutSummary {
  skipped?: string;
  searches: number;
  pageOne: number;
  aiMentioned: number | null;
  candidates: number;
  /** Searches still queued when the run gave up on them (counted as no results). */
  unanswered?: number;
  /** Ideas handed to the Pitcher this run (one already handed before, like a standing search gap, counts again; the Pitcher skips it). */
  findings: number;
  costNote?: string;
}

/**
 * The weekly schedule and Admin pass a ScoutInput. Chat passes its hand-off
 * (DispatchInput): a run for today. The task's words are kept on the run; the
 * Scout doesn't act on them yet (it always checks the whole plan).
 */
async function scoutRun(input: ScoutInput | DispatchInput): Promise<ScoutSummary> {
  const site = input.site;
  const fromChat = !("day" in input);
  const day = fromChat ? new Date(await DBOS.now()).toISOString().slice(0, 10) : input.day;
  const plan = await DBOS.runStep(() => readPlan(site, day), { name: "read plan" });
  if (!plan) return { skipped: "no such tenant", searches: 0, pageOne: 0, aiMentioned: null, candidates: 0, findings: 0 };

  const paid = dataForSeoConfigured();
  const facts: { kind: string; value: unknown }[] = [];
  const findings: Finding[] = [];
  const candidates: Candidate[] = [];

  // ---- every Google search of the run, on the standard queue ----
  const place = { locationCode: plan.searches[0]?.locationCode ?? 2840, languageCode: plan.searches[0]?.languageCode ?? "en" };
  const requests: SerpRequest[] = paid
    ? [
        ...plan.searches.map((s): SerpRequest => ({ kind: "organic", keyword: s.query, depth: 20, locationCode: s.locationCode, languageCode: s.languageCode })),
        ...plan.topics.flatMap((topic): SerpRequest[] => [
          { kind: "news", keyword: topic, depth: 20, ...place },
          // Google's index of Reddit, through the same organic search: no
          // Reddit API account, and the price of one ordinary search.
          { kind: "organic", keyword: `${topic} reddit`, depth: 10, ...place },
        ]),
      ]
    : [];
  const queued = requests.length
    ? await DBOS.runStep(() => queueSearches(site, requests), { name: "queue searches", retriesAllowed: true, maxAttempts: 3, intervalSeconds: 10 })
    : [];
  const results: (SerpItem[] | null)[] = queued.map(() => null);
  for (let poll = 1; poll <= MAX_POLLS && results.includes(null); poll++) {
    await DBOS.sleep(POLL_SECONDS * 1000);
    const waiting = results.flatMap((r, n) => (r === null ? [n] : []));
    const got = await DBOS.runStep(() => collectSearches(waiting.map((n) => queued[n]!)), {
      name: `collect searches (${poll})`, retriesAllowed: true, maxAttempts: 3, intervalSeconds: 30,
    });
    waiting.forEach((n, j) => (results[n] = got[j] ?? null));
  }
  const unanswered = results.filter((r) => r === null).length;
  const resultOf = (n: number): SerpItem[] => results[n] ?? [];

  // ---- target searches: positions ----
  const checks: SearchCheck[] = plan.searches.length && paid
    ? plan.searches.map((s, n) => checkSearch(plan.domains, s.query, s.topic, resultOf(n)))
    : [];
  if (checks.length) {
    facts.push({
      kind: "ranking_search",
      value: {
        quarter: plan.quarter,
        checked: checks.length,
        pageOne: checks.filter((c) => c.position !== null && c.position <= 10).length,
        searches: checks.map((c) => ({ query: c.query, position: c.position, url: c.url })),
      },
    });
    // A target search we're not on page one for is an idea once a quarter:
    // the Pitcher sees what ranks and writes the better answer.
    for (const c of checks) {
      if (c.position !== null && c.position <= 10) continue;
      findings.push({
        kind: "search",
        title: `Rank for "${c.query}"`,
        why: c.position === null
          ? `A target search this quarter, and we're not in the top results yet.`
          : `A target search this quarter. We're at position ${c.position}; page one is within reach.`,
        topic: c.topic,
        evidence: c.top.map((t) => ({ url: t.url, title: t.title, position: t.position })),
        expiresAt: null,
        targetSearch: c.query,
        dedupeKey: `search:${plan.quarter}:${c.query.toLowerCase()}`,
      });
    }
  }

  // ---- target prompts: AI answers that mention us ----
  const ai: AiCheck[] = [];
  if (paid && plan.searches.length) {
    const prompts = plan.searches.map((s) => s.prompt);
    const first = plan.searches[0]!;
    const where = { site, locationCode: first.locationCode, languageCode: first.languageCode };
    // ChatGPT data is US English only.
    const platforms: ("google" | "chat_gpt")[] =
      where.locationCode === 2840 && where.languageCode === "en" ? ["google", "chat_gpt"] : ["google"];
    for (const platform of platforms) {
      const mentions = await DBOS.runStep(
        // The broadest domain: the company's own when the blog is on a subdomain of it.
        () => llmMentions(where, plan.domains[plan.domains.length - 1]!, platform),
        { name: `ai mentions: ${platform}`, retriesAllowed: true, maxAttempts: 2, intervalSeconds: 30 },
      );
      ai.push(checkAi(platform, prompts, mentions));
    }
    const mentioned = new Set(ai.flatMap((a) => a.mentioned));
    facts.push({
      kind: "ranking_ai",
      value: {
        quarter: plan.quarter,
        prompts: prompts.length,
        mentioned: mentioned.size,
        platforms: Object.fromEntries(ai.map((a) => [a.platform, { mentioned: a.mentioned, total: a.total }])),
      },
    });
  }

  // ---- news and Reddit on the focus topics ----
  if (paid) {
    const now = await DBOS.now();
    plan.topics.forEach((topic, t) => {
      const base = plan.searches.length + 2 * t;
      for (const n of resultOf(base)) {
        if (n.published !== null && now - n.published <= NEWS_MAX_AGE_MS) {
          candidates.push({ kind: "news", url: n.url, title: n.title, snippet: n.description, topic, published: n.published });
        }
      }
      for (const r of resultOf(base + 1)) {
        if (/(^|\.)reddit\.com$/.test(r.domain) && /\/comments\//.test(r.url)) {
          candidates.push({ kind: "reddit", url: r.url, title: r.title, snippet: r.description, topic, published: r.published });
        }
      }
    });
  }

  // ---- watched sites ----
  const snapshots: Snapshot[] = [];
  for (const w of plan.watched) {
    const r = await DBOS.runStep(
      async (): Promise<{ items: PageLink[] | null; error: string | null }> => {
        try {
          const page = await fetchPage(w.url);
          return { items: extractLinks(page.html, page.url), error: null };
        } catch (err) {
          return { items: null, error: err instanceof Error ? err.message : String(err) };
        }
      },
      { name: `watch: ${w.url}` },
    );
    snapshots.push({ id: w.id, items: r.items, error: r.error });
    if (r.items) {
      for (const l of newLinks(w.lastItems, r.items).slice(0, 15)) {
        candidates.push({ kind: "watched", url: l.url, title: l.text, snippet: w.why, topic: w.topic, published: null, source: w.url });
      }
    }
  }

  // ---- one read by the model, of what's new ----
  const byUrl = new Map(candidates.map((c) => [c.url, c]));
  const fresh = await DBOS.runStep(() => unseen(site, [...byUrl.keys()]), { name: "drop what was seen" });
  const toRead = fresh.map((u) => byUrl.get(u)!).slice(0, MAX_CANDIDATES);
  if (toRead.length) {
    const triage = {
      tenant: plan.name,
      topics: plan.topics,
      searches: plan.searches.map((s) => s.query),
      candidates: toRead,
      day,
    };
    const answer = await modelStep("pick ideas", () =>
      callModel({
        site,
        job: "scout",
        model: SCOUT_MODEL,
        background: true,
        system: SYSTEM,
        prompt: buildPrompt(triage),
        maxOutputTokens: 300 * MAX_IDEAS,
      }),
    );
    findings.push(...parseIdeas(answer.text, triage));
  }

  // The Pitcher's queue first: each idea's id comes from its key, so a replay
  // (or next week's run finding the same search gap) never adds it twice.
  const ideas = findings.map((f) => toIdea(site, f));
  // They wait for the next batch's slots with the plan's ideas; the Pitcher's morning run picks them up.
  const ideaIds = await DBOS.runStep(() => handOffIdeas(site, ideas), { name: "hand ideas to the Pitcher" });

  await DBOS.runStep(() => saveDay({ site, day, facts, snapshots, seen: toRead.map((c) => c.url) }), { name: "save" });

  return {
    searches: checks.length,
    pageOne: checks.filter((c) => c.position !== null && c.position <= 10).length,
    aiMentioned: ai.length ? new Set(ai.flatMap((a) => a.mentioned)).size : null,
    candidates: toRead.length,
    findings: ideaIds.length,
    ...(unanswered ? { unanswered } : {}),
    ...(paid ? {} : { costNote: "DataForSEO not configured: watched sites only" }),
  };
}

export const scout = DBOS.registerWorkflow(scoutRun, { name: "scout" });
registerAgent("scout", (input) => startForDispatch("scout", scout, input));

/** The id of a tenant's scheduled run: one per tenant per day, whatever fires it. */
export const weeklyRunId = (site: string, day: string) => `scout-${site}-${day}`;

/** The schedule's run: start each tenant's Scout on the agents queue. */
async function scoutWeeklyRun(scheduled: Date): Promise<void> {
  const day = scheduled.toISOString().slice(0, 10);
  const sites = await DBOS.runStep(() => tenantsToScout(day), { name: "tenants" });
  for (const site of sites) {
    await startForTenantWithId(site, weeklyRunId(site, day), scout, { site, day });
  }
}

export const scoutWeekly = DBOS.registerWorkflow(scoutWeeklyRun, { name: "scout-weekly" });

/** Called once after launch: the weekly schedule, kept in DBOS's own tables. */
export async function scheduleScout(): Promise<void> {
  await DBOS.applySchedules([{ scheduleName: "scout-weekly", workflowFn: scoutWeekly, schedule: SCOUT_CRON, cronTimezone: "UTC" }]);
}
