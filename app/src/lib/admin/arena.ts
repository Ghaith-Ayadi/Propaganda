// Admin > Arena: blind votes between models on a real agent task. The worker
// runs a round (worker/src/arena.ts, POST /arena) and returns the answers in a
// shuffled order; the page saves the vote to public.arena_votes, which only
// superadmins can read or write.
//
// The types copy worker/src/arena.ts; keep both in step.

import type { Client } from "@/lib/supabase";
import { must } from "@/lib/supabase";
import { withCode } from "@/lib/errors";
import { call } from "./runs";

export type ArenaAgent = "pitcher" | "listener";

export interface ArenaEntry {
  model: string;
  answer: unknown;
  raw: string;
  problem: string;
  error: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

export interface ArenaRound {
  agent: ArenaAgent;
  site: string;
  task: string;
  ideas: { id: string; title: string }[];
  entries: ArenaEntry[];
  costUsd: number;
}

export interface ArenaSource {
  id: string;
  kind: string;
  title: string;
  occurred: string | null;
  created: string;
}

export interface ArenaVote {
  id: string;
  agent: ArenaAgent;
  site: string;
  task: string;
  models: string[];
  winner: string | null;
  costs: number[];
  cost_usd: number;
  note: string;
  created: string;
}

/** Ayadi's own tenants: the only ones a round may read (worker ARENA_TENANTS). */
export async function arenaTenants(client: Client): Promise<{ id: string; name: string }[]> {
  return (await call<{ tenants: { id: string; name: string }[] }>(client, "ARENA-LOAD", "/arena/tenants")).tenants;
}

export function arenaSources(client: Client, site: string): Promise<{ sources: ArenaSource[]; defaultModels: string[] }> {
  return call(client, "ARENA-LOAD", `/arena/sources?site=${encodeURIComponent(site)}`);
}

export function runRound(
  client: Client,
  body: { agent: ArenaAgent; site: string; models: string[]; source?: string; transcript?: string; title?: string },
): Promise<ArenaRound> {
  return call(client, "ARENA-RUN", "/arena", { method: "POST", body: JSON.stringify(body) });
}

export async function saveVote(client: Client, round: ArenaRound, winner: string | null, note: string): Promise<void> {
  await withCode(
    "ARENA-VOTE",
    must(
      client.from("arena_votes").insert({
        agent: round.agent,
        site: round.site,
        task: round.task.slice(0, 500),
        models: round.entries.map((e) => e.model),
        costs: round.entries.map((e) => e.costUsd),
        winner,
        entries: round.entries,
        cost_usd: round.costUsd,
        note: note.slice(0, 2000),
      }),
    ),
  );
}

export async function listVotes(client: Client): Promise<ArenaVote[]> {
  return (await withCode(
    "ARENA-LOAD",
    must(client.from("arena_votes").select("id,agent,site,task,models,winner,costs,cost_usd,note,created").order("created", { ascending: false }).limit(500)),
  )) as ArenaVote[];
}

export interface Standing {
  model: string;
  rounds: number;
  wins: number;
  /** Average cost of one answer from this model. */
  avgCost: number;
}

/** Wins per model for one agent, most wins first, then cheapest. */
export function standings(votes: ArenaVote[], agent: ArenaAgent): Standing[] {
  const by = new Map<string, { rounds: number; wins: number; cost: number }>();
  for (const v of votes) {
    if (v.agent !== agent) continue;
    for (const [i, m] of v.models.entries()) {
      const s = by.get(m) ?? { rounds: 0, wins: 0, cost: 0 };
      s.rounds++;
      if (v.winner === m) s.wins++;
      s.cost += Number(v.costs[i] ?? 0);
      by.set(m, s);
    }
  }
  return [...by]
    .map(([model, s]) => ({ model, rounds: s.rounds, wins: s.wins, avgCost: s.rounds ? s.cost / s.rounds : 0 }))
    .sort((a, b) => b.wins - a.wins || a.avgCost - b.avgCost);
}
