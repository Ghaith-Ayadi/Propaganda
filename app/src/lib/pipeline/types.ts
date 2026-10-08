// Pipeline domain types: a planned post on its way from pitch to published.
//
// Shaped after the draft schema in /mnt/project-files/gaia-content-flow/README.md:
// a pitch is a `briefs` row with a `pitched` status plus pillar, fit, sources,
// reviewer and batch. None of those columns exist yet, so the data comes from
// the placeholder adapter (lib/pipeline/adapter.ts) until they do.

/** Board stages. Ideas are not here: the agent triages them and nobody sees them. */
export type Stage = "pitched" | "writing" | "in_review" | "scheduled" | "published" | "rejected" | "not_now";

export const BOARD_STAGES: Stage[] = ["pitched", "writing", "in_review", "scheduled"];

export const STAGE_LABEL: Record<Stage, string> = {
  pitched: "Pitched",
  writing: "Writing",
  in_review: "In review",
  scheduled: "Scheduled",
  published: "Published",
  rejected: "Rejected",
  not_now: "Not now",
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

/** The quarterly goals (reviews/goal-model.md). Coverage was dropped on 2026-10-08: it lives in the Strategist's decisions and shows in Volume. */
export type GoalKey = "volume" | "consistency" | "readership" | "ranking";

export const GOAL_LABEL: Record<GoalKey, string> = {
  volume: "Volume",
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
  /** briefs.learned: one line the Pitcher took from the taste log for this pitch. */
  learned?: string;
  /** briefs.changed: what is materially different from a rejected near-duplicate. */
  changed?: string;
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

export type BatchState = "closed" | "in_review" | "topping_up" | "pending" | "cancelled";

/**
 * A content batch: `content_batches` (#43). A batch's quota counts approved
 * briefs; the Pitcher over-pitches and tops a short batch up the next morning.
 * A member can close one ("that's enough").
 */
export interface Batch {
  /** "2026-Q4" */
  quarter: string;
  number: number;
  state: BatchState;
  /** Approved briefs this batch should end with. */
  quota: number;
  /** YYYY-MM-DD the pitches went out; unset while pending. */
  releasedAt?: string;
  /** Top-up rounds sent so far. */
  topups: number;
  /** Placeholder only (no column): when a pending batch is expected, and on what. */
  expectedOn?: string;
  expectedTopics?: string[];
}

export type TasteDecision = "approved" | "approved_with_notes" | "rejected" | "not_now" | "cancelled" | "edited" | "sent_back" | "note";

/** One `taste_log` row (#43): a decision on a pitch or a draft. Append-only. */
export interface TasteEntry {
  id: string;
  /** ms since epoch */
  at: number;
  actor: string;
  objectKind: "pitch" | "draft" | "plan";
  objectId: string;
  decision: TasteDecision;
  reason: string;
  notes?: PitchNote[];
  title: string;
  topic: string;
  angle: string;
  origin: string;
}

export type Batching = "weekly" | "flood";

export interface PipelineSettings {
  /** Posts a week (the Volume goal, spread over the quarter). */
  cadence: number;
  /** Weekdays that hold a slot, 0 = Sunday. */
  slotDays: number[];
  publishTime: string;
  /** The person using the app, for "you". */
  meId: string;
  batching: Batching;
  /** "Q4 2026" */
  quarter: string;
}

export interface PipelineSnapshot {
  items: PipelineItem[];
  people: Person[];
  batches: Batch[];
  tasteLog: TasteEntry[];
  settings: PipelineSettings;
  /** True while the data is example data from the placeholder adapter. */
  placeholder: boolean;
}
