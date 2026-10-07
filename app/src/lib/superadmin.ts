// Which account on this browser (if any) is a superadmin.
//
// The flag lives on the server (private.superadmins, read through
// public.is_superadmin(), which answers for the caller only). The browser can
// hold several accounts at once (lib/accounts.ts), so Admin is offered when ANY
// saved account has the flag, whichever tenant is open. Admin pages talk to the
// server with that account's session, and the server checks the flag again on
// every request: what is stored here only decides what the menu shows.
//
// The last answer per account is remembered (localStorage) so the entry is
// there at once, offline too. A definite "no" from the server clears it; an
// unreachable server leaves it alone.

import { useSyncExternalStore } from "react";
import { accountsVersion, hasValidSession, listAccounts, subscribeAccounts, clientFor, type Account } from "@/lib/accounts";
import type { Client } from "@/lib/supabase";

const hintKey = (authId: string) => `propaganda:superadmin:${authId}`;

function readHint(authId: string): boolean {
  try {
    return localStorage.getItem(hintKey(authId)) === "1";
  } catch {
    return false;
  }
}

function writeHint(authId: string, yes: boolean): void {
  try {
    if (yes) localStorage.setItem(hintKey(authId), "1");
    else localStorage.removeItem(hintKey(authId));
  } catch {
    // ignore: the answer still holds for this tab
  }
}

/** authId -> flag, for accounts asked this page load. */
const answers = new Map<string, boolean>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let snapshotVersion = 0;

function bump() {
  snapshotVersion++;
  for (const l of listeners) l();
}

/** The first saved account with the flag, or null. */
export function superadminAccount(): Account | null {
  for (const a of listAccounts()) {
    if (!a.authId || !hasValidSession(a)) continue;
    const known = answers.get(a.authId);
    if (known ?? readHint(a.authId)) return a;
  }
  return null;
}

async function check(account: Account): Promise<void> {
  const { data, error } = await clientFor(account).rpc("is_superadmin");
  if (error) {
    // Offline or server down: keep the remembered answer and ask again later.
    // Anything else (401/403, or a server that predates the function): not a superadmin.
    const status = (error as { status?: number }).status ?? 0;
    if (status === 0 || status >= 500) {
      asked.delete(account.authId);
      return;
    }
    answers.set(account.authId, false);
    writeHint(account.authId, false);
  } else {
    const yes = data === true;
    answers.set(account.authId, yes);
    writeHint(account.authId, yes);
  }
  bump();
}

/** Ask the server about every saved account not yet asked this page load. */
export function refreshSuperadmin(): void {
  for (const a of listAccounts()) {
    if (!a.authId || !hasValidSession(a) || asked.has(a.authId) || !navigator.onLine) continue;
    asked.add(a.authId);
    void check(a);
  }
}

// An account added or signed out changes the answer, and a new sign-in needs asking.
subscribeAccounts(() => {
  refreshSuperadmin();
  bump();
});

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  refreshSuperadmin();
  return () => listeners.delete(fn);
}

function snapshot(): string {
  return `${snapshotVersion}:${accountsVersion()}`;
}

/** The superadmin account on this browser, re-rendering as answers arrive. */
export function useSuperadminAccount(): Account | null {
  useSyncExternalStore(subscribe, snapshot);
  return superadminAccount();
}

/** The Supabase client Admin requests go through: the superadmin account's own. */
export function adminClient(account: Account): Client {
  return clientFor(account);
}
