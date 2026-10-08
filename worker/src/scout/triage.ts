// The one model call in a Scout run: read what the day turned up (news,
// watched-site changes, Reddit threads) and keep what a tenant could write
// about, as ideas with their evidence. Code does the rest: the search gaps
// and AI mentions need no judgement, and every link an idea cites must be one
// the Scout actually saw (anything else is dropped, never trusted).

import type { Evidence, Finding } from "./store.js";

export interface Candidate {
  kind: "news" | "watched" | "reddit";
  url: string;
  title: string;
  snippet: string;
  topic: string;
  /** Epoch ms, when known. */
  published: number | null;
  /** For a watched site: the page it appeared on, and why the tenant watches it. */
  source?: string;
}

export interface TriageInput {
  tenant: string;
  topics: string[];
  searches: string[];
  candidates: Candidate[];
  day: string;
}

/** At most this many ideas a run: a review session, not a firehose. */
export const MAX_IDEAS = 8;

export const SYSTEM = `You are the Scout for a content team. Each week you read what the web turned up
on the tenant's topics and pick the few items worth a blog post. You never write the post.

Keep an item only when the tenant could write something useful because of it: a rule
changed, a study came out, people keep asking a question, a competitor said something
worth answering. Drop press releases about funding, listicles, and anything off-topic.

For each idea give a working title (plain, specific, no clickbait), one or two sentences on
why now and why this tenant, the topic it belongs to (one of the tenant's topics), and the
ids of the items it rests on. If the idea stops being worth writing after a date (a comment
period, an event), give expires_in_days. Merge items about the same story into one idea.

House style: never write "That's not X. It's Y." Say it as a comparison instead.

Answer with JSON only: {"ideas":[{"title":"","why":"","topic":"","items":[1,2],"expires_in_days":null}]}
At most ${MAX_IDEAS} ideas. An empty list is a fine answer.`;

export function buildPrompt(input: TriageInput): string {
  const lines = input.candidates.map((c, i) => {
    const date = c.published ? new Date(c.published).toISOString().slice(0, 10) : "undated";
    const from = c.source ? ` (new on watched page ${c.source})` : "";
    return `[${i + 1}] ${c.kind}${from} | topic: ${c.topic || "?"} | ${date}\n    ${c.title}\n    ${c.snippet.slice(0, 300)}\n    ${c.url}`;
  });
  return [
    `Tenant: ${input.tenant}`,
    `Today: ${input.day}`,
    `Topics: ${input.topics.join("; ") || "(none set)"}`,
    `Target searches this quarter: ${input.searches.join("; ") || "(none set)"}`,
    "",
    `Items (${input.candidates.length}):`,
    ...lines,
  ].join("\n");
}

function jsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1]! : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The model's ideas as findings. Unknown items, topics and shapes are dropped. */
export function parseIdeas(text: string, input: TriageInput): Finding[] {
  const parsed = jsonIn(text) as { ideas?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.ideas)) return [];
  const out: Finding[] = [];
  const used = new Set<string>();
  for (const raw of parsed.ideas.slice(0, MAX_IDEAS)) {
    const idea = raw as Record<string, unknown>;
    const title = typeof idea.title === "string" ? idea.title.trim() : "";
    if (!title || !Array.isArray(idea.items)) continue;
    const picked = idea.items
      .map((n) => input.candidates[Number(n) - 1])
      .filter((c): c is Candidate => c !== undefined && !used.has(c.url));
    if (picked.length === 0) continue;
    picked.forEach((c) => used.add(c.url));
    const topic = typeof idea.topic === "string" && input.topics.includes(idea.topic) ? idea.topic : picked[0]!.topic;
    const days = Number(idea.expires_in_days);
    const evidence: Evidence[] = picked.map((c) => ({
      url: c.url,
      title: c.title,
      ...(c.published ? { published: new Date(c.published).toISOString() } : {}),
    }));
    out.push({
      kind: picked[0]!.kind,
      title: title.slice(0, 300),
      why: typeof idea.why === "string" ? idea.why.trim().slice(0, 2000) : "",
      topic,
      evidence,
      expiresAt: Number.isFinite(days) && days > 0 && days <= 365 ? new Date(Date.parse(input.day) + days * 86_400_000).toISOString() : null,
      dedupeKey: picked[0]!.url,
    });
  }
  return out;
}
