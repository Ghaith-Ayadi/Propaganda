// The pipeline's typed data hook and actions.
//
// Two sources. Live (every real build, localhost included): the tenant's
// briefs, batches and decisions on the server (lib/pipeline/live.ts); a new
// tenant sees an empty board. Placeholder (the UI preview only, VITE_UI_PREVIEW):
// example data for a fictional tenant kept in this browser (adapter.ts).
// Either way approving a pitch gives the writer a draft post with its brief.

import { useSyncExternalStore } from "react";
import { toast } from "@/components/base/toast/toast";
import { db } from "@/lib/db";
import { userMessage } from "@/lib/errors";
import { createPost } from "@/lib/posts";
import { createBrief } from "@/lib/plan/briefs";
import { createCollection } from "@/lib/collections";
import { UI_PREVIEW } from "@/lib/preview";
import { onScopeReset, siteId } from "@/lib/scope";
import { reportError } from "@/lib/telemetry";
import { placeholderAdapter, type PipelineAdapter } from "./adapter";
import { addDays, shortDate, ymd } from "./dates";
import { live, loadLive, meOf } from "./live";
import type { Batch, PipelineItem, PipelineSnapshot, PitchNote, Person, Stage, TasteEntry } from "./types";

const adapter: PipelineAdapter = placeholderAdapter;
const LIVE = !UI_PREVIEW;

/**
 * Where approved drafts go while the data is the placeholder's. Example pitches
 * name collections a real tenant can have (Guides, Product), so every approval
 * lands in Test, never next to real articles. Live, approvals go to the
 * pitch's own collection.
 */
export const FALLBACK_COLLECTION = "Test";

/** The collection an approved pitch's draft is written to. */
function draftCollection(item: PipelineItem): string {
  return current().placeholder ? FALLBACK_COLLECTION : item.collection;
}

/** A post needs its collection row to show under a tab; create Test if the site has none. */
async function ensureCollection(name: string): Promise<void> {
  if (!(await db.collections.get(name))) await createCollection(name);
}

let snapshot: PipelineSnapshot | null = null;
const listeners = new Set<() => void>();

/** What a live board shows before its first load: nothing, and loading. */
function emptySnapshot(): PipelineSnapshot {
  const me = meOf();
  const now = new Date();
  return {
    items: [],
    batches: [],
    tasteLog: [],
    people: [me],
    settings: { cadence: 0, slotDays: [], publishTime: "09:00", meId: me.id, batching: "weekly", quarter: `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}` },
    placeholder: false,
    loading: true,
  };
}

function current(): PipelineSnapshot {
  if (!snapshot) {
    snapshot = LIVE ? emptySnapshot() : adapter.load();
    if (LIVE) void refresh();
  }
  return snapshot;
}

function emit() {
  for (const l of listeners) l();
}

function siteOrNull(): string | null {
  try {
    return siteId();
  } catch {
    return null;
  }
}

let loading: Promise<void> | null = null;

/** Re-read the tenant's pipeline (live only). Safe to call any time. */
export function refresh(): Promise<void> {
  if (!LIVE || !siteOrNull()) return Promise.resolve();
  if (loading) return loading;
  loading = loadLive()
    .then((d) => {
      if (d.site !== siteOrNull()) return; // switched site while loading
      snapshot = { items: d.items, batches: d.batches, tasteLog: d.tasteLog, people: d.people, settings: d.settings, placeholder: false, loading: false };
      emit();
    })
    .catch((err) => {
      reportError("pipeline.load", err);
      if (snapshot?.loading) {
        snapshot = { ...snapshot, loading: false };
        emit();
      }
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Local change: saved in this browser for the placeholder, held until the next read live. */
function commit(next: Partial<Pick<PipelineSnapshot, "items" | "batches" | "tasteLog">>) {
  snapshot = { ...current(), ...next };
  if (!LIVE) adapter.save({ items: snapshot.items, batches: snapshot.batches, tasteLog: snapshot.tasteLog });
  emit();
}

function setItems(items: PipelineItem[]) {
  commit({ items });
}

/** A live write after the board already shows it: re-read either way, and say so when it failed. */
function persist(write: Promise<unknown>) {
  void write
    .catch((err) => {
      reportError("pipeline.save", err);
      toast.add({ type: "error", title: "Couldn't save that", description: userMessage(err) });
    })
    .finally(() => void refresh());
}

onScopeReset(() => {
  snapshot = null;
  emit();
});

// Pitches arrive while the page is open (the Pitcher runs on the worker):
// read again every minute while someone is looking, and on coming back.
const POLL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
const onFocus = () => {
  if (document.visibilityState === "visible") void refresh();
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (LIVE && !timer) {
    timer = setInterval(onFocus, POLL_MS);
    document.addEventListener("visibilitychange", onFocus);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onFocus);
    }
  };
}

/** For other stores built on the pipeline (the Inbox's pitches). */
export const subscribePipeline = subscribe;
export const pipelineSnapshot = (): PipelineSnapshot => current();

export function usePipeline(): PipelineSnapshot {
  return useSyncExternalStore(subscribe, current, current);
}

/** Pitches of a batch that hasn't been released yet stay off the board. */
export function isReleased(item: PipelineItem, batches: Batch[]): boolean {
  if (item.batch == null) return true;
  const b = batches.find((x) => x.number === item.batch);
  return !b || b.state !== "pending";
}

/** The batch waiting on review now, else the last one released. */
export function currentBatch(batches: Batch[]): Batch | null {
  return (
    batches.find((b) => b.state === "in_review" || b.state === "topping_up") ??
    [...batches].reverse().find((b) => b.state === "closed") ??
    null
  );
}

/** The next batch to come, the one "Run now" releases. */
export function nextBatch(batches: Batch[]): Batch | null {
  return batches.find((b) => b.state === "pending") ?? null;
}

/**
 * Live: ask the Pitcher for the next batch now. Resolves to why it didn't
 * start, or null when it did (its pitches arrive as they're written).
 */
export async function requestNextBatch(): Promise<string | null> {
  const why = await live.nextBatch();
  void refresh();
  return why;
}

/** Placeholder: release a batch now instead of on its date. Its pitches show on the board. */
export function runBatch(number: number) {
  const today = ymd(new Date());
  const { batches } = current();
  // Only one batch is in review at a time: the one it replaces closes.
  commit({
    batches: batches.map((b) =>
      b.number === number
        ? { ...b, state: "in_review", releasedAt: today, expectedOn: undefined }
        : b.state === "in_review" || b.state === "topping_up"
          ? { ...b, state: "closed" }
          : b,
    ),
  });
}

/** "That's enough": a member closes a batch that's out. Its open pitches stay on the board. */
export function closeBatch(number: number) {
  const b = current().batches.find((x) => x.number === number);
  if (LIVE && b) persist(live.closeBatch(b.quarter, number));
  commit({
    batches: current().batches.map((b) =>
      b.number === number && (b.state === "in_review" || b.state === "topping_up") ? { ...b, state: "closed" } : b,
    ),
  });
}

/**
 * Append a `taste_log` row. On the server, triggers log pitch decisions from
 * the status change; the app adds what a status can't say (a "not now", a note).
 */
function logTaste(item: PipelineItem, fields: Pick<TasteEntry, "decision"> & Partial<TasteEntry>) {
  if (LIVE) return; // the server logs decisions from the brief's status (live.ts)
  const entry: TasteEntry = {
    id: `taste-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    actor: current().settings.meId,
    objectKind: "pitch",
    objectId: item.briefId ?? item.id,
    reason: "",
    title: item.title,
    topic: item.topics[0] ?? "",
    angle: item.angle,
    origin: item.origin,
    ...fields,
  };
  commit({ tasteLog: [...current().tasteLog, entry] });
}

const BOARD = new Set<Stage>(["pitched", "writing", "in_review", "scheduled"]);

/** The nav badge: everything on the board (pitched to scheduled). */
export function usePipelineCount(): number | null {
  const { items, batches } = usePipeline();
  const n = items.filter((i) => BOARD.has(i.stage) && isReleased(i, batches)).length;
  return n || null;
}

export function getItem(id: string): PipelineItem | undefined {
  return current().items.find((i) => i.id === id);
}

export function personById(people: Person[], id: string): Person | undefined {
  return people.find((p) => p.id === id);
}

export function updateItem(id: string, patch: Partial<PipelineItem>) {
  if (LIVE && patch.notes) persist(live.saveNotes(id, patch.notes));
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

  if (LIVE) {
    const { postId, agentNote } = await live.approve(item, decision);
    updateItem(id, { ...decision, stage: "writing", postId, notes: item.notes });
    void refresh();
    if (agentNote) {
      toast.add({ title: "The Writer didn't start", description: `The worker says ${agentNote}. Write it yourself, or ask Chat to write it later.` });
    }
    return postId;
  }

  const collection = draftCollection(item);
  await ensureCollection(collection);
  const post = await createPost(collection, { title: item.title });
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
  logTaste(approved, {
    decision: decision.notes.length ? "approved_with_notes" : "approved",
    notes: decision.notes.length ? decision.notes : undefined,
  });
  return post.id;
}

export function rejectPitch(id: string, reason: string) {
  const item = getItem(id);
  if (!item) return;
  if (LIVE) persist(live.reject(id, reason.trim()));
  updateItem(id, { stage: "rejected", rejectReason: reason.trim() });
  logTaste(item, { decision: "rejected", reason: reason.trim() });
}

/** Not now: off the board, kept for later (a `backlog` brief), with an optional reason. */
export function notNowPitch(id: string, reason: string) {
  const item = getItem(id);
  if (!item) return;
  if (LIVE) persist(live.notNow(id, reason.trim()));
  updateItem(id, { stage: "not_now" });
  logTaste(item, { decision: "not_now", reason: reason.trim() });
}

/** The writer's handoff to review. */
export function sendForReview(id: string) {
  if (LIVE) persist(live.sendForReview(id));
  updateItem(id, { stage: "in_review", sentBackNote: undefined });
}

export function sendBack(id: string, note: string) {
  const item = getItem(id);
  if (!item) return;
  if (LIVE) persist(live.sendBack(item, note.trim()));
  updateItem(id, { stage: "writing", sentBackNote: note.trim() });
  logTaste(item, { decision: "sent_back", objectKind: "draft", objectId: item.postId ?? item.id, reason: note.trim() });
}

/**
 * Approve the draft and move it to Scheduled on its publish-by date at the
 * tenant's publish time. Only the board moves: the post's own status is left
 * alone until the Publish step exists.
 */
export function approveAndSchedule(id: string): string | null {
  const item = getItem(id);
  if (!item) return null;
  const time = current().settings.publishTime;
  if (LIVE) persist(live.schedule(id, item.publishBy, time));
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

function newItem(fields: Partial<PipelineItem> & Pick<PipelineItem, "id" | "title" | "stage" | "collection">): PipelineItem {
  const { meId } = current().settings;
  const now = Date.now();
  return {
    why: "",
    topics: [],
    origin: "team",
    reasons: [],
    goals: [],
    writerId: meId,
    reviewerId: meId,
    publishBy: ymd(addDays(new Date(), 14)),
    format: "blog",
    length: "",
    angle: "",
    audience: "",
    outline: [],
    sources: [],
    notes: [],
    batch: null,
    postId: null,
    briefId: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

/**
 * The + on a column. A pitch is your own idea (no draft yet); Writing and In
 * review start a draft in `collection` with you as writer and reviewer.
 * Returns the item, with its post id when one was created.
 */
export async function addToColumn(stage: Stage, title: string, collection: string | null): Promise<PipelineItem | null> {
  const name = title.trim() || "Untitled";
  if (LIVE) {
    const { id, postId } = await live.add(stage, name, collection);
    const item = newItem({ id, title: name, stage, collection: collection ?? "", postId, briefId: id });
    setItems([...current().items, item]);
    void refresh();
    return item;
  }
  if (stage === "pitched") {
    const item = newItem({ id: `own-${Date.now().toString(36)}`, title: name, stage, collection: collection || FALLBACK_COLLECTION });
    setItems([...current().items, item]);
    return item;
  }
  const target = collection || FALLBACK_COLLECTION;
  await ensureCollection(target);
  const post = await createPost(target, { title: title.trim() });
  if (!post) return null;
  const item = newItem({ id: `own-${post.id}`, title: name, stage, collection: post.type, postId: post.id });
  setItems([...current().items, item]);
  return item;
}

/** The draft as markdown, from the paragraphs the review step read (markers dropped). */
function reviewMarkdown(item: PipelineItem): string {
  return (item.review?.paragraphs ?? []).map((p) => p.replace(/\[\[[a-z0-9]+\]\]|\[\[\/\]\]/g, "")).join("\n\n");
}

/**
 * The post behind an item, created on first open when it has none yet (in
 * Test while the data is the placeholder's). Returns its id.
 */
export async function ensureDraft(id: string): Promise<string | null> {
  const item = getItem(id);
  if (!item) return null;
  if (LIVE) {
    const postId = await live.ensureDraft(item);
    if (postId && postId !== item.postId) updateItem(id, { postId });
    return postId;
  }
  if (item.postId && (await db.posts.get(item.postId))) return item.postId;
  const collection = draftCollection(item);
  await ensureCollection(collection);
  const post = await createPost(collection, { title: item.title, content: reviewMarkdown(item) });
  if (!post) return null;
  updateItem(id, { postId: post.id });
  return post.id;
}

/** The pipeline item a post belongs to, if any. */
export function usePipelineItemForPost(postId: string | null | undefined): PipelineItem | undefined {
  const { items } = usePipeline();
  return postId ? items.find((i) => i.postId === postId) : undefined;
}

/** Start over with the example data (UI preview only). */
export function resetPipeline() {
  if (LIVE) return;
  adapter.reset();
  snapshot = null;
  emit();
}
