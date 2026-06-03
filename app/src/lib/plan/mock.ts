// Mock Planning data. Mirrors the analytics module's "ship UI on simulated
// data first" pattern — no DB/sync yet. Briefs are anchored to the *current*
// month so the calendar always has something to show.

import type { Assignee, Brief, BriefChecks, BriefStatus } from "./types";

export const MOCK_ASSIGNEES: Assignee[] = [
  { id: "u-ghaith", name: "Ghaith" },
  { id: "u-mira", name: "Mira" },
  { id: "u-sol", name: "Sol" },
];

export interface BriefTemplate {
  id: string;
  name: string;
}

export const MOCK_TEMPLATES: BriefTemplate[] = [
  { id: "t-standard", name: "Standard brief" },
  { id: "t-longform", name: "Longform essay" },
  { id: "t-interview", name: "Interview" },
  { id: "t-weeknotes", name: "Weeknotes" },
];

export function templateById(id: string | null): BriefTemplate | null {
  if (!id) return null;
  return MOCK_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function assigneeById(id: string | null): Assignee | null {
  if (!id) return null;
  return MOCK_ASSIGNEES.find((a) => a.id === id) ?? null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A YYYY-MM-DD date on `day` (1-based) of the current month. */
function dayThisMonth(day: number): string {
  const now = new Date();
  return ymd(new Date(now.getFullYear(), now.getMonth(), day));
}

let cache: Brief[] | null = null;

export function mockBriefs(): Brief[] {
  if (cache) return cache;
  const now = Date.now();

  const b = (
    id: string,
    title: string,
    status: BriefStatus,
    assigneeId: string | null,
    day: number | null,
    tags: string[],
    postId: number | null,
    checks: BriefChecks = {},
  ): Brief => ({
    id,
    title,
    status,
    assigneeId,
    plannedDate: day == null ? null : dayThisMonth(day),
    tags,
    templateId: null,
    collectionName: null,
    body: "",
    checks,
    postId,
    createdAt: now,
    updatedAt: now,
  });

  cache = [
    b("br-1", "The case against infinite scroll", "in_progress", "u-ghaith", 3, ["essay", "ux"], 101, {
      minWords: 1200,
      requiredKeywords: ["attention", "feed"],
    }),
    b("br-2", "Weeknotes: shipping the planner", "todo", "u-mira", 5, ["weeknotes"], null),
    b("br-3", "Interview: a typographer's desk", "in_review", "u-sol", 9, ["interview", "craft"], 102, {
      minWords: 2000,
    }),
    b("br-4", "Why we left Notion (then came back)", "backlog", null, 12, ["tools", "meta"], null),
    b("br-5", "A short history of the pull-quote", "done", "u-ghaith", 2, ["essay", "history"], 103),
    b("br-6", "Field guide to RSS in 2026", "todo", "u-sol", 16, ["guide", "web"], null, { minWords: 1500 }),
    b("br-7", "The newsletter is the product", "in_progress", "u-mira", 18, ["essay", "growth"], 104),
    b("br-8", "Crypto explainer", "cancelled", null, 19, ["explainer"], null),
    b("br-9", "Reading list: this month", "todo", "u-ghaith", 23, ["list"], null),
    b("br-10", "On writing in public", "backlog", "u-mira", 25, ["essay"], null),
    b("br-13", "Podcast notes: episode 12", "in_review", "u-mira", 27, ["podcast", "notes"], 105),
    // Unscheduled (no plannedDate) — these live in the Unscheduled tray.
    b("br-11", "Template: the 5-paragraph brief", "todo", "u-sol", null, ["meta"], null),
    b("br-12", "Untitled draft idea", "backlog", null, null, [], null),
  ];
  // Each brief targets a collection (the post it produces inherits it).
  const COLLS = ["Briefs", "Hokum", "Journal", "The mechanics", "Rocket science"];
  cache.forEach((br, i) => {
    br.collectionName = COLLS[i % COLLS.length];
  });
  return cache;
}
