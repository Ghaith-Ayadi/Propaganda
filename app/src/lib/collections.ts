// Collections: first-class records with name (unique), emoji, description, position.
// Display rule: prefer the stored emoji; fall back to a leading emoji grapheme
// inside the name itself so legacy data (no collection record) still renders.
//
// The app addresses collections by name everywhere; PocketBase's record id is
// looked up once per name and cached here.

import { db } from "@/lib/db";
import { httpStatus, pb, pbDateToMs } from "@/lib/pocketbase";
import type { Collection } from "@/types";

export interface CollectionRecord {
  id: string;
  name: string;
  emoji: string;
  description: string;
  position: number;
  is_hidden: boolean;
  created: string;
  updated: string;
}

const recordIds = new Map<string, string>();

export function fromCollectionRecord(r: CollectionRecord): Collection {
  recordIds.set(r.name, r.id);
  return {
    name: r.name,
    emoji: r.emoji || null,
    description: r.description || null,
    position: r.position,
    isHidden: !!r.is_hidden,
    createdAt: pbDateToMs(r.created) ?? Date.now(),
    updatedAt: pbDateToMs(r.updated) ?? Date.now(),
  };
}

const collections = () => pb.collection<CollectionRecord>("collections");

async function recordIdFor(name: string): Promise<string | null> {
  const cached = recordIds.get(name);
  if (cached) return cached;
  const found = await collections()
    .getFirstListItem(pb.filter("name = {:n}", { n: name }))
    .catch(() => null);
  if (found) recordIds.set(name, found.id);
  return found?.id ?? null;
}

// --- emoji extraction (legacy fallback) ---
const segmenter =
  typeof Intl !== "undefined" && (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const PICTO = /\p{Extended_Pictographic}/u;

export interface CollectionDisplay {
  emoji: string | null;
  label: string;
}

function leadingEmoji(name: string): { emoji: string | null; rest: string } {
  if (!name) return { emoji: null, rest: "" };
  let first: string;
  if (segmenter) {
    const it = segmenter.segment(name)[Symbol.iterator]();
    const step = it.next() as IteratorResult<{ segment: string }>;
    first = step.done ? "" : step.value.segment;
  } else {
    first = name[0] ?? "";
  }
  if (first && PICTO.test(first)) return { emoji: first, rest: name.slice(first.length).trim() };
  return { emoji: null, rest: name };
}

/**
 * Visual representation for a given collection name.
 * If a collection record exists, use its stored emoji + name verbatim.
 * Otherwise fall back to "leading emoji in name" so legacy posts still render.
 */
export function collectionDisplay(
  name: string | null | undefined,
  byName?: Map<string, Collection> | Collection[],
): CollectionDisplay {
  if (!name) return { emoji: null, label: "" };
  const map =
    byName instanceof Map
      ? byName
      : new Map((byName ?? []).map((c) => [c.name, c]));
  const stored = map.get(name);
  if (stored) {
    return { emoji: stored.emoji ?? null, label: stored.name };
  }
  const led = leadingEmoji(name);
  return { emoji: led.emoji, label: led.rest || name };
}

// --- mutations ---

export async function upsertCollection(
  name: string,
  patch: Partial<Pick<Collection, "emoji" | "description" | "position" | "isHidden">>,
): Promise<void> {
  const existing = await db.collections.get(name);
  const now = Date.now();
  const next: Collection = {
    name,
    emoji: patch.emoji !== undefined ? patch.emoji : existing?.emoji ?? null,
    description:
      patch.description !== undefined ? patch.description : existing?.description ?? null,
    position: patch.position !== undefined ? patch.position : existing?.position ?? 0,
    isHidden:
      patch.isHidden !== undefined ? patch.isHidden : existing?.isHidden ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    dirty: false,
  };
  await db.collections.put(next);

  const body = {
    name,
    emoji: next.emoji ?? "",
    description: next.description ?? "",
    position: next.position,
    is_hidden: next.isHidden,
  };
  try {
    const id = await recordIdFor(name);
    const saved = id ? await collections().update(id, body) : await collections().create(body);
    recordIds.set(name, saved.id);
  } catch (err) {
    console.error("upsertCollection failed:", err);
    // Mark dirty so the next sync retries.
    await db.collections.put({ ...next, dirty: true });
  }
}

/**
 * Rename a collection. Moves every post from the old name to the new one,
 * then upserts the new record and deletes the old.
 */
export async function renameCollection(oldName: string, newName: string): Promise<void> {
  if (oldName === newName || !newName) return;
  const existing = await db.collections.get(oldName);
  if (existing) {
    await upsertCollection(newName, {
      emoji: existing.emoji,
      description: existing.description,
      position: existing.position,
      isHidden: existing.isHidden,
    });
  } else {
    await upsertCollection(newName, {});
  }
  // Cascade post_id rewrites: they encode the collection prefix.
  // Note: slug is NOT rewritten here; it belongs to the URL and must stay stable.
  const affected = await db.posts.where("type").equals(oldName).toArray();
  const { postSlug } = await import("@/lib/postId");
  const posts = pb.collection("posts");
  for (const p of affected) {
    try {
      await posts.update(p.id, { type: newName, post_id: postSlug(newName, p.collectionSeq) });
    } catch (err) {
      console.error(`renameCollection: post ${p.id} not updated:`, err);
    }
  }
  // Mirror in Dexie so the UI updates without waiting for the next pull.
  await db.transaction("rw", db.posts, async () => {
    for (const p of affected) {
      await db.posts.put({ ...p, type: newName, postId: postSlug(newName, p.collectionSeq) });
    }
  });
  // Delete the old collection record.
  await db.collections.delete(oldName);
  await deleteRemote(oldName);
}

async function deleteRemote(name: string): Promise<void> {
  const id = await recordIdFor(name);
  if (!id) return;
  try {
    await collections().delete(id);
    recordIds.delete(name);
  } catch (err) {
    if (httpStatus(err) !== 404) console.error("deleteCollection failed:", err);
  }
}

export async function createCollection(
  name: string,
  patch: Partial<Pick<Collection, "emoji" | "description">> = {},
): Promise<void> {
  // position = max + 1
  const all = await db.collections.toArray();
  const position = all.length === 0 ? 0 : Math.max(...all.map((c) => c.position)) + 1;
  await upsertCollection(name, { ...patch, position });
}

/**
 * Duplicate a collection. Copies the record metadata under a new name (auto-
 * suffixed " copy") and leaves posts in the original, since duplicating posts
 * in bulk is rarely what you want.
 */
export async function duplicateCollection(source: string): Promise<string | null> {
  const existing = await db.collections.get(source);
  if (!existing) return null;
  // Pick "<name> copy", "<name> copy 2", … until free.
  const all = await db.collections.toArray();
  const taken = new Set(all.map((c) => c.name));
  let candidate = `${existing.name} copy`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${existing.name} copy ${n++}`;
  await createCollection(candidate, {
    emoji: existing.emoji,
    description: existing.description,
  });
  return candidate;
}

/**
 * Delete a collection. Posts in it keep their `type` text: they're no
 * longer grouped under a known collection but their content is intact.
 * Caller is responsible for confirmation (typing the name).
 */
export async function deleteCollection(name: string): Promise<void> {
  await db.collections.delete(name);
  await deleteRemote(name);
}
