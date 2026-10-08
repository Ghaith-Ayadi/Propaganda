// A tenant's connected sources: the ingest URL, Granola, Slack, Zoom, Teams,
// Google Meet. One row each in private.listener_connections (migration
// *_listener_connections.sql).
//
// Secrets (a Granola API key, OAuth tokens, a webhook signing secret) are
// encrypted here, in the worker, with AES-256-GCM under LISTENER_SECRET_KEY,
// before they reach the database: a database dump holds only ciphertext. The
// ingest URL's token is never stored at all, only its SHA-256.
//
// Reads use the worker's read-only pool (the table is private, PostgREST
// can't see it). Writes go through two functions only service_role may run.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { rest } from "./store.js";

export type Provider = "url" | "granola" | "slack" | "zoom" | "teams" | "meet";
export const PROVIDERS: readonly Provider[] = ["url", "granola", "slack", "zoom", "teams", "meet"];

export interface Connection {
  id: string;
  site: string;
  provider: Provider;
  /** The other side's id: a Slack team, a Zoom account, a Microsoft tenant, a Google user, a Granola webhook. */
  externalId: string;
  label: string;
  /** Non-secret settings and state (cursors, subscription ids, expiry). */
  config: Record<string, unknown>;
  status: "active" | "paused" | "error" | "revoked";
  lastError: string;
  lastSeen: string | null;
  created: string;
}

// ---- secrets ----

function key(): Buffer {
  const raw = process.env.LISTENER_SECRET_KEY ?? "";
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("LISTENER_SECRET_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
  return k;
}

/** "v1.<iv>.<tag>.<ciphertext>", base64url parts. */
export function seal(secret: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(secret), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function open<T = Record<string, unknown>>(sealed: string): T {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable connection secret");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8")) as T;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** An ingest URL token: 32 random bytes, shown once. */
export function newToken(): string {
  return `ppl_${randomBytes(32).toString("base64url")}`;
}

// ---- reads (read-only pool) ----

const COLS = `id, site, provider, external_id, label, config, status, last_error, last_seen, created`;

function row(r: Record<string, unknown>): Connection {
  return {
    id: r.id as string,
    site: r.site as string,
    provider: r.provider as Provider,
    externalId: r.external_id as string,
    label: r.label as string,
    config: (r.config as Record<string, unknown>) ?? {},
    status: r.status as Connection["status"],
    lastError: r.last_error as string,
    lastSeen: r.last_seen ? new Date(r.last_seen as string).toISOString() : null,
    created: new Date(r.created as string).toISOString(),
  };
}

export async function listConnections(db: Pool, site: string): Promise<Connection[]> {
  const r = await db.query(
    `select ${COLS} from private.listener_connections where site = $1 and status <> 'revoked' order by created`,
    [site],
  );
  return r.rows.map(row);
}

export async function getConnection(db: Pool, id: string): Promise<(Connection & { secret: string }) | null> {
  const r = await db.query(`select ${COLS}, secret from private.listener_connections where id = $1`, [id]);
  return r.rows[0] ? { ...row(r.rows[0]), secret: r.rows[0].secret as string } : null;
}

/** The live connection a provider's own id belongs to (a Slack team, a Zoom account...). */
export async function connectionByExternal(
  db: Pool,
  provider: Provider,
  externalId: string,
): Promise<(Connection & { secret: string }) | null> {
  const r = await db.query(
    `select ${COLS}, secret from private.listener_connections
      where provider = $1 and external_id = $2 and status in ('active', 'error') limit 1`,
    [provider, externalId],
  );
  return r.rows[0] ? { ...row(r.rows[0]), secret: r.rows[0].secret as string } : null;
}

export async function connectionByToken(db: Pool, token: string): Promise<Connection | null> {
  const r = await db.query(
    `select ${COLS} from private.listener_connections where provider = 'url' and token_hash = $1 and status = 'active'`,
    [tokenHash(token)],
  );
  return r.rows[0] ? row(r.rows[0]) : null;
}

export async function activeConnections(db: Pool, provider: Provider): Promise<(Connection & { secret: string })[]> {
  const r = await db.query(
    `select ${COLS}, secret from private.listener_connections where provider = $1 and status in ('active', 'error')`,
    [provider],
  );
  return r.rows.map((x) => ({ ...row(x), secret: x.secret as string }));
}

// ---- writes (service_role functions) ----

export interface ConnectionWrite {
  id?: string;
  site: string;
  provider: Provider;
  externalId?: string;
  label?: string;
  tokenHash?: string;
  /** Plain; sealed here before it leaves the process. */
  secret?: Record<string, unknown>;
  config?: Record<string, unknown>;
  status?: Connection["status"];
  lastError?: string;
  createdBy?: string;
}

/** Insert or update (by id); returns the id. Fields left out are kept. */
export async function saveConnection(w: ConnectionWrite): Promise<string> {
  const body: Record<string, unknown> = {
    id: w.id ?? null,
    site: w.site,
    provider: w.provider,
    external_id: w.externalId,
    label: w.label,
    token_hash: w.tokenHash,
    secret: w.secret ? seal(w.secret) : undefined,
    config: w.config,
    status: w.status,
    last_error: w.lastError,
    created_by: w.createdBy,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  const id = await rest("/rpc/listener_connection_save", { method: "POST", body: JSON.stringify({ p: body }) });
  return id as string;
}

/** Note that a connection delivered something (or failed to). */
export async function touchConnection(id: string, site: string, provider: Provider, error = ""): Promise<void> {
  await rest("/rpc/listener_connection_save", {
    method: "POST",
    body: JSON.stringify({
      p: { id, site, provider, last_error: error.slice(0, 1000), status: error ? "error" : "active", seen: true },
    }),
  });
}

export async function revokeConnection(id: string): Promise<void> {
  await rest("/rpc/listener_connection_revoke", { method: "POST", body: JSON.stringify({ p_id: id }) });
}
