// The tenant's own Anthropic key (BYOK), through /api/model-key. The browser
// sends the key once, to be tested and saved, and never gets it back: it
// sees the last four characters and whether the last test or use worked.

import { AppError } from "@/lib/errors";
import { authHeader } from "@/lib/supabase";

export interface KeyInfo {
  last4: string;
  status: "ok" | "failed";
  /** Anthropic's answer when it failed. */
  error: string;
  checked: string;
}

export interface KeyResult {
  ok: boolean;
  error?: string;
  key: KeyInfo | null;
}

async function call<T>(code: string, sentence: string, init: RequestInit & { query?: string }): Promise<T> {
  const res = await fetch(`/api/model-key${init.query ?? ""}`, {
    ...init,
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  // A 400 is a key that doesn't look like one: the answer says why, like a red test.
  if (!res.ok && res.status !== 400) {
    throw new AppError(code, body.error ?? sentence, Object.assign(new Error(`model-key answered ${res.status}`), { status: res.status }));
  }
  return body;
}

export function loadKey(site: string): Promise<{ key: KeyInfo | null }> {
  return call("MODEL-KEY-LOAD", "Couldn't load your Anthropic key's status.", { query: `?site=${site}` });
}

/** Test `key` with one tiny call; saved only when it works. */
export function testAndSaveKey(site: string, key: string): Promise<KeyResult> {
  return call<KeyResult>("MODEL-KEY-SAVE", "Couldn't test the key.", { method: "POST", body: JSON.stringify({ site, key }) }).then(
    (r) => ({ ...r, key: r.key ?? null }),
  );
}

/** Test the saved key again. */
export function retestKey(site: string): Promise<KeyResult> {
  return call("MODEL-KEY-TEST", "Couldn't test the saved key.", { method: "POST", body: JSON.stringify({ site, action: "test" }) });
}

/** Back to Propaganda's own account. */
export function removeKey(site: string): Promise<{ key: null }> {
  return call("MODEL-KEY-REMOVE", "Couldn't remove the key.", { method: "DELETE", query: `?site=${site}` });
}
