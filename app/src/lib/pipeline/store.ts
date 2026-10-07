// The pipeline's typed data hook and actions. Reads and writes go through the
// adapter (placeholder today, lib/pipeline/adapter.ts); the pitch-to-draft
// handoff is real: approving a pitch creates a draft post and a brief linked
// to it, so the writer lands in the existing editor with the brief beside it.

import { useSyncExternalStore } from "react";
import { db } from "@/lib/db";
import { createPost } from "@/lib/posts";
import { createBrief } from "@/lib/plan/briefs";
import { onScopeReset } from "@/lib/scope";
import { placeholderAdapter, type PipelineAdapter } from "./adapter";
import { shortDate } from "./dates";
import type { PipelineItem, PipelineSnapshot, PitchNote, Person } from "./types";

const adapter: PipelineAdapter = placeholderAdapter;

/**
 * Where a draft goes when the pitch's collection doesn't exist on this site.
 * Example pitches name a fictional tenant's collections, so their drafts land
 * in Test and never next to real articles.
 */
export const FALLBACK_COLLECTION = "Test";

let snapshot: PipelineSnapshot | null = null;
const listeners = new Set<() => void>();

function current(): PipelineSnapshot {
  if (!snapshot) snapshot = adapter.load();
  return snapshot;
}

function emit() {
  for (const l of listeners) l();
}

function setItems(items: PipelineItem[]) {
  snapshot = { ...current(), items };
  adapter.saveItems(items);
  emit();
}

onScopeReset(() => {
  snapshot = null;
  emit();
});

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePipeline(): PipelineSnapshot {
  return useSyncExternalStore(subscribe, current, current);
}

/** The nav badge: everything on the board (pitched to scheduled). */
export function usePipelineCount(): number | null {
  const { items } = usePipeline();
  const n = items.filter((i) => i.stage !== "published" && i.stage !== "rejected").length;
  return n || null;
}

export function getItem(id: string): PipelineItem | undefined {
  return current().items.find((i) => i.id === id);
}

export function personById(people: Person[], id: string): Person | undefined {
  return people.find((p) => p.id === id);
}

export function updateItem(id: string, patch: Partial<PipelineItem>) {
  setItems(current().items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)));
}

/** The writing guidance a brief carries into the editor's Brief tab. */
export function briefBody(item: PipelineItem, people: Person[]): string {
  const parts: string[] = [];
  if (item.why) parts.push(`## Why\n${item.why}`);
  if (item.angle) parts.push(`## Angle\n${item.angle}`);
  if (item.audience) parts.push(`## Who it's for\n${item.audience}`);
  if (item.outline.length) {
    const outline = item.outline.map((l, n) => {
      const notes = item.notes.filter((x) => x.lineId === l.id).map((x) => `\n   - Note: ${x.text}`);
      return `${n + 1}. ${l.text}${notes.join("")}`;
    });
    parts.push(`## Outline\n${outline.join("\n")}`);
  }
  const general = item.notes.filter((x) => x.lineId === null);
  if (general.length) parts.push(`## Reviewer notes\n${general.map((x) => `- ${x.text}`).join("\n")}`);
  if (item.sources.length) parts.push(`## Sources\n${item.sources.map((s) => `- [${s.label}](${s.url})`).join("\n")}`);
  const reviewer = personById(people, item.reviewerId)?.name ?? "";
  parts.push(`${item.length} · ${item.topics.join(", ")}${reviewer ? ` · reviewer: ${reviewer}` : ""}`);
  return parts.join("\n\n");
}

/**
 * Approve a pitch, with or without notes: it moves to Writing, and a draft post
 * plus its brief are created for the writer. Returns the new post's id.
 */
export async function approvePitch(
  id: string,
  decision: { writerId: string; reviewerId: string; publishBy: string; notes: PitchNote[] },
): Promise<string | null> {
  const item = getItem(id);
  if (!item || item.stage !== "pitched") return null;
  const approved: PipelineItem = { ...item, ...decision, stage: "writing" };

  const exists = (await db.collections.where("name").equals(item.collection).count()) > 0;
  const post = await createPost(exists ? item.collection : FALLBACK_COLLECTION, { title: item.title });
  if (!post) return null;
  const brief = await createBrief({
    title: item.title,
    status: "in_progress",
    plannedDate: decision.publishBy,
    collectionName: post.type,
    tags: item.topics,
    body: briefBody(approved, current().people),
    postId: post.id,
  });
  updateItem(id, { ...decision, stage: "writing", postId: post.id, briefId: brief.id });
  return post.id;
}

export function rejectPitch(id: string, reason: string) {
  updateItem(id, { stage: "rejected", rejectReason: reason.trim() });
}

/** The writer's handoff to review. */
export function sendForReview(id: string) {
  updateItem(id, { stage: "in_review", sentBackNote: undefined });
}

export function sendBack(id: string, note: string) {
  updateItem(id, { stage: "writing", sentBackNote: note.trim() });
}

/** Approve the draft and put it in its slot: the publish-by date at the tenant's publish time. */
export function approveAndSchedule(id: string): string | null {
  const item = getItem(id);
  if (!item) return null;
  const time = current().settings.publishTime;
  updateItem(id, { stage: "scheduled", scheduledFor: { date: item.publishBy, time } });
  return `${shortDate(item.publishBy)}, ${time}`;
}

export function setClaimState(id: string, claimId: string, state: "remembered" | "not_a_fact" | "open") {
  const item = getItem(id);
  if (!item?.review) return;
  updateItem(id, {
    review: {
      ...item.review,
      ownClaims: item.review.ownClaims.map((c) => (c.id === claimId ? { ...c, state } : c)),
    },
  });
}

/** "Write something yourself": a draft in the given collection that starts in Writing, with you as the writer. */
export async function writeYourself(collection: string | null): Promise<string | null> {
  const { meId } = current().settings;
  const post = await createPost(collection || FALLBACK_COLLECTION, { title: "" });
  if (!post) return null;
  const today = new Date();
  const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
  const publishBy = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  const item: PipelineItem = {
    id: `own-${post.id}`,
    title: "Untitled",
    why: "",
    stage: "writing",
    collection: post.type,
    topics: [],
    origin: "team",
    reasons: [],
    goals: [],
    writerId: meId,
    reviewerId: meId,
    publishBy,
    format: "blog",
    length: "",
    angle: "",
    audience: "",
    outline: [],
    sources: [],
    notes: [],
    batch: null,
    postId: post.id,
    briefId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  setItems([...current().items, item]);
  return post.id;
}

/** Start over with the example data. */
export function resetPipeline() {
  adapter.reset();
  snapshot = null;
  emit();
}
