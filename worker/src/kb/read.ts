// What the agents read from the app's database, through the worker's
// read-only pool (main.ts). Writes go through rpc() in rest.ts.

import type { Pool } from "pg";

let pool: Pool | null = null;

export function setAppDb(p: Pool): void {
  pool = p;
}

function db(): Pool {
  if (!pool) throw new Error("The app database is not connected.");
  return pool;
}

export interface Claim {
  id: string;
  text: string;
  status: string;
  scope: Record<string, unknown>;
  topics: string[];
}

/**
 * Claims near a passage: keyword search on any word plus meaning when the
 * claim has an embedding (none yet: the worker doesn't embed in 0.2).
 */
export async function searchClaims(site: string, text: string, limit = 12): Promise<Claim[]> {
  const { rows } = await db().query<Claim>(
    `select id, text, status, scope, topics
       from public.kb_search($1, $2, null, $3, array['settled', 'contested'], true)`,
    [site, text.slice(0, 4000), limit],
  );
  return rows;
}

export async function claimsById(ids: string[]): Promise<(Claim & { remembered: boolean; owned: boolean })[]> {
  if (!ids.length) return [];
  const { rows } = await db().query(
    `select c.id, c.text, c.status, c.scope,
            array(select t.name from public.kb_claim_topics ct join public.kb_topics t on t.id = ct.topic
                   where ct.claim = c.id order by t.name) as topics,
            c.remembered_by is not null as remembered,
            exists (select private.kb_claim_owners(c.id)) as owned
       from public.kb_claims c where c.id = any($1)`,
    [ids],
  );
  return rows;
}

export interface PostVersion {
  id: string;
  site: string;
  post: string;
  version: number;
  content: string;
  title: string;
  status: string;
  published_at: string | null;
}

export async function postVersion(id: string): Promise<PostVersion | null> {
  const { rows } = await db().query<PostVersion>(
    `select v.id, v.site, v.post, v.version, v.content, p.title, p.status, p.published_at
       from public.post_versions v join public.posts p on p.id = v.post where v.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** The post of a site whose title a request names, the longest title first. */
export async function findPost(site: string, request: string): Promise<string | null> {
  if (!request.trim()) return null;
  const { rows } = await db().query<{ id: string }>(
    `select id from public.posts
      where site = $1 and char_length(title) >= 4 and strpos(lower($2), lower(title)) > 0
      order by char_length(title) desc, updated desc limit 1`,
    [site, request.slice(0, 4000)],
  );
  return rows[0]?.id ?? null;
}

/** The newest version of a post. */
export async function latestVersion(post: string): Promise<PostVersion | null> {
  const { rows } = await db().query<{ id: string }>(
    `select id from public.post_versions where post = $1 order by version desc limit 1`,
    [post],
  );
  return rows[0] ? postVersion(rows[0].id) : null;
}

export interface Flag {
  id: string;
  site: string;
  kind: string;
  status: string;
  post: string | null;
  post_version: string | null;
  claim: string;
  claim_text: string;
  claim_status: string;
  quote: string;
  explanation: string;
  /** For a re-check: the claim that replaced this one, if any. */
  replaced_by: string | null;
}

export async function flag(id: string): Promise<Flag | null> {
  const { rows } = await db().query<Flag>(
    `select f.id, f.site, f.kind, f.status, f.post, f.post_version, f.claim, c.text as claim_text,
            c.status as claim_status, f.quote, f.explanation,
            (select n.text from public.kb_relationships r join public.kb_claims n on n.id = r.from_claim
              where r.kind = 'supersedes' and r.to_claim = f.claim limit 1) as replaced_by
       from public.kb_flags f join public.kb_claims c on c.id = f.claim where f.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface Proposal {
  id: string;
  site: string;
  origin: string;
  status: string;
  title: string;
  summary: string;
  flag: string | null;
  axis: string;
  decisions: number;
}

export async function proposal(id: string): Promise<Proposal | null> {
  const { rows } = await db().query<Proposal>(
    `select p.id, p.site, p.origin, p.status, p.title, p.summary, p.flag, p.axis,
            (select count(*)::int from public.kb_decisions d where d.proposal = p.id) as decisions
       from public.kb_proposals p where p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface EvidenceIn {
  source: string;
  quote: string;
  stance?: string;
  /** Filled from kb_sources. */
  kind?: string;
  tier?: number;
  title?: string;
  occurred?: string | null;
  post_version?: string | null;
}

export interface Change {
  id: string;
  position: number;
  op: "add" | "supersede" | "retract" | "relate";
  text: string;
  target: string | null;
  other: string | null;
  relation: string | null;
  scope: Record<string, unknown>;
  topics: string[];
  valid_from: string | null;
  valid_until: string | null;
  rationale: string;
  evidence: EvidenceIn[];
}

/** A proposal's changes, with what each piece of evidence is (kind, tier, date). */
export async function changes(proposalId: string): Promise<Change[]> {
  const { rows } = await db().query<Change>(
    `select id, position, op, text, target, other, relation, scope, topics,
            to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_until, 'YYYY-MM-DD') as valid_until,
            rationale, evidence
       from public.kb_changes where proposal = $1 order by position, created`,
    [proposalId],
  );
  const sourceIds = [...new Set(rows.flatMap((c) => c.evidence.map((e) => e.source)).filter(Boolean))];
  if (sourceIds.length) {
    const { rows: sources } = await db().query(
      `select id, kind, tier, title, occurred, post_version from public.kb_sources where id = any($1)`,
      [sourceIds],
    );
    const byId = new Map(sources.map((s) => [s.id as string, s]));
    for (const c of rows) {
      c.evidence = c.evidence.map((e) => {
        const s = byId.get(e.source);
        return s
          ? { ...e, kind: s.kind, tier: s.tier, title: s.title, occurred: s.occurred?.toISOString?.() ?? null, post_version: s.post_version }
          : e;
      });
    }
  }
  return rows;
}

/** The Guardian's rule set for a site: its own newest policy, or null for the bundled one. */
export async function sitePolicy(site: string): Promise<{ version: number; body: string } | null> {
  const { rows } = await db().query<{ version: number; body: string }>(
    `select version, body from public.kb_policies where site = $1 order by version desc limit 1`,
    [site],
  );
  return rows[0] ?? null;
}

// ---- work to do (the dispatcher) ----

export interface Work {
  kind: "check" | "recheck" | "contest" | "guardian";
  site: string;
  /** The post version, flag or proposal. */
  id: string;
  /** Distinguishes a second run on the same object (a proposal ruled on again). */
  round: number;
}

/**
 * Everything the agents should pick up now, oldest first, for the sites that
 * turned them on (kb_agent_sites).
 *   check     the newest version of a post in done or published, written since
 *             the site turned the Checker on, left alone for `settleSeconds`,
 *             and not read yet
 *   recheck   a re-check flag the agent hasn't read
 *   contest   a contest a person opened that has no drafted change yet
 *   guardian  an open proposal
 */
export async function pendingWork(settleSeconds: number, limit = 20): Promise<Work[]> {
  const { rows } = await db().query<Work>(
    `(select 'check' as kind, v.site, v.id, 0 as round, v.created as at
        from public.kb_agent_sites a
        join public.posts p on p.site = a.site and p.status in ('done', 'published')
        cross join lateral (select * from public.post_versions v where v.post = p.id order by v.version desc limit 1) v
       where a.checker and v.created >= a.since
         and v.created < now() - make_interval(secs => $1)
         and not exists (select 1 from public.kb_checks k where k.post_version = v.id)
       order by v.created limit $2)
     union all
     (select 'recheck', f.site, f.id, 0, f.created
        from public.kb_flags f join public.kb_agent_sites a on a.site = f.site and a.checker
       where f.kind = 'recheck' and f.status in ('open', 'snoozed') and f.checked is null
       order by f.created limit $2)
     union all
     (select 'contest', p.site, p.id, 0, p.created
        from public.kb_proposals p join public.kb_agent_sites a on a.site = p.site and a.checker
       where p.origin = 'contest' and p.status = 'draft' and p.flag is not null
         and not exists (select 1 from public.kb_changes c where c.proposal = p.id)
       order by p.created limit $2)
     union all
     (select 'guardian', p.site, p.id,
             (select count(*)::int from public.kb_decisions d where d.proposal = p.id), p.updated
        from public.kb_proposals p join public.kb_agent_sites a on a.site = p.site and a.guardian
       where p.status = 'open'
       order by p.updated limit $2)
     order by at`,
    [settleSeconds, limit],
  );
  return rows.map(({ kind, site, id, round }) => ({ kind, site, id, round }));
}
