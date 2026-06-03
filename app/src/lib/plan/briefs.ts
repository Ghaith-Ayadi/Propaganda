// Row<->domain mappers and the local brief repository. Writes go to Dexie and
// scheduleSync() pushes to Supabase on idle. Mirrors lib/posts.ts.

import { db } from "@/lib/db";
import { scheduleSync } from "@/lib/sync";
import type { Brief, BriefChecks, BriefStatus } from "@/lib/plan/types";
import { mockBriefs } from "@/lib/plan/mock";

export interface BriefRow {
  id: string;
  title: string;
  status: string;
  assignee_ids: string[] | null;
  planned_date: string | null; // YYYY-MM-DD
  tags: string[] | null;
  template_id: string | null;
  collection_name: string | null;
  body: string | null;
  checks: BriefChecks | null;
  post_id: number | null;
  created_at: string;
  updated_at: string;
}

export function fromBriefRow(r: BriefRow): Brief {
  return {
    id: r.id,
    title: r.title ?? "",
    status: (r.status as BriefStatus) ?? "backlog",
    assigneeIds: r.assignee_ids ?? [],
    plannedDate: r.planned_date ?? null,
    tags: r.tags ?? [],
    templateId: r.template_id ?? null,
    collectionName: r.collection_name ?? null,
    body: r.body ?? "",
    checks: r.checks ?? {},
    postId: r.post_id ?? null,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export function toBriefRow(b: Brief): Partial<BriefRow> {
  return {
    id: b.id,
    title: b.title,
    status: b.status,
    assignee_ids: b.assigneeIds,
    planned_date: b.plannedDate,
    tags: b.tags,
    template_id: b.templateId,
    collection_name: b.collectionName,
    body: b.body,
    checks: b.checks,
    post_id: b.postId,
  };
}

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `br-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- local mutations ----

export async function createBrief(partial: Partial<Brief> = {}): Promise<Brief> {
  const now = Date.now();
  const brief: Brief = {
    id: uuid(),
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

export async function deleteBrief(id: string): Promise<void> {
  const { supabase } = await import("@/lib/supabase");
  const { error } = await supabase.from("briefs").delete().eq("id", id);
  if (error) console.error("deleteBrief failed:", error);
  await db.briefs.delete(id);
}

let seeded = false;
/**
 * First run only: seed the demo briefs locally so the planner isn't empty.
 * Seeded rows are not dirty — they stay local until the Supabase `briefs`
 * table exists; any edits afterwards sync normally.
 */
export async function seedBriefsIfEmpty(): Promise<void> {
  if (seeded) return;
  seeded = true;
  if ((await db.briefs.count()) > 0) return;
  const now = Date.now();
  const demo = mockBriefs().map((b) => ({ ...b, syncedAt: now, dirty: false }));
  await db.briefs.bulkPut(demo);
}
