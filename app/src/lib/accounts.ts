// Accounts signed in on this browser, and the sites each belongs to.
//
// Like Notion or Slack, one browser can hold several accounts at once. Each has
// its own PocketBase client whose session lives under its own localStorage key,
// so switching is just picking another client: nothing is re-authenticated.
// Sessions last 90 days (pb_hooks/auth.pb.js) and every saved account is
// refreshed in the background on load, so an account only needs signing in
// again after three months without opening the app.
//
// Storage (localStorage):
//   propaganda:accounts      Account[]
//   propaganda:sites:<user>  SiteRef[]   cached memberships, for offline start
//   <storeKey>               the account's PocketBase session
//
// The single-tenant build kept its one session under "pocketbase_auth"; that
// account is adopted as-is (same key) the first time this build runs.

import type PocketBase from "pocketbase";
import { createClient, newId, type PbUser } from "@/lib/pocketbase";

export const LEGACY_STORE_KEY = "pocketbase_auth";
const ACCOUNTS_KEY = "propaganda:accounts";
const sitesKey = (userId: string) => `propaganda:sites:${userId}`;

export interface Account {
  userId: string;
  email: string;
  name: string;
  avatar: string;
  /** localStorage key of this account's PocketBase session. */
  storeKey: string;
}

export type SiteRole = "owner" | "editor";

export interface SiteRef {
  id: string;
  name: string;
  slug: string;
  domain: string;
  analyticsTenant: string;
  role: SiteRole;
}

// ---- storage helpers (every access guarded: private mode can throw) ----

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode: the in-memory copy still works for this tab.
  }
}

// ---- registry ----

const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

export function subscribeAccounts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function accountsVersion(): number {
  return version;
}

export function listAccounts(): Account[] {
  return readJson<Account[]>(ACCOUNTS_KEY, []);
}

function saveAccounts(accounts: Account[]): void {
  writeJson(ACCOUNTS_KEY, accounts);
  emit();
}

export function getAccount(userId: string): Account | null {
  return listAccounts().find((a) => a.userId === userId) ?? null;
}

const clients = new Map<string, PocketBase>();

/** The PocketBase client for an account (one per account, reused). */
export function clientFor(account: Account): PocketBase {
  let c = clients.get(account.userId);
  if (!c) {
    c = createClient(account.storeKey);
    clients.set(account.userId, c);
  }
  return c;
}

function accountFromUser(user: PbUser, storeKey: string): Account {
  return {
    userId: user.id,
    email: user.email ?? "",
    name: user.name ?? "",
    avatar: user.avatar ?? "",
    storeKey,
  };
}

/**
 * First run of the multi-account build: adopt the single session the old build
 * kept under "pocketbase_auth". The session stays under that key, untouched,
 * even if it has expired (the author signs in again and it is refreshed in place).
 */
export function adoptLegacySession(): void {
  if (listAccounts().length) return;
  const probe = createClient(LEGACY_STORE_KEY);
  const user = probe.authStore.record as PbUser | null;
  if (!probe.authStore.token || !user?.id) return;
  clients.set(user.id, probe);
  saveAccounts([accountFromUser(user, LEGACY_STORE_KEY)]);
}

/**
 * Record a freshly signed-in client. Signing in to an account that is already
 * saved refreshes that account's session in place (same key) and drops the
 * temporary one.
 */
function register(temp: PocketBase, tempKey: string): Account {
  const user = temp.authStore.record as PbUser;
  const accounts = listAccounts();
  const existing = accounts.find((a) => a.userId === user.id);
  if (existing) {
    clientFor(existing).authStore.save(temp.authStore.token, temp.authStore.record);
    try {
      localStorage.removeItem(tempKey);
    } catch {
      // ignore
    }
    const updated = { ...accountFromUser(user, existing.storeKey) };
    saveAccounts(accounts.map((a) => (a.userId === user.id ? updated : a)));
    return updated;
  }
  const account = accountFromUser(user, tempKey);
  clients.set(account.userId, temp);
  saveAccounts([...accounts, account]);
  return account;
}

function freshClient(): { client: PocketBase; key: string } {
  const key = `propaganda:auth:${newId()}`;
  return { client: createClient(key), key };
}

/** Google sign-in in a popup. Must be called straight from a click. */
export async function addAccountWithGoogle(): Promise<Account> {
  const { client, key } = freshClient();
  try {
    await client.collection("users").authWithOAuth2({ provider: "google" });
  } catch (err) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    throw err;
  }
  return register(client, key);
}

export interface PendingCode {
  otpId: string;
  email: string;
  client: PocketBase;
  key: string;
}

function randomPassword(): string {
  // Never used to sign in (password auth is off); PocketBase requires one.
  return `${newId()}${newId()}`;
}

/**
 * Email a one-time sign-in code. A first-time address gets an account created
 * on the spot: PocketBase only emails codes to existing users.
 */
export async function requestEmailCode(email: string): Promise<PendingCode> {
  const { client, key } = freshClient();
  const users = client.collection("users");
  const normalized = email.trim().toLowerCase();
  try {
    const password = randomPassword();
    await users.create({ email: normalized, password, passwordConfirm: password, emailVisibility: false });
  } catch {
    // Already registered (or the create is refused): the code request decides.
  }
  const { otpId } = await users.requestOTP(normalized);
  return { otpId, email: normalized, client, key };
}

export async function verifyEmailCode(pending: PendingCode, code: string): Promise<Account> {
  await pending.client.collection("users").authWithOTP(pending.otpId, code.trim());
  return register(pending.client, pending.key);
}

/**
 * Sign one account out of this browser. Its local databases are kept: they may
 * hold drafts that haven't synced, and signing back in picks them up again.
 */
export function signOutAccount(userId: string): void {
  const account = getAccount(userId);
  if (!account) return;
  clientFor(account).authStore.clear();
  clients.delete(userId);
  saveAccounts(listAccounts().filter((a) => a.userId !== userId));
}

/** True when the account has a session that hasn't expired. */
export function hasValidSession(account: Account): boolean {
  return clientFor(account).authStore.isValid;
}

/** True when a session is stored at all, expired or not (offline grace). */
export function hasStoredSession(account: Account): boolean {
  return Boolean(clientFor(account).authStore.token);
}

/**
 * Refresh one account's session. A 401 means the server no longer accepts it;
 * the session is cleared but the account stays listed so it can be signed in
 * again. Anything else (offline, server down) leaves it alone.
 */
export async function refreshAccount(account: Account): Promise<void> {
  const client = clientFor(account);
  if (!client.authStore.token || !navigator.onLine) return;
  try {
    const res = await client.collection("users").authRefresh();
    const user = res.record as PbUser;
    const next = accountFromUser(user, account.storeKey);
    const accounts = listAccounts();
    if (accounts.some((a) => a.userId === account.userId)) {
      saveAccounts(accounts.map((a) => (a.userId === account.userId ? next : a)));
    }
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      client.authStore.clear();
      emit();
    }
  }
}

export function refreshAllAccounts(): Promise<void> {
  return Promise.all(listAccounts().map(refreshAccount)).then(() => undefined);
}

// ---- memberships ----

export function cachedSites(userId: string): SiteRef[] {
  return readJson<SiteRef[]>(sitesKey(userId), []);
}

function cacheSites(userId: string, sites: SiteRef[]): void {
  writeJson(sitesKey(userId), sites);
  emit();
}

interface MembershipRecord {
  id: string;
  role: SiteRole;
  site: string;
  expand?: {
    site?: { id: string; name: string; slug: string; domain: string; analytics_tenant: string };
  };
}

/** The account's sites from the server (and cache them). Throws when offline. */
export async function fetchSites(account: Account): Promise<SiteRef[]> {
  const client = clientFor(account);
  const rows = await client.collection("site_members").getFullList<MembershipRecord>({
    filter: client.filter("user = {:u}", { u: account.userId }),
    expand: "site",
    sort: "created",
  });
  const sites = rows
    .filter((r) => r.expand?.site)
    .map((r) => {
      const s = r.expand!.site!;
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        domain: s.domain ?? "",
        analyticsTenant: s.analytics_tenant || s.slug,
        role: r.role,
      };
    });
  cacheSites(account.userId, sites);
  return sites;
}

/** Update one cached site in place (after a rename). */
export function patchCachedSite(userId: string, site: Partial<SiteRef> & { id: string }): void {
  cacheSites(
    userId,
    cachedSites(userId).map((s) => (s.id === site.id ? { ...s, ...site } : s)),
  );
}

interface SiteResponse {
  site: { id: string; name: string; slug: string; domain: string; analytics_tenant: string };
}

/** Create a site owned by this account. */
export async function createSite(account: Account, name: string, slug: string): Promise<SiteRef> {
  const res = await clientFor(account).send<SiteResponse>("/api/propaganda/sites", {
    method: "POST",
    body: { name, slug },
  });
  const site: SiteRef = {
    id: res.site.id,
    name: res.site.name,
    slug: res.site.slug,
    domain: res.site.domain ?? "",
    analyticsTenant: res.site.analytics_tenant || res.site.slug,
    role: "owner",
  };
  cacheSites(account.userId, [...cachedSites(account.userId).filter((s) => s.id !== site.id), site]);
  return site;
}

/** Rename a site or change its address (owners only). */
export async function updateSite(
  account: Account,
  siteId: string,
  patch: { name?: string; slug?: string },
): Promise<SiteRef> {
  const res = await clientFor(account).send<SiteResponse>(`/api/propaganda/sites/${siteId}`, {
    method: "PATCH",
    body: patch,
  });
  patchCachedSite(account.userId, { id: siteId, name: res.site.name, slug: res.site.slug });
  return cachedSites(account.userId).find((s) => s.id === siteId)!;
}

/** Whether an address is free, for the onboarding form. */
export async function isSlugAvailable(client: PocketBase, slug: string): Promise<boolean> {
  try {
    await client.collection("sites").getFirstListItem(client.filter("slug = {:s}", { s: slug }), {
      fields: "id",
    });
    return false;
  } catch (err) {
    return (err as { status?: number }).status === 404;
  }
}
