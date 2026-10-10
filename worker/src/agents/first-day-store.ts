// Day one's reads and writes (agents/first-day.ts), over PostgREST with the
// service key. Writes stay narrow: briefs the Strategist pitched
// (pitched_by agent:strategist) and still undecided, and batch 1's row.

import { enc, isMissing, patch, select } from "./backend.js";
import type { FitGrade, FitReason } from "./fit.js";
import type { ProposalRow } from "./strategy-store.js";
import { FIRST_BATCH } from "./first-day.js";

const PROPOSAL_COLS = "id,site,quarter,kind,status,request,requested_by,proposal,edits,created,approved_at";

export interface StrategistBrief {
  id: string;
  site: string;
  title: string;
  angle: string;
  status: string;
  topics: string[] | null;
  fit: { grade?: FitGrade; reasons?: FitReason[]; replaces?: string } | null;
  reject_reason: string;
  post: string | null;
  created: string;
}

const BRIEF_COLS = "id,site,title,angle,status,topics,fit,reject_reason,post,created";

/** The quarter's proposals that reached the tenant (sent, superseded by a revision, or approved), oldest first. */
export async function shownProposals(site: string, quarter: string): Promise<ProposalRow[]> {
  return select<ProposalRow>(
    "strategy_proposals",
    `site=eq.${enc(site)}&quarter=eq.${enc(quarter)}&status=in.(sent,superseded,approved)&select=${PROPOSAL_COLS}&order=created&limit=50`,
  );
}

/** Proposals the tenant approved, oldest approval first. */
export async function approvedProposals(site: string): Promise<{ id: string; approved_at: string | null }[]> {
  return select("strategy_proposals", `site=eq.${enc(site)}&status=eq.approved&select=id,approved_at&order=approved_at&limit=50`);
}

/** The plan the tenant is looking at now (or approved): its newest sent or approved proposal for the quarter. */
export async function currentPlan(site: string, quarter?: string): Promise<ProposalRow | null> {
  const q = quarter ? `&quarter=eq.${enc(quarter)}` : "";
  const [row] = await select<ProposalRow>(
    "strategy_proposals",
    `site=eq.${enc(site)}${q}&status=in.(sent,approved)&select=${PROPOSAL_COLS}&order=created.desc&limit=1`,
  );
  return row ?? null;
}

/** Day one's pitches: the Strategist's briefs in batch 1, every status. */
export async function strategistBriefs(site: string): Promise<StrategistBrief[]> {
  return select<StrategistBrief>(
    "briefs",
    `site=eq.${enc(site)}&pitched_by=eq.agent:strategist&batch=eq.${FIRST_BATCH}&select=${BRIEF_COLS}&order=created&limit=200`,
  );
}

export async function strategistBrief(site: string, id: string): Promise<StrategistBrief | null> {
  const [row] = await select<StrategistBrief>("briefs", `site=eq.${enc(site)}&id=eq.${enc(id)}&pitched_by=eq.agent:strategist&select=${BRIEF_COLS}`);
  return row ?? null;
}

/**
 * Withdraw undecided Strategist pitches: status cancelled (not rejected: no
 * person decided, so no replacement is written and the taste log reads it as
 * a cancellation), with the reason. A pitch a person already decided is left alone.
 */
export async function withdrawPitches(site: string, ids: string[], reason: string): Promise<number> {
  if (!ids.length) return 0;
  const rows = await patch(
    "briefs",
    `site=eq.${enc(site)}&id=in.(${ids.map(enc).join(",")})&pitched_by=eq.agent:strategist&status=eq.pitched`,
    { status: "cancelled", reject_reason: reason },
  );
  return rows.length;
}

/** Proposals approved since `since` (the drafts poll). Empty while the tables aren't on the server. */
export async function recentlyApproved(since: string): Promise<Pick<ProposalRow, "id" | "site" | "kind" | "proposal">[]> {
  try {
    return await select("strategy_proposals", `status=eq.approved&approved_at=gte.${enc(since)}&select=id,site,kind,proposal&order=approved_at&limit=50`);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** Day-one pitches a person rejected with a reason since `since` (the replacements poll). */
export async function recentlyRejected(since: string): Promise<{ id: string; site: string; reject_reason: string; fit: StrategistBrief["fit"] }[]> {
  try {
    return await select(
      "briefs",
      `pitched_by=eq.agent:strategist&batch=eq.${FIRST_BATCH}&status=eq.rejected&reject_reason=neq.&created=gte.${enc(since)}&select=id,site,reject_reason,fit&order=created&limit=100`,
    );
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}
