// Collections: first-class records with name (unique), emoji, description, position.
// Display rule: prefer the stored emoji; fall back to a leading emoji grapheme
// inside the name itself so legacy data (no collection record) still renders.
//
// The app addresses collections by name everywhere; the row's id is looked up
// once per name and cached here.

import { db } from "@/lib/db";
import { dateToMs, must, sb } from "@/lib/supabase";
import { onScopeReset, siteId } from "@/lib/scope";
import type { Collection } from "@/types";

export interface CollectionRecord {
  id: string;
  name: string;
  /** Set by the server from the name (the address triggers); clients never send it. */
  slug: string;
  emoji: string;
  description: string;
  position: number;
  is_hidden: boolean;
  created: string;
  updated: string;
}

// name -> record id, for the active site only.
const recordIds = new Map<string, string>();
onScopeReset(() => recordIds.clear());

export function fromCollectionRecord(r: CollectionRecord): Collection {
  recordIds.set(r.name, r.id);
  return {
    name: r.name,
    slug: r.slug ?? "",
    emoji: r.emoji || null,
    description: r.description || null,
    position: r.position,
    isHidden: !!r.is_hidden,
    createdAt: dateToMs(r.created) ?? Date.now(),
    updatedAt: dateToMs(r.updated) ?? Date.now(),
  };
}

const collections = () => sb.from("collections");

async function recordIdFor(name: string): Promise<string | null> {
  const cached = recordIds.get(name);
  if (cached) return cached;
  // Collections are publicly listable across sites: always scope the lookup.
  const found = await must(collections().select("id").eq("site", siteId()).eq("name", name).maybeSingle()).catch(
    () => null,
  );
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
    slug: existing?.slug ?? "",
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
    site: siteId(),
    name,
    emoji: next.emoji ?? "",
    description: next.description ?? "",
    position: next.position,
    is_hidden: next.isHidden,
  };
  try {
    const id = await recordIdFor(name);
    const saved = (await must(
      id ? collections().update(body).eq("id", id).select().single() : collections().insert(body).select().single(),
    )) as CollectionRecord;
    recordIds.set(name, saved.id);
    if (saved.slug !== next.slug) await db.collections.update(name, { slug: saved.slug });
  } catch (err) {
    console.error("upsertCollection failed:", err);
    // Mark dirty so the next sync retries.
    await db.collections.put({ ...next, dirty: true });
  }
}

/** Names in the middle of a rename: nothing may auto-create a record for them. */
const renaming = new Set<string>();

export function isRenaming(name: string): boolean {
  return renaming.has(name);
}

/**
 * Rename a collection, keeping its record (and so its id and slug history).
 *
 * On the server, the posts move first, while the record still has the old name:
 * the server writes a redirect from each public post's old address, which it
 * finds through the collection's old name. Then the record is renamed in place
 * and the server gives it a slug from the new name.
 *
 * Locally, posts and record change in one transaction, and both names are
 * marked as renaming meanwhile: realtime brings the moved posts in one by one,
 * and CollectionTabs would otherwise create a second record for the new name.
 *
 * The legacy post_id codes are left alone: old links by code keep working.
 */
export async function renameCollection(oldName: string, newName: string): Promise<void> {
  if (oldName === newName || !newName) return;
  renaming.add(oldName);
  renaming.add(newName);
  try {
    const id = await recordIdFor(oldName);
    const affected = await db.posts.where("type").equals(oldName).toArray();
    for (const p of affected) {
      try {
        await must(sb.from("posts").update({ type: newName }).eq("id", p.id));
      } catch (err) {
        console.error(`renameCollection: post ${p.id} not updated:`, err);
      }
    }
    let saved: CollectionRecord | null = null;
    if (id) {
      try {
        saved = (await must(collections().update({ name: newName }).eq("id", id).select().single())) as CollectionRecord;
      } catch (err) {
        console.error("renameCollection: collection not renamed:", err);
      }
    }
    const existing = await db.collections.get(oldName);
    await db.transaction("rw", db.posts, db.collections, async () => {
      for (const p of affected) await db.posts.update(p.id, { type: newName });
      await db.collections.delete(oldName);
      if (saved) await db.collections.put({ ...fromCollectionRecord(saved), syncedAt: Date.now(), dirty: false });
    });
    if (saved) {
      recordIds.delete(oldName);
      recordIds.set(newName, saved.id);
    } else {
      // No record to rename (offline, or legacy posts that never had one): make one.
      await upsertCollection(newName, {
        emoji: existing?.emoji ?? null,
        description: existing?.description ?? null,
        position: existing?.position ?? 0,
        isHidden: existing?.isHidden ?? false,
      });
    }
  } finally {
    renaming.delete(oldName);
    renaming.delete(newName);
  }
}

async function deleteRemote(name: string): Promise<void> {
  const id = await recordIdFor(name);
  if (!id) return;
  try {
    await must(collections().delete().eq("id", id));
    recordIds.delete(name);
  } catch (err) {
    console.error("deleteCollection failed:", err);
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
