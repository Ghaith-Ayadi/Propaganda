// Record<->domain mappers and the local brief repository. Writes go to Dexie and
// scheduleSync() pushes to PocketBase on idle. Mirrors lib/posts.ts.

import { db } from "@/lib/db";
import { httpStatus, newId, pb, pbDateToMs } from "@/lib/pocketbase";
import { scheduleSync } from "@/lib/sync";
import type { Brief, BriefChecks, BriefStatus } from "@/lib/plan/types";
import { mockBriefs } from "@/lib/plan/mock";

/** A `briefs` record as PocketBase returns it. Relations are ids or "". */
export interface BriefRecord {
  id: string;
  title: string;
  status: string;
  assignee_ids: string[] | null;
  planned_date: string; // YYYY-MM-DD or ""
  tags: string[] | null;
  template: string;
  collection_name: string;
  body: string;
  checks: BriefChecks | null;
  post: string;
  tenant: string;
  created: string;
  updated: string;
}

export function fromBriefRecord(r: BriefRecord): Brief {
  return {
    id: r.id,
    title: r.title ?? "",
    status: (r.status as BriefStatus) || "backlog",
    assigneeIds: r.assignee_ids ?? [],
    plannedDate: r.planned_date || null,
    tags: r.tags ?? [],
    templateId: r.template || null,
    collectionName: r.collection_name || null,
    body: r.body ?? "",
    checks: r.checks ?? {},
    postId: r.post || null,
    createdAt: pbDateToMs(r.created) ?? Date.now(),
    updatedAt: pbDateToMs(r.updated) ?? Date.now(),
  };
}

export function toBriefRecord(b: Brief) {
  return {
    title: b.title,
    status: b.status,
    assignee_ids: b.assigneeIds,
    planned_date: b.plannedDate ?? "",
    tags: b.tags,
    template: b.templateId ?? "",
    collection_name: b.collectionName ?? "",
    body: b.body,
    checks: b.checks,
    post: b.postId ?? "",
    tenant: "verbatim",
  };
}

// ---- local mutations ----

export async function createBrief(partial: Partial<Brief> = {}): Promise<Brief> {
  const now = Date.now();
  const brief: Brief = {
    id: newId(),
    title: "",
    status: "backlog",
    assigneeIds: [],
    plannedDate: null,
    tags: [],
    templateId: null,
    collectionName: null,
    body: "",
    checks: {},
    postId: null,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    dirty: true,
    ...partial,
  };
  await db.briefs.put(brief);
  scheduleSync();
  return brief;
}

export async function updateBrief(
  id: string,
  patch: Partial<Omit<Brief, "id" | "createdAt">>,
): Promise<void> {
  const existing = await db.briefs.get(id);
  if (!existing) return;
  await db.briefs.put({ ...existing, ...patch, updatedAt: Date.now(), dirty: true });
  scheduleSync();
}

/**
 * Link a brief to a post (or pass null to unlink). The relationship is 1:1, so
 * linking also detaches any other brief currently pointing at that post.
 */
export async function linkBriefToPost(briefId: string, postId: string | null): Promise<void> {
  if (postId != null) {
    const others = await db.briefs.where("postId").equals(postId).toArray();
    for (const o of others) {
      if (o.id !== briefId) await updateBrief(o.id, { postId: null });
    }
  }
  await updateBrief(briefId, { postId });
}

export async function deleteBrief(id: string): Promise<void> {
  try {
    await pb.collection("briefs").delete(id);
  } catch (err) {
    if (httpStatus(err) !== 404) console.error("deleteBrief failed:", err);
  }
  await db.briefs.delete(id);
}

let seeded = false;
/**
 * First run only: seed the demo briefs locally so the planner isn't empty.
 * Seeded rows are not dirty, so they stay local; any edits afterwards sync
 * normally.
 */
export async function seedBriefsIfEmpty(): Promise<void> {
  if (seeded) return;
  seeded = true;
  if ((await db.briefs.count()) > 0) return;
  const now = Date.now();
  const demo = mockBriefs().map((b) => ({ ...b, syncedAt: now, dirty: false }));
  await db.briefs.bulkPut(demo);
}
