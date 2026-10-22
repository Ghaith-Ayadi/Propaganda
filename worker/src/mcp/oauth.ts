// Signing in to the MCP server with OAuth, so Claude (claude.ai, the desktop
// app, Claude Code) connects with a click and nobody pastes a token: Claude
// finds the server below through the 401's WWW-Authenticate header, registers
// itself, sends the person to the app to pick a blog and allow it, and swaps
// the code it gets back for an API token (tokens.ts), the same kind Settings >
// Connections > Claude makes. The token shows up in that list and is revoked
// there.
//
// The MCP authorization spec (2025-06-18): protected resource metadata (RFC
// 9728), authorization server metadata (RFC 8414), dynamic client
// registration (RFC 7591), the code flow with PKCE (S256 only).
//
// Nothing here is stored but the token: a client id, the consent request and
// the code are signed with a key derived from JWT_SECRET. A code is good for
// five minutes, once (the worker is one process; the used ones are kept in
// memory until they expire).
//
// Routes, on the worker (Caddy sends /.well-known/oauth-* on the app host here
// as they are, and /worker/v1/* with the prefix stripped):
//   GET  /.well-known/oauth-protected-resource[/worker/v1/mcp]
//   GET  /.well-known/oauth-authorization-server[/...]
//   POST /mcp/register    { redirect_uris, client_name } -> { client_id }
//   GET  /mcp/authorize   302 to the app's consent page (/connect/claude)
//   POST /mcp/approve     the app, as a member: { request, site } or { request, deny } -> { redirect }
//   POST /mcp/token       code + code_verifier -> { access_token }

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { HttpError, requireMember } from "../auth.js";
import { config } from "../config.js";
import { mintToken } from "./tokens.js";

const SITE_RE = /^[a-z0-9]{15}$/;
const CODE_SECONDS = 300;
/** The person has this long on the consent page. */
const REQUEST_SECONDS = 1800;

/** The public origin: the app host, which serves the app, the API and the worker. */
export function origin(): string {
  return (process.env.MCP_PUBLIC_URL ?? process.env.SUPABASE_URL ?? "https://app.propaganda.pub").replace(/\/+$/, "");
}
const issuer = () => origin();
const base = () => `${origin()}/worker/v1`;
export const resourceUrl = () => `${base()}/mcp`;
export const resourceMetadataUrl = () => `${origin()}/.well-known/oauth-protected-resource/worker/v1/mcp`;

// ---- signing ----

function key(): Buffer {
  return createHmac("sha256", config.jwtSecret()).update("propaganda mcp oauth v1").digest();
}

function sign(kind: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", key()).update(`${kind}.${body}`).digest("base64url");
  return `${body}.${mac}`;
}

function unsign<T>(kind: string, value: unknown): T | null {
  if (typeof value !== "string" || value.length > 8000) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const want = createHmac("sha256", key()).update(`${kind}.${body}`).digest();
  const got = Buffer.from(value.slice(dot + 1), "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof p.exp === "number" && p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

// ---- clients ----

interface Client {
  /** redirect_uris */
  r: string[];
  /** client_name */
  n: string;
}

/** https anywhere, or http on the person's own machine (Claude Code's callback). */
export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
}

/** Claude's own callbacks: claude.ai, claude.com, and loopback for Claude Code. */
export function knownRedirect(uri: string): boolean {
  try {
    const h = new URL(uri).hostname;
    return ["claude.ai", "claude.com", "localhost", "127.0.0.1", "[::1]"].includes(h) || h.endsWith(".claude.ai") || h.endsWith(".claude.com");
  } catch {
    return false;
  }
}

export function registerClient(body: Record<string, unknown>): Record<string, unknown> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectAllowed)) {
    throw new OAuthError(400, "invalid_redirect_uri", "redirect_uris: one to ten https URLs, or http on localhost");
  }
  const known = uris.every(knownRedirect);
  const name = (typeof body.client_name === "string" ? body.client_name.trim() : "").slice(0, 100) || (known ? "Claude" : "An app");
  // Only Claude's own callbacks may call themselves Claude on the consent page.
  if (!known && /claude|anthropic/i.test(name)) {
    throw new OAuthError(400, "invalid_client_metadata", "That name is reserved for Claude's own redirect URIs");
  }
  const clientId = `mcpc_${sign("client", { r: uris, n: name } satisfies Client)}`;
  return {
    client_id: clientId,
    client_id_issued_at: now(),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

function clientOf(clientId: unknown): Client | null {
  if (typeof clientId !== "string" || !clientId.startsWith("mcpc_")) return null;
  return unsign<Client>("client", clientId.slice(5));
}

/** A redirect_uri matches a registered one exactly, except a loopback's port (RFC 8252). */
function redirectMatches(client: Client, uri: string): boolean {
  if (client.r.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:") return false;
    return client.r.some((r) => {
      const w = new URL(r);
      return w.protocol === "http:" && w.hostname === u.hostname && w.pathname === u.pathname && w.search === u.search;
    });
  } catch {
    return false;
  }
}

// ---- the flow ----

export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    description: string,
  ) {
    super(description);
  }
}

/** What the consent page shows and sends back. */
export interface ConsentRequest {
  /** client_id */
  c: string;
  /** client name, for the page */
  n: string;
  /** redirect_uri */
  r: string;
  /** code_challenge (S256) */
  ch: string;
  /** state */
  s: string | null;
  exp: number;
}

/** GET /mcp/authorize: check what Claude sent, and where to send the person. */
export function authorize(params: URLSearchParams): string {
  const client = clientOf(params.get("client_id"));
  if (!client) throw new OAuthError(400, "invalid_client", "Unknown client: register it first");
  const redirect = params.get("redirect_uri") ?? (client.r.length === 1 ? client.r[0]! : "");
  if (!redirect || !redirectMatches(client, redirect)) throw new OAuthError(400, "invalid_request", "redirect_uri isn't one this client registered");
  // From here on, errors go back to the client.
  const state = params.get("state");
  const back = (error: string, description: string) => withParams(redirect, { error, error_description: description, state });
  if (params.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code");
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const request = sign("consent", { c: params.get("client_id")!, n: client.n, r: redirect, ch: challenge, s: state, exp: now() + REQUEST_SECONDS } satisfies ConsentRequest);
  return `${origin()}/connect/claude?request=${encodeURIComponent(request)}`;
}

/** POST /mcp/approve: the member said yes (a code for the client) or no. Returns where the browser goes. */
export async function approve(db: Pool, authorization: string | undefined, body: Record<string, unknown>): Promise<string> {
  const req = unsign<ConsentRequest>("consent", body.request);
  if (!req) throw new HttpError(400, "This sign-in link has expired. Start again from Claude.");
  if (body.deny === true) return withParams(req.r, { error: "access_denied", error_description: "The person said no", state: req.s });
  const site = typeof body.site === "string" ? body.site : "";
  if (!SITE_RE.test(site)) throw new HttpError(400, "Bad site");
  const who = await requireMember(db, authorization, site, config.jwtSecret());
  const code = sign("code", { c: req.c, n: req.n, r: req.r, ch: req.ch, site, sub: who.sub, j: randomBytes(9).toString("base64url"), exp: now() + CODE_SECONDS });
  return withParams(req.r, { code, state: req.s });
}

interface Code {
  c: string;
  n: string;
  r: string;
  ch: string;
  site: string;
  sub: string;
  j: string;
  exp: number;
}

const usedCodes = new Map<string, number>();

function spend(code: Code): boolean {
  const t = now();
  for (const [j, exp] of usedCodes) if (exp < t) usedCodes.delete(j);
  if (usedCodes.has(code.j)) return false;
  usedCodes.set(code.j, code.exp);
  return true;
}

/** POST /mcp/token: a code and its verifier for an API token. `mint` is swapped in tests. */
export async function exchange(
  form: URLSearchParams,
  mint: (site: string, user: string, label: string) => Promise<{ token: string }> = mintToken,
): Promise<Record<string, unknown>> {
  if (form.get("grant_type") !== "authorization_code") throw new OAuthError(400, "unsupported_grant_type", "Only authorization_code");
  const code = unsign<Code>("code", form.get("code"));
  if (!code) throw new OAuthError(400, "invalid_grant", "The code is wrong or has expired");
  const clientId = form.get("client_id");
  if (clientId !== code.c) throw new OAuthError(400, "invalid_grant", "The code was issued to another client");
  const redirect = form.get("redirect_uri");
  if (redirect && redirect !== code.r) throw new OAuthError(400, "invalid_grant", "redirect_uri doesn't match");
  const verifier = form.get("code_verifier") ?? "";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  if (!verifier || challenge !== code.ch) throw new OAuthError(400, "invalid_grant", "code_verifier doesn't match");
  if (!spend(code)) throw new OAuthError(400, "invalid_grant", "The code was already used");
  const { token } = await mint(code.site, code.sub, `${code.n} (connected)`);
  return { access_token: token, token_type: "Bearer", scope: "read assign" };
}

function withParams(uri: string, params: Record<string, string | null>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== "") u.searchParams.set(k, v);
  return u.toString();
}

// ---- metadata ----

export function protectedResource(): Record<string, unknown> {
  return {
    resource: resourceUrl(),
    authorization_servers: [issuer()],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "assign"],
    resource_name: "Propaganda",
  };
}

export function authorizationServer(): Record<string, unknown> {
  return {
    issuer: issuer(),
    authorization_endpoint: `${base()}/mcp/authorize`,
    token_endpoint: `${base()}/mcp/token`,
    registration_endpoint: `${base()}/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "assign"],
  };
}

// ---- routes ----

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

async function readText(req: IncomingMessage, max = 65_536): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "Body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* below */
  }
  throw new OAuthError(400, "invalid_request", "Body is not a JSON object");
}

/** Handles the request when it's one of these routes; false otherwise. */
export async function oauthRoute(db: Pool, req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  try {
    if (path.startsWith("/.well-known/oauth-protected-resource") && method === "GET") {
      sendJson(res, 200, protectedResource());
      return true;
    }
    if ((path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) && method === "GET") {
      sendJson(res, 200, authorizationServer());
      return true;
    }
    if (path === "/mcp/register" && method === "POST") {
      sendJson(res, 201, registerClient(json(await readText(req))));
      return true;
    }
    if (path === "/mcp/authorize" && method === "GET") {
      res.writeHead(302, { Location: authorize(url.searchParams), "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    if (path === "/mcp/approve" && method === "POST") {
      sendJson(res, 200, { redirect: await approve(db, req.headers.authorization, json(await readText(req))) });
      return true;
    }
    if (path === "/mcp/token" && method === "POST") {
      const raw = await readText(req);
      const form = (req.headers["content-type"] ?? "").includes("json")
        ? new URLSearchParams(Object.entries(json(raw)).map(([k, v]) => [k, String(v)]))
        : new URLSearchParams(raw);
      sendJson(res, 200, await exchange(form));
      return true;
    }
  } catch (err) {
    if (err instanceof OAuthError) {
      sendJson(res, err.status, { error: err.code, error_description: err.message });
      return true;
    }
    throw err;
  }
  return false;
}
