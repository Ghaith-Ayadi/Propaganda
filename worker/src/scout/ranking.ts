// The Ranking goal's facts (goal model, goal 5; weekly rows in daily_facts): where the tenant ranks
// for each target search, and which target prompts get an AI answer that
// mentions it. Pure functions; the workflow fetches, these decide.

import type { Mention, SerpItem } from "./dataforseo.js";
import { isOurs } from "./store.js";

export interface SearchCheck {
  query: string;
  topic: string;
  /** Our best position, or null when we're not in the results fetched. */
  position: number | null;
  url: string | null;
  /** The top three that aren't us: what the Pitcher writes against. */
  top: { position: number; url: string; title: string }[];
}

export function checkSearch(domains: string[], query: string, topic: string, results: SerpItem[]): SearchCheck {
  const ours = results.filter((r) => isOurs(domains, r.domain)).sort((a, b) => a.rank - b.rank)[0];
  const top = results
    .filter((r) => !isOurs(domains, r.domain))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((r) => ({ position: r.rank, url: r.url, title: r.title }));
  return { query, topic, position: ours?.rank ?? null, url: ours?.url ?? null, top };
}

const STOP = new Set(
  "a an and are as at be best by can do does for from how i in is it of on or should the to vs what when where which who why with you your".split(" "),
);

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
}

/**
 * Does an AI answer to `question` count for our target `prompt`? When most of
 * the prompt's words are in the question (two thirds, at least one). LLM
 * Mentions returns the questions it has on file, which are rarely worded like
 * ours, so an exact match would almost never hit.
 */
export function sameQuestion(prompt: string, question: string): boolean {
  const want = words(prompt);
  if (want.length === 0) return false;
  const have = new Set(words(question));
  const hits = want.filter((w) => have.has(w)).length;
  return hits >= 1 && hits / want.length >= 2 / 3;
}

export interface AiCheck {
  platform: "google" | "chat_gpt";
  /** Target prompts with at least one AI answer mentioning us. */
  mentioned: string[];
  /** All the questions DataForSEO has where we're mentioned (for the Strategist). */
  total: number;
}

export function checkAi(platform: "google" | "chat_gpt", prompts: string[], mentions: Mention[]): AiCheck {
  return {
    platform,
    mentioned: prompts.filter((p) => mentions.some((m) => sameQuestion(p, m.question))),
    total: mentions.length,
  };
}
