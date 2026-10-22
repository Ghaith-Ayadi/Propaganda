// API tokens for a site: how the Claude plugin (and anything else outside the
// app) reaches a tenant, through the worker's MCP server (worker/src/mcp/).
// Minted by a member, shown once; the worker keeps only a hash.

import { clientFor, type Account } from "@/lib/accounts";
import { authHeader, SUPABASE_URL } from "@/lib/supabase";
import { coded } from "@/lib/errors";
import { siteId } from "@/lib/scope";

const WORKER_URL = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? `${SUPABASE_URL}/worker/v1`;

/** The MCP server's address, for the plugin's settings. */
export const MCP_URL = `${WORKER_URL}/mcp`;

export interface ApiToken {
  id: string;
  label: string;
  scopes: string[];
  lastSeen: string | null;
  created: string;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      ...init,
      headers: { Authorization: await authHeader(), "Content-Type": "application/json", ...init.headers },
    });
  } catch (err) {
    throw coded("API-TOKENS", err, "Couldn't reach the server. Try again.");
  }
  if (!res.ok) {
    let why = "";
    try {
      why = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* not JSON */
    }
    throw coded("API-TOKENS", new Error(`worker answered ${res.status}: ${why}`), why || "The server refused. Try again.");
  }
  return (await res.json()) as T;
}

export async function listApiTokens(): Promise<ApiToken[]> {
  return (await call<{ tokens: ApiToken[] }>(`/tokens?site=${encodeURIComponent(siteId())}`)).tokens;
}

/** Mint one; the token comes back once and is never shown again. */
export async function createApiToken(label: string): Promise<{ id: string; token: string }> {
  return call("/tokens", { method: "POST", body: JSON.stringify({ site: siteId(), label }) });
}

export async function revokeApiToken(id: string): Promise<void> {
  await call(`/tokens/${encodeURIComponent(id)}?site=${encodeURIComponent(siteId())}`, { method: "DELETE" });
}

/**
 * The consent page's answer when Claude connects (worker/src/mcp/oauth.ts):
 * allow on a site, as this account, or deny. Returns where the browser goes
 * next, back to Claude.
 */
export async function answerConnection(request: string, answer: { account: Account; site: string } | "deny"): Promise<string> {
  const allow = answer !== "deny";
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/mcp/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(allow ? { Authorization: await authHeader(clientFor(answer.account)) } : {}) },
      body: JSON.stringify(allow ? { request, site: answer.site } : { request, deny: true }),
    });
  } catch (err) {
    throw coded("MCP-CONNECT", err, "Couldn't reach the server. Try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
  if (!res.ok || !body.redirect) {
    throw coded("MCP-CONNECT", new Error(`worker answered ${res.status}: ${body.error ?? ""}`), body.error || "The server refused. Try again.");
  }
  return body.redirect;
}

/** What Claude asked for, read from the signed request (the worker checks it again). */
export function connectionRequest(request: string): { client: string; redirect: string } | null {
  try {
    const body = request.slice(0, request.lastIndexOf("."));
    const p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { n?: string; r?: string };
    return { client: p.n || "Claude", redirect: p.r ?? "" };
  } catch {
    return null;
  }
}
