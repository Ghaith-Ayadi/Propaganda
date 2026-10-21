// The Strategist's rules, as code (agents/strategist.md sections 3 to 6, and
// strategist-cold-start-and-pacing.md sections 2 and 4). Pure functions: the
// workflow (workflows/strategist.ts) gathers the facts, asks the model once,
// and uses these to size the window, cap the numbers, check the answer and
// write the weekly notes. No model call and no I/O here, so it is all tested
// in test/strategy.mjs.

import { isoWeek, quarterOf } from "./goals.js";
import { houseTitleHits, noDashes, titleHits } from "./writing.js";
import { arr, obj, str } from "./model.js";
import { sharedIdeas } from "./motifs.js";

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
 * the team said it can review a month, and nothing else. The "no more than 2
 * a week in a first quarter" line went on 2026-10-20 (Havoc: 16 a month
 * answered, 20 posts allowed; Ayadi: the cap is their number). A run
 * recorded before keeps it (`firstQuarterLimit`), so its replay matches.
 */
export function volumeCap(o: { weeks: number; perMonth: number; lastQuarterPublished: number | null; firstQuarterLimit?: boolean }): number {
  if (o.lastQuarterPublished !== null && o.lastQuarterPublished > 0) {
    return Math.max(1, Math.floor(o.lastQuarterPublished * 1.2 * Math.min(1, o.weeks / 13)));
  }
  const byReview = Math.floor((o.perMonth * o.weeks) / 4.33);
  return Math.max(1, o.firstQuarterLimit ? Math.min(byReview, 2 * o.weeks) : byReview);
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
  /** A label of a few words (at most TOPIC_NAME_MAX characters): the key pitches and goals hang on. */
  name: string;
  /** The point of view in one sentence: what the company knows about the buyer, the market or a mechanism. Absent on proposals from before 2026-10-12. */
  thesis?: string;
  low: number;
  high: number;
  why: string;
  basis: string;
}

/**
 * Where a target search sits (rule 5, 2026-10-20): winnable now (a post can
 * reach page one this quarter), a must-win the business has to own over a
 * year or two (a position goal, not page one), or one the data has no number
 * for, kept because the intent is exact.
 */
export type SearchBucket = "now" | "later" | "nodata";

export interface ProposedSearch {
  query: string;
  topic: string;
  why: string;
  bucket?: SearchBucket;
  volume?: number;
  difficulty?: number | null;
  position?: number | null;
  referringDomains?: number | null;
  trend6?: number | null;
  peakMonth?: number | null;
  aiOverview?: boolean | null;
}

export interface WatchedSite {
  url: string;
  topic: string;
  why: string;
}

/** What the model writes. The code adds the window, the Launch and the keyword numbers. */
export interface Draft {
  /** "{Company} according to what you gave us": one paragraph on who they are, from the inputs (2026-10-20). Absent on earlier proposals. */
  profile?: string;
  /** Who ranks on page one for the reader's searches today, by kind, and what it means for the blog (2026-10-20). */
  readersFind?: string;
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

/** The bucket a model wrote, in any of its spellings ("now", "winnable now", "must win over time", "no data"); undefined when it wrote none. */
export function bucketNamed(v: string): SearchBucket | undefined {
  const k = v.trim().toLowerCase();
  if (!k) return undefined;
  if (/no.?data|unknown|unpriced/.test(k)) return "nodata";
  if (/later|must|over time|long|ambitious/.test(k)) return "later";
  if (/now|winnable|quarter/.test(k)) return "now";
  return undefined;
}

/** Shape check of the model's JSON (throws a sentence the model can act on). Rules come after, in `validate`. */
export function parseDraft(value: unknown): Draft {
  const o = obj(value, "The answer");
  const ranking = obj(o.ranking, "ranking");
  return {
    profile: str(o.profile, "profile", { optional: true, max: 1500 }).trim(),
    readersFind: str(o.readersFind, "readersFind", { optional: true, max: 1500 }).trim(),
    summary: str(o.summary, "summary", { max: 300 }),
    volume: reasoned(o.volume, "volume", (x) => int(x, "volume.value")),
    topics: arr(o.topics, "topics").map((t, i) => {
      const x = obj(t, `topics[${i}]`);
      return {
        // Not cut here: validate() sends a long name back with the rule, so the model shortens it instead of a trim losing the end.
        name: str(x.name, `topics[${i}].name`, { max: 400 }).trim(),
        thesis: str(x.thesis, `topics[${i}].thesis`, { optional: true, max: 600 }).trim(),
        low: int(x.low, `topics[${i}].low`),
        high: int(x.high, `topics[${i}].high`),
        why: str(x.why, `topics[${i}].why`, { max: 400 }),
        basis: str(x.basis, `topics[${i}].basis`, { max: 400 }),
      };
    }),
    ranking: {
      searches: arr(ranking.searches, "ranking.searches").map((s, i) => {
        const x = obj(s, `ranking.searches[${i}]`);
        const bucket = bucketNamed(str(x.bucket, `ranking.searches[${i}].bucket`, { optional: true, max: 40 }));
        return {
          query: str(x.query, `ranking.searches[${i}].query`, { max: 200 }).trim(),
          topic: str(x.topic, `ranking.searches[${i}].topic`, { max: 120 }),
          why: str(x.why, `ranking.searches[${i}].why`, { max: 400 }),
          ...(bucket ? { bucket } : {}),
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
  /** Monthly searches; null when the data has no number (never 0 for unknown). */
  volume: number | null;
  difficulty: number | null;
  position: number | null;
  /** Distinct sites linking to an average page-one result; absent or null without SERP info. */
  referringDomains?: number | null;
  trend6?: number | null;
  peakMonth?: number | null;
  intent?: string | null;
  aiOverview?: boolean | null;
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
  /** Questions earlier rounds asked that the person answered: settled, never asked again. */
  answered?: Answered[];
  /** The previous proposal's topic names (a revision): kept unless the request is about the topics. */
  previousTopics?: string[];
  /** The revision's request talks about the topics, so renaming them is what was asked. */
  requestAboutTopics?: boolean;
  /** The titles of the posts on their own blog: a topic is never one of them retitled (2026-10-21). */
  theirPosts?: string[];
  /** Topic names are held to the title rules (false on a run recorded before them: replays must match). */
  titleRules?: boolean;
  /** The twenty rules' hard checks (an em dash, "the hard part is") on topic names too (false on a run recorded before them). */
  houseStyle?: boolean;
  /** A topic is a short name plus a thesis (2026-10-12); false on a run recorded before, whose draft has no thesis. */
  thesis?: boolean;
  /** One idea in one topic at most (2026-10-14); false on a run recorded before. */
  motifs?: boolean;
  /** A topic's name may borrow a site headline; only the thesis is held to it (2026-10-18). False on a run recorded before. */
  headlineNames?: boolean;
  /** Sentences and headings from the tenant's own site: a name or thesis that repeats one is their slogan, not an angle. */
  siteSentences?: string[];
  /**
   * Searches first (2026-10-20): 15 to 20 target searches in three buckets, up
   * to 8 topics, a profile paragraph, watched sites from who ranks, an AI
   * target allowed from the start. False on a run recorded before (replays).
   */
  searchesFirst?: boolean;
  /** Lower-cased queries that are never a target: the company's own names, and pages it hosts for customers. */
  notTargets?: string[];
  /** Registrable domains that rank for the reader's searches today (institutions, not forums or video), for the watched-sites check. */
  whoRanks?: string[];
}

/** Topics since 2026-10-20: as many as the company has distinct things to say, up to this many (4 before). */
export const TOPICS_MAX = 8;

/** A topic name is a label: this many characters at most, and at most TOPIC_NAME_MAX_WORDS words. */
export const TOPIC_NAME_MAX = 60;
export const TOPIC_NAME_MAX_WORDS = 8;
/** A thesis is one sentence. */
export const THESIS_MAX = 220;

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
  if (!k || k.volume === null) return true;
  if (k.position !== null && k.position > 10 && k.position <= 20) return true;
  if (k.position !== null && k.position <= 10) return true; // already there: keeping it is a goal too
  if (o.newDomain && k.volume > NEW_DOMAIN_MAX_VOLUME) return false;
  // Page one's links say more than the difficulty score: a government page scores easy and is not (Havoc, 2026-10-20).
  if (typeof k.referringDomains === "number" && k.referringDomains >= WINNABLE_MAX_LINKS) return false;
  return (k.difficulty === null || k.difficulty < 30) && k.volume >= 50;
}

/** Page one averaging this many referring domains or more is a year's work, not a quarter's. */
export const WINNABLE_MAX_LINKS = 30;
/** A must-win (rule 5): searched at least this much, and page one under MUST_WIN_MAX_LINKS referring domains or difficulty at most MUST_WIN_MAX_DIFFICULTY. */
export const MUST_WIN_MIN_VOLUME = 200;
export const MUST_WIN_MAX_LINKS = 100;
export const MUST_WIN_MAX_DIFFICULTY = 50;
/** Past this many referring domains on page one, no difficulty score makes a search a must-win: it belongs to the big sites. */
export const MUST_WIN_HARD_LINKS = 300;

/**
 * A search the business has to own over a year or two: big enough to matter
 * and not beyond a blog (rule 5). Winnable-now searches qualify too; the
 * bucket is the model's call between the two.
 */
export function mustWin(k: Keyword | undefined): boolean {
  if (!k || k.volume === null || k.volume < MUST_WIN_MIN_VOLUME) return false;
  if (k.position !== null && k.position <= 20) return true;
  const links = typeof k.referringDomains === "number" ? k.referringDomains : null;
  if (links !== null && links <= MUST_WIN_MAX_LINKS) return true;
  return k.difficulty !== null && k.difficulty <= MUST_WIN_MAX_DIFFICULTY && (links === null || links <= MUST_WIN_HARD_LINKS);
}

/** The bucket the data puts a search in; null when it is a target in none (too hard, or too small for a must-win). */
export function bucketOf(k: Keyword | undefined, o: { newDomain?: boolean } = {}): SearchBucket | null {
  if (!k || k.volume === null) return "nodata";
  if (winnable(k, o)) return "now";
  if (mustWin(k)) return "later";
  return null;
}

/** Rule 5's counts. */
export const SEARCHES_MIN = 15;
export const SEARCHES_MAX = 20;
export const NOW_MAX = 15;
export const LATER_MIN = 3;
export const LATER_MAX = 5;
export const NODATA_MAX = 3;

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
 * A host's registrable site: the company's site, not its app or docs host
 * (app.airops.com ranks for "airops login", airops.com for what they write
 * about). A country second-level domain keeps three labels (acme.co.uk).
 */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().split(".");
  if (parts.length <= 2) return parts.join(".");
  const second = parts[parts.length - 2]!;
  const tld = parts[parts.length - 1]!;
  const keep = tld.length === 2 && ["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc"].includes(second) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

/**
 * The host for a competitor typed as a bare name ("AirOps"), from the hosts a
 * web search returned in order: a host that carries the name wins
 * (airops.com), then the first that isn't ours or a profile site, else none.
 * A wrong host (the first result being Instagram) poisons the keyword data,
 * so none beats a guess.
 */
export function pickHost(name: string, hosts: string[], ourDomain: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ok = (h: string) => h.includes(".") && siteOf(h) !== ourDomain && h !== ourDomain && !NOT_A_COMPANY.has(siteOf(h));
  const label = (h: string) => siteOf(h).split(".")[0]!.replace(/[^a-z0-9]/g, "");
  if (key.length >= 3) {
    // "Box" is box.com before dropbox.com: the exact label wins over a host that merely contains the name.
    const exact = hosts.find((h) => ok(h) && label(h) === key);
    const named = exact ?? hosts.find((h) => ok(h) && h.replace(/[^a-z0-9]/g, "").includes(key));
    if (named) return siteOf(named);
  }
  const first = hosts.find(ok);
  return first ? siteOf(first) : "";
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

/**
 * Nothing to plan from: no website, every onboarding answer blank, no plan
 * dropped and no posts. A run on that would only reflect the product's own
 * rules back as the company's strategy (PPGD on prod, 2026-10-10), so the
 * workflow stops before the model call and says what to answer first.
 */
export function emptyBrief(o: { website: string; answers: Record<string, string>; planText: string; planFiles: number; published: number }): boolean {
  if (o.website.trim() || o.planText.trim() || o.planFiles > 0 || o.published > 0) return false;
  return ["offer", "searches", "watch", "upcoming"].every((key) => !String(o.answers[key] ?? "").trim());
}

/**
 * Revisions a quarter's plan can take. The tenant never sees a number; this is
 * the server-side limit behind the UI's (app gettingStarted/state.ts MAX_ROUNDS,
 * keep them equal), so a direct call can't run the Strategist without end.
 */
export const MAX_PLAN_ROUNDS = 12;
export const ROUND_LIMIT_ERROR = "This plan has been revised as many times as it can be here. Approve it as it is; you can change it any time on Goals.";

export const EMPTY_BRIEF_ERROR =
  "Nothing to plan from yet: no website, no onboarding answers, no plan and no posts. Answer the onboarding questions (your website, what you sell, the searches you want to be found by) and run the Strategist again.";

/**
 * The kind of proposal a run really is: a tenant with no published history
 * and no approved goals is onboarding whatever button asked for the run (a
 * by-hand run from the Goals page asks for a revision), so its first
 * proposal carries the Launch.
 */
export function effectiveKind(asked: ProposalKind, o: { hasHistory: boolean; hasGoals: boolean }): ProposalKind {
  return !o.hasHistory && !o.hasGoals ? "onboarding" : asked;
}

// ---- revision rounds: what was asked and answered, and the topics' names ----

export interface Answered {
  question: string;
  answer: string;
}

/**
 * The answers a revision's request carries, in the app's format
 * ("Answers to your questions:" then "N. question" and the answer on the
 * next lines). Any other request text parses to nothing.
 */
export function parseAnswers(request: string): Answered[] {
  const text = String(request ?? "");
  if (!/answers to your questions:/i.test(text)) return [];
  const body = text.slice(text.search(/answers to your questions:/i)).replace(/^[^\n]*\n/, "");
  const out: Answered[] = [];
  for (const block of body.split(/\n(?=\d+\.\s)/)) {
    const m = block.match(/^\d+\.\s*([^\n]*)\n?([\s\S]*)$/);
    if (!m) continue;
    const question = m[1].trim();
    const answer = m[2].trim();
    if (question && answer) out.push({ question, answer });
  }
  return out;
}

const STOP = new Set("a an the and or of to in on for with your you we our us it its is are be can do does how many much what which who when where why will would should could this that these those as at by from into than then there their them they so if not no yes about per each every one any all some more most also just".split(" "));

/** The words that carry a question's meaning. */
function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** The two questions ask the same thing (half their meaningful words in common). */
export function sameQuestion(a: string, b: string): boolean {
  return jaccard(contentWords(a), contentWords(b)) >= 0.5;
}

const CAPACITY = /\b(review|reviewer|posts? (a|per) month|a month|per month|capacity|how many posts)\b/i;

/**
 * Review capacity from an answered question about it: the first number in
 * the answer, read per month ("2 a week" is 8). Null when no answer says.
 */
export function perMonthFromAnswers(answered: Answered[]): number | null {
  for (const { question, answer } of answered) {
    if (!CAPACITY.test(question)) continue;
    const m = answer.match(/(\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    const weekly = /\b(a|per|each|every)\s+week\b|weekly/i.test(answer) && !/\bmonth/i.test(answer);
    return weekly ? Math.round(n * 4.33) : n;
  }
  return null;
}

const normTopic = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// ---- claims: a site's sentences, a repeated slogan, two topics saying one thing ----

/** Lower-cased letters, digits and single spaces: what "the same words" means here. */
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A word's rough stem (jobs, job; retries, retry; writing, write), so a plural or a tense is the same word. */
function stem(w: string): string {
  if (w.length <= 3) return w;
  return w.replace(/ies$/, "y").replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2)).replace(/ing$/, "").replace(/ed$/, "").replace(/s$/, "");
}

/** The content words of `s` as stems, two letters at least ("ai" counts), stop words out. */
function stems(s: string): Set<string> {
  return new Set(
    plain(s)
      .split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map(stem),
  );
}

/**
 * The sentences and headings of a site's pages as text, 4 to 40 words each,
 * once each however often the site repeats them. What a topic name or thesis
 * is held against: marketing copy carries its emphasis into the text, and a
 * headline read as the company's one belief is the tar pit this guards.
 */
export function siteSentences(texts: string[]): string[] {
  const out = new Map<string, string>();
  for (const text of texts) {
    for (const raw of String(text ?? "").split(/(?<=[.!?])\s+|\n+|\s+\|\s+|\s+·\s+/)) {
      const sentence = raw.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
      const n = sentence.split(" ").length;
      if (n < 4 || n > 40) continue;
      const key = plain(sentence);
      if (key && !out.has(key)) out.set(key, sentence);
    }
  }
  return [...out.values()];
}

/**
 * True when `text` repeats one of the site's sentences: the normalised text
 * contains a sentence or is contained in one, or shares four fifths of its
 * content words with one. Three content words at least, so a short label
 * made of ordinary words ("Pricing pages") never trips it.
 */
export function echoesSite(text: string, sentences: string[]): boolean {
  const norm = plain(text);
  const words = contentWords(text);
  if (words.size < 3) return false;
  for (const s of sentences) {
    const sn = plain(s);
    if (!sn) continue;
    if (sn.length >= 20 && (norm.includes(sn) || sn.includes(norm))) return true;
    const sw = contentWords(s);
    let shared = 0;
    for (const w of words) if (sw.has(w)) shared++;
    if (shared / words.size >= 0.8) return true;
  }
  return false;
}

/** Two topics whose name and thesis share most of their content words are one claim said twice. */
export function sameClaim(a: { name: string; thesis?: string }, b: { name: string; thesis?: string }): boolean {
  const wa = stems(`${a.name} ${a.thesis ?? ""}`);
  const wb = stems(`${b.name} ${b.thesis ?? ""}`);
  if (wa.size < 3 || wb.size < 3) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.6;
}

// ---- search seeds and the keyword pull ----

/**
 * The searches a tenant typed, as seeds a keyword endpoint can use: short
 * phrases only. A sentence ("I don't know what searches I want... something
 * about AI content publishing") seeds a category dump, so it is dropped.
 */
export function searchSeeds(lines: string[], max = 5): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const seed = raw.replace(/[.!?…]+$/g, "").trim();
    const words = seed.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5) continue;
    if (/\b(i|we|you|know|want|tell|maybe|don't|dont)\b/i.test(seed)) continue;
    const key = seed.toLowerCase();
    if (out.some((s) => s.toLowerCase() === key)) continue;
    out.push(seed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The rows of a keyword pull worth showing: each carries two of the seeds'
 * words, or one of them and a word from what the tenant sells, or two words
 * from the offer; ordered by how many seed words it carries, then volume, once
 * each. A pull around "AI CMS" otherwise comes back as every "ai" search there
 * is ("character ai", 2,000,000 a month), which no new domain can use.
 */
export function relevantKeywords<K extends { keyword: string; volume: number | null }>(rows: K[], seeds: string[], offer = "", limit = 100): K[] {
  const seedWords = new Set<string>();
  for (const s of seeds) for (const w of stems(s)) seedWords.add(w);
  const offerWords = stems(offer);
  const seen = new Set<string>();
  const scored: { row: K; score: number }[] = [];
  for (const row of rows) {
    const key = row.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let fromSeeds = 0;
    let fromOffer = 0;
    for (const w of stems(key)) {
      if (seedWords.has(w)) fromSeeds++;
      else if (offerWords.has(w)) fromOffer++;
    }
    // A one-word seed ("cms") is matched whole; two seed words otherwise.
    const enough = fromSeeds >= Math.min(2, seedWords.size) || (fromSeeds >= 1 && fromOffer >= 1) || fromOffer >= 2;
    if (enough) scored.push({ row, score: fromSeeds * 2 + fromOffer });
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.row.volume ?? 0) - (a.row.volume ?? 0))
    .slice(0, limit)
    .map((x) => x.row);
}

/**
 * The previous proposal's name for each topic the revision kept. Pitches
 * hang on a topic's exact name, so a reworded name withdraws and re-pitches
 * all of them. A new topic is the same as a previous one when it says the
 * same (two fifths of their meaningful words in common, or one inside the
 * other); each previous name is used once, best match first. Searches and
 * watched sites follow the renamed topic.
 */
export function keepTopicNames<D extends Draft>(d: D, previous: string[]): D {
  if (!previous.length) return d;
  const prevWords = previous.map((p) => ({ name: p, norm: normTopic(p), words: contentWords(p) }));
  const pairs: { i: number; p: number; score: number }[] = [];
  d.topics.forEach((t, i) => {
    const norm = normTopic(t.name);
    const words = contentWords(t.name);
    prevWords.forEach((p, j) => {
      let score = 0;
      if (p.norm === norm) score = 2;
      else if (p.norm.includes(norm) || norm.includes(p.norm)) score = 1;
      else score = jaccard(words, p.words);
      if (score >= 0.4) pairs.push({ i, p: j, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const rename = new Map<string, string>();
  const usedTopic = new Set<number>();
  const usedPrev = new Set<number>();
  for (const { i, p } of pairs) {
    if (usedTopic.has(i) || usedPrev.has(p)) continue;
    usedTopic.add(i);
    usedPrev.add(p);
    if (d.topics[i].name !== prevWords[p].name) rename.set(d.topics[i].name, prevWords[p].name);
  }
  if (!rename.size) return d;
  const to = (name: string) => rename.get(name) ?? name;
  return {
    ...d,
    topics: d.topics.map((t) => ({ ...t, name: to(t.name) })),
    ranking: { ...d.ranking, searches: d.ranking.searches.map((s) => ({ ...s, topic: to(s.topic) })) },
    watchedSites: d.watchedSites.map((w) => ({ ...w, topic: to(w.topic) })),
  };
}

/**
 * Whether a revision's request asks about the topics themselves, so renaming
 * them is what was asked. The questions echoed back in an answers block
 * ("1. Should v2 get its own topic?") don't count; only what the tenant wrote.
 */
export function asksAboutTopics(request: string): boolean {
  const own = String(request ?? "")
    .split("\n")
    .filter((line) => !/^\d+\.\s/.test(line.trim()) && !/answers to your questions:/i.test(line))
    .join("\n");
  return /\b(topics?|angles?|themes?|rename|pillars?)\b/i.test(own);
}

/** Every rule the draft breaks, as sentences for the model. Empty means it passes. */
/** Words a title carries that say nothing about what it is about. */
const TITLE_NOISE = new Set(["a", "an", "the", "of", "for", "to", "in", "on", "at", "and", "or", "with", "your", "our", "is", "are", "how", "what", "why", "when", "that", "this", "it", "its", "from", "by", "vs"]);

/** A title's words that carry meaning, lower-cased, numbers kept. */
function titleWords(s: string): string[] {
  return s.toLowerCase().replace(/[\u2019']s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !TITLE_NOISE.has(w));
}

/**
 * True when a topic's name is one of their posts retitled: the same words, or
 * one inside the other with at least three words in common. Catches a copied
 * title, not a copied idea; the prompt's rule covers the rest.
 */
export function restatesPost(name: string, post: string): boolean {
  const a = new Set(titleWords(name));
  const b = new Set(titleWords(post));
  if (!a.size || !b.size) return false;
  const shared = [...a].filter((w) => b.has(w)).length;
  if (shared === a.size && shared === b.size) return true;
  return shared >= 3 && (shared === a.size || shared === b.size);
}

export function validate(d: Draft, r: Rules): string[] {
  const errors: string[] = [];
  const topicNames = new Set(d.topics.map((t) => t.name.toLowerCase()));
  for (const t of d.topics) {
    const hit = (r.theirPosts ?? []).find((p) => restatesPost(t.name, p));
    if (hit) errors.push(`Topic "${t.name}" is their post "${hit}" retitled: their blog already has it (rule 2). Build on it (the thesis says what the new posts add) or drop it.`);
  }

  if (d.volume.value < 1) errors.push("volume.value must be at least 1.");
  if (d.volume.value > r.volumeCap) errors.push(`volume.value is ${d.volume.value}; the most allowed is ${r.volumeCap} (rule 1).`);

  const topicMax = r.searchesFirst ? TOPICS_MAX : 4;
  if (d.topics.length < 1 || d.topics.length > topicMax) errors.push(`Give 1 to ${topicMax} topics (there are ${d.topics.length}).`);
  if (r.searchesFirst && !(d.profile ?? "").trim()) errors.push("profile is missing: one paragraph headed by their name on who they are, what they sell and to whom, how they grow and who they are up against, from their answers, their site and the data.");
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
    // A kept name from the previous proposal is never sent back: pitches hang on it.
    const kept = (r.previousTopics ?? []).includes(t.name);
    if (r.titleRules !== false && !kept) {
      for (const h of (r.houseStyle ? houseTitleHits : titleHits)(t.name)) errors.push(`Topic "${t.name}" breaks the title rules (${h.rule}): name it as one plain statement, no colon, no dash, no second half, no negation (rule 2).`);
    }
    if (r.thesis) {
      const words = t.name.split(/\s+/).filter(Boolean).length;
      if (!kept && (t.name.length > TOPIC_NAME_MAX || words > TOPIC_NAME_MAX_WORDS)) {
        errors.push(`Topic "${t.name}" is ${t.name.length} characters and ${words} words. A topic's name is a label of 2 to 6 words, at most ${TOPIC_NAME_MAX} characters; the point of view goes in its thesis (rule 2).`);
      }
      const thesis = (t.thesis ?? "").trim();
      if (!thesis) errors.push(`Topic "${t.name}" has no thesis. Give one sentence: what this company knows about the buyer, the market or how things work that a quarter of posts can show (rule 2).`);
      else {
        if (thesis.length > THESIS_MAX) errors.push(`Topic "${t.name}": the thesis is ${thesis.length} characters; one sentence, at most ${THESIS_MAX} (rule 2).`);
        if (r.titleRules !== false) for (const h of (r.houseStyle ? houseTitleHits : titleHits)(thesis)) errors.push(`Topic "${t.name}": the thesis breaks the title rules (${h.rule}): one plain sentence, no colon, no dash, no second half, no negation (rule 2).`);
        if (echoesSite(thesis, r.siteSentences ?? [])) errors.push(`Topic "${t.name}": the thesis repeats a sentence from their own site. That is their positioning, not a thesis; say what they know about the buyer or the market that the site only implies (rule 2).`);
      }
      if (!kept && !r.headlineNames && echoesSite(t.name, r.siteSentences ?? [])) errors.push(`Topic "${t.name}" is a sentence from their own site. Their slogan is never a topic; name the angle in a few words (rule 2).`);
    }
  }
  if (r.motifs && d.topics.length >= 3) {
    const kept = (t: { name: string }) => (r.previousTopics ?? []).includes(t.name);
    for (const m of sharedIdeas(d.topics.map((t) => `${t.name}. ${t.thesis ?? ""}`), { max: Math.max(2, Math.floor(d.topics.length / 2)), own: r.seedSearches ?? [] })) {
      if (!m.items.some((i) => !kept(d.topics[i]))) continue;
      errors.push(`The idea "${m.word}" runs through ${m.items.length} topics (${m.items.map((i) => `"${d.topics[i].name}"`).join(", ")}). One idea belongs to one topic, and it is in most of them: keep it in the strongest and make the others about something else the buyer needs (rule 2).`);
    }
  }
  if (r.thesis) {
    for (let i = 0; i < d.topics.length; i++) {
      for (let j = i + 1; j < d.topics.length; j++) {
        if (sameClaim(d.topics[i], d.topics[j])) errors.push(`Topics "${d.topics[i].name}" and "${d.topics[j].name}" make the same claim. Each topic is a different thing they know; merge these or replace one (rule 2).`);
      }
    }
  }

  const searches = d.ranking.searches;
  const newDomain = !r.hasHistory;
  const notTargets = new Set((r.notTargets ?? []).map((q) => q.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  if (r.searchesFirst) {
    // Rule 5 since 2026-10-20: 15 to 20 searches in three buckets. The floor
    // follows the data: a niche DataForSEO barely prices can't fill 15 rows.
    const priced = [...r.keywords.entries()].filter(([q, k]) => k.volume !== null && !notTargets.has(q));
    const candidates = priced.filter(([, k]) => bucketOf(k, { newDomain }) !== null).length;
    const min = Math.min(SEARCHES_MIN, Math.max(5, candidates));
    if (searches.length < min || searches.length > SEARCHES_MAX) {
      errors.push(`Give ${min} to ${SEARCHES_MAX} target searches (there are ${searches.length}): 10 to 15 winnable now, 3 to 5 must-wins, at most 3 with no data (rule 5).`);
    }
    // The must-wins the data offers: big searches a post can't win this quarter (a winnable one may be marked "later" too, but is never owed).
    const laterCandidates = priced.filter(([, k]) => mustWin(k) && !winnable(k, { newDomain })).length;
    const count = { now: 0, later: 0, nodata: 0 };
    for (const s of searches) {
      const q = s.query.toLowerCase();
      if (seen.has(q)) errors.push(`Search "${s.query}" is listed twice.`);
      seen.add(q);
      if (!topicNames.has(s.topic.toLowerCase())) errors.push(`Search "${s.query}" names topic "${s.topic}", which is not one of the topics.`);
      if (notTargets.has(q)) {
        errors.push(`Search "${s.query}" is the company's own name or a page it hosts for a customer: never a target, however well it ranks (rule 5). Drop it.`);
        continue;
      }
      const k = r.keywords.get(q);
      const fits = bucketOf(k, { newDomain });
      const bucket = s.bucket ?? fits ?? "now";
      count[bucket]++;
      const facts = k && k.volume !== null ? `${k.volume} searches a month, difficulty ${k.difficulty ?? "unknown"}${typeof k.referringDomains === "number" ? `, page one averages ${k.referringDomains} referring domains` : ""}` : "no data";
      if (bucket === "nodata" && k && k.volume !== null) errors.push(`Search "${s.query}" has data (${facts}); its bucket is not "nodata" (rule 5).`);
      else if (bucket === "now" && fits !== "now") {
        errors.push(
          fits === "nodata"
            ? `Search "${s.query}" has no data; its bucket is "nodata" (rule 5).`
            : fits === "later"
              ? `Search "${s.query}" is not winnable this quarter (${facts}): page one needs under ${WINNABLE_MAX_LINKS} referring domains and difficulty under 30. It fits "later", a must-win with a position goal (rule 5).`
              : `Search "${s.query}" is beyond a blog post (${facts}): winnable now means difficulty under 30 and page one under ${WINNABLE_MAX_LINKS} referring domains, or page two already; a must-win needs ${MUST_WIN_MIN_VOLUME}+ searches with page one under ${MUST_WIN_MAX_LINKS} referring domains, or difficulty at most ${MUST_WIN_MAX_DIFFICULTY} with page one under ${MUST_WIN_HARD_LINKS} (rule 5). Drop it.`,
        );
      } else if (bucket === "later" && fits !== "later" && fits !== "now") {
        errors.push(
          fits === "nodata"
            ? `Search "${s.query}" has no data; its bucket is "nodata" (rule 5).`
            : `Search "${s.query}" is not a must-win (${facts}): a must-win has ${MUST_WIN_MIN_VOLUME}+ searches a month with page one under ${MUST_WIN_MAX_LINKS} referring domains, or difficulty at most ${MUST_WIN_MAX_DIFFICULTY} with page one under ${MUST_WIN_HARD_LINKS} (rule 5). Drop it.`,
        );
      }
    }
    if (count.now > NOW_MAX) errors.push(`${count.now} searches are winnable now; at most ${NOW_MAX} (rule 5).`);
    if (count.nodata > NODATA_MAX) errors.push(`${count.nodata} searches have no data; at most ${NODATA_MAX} (rule 5).`);
    if (count.later > LATER_MAX) errors.push(`${count.later} must-win searches; at most ${LATER_MAX} (rule 5).`);
    const laterMin = Math.min(LATER_MIN, laterCandidates);
    if (count.later < laterMin) {
      errors.push(`The data holds ${laterCandidates} searches the business has to own over time (${MUST_WIN_MIN_VOLUME}+ a month, page one under ${MUST_WIN_MAX_LINKS} referring domains or difficulty at most ${MUST_WIN_MAX_DIFFICULTY}); give ${laterMin} to ${LATER_MAX} of them as "later", each with a position goal in its why (rule 5). There are ${count.later}.`);
    }
    const p1 = d.ranking.pageOneTarget.value;
    if (p1 < 0 || p1 > Math.max(count.now, 0)) errors.push(`ranking.pageOneTarget must be between 0 and the number of winnable-now searches (${count.now}).`);
    if (newDomain && p1 > 2) errors.push(`A new domain's first quarter targets at most 2 searches on page one (rule 5); it says ${p1}.`);
    const ai = d.ranking.aiMentionTarget.value;
    const withOverview = searches.filter((s) => r.keywords.get(s.query.toLowerCase())?.aiOverview === true).length;
    const known = searches.some((s) => typeof r.keywords.get(s.query.toLowerCase())?.aiOverview === "boolean");
    if (ai !== null) {
      const most = known ? Math.min(withOverview, newDomain ? 3 : searches.length) : newDomain ? 3 : searches.length;
      if (ai < 0 || ai > most) {
        errors.push(
          known
            ? `ranking.aiMentionTarget is ${ai}; ${withOverview} of the target searches show an AI overview${newDomain ? ", and a new domain aims for 1 to 3" : ""}, so at most ${most} (rule 5).`
            : `ranking.aiMentionTarget is ${ai}; at most ${most} (rule 5).`,
        );
      }
      if (known && withOverview === 0) errors.push("None of the target searches shows an AI overview: set ranking.aiMentionTarget.value to null and say why (rule 5).");
    }
  } else {
    if (searches.length < 5 || searches.length > 10) errors.push(`Give 5 to 10 target searches (there are ${searches.length}); 10 when the data allows (rule 5).`);
    const known = [...r.keywords.values()].filter((k) => winnable(k, { newDomain })).length;
    const withData = searches.filter((s) => r.keywords.has(s.query.toLowerCase())).length;
    if (known >= RICH_DATA && (searches.length < 8 || withData < 6)) {
      errors.push(
        `The data has ${known} winnable searches, so give at least 8 target searches with at least 6 of them from the data (there are ${searches.length}, ${withData} from the data) (rule 5).`,
      );
    }
    for (const s of searches) {
      const q = s.query.toLowerCase();
      if (seen.has(q)) errors.push(`Search "${s.query}" is listed twice.`);
      seen.add(q);
      if (!topicNames.has(s.topic.toLowerCase())) errors.push(`Search "${s.query}" names topic "${s.topic}", which is not one of the topics.`);
      if (!winnable(r.keywords.get(q), { newDomain })) {
        const k = r.keywords.get(q)!;
        const head = newDomain && (k.volume ?? 0) > NEW_DOMAIN_MAX_VOLUME && (k.position === null || k.position > 20);
        errors.push(
          head
            ? `Search "${s.query}" is a head term: ${k.volume} searches a month. A new domain can't reach page one for it in a quarter; pick long-tail searches under ${NEW_DOMAIN_MAX_VOLUME} a month (rule 5).`
            : `Search "${s.query}" isn't winnable: difficulty ${k.difficulty ?? "unknown"}, ${k.volume} searches a month, ${k.position === null ? "not ranking" : `position ${k.position}`}. Pick one under difficulty 30 with 50+ searches, or one where we're on page two (rule 5).`,
        );
      }
    }
    const p1 = d.ranking.pageOneTarget.value;
    if (p1 < 0 || p1 > searches.length) errors.push(`ranking.pageOneTarget must be between 0 and the number of searches.`);
    if (newDomain && p1 > 2) errors.push(`A new domain's first quarter targets at most 2 searches on page one (rule 5); it says ${p1}.`);
    if (newDomain && d.ranking.aiMentionTarget.value !== null) {
      errors.push("No AI-mention target in a tenant's first quarter: set ranking.aiMentionTarget.value to null and say why.");
    }
  }

  if (r.readerWeeks < 4 && d.readership.value !== null) {
    errors.push("No Readership target without 4 weeks of reader data: set readership.value to null (rule 6).");
  }

  if (d.watchedSites.length < 3 || d.watchedSites.length > 8) errors.push(`Give 3 to 8 watched sites (there are ${d.watchedSites.length}) (rule 4).`);
  const ranking = (r.whoRanks ?? []).map(siteOf).filter(Boolean);
  if (r.searchesFirst && ranking.length) {
    // The sites the reader finds today (regulators, state agencies, trade bodies) come before the competitors they named (rule 4).
    const need = Math.min(3, ranking.length);
    const from = d.watchedSites.filter((w) => {
      try {
        return ranking.includes(siteOf(new URL(w.url).hostname));
      } catch {
        return false;
      }
    }).length;
    if (from < need) {
      errors.push(`Only ${from} watched site${from === 1 ? "" : "s"} ${from === 1 ? "is" : "are"} among those that rank for the reader's searches today (${ranking.slice(0, 8).join(", ")}); take at least ${need} from them, then the competitors they named (rule 4).`);
    }
  }
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
  for (const q of d.questions) {
    const earlier = (r.answered ?? []).find((a) => sameQuestion(a.question, q));
    if (earlier) {
      errors.push(`You already asked "${earlier.question}" and they answered: "${earlier.answer}". That is settled: decide with their answer and drop the question (rule 8).`);
    }
  }
  const previous = r.previousTopics ?? [];
  if (previous.length >= 2 && !r.requestAboutTopics) {
    const kept = d.topics.filter((t) => previous.some((p) => normTopic(p) === normTopic(t.name))).length;
    if (kept === 0) {
      errors.push(`You renamed every topic. Their pitches hang on the exact names; keep each previous name (${previous.map((p) => `"${p}"`).join(", ")}) unless they asked for that topic to change (rule 2).`);
    }
  }
  return errors;
}

/** The model's draft plus what code decides: the window, batches, the Launch, the keyword numbers. */
export function finish(
  d: Draft,
  o: { kind: ProposalKind; window: Window; cadence: "weekly" | "flood"; launch: LaunchPlan | null; keywords: Map<string, Keyword>; searchesFirst?: boolean },
): StoredProposal {
  const n = batchCount(o.cadence, o.window.covers.weeks);
  return {
    ...d,
    ranking: {
      ...d.ranking,
      searches: d.ranking.searches.map((s) => {
        const k = o.keywords.get(s.query.toLowerCase());
        if (!k) return o.searchesFirst ? { ...s, position: null, bucket: s.bucket ?? "nodata" } : { ...s, position: null };
        const out: ProposedSearch = { ...s, difficulty: k.difficulty, position: k.position };
        if (k.volume !== null) out.volume = k.volume;
        if (typeof k.referringDomains === "number") out.referringDomains = k.referringDomains;
        if (typeof k.trend6 === "number") out.trend6 = k.trend6;
        if (typeof k.peakMonth === "number") out.peakMonth = k.peakMonth;
        if (typeof k.aiOverview === "boolean") out.aiOverview = k.aiOverview;
        if (o.searchesFirst) out.bucket = s.bucket ?? bucketOf(k, { newDomain: o.kind === "onboarding" }) ?? "now";
        return out;
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

/**
 * Rule 13 of the twenty (zero em dashes) on everything a proposal says: the
 * summary, every why and basis, the questions. Names, searches and addresses are
 * left as they are: they are matched against data, and validate() already holds
 * new topic names to the title rules.
 */
export function proposalWithoutDashes<T>(value: T, key = ""): T {
  if (typeof value === "string") return (["name", "topic", "query", "url"].includes(key) ? value : noDashes(value)) as T;
  if (Array.isArray(value)) return value.map((v) => proposalWithoutDashes(v, key)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, proposalWithoutDashes(v, k)])) as T;
  }
  return value;
}
