// The Goals adapter on the real tables (supabase/migrations/20261009000070_strategist.sql):
// the Strategist's proposals, approved goal versions, the onboarding answers
// and the plan drop, the content batches and the batching setting.
//
// Read live from the server (none of these tables sync to Dexie), once per
// site and again after every change. A proposal arrives from the worker: a
// realtime event says so (lib/realtime.ts through lib/serverChanges.ts), and
// in case none comes (no realtime on this server, a dropped connection) it
// reads again every 5 seconds while a Strategist run is in flight, every 30
// seconds otherwise, and on coming back to the tab. Until the tables are on the
// server (PostgREST: table not found), lib/goals/adapter.ts keeps serving the
// placeholder, so the page works either way.
//
// Not live yet, and empty here: the daily goal scores (goal_scores), the
// Readership, Consistency and Ranking "now" numbers, and the Launch card.

import { must, newId, sb, BackendError } from "@/lib/supabase";
import { onScopeReset, siteId } from "@/lib/scope";
import { coded } from "@/lib/errors";
import { reportError } from "@/lib/telemetry";
import { onServerChange, serverChanged } from "@/lib/serverChanges";
import { quarterEnd, quarterOf, quarterStart, shiftQuarter, toDay, addDays } from "./quarter";
import type { GoalsAdapter } from "./adapter";
import type {
  BatchBrief,
  BatchBriefState,
  BatchCadence,
  BatchPlan,
  ContentBatch,
  Day,
  GoalTargets,
  GoalVersion,
  PlanDrop,
  PlanFile,
  PlanFileKind,
  Proposal,
  ProposalEdit,
  QuarterGoals,
  QuarterKey,
  StrategyAnswers,
  VolumeNow,
} from "./types";

interface ProposalRow {
  id: string;
  quarter: QuarterKey;
  kind: Proposal["kind"];
  status: "requested" | "running" | "sent" | "approved" | "superseded" | "failed";
  request: string;
  proposal: Omit<Proposal, "id" | "status" | "createdAt"> | null;
  error: string;
  created: string;
  approved_by: string;
  approved_at: string | null;
}

interface VersionRow {
  quarter: QuarterKey;
  version: number;
  targets: GoalTargets;
  changes: string[];
  note: string;
  covers: { from: Day; to: Day; weeks: number; prorated: boolean } | null;
  approved_by: string;
  approved_at: string;
}

interface ProfileRow {
  answers: Partial<StrategyAnswers>;
  plan_text: string;
  plan_files: { id: string; name: string; size: number; kind: PlanFileKind; url: string; uploadedAt: Day }[];
  plan_read_at: string | null;
}

interface BatchRow {
  quarter: QuarterKey;
  number: number;
  quota: number;
  state: "pending" | "in_review" | "topping_up" | "closed" | "cancelled";
  released_at: string | null;
}

interface BriefRow {
  id: string;
  title: string;
  status: string;
  topics: string[] | null;
  origin: string;
  batch: number | null;
  pitched_by: string;
  post: string | null;
  planned_date: string | null;
  created: string;
}

interface State {
  site: string;
  proposals: ProposalRow[];
  versions: VersionRow[];
  profile: ProfileRow | null;
  cadence: BatchCadence;
  batches: BatchRow[];
  briefs: BriefRow[];
  /** Published posts: id → day published. */
  published: Map<string, Day>;
}

/** null: not loaded yet. "missing": the tables aren't on this server. */
let state: State | null | "missing" = null;
let loading: Promise<void> | null = null;
let ver = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let stopEvents: (() => void) | null = null;
let loadedAt = 0;
const POLL_MS = 30_000;
const RUNNING_POLL_MS = 5_000;

function emit() {
  ver++;
  for (const l of listeners) l();
}

onScopeReset(() => {
  state = null;
  loading = null;
  emit();
});

const isMissing = (err: unknown) => err instanceof BackendError && (err.code === "PGRST205" || err.code === "42P01" || err.status === 404);

async function load(site: string): Promise<void> {
  const client = sb;
  try {
    const [proposals, versions, profile, settings, batches, briefs, posts] = await Promise.all([
      must(client.from("strategy_proposals").select("id,quarter,kind,status,request,proposal,error,created,approved_by,approved_at").eq("site", site).order("created")),
      must(client.from("goal_versions").select("quarter,version,targets,changes,note,covers,approved_by,approved_at").eq("site", site).order("version")),
      must(client.from("tenant_profile").select("answers,plan_text,plan_files,plan_read_at").eq("site", site).maybeSingle()),
      must(client.from("agent_settings").select("batch_cadence").eq("site", site).maybeSingle()).catch(() => null),
      must(client.from("content_batches").select("quarter,number,quota,state,released_at").eq("site", site).order("number")).catch(() => []),
      must(
        client
          .from("briefs")
          .select("id,title,status,topics,origin,batch,pitched_by,post,planned_date,created")
          .eq("site", site)
          .gte("created", `${quarterStart(shiftQuarter(quarterOf(toDay(new Date())), -1))}T00:00:00Z`)
          .limit(1000),
      ).catch(() => []),
      must(
        client
          .from("posts")
          .select("id,published_at")
          .eq("site", site)
          .eq("status", "published")
          .gte("published_at", `${quarterStart(shiftQuarter(quarterOf(toDay(new Date())), -1))}T00:00:00Z`)
          .limit(2000),
      ),
    ]);
    if (siteOrNull() !== site) return; // switched site while loading
    const was = state && state !== "missing" && state.site === site ? proposalKey(state.proposals) : null;
    state = {
      site,
      proposals: proposals as ProposalRow[],
      versions: versions as VersionRow[],
      profile: (profile as ProfileRow | null) ?? null,
      cadence: ((settings as { batch_cadence?: BatchCadence } | null)?.batch_cadence ?? "weekly") as BatchCadence,
      batches: batches as BatchRow[],
      briefs: briefs as BriefRow[],
      published: new Map((posts as { id: string; published_at: string | null }[]).filter((p) => p.published_at).map((p) => [p.id, p.published_at!.slice(0, 10)])),
    };
    loadedAt = Date.now();
    // Noticed here first (a poll, not an event): the Inbox badge reads its own count.
    if (was !== null && was !== proposalKey(state.proposals)) serverChanged("strategy", "goals");
  } catch (err) {
    // Tables not on this server, or the server didn't answer: the placeholder
    // serves the page, and we ask again in a minute (never in a loop).
    state = "missing";
    if (!isMissing(err)) reportError("goals.load", coded("GOALS-LOAD", err));
    setTimeout(() => {
      if (state === "missing" && siteOrNull() === site) {
        state = null;
        emit();
      }
    }, 60_000);
  }
  emit();
}

function proposalKey(rows: ProposalRow[]): string {
  return rows.map((p) => `${p.id}:${p.status}`).join(",");
}

/** A Strategist run asked for or being written. */
function running(): boolean {
  if (!state || state === "missing") return false;
  const newest = state.proposals[state.proposals.length - 1];
  return newest?.status === "requested" || newest?.status === "running";
}

function tick() {
  if (!listeners.size || !state || state === "missing" || loading) return;
  if (document.visibilityState !== "visible") return;
  if (Date.now() - loadedAt >= (running() ? RUNNING_POLL_MS : POLL_MS)) void refreshGoals();
}

const onVisible = () => {
  if (document.visibilityState === "visible" && listeners.size && state && state !== "missing") void refreshGoals();
};

function siteOrNull(): string | null {
  try {
    return siteId();
  } catch {
    return null;
  }
}

/** Load (once) for the active site; refresh every 30s while someone listens. */
function ensure(): void {
  const site = siteOrNull();
  if (!site) return;
  if (state && state !== "missing" && state.site !== site) state = null;
  if (state === null && !loading) {
    loading = load(site).finally(() => (loading = null));
  }
}

export function refreshGoals(): Promise<void> {
  const site = siteOrNull();
  if (!site) return Promise.resolve();
  return (loading = load(site).finally(() => (loading = null)));
}

/** True once the server answered that the goal tables exist. */
export function liveGoalsReady(): boolean {
  ensure();
  return state !== null && state !== "missing";
}

/** True while it's still asking, or when the tables are there (the placeholder shouldn't flash). */
export function liveGoalsPending(): boolean {
  ensure();
  return state === null;
}

/** A tenant with nothing yet: what the pages show before the first load, or when it fails. */
function emptyState(site: string): State {
  return { site, proposals: [], versions: [], profile: null, cadence: "weekly", batches: [], briefs: [], published: new Map() };
}

function s(): State {
  ensure();
  if (state && state !== "missing") return state;
  // Outside the UI preview the pages never fall back to sample data: an empty
  // tenant until the server answers.
  return emptyState(siteOrNull() ?? "");
}

const today = (): Day => toDay(new Date());

// ---- mapping ----

function versionOf(v: VersionRow): GoalVersion {
  return {
    quarter: v.quarter,
    version: v.version,
    approvedAt: v.approved_at.slice(0, 10),
    approvedBy: v.approved_by ? "Your team" : "",
    changes: v.changes ?? [],
    note: v.note || undefined,
    targets: v.targets,
    covers: v.covers?.prorated ? { from: v.covers.from, weeks: v.covers.weeks } : undefined,
  };
}

function proposalOf(row: ProposalRow, status: Proposal["status"], changeRequest?: string): Proposal | null {
  if (!row.proposal) return null;
  return {
    ...row.proposal,
    id: row.id,
    quarter: row.proposal.quarter ?? row.quarter,
    kind: row.kind,
    status,
    createdAt: row.created.slice(0, 10),
    approvedAt: row.approved_at?.slice(0, 10),
    approvedBy: row.approved_at ? "Your team" : undefined,
    changeRequest,
    questions: row.proposal.questions ?? [],
  };
}

function volumeNow(quarter: QuarterKey): VolumeNow {
  const st = s();
  const from = quarterStart(quarter);
  const to = quarterEnd(quarter);
  const byTopic: Record<string, number> = {};
  const pitchedByTopic: Record<string, number> = {};
  const rejectedByTopic: Record<string, number> = {};
  const topicsOfPost = new Map(st.briefs.filter((b) => b.post).map((b) => [b.post!, b.topics ?? []]));
  let published = 0;
  for (const [id, day] of st.published) {
    if (day < from || day > to) continue;
    published++;
    for (const t of new Set(topicsOfPost.get(id) ?? [])) byTopic[t] = (byTopic[t] ?? 0) + 1;
  }
  for (const b of st.briefs) {
    if (!b.pitched_by || b.created.slice(0, 10) < from || b.created.slice(0, 10) > to) continue;
    for (const t of new Set(b.topics ?? [])) {
      pitchedByTopic[t] = (pitchedByTopic[t] ?? 0) + 1;
      if (b.status === "rejected") rejectedByTopic[t] = (rejectedByTopic[t] ?? 0) + 1;
    }
  }
  return { published, byTopic, pitchedByTopic, rejectedByTopic, bonus: 0 };
}

const APPROVED = new Set(["todo", "in_progress", "in_review", "scheduled", "done"]);

function briefState(b: BriefRow, publishedOn: Day | undefined): BatchBriefState {
  if (publishedOn) return "published";
  if (b.status === "rejected" || b.status === "cancelled") return "rejected";
  if (b.status === "scheduled") return "scheduled";
  if (b.status === "in_review") return "drafted";
  if (APPROVED.has(b.status)) return "approved";
  return "brief";
}

const INTERNAL = new Set(["calls", "team", "plan"]);

/** What each edit says on the version's history: "Volume 20 → 18". */
function changeLines(edits: ProposalEdit[]): string[] {
  return edits.map((e) => `${e.field} ${e.from} → ${e.to}`).slice(0, 50);
}

function fileKind(name: string): PlanFileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "doc";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["csv", "xls", "xlsx", "ods"].includes(ext)) return "spreadsheet";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "image";
  return "text";
}

async function upload(site: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("site", site);
  form.append("file", file);
  const { data } = await sb.auth.getSession();
  const res = await fetch("/api/upload", {
    method: "POST",
    body: form,
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
  });
  if (!res.ok) throw new Error(`Upload answered ${res.status}`);
  return ((await res.json()) as { url: string }).url;
}

async function saveProfile(values: Partial<{ answers: StrategyAnswers; plan_text: string; plan_files: ProfileRow["plan_files"] }>): Promise<void> {
  const st = s();
  const row = { site: st.site, ...values };
  await must(sb.from("tenant_profile").upsert(row, { onConflict: "site" }));
}

// ---- the adapter ----

export const liveAdapter: GoalsAdapter & {
  /** Ask the Strategist for a proposal (onboarding, a revision, or "Run it now"). */
  askStrategist(kind: Proposal["kind"], note: string, quarter?: QuarterKey): Promise<string>;
  /** The newest proposal row's state, for "working on it" and "failed" lines. */
  strategistState(): { status: ProposalRow["status"]; error: string; created: string } | null;
} = {
  placeholder: false,
  subscribe(cb) {
    listeners.add(cb);
    ensure();
    if (!timer) {
      timer = setInterval(tick, RUNNING_POLL_MS);
      document.addEventListener("visibilitychange", onVisible);
      stopEvents = onServerChange("strategy", (from) => {
        if (from !== "goals" && state !== "missing") void refreshGoals();
      });
    }
    return () => {
      listeners.delete(cb);
      if (!listeners.size && timer) {
        clearInterval(timer);
        timer = null;
        document.removeEventListener("visibilitychange", onVisible);
        stopEvents?.();
        stopEvents = null;
      }
    };
  },
  version: () => ver,

  context() {
    const st = s();
    const first = st.versions[0]?.approved_at.slice(0, 10) ?? st.proposals[0]?.created.slice(0, 10) ?? today();
    return { joinedAt: first, today: today() };
  },

  quarters() {
    const cur = quarterOf(today());
    const st = s();
    const firstDay = [st.versions[0]?.approved_at, st.proposals[0]?.created].filter(Boolean).map((d) => d!.slice(0, 10)).sort()[0] ?? today();
    const out: QuarterKey[] = [];
    for (let k = quarterOf(firstDay < today() ? firstDay : today()); k <= cur; k = shiftQuarter(k, 1)) out.push(k);
    out.push(shiftQuarter(cur, 1));
    return out;
  },

  quarterGoals(quarter): QuarterGoals {
    const st = s();
    const history = st.versions.filter((v) => v.quarter === quarter).map(versionOf);
    return {
      quarter,
      current: history.length ? history[history.length - 1] : null,
      history,
      scores: { volume: [], consistency: [], readership: [], ranking: [] },
      now: {
        volume: volumeNow(quarter),
        consistency: { contentGrade: null, kbGrade: null, contentClean: null, kbClean: null },
        readership: { pageviews: 0, pagesPerSession: 0, corpusMinutes: 0, secondsPerPost: 0 },
        ranking: { positions: {}, aiMentions: 0 },
      },
    };
  },

  proposal(quarter) {
    const rows = s().proposals.filter((p) => p.quarter === quarter || p.proposal?.quarter === quarter);
    const sent = [...rows].reverse().find((p) => p.status === "sent" || p.status === "approved");
    const newest = rows[rows.length - 1];
    // A revision being written: the proposal it replaces, marked as being revised.
    if (newest && (newest.status === "requested" || newest.status === "running") && sent?.status === "sent") {
      return proposalOf(sent, "changes_requested", newest.request);
    }
    if (!sent) return null;
    return proposalOf(sent, sent.status === "approved" ? "approved" : "sent");
  },

  launch() {
    return null;
  },

  batchPlan(quarter): BatchPlan | null {
    const st = s();
    const rows = st.batches.filter((b) => b.quarter === quarter);
    const goals = st.versions.filter((v) => v.quarter === quarter).pop();
    // No batches until the Pitcher opens the quarter's first one.
    if (!rows.length) return null;
    const batches: ContentBatch[] = rows.map((b) => {
      const briefs: BatchBrief[] = st.briefs
        .filter((x) => x.batch === b.number && x.pitched_by && quarterOf(x.created.slice(0, 10)) === quarter)
        .map((x) => ({
          id: x.id,
          title: x.title,
          topic: (x.topics ?? []).join(" + "),
          origin: INTERNAL.has(x.origin) ? "internal" : "external",
          state: briefState(x, x.post ? st.published.get(x.post) : undefined),
          publishOn: x.planned_date ?? undefined,
        }));
      return {
        id: `${quarter}-b${b.number}`,
        quarter,
        number: b.number,
        dueAt: (b.released_at ?? "").slice(0, 10) || addDays(today(), 7),
        state: b.state === "pending" ? "pending" : b.state === "in_review" || b.state === "topping_up" ? "in_review" : "decided",
        briefs,
      };
    });
    return {
      quarter,
      cadence: st.cadence,
      planned: goals?.targets.volume.total ?? batches.reduce((n, b) => n + b.briefs.length, 0),
      batches,
      bonus: { count: 0, sources: [] },
      pushedToNext: 0,
      allWrittenBy: addDays(quarterStart(quarter), 60),
    };
  },

  planDrop(): PlanDrop {
    const p = s().profile;
    return {
      text: p?.plan_text ?? "",
      files: (p?.plan_files ?? []).map((f): PlanFile => ({ id: f.id, name: f.name, size: f.size, kind: f.kind, uploadedAt: f.uploadedAt })),
      readAt: p?.plan_read_at?.slice(0, 10) ?? null,
    };
  },

  async approveProposal(id, edited, edits) {
    const st = s();
    const row = st.proposals.find((p) => p.id === id);
    if (!row) throw coded("GOALS-APPROVE", new Error("No such proposal"));
    const targets: GoalTargets = {
      volume: { total: edited.volume.value, topics: edited.topics.map(({ name, low, high }) => ({ name, low, high })) },
      readership: { pageviews: edited.readership.value, pagesPerSession: null, corpusMinutes: null, secondsPerPost: null },
      ranking: {
        searches: edited.ranking.searches.map(({ query, topic, position, volume, difficulty }) => ({ query, topic, position, volume, difficulty })),
        pageOneTarget: edited.ranking.pageOneTarget.value,
        aiMentionTarget: edited.ranking.aiMentionTarget.value,
      },
    };
    const version = (await must(
      sb.rpc("strategy_approve", {
        p_proposal: id,
        p_targets: targets,
        p_edits: edits,
        p_changes: st.versions.some((v) => v.quarter === row.quarter) ? changeLines(edits) : [],
        p_note: edits.find((e) => e.reason)?.reason ?? "",
        p_watched: edited.watchedSites,
      }),
    ).catch((err) => {
      throw coded("GOALS-APPROVE", err, "Couldn't approve the goals. Try again.");
    })) as number;
    await refreshGoals();
    return (
      s().versions.filter((v) => v.quarter === row.quarter).map(versionOf).pop() ?? {
        quarter: row.quarter,
        version,
        approvedAt: today(),
        approvedBy: "Your team",
        changes: changeLines(edits),
        targets,
      }
    );
  },

  async requestChanges(id, note) {
    const row = s().proposals.find((p) => p.id === id);
    await liveAdapter.askStrategist("revision", note, row?.quarter);
  },

  async askStrategist(kind, note, quarter) {
    const st = s();
    const q = quarter ?? quarterOf(today());
    const id = (await must(sb.rpc("strategy_request", { p_site: st.site, p_kind: kind, p_quarter: q, p_request: note })).catch((err) => {
      throw coded("GOALS-REQUEST", err, "Couldn't reach the Strategist. Try again.");
    })) as string;
    await refreshGoals();
    return id;
  },

  strategistState() {
    const rows = s().proposals;
    const newest = rows[rows.length - 1];
    return newest ? { status: newest.status, error: newest.error, created: newest.created } : null;
  },

  async savePlanDrop(text, files) {
    const st = s();
    const added: ProfileRow["plan_files"] = [];
    try {
      for (const f of files) {
        const url = await upload(st.site, f);
        added.push({ id: newId(), name: f.name, size: f.size, kind: fileKind(f.name), url, uploadedAt: today() });
      }
      await saveProfile({ plan_text: text, plan_files: [...(st.profile?.plan_files ?? []), ...added] });
    } catch (err) {
      throw coded("GOALS-PLAN-SAVE", err, "Couldn't save your plan. Try again.");
    }
    await refreshGoals();
    return liveAdapter.planDrop();
  },

  async removePlanFile(id) {
    const st = s();
    await saveProfile({ plan_files: (st.profile?.plan_files ?? []).filter((f) => f.id !== id) }).catch((err) => {
      throw coded("GOALS-PLAN-SAVE", err, "Couldn't remove the file. Try again.");
    });
    await refreshGoals();
  },

  async setBatchCadence(cadence) {
    const st = s();
    await must(sb.from("agent_settings").upsert({ site: st.site, batch_cadence: cadence }, { onConflict: "site" })).catch((err) => {
      throw coded("GOALS-CADENCE", err, "Couldn't change the batching. Try again.");
    });
    await refreshGoals();
  },

  async requestNextBatch() {
    // The Pitcher's "send me the next batch" goes through Chat today (PR #43);
    // the Batches tab sends people there.
    return null;
  },

  strategyAnswers(site) {
    const st = s();
    const a = st.site === site ? (st.profile?.answers ?? {}) : {};
    return { offer: a.offer ?? "", searches: a.searches ?? "", watch: a.watch ?? "", upcoming: a.upcoming ?? "" };
  },

  async saveStrategyAnswers(_site, answers) {
    await saveProfile({ answers }).catch((err) => {
      throw coded("GOALS-PROFILE-SAVE", err, "Couldn't save your answers. Try again.");
    });
    await refreshGoals();
  },
};
