// The MCP server's routes, under /worker/v1/ like the rest.
//
// With an API token (Authorization: Bearer ppk_...; Settings > Connections > Claude):
//   POST   /mcp                 the MCP server (server.ts): JSON-RPC in, JSON out
//   POST   /assign              the same as the assign_post tool, plain HTTP: { title, collection?, markdown, assets? }
//   GET    /me                  { site, label, scopes }: what the token is
//
// For a tenant's members, with their Supabase access token:
//   GET    /tokens?site=        the site's tokens, never the tokens themselves
//   POST   /tokens              { site, label } -> { id, token }: shown once
//   DELETE /tokens/<id>?site=   revoke

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { HttpError, requireMember } from "../auth.js";
import { config } from "../config.js";
import { AssignError, assignPost, checkAssign } from "./assign.js";
import { handleBody, PROTOCOL } from "./server.js";
import { listTokens, mintToken, revokeToken, tokenOf, touchToken, type ApiToken } from "./tokens.js";

const SITE_RE = /^[a-z0-9]{15}$/;
/** A post with a few images as base64. */
const MAX_BODY = 30_000_000;

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

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "Body is not JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "MCP-Protocol-Version",
    "MCP-Protocol-Version": PROTOCOL,
  });
  res.end(JSON.stringify(body));
}

/** The API token behind the request, touched; 401 otherwise. */
async function requireToken(db: Pool, req: IncomingMessage): Promise<ApiToken> {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const token = bearer ? await tokenOf(db, bearer) : null;
  if (!token) {
    throw Object.assign(new HttpError(401, "Unauthorized: a Propaganda API token is needed (Settings > Connections > Claude)"), {
      headers: { "WWW-Authenticate": 'Bearer realm="propaganda"' },
    });
  }
  void touchToken(token.id, token.site);
  return token;
}

/** Handles the request when it's one of these routes; false otherwise. */
export async function mcpRoute(db: Pool, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  let m: RegExpExecArray | null;

  if (path === "/mcp") {
    // No server-to-client stream: the stateless transport answers each POST in JSON.
    if (method !== "POST") throw new HttpError(405, "Method not allowed");
    const token = await requireToken(db, req);
    const body = parse(await rawBody(req));
    const out = await handleBody(body, { db, token });
    if (out === null) {
      res.writeHead(202, { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "MCP-Protocol-Version": PROTOCOL });
      res.end();
    } else send(res, 200, out);
    return true;
  }

  if (path === "/assign" && method === "POST") {
    const token = await requireToken(db, req);
    if (!token.scopes.includes("assign")) throw new HttpError(403, "This token can't assign posts");
    const body = parse(await rawBody(req));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Body is not an object");
    try {
      const input = checkAssign(body as Record<string, unknown>);
      send(res, 202, await assignPost(db, { ...input, site: token.site, user: token.createdBy, via: "api" }));
    } catch (err) {
      if (err instanceof AssignError) throw new HttpError(err.status, err.message);
      throw err;
    }
    return true;
  }

  if (path === "/me" && method === "GET") {
    const token = await requireToken(db, req);
    send(res, 200, { site: token.site, label: token.label, scopes: token.scopes });
    return true;
  }

  if (path === "/tokens" && method === "GET") {
    const site = url.searchParams.get("site") ?? "";
    if (!SITE_RE.test(site)) throw new HttpError(400, "Bad site");
    await requireMember(db, req.headers.authorization, site, config.jwtSecret());
    send(res, 200, { tokens: await listTokens(db, site) });
    return true;
  }

  if (path === "/tokens" && method === "POST") {
    const body = parse(await rawBody(req, 16_384)) as Record<string, unknown>;
    const site = typeof body.site === "string" ? body.site : "";
    if (!SITE_RE.test(site)) throw new HttpError(400, "Bad site");
    const who = await requireMember(db, req.headers.authorization, site, config.jwtSecret());
    const label = typeof body.label === "string" ? body.label.trim() : "";
    send(res, 200, await mintToken(site, who.sub, label || "Claude"));
    return true;
  }

  if ((m = /^\/tokens\/([a-z0-9]{15})$/.exec(path)) && method === "DELETE") {
    const site = url.searchParams.get("site") ?? "";
    if (!SITE_RE.test(site)) throw new HttpError(400, "Bad site");
    await requireMember(db, req.headers.authorization, site, config.jwtSecret());
    if (!(await listTokens(db, site)).some((t) => t.id === m![1])) throw new HttpError(404, "No such token");
    await revokeToken(m[1]!, site);
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}
