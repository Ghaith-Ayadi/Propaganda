// Comments on a post, Google Docs style. A contextual comment keeps the words
// it is about (`quote`) and a little of the text around them; the editor finds
// them again in the text (lib/comments/marks), so nothing is written into the
// post. A general comment has no quote; a reply points at the comment that
// opened its thread. Writes go to Dexie and scheduleSync() pushes them, like
// lib/posts.ts. The table is public.comments (supabase/migrations/*_comments.sql).

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { currentScope } from "@/lib/scope";
import { dateToMs, msToDate, newId } from "@/lib/supabase";
import { scheduleSync } from "@/lib/sync";

export type CommentTarget = "post" | "brief";

export interface Comment {
  id: string;
  targetKind: CommentTarget;
  targetId: string;
  /** The comment that opened the thread; null on a thread's first comment. */
  parent: string | null;
  /** The highlighted words; null on a general comment. */
  quote: string | null;
  contextBefore: string;
  contextAfter: string;
  body: string;
  resolved: boolean;
  authorId: string;
  authorName: string;
  /** Null while it is a draft waiting to be sent with the rest. */
  submittedAt: number | null;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number | null;
  dirty?: boolean;
  pushedUpdatedAt?: number;
}

export interface CommentRecord {
  id: string;
  target_kind: CommentTarget;
  target_id: string;
  parent: string | null;
  quote: string | null;
  context_before: string;
  context_after: string;
  body: string;
  resolved: boolean;
  author: string;
  author_name: string;
  submitted: string | null;
  created: string;
  updated: string;
}

export function fromCommentRecord(r: CommentRecord): Comment {
  return {
    id: r.id,
    targetKind: r.target_kind,
    targetId: r.target_id,
    parent: r.parent,
    quote: r.quote,
    contextBefore: r.context_before ?? "",
    contextAfter: r.context_after ?? "",
    body: r.body,
    resolved: !!r.resolved,
    authorId: r.author,
    authorName: r.author_name ?? "",
    submittedAt: dateToMs(r.submitted),
    createdAt: dateToMs(r.created) ?? Date.now(),
    updatedAt: dateToMs(r.updated) ?? Date.now(),
  };
}

/** What the server needs; `author` is the signed-in user by default there. */
export function toCommentRecord(c: Comment) {
  return {
    target_kind: c.targetKind,
    target_id: c.targetId,
    parent: c.parent,
    quote: c.quote,
    context_before: c.contextBefore,
    context_after: c.contextAfter,
    body: c.body,
    resolved: c.resolved,
    author_name: c.authorName,
    submitted: msToDate(c.submittedAt),
  };
}

export interface Thread {
  /** The first comment; carries the quote. */
  root: Comment;
  replies: Comment[];
}

/** Open (or resolved) threads, oldest first. A comment whose root is gone is dropped. */
export function toThreads(comments: Comment[]): Thread[] {
  const roots = comments.filter((c) => !c.parent).sort((a, b) => a.createdAt - b.createdAt);
  return roots.map((root) => ({
    root,
    replies: comments.filter((c) => c.parent === root.id).sort((a, b) => a.createdAt - b.createdAt),
  }));
}

export function useComments(targetKind: CommentTarget, targetId: string): Comment[] {
  return (
    useLiveQuery(
      () => db.comments.where("[targetKind+targetId]").equals([targetKind, targetId]).toArray(),
      [targetKind, targetId],
      [],
    ) ?? []
  );
}

export interface NewComment {
  targetKind: CommentTarget;
  targetId: string;
  body: string;
  parent?: string | null;
  quote?: string | null;
  contextBefore?: string;
  contextAfter?: string;
  /** False keeps it a draft until sendDrafts(). */
  submit?: boolean;
}

export async function addComment(n: NewComment): Promise<Comment> {
  const account = currentScope()?.account;
  const now = Date.now();
  const c: Comment = {
    id: newId(),
    targetKind: n.targetKind,
    targetId: n.targetId,
    parent: n.parent ?? null,
    quote: n.parent ? null : (n.quote ?? null),
    contextBefore: n.contextBefore ?? "",
    contextAfter: n.contextAfter ?? "",
    body: n.body.trim(),
    resolved: false,
    authorId: account?.authId ?? "",
    authorName: account?.name ?? "",
    submittedAt: n.submit === false ? null : now,
    createdAt: now,
    updatedAt: now,
    dirty: n.submit !== false,
  };
  await db.comments.put(c);
  if (c.submittedAt) scheduleSync();
  return c;
}

/** Sends every draft on a target at once. */
export async function sendDrafts(targetKind: CommentTarget, targetId: string): Promise<number> {
  const drafts = await db.comments
    .where("[targetKind+targetId]")
    .equals([targetKind, targetId])
    .filter((c) => c.submittedAt === null)
    .toArray();
  const now = Date.now();
  await db.comments.bulkPut(drafts.map((c) => ({ ...c, submittedAt: now, updatedAt: now, dirty: true })));
  if (drafts.length) scheduleSync();
  return drafts.length;
}

export async function setResolved(id: string, resolved: boolean): Promise<void> {
  await db.comments.update(id, { resolved, updatedAt: Date.now(), dirty: true });
  scheduleSync();
}

export async function editComment(id: string, body: string): Promise<void> {
  const c = await db.comments.get(id);
  if (!c) return;
  await db.comments.update(id, { body: body.trim(), updatedAt: Date.now(), dirty: !!c.submittedAt });
  if (c.submittedAt) scheduleSync();
}

/** Removes a comment, and its replies when it opens a thread. */
export async function removeComment(id: string): Promise<void> {
  const c = await db.comments.get(id);
  if (!c) return;
  const ids = [id, ...(await db.comments.where("parent").equals(id).primaryKeys())];
  await db.comments.bulkDelete(ids);
  if (c.syncedAt) {
    const { sb } = await import("@/lib/supabase");
    await sb.from("comments").delete().in("id", ids);
  }
}

/** The words either side of a selection, kept to find the same passage again if the quote repeats. */
export function contextAround(blockText: string, from: number, to: number): { before: string; after: string } {
  return { before: blockText.slice(Math.max(0, from - 40), from), after: blockText.slice(to, to + 40) };
}
