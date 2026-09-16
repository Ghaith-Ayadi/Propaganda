// Record<->domain mappers and the local brief-template repository. Writes go to
// Dexie and scheduleSync() pushes to PocketBase on idle. Mirrors lib/plan/briefs.ts.

import { db } from "@/lib/db";
import { httpStatus, newId, pb, pbDateToMs } from "@/lib/pocketbase";
import { scheduleSync } from "@/lib/sync";
import type { BriefChecks, BriefTemplate } from "@/lib/plan/types";
import { SEED_TEMPLATES } from "@/lib/plan/mock";

export interface BriefTemplateRecord {
  id: string;
  name: string;
  body: string;
  checks: BriefChecks | null;
  tenant: string;
  created: string;
  updated: string;
}

export function fromTemplateRecord(r: BriefTemplateRecord): BriefTemplate {
  return {
    id: r.id,
    name: r.name ?? "",
    body: r.body ?? "",
    checks: r.checks ?? {},
    createdAt: pbDateToMs(r.created) ?? Date.now(),
    updatedAt: pbDateToMs(r.updated) ?? Date.now(),
  };
}

export function toTemplateRecord(t: BriefTemplate) {
  return {
    name: t.name,
    body: t.body,
    checks: t.checks,
    tenant: "verbatim",
  };
}

// ---- local mutations ----

export async function createTemplate(
  partial: Partial<BriefTemplate> = {},
): Promise<BriefTemplate> {
  const now = Date.now();
  const tpl: BriefTemplate = {
    id: newId(),
    name: "",
    body: "",
    checks: {},
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    dirty: true,
    ...partial,
  };
  await db.briefTemplates.put(tpl);
  scheduleSync();
  return tpl;
}

export async function updateTemplate(
  id: string,
  patch: Partial<Omit<BriefTemplate, "id" | "createdAt">>,
): Promise<void> {
  const existing = await db.briefTemplates.get(id);
  if (!existing) return;
  await db.briefTemplates.put({ ...existing, ...patch, updatedAt: Date.now(), dirty: true });
  scheduleSync();
}

export async function deleteTemplate(id: string): Promise<void> {
  try {
    await pb.collection("brief_templates").delete(id);
  } catch (err) {
    if (httpStatus(err) !== 404) console.error("deleteTemplate failed:", err);
  }
  await db.briefTemplates.delete(id);
}

let seeded = false;
/**
 * First run only: seed the demo templates locally so the Template picker isn't
 * empty. Seeded rows are not dirty, so they stay local; any edits afterwards
 * sync normally.
 */
export async function seedTemplatesIfEmpty(): Promise<void> {
  if (seeded) return;
  seeded = true;
  if ((await db.briefTemplates.count()) > 0) return;
  const now = Date.now();
  const demo: BriefTemplate[] = SEED_TEMPLATES.map((t) => ({
    ...t,
    createdAt: now,
    updatedAt: now,
    syncedAt: now,
    dirty: false,
  }));
  await db.briefTemplates.bulkPut(demo);
}
