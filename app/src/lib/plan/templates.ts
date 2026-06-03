// Row<->domain mappers and the local brief-template repository. Writes go to
// Dexie and scheduleSync() pushes to Supabase on idle. Mirrors lib/plan/briefs.ts.

import { db } from "@/lib/db";
import { scheduleSync } from "@/lib/sync";
import type { BriefChecks, BriefTemplate } from "@/lib/plan/types";
import { SEED_TEMPLATES } from "@/lib/plan/mock";

export interface BriefTemplateRow {
  id: string;
  name: string;
  body: string | null;
  checks: BriefChecks | null;
  created_at: string;
  updated_at: string;
}

export function fromTemplateRow(r: BriefTemplateRow): BriefTemplate {
  return {
    id: r.id,
    name: r.name ?? "",
    body: r.body ?? "",
    checks: r.checks ?? {},
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export function toTemplateRow(t: BriefTemplate): Partial<BriefTemplateRow> {
  return {
    id: t.id,
    name: t.name,
    body: t.body,
    checks: t.checks,
  };
}

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- local mutations ----

export async function createTemplate(
  partial: Partial<BriefTemplate> = {},
): Promise<BriefTemplate> {
  const now = Date.now();
  const tpl: BriefTemplate = {
    id: uuid(),
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
  const { supabase } = await import("@/lib/supabase");
  const { error } = await supabase.from("brief_templates").delete().eq("id", id);
  if (error) console.error("deleteTemplate failed:", error);
  await db.briefTemplates.delete(id);
}

let seeded = false;
/**
 * First run only: seed the demo templates locally so the Template picker isn't
 * empty. Seeded rows are not dirty — they stay local until the Supabase
 * `brief_templates` table exists; any edits afterwards sync normally.
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
