// What the Listener writes to the app's database, and how.
//
// The worker's own database pool stays read-only (src/main.ts). Writes go
// through PostgREST with the service role key, the same path the cost-log
// gateway takes, to the knowledge base tables that service_role owns:
// kb_sources, kb_people, kb_proposals, kb_changes. Never a claim: only the
// Guardian admits claims.
//
// Every id is derived from what it stands for (a source from its text's hash,
// a proposal from its source), so a step DBOS retries after a crash writes the
// same rows again and the duplicates are ignored.

import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { BackendError, rest as backendRest } from "../agents/backend.js";

/** 15 characters of [0-9a-f], the shape of every id in the schema, derived from `parts`. */
export function stableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 15);
}

/** The agents' PostgREST client (agents/backend.ts), parsed, with a Prefer header when asked. */
export async function rest(path: string, init: RequestInit & { prefer?: string } = {}): Promise<unknown> {
  const { prefer, ...rest_ } = init;
  const res = await backendRest(path, { ...rest_, headers: { ...(prefer ? { Prefer: prefer } : {}), ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new BackendError(`${init.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}: ${text.slice(0, 300)}`, res.status);
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;

/** Insert rows, ignoring any whose id already exists. */
async function insertIgnore(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  await rest(`/${table}?on_conflict=id`, {
    method: "POST",
    body: JSON.stringify(rows),
    prefer: "resolution=ignore-duplicates,return=minimal",
  });
}

// ---- the tenant ----

/** Mail providers whose domain says nothing about which side someone is on. */
const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com",
  "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "fastmail.com", "hey.com",
]);

export interface Tenant {
  site: string;
  name: string;
  /** Email domains of the tenant's own people: its members' (shared providers aside) and its blog's. */
  domains: string[];
}

/** Read with the worker's read-only pool. */
/** Whether the tenant's agents are on (a kb_agent_sites row): Lite tenants never spend a token. */
export async function agentsOn(db: Pool, site: string): Promise<boolean> {
  const r = await db.query("select 1 from public.kb_agent_sites where site = $1", [site]);
  return (r.rowCount ?? 0) > 0;
}

export async function readTenant(db: Pool, site: string): Promise<Tenant> {
  const s = await db.query<{ name: string; domain: string }>("select name, domain from public.sites where id = $1", [site]);
  if (!s.rows[0]) throw new BackendError(`No site ${site}`, 404);
  const m = await db.query<{ email: string }>(
    "select u.email from public.site_members m join auth.users u on u.id = m.user_id where m.site = $1",
    [site],
  );
  const domains = new Set<string>();
  for (const { email } of m.rows) {
    const d = email?.split("@")[1]?.toLowerCase();
    if (d && !SHARED_DOMAINS.has(d)) domains.add(d);
  }
  const host = s.rows[0].domain.toLowerCase().replace(/^www\./, "");
  if (host) {
    // blog.kontra.run -> kontra.run as well
    domains.add(host);
    const parts = host.split(".");
    if (parts.length > 2) domains.add(parts.slice(-2).join("."));
  }
  return { site, name: s.rows[0].name, domains: [...domains] };
}

// ---- sources ----

export interface SourceRow {
  id: string;
  site: string;
  kind: "call" | "slack";
  tier: number;
  title: string;
  uri: string;
  body: string;
  sha256: string;
  occurred: string | null;
  status: "pending" | "extracted" | "skipped" | "failed";
}

/** The source id for this text in this tenant: the same transcript twice is one source. */
export function sourceId(site: string, sha: string): string {
  return stableId("kb_source", site, sha);
}

/** Store a source; returns false when this tenant already had it (by its hash). */
export async function putSource(row: SourceRow): Promise<boolean> {
  const existing = (await rest(
    `/kb_sources?site=eq.${enc(row.site)}&sha256=eq.${row.sha256}&select=id`,
  )) as { id: string }[];
  // The id comes from the text, so an existing row is this same transcript.
  if (existing.length) return false;
  await insertIgnore("kb_sources", [row as unknown as Record<string, unknown>]);
  return true;
}

export async function getSource(site: string, id: string): Promise<SourceRow | null> {
  const rows = (await rest(
    `/kb_sources?site=eq.${enc(site)}&id=eq.${enc(id)}&select=id,site,kind,tier,title,uri,body,sha256,occurred,status`,
  )) as SourceRow[];
  return rows[0] ?? null;
}

/** The tenant's latest calls and Slack threads, without their text (Admin's Arena picks one). */
export async function recentSources(site: string, limit: number): Promise<{ id: string; kind: string; title: string; occurred: string | null; created: string }[]> {
  return (await rest(
    `/kb_sources?site=eq.${enc(site)}&kind=in.(call,slack)&select=id,kind,title,occurred,created&order=created.desc&limit=${limit}`,
  )) as { id: string; kind: string; title: string; occurred: string | null; created: string }[];
}

export async function setSourceStatus(site: string, id: string, status: SourceRow["status"]): Promise<void> {
  await rest(`/kb_sources?site=eq.${enc(site)}&id=eq.${enc(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
    prefer: "return=minimal",
  });
}

// ---- people ----

export interface PersonIn {
  name: string;
  email?: string;
  slackId?: string;
}

/** kb_people ids for these people, creating the ones the tenant doesn't have yet. Matched by email, then Slack id. */
export async function upsertPeople(site: string, people: PersonIn[]): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const p of people) {
    const email = p.email?.toLowerCase().trim() ?? "";
    const slack = p.slackId?.trim() ?? "";
    if (!email && !slack) continue; // a bare name isn't enough to tell two Alexes apart
    const filter = email ? `email=eq.${enc(email)}` : `slack_id=eq.${enc(slack)}`;
    const found = (await rest(`/kb_people?site=eq.${enc(site)}&${filter}&select=id&limit=1`)) as { id: string }[];
    let id = found[0]?.id;
    if (!id) {
      id = stableId("kb_person", site, email || `slack:${slack}`);
      await insertIgnore("kb_people", [
        { id, site, name: (p.name || email || slack).slice(0, 200), email, slack_id: slack },
      ]);
    }
    byName.set(p.name.toLowerCase(), id);
  }
  return byName;
}

// ---- the knowledge base ----

export interface Nearby {
  id: string;
  text: string;
  status: string;
}

/** The nearest live claims to `text`, by keyword (the worker has no embeddings yet). */
export async function nearbyClaims(site: string, text: string, limit = 5): Promise<Nearby[]> {
  const rows = (await rest("/rpc/kb_search", {
    method: "POST",
    body: JSON.stringify({ p_site: site, p_query: text, p_limit: limit }),
  })) as Nearby[];
  return rows.map((r) => ({ id: r.id, text: r.text, status: r.status }));
}

/** Existing topic ids by lower-case name. The Listener never creates topics: organising them is people's job. */
export async function topicIds(site: string, names: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const rows = (await rest(`/kb_topics?site=eq.${enc(site)}&select=id,name`)) as { id: string; name: string }[];
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
  for (const n of wanted) {
    const id = byName.get(n.toLowerCase());
    if (id) out.set(n.toLowerCase(), id);
  }
  return out;
}

export interface ProposalChange {
  text: string;
  topics: string[];
  rationale: string;
  evidence: { source: string; quote: string; span_start: number; span_end: number; stance: "supports" }[];
}

/**
 * One proposal per source, opened by the Listener: written as a draft, its
 * changes added, then opened, so the Guardian never sees half of one.
 * Returns the proposal id.
 */
export async function writeProposal(input: {
  site: string;
  source: string;
  title: string;
  summary: string;
  changes: ProposalChange[];
}): Promise<string> {
  const id = stableId("kb_proposal", input.site, input.source);
  await insertIgnore("kb_proposals", [
    {
      id,
      site: input.site,
      origin: "ingest",
      status: "draft",
      title: input.title.slice(0, 300),
      summary: input.summary.slice(0, 20000),
      opened_by_agent: "listener",
    },
  ]);
  await insertIgnore(
    "kb_changes",
    input.changes.map((c, i) => ({
      id: stableId("kb_change", id, String(i)),
      site: input.site,
      proposal: id,
      position: i,
      op: "add",
      text: c.text.slice(0, 1000),
      topics: c.topics,
      rationale: c.rationale.slice(0, 4000),
      evidence: c.evidence,
    })),
  );
  // Only a draft moves to open: a retry after the Guardian picked it up changes nothing.
  await rest(`/kb_proposals?id=eq.${id}&status=eq.draft`, {
    method: "PATCH",
    body: JSON.stringify({ status: "open" }),
    prefer: "return=minimal",
  });
  return id;
}
