// The Strategist's reads and writes (supabase/migrations/20261009000070_strategist.sql),
// over PostgREST with the service key (backend.ts). It writes only its own
// rows: proposals, the plan's read mark, drift notes. Goal versions are only
// ever written by strategy_approve(), which a member calls.

import { enc, insert, isMissing, patch, select } from "./backend.js";
import { newId } from "./ids.js";
import type { GoalTargets, Note, ProposalKind, StoredProposal } from "./strategy.js";

export interface ProposalRow {
  id: string;
  site: string;
  quarter: string;
  kind: ProposalKind;
  status: "requested" | "running" | "sent" | "approved" | "superseded" | "failed";
  request: string;
  requested_by: string;
  proposal: StoredProposal | null;
  edits: { field: string; from: string; to: string; reason?: string }[] | null;
  created: string;
  approved_at: string | null;
}

export interface ProfileRow {
  site: string;
  answers: Record<string, string>;
  plan_text: string;
  plan_files: { name: string; url?: string; size?: number; kind?: string }[];
  plan_read_at: string | null;
}

export interface GoalVersionRow {
  site: string;
  quarter: string;
  version: number;
  targets: GoalTargets & { ranking?: { searches?: { query: string; topic?: string }[]; pageOneTarget?: number; aiMentionTarget?: number | null } };
  covers: { from: string; to: string; weeks: number; prorated: boolean } | null;
  approved_at: string;
}

const PROPOSAL_COLS = "id,site,quarter,kind,status,request,requested_by,proposal,edits,created,approved_at";

export async function getProposal(id: string): Promise<ProposalRow | null> {
  const [row] = await select<ProposalRow>("strategy_proposals", `id=eq.${enc(id)}&select=${PROPOSAL_COLS}`);
  return row ?? null;
}

/** Asked-for proposals the worker hasn't picked up, oldest first. Empty while the tables aren't on the server. */
export async function requestedProposals(limit = 20): Promise<{ id: string; site: string }[]> {
  try {
    return await select("strategy_proposals", `status=eq.requested&select=id,site&order=created&limit=${limit}`);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** Proposals a run is writing now, with the run that claimed each. */
export async function runningProposals(limit = 50): Promise<{ id: string; run_id: string | null; created: string }[]> {
  try {
    return await select("strategy_proposals", `status=eq.running&select=id,run_id,created&order=created&limit=${limit}`);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** A proposal the worker asks for itself (a quarterly run, Chat). Returns its id. */
export async function requestProposal(site: string, quarter: string, kind: ProposalKind, request: string, by: string): Promise<string> {
  const [waiting] = await select<{ id: string }>(
    "strategy_proposals",
    `site=eq.${enc(site)}&status=in.(requested,running)&select=id&order=created.desc&limit=1`,
  );
  if (waiting) return waiting.id;
  const row = await insert<{ id: string }>("strategy_proposals", { id: newId(), site, quarter, kind, request: request.slice(0, 4000), requested_by: by });
  return row.id;
}

/** requested → running; false when someone else took it or it isn't waiting. */
export async function claimProposal(id: string, runId: string): Promise<boolean> {
  const rows = await patch("strategy_proposals", `id=eq.${enc(id)}&status=in.(requested,running)`, { status: "running", run_id: runId });
  return rows.length > 0;
}

export async function sendProposal(id: string, site: string, proposal: StoredProposal, inputs: unknown, model: string): Promise<void> {
  await patch("strategy_proposals", `id=eq.${enc(id)}&status=eq.running`, {
    status: "sent",
    quarter: proposal.quarter,
    proposal,
    inputs,
    model,
    sent_at: new Date().toISOString(),
    error: "",
  });
  // The quarter's older proposals still waiting are replaced by this one.
  await patch("strategy_proposals", `site=eq.${enc(site)}&quarter=eq.${enc(proposal.quarter)}&status=eq.sent&id=neq.${enc(id)}`, {
    status: "superseded",
  });
}

export async function failProposal(id: string, error: string): Promise<void> {
  await patch("strategy_proposals", `id=eq.${enc(id)}&status=in.(requested,running)`, { status: "failed", error: error.slice(0, 4000) });
}

/** What the run cost, from the cost log (model calls and paid APIs under this workflow). */
export async function runCost(id: string, runId: string): Promise<void> {
  try {
    const rows = await select<{ cost_usd: number }>("model_calls", `workflow_id=eq.${enc(runId)}&select=cost_usd`);
    const cost = rows.reduce((n, r) => n + Number(r.cost_usd || 0), 0);
    await patch("strategy_proposals", `id=eq.${enc(id)}`, { cost_usd: Math.round(cost * 1e6) / 1e6 });
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

export async function profile(site: string): Promise<ProfileRow | null> {
  const [row] = await select<ProfileRow>("tenant_profile", `site=eq.${enc(site)}&select=site,answers,plan_text,plan_files,plan_read_at`);
  return row ?? null;
}

export async function markPlanRead(site: string): Promise<void> {
  await patch("tenant_profile", `site=eq.${enc(site)}`, { plan_read_at: new Date().toISOString() });
}

/** Site settings (app_settings) the Strategist reads: tenant.website, strategist.reviewPerMonth. */
export async function settings(site: string, keys: string[]): Promise<Record<string, unknown>> {
  const rows = await select<{ key: string; value: unknown }>(
    "app_settings",
    `site=eq.${enc(site)}&key=in.(${keys.map((k) => `"${k}"`).map(enc).join(",")})&select=key,value`,
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** The newest goal version of each of `quarters`. */
export async function latestGoals(site: string, quarter: string): Promise<GoalVersionRow | null> {
  try {
    const [row] = await select<GoalVersionRow>(
      "goal_versions",
      `site=eq.${enc(site)}&quarter=eq.${enc(quarter)}&select=site,quarter,version,targets,covers,approved_at&order=version.desc&limit=1`,
    );
    return row ?? null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** Whether the tenant has ever approved goals: a tenant without any gets the onboarding kind of proposal, whatever asked for the run. */
export async function hasApprovedGoals(site: string): Promise<boolean> {
  try {
    const rows = await select<{ site: string }>("goal_versions", `site=eq.${enc(site)}&select=site&limit=1`);
    return rows.length > 0;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

/** Tenants with goals for `quarter` (the weekly check, the quarterly run). */
export async function sitesWithGoals(quarter: string): Promise<string[]> {
  try {
    const rows = await select<{ site: string }>("goal_versions", `quarter=eq.${enc(quarter)}&select=site`);
    return [...new Set(rows.map((r) => r.site))];
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** This quarter's earlier proposals for the site (oldest first): what each asked, and the request that answered it. */
export async function earlierProposals(site: string, quarter: string): Promise<Pick<ProposalRow, "id" | "kind" | "status" | "request" | "proposal" | "created">[]> {
  return select(
    "strategy_proposals",
    `site=eq.${enc(site)}&quarter=eq.${enc(quarter)}&status=in.(sent,superseded,approved)&select=id,kind,status,request,proposal,created&order=created.asc&limit=20`,
  );
}

/** The last proposal the tenant approved, with their edits: how it learns their taste. */
export async function lastApproved(site: string): Promise<ProposalRow | null> {
  const [row] = await select<ProposalRow>(
    "strategy_proposals",
    `site=eq.${enc(site)}&status=eq.approved&select=${PROPOSAL_COLS}&order=approved_at.desc&limit=1`,
  );
  return row ?? null;
}

/** Published posts between two days: title, date, and the topics of the brief that made them. */
export async function publishedBetween(site: string, from: string, to: string): Promise<{ id: string; title: string; published_at: string; topics: string[] }[]> {
  const posts = await select<{ id: string; title: string; published_at: string }>(
    "posts",
    `site=eq.${enc(site)}&status=eq.published&published_at=gte.${enc(from)}&published_at=lt.${enc(to)}&select=id,title,published_at&order=published_at.desc&limit=500`,
  );
  if (!posts.length) return [];
  const briefs = await select<{ post: string; topics: string[] | null }>(
    "briefs",
    `site=eq.${enc(site)}&post=in.(${posts.map((p) => enc(p.id)).join(",")})&select=post,topics`,
  );
  const topics = new Map(briefs.map((b) => [b.post, b.topics ?? []]));
  return posts.map((p) => ({ ...p, topics: topics.get(p.id) ?? [] }));
}

/** Pitch decisions since `from`: approved and rejected counts, and the rejection reasons. */
export async function pitchOutcomes(site: string, from: string): Promise<{ approved: number; rejected: number; reasons: string[] }> {
  const rows = await select<{ status: string; reject_reason: string }>(
    "briefs",
    `site=eq.${enc(site)}&pitched_by=neq.&created=gte.${enc(from)}&select=status,reject_reason&limit=500`,
  );
  const rejected = rows.filter((r) => r.status === "rejected");
  return {
    approved: rows.filter((r) => ["todo", "in_progress", "in_review", "scheduled", "done"].includes(r.status)).length,
    rejected: rejected.length,
    reasons: rejected.map((r) => r.reject_reason).filter(Boolean).slice(0, 15),
  };
}

interface RankingFact {
  pageOne?: number;
  searches?: { query: string; position: number | null }[];
}

/** Searches on page one per Scout run (the ranking_search facts), oldest first. */
export async function pageOneSeries(site: string, since: string): Promise<{ day: string; pageOne: number }[]> {
  try {
    const rows = await select<{ day: string; value: RankingFact }>(
      "daily_facts",
      `site=eq.${enc(site)}&kind=eq.ranking_search&day=gte.${enc(since)}&select=day,value&order=day`,
    );
    return rows.map((r) => ({ day: r.day, pageOne: Number(r.value?.pageOne) || 0 }));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** Today's Google position per target search (the Scout's latest ranking fact), by lower-cased query. */
export async function latestPositions(site: string): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  try {
    const [row] = await select<{ value: RankingFact }>(
      "daily_facts",
      `site=eq.${enc(site)}&kind=eq.ranking_search&select=value&order=day.desc&limit=1`,
    );
    for (const x of row?.value?.searches ?? []) if (x?.query) out.set(x.query.toLowerCase(), x.position ?? null);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  return out;
}

export async function saveNotes(site: string, notes: Note[]): Promise<void> {
  for (const n of notes) {
    try {
      await insert("drift_notes", { id: newId(), site, week: n.week, goal: n.goal, severity: n.severity, message: n.message, action: n.action });
    } catch (err) {
      // The same note twice in a week (a re-run): the unique key keeps one.
      if (!(err instanceof Error && /409|23505|duplicate/.test(err.message))) throw err;
    }
  }
}
