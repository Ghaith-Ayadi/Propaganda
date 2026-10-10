// Day one (onboarding/first-day-flow.md, "Decided by Ayadi" and stage 3b):
// the Strategist writes the first pitches itself, right after the plan, in
// the Pitcher's brief format; the 3 strongest start drafting when the plan is
// approved; a day-one pitch rejected with a reason gets one replacement.
// The pure parts are here (tested in test/first-day.mjs); the workflows are
// in workflows/first-day.ts.

import { fitScore, type FitGrade, type FitReason, type Judgement } from "./fit.js";
import type { Goals } from "./goals.js";
import { arr, obj, str } from "./model.js";
import { parsePitch, PITCHER_SYSTEM, type Written } from "./pitcher.js";
import type { LaunchPlan, StoredProposal } from "./strategy.js";

/** Day one's pitches in all (Ayadi, 2026-10-10: about 6 cents each on Fable). */
export const FIRST_PITCHES = 10;
/** Every topic gets at least this many. */
export const MIN_PER_TOPIC = 2;
/** Pitches drafted before anyone approves them, once the plan is approved. */
export const DRAFT_TOP = 3;
/** The batch day one's pitches belong to; the Pitcher numbers its own from 2. */
export const FIRST_BATCH = 1;

/**
 * Lite tenants get no AI. The plan has no home on the server yet (the
 * proposal is a superadmin-only `sites.plan` column), so this is the app's
 * placeholder (app/src/lib/tenantPlan.ts): Verbatim is Lite, every other
 * tenant is full. WORKER_LITE_SITES (comma-separated ids) adds more. Not
 * kb_agent_sites: that list is turned on by hand, so every new tenant would
 * read as Lite on its first day.
 */
export function isLite(site: string): boolean {
  const extra = (process.env.WORKER_LITE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return site === "verbatimsite000" || extra.includes(site);
}

/** Day one's approvals target: batch 1's quota. The Launch's day-one briefs, at most 5 (3 to 5 approved in one sitting). */
export function dayOneQuota(launch: LaunchPlan | null | undefined): number {
  const briefs = launch?.dayOne?.briefs;
  return Math.max(1, Math.min(5, Number.isFinite(briefs) && briefs! > 0 ? briefs! : 5));
}

/**
 * `total` pitches over topics, proportional to each topic's low end, at least
 * `min` each (less only when there are too many topics for `min` each). The
 * sum is always `total`; ties go to the earlier (stronger) topic.
 */
export function splitPitches(lows: number[], total = FIRST_PITCHES, min = MIN_PER_TOPIC): number[] {
  const k = lows.length;
  if (k === 0 || total <= 0) return lows.map(() => 0);
  const floor = Math.min(min, Math.floor(total / k));
  const weights = lows.map((l) => (Number.isFinite(l) && l > 0 ? l : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const ideal = weights.map((w) => (sum > 0 ? (total * w) / sum : total / k));
  const out = ideal.map((x) => Math.max(floor, Math.floor(x)));
  const pick = (better: (a: number, b: number) => boolean, ok: (i: number) => boolean) => {
    let best = -1;
    for (let i = 0; i < k; i++) if (ok(i) && (best < 0 || better(i, best))) best = i;
    return best;
  };
  let n = out.reduce((a, b) => a + b, 0);
  while (n < total) {
    // The one furthest below its share gets the next pitch.
    const i = pick((a, b) => ideal[a]! - out[a]! > ideal[b]! - out[b]!, () => true);
    out[i]!++;
    n++;
  }
  while (n > total) {
    // The one furthest above its share, never below the floor, gives one back.
    const i = pick((a, b) => out[a]! - ideal[a]! > out[b]! - ideal[b]!, (x) => out[x]! > floor);
    if (i < 0) break;
    out[i]!--;
    n--;
  }
  return out;
}

export const sameTopic = (a: string, b: string) => normTopic(a) === normTopic(b);
export function normTopic(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface TopicChanges {
  /** In both: their pitches, and any decision on them, stay. */
  kept: string[];
  /** Gone (or renamed): undecided pitches are withdrawn. */
  removed: string[];
  /** New (or renamed): pitched fresh. */
  added: string[];
}

/** Which topics a revision changed, by name (case and spacing aside). A rename is a removal and an addition. */
export function topicChanges(before: string[], after: string[]): TopicChanges {
  const has = (list: string[], name: string) => list.some((x) => sameTopic(x, name));
  const uniq = (list: string[]) => list.filter((x, i) => list.findIndex((y) => sameTopic(x, y)) === i);
  return {
    kept: uniq(after.filter((t) => has(before, t))),
    removed: uniq(before.filter((t) => !has(after, t))),
    added: uniq(after.filter((t) => !has(before, t))),
  };
}

export interface RankedBrief {
  id: string;
  fit: { grade?: FitGrade; reasons?: FitReason[] } | null;
  created?: string;
}

const GRADE_RANK: Record<string, number> = { strong: 0, fair: 1, weak: 2 };

/** The `n` strongest: Strong first, then Fair, then by how many fit reasons count, then the oldest. */
export function strongest<T extends RankedBrief>(briefs: T[], n = DRAFT_TOP): T[] {
  const reasons = (b: T) => (b.fit?.reasons ?? []).filter((r) => r.counts).length;
  return [...briefs]
    .sort(
      (a, b) =>
        (GRADE_RANK[a.fit?.grade ?? "weak"] ?? 2) - (GRADE_RANK[b.fit?.grade ?? "weak"] ?? 2) ||
        reasons(b) - reasons(a) ||
        fitScore(b.fit?.reasons ?? []) - fitScore(a.fit?.reasons ?? []) ||
        String(a.created ?? "").localeCompare(String(b.created ?? "")) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, n);
}

/** The plan as the Pitcher's goals (fit.ts rates against them), before anyone has approved it. */
export function goalsFromProposal(p: StoredProposal, perWeek: number): Goals {
  return {
    quarter: p.quarter,
    volume: { total: Number(p.volume?.value) || 0, topics: (p.topics ?? []).map((t) => ({ name: t.name, low: Number(t.low) || 0, high: Number(t.high) || 0 })) },
    coverage: { internal: 0, external: 0 },
    searches: (p.ranking?.searches ?? []).map((s) => ({ query: s.query, position: s.position ?? null })),
    perWeek: Math.max(1, perWeek),
  };
}

/** The line a replacement pitch carries (briefs.learned, at most 400 characters). */
export function replacementLearned(reason: string): string {
  return `Written after your note: ${reason.trim().replace(/\s+/g, " ")}`.slice(0, 400);
}

/** Stable keys, so a replayed step finds the rows it already wrote. */
export const firstPitchKey = (proposalId: string, topicIndex: number, n: number) => `first-${proposalId}-${topicIndex}-${n}`;
export const replacementKey = (briefId: string) => `replace-${briefId}`;

/** Searches for a topic's pitches: its target searches in order, then the topic's name; one per pitch. */
export function searchesFor(topic: string, targets: string[], n: number): string[] {
  const pool = targets.length ? targets : [topic];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]!);
}

// ---- the model call ----

export interface TopicPitch {
  written: Written;
  judgement: Judgement;
}

/** The answer: exactly `n` pitches in the Pitcher's brief format, each with what fit.ts needs. */
export function parseTopicPitches(allowedUrls: Set<string>, collectionNames: string[], n: number, targets: string[]) {
  const brief = parsePitch(allowedUrls, collectionNames);
  return (v: unknown): TopicPitch[] => {
    const list = arr(obj(v, "The answer").pitches, "pitches");
    if (list.length < n) throw new Error(`Write ${n} pitches; you wrote ${list.length}.`);
    return list.slice(0, n).map((x, i) => {
      const o = obj(x, `pitches[${i}]`);
      let written: Written;
      try {
        written = brief(o);
      } catch (err) {
        throw new Error(`pitches[${i}]: ${(err as Error).message}`);
      }
      const target = str(o.targetSearch, `pitches[${i}].targetSearch`, { optional: true, max: 300 });
      return {
        written,
        judgement: {
          topics: [],
          // Only one of the plan's searches counts; anything else is dropped.
          targetSearch: targets.find((t) => t.toLowerCase() === target.toLowerCase()) ?? "",
          timely: o.timely === true,
          expiresAt: str(o.expiresAt, "expiresAt", { optional: true, max: 10 }),
          answersGap: str(o.answersGap, "answersGap", { optional: true, max: 300 }),
          demand: str(o.demand, "demand", { optional: true, max: 300 }),
          duplicateOf: "",
          replacesFlagged: "",
        },
      };
    });
  };
}

export const FIRST_PITCH_SYSTEM = `${PITCHER_SYSTEM}
Today you write as the Strategist: you just proposed this tenant's plan, and you write its first pitches yourself, before the plan is approved. They set the standard every later batch is held to, so each one is specific, argued and worth a busy founder's yes.`;

export interface TopicPitchPrompt {
  tenantName: string;
  website: string;
  offer: string;
  summary: string;
  topic: { name: string; low: number; high: number; why: string };
  otherTopics: string[];
  targets: { query: string; volume?: number; difficulty?: number | null; position?: number | null }[];
  n: number;
  hits: { title: string; url: string; snippet: string }[];
  claims: string;
  collections: string[];
  taste: string;
  existing: string[];
  replacing?: { title: string; angle: string; reason: string } | null;
}

export function topicPitchPrompt(p: TopicPitchPrompt): string {
  const target = (t: TopicPitchPrompt["targets"][number]) =>
    `- "${t.query}"${t.volume ? `: ${t.volume}/month` : ""}${t.difficulty != null ? `, difficulty ${t.difficulty}` : ""}${t.position != null ? `, they rank #${t.position}` : ""}`;
  return [
    `Company: ${p.tenantName}${p.website ? ` (${p.website})` : ""}.${p.offer ? ` What they sell and who buys: ${p.offer}` : ""}`,
    `Your plan for the quarter, in one line: ${p.summary}`,
    `\nThe topic: ${p.topic.name} (${p.topic.low} to ${p.topic.high} posts this quarter). Why: ${p.topic.why}`,
    p.otherTopics.length ? `The plan's other topics (someone else pitches those; don't stray into them): ${p.otherTopics.join("; ")}.` : "",
    p.targets.length ? `\nThe plan's target searches for this topic:\n${p.targets.map(target).join("\n")}` : "\nThis topic has no target search in the plan.",
    `\nWhat the tenant knows (knowledge base):\n${p.claims}`,
    `\nWhat's already ranking:\n${p.hits.map((h) => `- ${h.title} <${h.url}>: ${h.snippet}`).join("\n") || "(no search results)"}`,
    `\nAlready published or pitched (don't repeat any):\n${p.existing.slice(0, 60).map((t) => `- ${t}`).join("\n") || "(nothing yet)"}`,
    `\nCollections on this blog: ${p.collections.join(", ") || "(none)"}.`,
    `\nWhat this tenant has decided before (learn from it; their own words win):\n${p.taste}`,
    p.replacing
      ? `\nThey rejected this pitch for the topic:\n"${p.replacing.title}". Angle: ${p.replacing.angle}\nTheir reason: "${p.replacing.reason}"\nWrite ONE replacement for the same topic that answers that reason. Don't rework the rejected title.`
      : `\nWrite ${p.n} different pitches for this topic: different angles, different readers' questions. Aim each at one of the target searches where one fits, the first pitch at the topic's strongest search.`,
    `\nAnswer with JSON only:
{"pitches": [{"title": "a specific, slightly provocative title", "why": "one sentence: why this, why now", "angle": "the argument this post makes that the ranking pages don't", "audience": "who it's for and what they need", "length": "e.g. 1,000 to 1,400 words", "collection": "one of the collections", "outline": ["4 to 10 lines, each a section as a claim"], "sources": [{"url": "only URLs from the search results above", "label": "what it backs"}], "targetSearch": "one of the target searches above, exactly, or empty", "timely": false, "expiresAt": "YYYY-MM-DD when it stops being worth it, or empty", "answersGap": "one sentence when it answers a question buyers keep asking or a claim the tenant makes without backing; else empty", "demand": "one sentence of search-demand evidence from the numbers above; else empty", "learned": "${p.replacing ? "leave empty" : "one line, addressed to the tenant, naming what in their answers or plan shaped this pitch; empty if nothing did"}"}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- what a tenant sees while the Strategist works (GET /progress/strategist) ----

export const PLAN_STEPS = [
  "Read your website",
  "Looked up searches and their volumes",
  "Checked who ranks for your searches",
  "Writing the plan",
  "Checking it against the Launch rules",
] as const;

export type StepState = "done" | "running" | "waiting";

/** Steps after the rules check passed (workflows/strategist.ts). */
const AFTER_CHECK = new Set(["check watched sites", "batching", "send", "plan read", "cost"]);

/**
 * The five lines from the Strategist run's step names. `steps` are the run's
 * steps (name, and whether it finished); `status` the proposal's. Runs from
 * before the keyword step was split have one "keyword data" step for both
 * searches and rankings.
 */
export function planSteps(status: string | null, steps: { name: string; done: boolean }[]): { label: string; state: StepState }[] {
  const finished = (name: string) => steps.some((s) => s.name === name && s.done);
  const started = (pred: (n: string) => boolean) => steps.some((s) => pred(s.name));
  const split = steps.some((s) => s.name === "who ranks");
  const checked = started((n) => AFTER_CHECK.has(n));
  const done = [
    finished("gather"),
    finished("keyword data"),
    split ? finished("who ranks") : finished("keyword data"),
    // Writing ends when the draft went to the rules: passed, or sent back once.
    checked || started((n) => n.startsWith("propose (fix)")),
    checked,
  ];
  if (status === "sent" || status === "approved" || status === "superseded") done.fill(true);
  // A later line done means every earlier one is.
  for (let i = done.length - 2; i >= 0; i--) if (done[i + 1]) done[i] = true;
  const first = done.indexOf(false);
  return PLAN_STEPS.map((label, i) => ({
    label,
    state: done[i] ? "done" : status === "running" && i === first ? "running" : "waiting",
  }));
}
