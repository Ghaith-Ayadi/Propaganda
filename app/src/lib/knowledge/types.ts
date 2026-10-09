// Types for the knowledge base pages. Row shapes mirror the draft schema in the
// project files (kb-data-model/20261006000001_knowledge_base.sql), which is NOT
// applied yet; the view types below are what the pages render, assembled by an
// adapter (lib/knowledge/adapter.ts) from those rows.
//
// The knowledge base is server-side only: none of this goes in Dexie or the
// sync. Pages ask the server for one page of rows at a time, never the whole
// knowledge base.

export type ClaimStatus = "settled" | "contested" | "superseded" | "retracted";
export const LIVE_STATUSES: ClaimStatus[] = ["settled", "contested"];

export type RelationKind = "supersedes" | "contradicts" | "refines" | "depends_on";
export type Reliance = "asserts" | "assumes" | "mentions";
export type SourceKind = "person" | "document" | "call" | "slack" | "chat" | "post" | "signal";
/** 1 is the strongest evidence, 5 the weakest (published posts). */
export type Tier = 1 | 2 | 3 | 4 | 5;

export type FlagKind = "contradiction" | "recheck" | "kb_conflict";
export type FlagStatus =
  | "open"
  | "snoozed"
  | "fixed"
  | "reconciled"
  | "wont_fix"
  | "retracted"
  | "cant_fix"
  | "duplicate"
  // Proposed in guardian-and-grades/README.md §5 (not in the draft yet): the
  // agent re-checked the post and it still holds.
  | "cleared";
/** The statuses a person may set by hand (kb_close_flag). */
export type HandClose = "wont_fix" | "retracted" | "snoozed" | "duplicate";
export type SuggestedAction = "" | "leave" | "edit_wording" | "rewrite" | "dated_note" | "unpublish";

export type ProposalOrigin = "remember" | "sweep" | "ingest" | "contest" | "recheck" | "chat";
export type ProposalStatus = "draft" | "open" | "escalated" | "admitted" | "rejected" | "withdrawn";
export type Verdict = "admit" | "admit_contested" | "reject" | "escalate";
export type Severity = "" | "patch" | "minor" | "major";
export type CheckResult = "pass" | "weak" | "fail" | "escalate";
/** The axis a contest names (policy v1, C9). */
export type ContestAxis = "time" | "scope" | "audience" | "wording";

export interface Topic {
  id: string;
  name: string;
  parent: string | null;
}

export interface Person {
  id: string;
  name: string;
}

/** One row of the claims list. */
export interface ClaimSummary {
  id: string;
  text: string;
  status: ClaimStatus;
  topics: Topic[];
  validFrom: string | null;
  /** 1 + posts relying on it (asserts or assumes): the grade weight. */
  weight: number;
  /** Posts whose current version relies on it, any reliance. */
  postCount: number;
  inConflict: boolean;
  created: string;
}

export interface ClaimPage {
  rows: ClaimSummary[];
  total: number;
  /** Pass back to get the next page; null when this is the last one. */
  next: number | null;
}

export interface ClaimQuery {
  search: string;
  statuses: ClaimStatus[];
  topic: string | null;
  /** Only claims that are contested or in a contradiction. */
  problemsOnly: boolean;
  sort: "recent" | "weight";
  offset: number;
  limit: number;
}

export interface Source {
  id: string;
  kind: SourceKind;
  tier: Tier;
  title: string;
  /** Where the original lives: a permalink, a post, or a signed link to the file. */
  uri: string;
  occurred: string | null;
  person: Person | null;
}

export interface Evidence {
  id: string;
  source: Source;
  quote: string;
  /** The text right before and after the quote in the source, for context. */
  before: string;
  after: string;
  stance: "supports" | "contradicts";
}

export interface Relationship {
  id: string;
  kind: RelationKind;
  /** "out" when this claim is the `from` side (it supersedes, refines...). */
  direction: "out" | "in";
  other: { id: string; text: string; status: ClaimStatus };
}

export interface RelyingPost {
  postId: string;
  title: string;
  version: number;
  reliance: Reliance;
  quote: string;
  published: boolean;
}

export interface CheckLine {
  check: string;
  result: CheckResult;
  reason: string;
}

export interface Decision {
  id: string;
  verdict: Verdict;
  argument: string;
  checks: CheckLine[];
  severity: Severity;
  /** The Guardian (agent + policy version) or a person. */
  decidedBy: { kind: "guardian"; agent: string; policyVersion: number | null } | { kind: "person"; person: Person };
  created: string;
}

export interface ClaimDetail extends ClaimSummary {
  scope: Record<string, string>;
  validUntil: string | null;
  reviewAfter: string | null;
  rationale: string;
  /** Metadata only: people are never part of a claim's text. */
  rememberedBy: Person | null;
  retired: string | null;
  owners: Person[];
  evidence: Evidence[];
  relationships: Relationship[];
  posts: RelyingPost[];
  /** The decision that admitted this version, and the one that retired it. */
  admittedBy: Decision | null;
  retiredBy: Decision | null;
  /** Older versions, newest first (the `supersedes` chain). */
  history: { id: string; text: string; status: ClaimStatus; created: string }[];
}

/** A proposal still in review (a Remember waiting on the Guardian, an escalation). */
export interface PendingProposal {
  id: string;
  origin: ProposalOrigin;
  status: ProposalStatus;
  title: string;
  openedBy: Person | null;
  created: string;
}

/** What the person typed in the Remember dialog. */
export interface RememberInput {
  text: string;
  topics: string[];
  scope: Record<string, string>;
}

// ---- flags ----

export type Urgency = "high" | "normal";

export interface FlagSummary {
  id: string;
  kind: FlagKind;
  status: FlagStatus;
  postId: string | null;
  postTitle: string;
  /** One line: what's wrong (the claim's topic, or a short label). */
  headline: string;
  /** How soon someone should look. Only "high" shows (an "urgent" chip, a red count). */
  urgency: Urgency;
  confidence: number | null;
  created: string;
  batch: string | null;
}

export interface FlagQuery {
  status: "open" | "closed";
  kind: FlagKind | "all";
  offset: number;
  limit: number;
}

export interface FlagPage {
  rows: FlagSummary[];
  total: number;
  /** How many of `total` are urgent. */
  urgent: number;
  next: number | null;
}

export interface FixPreview {
  /** The passage as it is, the span being replaced, and the replacement. */
  before: string;
  removed: string;
  added: string;
  after: string;
  section: string;
}

export interface ContestState {
  proposalId: string;
  status: ProposalStatus;
  reason: string;
  axis: ContestAxis | null;
  /** The changes the agent drafted from the person's sentence. */
  changes: { op: "add" | "supersede" | "retract" | "relate"; text: string }[];
  decision: Decision | null;
}

export interface FlagDetail extends FlagSummary {
  /** What the content says: the quote and the rest of its paragraph. */
  passage: { before: string; quote: string; after: string; section: string; uri: string };
  claim: ClaimDetail;
  /** For a conflict between two claims. */
  otherClaim: ClaimDetail | null;
  explanation: string;
  suggestedAction: SuggestedAction;
  fix: FixPreview | null;
  note: string;
  snoozedUntil: string | null;
  contest: ContestState | null;
  cantFixReason: string | null;
}

// ---- re-check threads ----

export interface RecheckThreadSummary {
  /** The decision that changed the claim; every re-check flag carries it as `batch`. */
  id: string;
  title: string;
  severity: Severity;
  open: number;
  total: number;
  created: string;
}

export interface RecheckItem {
  flagId: string;
  postId: string;
  postTitle: string;
  status: FlagStatus;
  /** One or two sentences: what in this post depends on the old claim and what to do. */
  tldr: string;
  /** The quote and the rest of its paragraph. */
  quote: string;
  before: string;
  after: string;
  suggestedAction: SuggestedAction;
  fix: FixPreview | null;
}

export interface RecheckThread extends RecheckThreadSummary {
  oldClaim: { id: string; text: string };
  newClaim: { id: string; text: string } | null;
  decision: Decision;
  owner: Person | null;
  items: RecheckItem[];
}

export type BulkAction = "apply_fix" | "wont_fix" | "snooze" | "retracted";

// ---- grades ----

export type Letter = "A" | "B" | "C" | "D" | "F";

export interface GradeNote {
  /** A topic, or a re-check thread. */
  label: string;
  count: number;
  href: string;
}

export interface ContentGrade {
  letter: Letter;
  posts: number;
  flagged: number;
  share: number;
  breakdown: { open: number; snoozed: number; wontFix: number; rechecks: number };
  notes: GradeNote[];
}

export interface KnowledgeGrade {
  letter: Letter;
  claims: number;
  contested: number;
  inConflict: number;
  share: number;
  totalWeight: number;
  badWeight: number;
  /** The heaviest problems first: what to settle to move the grade. */
  todo: ClaimSummary[];
}

export interface Grades {
  content: ContentGrade;
  knowledge: KnowledgeGrade;
}

/** The fixed bands from the Goals page (kb_letter in the draft). */
export const BANDS: { letter: Letter; min: number }[] = [
  { letter: "A", min: 0.95 },
  { letter: "B", min: 0.85 },
  { letter: "C", min: 0.7 },
  { letter: "D", min: 0.5 },
  { letter: "F", min: 0 },
];

export function letterFor(share: number): Letter {
  return BANDS.find((b) => share >= b.min)!.letter;
}

// ---- one post's findings, for the editor's Review tab ----

/** One line of the Checker's source check (kb_checks.report.sources). */
export interface PostSourceCheck {
  quote: string;
  url: string;
  verdict: "ok" | "mismatch" | "unsupported" | "unreachable";
  note: string;
  /** Replacement wording for the quote, when the check proposes one. */
  fix?: string;
}

/** An open knowledge base flag on the post (kb_flags with post = this post). */
export interface PostFlag {
  id: string;
  kind: FlagKind;
  status: FlagStatus;
  /** The words in the post the flag is about. */
  quote: string;
  /** The claim it contradicts or depends on. */
  claim: string;
  explanation: string;
  suggestedAction: SuggestedAction;
  /** Replacement for `quote`, when the Guardian drafted one. */
  fix: string | null;
}

/** A sentence about the tenant the Checker offers for Remember (kb_checks.report.remember). */
export interface PostRemember {
  text: string;
  quote: string;
}

export interface PostFindings {
  /** When the Checker last read the post; null when it never has. */
  checkedAt: string | null;
  sources: PostSourceCheck[];
  remember: PostRemember[];
  flags: PostFlag[];
}
