// Where the outside world reaches the worker: Caddy serves it under /worker/v1/
// on the app's host (Bedrock compose/sites/app.propaganda.pub.caddy). Webhook
// and OAuth URLs given to Granola, Slack, Zoom, Microsoft and Google are built
// from this.

import { createHmac, timingSafeEqual } from "node:crypto";

export function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? "https://app.propaganda.pub").replace(/\/+$/, "");
}

/** Where the app's Connections page lives, to send people back after an OAuth install. */
export function connectionsPage(result: string): string {
  return `${publicUrl()}/admin#/settings/connections?${result}`;
}

// OAuth `state`: which tenant and person started the install, signed, for 15 minutes.

function stateKey(): Buffer {
  const k = process.env.LISTENER_SECRET_KEY;
  if (!k) throw new Error("LISTENER_SECRET_KEY is not set");
  return createHmac("sha256", Buffer.from(k, "base64")).update("oauth-state").digest();
}

export interface OAuthState {
  site: string;
  user: string;
  provider: string;
  exp: number;
}

export function signState(s: Omit<OAuthState, "exp">, ttlMs = 15 * 60_000): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readState(state: string, provider: string): OAuthState | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", stateKey()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  return s.provider === provider && s.exp > Date.now() ? s : null;
}

/** application/x-www-form-urlencoded POST, for the OAuth token endpoints. */
export async function postForm<T>(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
