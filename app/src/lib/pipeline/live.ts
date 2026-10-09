// The pipeline on the tenant's own data: `briefs` (a pitch is a brief with
// status 'pitched', supabase/migrations/20261008000030_pitch_and_write.sql),
// `content_batches`, `taste_log` and `agent_settings`. Read straight from the
// server, filtered by the active site; nothing here is cached in Dexie.
//
// Decisions are status changes on the brief: the server's trigger logs each
// pitch decision in taste_log, so the app only adds what a status can't say
// (a draft sent back). Drafts are ordinary posts, created through Dexie and
// pushed before the brief points at them.

import { createPost } from "@/lib/posts";
import { createCollection } from "@/lib/collections";
import { db } from "@/lib/db";
import { coded } from "@/lib/errors";
import { currentScope, siteId } from "@/lib/scope";
import { authHeader, must, newId, sb } from "@/lib/supabase";
import { runSync, scheduleSync, waitForSyncIdle } from "@/lib/sync";
import { ymd } from "./dates";
import type {
  Batch,
  BatchState,
  Batching,
  FitReason,
  GoalEffect,
  Origin,
  OutlineLine,
  Person,
  PipelineItem,
  PipelineSettings,
  PitchNote,
  Source,
  Stage,
  TasteEntry,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** The Writer agent, as a writer to pick. */
export const AGENT_ID = "agent";

const BRIEF_COLS =
  "id,title,status,planned_date,collection_name,post,topics,fit,origin,sources,notes,outline,angle,audience,length,writer,reviewer,reject_reason,batch,scheduled_at,pitched_by,learned,changed,created,updated";

const STAGE_OF: Record<string, Stage> = {
  pitched: "pitched",
  todo: "writing",
  in_progress: "writing",
  in_review: "in_review",
  scheduled: "scheduled",
  done: "published",
  rejected: "rejected",
  backlog: "not_now",
};

const ORIGINS = new Set<Origin>(["calls", "search", "news", "watched", "team", "plan"]);

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function quarterKey(d: Date): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function quarterLabel(d: Date): string {
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/** The signed-in person: their server id is what writer, reviewer and taste_log.actor hold. */
export function meOf(): Person {
  const a = currentScope()?.account;
  return { id: a?.authId || a?.userId || "me", name: "You" };
}

function toItem(r: Row, meId: string): PipelineItem {
  const fit = (r.fit ?? {}) as { why?: string; reasons?: FitReason[]; goals?: GoalEffect[] };
  const byAgent = typeof r.pitched_by === "string" && r.pitched_by.startsWith("agent:");
  const at = r.scheduled_at ? new Date(r.scheduled_at) : null;
  const created = Date.parse(r.created) || Date.now();
  return {
    id: r.id,
    title: r.title || "Untitled",
    why: fit.why ?? "",
    stage: STAGE_OF[r.status] ?? "not_now",
    collection: r.collection_name || "",
    topics: arr<string>(r.topics),
    origin: ORIGINS.has(r.origin) ? r.origin : "team",
    reasons: arr<FitReason>(fit.reasons),
    goals: arr<GoalEffect>(fit.goals),
    // An agent's pitch is the Writer's to draft until someone picks a person.
    writerId: r.writer || (byAgent ? AGENT_ID : meId),
    reviewerId: r.reviewer || meId,
    publishBy: r.planned_date || ymd(new Date(created + 14 * 86_400_000)),
    scheduledFor: at ? { date: ymd(at), time: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` } : undefined,
    format: "blog",
    length: r.length ?? "",
    angle: r.angle ?? "",
    audience: r.audience ?? "",
    outline: arr<OutlineLine>(r.outline),
    sources: arr<Source>(r.sources),
    notes: arr<PitchNote>(r.notes),
    rejectReason: r.reject_reason || undefined,
    learned: r.learned || undefined,
    changed: r.changed || undefined,
    batch: typeof r.batch === "number" ? r.batch : null,
    postId: r.post ?? null,
    briefId: r.id,
    createdAt: created,
    updatedAt: Date.parse(r.updated) || created,
  };
}

function toBatch(r: Row): Batch {
  return {
    quarter: r.quarter,
    number: r.number,
    state: r.state as BatchState,
    quota: r.quota,
    releasedAt: r.released_at ? ymd(new Date(r.released_at)) : undefined,
    topups: r.topups ?? 0,
  };
}

function toTaste(r: Row): TasteEntry {
  return {
    id: r.id,
    at: Date.parse(r.at) || 0,
    actor: r.actor ?? "",
    objectKind: r.object_kind,
    objectId: r.object_id ?? "",
    decision: r.decision,
    reason: r.reason ?? "",
    notes: Array.isArray(r.notes) ? r.notes : undefined,
    title: r.title ?? "",
    topic: r.topic ?? "",
    angle: r.angle ?? "",
    origin: r.origin ?? "",
  };
}

export interface LiveData {
  site: string;
  items: PipelineItem[];
  batches: Batch[];
  tasteLog: TasteEntry[];
  people: Person[];
  settings: PipelineSettings;
}

/** Everything the board, the calendar and the batch panel read, for the active site. */
export async function loadLive(): Promise<LiveData> {
  const site = siteId();
  const client = sb;
  const now = new Date();
  const me = meOf();
  try {
    const [briefs, batches, taste, settings, members] = await Promise.all([
      must(
        client
          .from("briefs")
          .select(BRIEF_COLS)
          .eq("site", site)
          .neq("status", "cancelled")
          .order("created", { ascending: false })
          .limit(500),
      ),
      must(client.from("content_batches").select("quarter,number,quota,state,released_at,topups").eq("site", site).eq("quarter", quarterKey(now)).order("number")),
      must(client.from("taste_log").select("*").eq("site", site).order("at", { ascending: false }).limit(200)),
      must(client.from("agent_settings").select("batch_cadence").eq("site", site).maybeSingle()),
      must(client.from("site_members").select("user_id").eq("site", site)).catch(() => []),
    ]);
    const others: Person[] = ((members ?? []) as Row[])
      .filter((m) => m.user_id && m.user_id !== me.id)
      .map((m) => ({ id: m.user_id, name: `Member ${String(m.user_id).slice(0, 6)}` }));
    const cadence = (settings as Row | null)?.batch_cadence as Batching | undefined;
    return {
      site,
      items: ((briefs ?? []) as Row[]).map((r) => toItem(r, me.id)),
      batches: ((batches ?? []) as Row[]).map(toBatch),
      tasteLog: ((taste ?? []) as Row[]).map(toTaste).reverse(),
      people: [me, { id: AGENT_ID, name: "Agent", agent: true }, ...others],
      settings: {
        // No cadence or open slots until the Strategist's goals say so.
        cadence: 0,
        slotDays: [],
        publishTime: "09:00",
        meId: me.id,
        batching: cadence === "flood" || cadence === "live" ? cadence : "weekly",
        quarter: quarterLabel(now),
      },
    };
  } catch (err) {
    throw coded("PIPELINE-LOAD", err, "Couldn't load the pipeline. Try again.");
  }
}

async function patchBrief(id: string, values: Row): Promise<void> {
  await must(sb.from("briefs").update(values).eq("site", siteId()).eq("id", id)).catch((err) => {
    throw coded("PIPELINE-SAVE", err, "Couldn't save that. Try again.");
  });
  scheduleSync();
}

/**
 * A new draft post, pushed to the server so a brief can point at it.
 * Returns its id, or null when it couldn't be created.
 */
async function newDraft(collection: string, title: string): Promise<string | null> {
  const name = collection.trim() || (await db.collections.toCollection().first())?.name || "Posts";
  if (!(await db.collections.get(name))) await createCollection(name);
  const post = await createPost(name, { title });
  if (!post) return null;
  await runSync();
  await waitForSyncIdle();
  if (!(await db.posts.get(post.id))?.syncedAt) {
    throw coded("PIPELINE-SAVE", new Error("draft not pushed"), "Couldn't reach the server to create the draft. Try again.");
  }
  return post.id;
}

/** Ask the worker to start an agent (api/agents.ts). Resolves to why it didn't, or null when it started. */
async function startAgent(body: Row): Promise<string | null> {
  try {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: await authHeader() },
      body: JSON.stringify({ site: siteId(), ...body }),
    });
    if (res.status === 202) return null;
    const out = (await res.json().catch(() => ({}))) as { reason?: string; error?: string };
    return out.reason ?? out.error ?? `the server answered ${res.status}`;
  } catch (err) {
    throw coded("PIPELINE-AGENT", err, "Couldn't reach the agents. Try again.");
  }
}

export const live = {
  /** Approve: the brief moves to writing with its draft; the Writer starts when it's the writer. */
  async approve(item: PipelineItem, d: { writerId: string; reviewerId: string; publishBy: string; notes: PitchNote[] }): Promise<{ postId: string; agentNote: string | null }> {
    const postId = item.postId ?? (await newDraft(item.collection, item.title));
    if (!postId) throw coded("PIPELINE-SAVE", new Error("no draft"), "Couldn't create the draft. Try again.");
    await patchBrief(item.id, {
      status: "in_progress",
      post: postId,
      writer: d.writerId,
      reviewer: d.reviewerId,
      planned_date: d.publishBy,
      notes: d.notes,
    });
    const agentNote = d.writerId === AGENT_ID ? await startAgent({ agent: "writer", post: postId, task: item.title }) : null;
    return { postId, agentNote };
  },
  reject: (id: string, reason: string) => patchBrief(id, { status: "rejected", reject_reason: reason }),
  notNow: (id: string, reason: string) => patchBrief(id, { status: "backlog", reject_reason: reason }),
  sendForReview: (id: string) => patchBrief(id, { status: "in_review" }),
  async sendBack(item: PipelineItem, note: string) {
    await patchBrief(item.id, { status: "in_progress", notes: [...item.notes, { lineId: null, text: note }] });
    await must(
      sb.from("taste_log").insert({
        site: siteId(),
        object_kind: "draft",
        object_id: item.postId ?? item.id,
        decision: "sent_back",
        reason: note,
        title: item.title.slice(0, 300),
        topic: item.topics[0] ?? "",
      }),
    ).catch(() => undefined); // the log is a nicety; the status already moved
  },
  schedule: (id: string, date: string, time: string) => patchBrief(id, { status: "scheduled", scheduled_at: new Date(`${date}T${time}:00`).toISOString() }),
  saveNotes: (id: string, notes: PitchNote[]) => patchBrief(id, { notes }),
  /** The + on a column: your own pitch (no draft), or a draft in writing or review. */
  async add(stage: Stage, title: string, collection: string | null): Promise<{ id: string; postId: string | null }> {
    const id = newId();
    const postId = stage === "pitched" ? null : await newDraft(collection ?? "", title);
    const status = stage === "pitched" ? "pitched" : stage === "in_review" ? "in_review" : "in_progress";
    const me = meOf().id;
    await must(
      sb.from("briefs").insert({
        id,
        site: siteId(),
        title: title || "Untitled",
        status,
        collection_name: collection ?? "",
        post: postId,
        origin: "team",
        writer: me,
        reviewer: me,
        planned_date: ymd(new Date(Date.now() + 14 * 86_400_000)),
      }),
    ).catch((err) => {
      throw coded("PIPELINE-SAVE", err, "Couldn't add it. Try again.");
    });
    scheduleSync();
    return { id, postId };
  },
  /** A brief in writing without a draft yet (made elsewhere): make one and link it. */
  async ensureDraft(item: PipelineItem): Promise<string | null> {
    if (item.postId && (await db.posts.get(item.postId))) return item.postId;
    if (item.postId) {
      // On the server (the Writer made it) but not pulled here yet.
      await runSync();
      await waitForSyncIdle();
      return item.postId;
    }
    const postId = await newDraft(item.collection, item.title);
    if (postId) await patchBrief(item.id, { post: postId });
    return postId;
  },
  /** "That's enough": a member closes an open batch. */
  closeBatch: async (quarter: string, number: number) => {
    await must(sb.from("content_batches").update({ state: "closed" }).eq("site", siteId()).eq("quarter", quarter).eq("number", number)).catch((err) => {
      throw coded("PIPELINE-SAVE", err, "Couldn't close the batch. Try again.");
    });
  },
  /** Run now: the Pitcher sends the next batch. Resolves to why it didn't start, or null. */
  nextBatch: () => startAgent({ agent: "pitcher" }),
};
