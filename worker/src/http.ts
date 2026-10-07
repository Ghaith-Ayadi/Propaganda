// The Runs API, for Admin's Runs page. Caddy serves it on app.propaganda.pub
// under /worker/v1/ (the prefix is stripped before it gets here). Every route
// but /health needs a superadmin's access token.
//
//   GET  /health                 200 "ok"
//   GET  /runs?state=&site=&name=&limit=&offset=
//   GET  /runs/:id
//   POST /runs/:id/retry         { id, how }   id is the new run's when forked
//   POST /runs/:id/cancel        { ok: true }
//   POST /runs/demo              { id }        body { stallSeconds?, fail?, site? }

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import { HttpError, requireSuperadmin } from "./auth.js";
import { config } from "./config.js";
import { cancelRun, getRun, listRuns, retryRun, type RunState } from "./runs.js";
import { startForTenant } from "./workflows/agents.js";
import { demo } from "./workflows/demo.js";

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
    if (raw.length > 16_384) throw new HttpError(413, "Body too large");
  }
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new HttpError(400, "Body is not JSON");
  }
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
