// The Listener's HTTP routes, under /worker/v1/ like the Runs API.
//
//   POST   /ingest/<token>                  a transcript from anywhere   202 { source, created, run }
//   POST   /hooks/granola/<connection>      Granola's webhook (signed)
//   POST   /hooks/slack                     Slack's Events API (signed)
//   POST   /hooks/zoom                      Zoom's webhook (signed)
//   POST   /hooks/teams                     Microsoft Graph notifications (clientState)
//   GET    /oauth/<provider>/callback       back from Slack, Zoom, Microsoft, Google: 302 to Connections
//
// For a tenant's members (Settings > Connections), with their Supabase access token:
//   GET    /connections?site=               the tenant's connections, never their secrets
//   POST   /connections/url        { site }            a new ingest URL: { id, url }, shown once
//   POST   /connections/granola    { site, apiKey }    { id }
//   GET    /connections/<provider>/install?site=       { url } to send the person to (slack, zoom, teams, meet)
//   DELETE /connections/<id>?site=                     disconnect

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { HttpError, verifyToken } from "../auth.js";
import { config } from "../config.js";
import {
  connectionByToken,
  getConnection,
  listConnections,
  newToken,
  revokeConnection,
  saveConnection,
  tokenHash,
  touchConnection,
} from "./connections.js";
import { ingest } from "./ingest.js";
import { connectGranola, disconnectGranola, GranolaError, onGranolaHook } from "./sources/granola.js";
import { meetCallback, meetInstallUrl } from "./sources/meet.js";
import { publicUrl } from "./sources/public.js";
import { onSlackEvent, slackCallback, slackInstallUrl } from "./sources/slack.js";
import { onTeamsHook, teamsCallback, teamsConsentUrl } from "./sources/teams.js";
import { BadInput, fromUrlPost } from "./sources/url.js";
import { onZoomHook, zoomCallback, zoomInstallUrl } from "./sources/zoom.js";

const SITE_RE = /^[a-z0-9]{15}$/;
/** A long call as VTT is a few hundred kB; this leaves room for a day-long workshop. */
const MAX_BODY = 4_000_000;

type Reply = { status: number; body: unknown; text?: boolean; location?: string };

async function rawBody(req: IncomingMessage, max = MAX_BODY): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "Body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function write(res: ServerResponse, r: Reply): void {
  if (r.location) {
    res.writeHead(302, { Location: r.location, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const text = r.text ? String(r.body) : JSON.stringify(r.body);
  res.writeHead(r.status, {
    "Content-Type": r.text ? "text/plain; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

/** The signed-in member of `site` behind the request, or an HttpError. */
async function requireMember(db: Pool, req: IncomingMessage, site: string | null): Promise<string> {
  if (!site || !SITE_RE.test(site)) throw new HttpError(400, "Bad site");
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Unauthorized");
  const claims = verifyToken(token, config.jwtSecret());
  const r = await db.query("select 1 from public.site_members where site = $1 and user_id = $2", [site, claims.sub]);
  if (!r.rowCount) throw new HttpError(403, "Forbidden");
  return claims.sub;
}

function json(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw new HttpError(400, "Body is not JSON");
}

const INSTALL: Record<string, (site: string, user: string) => string> = {
  slack: slackInstallUrl,
  zoom: zoomInstallUrl,
  teams: teamsConsentUrl,
  meet: meetInstallUrl,
};
const CALLBACK: Record<string, (q: URLSearchParams) => Promise<string>> = {
  slack: slackCallback,
  zoom: zoomCallback,
  teams: teamsCallback,
  meet: meetCallback,
};

/** Handles the request when it's one of the Listener's routes; false otherwise. */
export async function listenerRoute(db: Pool, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const headers = req.headers as Record<string, string | string[] | undefined>;
  let m: RegExpExecArray | null;

  if ((m = /^\/ingest\/([A-Za-z0-9_-]{20,100})$/.exec(path)) && method === "POST") {
    const conn = await connectionByToken(db, m[1]!);
    if (!conn) throw new HttpError(404, "Unknown ingest URL");
    try {
      const t = fromUrlPost(String(req.headers["content-type"] ?? "text/plain"), await rawBody(req), url.searchParams);
      const r = await ingest(conn.site, t);
      await touchConnection(conn.id, conn.site, "url").catch(() => {});
      write(res, { status: 202, body: r });
    } catch (err) {
      if (err instanceof BadInput) throw new HttpError(400, err.message);
      throw err;
    }
    return true;
  }

  if (path.startsWith("/hooks/") && method === "POST") {
    const raw = await rawBody(req);
    if ((m = /^\/hooks\/granola\/([a-z0-9]{15})$/.exec(path))) write(res, await onGranolaHook(db, m[1]!, headers, raw));
    else if (path === "/hooks/slack") write(res, await onSlackEvent(db, headers, raw));
    else if (path === "/hooks/zoom") write(res, await onZoomHook(db, headers, raw));
    else if (path === "/hooks/teams") write(res, await onTeamsHook(db, url.searchParams, raw));
    else throw new HttpError(404, "Not found");
    return true;
  }

  if ((m = /^\/oauth\/(slack|zoom|teams|meet)\/callback$/.exec(path)) && method === "GET") {
    write(res, { status: 302, body: null, location: await CALLBACK[m[1]!]!(url.searchParams) });
    return true;
  }

  if (path === "/connections" && method === "GET") {
    const site = url.searchParams.get("site");
    await requireMember(db, req, site);
    write(res, { status: 200, body: { connections: await listConnections(db, site!) } });
    return true;
  }

  if (path === "/connections/url" && method === "POST") {
    const body = json(await rawBody(req, 16_384));
    const site = typeof body.site === "string" ? body.site : null;
    const user = await requireMember(db, req, site);
    const token = newToken();
    const id = await saveConnection({ site: site!, provider: "url", label: "Ingest URL", tokenHash: tokenHash(token), createdBy: user });
    write(res, { status: 200, body: { id, url: `${publicUrl()}/worker/v1/ingest/${token}` } });
    return true;
  }

  if (path === "/connections/granola" && method === "POST") {
    const body = json(await rawBody(req, 16_384));
    const site = typeof body.site === "string" ? body.site : null;
    const user = await requireMember(db, req, site);
    try {
      const id = await connectGranola({ site: site!, apiKey: String(body.apiKey ?? ""), createdBy: user });
      write(res, { status: 200, body: { id } });
    } catch (err) {
      if (err instanceof GranolaError && err.status < 500) throw new HttpError(400, err.status === 401 ? "Granola refused that key" : err.message);
      throw err;
    }
    return true;
  }

  if ((m = /^\/connections\/(slack|zoom|teams|meet)\/install$/.exec(path)) && method === "GET") {
    const site = url.searchParams.get("site");
    const user = await requireMember(db, req, site);
    write(res, { status: 200, body: { url: INSTALL[m[1]!]!(site!, user) } });
    return true;
  }

  if ((m = /^\/connections\/([a-z0-9]{15})$/.exec(path)) && method === "DELETE") {
    const site = url.searchParams.get("site");
    await requireMember(db, req, site);
    const conn = await getConnection(db, m[1]!);
    if (!conn || conn.site !== site) throw new HttpError(404, "No such connection");
    if (conn.provider === "granola") await disconnectGranola(conn).catch(() => {});
    await revokeConnection(conn.id);
    write(res, { status: 200, body: { ok: true } });
    return true;
  }

  return false;
}
