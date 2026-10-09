// The Strategist's rules, as code (agents/strategist.md sections 3 to 6, and
// strategist-cold-start-and-pacing.md sections 2 and 4). Pure functions: the
// workflow (workflows/strategist.ts) gathers the facts, asks the model once,
// and uses these to size the window, cap the numbers, check the answer and
// write the weekly notes. No model call and no I/O here, so it is all tested
// in test/strategy.mjs.

import { isoWeek, quarterOf } from "./goals.js";
import { arr, obj, str } from "./model.js";

const DAY = 86_400_000;

export type ProposalKind = "onboarding" | "quarterly" | "revision";

export function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function quarterLabelOf(d: Date): string {
  return quarterOf(d).label;
}

/** The quarter after `label`. */
export function nextQuarter(label: string): string {
  const [y, q] = label.split("-Q").map(Number);
  return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
}

export function quarterBounds(label: string): { start: Date; end: Date } {
  const [y, q] = label.split("-Q").map(Number);
  return { start: new Date(Date.UTC(y, (q - 1) * 3, 1)), end: new Date(Date.UTC(y, q * 3, 1)) };
}

export interface Covers {
  from: string;
  /** Last day covered, inclusive. */
  to: string;
  weeks: number;
  prorated: boolean;
}

/** Weeks 1 to 13 of the quarter `now` is in. */
export function weekOfQuarter(now: Date): number {
  const { start } = quarterOf(now);
  return Math.min(13, Math.floor((now.getTime() - start.getTime()) / (7 * DAY)) + 1);
}

export interface Window {
  /** The quarter the goals are for. */
  quarter: string;
  covers: Covers;
  /**
   * The join-week rule (cold-start doc section 4): weeks 1 to 4 full goals,
   * 5 to 8 prorated, 9 to 13 no goals this quarter (the proposal is for the
   * next one) while a prorated Launch still publishes now.
   */
  join: "full" | "prorated" | "next_quarter";
}

/** What a proposal asked for on `now` covers. */
export function windowFor(kind: ProposalKind, now: Date, askedQuarter?: string): Window {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const current = quarterLabelOf(today);
  let quarter = askedQuarter && /^\d{4}-Q[1-4]$/.test(askedQuarter) ? askedQuarter : current;
  let join: Window["join"] = "full";
  if (kind === "onboarding" && quarter === current) {
    const week = weekOfQuarter(today);
    if (week >= 9) {
      quarter = nextQuarter(current);
      join = "next_quarter";
    } else if (week >= 5) join = "prorated";
  }
  if (kind === "quarterly" && quarter === current) quarter = nextQuarter(current);
  const { start, end } = quarterBounds(quarter);
  const from = start > today ? start : today;
  const weeks = Math.max(1, Math.round((end.getTime() - from.getTime()) / (7 * DAY)));
  const prorated = from > start;
  if (prorated && join === "full" && kind !== "onboarding") join = "prorated";
  return {
    quarter,
    covers: { from: dayOf(from), to: dayOf(new Date(end.getTime() - DAY)), weeks, prorated },
    join,
  };
}

// ---- the Launch (cold-start doc section 2) ----

export interface LaunchPlan {
  startsOn: string;
  /** Posts produced in the first 20 days and published over 30. */
  target: number;
  floor: number;
  ceiling: number;
  produceByDay: number;
  publishOverDays: number;
  dayOne: { briefs: number; drafted: number };
  /** True when the tenant joined in weeks 9 to 13: sized to the days left. */
  prorated: boolean;
}

/** A new tenant's Launch. Joining in weeks 9 to 13: 15 × days left ÷ 30, at most 15, at least 3. */
export function launchFor(now: Date, join: Window["join"]): LaunchPlan {
  const startsOn = dayOf(now);
  if (join !== "next_quarter") {
    return { startsOn, target: 15, floor: 12, ceiling: 20, produceByDay: 20, publishOverDays: 30, dayOne: { briefs: 8, drafted: 3 }, prorated: false };
  }
  const { end } = quarterOf(now);
  const daysLeft = Math.max(0, Math.round((end.getTime() - now.getTime()) / DAY));
  const target = Math.max(3, Math.min(15, Math.round((15 * daysLeft) / 30)));
  return {
    startsOn,
    target,
    floor: Math.max(3, Math.round(target * 0.8)),
    ceiling: Math.max(target, Math.round(target * 1.33)),
    produceByDay: Math.max(5, Math.round(daysLeft * (20 / 30))),
    publishOverDays: Math.max(7, daysLeft),
    dayOne: { briefs: Math.min(8, Math.max(3, target)), drafted: Math.min(3, target) },
    prorated: true,
  };
}

// ---- volume ----

/** "4", "8", "12", "16" or "16+" (onboarding's review capacity) as a number a month. */
export function reviewPerMonth(v: unknown): number {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

/**
 * The most posts the proposal may ask for (rule 1). With history: last
 * quarter's real output plus 20%, scaled to the weeks covered. Day one: what
 * the team can review a month, and no more than 2 a week.
 */
export function volumeCap(o: { weeks: number; perMonth: number; lastQuarterPublished: number | null }): number {
  if (o.lastQuarterPublished !== null && o.lastQuarterPublished > 0) {
    return Math.max(1, Math.floor(o.lastQuarterPublished * 1.2 * Math.min(1, o.weeks / 13)));
  }
  const byReview = Math.floor((o.perMonth * o.weeks) / 4.33);
  return Math.max(1, Math.min(byReview, 2 * o.weeks));
}

/** How many batches the covered weeks make (cadence: weekly over the first two months, or one flood). */
export function batchCount(cadence: "weekly" | "flood", weeks: number): number {
  if (cadence === "flood") return 1;
  return Math.max(1, Math.min(weeks, 9) - 1); // a double batch at the start counts once
}

// ---- the model's answer ----

export interface Reasoned<T> {
  value: T;
  why: string;
  basis: string;
}

export interface ProposedTopic {
  name: string;
  low: number;
  high: number;
  why: string;
  basis: string;
}

export interface ProposedSearch {
  query: string;
  topic: string;
  why: string;
  volume?: number;
  difficulty?: number | null;
  position?: number | null;
}

export interface WatchedSite {
  url: string;
  topic: string;
  why: string;
}

/** What the model writes. The code adds the window, the Launch and the keyword numbers. */
export interface Draft {
  summary: string;
  volume: Reasoned<number>;
  topics: ProposedTopic[];
  ranking: {
    searches: ProposedSearch[];
    pageOneTarget: Reasoned<number>;
    aiMentionTarget: Reasoned<number | null>;
  };
  readership: Reasoned<number | null>;
  watchedSites: WatchedSite[];
  questions: string[];
}

/** The stored proposal (strategy_proposals.proposal), in app/src/lib/goals/types.ts Proposal's shape. */
export interface StoredProposal extends Draft {
  quarter: string;
  kind: ProposalKind;
  covers: Covers;
  join: Window["join"];
  batches: Reasoned<number>;
  launch: LaunchPlan | null;
}

function int(v: unknown, what: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number.`);
  return Math.round(n);
}

function intOrNull(v: unknown, what: string): number | null {
  return v === null || v === undefined || v === "" ? null : int(v, what);
}

function reasoned<T>(v: unknown, what: string, value: (x: unknown) => T): Reasoned<T> {
  const o = obj(v, what);
  return { value: value(o.value), why: str(o.why, `${what}.why`, { max: 400 }), basis: str(o.basis, `${what}.basis`, { max: 400 }) };
}

/** Shape check of the model's JSON (throws a sentence the model can act on). Rules come after, in `validate`. */
export function parseDraft(value: unknown): Draft {
  const o = obj(value, "The answer");
  const ranking = obj(o.ranking, "ranking");
  return {
    summary: str(o.summary, "summary", { max: 300 }),
    volume: reasoned(o.volume, "volume", (x) => int(x, "volume.value")),
    topics: arr(o.topics, "topics").map((t, i) => {
      const x = obj(t, `topics[${i}]`);
      return {
        name: str(x.name, `topics[${i}].name`, { max: 120 }),
        low: int(x.low, `topics[${i}].low`),
        high: int(x.high, `topics[${i}].high`),
        why: str(x.why, `topics[${i}].why`, { max: 400 }),
        basis: str(x.basis, `topics[${i}].basis`, { max: 400 }),
      };
    }),
    ranking: {
      searches: arr(ranking.searches, "ranking.searches").map((s, i) => {
        const x = obj(s, `ranking.searches[${i}]`);
        return {
          query: str(x.query, `ranking.searches[${i}].query`, { max: 200 }).trim(),
          topic: str(x.topic, `ranking.searches[${i}].topic`, { max: 120 }),
          why: str(x.why, `ranking.searches[${i}].why`, { max: 400 }),
        };
      }),
      pageOneTarget: reasoned(ranking.pageOneTarget, "ranking.pageOneTarget", (x) => int(x, "ranking.pageOneTarget.value")),
      aiMentionTarget: reasoned(ranking.aiMentionTarget, "ranking.aiMentionTarget", (x) => intOrNull(x, "ranking.aiMentionTarget.value")),
    },
    readership: reasoned(o.readership, "readership", (x) => intOrNull(x, "readership.value")),
    watchedSites: arr(o.watchedSites, "watchedSites").map((w, i) => {
      const x = obj(w, `watchedSites[${i}]`);
      return {
        url: str(x.url, `watchedSites[${i}].url`, { max: 2000 }).trim(),
        topic: str(x.topic, `watchedSites[${i}].topic`, { max: 120 }),
        why: str(x.why, `watchedSites[${i}].why`, { max: 400 }),
      };
    }),
    questions: arr(o.questions, "questions", { optional: true }).map((q, i) => str(q, `questions[${i}]`, { max: 300 })),
  };
}

export interface Keyword {
  keyword: string;
  volume: number;
  difficulty: number | null;
  position: number | null;
}

export interface Rules {
  volumeCap: number;
  /** The tenant has a quarter of history (published posts last quarter). */
  hasHistory: boolean;
  /** Weeks of reader data; under 4 means no Readership target. */
  readerWeeks: number;
  /** Keyword data by lower-cased query, for the winnable check. */
  keywords: Map<string, Keyword>;
  /** The searches the tenant typed at onboarding: a topic may not be one of them pasted back. */
  seedSearches?: string[];
  /** The brief is thin (a blank answer, a one-line answer, or capacity not answered): at least one question. */
  thinAnswers?: boolean;
}

/** A new domain can't win a head term in a quarter: searches a month above this need a page-two position already. */
export const NEW_DOMAIN_MAX_VOLUME = 5_000;

/** How many winnable keywords the data must hold before the proposal owes 8 searches, 6 of them with data. */
export const RICH_DATA = 20;

/**
 * A search is winnable when we're on page two, or it is easy enough and
 * searched enough (rule 5). Unknown data passes. For a new domain a head term
 * (over NEW_DOMAIN_MAX_VOLUME searches a month) is out whatever its difficulty.
 */
export function winnable(k: Keyword | undefined, o: { newDomain?: boolean } = {}): boolean {
  if (!k) return true;
  if (k.position !== null && k.position > 10 && k.position <= 20) return true;
  if (k.position !== null && k.position <= 10) return true; // already there: keeping it is a goal too
  if (o.newDomain && k.volume > NEW_DOMAIN_MAX_VOLUME) return false;
  return (k.difficulty === null || k.difficulty < 30) && k.volume >= 50;
}

/**
 * A watched site is a source that keeps publishing (a site, a blog or news
 * section), never one article: the root or one path segment, no file.
 */
/** Hosts a web search returns for a company's name that are never the company: profiles and directories. */
const NOT_A_COMPANY = new Set([
  "instagram.com", "linkedin.com", "facebook.com", "x.com", "twitter.com", "youtube.com", "tiktok.com",
  "wikipedia.org", "crunchbase.com", "g2.com", "capterra.com", "producthunt.com", "github.com", "reddit.com",
  "medium.com", "apps.apple.com", "play.google.com",
]);

/**
 * The host for a competitor typed as a bare name ("AirOps"), from the hosts a
 * web search returned in order: a host that carries the name wins
 * (airops.com), then the first that isn't ours or a profile site, else none.
 * A wrong host (the first result being Instagram) poisons the keyword data,
 * so none beats a guess.
 */
export function pickHost(name: string, hosts: string[], ourDomain: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ok = (h: string) => h.includes(".") && h !== ourDomain && !NOT_A_COMPANY.has(h.replace(/^www\./, ""));
  const named = key.length >= 3 ? hosts.find((h) => ok(h) && h.replace(/[^a-z0-9]/g, "").includes(key)) : undefined;
  return named ?? hosts.find(ok) ?? "";
}

export function looksLikeSource(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.search || /\.(pdf|docx?|pptx?)$/i.test(u.pathname)) return false;
    const segments = u.pathname.split("/").filter(Boolean);
    return segments.length <= 1;
  } catch {
    return false;
  }
}

/** Whether the onboarding answers are too thin to plan on without asking something. */
export function thinAnswers(answers: Record<string, string>, perMonthAnswered: boolean): boolean {
  if (!perMonthAnswered) return true;
  for (const key of ["offer", "searches", "watch", "upcoming"]) {
    const words = String(answers[key] ?? "").trim().split(/\s+/).filter(Boolean);
    if (key === "offer" ? words.length < 5 : words.length === 0) return true;
  }
  return false;
}

/** Every rule the draft breaks, as sentences for the model. Empty means it passes. */
export function validate(d: Draft, r: Rules): string[] {
  const errors: string[] = [];
  const topicNames = new Set(d.topics.map((t) => t.name.toLowerCase()));

  if (d.volume.value < 1) errors.push("volume.value must be at least 1.");
  if (d.volume.value > r.volumeCap) errors.push(`volume.value is ${d.volume.value}; the most allowed is ${r.volumeCap} (rule 1).`);

  if (d.topics.length < 1 || d.topics.length > 4) errors.push(`Give 1 to 4 topics (there are ${d.topics.length}).`);
  for (const t of d.topics) {
    if (t.low < 0 || t.high < t.low) errors.push(`Topic "${t.name}": low must be 0 or more and high at least low.`);
  }
  const lows = d.topics.reduce((n, t) => n + t.low, 0);
  if (lows > d.volume.value) errors.push(`The topics' low ends add up to ${lows}, more than volume ${d.volume.value} (rule 2).`);
  if (d.topics.length > 1 && d.topics[0].high < Math.max(...d.topics.map((t) => t.high))) {
    errors.push("List topics best first: the first topic gets the biggest range (rule 2).");
  }
  const seeds = new Set((r.seedSearches ?? []).map((q) => q.trim().toLowerCase()).filter(Boolean));
  for (const t of d.topics) {
    if (seeds.has(t.name.trim().toLowerCase())) {
      errors.push(`Topic "${t.name}" is one of their searches pasted back. A topic is an angle with a point of view, named the way they'd say it in a sentence (rule 2).`);
    }
  }

  const searches = d.ranking.searches;
  if (searches.length < 5 || searches.length > 10) errors.push(`Give 5 to 10 target searches (there are ${searches.length}); 10 when the data allows (rule 5).`);
  const known = [...r.keywords.values()].filter((k) => winnable(k, { newDomain: !r.hasHistory })).length;
  const withData = searches.filter((s) => r.keywords.has(s.query.toLowerCase())).length;
  if (known >= RICH_DATA && (searches.length < 8 || withData < 6)) {
    errors.push(
      `The data has ${known} winnable searches, so give at least 8 target searches with at least 6 of them from the data (there are ${searches.length}, ${withData} from the data) (rule 5).`,
    );
  }
  const seen = new Set<string>();
  for (const s of searches) {
    const q = s.query.toLowerCase();
    if (seen.has(q)) errors.push(`Search "${s.query}" is listed twice.`);
    seen.add(q);
    if (!topicNames.has(s.topic.toLowerCase())) errors.push(`Search "${s.query}" names topic "${s.topic}", which is not one of the topics.`);
    if (!winnable(r.keywords.get(q), { newDomain: !r.hasHistory })) {
      const k = r.keywords.get(q)!;
      const head = !r.hasHistory && k.volume > NEW_DOMAIN_MAX_VOLUME && (k.position === null || k.position > 20);
      errors.push(
        head
          ? `Search "${s.query}" is a head term: ${k.volume} searches a month. A new domain can't reach page one for it in a quarter; pick long-tail searches under ${NEW_DOMAIN_MAX_VOLUME} a month (rule 5).`
          : `Search "${s.query}" isn't winnable: difficulty ${k.difficulty ?? "unknown"}, ${k.volume} searches a month, ${k.position === null ? "not ranking" : `position ${k.position}`}. Pick one under difficulty 30 with 50+ searches, or one where we're on page two (rule 5).`,
      );
    }
  }
  const p1 = d.ranking.pageOneTarget.value;
  if (p1 < 0 || p1 > searches.length) errors.push(`ranking.pageOneTarget must be between 0 and the number of searches.`);
  if (!r.hasHistory && p1 > 2) errors.push(`A new domain's first quarter targets at most 2 searches on page one (rule 5); it says ${p1}.`);
  if (!r.hasHistory && d.ranking.aiMentionTarget.value !== null) {
    errors.push("No AI-mention target in a tenant's first quarter: set ranking.aiMentionTarget.value to null and say why.");
  }

  if (r.readerWeeks < 4 && d.readership.value !== null) {
    errors.push("No Readership target without 4 weeks of reader data: set readership.value to null (rule 6).");
  }

  if (d.watchedSites.length < 3 || d.watchedSites.length > 8) errors.push(`Give 3 to 8 watched sites (there are ${d.watchedSites.length}) (rule 4).`);
  for (const w of d.watchedSites) {
    if (!/^https?:\/\/[^\s/]+\.[^\s]+/.test(w.url)) errors.push(`Watched site "${w.url}" must be a full https address.`);
    else if (!looksLikeSource(w.url)) {
      errors.push(`Watched site ${w.url} is one article, not a source. Give the site, blog or news section it lives in: the root or one path segment, like https://example.com/blog (rule 4).`);
    }
    if (!topicNames.has(w.topic.toLowerCase())) errors.push(`Watched site ${w.url} names topic "${w.topic}", which is not one of the topics.`);
  }

  if (d.questions.length > 3) errors.push(`At most 3 questions (there are ${d.questions.length}).`);
  if (r.thinAnswers && d.questions.length === 0) {
    errors.push("Their answers are thin (a blank, a one-liner, or review capacity not answered): ask at least one question about what you had to assume.");
  }
  return errors;
}

/** The model's draft plus what code decides: the window, batches, the Launch, the keyword numbers. */
export function finish(
  d: Draft,
  o: { kind: ProposalKind; window: Window; cadence: "weekly" | "flood"; launch: LaunchPlan | null; keywords: Map<string, Keyword> },
): StoredProposal {
  const n = batchCount(o.cadence, o.window.covers.weeks);
  return {
    ...d,
    ranking: {
      ...d.ranking,
      searches: d.ranking.searches.map((s) => {
        const k = o.keywords.get(s.query.toLowerCase());
        return k ? { ...s, volume: k.volume, difficulty: k.difficulty, position: k.position } : { ...s, position: null };
      }),
    },
    quarter: o.window.quarter,
    kind: o.kind,
    covers: o.window.covers,
    join: o.window.join,
    batches: {
      value: n,
      why: o.cadence === "flood" ? "Your batching is set to Flood: every pitch at once." : "Weekly batches through the first two months, a double one to start.",
      basis: `Batching setting: ${o.cadence}`,
    },
    launch: o.launch,
  };
}

// ---- the weekly check (section 6) ----

export interface GoalTargets {
  volume: { total: number; topics: { name: string; low: number; high: number }[] };
  ranking?: { searches?: { query: string }[]; pageOneTarget?: number };
}

export interface WeekFacts {
  now: Date;
  /** When the goals start counting, and the end of their quarter. */
  from: Date;
  to: Date;
  published: number;
  publishedByTopic: Record<string, number>;
  /** Searches on page one, this Monday and the last two (oldest first); empty before there's data. */
  pageOneTrend: number[];
}

export interface Note {
  week: string;
  goal: "volume" | "ranking" | "readership" | "topic";
  severity: "behind" | "out_of_reach" | "trend";
  message: string;
  action: { kind: "pitch" | "revise" | "dismiss"; label: string; topic?: string; count?: number };
}

const SEVERITY = { out_of_reach: 0, behind: 1, trend: 2 } as const;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Monday's notes, worst first, at most 3. Code only; it never changes a goal. */
export function weeklyNotes(t: GoalTargets, f: WeekFacts): Note[] {
  const week = isoWeek(f.now);
  const total = Math.max(1, f.to.getTime() - f.from.getTime());
  const elapsed = Math.min(1, Math.max(0, (f.now.getTime() - f.from.getTime()) / total));
  const weeksGone = (f.now.getTime() - f.from.getTime()) / (7 * DAY);
  const weeksLeft = Math.max(0, (f.to.getTime() - f.now.getTime()) / (7 * DAY));
  const notes: Note[] = [];

  // Volume: pace = actual ÷ (target × share elapsed).
  const target = t.volume.total;
  if (target > 0 && elapsed > 0) {
    const pace = f.published / (target * elapsed);
    const left = Math.max(0, target - f.published);
    const need = weeksLeft > 0 ? left / weeksLeft : Infinity;
    const doing = weeksGone > 0 ? f.published / weeksGone : 0;
    if (left > 0 && pace < 0.85) {
      const outOfReach = doing > 0 ? need > 2 * doing : weeksGone >= 2;
      if (outOfReach) {
        notes.push({
          week,
          goal: "volume",
          severity: "out_of_reach",
          message: `Volume: ${f.published} of ${target} with ${Math.round(weeksLeft)} weeks left. You'd need ${fmt(need)} a week; you're doing ${fmt(doing)}.`,
          action: { kind: "revise", label: "Revise goals" },
        });
      } else if (weeksLeft >= 3) {
        notes.push({
          week,
          goal: "volume",
          severity: "behind",
          message: `Volume: ${f.published} of ${target} with ${Math.round(weeksLeft)} weeks left. You need ${fmt(need)} a week; you're doing ${fmt(doing)}.`,
          action: { kind: "pitch", label: `Pitch ${Math.min(3, Math.ceil(need))} more`, count: Math.min(3, Math.ceil(need)) },
        });
      }
    }
  }

  // Topics: nothing published in a topic past the halfway point.
  if (elapsed >= 0.5) {
    for (const topic of t.volume.topics) {
      if (topic.low > 0 && !(f.publishedByTopic[topic.name] ?? 0)) {
        notes.push({
          week,
          goal: "topic",
          severity: "behind",
          message: `${topic.name}: nothing published yet, and the quarter is past halfway.`,
          action: { kind: "pitch", label: `Pitch 2 on ${topic.name}`, topic: topic.name, count: 2 },
        });
      }
    }
  }

  // Ranking: only after 4 weeks, and only on the trend (down two Mondays in a row).
  const tr = f.pageOneTrend;
  if (weeksGone >= 4 && tr.length >= 3 && tr[2] < tr[1] && tr[1] < tr[0]) {
    notes.push({
      week,
      goal: "ranking",
      severity: "trend",
      message: `Ranking: searches on page one went down two weeks running (${tr.join(" → ")}).`,
      action: { kind: "dismiss", label: "Dismiss for this week" },
    });
  }

  return notes.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]).slice(0, 3);
}
