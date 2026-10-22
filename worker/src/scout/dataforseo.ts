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
  /** Monthly Google searches; null when DataForSEO has no number (never 0 for "unknown"). */
  volume: number | null;
  /** DataForSEO's 0 to 100; null when it has none. */
  difficulty: number | null;
  /** The domain's Google position, for ranked keywords; null otherwise. */
  position: number | null;
  /** Distinct sites linking to an average page-one result (avg_backlinks_info.referring_main_domains); with SERP info only. */
  referringDomains?: number | null;
  /** The last six months' searches against the six before, as a percentage (+50 is half as many again); null without 12 months of data. */
  trend6?: number | null;
  /** The month (1 to 12) with the most searches over the last 12; null without the data. */
  peakMonth?: number | null;
  /**
   * The last twelve months' searches against the twelve before, as a percentage:
   * the seasons cancel, so it is the growth figure. Null without 24 months of
   * data, which Labs never has (12 months); Google Ads with history does.
   */
  yoy?: number | null;
  /** DataForSEO's main intent: informational, navigational, commercial, transactional. */
  intent?: string | null;
  /** Google shows an AI overview for this search (serp_info.serp_item_types); null when SERP info wasn't asked for. */
  aiOverview?: boolean | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

type Season = { trend6: number | null; peakMonth: number | null; yoy: number | null };

/** The 6-month trend, the peak month and the year-over-year growth from monthly_searches (newest first or not: sorted here). */
function seasonOf(monthly: unknown): Season {
  const none: Season = { trend6: null, peakMonth: null, yoy: null };
  if (!Array.isArray(monthly)) return none;
  const rows = (monthly as Record<string, unknown>[])
    .map((m) => ({ year: Number(m.year), month: Number(m.month), volume: Number(m.search_volume) }))
    .filter((m) => Number.isFinite(m.year) && Number.isFinite(m.month) && Number.isFinite(m.volume))
    .sort((a, b) => b.year - a.year || b.month - a.month);
  const last12 = rows.slice(0, 12);
  if (last12.length < 12) return none;
  const sum = (xs: typeof rows) => xs.reduce((n, m) => n + m.volume, 0);
  const growth = (recent: number, before: number) => (before > 0 ? Math.round(((recent - before) / before) * 100) : recent > 0 ? null : 0);
  const trend6 = growth(sum(last12.slice(0, 6)), sum(last12.slice(6, 12)));
  const peak = last12.reduce((best, m) => (m.volume > best.volume ? m : best), last12[0]!);
  const yearBefore = rows.slice(12, 24);
  const yoy = yearBefore.length === 12 ? growth(sum(last12), sum(yearBefore)) : null;
  return { trend6, peakMonth: peak.volume > 0 ? peak.month : null, yoy };
}

/** The first day of the month `monthsAgo` months back, as DataForSEO's date_from (yyyy-mm-dd). */
export function monthsBack(monthsAgo: number, today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 1));
  return d.toISOString().slice(0, 10);
}

function keywordOf(i: Record<string, unknown>): KeywordRow {
  const data = (i.keyword_data as Record<string, unknown> | undefined) ?? i;
  const info = (data.keyword_info as Record<string, unknown> | undefined) ?? {};
  const props = (data.keyword_properties as Record<string, unknown> | undefined) ?? {};
  const serp = ((i.ranked_serp_element as Record<string, unknown> | undefined)?.serp_item as Record<string, unknown> | undefined) ?? null;
  const serpInfo = (data.serp_info as Record<string, unknown> | undefined) ?? null;
  const links = (data.avg_backlinks_info as Record<string, unknown> | undefined) ?? null;
  const intent = (data.search_intent_info as Record<string, unknown> | undefined) ?? null;
  const difficulty = Number(props.keyword_difficulty);
  const row: KeywordRow = {
    keyword: str(data.keyword),
    // No number is no number: a 0 here used to make every unknown search "not winnable" (Havoc, 2026-10-20).
    volume: num(info.search_volume),
    difficulty: Number.isFinite(difficulty) && props.keyword_difficulty !== null ? difficulty : null,
    position: serp ? Number(serp.rank_group) || null : null,
  };
  if (info.monthly_searches !== undefined) Object.assign(row, seasonOf(info.monthly_searches));
  if (intent) row.intent = str(intent.main_intent) || null;
  if (links) row.referringDomains = num(links.referring_main_domains) === null ? null : Math.round(num(links.referring_main_domains)!);
  if (serpInfo) row.aiOverview = Array.isArray(serpInfo.serp_item_types) ? (serpInfo.serp_item_types as unknown[]).includes("ai_overview") : null;
  return row;
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
 * Searches that contain `seed` ("ai cms" gives "headless ai cms", "best ai cms
 * for blogs"), with volume and difficulty, biggest first. One seed per request.
 */
export async function keywordSuggestions(w: Where, job: string, seed: string, limit = 50): Promise<KeywordRow[]> {
  if (!seed.trim()) return [];
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/keyword-suggestions", background: true }, () =>
    live("/v3/dataforseo_labs/google/keyword_suggestions/live", {
      keyword: seed.trim(),
      location_code: w.locationCode,
      language_code: w.languageCode,
      include_seed_keyword: true,
      limit,
      order_by: ["keyword_info.search_volume,desc"],
    }),
  );
  return items(result).map(keywordOf).filter((k) => k.keyword);
}

/**
 * Searches Google's "searches related to" chain reaches from `seed` in two
 * steps: the phrases next to theirs that don't contain the seed's words.
 */
export async function relatedKeywords(w: Where, job: string, seed: string, limit = 30): Promise<KeywordRow[]> {
  if (!seed.trim()) return [];
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/related-keywords", background: true }, () =>
    live("/v3/dataforseo_labs/google/related_keywords/live", {
      keyword: seed.trim(),
      location_code: w.locationCode,
      language_code: w.languageCode,
      depth: 2,
      limit,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
    }),
  );
  return items(result).map(keywordOf).filter((k) => k.keyword);
}

/**
 * Volume and difficulty for exact `keywords` (at most 700): the Strategist
 * prices the searches the model proposed that the ideas pull never covered.
 * A keyword DataForSEO has no row for is left out. With `serpInfo`, each row
 * also carries page one's referring domains, the AI overview flag, the intent
 * and the season (a 6-month trend and the peak month).
 */
export async function keywordOverview(w: Where, job: string, keywords: string[], o: { serpInfo?: boolean } = {}): Promise<KeywordRow[]> {
  if (!keywords.length) return [];
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/keyword-overview", background: true }, () =>
    live("/v3/dataforseo_labs/google/keyword_overview/live", {
      keywords: keywords.slice(0, 700),
      location_code: w.locationCode,
      language_code: w.languageCode,
      ...(o.serpInfo ? { include_serp_info: true } : {}),
    }),
  );
  return items(result).map(keywordOf).filter((k) => k.keyword);
}

/**
 * Google Ads' own monthly volume for exact `keywords` (at most 1000): the
 * fallback when Labs has no row for a phrase (its index is thinner than
 * Google's), and with `history` the only source of two years of months, which
 * is what the year-over-year growth needs (Labs gives twelve). A keyword Ads
 * has no number for is left out.
 */
export async function adsSearchVolume(w: Where, job: string, keywords: string[], o: { history?: boolean } = {}): Promise<KeywordRow[]> {
  if (!keywords.length) return [];
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/ads-search-volume", background: true }, async () => {
    const body = await call("/v3/keywords_data/google_ads/search_volume/live", [
      { keywords: keywords.slice(0, 1000), location_code: w.locationCode, language_code: w.languageCode, ...(o.history ? { date_from: monthsBack(25) } : {}) },
    ]);
    const t = body.tasks?.[0];
    if (!t || t.status_code !== OK) throw new DataForSeoError(`DataForSEO task: ${t?.status_message ?? "no task"}`, t?.status_code);
    return { value: t.result ?? [], costUsd: Number(body.cost ?? t.cost ?? 0) || 0 };
  });
  const rows = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  return rows
    .filter((r) => str(r.keyword) && num(r.search_volume) !== null)
    .map((r) => ({ keyword: str(r.keyword), volume: num(r.search_volume), difficulty: null, position: null, ...seasonOf(r.monthly_searches) }));
}

export interface SerpCompetitor {
  domain: string;
  /** How many of the seed searches it is in the top 100 for. */
  keywords: number;
  avgPosition: number;
}

/**
 * The domains that rank for `keywords` (at most 200 seeds) across Google's
 * top 100, best first: who the reader finds today. One request.
 */
export async function serpCompetitors(w: Where, job: string, keywords: string[], limit = 25): Promise<SerpCompetitor[]> {
  if (!keywords.length) return [];
  const result = await callPaidApi({ site: w.site, job, service: "dataforseo/serp-competitors", background: true }, () =>
    live("/v3/dataforseo_labs/google/serp_competitors/live", {
      keywords: keywords.slice(0, 200),
      location_code: w.locationCode,
      language_code: w.languageCode,
      limit,
    }),
  );
  return items(result)
    .map((i) => ({ domain: str(i.domain).replace(/^www\./, ""), keywords: Number(i.keywords_count) || 0, avgPosition: Math.round(Number(i.avg_position) || 0) }))
    .filter((c) => c.domain);
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
