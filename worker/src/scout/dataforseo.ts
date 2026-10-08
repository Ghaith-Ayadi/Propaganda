// DataForSEO, the Scout's search data: Google results (positions), Google
// News, and AI answers that mention a domain (the LLM Mentions API). Every
// request goes through callPaidApi(), so it is checked against the budget and
// logged in the cost log with the cost DataForSEO reports.
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

interface Envelope {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: { status_code: number; status_message: string; cost?: number; result?: unknown[] | null }[];
}

/** One live task. Returns the task's first result and what it cost. */
async function post(path: string, task: Record<string, unknown>): Promise<{ value: unknown; costUsd: number }> {
  const login = process.env.DATAFORSEO_LOGIN ?? "";
  const password = process.env.DATAFORSEO_PASSWORD ?? "";
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([task]),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new DataForSeoError(`DataForSEO answered HTTP ${res.status} on ${path}`, res.status);
  const body = (await res.json()) as Envelope;
  if (body.status_code !== OK) throw new DataForSeoError(`DataForSEO: ${body.status_message}`, body.status_code);
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

/** Google's organic results for `keyword`, top `depth`. */
export async function googleOrganic(w: Where, keyword: string, depth = 20): Promise<SerpItem[]> {
  const result = await paid(w.site, "serp-organic", () =>
    post("/v3/serp/google/organic/live/advanced", {
      keyword,
      location_code: w.locationCode,
      language_code: w.languageCode,
      depth,
    }),
  );
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

/** Google News for `keyword`: the stories and the top-stories box, flattened. */
export async function googleNews(w: Where, keyword: string, depth = 20): Promise<SerpItem[]> {
  const result = await paid(w.site, "serp-news", () =>
    post("/v3/serp/google/news/live/advanced", {
      keyword,
      location_code: w.locationCode,
      language_code: w.languageCode,
      depth,
    }),
  );
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
export async function llmMentions(w: Where, domain: string, platform: "google" | "chat_gpt", limit = 200): Promise<Mention[]> {
  const result = await paid(w.site, `llm-mentions-${platform}`, () =>
    post("/v3/ai_optimization/llm_mentions/search_mentions/live", {
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
