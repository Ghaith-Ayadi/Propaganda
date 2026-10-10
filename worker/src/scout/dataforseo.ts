// DataForSEO, the Scout's search data: Google results (positions), Google
// News, and AI answers that mention a domain (the LLM Mentions API). Every
// paid request goes through callPaidApi(), so it is checked against the budget
// and logged in the cost log with the cost DataForSEO reports. Swapping the
// provider means replacing this file: the workflow only sees SerpItem and
// Mention.
//
// Needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (the API login, not the
// account's). Without them the Scout skips everything here and still checks
// the watched sites.

import { callPaidApi } from "../../../api/_ai/gateway";

const BASE = (process.env.DATAFORSEO_URL ?? "https://api.dataforseo.com").replace(/\/+$/, "");
const OK = 20000;

export function dataForSeoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export class DataForSeoError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "DataForSeoError";
  }
}

interface Task {
  id?: string;
  status_code: number;
  status_message: string;
  cost?: number;
  /** What was posted, echoed back (task_post: the task's fields, our tag included). */
  data?: { tag?: string };
  result?: unknown[] | null;
}

interface Envelope {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: Task[];
}

function auth(): string {
  const login = process.env.DATAFORSEO_LOGIN ?? "";
  const password = process.env.DATAFORSEO_PASSWORD ?? "";
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function call(path: string, tasks?: Record<string, unknown>[]): Promise<Envelope> {
  const res = await fetch(`${BASE}${path}`, {
    method: tasks ? "POST" : "GET",
    headers: { Authorization: auth(), ...(tasks ? { "Content-Type": "application/json" } : {}) },
    ...(tasks ? { body: JSON.stringify(tasks) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new DataForSeoError(`DataForSEO answered HTTP ${res.status} on ${path}`, res.status);
  const body = (await res.json()) as Envelope;
  if (body.status_code !== OK) throw new DataForSeoError(`DataForSEO: ${body.status_message}`, body.status_code);
  return body;
}

/** One live task. Returns the task's first result and what it cost. */
async function live(path: string, task: Record<string, unknown>): Promise<{ value: unknown; costUsd: number }> {
  const body = await call(path, [task]);
  const t = body.tasks?.[0];
  if (!t || t.status_code !== OK) throw new DataForSeoError(`DataForSEO task: ${t?.status_message ?? "no task"}`, t?.status_code);
  return { value: t.result?.[0] ?? null, costUsd: Number(body.cost ?? t.cost ?? 0) || 0 };
}

export interface Where {
  site: string;
  locationCode: number;
  languageCode: string;
}

function paid<T>(site: string, service: string, run: () => Promise<{ value: T; costUsd: number }>): Promise<T> {
  return callPaidApi({ site, job: "scout", service: `dataforseo/${service}`, background: true }, run);
}

export interface SerpItem {
  rank: number;
  domain: string;
  url: string;
  title: string;
  description: string;
  /** Epoch ms, when Google shows a date. */
  published: number | null;
}

function items(result: unknown): Record<string, unknown>[] {
  const r = result as { items?: unknown[] } | null;
  return Array.isArray(r?.items) ? (r!.items as Record<string, unknown>[]) : [];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function when(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v.replace(" +00:00", "Z").replace(" ", "T"));
  return Number.isFinite(t) ? t : null;
}

function organicItems(result: unknown): SerpItem[] {
  return items(result)
    .filter((i) => i.type === "organic")
    .map((i) => ({
      rank: Number(i.rank_group) || 0,
      domain: str(i.domain),
      url: str(i.url),
      title: str(i.title),
      description: str(i.description),
      published: when(i.timestamp),
    }));
}

/** The stories and the top-stories box, flattened. */
function newsItems(result: unknown): SerpItem[] {
  const out: SerpItem[] = [];
  for (const i of items(result)) {
    const group = i.type === "top_stories" && Array.isArray(i.items) ? (i.items as Record<string, unknown>[]) : [i];
    for (const n of group) {
      if (!str(n.url)) continue;
      out.push({
        rank: Number(i.rank_group) || 0,
        domain: str(n.domain),
        url: str(n.url),
        title: str(n.title),
        description: str(n.snippet),
        published: when(n.timestamp),
      });
    }
  }
  return out;
}

// ---- Google results and news on the standard queue ----
//
// The Scout runs weekly and nothing waits on it, so its searches go on
// DataForSEO's standard queue (task_post, then task_get): a fraction of the
// live price, with results in minutes to hours. Posting is what's paid, one
// cost-log row per post; collecting is free.

export type SerpKind = "organic" | "news";

export interface SerpRequest extends Omit<Where, "site"> {
  kind: SerpKind;
  keyword: string;
  depth: number;
}

export interface QueuedSearch {
  kind: SerpKind;
  id: string;
}

const MAX_PER_POST = 100;

/** Queue searches, one post per kind (up to 100 tasks each). Returns a task per search, in order. */
export async function queueSearches(site: string, requests: SerpRequest[]): Promise<QueuedSearch[]> {
  const out: (QueuedSearch | null)[] = requests.map(() => null);
  for (const kind of ["organic", "news"] as const) {
    const mine = requests.map((r, n) => ({ r, n })).filter((x) => x.r.kind === kind);
    for (let i = 0; i < mine.length; i += MAX_PER_POST) {
      const chunk = mine.slice(i, i + MAX_PER_POST);
      const tasks = await paid(site, `serp-${kind}-queued`, async () => {
        const body = await call(
          `/v3/serp/google/${kind}/task_post`,
          chunk.map(({ r, n }) => ({
            keyword: r.keyword,
            location_code: r.locationCode,
            language_code: r.languageCode,
            depth: r.depth,
            tag: String(n),
          })),
        );
        return { value: body.tasks ?? [], costUsd: Number(body.cost ?? 0) || 0 };
      });
      // Matched on the tag each task carries, not on its place in the answer.
      const byTag = new Map(tasks.filter((t) => t.data?.tag !== undefined).map((t) => [t.data!.tag!, t]));
      for (const { n } of chunk) {
        const t = byTag.get(String(n));
        // 20100: "Task Created". A refused task is reported as missing results, not a failed run.
        out[n] = t?.id && t.status_code === 20100 ? { kind, id: t.id } : null;
      }
    }
  }
  return out.map((q, n) => q ?? { kind: requests[n]!.kind, id: "" });
}

/** Not ready yet: "Task Handed" and "Task In Queue". */
const PENDING = new Set([40601, 40602]);

/**
 * The results of queued searches: items for each finished one, null while it
 * waits in the queue, [] for one that failed or was never queued. Free.
 */
export async function collectSearches(queued: QueuedSearch[]): Promise<(SerpItem[] | null)[]> {
  const out: (SerpItem[] | null)[] = [];
  for (const q of queued) {
    if (!q.id) {
      out.push([]);
      continue;
    }
    const body = await call(`/v3/serp/google/${q.kind}/task_get/advanced/${encodeURIComponent(q.id)}`);
    const t = body.tasks?.[0];
    if (t && PENDING.has(t.status_code)) out.push(null);
    else if (t?.status_code === OK) out.push(q.kind === "news" ? newsItems(t.result?.[0] ?? null) : organicItems(t.result?.[0] ?? null));
    else out.push([]);
  }
  return out;
}

export interface Mention {
  question: string;
  /** The domains the answer cites. */
  sources: string[];
  aiSearchVolume: number;
}

/**
 * AI answers that mention `domain`, on one platform: 'google' (AI Overviews)
 * or 'chat_gpt' (US English only). The Scout matches these against its target
 * prompts; one request covers all of them.
 */
export async function llmMentions(w: Where, domain: string, platform: "google" | "chat_gpt", limit = 50): Promise<Mention[]> {
  const result = await paid(w.site, `llm-mentions-${platform}`, () =>
    live("/v3/ai_optimization/llm_mentions/search_mentions/live", {
      target: [{ domain, include_subdomains: true }],
      location_code: w.locationCode,
      language_code: w.languageCode,
      platform,
      limit,
    }),
  );
  return items(result).map((i) => ({
    question: str(i.question),
    sources: Array.isArray(i.sources) ? (i.sources as Record<string, unknown>[]).map((s) => str(s.domain)).filter(Boolean) : [],
    aiSearchVolume: Number(i.ai_search_volume) || 0,
  }));
}

// ---- keyword data (DataForSEO Labs), for the Strategist ----
//
// Live and cheap (a cent or two a request); the Strategist calls these a few
// times per proposal, so they're charged to its own job in the cost log.

export interface KeywordRow {
  keyword: string;
  /** Monthly Google searches. */
  volume: number;
  /** DataForSEO's 0 to 100; null when it has none. */
  difficulty: number | null;
  /** The domain's Google position, for ranked keywords; null otherwise. */
  position: number | null;
}

function keywordOf(i: Record<string, unknown>): KeywordRow {
  const data = (i.keyword_data as Record<string, unknown> | undefined) ?? i;
  const info = (data.keyword_info as Record<string, unknown> | undefined) ?? {};
  const props = (data.keyword_properties as Record<string, unknown> | undefined) ?? {};
  const serp = ((i.ranked_serp_element as Record<string, unknown> | undefined)?.serp_item as Record<string, unknown> | undefined) ?? null;
  const difficulty = Number(props.keyword_difficulty);
  return {
    keyword: str(data.keyword),
    volume: Number(info.search_volume) || 0,
    difficulty: Number.isFinite(difficulty) && props.keyword_difficulty !== null ? difficulty : null,
    position: serp ? Number(serp.rank_group) || null : null,
  };
}

/** Searches related to `seeds` (at most 20 seeds), with volume and difficulty. */
export async function keywordIdeas(w: Where, job: string, seeds: string[], limit = 60): Promise<KeywordRow[]> {
  if (!seeds.length) return [];
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/keyword-ideas", background: true }, () =>
    live("/v3/dataforseo_labs/google/keyword_ideas/live", {
      keywords: seeds.slice(0, 20),
      location_code: w.locationCode,
      language_code: w.languageCode,
      limit,
      order_by: ["keyword_info.search_volume,desc"],
    }),
  );
  return items(result).map(keywordOf).filter((k) => k.keyword);
}

/**
 * Volume and difficulty for exact `keywords` (at most 700): the Strategist
 * prices the searches the model proposed that the ideas pull never covered.
 * A keyword DataForSEO has no row for is left out.
 */
export async function keywordOverview(w: Where, job: string, keywords: string[]): Promise<KeywordRow[]> {
  if (!keywords.length) return [];
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/keyword-overview", background: true }, () =>
    live("/v3/dataforseo_labs/google/keyword_overview/live", {
      keywords: keywords.slice(0, 700),
      location_code: w.locationCode,
      language_code: w.languageCode,
    }),
  );
  return items(result).map(keywordOf).filter((k) => k.keyword);
}

/** Searches `domain` already ranks for (top 100), best first. */
export async function rankedKeywords(w: Where, job: string, domain: string, limit = 50): Promise<KeywordRow[]> {
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/ranked-keywords", background: true }, () =>
    live("/v3/dataforseo_labs/google/ranked_keywords/live", {
      target: domain,
      location_code: w.locationCode,
      language_code: w.languageCode,
      limit,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
    }),
  );
  return items(result).map(keywordOf).filter((k) => k.keyword);
}
