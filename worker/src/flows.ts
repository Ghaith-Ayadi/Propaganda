// Admin > Runs groups runs into flows: the runs that belong together, in the
// order they ran, so a step shows next to the ones before and after it.
//
//   GET /flows?limit&offset&site&hide=<kind,kind>   { flows, kinds, costLog, next }
//
// A flow starts at a run nobody started (a schedule, a poll, Chat, Run now)
// and holds what it started, its retries and what came next:
//
//   1. children: a run a workflow started (DBOS records the parent);
//   2. retries: a fork of a failed run sits right after the run it retried;
//   3. day one: the plan's drafts (first-drafts-<proposal>, started by a poll
//      once the plan is approved) join the Strategist's run for that proposal
//      (strategist-<proposal>): together they are the onboarding sequence.
//
// Each flow has a kind (Onboarding sequence, Granola sweep, Checker...) in one
// of three categories, which the page's Display chips show or hide: agents
// (one agent's run), flows (sequences), crons (the pulls and sweeps that run
// on a clock). Hidden kinds are left out of the query itself, so a quarter
// hour of Meet polls never pushes real work off the page.
//
// Nothing here writes: it reads DBOS's record through its management API and
// the cost log, like runs.ts.

import { DBOS, type WorkflowStatus } from "@dbos-inc/dbos-sdk";
import type { Pool } from "pg";
import { isMissing, select } from "./agents/backend.js";
import { costs, stallOf, summary, type Cost, type RunState, type RunSummary } from "./runs.js";

export type Category = "agents" | "flows" | "crons";
const CATEGORIES: Category[] = ["agents", "flows", "crons"];

export interface Kind {
  id: string;
  label: string;
  category: Category;
  /** The workflows a flow of this kind starts with. */
  names: string[];
}

// Every workflow the worker registers is in one kind (test/flows.mjs checks).
export const KINDS: Kind[] = [
  { id: "onboarding", label: "Onboarding sequence", category: "flows", names: ["strategist", "strategist:first-pitches", "strategist:first-drafts"] },
  { id: "strategist", label: "Strategist proposals", category: "flows", names: ["strategist", "strategist:first-pitches", "strategist:first-drafts"] },
  { id: "morning-batches", label: "Morning batches", category: "flows", names: ["pitcher:daily-batches"] },
  { id: "weekly-scout", label: "Weekly scout", category: "flows", names: ["scout-weekly"] },

  { id: "checker", label: "Checker", category: "agents", names: ["checker", "checker-recheck", "checker-contest"] },
  { id: "guardian", label: "Guardian", category: "agents", names: ["guardian"] },
  { id: "pitcher", label: "Pitcher", category: "agents", names: ["pitcher", "pitcher:request", "pitcher:batch", "pitcher:batch-request"] },
  { id: "writer", label: "Writer", category: "agents", names: ["writer", "writer:revise", "writer:voice-guide", "writer:voice-suggest"] },
  { id: "scout", label: "Scout", category: "agents", names: ["scout"] },
  { id: "listener", label: "Listener", category: "agents", names: ["listener", "slack-thread", "granola-note", "zoom-transcript", "meet-transcript", "teams-transcript"] },
  { id: "strategist-runs", label: "Strategist", category: "agents", names: ["strategist:weekly-check", "strategist:replace", "strategist:topic-pitches"] },
  { id: "demo", label: "Demo", category: "agents", names: ["demo", "demo-agent"] },

  { id: "granola-sweep", label: "Granola sweep", category: "crons", names: ["granola-sweep"] },
  { id: "meet-poll", label: "Meet poll", category: "crons", names: ["meet-poll"] },
  { id: "teams-renewal", label: "Teams renewal", category: "crons", names: ["teams-renew-scheduled", "teams-renew"] },
  { id: "strategist-weekly", label: "Strategist weekly check", category: "crons", names: ["strategist:weekly"] },
  { id: "strategist-quarterly", label: "Quarterly proposals", category: "crons", names: ["strategist:quarterly"] },
];

/** What the page hides until someone shows it: every cron. */
export const HIDDEN_BY_DEFAULT = KINDS.filter((k) => k.category === "crons").map((k) => k.id);

// A workflow missing from KINDS (test/flows.mjs fails on it) still shows, under its own name.
const OTHER: Kind = { id: "other", label: "Other", category: "agents", names: [] };

/** A run's name in a flow, for a person. */
const RUN_LABELS: Record<string, string> = {
  strategist: "Strategist: the plan",
  "strategist:first-pitches": "First pitches",
  "strategist:topic-pitches": "Pitches for one topic",
  "strategist:first-drafts": "First drafts",
  "strategist:replace": "Replacement pitch",
  "strategist:weekly-check": "Weekly goal check",
  "strategist:weekly": "Strategist weekly check",
  "strategist:quarterly": "Quarterly proposals",
  writer: "Writer: draft",
  "writer:revise": "Writer: revision",
  "writer:voice-guide": "Writer: voice guide",
  "writer:voice-suggest": "Writer: voice suggestions",
  pitcher: "Pitcher",
  "pitcher:request": "Pitcher: on request",
  "pitcher:batch": "Pitcher: batch",
  "pitcher:batch-request": "Pitcher: batch on request",
  "pitcher:daily-batches": "Morning batches",
  checker: "Checker",
  "checker-recheck": "Checker: re-check",
  "checker-contest": "Checker: contest",
  guardian: "Guardian",
  scout: "Scout",
  "scout-weekly": "Weekly scout",
  listener: "Listener",
  "slack-thread": "Listener: Slack thread",
  "granola-note": "Listener: Granola note",
  "zoom-transcript": "Listener: Zoom transcript",
  "meet-transcript": "Listener: Meet transcript",
  "teams-transcript": "Listener: Teams transcript",
  "granola-sweep": "Granola sweep",
  "meet-poll": "Meet poll",
  "teams-renew-scheduled": "Teams renewal",
  "teams-renew": "Teams renewal",
  demo: "Demo run",
  "demo-agent": "Demo agent",
};

export interface FlowRun extends RunSummary {
  label: string;
  /** 0 for the flow's own steps, 1 for what one of them started, and so on. */
  depth: number;
  /** For a retry: the run it tried again. */
  retryOf: string | null;
  /** A failed or cancelled run a later retry replaced. */
  superseded: boolean;
}

export interface Flow {
  /** The first run's id. */
  id: string;
  kind: string;
  category: Category;
  label: string;
  site: string | null;
  state: RunState;
  startedAt: number;
  /** null while anything in it is still going. */
  endedAt: number | null;
  cost: Cost | null;
  /** Retries: forks of a failed run (Retry on the page). */
  retries: number;
  /** DBOS's own restarts of a run (after the worker restarted mid-run). */
  restarts: number;
  /** Runs that failed, retried or not. */
  failures: number;
  runs: FlowRun[];
}

const proposalOfStrategist = (id: string) => /^strategist-(.+)$/.exec(id)?.[1] ?? null;
const proposalOfDrafts = (id: string) => /^first-drafts-(.+)$/.exec(id)?.[1] ?? null;

function runLabel(r: RunSummary): string {
  const topic = r.name === "strategist:topic-pitches" ? /-t(\d+)$/.exec(r.id) : null;
  if (topic) return `Pitches for topic ${Number(topic[1]) + 1}`;
  return RUN_LABELS[r.name] ?? r.name;
}

const ACTIVE: RunState[] = ["stalled", "running", "queued"];

function kindOf(root: RunSummary, proposalKinds: Map<string, string>): { kind: Kind; label: string } {
  if (root.name === "strategist") {
    const p = proposalOfStrategist(root.id);
    const k = p ? proposalKinds.get(p) : undefined;
    if (k === "onboarding") return { kind: KINDS.find((x) => x.id === "onboarding")!, label: "Onboarding sequence" };
    const strategist = KINDS.find((x) => x.id === "strategist")!;
    return { kind: strategist, label: k === "revision" ? "Goal revision" : k === "quarterly" ? "Quarterly proposal" : "Strategist proposal" };
  }
  // Day one's drafts on their own (the plan's run is older than the page).
  if (root.name === "strategist:first-drafts" || root.name === "strategist:first-pitches") {
    return { kind: KINDS.find((x) => x.id === "strategist")!, label: "Strategist proposal" };
  }
  const kind = KINDS.find((k) => k.id !== "onboarding" && k.names.includes(root.name)) ?? OTHER;
  return { kind, label: kind.category === "agents" ? runLabel(root) : kind.label };
}

/**
 * Group runs into flows (pure, for the test). `proposalKinds` maps a
 * Strategist proposal id to its kind (onboarding, revision, quarterly).
 */
export function groupFlows(runs: RunSummary[], proposalKinds: Map<string, string> = new Map()): Flow[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const strategistOf = (r: RunSummary) => {
    const p = r.name === "strategist:first-drafts" ? proposalOfDrafts(r.id) : null;
    return p && byId.has(`strategist-${p}`) ? `strategist-${p}` : null;
  };
  // Where a run hangs: after the run it retried, under its parent, or after the plan it drafts for.
  const attach = (r: RunSummary): { to: string; how: "retry" | "child" | "next" } | null => {
    if (r.forkedFrom && byId.has(r.forkedFrom)) return { to: r.forkedFrom, how: "retry" };
    if (r.parentId && byId.has(r.parentId)) return { to: r.parentId, how: "child" };
    const s = strategistOf(r);
    return s ? { to: s, how: "next" } : null;
  };
  const rootOf = (r: RunSummary): RunSummary => {
    let at = r;
    const seen = new Set<string>();
    for (let a = attach(at); a && !seen.has(a.to); a = attach(at)) {
      seen.add(at.id);
      at = byId.get(a.to)!;
    }
    return at;
  };

  const retries = new Map<string, RunSummary[]>();
  const children = new Map<string, RunSummary[]>();
  const next = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const a = attach(r);
    if (!a) continue;
    const into = a.how === "retry" ? retries : a.how === "child" ? children : next;
    into.set(a.to, [...(into.get(a.to) ?? []), r]);
  }
  const byStart = (a: RunSummary, b: RunSummary) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

  const flows: Flow[] = [];
  for (const root of runs) {
    if (rootOf(root) !== root) continue;
    const out: FlowRun[] = [];
    const emitted = new Set<string>();
    const emit = (r: RunSummary, depth: number, retryOf: string | null) => {
      if (emitted.has(r.id)) return;
      emitted.add(r.id);
      const tries = (retries.get(r.id) ?? []).sort(byStart);
      out.push({ ...r, label: runLabel(r), depth, retryOf, superseded: tries.length > 0 && (r.state === "failed" || r.state === "cancelled") });
      for (const c of (children.get(r.id) ?? []).sort(byStart)) emit(c, depth + 1, null);
      for (const t of tries) emit(t, depth, r.id);
    };
    emit(root, 0, null);
    for (const n of (next.get(root.id) ?? []).sort(byStart)) emit(n, 0, null);

    const live = out.filter((r) => !r.superseded);
    const active = ACTIVE.find((s) => live.some((r) => r.state === s));
    const state: RunState = active ?? (live.some((r) => r.state === "failed") ? "failed" : live[0]!.state === "cancelled" ? "cancelled" : "done");
    const ends = out.map((r) => r.completedAt ?? r.updatedAt ?? r.createdAt);
    const priced = out.every((r) => r.cost !== null);
    const { kind, label } = kindOf(root, proposalKinds);
    flows.push({
      id: root.id,
      kind: kind.id,
      category: kind.category,
      label,
      site: root.site ?? out.find((r) => r.site)?.site ?? null,
      state,
      startedAt: Math.min(...out.map((r) => r.createdAt)),
      endedAt: active ? null : Math.max(...ends),
      cost: priced
        ? out.reduce<Cost>((c, r) => ({ usd: c.usd + r.cost!.usd, calls: c.calls + r.cost!.calls, unpriced: c.unpriced + r.cost!.unpriced }), { usd: 0, calls: 0, unpriced: 0 })
        : null,
      retries: out.filter((r) => r.retryOf).length,
      restarts: out.reduce((n, r) => n + Math.max(0, r.recoveryAttempts - 1), 0),
      failures: out.filter((r) => r.state === "failed").length,
      runs: out,
    });
  }
  return flows.sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
}

const LIST = { loadInput: false, loadOutput: false } as const;

/** The proposals' kinds, for the Strategist's flows; empty when they can't be read (no tables, no PostgREST). */
async function proposalKindsOf(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  try {
    const rows = await select<{ id: string; kind: string }>("strategy_proposals", `id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,kind`);
    return new Map(rows.map((r) => [r.id, r.kind]));
  } catch (err) {
    if (!isMissing(err)) DBOS.logger.warn(`flows: proposal kinds: ${(err as Error).message}`);
    return new Map();
  }
}

export interface FlowQuery {
  site?: string;
  /** Kind ids, or category names, to leave out. */
  hide?: string[];
  limit?: number;
  offset?: number;
}

export async function listFlows(db: Pool, q: FlowQuery): Promise<{ flows: Flow[]; kinds: Kind[]; costLog: boolean; next: number | null }> {
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 100);
  const offset = Math.max(q.offset ?? 0, 0);
  // A category name ("crons") hides every kind in it.
  const hidden = new Set((q.hide ?? []).flatMap((h) => (CATEGORIES.includes(h as Category) ? KINDS.filter((k) => k.category === h).map((k) => k.id) : [h])));
  // A workflow is asked for when any kind it can start is shown.
  const names = hidden.size ? [...new Set(KINDS.filter((k) => !hidden.has(k.id)).flatMap((k) => k.names))] : undefined;
  const roots =
    names && names.length === 0
      ? []
      : await DBOS.listWorkflows({ hasParent: false, workflowName: names, attributes: q.site ? { site: q.site } : undefined, limit: limit + 1, offset, sortDesc: true, ...LIST });
  const next = roots.length > limit ? offset + limit : null;
  const found = new Map<string, WorkflowStatus>(roots.slice(0, limit).map((w) => [w.workflowID, w]));

  // What the roots are linked to: the run a retry retried (and its parent), day one's other half.
  for (let level = 0; level < 3; level++) {
    const linked = new Set<string>();
    for (const w of found.values()) {
      if (w.forkedFrom) linked.add(w.forkedFrom);
      if (w.parentWorkflowID) linked.add(w.parentWorkflowID);
      const drafts = proposalOfDrafts(w.workflowID);
      if (drafts && w.workflowName === "strategist:first-drafts") linked.add(`strategist-${drafts}`);
      const plan = proposalOfStrategist(w.workflowID);
      if (plan && w.workflowName === "strategist") linked.add(`first-drafts-${plan}`);
    }
    const want = [...linked].filter((id) => !found.has(id));
    if (!want.length) break;
    for (const w of await DBOS.listWorkflows({ workflowIDs: want, ...LIST })) found.set(w.workflowID, w);
  }

  // Then what they started and their retries, a few levels down.
  let frontier = [...found.keys()];
  for (let level = 0; level < 4 && frontier.length; level++) {
    const [kids, forks] = await Promise.all([
      DBOS.listWorkflows({ parentWorkflowID: frontier, limit: 1000, ...LIST }),
      DBOS.listWorkflows({ forkedFrom: frontier, limit: 1000, ...LIST }),
    ]);
    frontier = [];
    for (const w of [...kids, ...forks]) {
      if (found.has(w.workflowID)) continue;
      found.set(w.workflowID, w);
      frontier.push(w.workflowID);
    }
  }

  const all = [...found.values()];
  const [stalls, cost, kinds] = await Promise.all([
    Promise.all(all.map(stallOf)),
    costs(db, all.map((w) => w.workflowID), false),
    proposalKindsOf(all.filter((w) => w.workflowName === "strategist").map((w) => proposalOfStrategist(w.workflowID)).filter((p): p is string => !!p)),
  ]);
  const runs = all.map((w, i) => summary(w, stalls[i] ?? null, cost));
  // The query hides by workflow name; "onboarding" and "strategist" share theirs, so hide by kind too.
  const flows = groupFlows(runs, kinds).filter((f) => !hidden.has(f.kind));
  return { flows, kinds: KINDS, costLog: cost !== null, next };
}
