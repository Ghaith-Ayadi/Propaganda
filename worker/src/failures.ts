// Every run that fails is recorded, grouped and turned into a ticket.
//
// A sweep (every minute, and once at start) finds the runs DBOS ended in
// ERROR, and records each one once: its error, run and step, tenant, model and
// cost. Runs that fail the same way share a fingerprint (the workflow, the
// step and the error with its ids, numbers and links taken out), so one
// failure seen fifty times is one group. Admin > Failures lists the groups.
//
// Processing turns a new group into a bug report and files it as one ticket
// (src/tickets.ts: the Notion Tasks board, GitHub issues, or both). A group
// that fails again adds a note to its ticket, at most once an hour, and
// reopens it when it was closed. An ignored group is never filed.
//
// The record lives in DBOS's own database (propaganda_dbos), schema `ops`,
// which the worker creates: it is about runs, like DBOS's own tables, holds
// nothing a person wrote, and stays out of supabase/migrations.

import { createHash } from "node:crypto";
import { DBOS, type WorkflowStatus } from "@dbos-inc/dbos-sdk";
import pg, { type Pool } from "pg";
import { tenantKeyOf, usageLimitOf } from "./limits.js";
import { fileTicket, recurTicket, ticketSinks, type BugReport, type Ticket } from "./tickets.js";

/** How often the sweep runs (seconds); 0 turns it off. */
const SWEEP_SECONDS = Number(process.env.WORKER_FAILURE_SWEEP_SECONDS ?? 60);
/** A group that keeps failing gets at most one note on its ticket this often. */
const RENOTE_MS = Number(process.env.WORKER_FAILURE_RENOTE_SECONDS ?? 3600) * 1000;
/** Workflows whose failures are recorded but never filed: the demo fails on purpose. */
const NEVER_FILED = new Set((process.env.WORKER_FAILURE_NEVER_FILED ?? "demo").split(",").map((s) => s.trim()).filter(Boolean));

const SCHEMA = `
create schema if not exists ops;
create table if not exists ops.failure_groups (
  fingerprint text primary key,
  workflow text not null,
  step text,
  signature text not null,
  title text not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  occurrences integer not null default 0,
  sites text[] not null default '{}',
  models text[] not null default '{}',
  latest_workflow_id text not null,
  latest_error text not null,
  status text not null default 'new' check (status in ('new', 'filed', 'ignored')),
  tickets jsonb not null default '[]',
  reported_count integer not null default 0,
  reported_at timestamptz,
  process_error text
);
create table if not exists ops.failures (
  workflow_id text primary key,
  fingerprint text not null references ops.failure_groups (fingerprint),
  workflow text not null,
  step text,
  step_id integer,
  site text,
  error text not null,
  models text[] not null default '{}',
  cost_usd numeric not null default 0,
  calls integer not null default 0,
  unpriced integer not null default 0,
  failed_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index if not exists failures_by_group on ops.failures (fingerprint, failed_at desc);
`;

let store: Pool | null = null;

/** The pool on DBOS's database, with the schema in place. */
export async function openFailureStore(url: string): Promise<Pool> {
  store = new pg.Pool({ connectionString: url, max: 2 });
  store.on("error", (err) => console.error("failure store:", err.message));
  await store.query(SCHEMA);
  return store;
}

function db(): Pool {
  if (!store) throw new Error("The failure store isn't open");
  return store;
}

export async function closeFailureStore(): Promise<void> {
  await store?.end();
  store = null;
}

// ---- fingerprints ----

function messageOf(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as { name?: unknown; message?: unknown };
    const msg = typeof e.message === "string" ? e.message : JSON.stringify(err);
    return typeof e.name === "string" && e.name !== "Error" ? `${e.name}: ${msg}` : msg;
  }
  return String(err);
}

/** A step's name without the bits that change between runs: "propose (again)" is "propose". */
export function stepKey(step: string | null): string {
  return (step ?? "").replace(/\s*\(again\)$/i, "").replace(/\s+\d+$/, "").trim();
}

/**
 * The error as a signature: what stays the same when the same thing fails
 * again. DBOS's retry wrapper keeps only the last attempt's error; links, ids,
 * numbers and spacing are taken out.
 */
export function signatureOf(message: string): string {
  let m = message;
  const retries = /exceeded its maximum of \d+ retries\. Previous errors: ([\s\S]*)$/.exec(m);
  if (retries) {
    const attempts = retries[1]!.split(/Error \d+: /).map((s) => s.trim()).filter(Boolean);
    m = attempts[attempts.length - 1] ?? m;
  }
  return m
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\[[A-Za-z0-9_-]{8,}\]/g, "")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{10,}\b/g, "<id>")
    .replace(/\d+(\.\d+)?/g, "N")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

export function fingerprintOf(workflow: string, step: string | null, signature: string): string {
  return createHash("sha256").update(`${workflow}\n${stepKey(step)}\n${signature}`).digest("hex").slice(0, 16);
}

/** Keys and tokens out of anything that leaves the worker. */
export function scrub(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{10,}/g, "[redacted key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted token]")
    .replace(/(bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]");
}

const titleOf = (workflow: string, step: string | null, signature: string) =>
  `${workflow}${step ? ` › ${stepKey(step)}` : ""}: ${signature.slice(0, 90)}${signature.length > 90 ? "…" : ""}`;

// ---- the sweep ----

type StepInfo = NonNullable<Awaited<ReturnType<typeof DBOS.listWorkflowSteps>>>[number];

const FAILED = ["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"] as const;

/** The step that ended the run: the last one with an error that isn't a stall. */
function failedStep(steps: StepInfo[]): StepInfo | null {
  const errored = steps.filter((s) => s.error && usageLimitOf(s.error) === null && tenantKeyOf(s.error) === null);
  return errored.length ? errored.reduce((a, b) => (b.functionID > a.functionID ? b : a)) : null;
}

interface Spend {
  models: string[];
  cost: number;
  calls: number;
  unpriced: number;
}

/** What the run spent, from the cost log; the models are the failed step's when it called any. */
async function spendOf(appDb: Pool, id: string, stepId: number | null): Promise<Spend> {
  try {
    const r = await appDb.query<{ step_models: string[] | null; models: string[] | null; usd: string | null; calls: string; unpriced: string }>(
      `select array_agg(distinct model) filter (where step_id = $2) as step_models,
              array_agg(distinct model) as models,
              sum(cost_usd)::text as usd, count(*)::text as calls,
              count(*) filter (where not priced)::text as unpriced
         from public.model_calls where workflow_id = $1`,
      [id, stepId],
    );
    const row = r.rows[0];
    return {
      models: row?.step_models ?? row?.models ?? [],
      cost: Number(row?.usd ?? 0),
      calls: Number(row?.calls ?? 0),
      unpriced: Number(row?.unpriced ?? 0),
    };
  } catch (err) {
    // No cost log yet, or an older one: the failure is still recorded.
    if (["42P01", "42703"].includes((err as { code?: string }).code ?? "")) return { models: [], cost: 0, calls: 0, unpriced: 0 };
    throw err;
  }
}

/** Record one failed run (once: a run already recorded is skipped). */
async function record(appDb: Pool, w: WorkflowStatus): Promise<boolean> {
  const steps = (await DBOS.listWorkflowSteps(w.workflowID)) ?? [];
  const step = failedStep(steps);
  const error = scrub(messageOf(step?.error ?? w.error) ?? "The run failed without an error message.").slice(0, 8000);
  const site = w.attributes && typeof w.attributes.site === "string" ? w.attributes.site : null;
  const spend = await spendOf(appDb, w.workflowID, step?.functionID ?? null);
  const stepName = step ? stepKey(step.name) : null;
  const signature = signatureOf(error);
  const fingerprint = fingerprintOf(w.workflowName, stepName, signature);
  const at = new Date(w.updatedAt ?? w.completedAt ?? w.createdAt);

  const client = await db().connect();
  try {
    await client.query("begin");
    const fresh = await client.query("select 1 from ops.failures where workflow_id = $1 for update", [w.workflowID]);
    if (fresh.rowCount) {
      await client.query("rollback");
      return false;
    }
    await client.query(
      `insert into ops.failure_groups as g
         (fingerprint, workflow, step, signature, title, first_seen, last_seen, occurrences, sites, models,
          latest_workflow_id, latest_error, status)
       values ($1, $2, $3, $4, $5, $6, $6, 1, $7, $8, $9, $10, $11)
       on conflict (fingerprint) do update set
         occurrences = g.occurrences + 1,
         first_seen = least(g.first_seen, excluded.first_seen),
         last_seen = greatest(g.last_seen, excluded.last_seen),
         sites = (select array(select distinct unnest(g.sites || excluded.sites))),
         models = (select array(select distinct unnest(g.models || excluded.models))),
         latest_workflow_id = case when excluded.last_seen >= g.last_seen then excluded.latest_workflow_id else g.latest_workflow_id end,
         latest_error = case when excluded.last_seen >= g.last_seen then excluded.latest_error else g.latest_error end`,
      [
        fingerprint, w.workflowName, stepName, signature, titleOf(w.workflowName, stepName, signature), at,
        site ? [site] : [], spend.models, w.workflowID, error,
        NEVER_FILED.has(w.workflowName) ? "ignored" : "new",
      ],
    );
    await client.query(
      `insert into ops.failures (workflow_id, fingerprint, workflow, step, step_id, site, error, models, cost_usd, calls, unpriced, failed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [w.workflowID, fingerprint, w.workflowName, stepName, step?.functionID ?? null, site, error, spend.models, spend.cost, spend.calls, spend.unpriced, at],
    );
    await client.query("commit");
    return true;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Find failed runs not recorded yet and record them. Returns how many were new. */
export async function sweepFailures(appDb: Pool): Promise<number> {
  const rows = await DBOS.listWorkflows({
    status: [...FAILED],
    limit: 500,
    sortDesc: true,
    loadInput: false,
    loadOutput: false,
  });
  if (!rows.length) return 0;
  const known = await db().query<{ workflow_id: string }>("select workflow_id from ops.failures where workflow_id = any($1)", [
    rows.map((w) => w.workflowID),
  ]);
  const seen = new Set(known.rows.map((r) => r.workflow_id));
  let added = 0;
  for (const w of rows.reverse()) {
    if (seen.has(w.workflowID)) continue;
    try {
      if (await record(appDb, w)) added++;
    } catch (err) {
      console.error(`failures: couldn't record ${w.workflowID}:`, (err as Error).message);
    }
  }
  return added;
}

// ---- processing: bug reports and tickets ----

export interface FailureGroup {
  fingerprint: string;
  workflow: string;
  step: string | null;
  signature: string;
  title: string;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  sites: string[];
  models: string[];
  latestRun: string;
  latestError: string;
  status: "new" | "filed" | "ignored";
  tickets: Ticket[];
  reportedCount: number;
  reportedAt: number | null;
  processError: string | null;
}

export interface FailureView {
  runId: string;
  step: string | null;
  stepId: number | null;
  site: string | null;
  error: string;
  models: string[];
  cost: number;
  calls: number;
  unpriced: number;
  failedAt: number;
}

type GroupRow = {
  fingerprint: string; workflow: string; step: string | null; signature: string; title: string;
  first_seen: Date; last_seen: Date; occurrences: number; sites: string[]; models: string[];
  latest_workflow_id: string; latest_error: string; status: FailureGroup["status"]; tickets: Ticket[];
  reported_count: number; reported_at: Date | null; process_error: string | null;
};

const groupOf = (r: GroupRow): FailureGroup => ({
  fingerprint: r.fingerprint,
  workflow: r.workflow,
  step: r.step,
  signature: r.signature,
  title: r.title,
  firstSeen: r.first_seen.getTime(),
  lastSeen: r.last_seen.getTime(),
  occurrences: r.occurrences,
  sites: r.sites,
  models: r.models,
  latestRun: r.latest_workflow_id,
  latestError: r.latest_error,
  status: r.status,
  tickets: r.tickets,
  reportedCount: r.reported_count,
  reportedAt: r.reported_at?.getTime() ?? null,
  processError: r.process_error,
});

export async function listFailureGroups(q: { status?: FailureGroup["status"]; limit?: number } = {}): Promise<FailureGroup[]> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const r = await db().query<GroupRow>(
    `select * from ops.failure_groups where ($1::text is null or status = $1) order by last_seen desc limit $2`,
    [q.status ?? null, limit],
  );
  return r.rows.map(groupOf);
}

export async function getFailureGroup(fingerprint: string): Promise<{ group: FailureGroup; failures: FailureView[] } | null> {
  const g = await db().query<GroupRow>("select * from ops.failure_groups where fingerprint = $1", [fingerprint]);
  if (!g.rows[0]) return null;
  const f = await db().query<{
    workflow_id: string; step: string | null; step_id: number | null; site: string | null; error: string;
    models: string[]; cost_usd: string; calls: number; unpriced: number; failed_at: Date;
  }>("select * from ops.failures where fingerprint = $1 order by failed_at desc limit 50", [fingerprint]);
  return {
    group: groupOf(g.rows[0]),
    failures: f.rows.map((r) => ({
      runId: r.workflow_id,
      step: r.step,
      stepId: r.step_id,
      site: r.site,
      error: r.error,
      models: r.models,
      cost: Number(r.cost_usd),
      calls: r.calls,
      unpriced: r.unpriced,
      failedAt: r.failed_at.getTime(),
    })),
  };
}

export async function setIgnored(fingerprint: string, ignored: boolean): Promise<boolean> {
  const r = await db().query(
    `update ops.failure_groups set status = case when $2 then 'ignored'
       when jsonb_array_length(tickets) > 0 then 'filed' else 'new' end
     where fingerprint = $1`,
    [fingerprint, ignored],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Where the app is, for links in tickets; the box's SITE_URL. */
const appUrl = () => (process.env.SITE_URL ?? "https://app.propaganda.pub").replace(/\/+$/, "");

/** dev or prod, for the ticket's label. */
export function environmentOf(): string {
  return process.env.WORKER_ENV ?? (/\.dev\.|localhost|127\.0\.0\.1/.test(appUrl()) ? "dev" : "prod");
}

async function siteNames(appDb: Pool, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  try {
    const r = await appDb.query<{ id: string; name: string }>("select id, name from public.sites where id = any($1)", [ids]);
    return new Map(r.rows.map((s) => [s.id, s.name]));
  } catch {
    return new Map();
  }
}

/** The bug report for a group, from its record. */
export async function reportOf(appDb: Pool, group: FailureGroup): Promise<BugReport> {
  const detail = await getFailureGroup(group.fingerprint);
  const failures = detail?.failures ?? [];
  const names = await siteNames(appDb, group.sites);
  const cost = failures.reduce((s, f) => s + f.cost, 0);
  const unpriced = failures.reduce((s, f) => s + f.unpriced, 0);
  return {
    fingerprint: group.fingerprint,
    title: group.title,
    environment: environmentOf(),
    workflow: group.workflow,
    step: group.step,
    signature: group.signature,
    occurrences: group.occurrences,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
    tenants: group.sites.map((id) => ({ id, name: names.get(id) ?? id })),
    models: group.models,
    cost,
    unpriced,
    latestError: group.latestError,
    runs: failures.slice(0, 5).map((f) => ({ id: f.runId, at: f.failedAt, site: f.site })),
    adminUrl: `${appUrl()}/admin#/admin/failures/${group.fingerprint}`,
    runUrl: (id: string) => `${appUrl()}/admin#/admin/runs/${encodeURIComponent(id)}`,
  };
}

/**
 * File new groups and note repeats on filed ones. Each group is handled on
 * its own: one that fails to file keeps its error and is tried next sweep.
 */
export async function processFailures(appDb: Pool, only?: string): Promise<{ filed: number; noted: number }> {
  const sinks = ticketSinks();
  const r = await db().query<GroupRow>(
    `select * from ops.failure_groups
      where status in ('new', 'filed') and ($1::text is null or fingerprint = $1)
        and (status = 'new' or occurrences > reported_count)
      order by first_seen`,
    [only ?? null],
  );
  let filed = 0, noted = 0;
  for (const row of r.rows) {
    const group = groupOf(row);
    if (!sinks.length) {
      const why = "No ticket destination is set up on this box (NOTION_TOKEN or GITHUB_ISSUES_TOKEN).";
      if (group.processError !== why) {
        await db().query("update ops.failure_groups set process_error = $2 where fingerprint = $1", [group.fingerprint, why]);
      }
      continue;
    }
    if (group.status === "filed" && !only && group.reportedAt && Date.now() - group.reportedAt < RENOTE_MS) continue;
    try {
      const report = await reportOf(appDb, group);
      const tickets = [...group.tickets];
      for (const sink of sinks) {
        const have = tickets.find((t) => t.kind === sink);
        if (have) {
          await recurTicket(have, report, group.occurrences - group.reportedCount);
          noted++;
        } else {
          tickets.push(await fileTicket(sink, report));
          filed++;
        }
      }
      await db().query(
        `update ops.failure_groups set status = 'filed', tickets = $2, reported_count = $3, reported_at = now(), process_error = null
          where fingerprint = $1`,
        [group.fingerprint, JSON.stringify(tickets), group.occurrences],
      );
    } catch (err) {
      const why = scrub(String((err as Error)?.message ?? err)).slice(0, 500);
      console.error(`failures: couldn't file ${group.fingerprint}:`, why);
      await db().query("update ops.failure_groups set process_error = $2 where fingerprint = $1", [group.fingerprint, why]);
    }
  }
  return { filed, noted };
}

/** One sweep, then processing. Never throws: a bad sweep waits for the next. */
export async function sweepAndProcess(appDb: Pool): Promise<void> {
  try {
    await sweepFailures(appDb);
    await processFailures(appDb);
  } catch (err) {
    console.error("failures: sweep failed:", (err as Error).message);
  }
}

/** Sweep now and every WORKER_FAILURE_SWEEP_SECONDS. Returns a stop function. */
export function startFailureSweeper(appDb: Pool): () => void {
  if (SWEEP_SECONDS <= 0) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sweepAndProcess(appDb);
    } finally {
      running = false;
    }
  };
  void tick();
  const t = setInterval(() => void tick(), SWEEP_SECONDS * 1000);
  return () => clearInterval(t);
}
