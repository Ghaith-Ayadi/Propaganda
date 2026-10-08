// The Scout (agents.md #3): once a day per tenant, check the quarter's target
// searches (Google positions, and on Mondays the AI answers), the news and
// Reddit on the focus topics, and the watched sites. Write the day's Ranking
// facts, and hand the Pitcher ideas with their evidence (agent_ideas,
// through handOffIdeas). The base model reads the day's items once; everything
// else is code.
//
// Every paid request is its own step, so a retry or a restart never pays for
// one twice, and the Runs page shows the cost of each.
//
// What it follows comes from scout_searches and watched_sites
// (worker/sql/scout.draft.sql): the Goals approval writes them.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { callModel } from "../../../api/_ai/gateway";
import { modelStep } from "../limits.js";
import { dataForSeoConfigured, googleNews, googleOrganic, llmMentions, type SerpItem } from "../scout/dataforseo.js";
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
/** UTC. 06:00 lands before the working day in Europe and the US. */
export const SCOUT_CRON = process.env.SCOUT_CRON ?? "0 6 * * *";
/** Day of the week (0 = Sunday) the AI answers are checked: they change slowly and cost the most. */
const AI_WEEKDAY = Number(process.env.SCOUT_AI_WEEKDAY ?? 1);
/** News older than this isn't news. */
const NEWS_MAX_AGE_MS = 3 * 86_400_000;
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
  /** Check the AI answers whatever the weekday. */
  checkAi?: boolean;
}

export interface ScoutSummary {
  skipped?: string;
  searches: number;
  pageOne: number;
  aiMentioned: number | null;
  candidates: number;
  /** Ideas handed to the Pitcher today (one already handed before, like a standing search gap, counts again; the Pitcher skips it). */
  findings: number;
  costNote?: string;
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/**
 * The daily schedule and Admin pass a ScoutInput. Chat passes its hand-off
 * (DispatchInput): a run for today that checks everything, AI answers
 * included. The task's words are kept on the run; the Scout doesn't act on
 * them yet (it always checks the whole plan).
 */
async function scoutRun(input: ScoutInput | DispatchInput): Promise<ScoutSummary> {
  const site = input.site;
  const fromChat = !("day" in input);
  const day = fromChat ? new Date(await DBOS.now()).toISOString().slice(0, 10) : input.day;
  const checkAiToday = fromChat || input.checkAi === true;
  const plan = await DBOS.runStep(() => readPlan(site, day), { name: "read plan" });
  if (!plan) return { skipped: "no such tenant", searches: 0, pageOne: 0, aiMentioned: null, candidates: 0, findings: 0 };

  const paid = dataForSeoConfigured();
  const facts: { kind: string; value: unknown }[] = [];
  const findings: Finding[] = [];
  const candidates: Candidate[] = [];

  // ---- target searches: positions ----
  const checks: SearchCheck[] = [];
  if (paid) {
    for (const s of plan.searches) {
      const results = await DBOS.runStep(
        () => googleOrganic({ site, locationCode: s.locationCode, languageCode: s.languageCode }, s.query),
        { name: `search: ${s.query}`, retriesAllowed: true, maxAttempts: 3, intervalSeconds: 10 },
      );
      checks.push(checkSearch(plan.domains, s.query, s.topic, results));
    }
  }
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

  // ---- target prompts: AI answers that mention us (weekly) ----
  const ai: AiCheck[] = [];
  if (paid && plan.searches.length && (checkAiToday || weekday(day) === AI_WEEKDAY)) {
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
    const where = { site, locationCode: plan.searches[0]?.locationCode ?? 2840, languageCode: plan.searches[0]?.languageCode ?? "en" };
    const now = await DBOS.now();
    for (const topic of plan.topics) {
      const news: SerpItem[] = await DBOS.runStep(() => googleNews(where, topic), {
        name: `news: ${topic}`, retriesAllowed: true, maxAttempts: 3, intervalSeconds: 10,
      });
      for (const n of news) {
        if (n.published !== null && now - n.published <= NEWS_MAX_AGE_MS) {
          candidates.push({ kind: "news", url: n.url, title: n.title, snippet: n.description, topic, published: n.published });
        }
      }
      // Google's index of Reddit, through the same organic search: no Reddit
      // API account, and the price of one ordinary search.
      const threads: SerpItem[] = await DBOS.runStep(() => googleOrganic(where, `${topic} reddit`, 10), {
        name: `reddit: ${topic}`, retriesAllowed: true, maxAttempts: 3, intervalSeconds: 10,
      });
      for (const t of threads) {
        if (/(^|\.)reddit\.com$/.test(t.domain) && /\/comments\//.test(t.url)) {
          candidates.push({ kind: "reddit", url: t.url, title: t.title, snippet: t.description, topic, published: t.published });
        }
      }
    }
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
  // (or tomorrow's run finding the same search gap) never adds it twice.
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
    ...(paid ? {} : { costNote: "DataForSEO not configured: watched sites only" }),
  };
}

export const scout = DBOS.registerWorkflow(scoutRun, { name: "scout" });
registerAgent("scout", (input) => startForDispatch("scout", scout, input));

/** The id of a tenant's daily run: one per tenant per day, whatever fires it. */
export const dailyRunId = (site: string, day: string) => `scout-${site}-${day}`;

/** The schedule's run: start each tenant's Scout on the agents queue. */
async function scoutDailyRun(scheduled: Date): Promise<void> {
  const day = scheduled.toISOString().slice(0, 10);
  const sites = await DBOS.runStep(() => tenantsToScout(day), { name: "tenants" });
  for (const site of sites) {
    await startForTenantWithId(site, dailyRunId(site, day), scout, { site, day });
  }
}

export const scoutDaily = DBOS.registerWorkflow(scoutDailyRun, { name: "scout-daily" });

/** Called once after launch: the daily schedule, kept in DBOS's own tables. */
export async function scheduleScout(): Promise<void> {
  await DBOS.applySchedules([{ scheduleName: "scout-daily", workflowFn: scoutDaily, schedule: SCOUT_CRON, cronTimezone: "UTC" }]);
}
