// Pipeline domain types: a planned post on its way from pitch to published.
//
// Shaped after the draft schema in /mnt/project-files/gaia-content-flow/README.md:
// a pitch is a `briefs` row with a `pitched` status plus pillar, fit, sources,
// reviewer and batch. None of those columns exist yet, so the data comes from
// the placeholder adapter (lib/pipeline/adapter.ts) until they do.

/** Board stages. Ideas are not here: the agent triages them and nobody sees them. */
export type Stage = "pitched" | "writing" | "in_review" | "scheduled" | "published" | "rejected";

export const BOARD_STAGES: Stage[] = ["pitched", "writing", "in_review", "scheduled"];

export const STAGE_LABEL: Record<Stage, string> = {
  pitched: "Pitched",
  writing: "Writing",
  in_review: "In review",
  scheduled: "Scheduled",
  published: "Published",
  rejected: "Rejected",
};

export type FitGrade = "strong" | "fair" | "weak";

/** Why this, why now. Cadence, pillar mix, demand and timeliness, plus the gap it fills. */
export type ReasonKind = "demand" | "mix" | "cadence" | "timeliness" | "gap" | "duplicate";

export interface FitReason {
  kind: ReasonKind;
  text: string;
  /** Whether this line is a reason to write it (a mix already on target is shown but doesn't count). */
  counts: boolean;
}

/** The five quarterly goals (reviews/goal-model.md). */
export type GoalKey = "volume" | "coverage" | "consistency" | "readership" | "ranking";

export const GOAL_LABEL: Record<GoalKey, string> = {
  volume: "Volume",
  coverage: "Coverage",
  consistency: "Consistency",
  readership: "Readership",
  ranking: "Ranking",
};

export interface GoalEffect {
  goal: GoalKey;
  /** Does this post move the goal? */
  moves: boolean;
  note: string;
}

export type Origin = "calls" | "search" | "news" | "watched" | "team" | "plan";

export const ORIGIN_LABEL: Record<Origin, string> = {
  calls: "from the calls and documents",
  search: "from the search data",
  news: "from the news",
  watched: "from a site you watch",
  team: "from your team",
  plan: "from your plan",
};

export interface Person {
  id: string;
  name: string;
  /** The Writer agent. */
  agent?: boolean;
}

export interface OutlineLine {
  id: string;
  text: string;
}

export interface Source {
  url: string;
  label: string;
}

/** A reviewer note left at the pitch, general (no line) or on one outline line. */
export interface PitchNote {
  lineId: string | null;
  text: string;
  /** Set by the review step when the draft addressed it. */
  done?: boolean;
}

/** One finding of the source check on external links and stats. */
export interface SourceCheck {
  id: string;
  status: "matches" | "mismatch" | "unsourced";
  /** The exact words in the draft. */
  quote: string;
  detail: string;
  /** Where the agent looked, e.g. "Haldane call, Oct 2, 14:20". */
  where?: string;
}

/** A sentence about the tenant's own product, offered for Remember. */
export interface OwnClaim {
  id: string;
  sentence: string;
  state: "open" | "remembered" | "not_a_fact";
}

/** The draft as the review screen reads it: paragraphs, with checked spans marked. */
export interface DraftForReview {
  paragraphs: string[];
  checks: SourceCheck[];
  ownClaims: OwnClaim[];
}

export interface PipelineItem {
  id: string;
  title: string;
  /** The one line under the title: why this, in a sentence. */
  why: string;
  stage: Stage;
  /** Target collection (Blog > Guides). */
  collection: string;
  /** One or two topics: a post can count toward two. */
  topics: string[];
  /** "3 published of 4–6" under the topic. */
  topicProgress?: string;
  origin: Origin;
  reasons: FitReason[];
  goals: GoalEffect[];
  writerId: string;
  reviewerId: string;
  /** YYYY-MM-DD */
  publishBy: string;
  /** YYYY-MM-DD and HH:MM once scheduled or published. */
  scheduledFor?: { date: string; time: string };
  format: "blog";
  length: string;
  angle: string;
  audience: string;
  outline: OutlineLine[];
  sources: Source[];
  notes: PitchNote[];
  rejectReason?: string;
  sentBackNote?: string;
  /** Content batch (1-based); null for a bonus post outside the plan. */
  batch: number | null;
  /** The draft post in the editor, once the pitch is approved. */
  postId: string | null;
  /** The brief linked to that post (lib/plan/briefs). */
  briefId: string | null;
  review?: DraftForReview;
  createdAt: number;
  updatedAt: number;
}

export interface BatchInfo {
  number: number;
  total: number;
  /** YYYY-MM-DD, when this batch should be written. */
  dueBy: string;
}

export interface PipelineSettings {
  /** Posts a week (the Volume goal, spread over the quarter). */
  cadence: number;
  /** Weekdays that hold a slot, 0 = Sunday. */
  slotDays: number[];
  publishTime: string;
  /** The person using the app, for "you". */
  meId: string;
}

export interface PipelineSnapshot {
  items: PipelineItem[];
  people: Person[];
  batch: BatchInfo | null;
  settings: PipelineSettings;
  /** True while the data is example data from the placeholder adapter. */
  placeholder: boolean;
}
