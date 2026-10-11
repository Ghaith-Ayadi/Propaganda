// Goals and Strategist domain types (0.2). Shaped after the goal model
// (/mnt/project-files/reviews/goal-model.md) and the Strategist design
// (agents/strategist.md, amended by agents/strategist-cold-start-and-pacing.md).
//
// None of these tables exist yet. The draft schema is in the PR that added this
// file; until it lands, lib/goals/placeholder.ts serves the data.

/** A calendar quarter, e.g. "2026-Q4" (1 Oct to 31 Dec). */
export type QuarterKey = `${number}-Q${1 | 2 | 3 | 4}`;

/** YYYY-MM-DD, local. */
export type Day = string;

/**
 * Four goals. Coverage was the fifth until Ayadi folded it into Volume
 * (2026-10-08): covering every topic is the Strategist's job, and it shows as
 * each topic's pitched count next to its goal and what's done.
 */
export type GoalKind = "volume" | "consistency" | "readership" | "ranking";

export const GOAL_KINDS: GoalKind[] = ["volume", "consistency", "readership", "ranking"];

export interface TopicTarget {
  name: string;
  /** The low end counts as "on target". */
  low: number;
  high: number;
}

export interface RankingSearch {
  query: string;
  topic: string;
  /** Google position today; null = not in the top 100. */
  position: number | null;
  /** Monthly searches (DataForSEO). */
  volume?: number;
  difficulty?: number;
}

/** The targets of one goal version. Every number here was approved by the tenant. */
export interface GoalTargets {
  volume: { total: number; topics: TopicTarget[] };
  readership: {
    pageviews: number | null;
    pagesPerSession: number | null;
    /** Total reading time across the corpus, minutes. */
    corpusMinutes: number | null;
    /** Average reading time per post, seconds. */
    secondsPerPost: number | null;
  };
  ranking: { searches: RankingSearch[]; pageOneTarget: number; aiMentionTarget: number | null };
  // Consistency has no target: always A.
}

/** A goal version: every change keeps the old one with its date. */
export interface GoalVersion {
  quarter: QuarterKey;
  version: number;
  approvedAt: Day;
  approvedBy: string;
  /** One line per changed number, e.g. "Volume 18 → 20". Empty for version 1. */
  changes: string[];
  /** The tenant's reason, when they gave one. */
  note?: string;
  targets: GoalTargets;
  /** Set when the tenant joined mid-quarter (weeks 5 to 8): targets already prorated. */
  covers?: { from: Day; weeks: number };
}

/** One stored point of a goal's daily score (goal_scores). */
export interface ScorePoint {
  day: Day;
  value: number;
}

export interface VolumeNow {
  published: number;
  byTopic: Record<string, number>;
  /**
   * Pitches the Strategist put in front of the tenant, per topic: its attempt to
   * cover every topic. Pitched well above done means the topic keeps getting
   * rejected, and the Volume shortfall shows it.
   */
  pitchedByTopic: Record<string, number>;
  rejectedByTopic: Record<string, number>;
  /** Posts published that weren't planned (Scout, Listener). Counted on top. */
  bonus: number;
}

export interface ConsistencyNow {
  /** null = "Nothing to check yet". */
  contentGrade: Grade | null;
  kbGrade: Grade | null;
  contentClean: number | null; // 0..1
  kbClean: number | null; // 0..1
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface ReadershipNow {
  pageviews: number;
  pagesPerSession: number;
  corpusMinutes: number;
  secondsPerPost: number;
}

export interface RankingNow {
  /** Position per query, today. */
  positions: Record<string, number | null>;
  /** How many of the target prompts got an AI answer that mentions us. */
  aiMentions: number;
}

/** Everything the Goals page shows for one quarter. */
export interface QuarterGoals {
  quarter: QuarterKey;
  /** Latest approved version, or null when the quarter has no goals. */
  current: GoalVersion | null;
  history: GoalVersion[];
  /** Daily score series per goal (the goal's headline number). */
  scores: Record<GoalKind, ScorePoint[]>;
  now: {
    volume: VolumeNow;
    consistency: ConsistencyNow;
    readership: ReadershipNow;
    ranking: RankingNow;
  };
  /** Set when this quarter's goals rolled over from the last one, unapproved. */
  rolledOver?: boolean;
}

// ── Strategist proposal ─────────────────────────────────────────────────────

/** Where an item came from, when the tenant dropped a plan of their own. */
export type PlanOrigin = "plan" | "plan_changed" | "added";

/** Every number carries a reason and a basis. No reason, no number. */
export interface Reasoned<T> {
  value: T;
  why: string;
  basis: string;
  origin?: PlanOrigin;
  /** For plan_changed: what their plan said. */
  planSaid?: string;
}

export interface ProposedTopic extends TopicTarget {
  why: string;
  basis: string;
  origin?: PlanOrigin;
}

export interface ProposedSearch extends RankingSearch {
  why: string;
  origin?: PlanOrigin;
}

export interface WatchedSite {
  url: string;
  topic: string;
  why: string;
}

export type ProposalKind = "onboarding" | "quarterly" | "revision";
/** No consultant review step (Ayadi, 2026-10-08): a proposal goes straight to the tenant. */
export type ProposalStatus = "draft" | "sent" | "changes_requested" | "approved" | "superseded";

export interface Proposal {
  id: string;
  quarter: QuarterKey;
  kind: ProposalKind;
  status: ProposalStatus;
  createdAt: Day;
  summary: string;
  covers: { from: Day; to: Day; weeks: number; prorated: boolean };
  volume: Reasoned<number>;
  topics: ProposedTopic[];
  ranking: {
    searches: ProposedSearch[];
    pageOneTarget: Reasoned<number>;
    aiMentionTarget: Reasoned<number | null>;
  };
  readership: Reasoned<number | null>;
  watchedSites: WatchedSite[];
  batches: Reasoned<number>;
  /** At most 3 things the Strategist couldn't decide alone. */
  questions: string[];
  /** A new tenant's Launch (worker/src/agents/strategy.ts launchFor): onboarding proposals only. */
  launch?: LaunchPlan | null;
  /** Approved: who and when. */
  approvedBy?: string;
  approvedAt?: Day;
  /** The tenant's note when they asked for changes. */
  changeRequest?: string;
}

/** An edit the tenant made to a proposal before approving, kept as a diff. */
export interface ProposalEdit {
  field: string;
  from: string;
  to: string;
  reason?: string;
}

// ── Launch (first 30 days of a new tenant) ──────────────────────────────────

/** The Launch as the Strategist planned it (worker LaunchPlan). */
export interface LaunchPlan {
  startsOn: Day;
  target: number;
  floor: number;
  ceiling: number;
  /** Every Launch post written by this day. */
  produceByDay: number;
  /** And published over this many days. */
  publishOverDays: number;
  dayOne: { briefs: number; drafted: number };
  prorated: boolean;
}

export interface LaunchCluster {
  name: string;
  planned: number;
  live: number;
}

export interface LaunchBatch {
  number: 1 | 2 | 3;
  /** Launch day it is due (1, 8, 15). */
  dueDay: number;
  briefs: number;
  drafted: number;
  approved: number;
  /** Reached the inbox (early, when the tenant asked for it or chose Flood). */
  arrived: boolean;
}

export interface Launch {
  startedAt: Day;
  /** Day of the launch, 1 to 30. Past 30 the card is gone. */
  day: number;
  target: number; // 15
  floor: number; // 12
  ceiling: number; // 20
  produced: number; // approved drafts
  live: number;
  indexed: number;
  clusters: LaunchCluster[];
  batches: LaunchBatch[];
  /** Longest gap between two published posts so far, in days. */
  longestGap: number;
  firstPublicPost: Day | null;
}

// ── Content batches (the quarter's planned list, split) ─────────────────────

/** How the planned list reaches the inbox (lib/goals/batching.ts). */
export type BatchCadence = "weekly" | "flood";

export type BatchState = "pending" | "in_review" | "decided";

export type BatchBriefState = "brief" | "approved" | "rejected" | "drafted" | "scheduled" | "published";

export interface BatchBrief {
  id: string;
  title: string;
  topic: string;
  origin: "internal" | "external";
  state: BatchBriefState;
  publishOn?: Day;
}

export interface ContentBatch {
  id: string;
  quarter: QuarterKey;
  number: number;
  dueAt: Day;
  state: BatchState;
  briefs: BatchBrief[];
  /** Part of the Launch (a tenant's first three batches). */
  launch?: boolean;
}

export interface BatchPlan {
  quarter: QuarterKey;
  cadence: BatchCadence;
  planned: number;
  batches: ContentBatch[];
  /** Posts on top of the plan, from news or calls. */
  bonus: { count: number; sources: string[] };
  /** Planned posts moved to next quarter to make room for bonus posts. */
  pushedToNext: number;
  /** Date the last batch must be written by (mid-quarter). */
  allWrittenBy: Day;
}

// ── Joining mid-quarter ─────────────────────────────────────────────────────

export type JoinState =
  | { kind: "full"; week: number }
  | { kind: "prorated"; week: number; factor: number; weeksLeft: number; from: Day }
  | { kind: "next_quarter"; week: number; firstQuarter: QuarterKey; startsOn: Day };

// ── Plan drop ───────────────────────────────────────────────────────────────

export type PlanFileKind = "pdf" | "doc" | "markdown" | "spreadsheet" | "image" | "text";

export interface PlanFile {
  id: string;
  name: string;
  size: number;
  kind: PlanFileKind;
  uploadedAt: Day;
}

export interface PlanDrop {
  text: string;
  files: PlanFile[];
  /** When the Strategist last read it. */
  readAt: Day | null;
}

// ── Onboarding: the Strategist's questions ─────────────────────────────────

/**
 * The four answers the Strategist starts from, in Ayadi's order (2026-10-08).
 * Review capacity is asked earlier, in "Your business", and lives in the site
 * setting strategist.reviewPerMonth. Free text: the Strategist reads it.
 */
export interface StrategyAnswers {
  offer: string;
  searches: string;
  watch: string;
  upcoming: string;
}

// ── Tenant context for the page ─────────────────────────────────────────────

export interface TenantGoalsContext {
  /** The day the tenant approved their first plan. */
  joinedAt: Day;
  /** The calendar day the page treats as today. */
  today: Day;
}
