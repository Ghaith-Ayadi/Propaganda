// API tokens (private.api_tokens, migration *_api_tokens.sql): how the Claude
// plugin and anything else outside the app reaches a tenant. Minted by a
// member in Settings > Connections > Claude, shown once; only the SHA-256 is
// stored. A request with a token acts for the member who made it, on its one
// site, within its scopes.
//
// Reads use the read-only pool (the table is private). Writes go through two
// functions only service_role may run.

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { isMissing, rpc } from "../agents/backend.js";

export type Scope = "read" | "assign";
export const SCOPES: readonly Scope[] = ["read", "assign"];

export interface ApiToken {
  id: string;
  site: string;
  label: string;
  scopes: Scope[];
  /** The member it acts for. */
  createdBy: string;
  lastSeen: string | null;
  created: string;
}

/** "ppk_" and 32 random bytes, base64url: the shape the routes check. */
export const TOKEN_RE = /^ppk_[A-Za-z0-9_-]{40,50}$/;

export function newApiToken(): string {
  return `ppk_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const COLS = `id, site, label, scopes, created_by, last_seen, created`;

function row(r: Record<string, unknown>): ApiToken {
  return {
    id: r.id as string,
    site: r.site as string,
    label: r.label as string,
    scopes: ((r.scopes as unknown[]) ?? []).filter((s): s is Scope => SCOPES.includes(s as Scope)),
    createdBy: r.created_by as string,
    lastSeen: r.last_seen ? new Date(r.last_seen as string).toISOString() : null,
    created: new Date(r.created as string).toISOString(),
  };
}

/** The live token behind a bearer string, or null. A box without the table has none. */
export async function tokenOf(db: Pool, bearer: string): Promise<ApiToken | null> {
  if (!TOKEN_RE.test(bearer)) return null;
  try {
    const r = await db.query(`select ${COLS} from private.api_tokens where token_hash = $1 and revoked is null`, [hashToken(bearer)]);
    return r.rows[0] ? row(r.rows[0]) : null;
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return null;
    throw err;
  }
}

export async function listTokens(db: Pool, site: string): Promise<ApiToken[]> {
  try {
    const r = await db.query(`select ${COLS} from private.api_tokens where site = $1 and revoked is null order by created`, [site]);
    return r.rows.map(row);
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return [];
    throw err;
  }
}

/** Mint a token for a member; returns it (shown once) and its id. */
export async function mintToken(site: string, createdBy: string, label: string, scopes: Scope[] = [...SCOPES]): Promise<{ id: string; token: string }> {
  const token = newApiToken();
  try {
    const id = await rpc<string>("api_token_save", { p: { site, label: label.slice(0, 200), token_hash: hashToken(token), scopes, created_by: createdBy } });
    return { id, token };
  } catch (err) {
    if (isMissing(err)) throw new Error("API tokens aren't on this server yet");
    throw err;
  }
}

export async function touchToken(id: string, site: string): Promise<void> {
  await rpc("api_token_touch", { p_id: id, p_site: site }).catch(() => {});
}

export async function revokeToken(id: string, site: string): Promise<void> {
  await rpc("api_token_touch", { p_id: id, p_site: site, p_revoke: true });
}
