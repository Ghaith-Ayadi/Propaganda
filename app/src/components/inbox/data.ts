// What waits on the person, and the actions that close it. The Inbox page and
// Home's inbox button read through useInbox(); they never know where an item
// came from.
//
// Sources:
//   reviews    briefs in review (Dexie, synced), each linked to its post
//   pitches    the pipeline's pitches waiting on a decision (live.ts)
//   flags, knowledge: on the Knowledge base pages for now, empty here.
//   Example items exist in the UI preview only (placeholder.ts).

import { useEffect, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Brief } from "@/lib/plan/types";
import type { Post } from "@/types";
import type { ObjectKind } from "@/components/shared/ObjectIcon";
import { UI_PREVIEW } from "@/lib/preview";
import { isDemoBrief, seedBriefsIfEmpty } from "@/lib/plan/briefs";
import { placeholderInbox } from "./placeholder";
import { liveInbox } from "./live";

// ---- the objects items are about ----

export interface InboxObject {
  kind: ObjectKind;
  title: string;
  /** "published 2026-09-12", "sent 2026-09-30", "draft" */
  state: string;
  /** The post in this app, when it is one. */
  postId?: string | null;
  /** The live page, when there is one. */
  url?: string | null;
}

/** A quote inside its whole paragraph, linked to its original. */
export interface Passage {
  before: string;
  quote: string;
  after: string;
  /** "Plans at a glance", "Opening line" */
  section?: string;
}

export interface Claim {
  text: string;
  topic: string;
  /** Who remembered it, or where it came from. */
  origin: string;
  since: string;
  status: "settled" | "contested";
  evidence: number;
}

// ---- flags ----

export type FlagStatus =
  /** Waiting on the person. */
  | "open"
  /** The person argued it away; the Guardian is reading. */
  | "contesting"
  /** The Guardian said no; the flag stays open with its argument. */
  | "rejected";

export interface Flag {
  id: string;
  object: InboxObject;
  /** The question flags are grouped under: "Pricing tiers named two ways". */
  topic: string;
  raised: string;
  /** What leads: only "high" is called out (an Urgent chip, a colored count). */
  urgency: "high" | "normal";
  /** 0 to 1, how sure the checker is. Metadata, not the headline. */
  confidence: number;
  says: Passage;
  /** What it disagrees with: a knowledge base claim, or other content. */
  against:
    | { kind: "claim"; claim: Claim }
    | { kind: "content"; object: InboxObject; passage: Passage; note: string };
  /** The edit that resolves it, applied as a suggestion in the editor. Null when the content can't change. */
  fix: { replacement: string } | null;
  /** Set by object type (a sent newsletter, a posted tweet): never chosen by hand. */
  cantFix: boolean;
  status: FlagStatus;
  guardian?: { verdict: "rejected"; argument: string };
}

/**
 * How a person closes a flag without fixing it. "noted" is for content that
 * can't change (the server keeps its cant_fix status, set by type).
 */
export type FlagClose = "wont_fix" | "retracted" | "noted";

// ---- pitches, one batch at a time ----

export type Fit = "strong" | "fair" | "weak";

export interface Pitch {
  id: string;
  title: string;
  topic: string;
  collection: string;
  fit: Fit;
  /** One line per goal it serves: "Volume: Guides is 2 short this quarter". */
  reasons: string[];
  angle: string;
  outline: string[];
  sources: { label: string; url?: string }[];
  /** The Writer already drafted it (the highest-confidence pitches of a batch). */
  drafted: boolean;
  publishOn: string;
  decision: null | { kind: "approved" | "rejected"; note: string };
}

export interface PitchBatch {
  number: number;
  of: number;
  /** When the batch should be written by. */
  due: string;
  pitches: Pitch[];
}

// ---- knowledge: claims at odds, rulings that need an owner ----

export interface KnowledgeItem {
  id: string;
  kind: "conflict" | "escalation";
  title: string;
  why: string;
  a: Claim;
  b: Claim;
  /** Labels for the two rulings: keep A, keep B (conflict) or keep current, accept change (escalation). */
  choices: [string, string];
}

// ---- the Strategist's notes ----

/** A drift note from the Strategist's weekly check, shown on the tab it concerns. */
export interface StrategistNote {
  id: string;
  tab: "flags" | "pitches";
  severity: "info" | "warning";
  message: string;
}

// ---- reviews ----

export interface Review {
  id: string;
  title: string;
  object: InboxObject;
  /** "The writer agent asked you to review" */
  ask: string;
  due: string | null;
  briefId: string;
}

// ---- the source contract ----

export interface InboxSnapshot {
  flags: Flag[];
  batch: PitchBatch | null;
  knowledge: KnowledgeItem[];
  notes: StrategistNote[];
}

export interface InboxSource {
  /** True while the items are example data. */
  example: boolean;
  snapshot(): InboxSnapshot;
  subscribe(onChange: () => void): () => void;
  applyFix(flagId: string, replacement: string): Promise<void>;
  contest(flagId: string, argument: string): Promise<void>;
  closeFlag(flagId: string, how: FlagClose): Promise<void>;
  decidePitch(pitchId: string, kind: "approved" | "rejected", note: string): Promise<void>;
  rule(itemId: string, choice: 0 | 1): Promise<void>;
}

export const inboxSource: InboxSource = UI_PREVIEW ? placeholderInbox : liveInbox;

export interface Inbox extends InboxSnapshot {
  reviews: Review[];
  /** Pitches in the batch still waiting on a decision. */
  pendingPitches: number;
  total: number;
  /** Open flags marked high urgency. */
  urgent: number;
  example: boolean;
  source: InboxSource;
}

export function useInbox(): Inbox {
  const snap = useSyncExternalStore(inboxSource.subscribe, inboxSource.snapshot);
  // Clears the demo briefs an earlier build seeded into this browser.
  useEffect(() => void seedBriefsIfEmpty(), []);
  const reviews = useLiveQuery(loadReviews, [], [] as Review[]);
  const pendingPitches = snap.batch?.pitches.filter((p) => !p.decision).length ?? 0;
  return {
    ...snap,
    reviews,
    pendingPitches,
    total: snap.flags.length + pendingPitches + snap.knowledge.length + reviews.length,
    urgent: snap.flags.filter((f) => f.urgency === "high").length,
    example: inboxSource.example,
    source: inboxSource,
  };
}

// Briefs in review are the drafts someone has to read before they ship.
async function loadReviews(): Promise<Review[]> {
  const briefs: Brief[] = (await db.briefs.where("status").equals("in_review").toArray()).filter((b) => UI_PREVIEW || !isDemoBrief(b.id));
  const postIds = briefs.map((b) => b.postId).filter((id): id is string => !!id);
  const posts = new Map((await db.posts.bulkGet(postIds)).filter((p): p is Post => !!p).map((p) => [p.id, p]));
  return briefs
    .sort((a, b) => (a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999"))
    .map((b) => {
      const post = b.postId ? posts.get(b.postId) : undefined;
      return {
        id: `review-${b.id}`,
        briefId: b.id,
        title: post?.title || b.title || "Untitled",
        object: {
          kind: "blog",
          title: post?.title || b.title || "Untitled",
          state: post?.status === "published" ? "published" : "draft",
          postId: post?.id ?? null,
        },
        ask: b.assigneeIds.length ? `Waiting on ${b.assigneeIds.join(", ")}` : "Waiting on a review",
        due: b.plannedDate,
      };
    });
}
