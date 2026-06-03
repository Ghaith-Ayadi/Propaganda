// Planning domain types — mock-first, but shaped to mirror the planned
// Supabase `briefs` schema (see Notion → Knowledge base → Planning).
//
// A Brief is a task to write a post. The post is LINKED, never embedded:
// brief.postId points at a post, and the two have independent statuses.

export type BriefStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export interface Assignee {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** Machine-checkable constraints (brief "header"). Empty for now; the future
 *  checks engine reads this against the linked post's content + wordCount. */
export interface BriefChecks {
  minWords?: number;
  maxWords?: number;
  requiredKeywords?: string[];
}

export interface Brief {
  id: string;
  title: string;
  status: BriefStatus;
  assigneeId: string | null;
  plannedDate: string | null; // YYYY-MM-DD; null = Unscheduled tray
  tags: string[]; // freeform multi-tag
  templateId: string | null;
  collectionName: string | null; // target collection: the produced post goes here, the brief does not
  body: string; // writing guidance (mock: plain text)
  checks: BriefChecks;
  postId: number | null; // linked post (1:1 for now)
  createdAt: number;
  updatedAt: number;
}

export interface BriefStatusMeta {
  value: BriefStatus;
  label: string;
  /** Tailwind class for a small status dot (background). */
  dot: string;
  /** Tailwind classes for a chip/badge (background + text). */
  chip: string;
}

export const BRIEF_STATUS_ORDER: BriefStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

// Colors mirror the workspace task statuses (Backlog gray, In Progress blue/amber,
// In Review purple, Done green, Cancelled red).
export const BRIEF_STATUS_META: Record<BriefStatus, BriefStatusMeta> = {
  backlog: {
    value: "backlog",
    label: "Backlog",
    dot: "bg-utility-neutral-500",
    chip: "bg-utility-neutral-50 text-utility-neutral-700 ring-1 ring-utility-neutral-200 ring-inset",
  },
  todo: {
    value: "todo",
    label: "Todo",
    dot: "bg-utility-blue-500",
    chip: "bg-utility-blue-50 text-utility-blue-700 ring-1 ring-utility-blue-200 ring-inset",
  },
  in_progress: {
    value: "in_progress",
    label: "In progress",
    dot: "bg-utility-amber-500",
    chip: "bg-utility-amber-50 text-utility-amber-700 ring-1 ring-utility-amber-200 ring-inset",
  },
  in_review: {
    value: "in_review",
    label: "In review",
    dot: "bg-utility-purple-500",
    chip: "bg-utility-purple-50 text-utility-purple-700 ring-1 ring-utility-purple-200 ring-inset",
  },
  done: {
    value: "done",
    label: "Done",
    dot: "bg-utility-green-500",
    chip: "bg-utility-green-50 text-utility-green-700 ring-1 ring-utility-green-200 ring-inset",
  },
  cancelled: {
    value: "cancelled",
    label: "Cancelled",
    dot: "bg-utility-red-500",
    chip: "bg-utility-red-50 text-utility-red-700 ring-1 ring-utility-red-200 ring-inset",
  },
};

export function statusMeta(s: BriefStatus): BriefStatusMeta {
  return BRIEF_STATUS_META[s];
}
