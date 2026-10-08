// The Runs API, for Admin's Runs page, and the dispatch route Chat starts
// agents through. Caddy serves both on app.propaganda.pub under /worker/v1/
// (the prefix is stripped before it gets here). /agents/:name takes the
// dispatch secret; every other route but /health needs a superadmin's access
// token.
//
//   GET  /health                 200 "ok"
//   POST /agents/:name           202 { runId }  body { site, task, requestedBy, conversation, post? }
//   GET  /runs?state=&site=&name=&limit=&offset=
//   GET  /runs/:id
//   POST /runs/:id/retry         { id, how }   id is the new run's when forked
//   POST /runs/:id/cancel        { ok: true }
//   POST /runs/demo              { id }        body { stallSeconds?, fail?, site? }
//   POST /runs/scout             { id }        body { site, day?, checkAi? }: a Scout run now

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import { HttpError, requireSuperadmin } from "./auth.js";
import { config } from "./config.js";
import { cancelRun, getRun, listRuns, retryRun, type RunState } from "./runs.js";
import { dispatchAgent, isAgentName, startForTenant, type DispatchInput } from "./workflows/agents.js";
import { demo } from "./workflows/demo.js";
import { scout } from "./workflows/scout.js";

const RUN_STATES = new Set<RunState>(["queued", "running", "stalled", "done", "failed", "cancelled"]);
const SITE_RE = /^[a-z0-9]{15}$/;
/** The demo needs a tenant to belong to; Verbatim's is the one every box has. */
const DEMO_SITE = "verbatimsite000";

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    // Header-based auth, no cookies: any origin, as Caddy does for Supabase.
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65_536) throw new HttpError(413, "Body too large");
  }
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new HttpError(400, "Body is not JSON");
  }
}

function requireDispatchSecret(authorization: string | undefined): void {
  const secret = config.dispatchSecret;
  if (!secret) throw new HttpError(503, "Dispatch is not configured");
  const got = Buffer.from((authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "Unauthorized");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The hand-off body, checked; the tenant must exist. */
async function dispatchInput(db: Pool, req: IncomingMessage): Promise<DispatchInput> {
  const body = await readJson(req);
  const { site, task, requestedBy, conversation, post } = body;
  if (typeof site !== "string" || !SITE_RE.test(site)) throw new HttpError(400, "Bad site");
  if (typeof task !== "string" || !task.trim() || task.length > 8000) throw new HttpError(400, "Bad task");
  if (typeof requestedBy !== "string" || !UUID_RE.test(requestedBy)) throw new HttpError(400, "Bad requestedBy");
  if (typeof conversation !== "string" || !conversation || conversation.length > 200) {
    throw new HttpError(400, "Bad conversation");
  }
  if (post !== undefined && post !== null && (typeof post !== "string" || !SITE_RE.test(post))) {
    throw new HttpError(400, "Bad post");
  }
  const found = await db.query("select 1 from public.sites where id = $1", [site]);
  if (!found.rowCount) throw new HttpError(422, "No such tenant");
  return { site, task, requestedBy, conversation, post: typeof post === "string" ? post : null };
}

async function route(db: Pool, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://worker");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }
  if (path === "/health") return send(res, 200, "ok");

  const agent = /^\/agents\/([^/]+)$/.exec(path);
  if (agent) {
    if (method !== "POST") throw new HttpError(405, "Method not allowed");
    requireDispatchSecret(req.headers.authorization);
    const name = decodeURIComponent(agent[1]!);
    if (!isAgentName(name)) throw new HttpError(404, "No such agent");
    const input = await dispatchInput(db, req);
    const runId = await dispatchAgent(name, input);
    if (runId === undefined) throw new HttpError(404, `The ${name} agent isn't running yet`);
    if (runId === null) throw new HttpError(422, `The ${name} found nothing to work on: name the post or the thing to look at.`);
    return send(res, 202, { runId });
  }

  await requireSuperadmin(db, req.headers.authorization, config.jwtSecret());

  if (path === "/runs" && method === "GET") {
    const state = url.searchParams.get("state") ?? undefined;
    if (state && !RUN_STATES.has(state as RunState)) throw new HttpError(400, "Unknown state");
    const site = url.searchParams.get("site") ?? undefined;
    if (site && !SITE_RE.test(site)) throw new HttpError(400, "Bad site");
    return send(
      res,
      200,
      await listRuns(db, {
        state: state as RunState | undefined,
        site,
        name: url.searchParams.get("name") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 50) || 50,
        offset: Number(url.searchParams.get("offset") ?? 0) || 0,
      }),
    );
  }

  if (path === "/runs/demo" && method === "POST") {
    const body = await readJson(req);
    const stallSeconds = Math.min(Math.max(Number(body.stallSeconds ?? 0) || 0, 0), 3600);
    const site = typeof body.site === "string" && SITE_RE.test(body.site) ? body.site : DEMO_SITE;
    const handle = await startForTenant(site, demo, { startedAt: Date.now(), stallSeconds, fail: body.fail === true });
    return send(res, 200, { id: handle.workflowID });
  }

  if (path === "/runs/scout" && method === "POST") {
    const body = await readJson(req);
    if (typeof body.site !== "string" || !SITE_RE.test(body.site)) throw new HttpError(400, "Bad site");
    const today = new Date().toISOString().slice(0, 10);
    const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : today;
    const handle = await startForTenant(body.site, scout, { site: body.site, day, checkAi: body.checkAi === true });
    return send(res, 200, { id: handle.workflowID });
  }

  const m = /^\/runs\/([^/]+)(?:\/(retry|cancel))?$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    if (!m[2] && method === "GET") return send(res, 200, await getRun(db, id));
    if (m[2] === "retry" && method === "POST") return send(res, 200, await retryRun(id));
    if (m[2] === "cancel" && method === "POST") {
      await cancelRun(id);
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, "Not found");
}

export function startServer(db: Pool, port: number) {
  const server = createServer((req, res) => {
    route(db, req, res).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      // DBOS's own "no such workflow".
      if ((err as { name?: string }).name === "DBOSNonExistentWorkflowError") return send(res, 404, { error: "No such run" });
      console.error("runs api:", err);
      send(res, 500, { error: "Worker error" });
    });
  });
  server.listen(port);
  return server;
}
