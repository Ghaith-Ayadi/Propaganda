// A tenant's own Anthropic key (BYOK). Stored in public.model_keys, which only
// the service role can read (migration 20261008000050), and only ever as
// AES-256-GCM ciphertext under MODEL_KEY_SECRET, bound to the site so a row
// copied to another tenant does not decrypt. The browser sees the last four
// characters and the last test's result, never the key.
//
// No model SDK here: the gateway (gateway.ts) is the only file that calls a
// provider. This file is storage and crypto.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type KeyStatus = "ok" | "failed";

export interface KeyInfo {
  last4: string;
  status: KeyStatus;
  /** Anthropic's answer when the last use or test failed; empty when ok. */
  error: string;
  /** ISO time of the last test or use that changed the status. */
  checked: string;
}

export interface TenantKey extends KeyInfo {
  apiKey: string;
}

/** The key failed at Anthropic (rejected, no credit, rate limited). Runs wait on it. */
export class TenantKeyError extends Error {
  constructor(
    message: string,
    /** Epoch ms to try again; set for a rate limit, else the worker picks. */
    readonly retryAt: number | null = null,
  ) {
    super(`TENANT-KEY ${message}`);
    this.name = "TenantKeyError";
  }
}

/** BYOK isn't set up on this server (MODEL_KEY_SECRET missing). */
export class KeysUnavailableError extends Error {
  constructor(detail: string) {
    super(`Tenant keys unavailable: ${detail}`);
    this.name = "KeysUnavailableError";
  }
}

const PROVIDER = "anthropic";

// ---- crypto ----

function secret(): Buffer {
  const s = process.env.MODEL_KEY_SECRET;
  if (!s || s.length < 32) throw new KeysUnavailableError("MODEL_KEY_SECRET is not set");
  // Any long random string works; hashing gives AES-256 its 32 bytes.
  return createHash("sha256").update(s).digest();
}

export function encryptKey(site: string, apiKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secret(), iv);
  c.setAAD(Buffer.from(site));
  const ct = Buffer.concat([c.update(apiKey, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptKey(site: string, sealed: string): string {
  const [v, iv, tag, ct] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new KeysUnavailableError("stored key has an unknown format");
  const d = createDecipheriv("aes-256-gcm", secret(), Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(site));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new KeysUnavailableError("stored key does not decrypt (MODEL_KEY_SECRET changed?)");
  }
}

/** Anthropic keys look like sk-ant-...; anything else is refused before a call. */
export function looksLikeKey(k: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(k);
}

/** Never let a key reach a message, a log or the cost log. */
export function scrub(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-…").slice(0, 400);
}

// ---- storage (service role) ----

type Rest = (path: string, init?: RequestInit) => Promise<Response>;

interface Row {
  secret: string;
  last4: string;
  status: KeyStatus;
  error: string;
  checked: string;
}

const enc = encodeURIComponent;

function missing(res: Response, body: { code?: string }): boolean {
  // The table isn't on this server yet: nobody has a key.
  return res.status === 404 || body.code === "42P01" || body.code === "PGRST205";
}

async function readRow(rest: Rest, site: string): Promise<Row | null> {
  const res = await rest(
    `/model_keys?site=eq.${enc(site)}&provider=eq.${PROVIDER}&select=secret,last4,status,error,checked&limit=1`,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (missing(res, body)) return null;
    throw new Error(`model_keys read answered ${res.status}`);
  }
  const [row] = (await res.json()) as Row[];
  return row ?? null;
}

/** The tenant's key, decrypted, or null when it has none. */
export async function readTenantKey(rest: Rest, site: string): Promise<TenantKey | null> {
  const row = await readRow(rest, site);
  if (!row) return null;
  return { apiKey: decryptKey(site, row.secret), last4: row.last4, status: row.status, error: row.error, checked: row.checked };
}

/** What Settings shows: no key material. */
export async function readKeyInfo(rest: Rest, site: string): Promise<KeyInfo | null> {
  const row = await readRow(rest, site);
  if (!row) return null;
  return { last4: row.last4, status: row.status, error: row.error, checked: row.checked };
}

export async function saveTenantKey(rest: Rest, site: string, apiKey: string): Promise<KeyInfo> {
  const row = {
    site,
    provider: PROVIDER,
    secret: encryptKey(site, apiKey),
    last4: apiKey.slice(-4),
    status: "ok" as const,
    error: "",
    checked: new Date().toISOString(),
  };
  const res = await rest("/model_keys?on_conflict=site,provider", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`model_keys save answered ${res.status}`);
  return { last4: row.last4, status: row.status, error: row.error, checked: row.checked };
}

/** Record the result of a test or a real call, when it changed. */
export async function markTenantKey(rest: Rest, site: string, status: KeyStatus, error = ""): Promise<void> {
  await rest(`/model_keys?site=eq.${enc(site)}&provider=eq.${PROVIDER}`, {
    method: "PATCH",
    body: JSON.stringify({ status, error: scrub(error), checked: new Date().toISOString() }),
  });
}

export async function removeTenantKey(rest: Rest, site: string): Promise<void> {
  const res = await rest(`/model_keys?site=eq.${enc(site)}&provider=eq.${PROVIDER}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`model_keys delete answered ${res.status}`);
}

// ---- which credential a tenant runs on ----
//
// model_credentials pins a tenant to one credential, set by a superadmin
// (public.model_credential_set): 'default' (Propaganda's own), 'own' (the
// tenant's saved key) or 'pool:<name>' (a key the server holds in
// ANTHROPIC_KEY_<NAME>, such as a separate Console account for one customer).
// No row: the tenant's saved key when it has one, else the default.
// Whatever it resolves to, there is no fallback to another credential.

export type Credential = "default" | "own" | `pool:${string}`;

export function isCredential(v: string): v is Credential {
  return v === "default" || v === "own" || /^pool:[a-z0-9_]{1,40}$/.test(v);
}

/** The tenant's pinned credential, or null when it has none (or the table isn't on this server). */
export async function readCredential(rest: Rest, site: string): Promise<Credential | null> {
  const res = await rest(`/model_credentials?site=eq.${enc(site)}&select=credential&limit=1`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (missing(res, body)) return null;
    throw new Error(`model_credentials read answered ${res.status}`);
  }
  const [row] = (await res.json()) as { credential: string }[];
  return row && isCredential(row.credential) ? row.credential : null;
}

/** A server-held key: ANTHROPIC_KEY_<NAME> ('pool:axoniq' reads ANTHROPIC_KEY_AXONIQ, 'default' ANTHROPIC_KEY_DEFAULT). */
export function serverKey(name: string): string | null {
  return process.env[`ANTHROPIC_KEY_${name.toUpperCase()}`] || null;
}
