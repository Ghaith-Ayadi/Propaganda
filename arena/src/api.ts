// The Arena's client: one Supabase client on this origin (vercel.json proxies the
// auth, REST and worker paths to the product's host), and the calls the page makes.
// Rounds run in the product's worker (worker/src/arena.ts), so they use production's
// real prompts. Votes land in public.arena_votes (superadmin-only RLS).
//
// The types copy worker/src/arena.ts; keep both in step.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Client = SupabaseClient;
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

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? window.location.origin;
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export const client: Client = createClient(SUPABASE_URL, ANON_KEY, {
  // PKCE and detectSessionInUrl: Google sign-in comes back to this page with ?code=, which the client exchanges itself.
  auth: { storageKey: "arena-session", persistSession: true, autoRefreshToken: true, flowType: "pkce", detectSessionInUrl: true },
});

/** A failure with a stable code, shown as "sentence (CODE)". */
export class ArenaError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
export const userMessage = (err: unknown) =>
  err instanceof ArenaError ? `${err.message} (${err.code})` : err instanceof Error ? err.message : String(err);

async function call<T>(code: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) throw new ArenaError(code, "Signed out. Sign in again.");
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/worker/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new ArenaError(code, "Couldn't reach the worker.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 403) throw new ArenaError(code, "This account is not a superadmin.");
    if (res.status >= 502 && res.status <= 504) throw new ArenaError(code, "The worker isn't running.");
    throw new ArenaError(code, body?.error ?? "The worker refused the request.");
  }
  return (await res.json()) as T;
}

export const arenaTenants = () => call<{ tenants: { id: string; name: string }[] }>("ARENA-LOAD", "/arena/tenants").then((r) => r.tenants);

export const arenaSources = (site: string) =>
  call<{ sources: ArenaSource[]; defaultModels: string[] }>("ARENA-LOAD", `/arena/sources?site=${encodeURIComponent(site)}`);

export const runRound = (body: { agent: ArenaAgent; site: string; models: string[]; source?: string; transcript?: string; title?: string }) =>
  call<ArenaRound>("ARENA-RUN", "/arena", { method: "POST", body: JSON.stringify(body) });

export async function saveVote(round: ArenaRound, winner: string | null, note: string): Promise<void> {
  const { error } = await client.from("arena_votes").insert({
    agent: round.agent,
    site: round.site,
    task: round.task.slice(0, 500),
    models: round.entries.map((e) => e.model),
    costs: round.entries.map((e) => e.costUsd),
    winner,
    entries: round.entries,
    cost_usd: round.costUsd,
    note: note.slice(0, 2000),
  });
  if (error) throw new ArenaError("ARENA-VOTE", `Couldn't save the vote: ${error.message}`);
}

export async function listVotes(): Promise<ArenaVote[]> {
  const { data, error } = await client
    .from("arena_votes")
    .select("id,agent,site,task,models,winner,costs,cost_usd,note,created")
    .order("created", { ascending: false })
    .limit(500);
  if (error) throw new ArenaError("ARENA-LOAD", `Couldn't load the votes: ${error.message}`);
  return data as ArenaVote[];
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

/** Email codes are off in production (Google only). On with VITE_EMAIL_SIGNIN=1 or the Vite dev server, and only if the server can send mail. */
export async function emailCodesEnabled(): Promise<boolean> {
  if (!import.meta.env.DEV && import.meta.env.VITE_EMAIL_SIGNIN !== "1") return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: ANON_KEY } });
    const settings = (await res.json()) as { external?: { email?: boolean } };
    return Boolean(settings.external?.email);
  } catch {
    return false;
  }
}

/** Google sign-in by redirect: this page goes to Google and comes back here with a code. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/` } });
  if (error) throw new ArenaError("ARENA-AUTH", "Google sign-in isn't available right now.");
}
