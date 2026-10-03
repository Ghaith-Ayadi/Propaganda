// Accounts signed in on this browser, and the sites each belongs to.
//
// Like Notion or Slack, one browser can hold several accounts at once. Each has
// its own Supabase client whose session lives under its own localStorage key,
// so switching is just picking another client: nothing is re-authenticated.
// Sessions renew themselves (an hourly access token, a long-lived refresh
// token), and every saved account is checked in the background on load.
//
// Storage (localStorage):
//   propaganda:accounts      Account[]
//   propaganda:sites:<user>  SiteRef[]   cached memberships, for offline start
//   <storeKey>               the account's Supabase session
//
// Identity. `userId` names the account on this device: its local databases
// (propaganda-<userId>-<site>), cached sites and the active pointer key on it.
// For an account from the PocketBase days it is the PocketBase user id (kept
// on the server as app_metadata.pb_id), so after the move the account opens
// the same local databases, unsynced drafts included. `authId` is the server's
// user id, used for every request.
//
// The move from PocketBase: accounts saved by the PocketBase build hold a
// session the server no longer accepts. They stay listed, with their userId,
// and get a fresh, empty session key: the app asks to sign in again, and
// signing in finds the same account through pb_id. Their PocketBase sessions
// are left in storage untouched.

import type { User } from "@supabase/supabase-js";
import { OAUTH_CALLBACK_PATH, OAUTH_MESSAGE, type OAuthMessage } from "@/lib/oauthCallback";
import { SUPABASE_ANON_KEY, SUPABASE_URL, createClient, must, newId, type Client } from "@/lib/supabase";

const ACCOUNTS_KEY = "propaganda:accounts";
const sitesKey = (userId: string) => `propaganda:sites:${userId}`;
/** Where the single-tenant PocketBase build kept its one session. */
const POCKETBASE_SESSION_KEY = "pocketbase_auth";

export interface Account {
  /** The account's name on this device (see the header). */
  userId: string;
  /** The server's user id; "" until the account signs in on this backend. */
  authId: string;
  email: string;
  name: string;
  avatar: string;
  /** localStorage key of this account's Supabase session. */
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

function forget(...keys: string[]): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
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

const clients = new Map<string, Client>();

function watch(client: Client): Client {
  // A session that ends (refresh refused, signed out in another tab) shows as
  // "sign in again" at once.
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN") emit();
  });
  return client;
}

/** The Supabase client for an account (one per account, reused). */
export function clientFor(account: Account): Client {
  let c = clients.get(account.userId);
  if (!c) {
    c = watch(createClient(account.storeKey));
    clients.set(account.userId, c);
  }
  return c;
}

function freshKey(): string {
  return `propaganda:sb:${newId()}`;
}

function freshClient(): { client: Client; key: string } {
  const key = freshKey();
  return { client: createClient(key), key };
}

/** Drop a client nobody will use again, and what it stored. */
function discard(client: Client, key: string): void {
  void client.auth.stopAutoRefresh();
  forget(key, `${key}-code-verifier`, `${key}-user`);
}

/**
 * First run after the move from PocketBase (see the header): keep every saved
 * account, with a fresh session key. A browser that only ever ran the
 * single-tenant build has its one account under "pocketbase_auth" instead.
 */
export function adoptPocketBaseAccounts(): void {
  const saved = readJson<Array<Partial<Account>>>(ACCOUNTS_KEY, []);
  if (saved.length) {
    if (saved.every((a) => typeof a.authId === "string")) return;
    saveAccounts(
      saved.map((a) =>
        typeof a.authId === "string"
          ? (a as Account)
          : {
              userId: a.userId ?? "",
              authId: "",
              email: a.email ?? "",
              name: a.name ?? "",
              avatar: "",
              storeKey: freshKey(),
            },
      ),
    );
    return;
  }
  const legacy = readJson<{ record?: { id?: string; email?: string; name?: string }; model?: { id?: string; email?: string; name?: string } } | null>(
    POCKETBASE_SESSION_KEY,
    null,
  );
  const record = legacy?.record ?? legacy?.model;
  if (!record?.id) return;
  saveAccounts([{ userId: record.id, authId: "", email: record.email ?? "", name: record.name ?? "", avatar: "", storeKey: freshKey() }]);
}

function nameOf(user: User): string {
  const m = user.user_metadata ?? {};
  return String(m.full_name || m.name || "");
}

function avatarOf(user: User): string {
  const m = user.user_metadata ?? {};
  return String(m.avatar_url || m.picture || "");
}

/**
 * Record a freshly signed-in client. Signing in to an account that is already
 * saved (by its server id, or by its PocketBase id) gives that account this
 * session, keeping its userId and so its local databases.
 */
async function register(temp: Client, tempKey: string): Promise<Account> {
  const { data } = await temp.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new Error("Sign-in didn't complete. Try again.");
  const pbId = typeof user.app_metadata?.pb_id === "string" ? user.app_metadata.pb_id : "";
  const fields = { authId: user.id, email: user.email ?? "", name: nameOf(user), avatar: avatarOf(user) };

  const accounts = listAccounts();
  const existing = accounts.find((a) => a.authId === user.id || (pbId && a.userId === pbId));
  if (existing) {
    const old = clients.get(existing.userId);
    if (old) discard(old, existing.storeKey);
    else forget(existing.storeKey);
    clients.set(existing.userId, watch(temp));
    const updated: Account = { ...existing, ...fields, storeKey: tempKey };
    saveAccounts(accounts.map((a) => (a.userId === existing.userId ? updated : a)));
    return updated;
  }
  const account: Account = { userId: pbId || user.id, ...fields, storeKey: tempKey };
  clients.set(account.userId, watch(temp));
  saveAccounts([...accounts, account]);
  return account;
}

/** Thrown when the Google window was closed before signing in. Not an error to show. */
export class SignInCancelled extends Error {
  constructor() {
    super("Google sign-in was cancelled.");
  }
}

/** A code already on its way when the popup closes gets this long to land. */
const POPUP_CLOSE_GRACE_MS = 2500;

function openGooglePopup(): Window | null {
  const width = Math.min(520, window.screen.availWidth);
  const height = Math.min(640, window.screen.availHeight);
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  return window.open("", "propaganda-google", `popup,width=${width},height=${height},left=${left},top=${top}`);
}

/**
 * The code Google's round trip ends with. The popup lands on
 * OAUTH_CALLBACK_PATH, which hands it over (lib/oauthCallback.ts) on a
 * BroadcastChannel, and to window.opener where that link survived. A popup
 * closed without one is a cancel.
 */
function waitForCode(popup: Window): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(OAUTH_MESSAGE) : null;
    let closedAt = 0;
    const finish = () => {
      channel?.close();
      window.removeEventListener("message", onMessage);
      window.clearInterval(watcher);
    };
    const take = (msg: OAuthMessage | undefined) => {
      if (!msg || msg.type !== OAUTH_MESSAGE) return;
      finish();
      if (msg.code) resolve(msg.code);
      else reject(new Error(msg.error || "Google sign-in failed. Try again."));
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin) take(e.data as OAuthMessage);
    };
    if (channel) channel.onmessage = (e) => take(e.data as OAuthMessage);
    window.addEventListener("message", onMessage);
    const watcher = window.setInterval(() => {
      if (!popup.closed) return;
      if (!closedAt) closedAt = Date.now();
      else if (Date.now() - closedAt > POPUP_CLOSE_GRACE_MS) {
        finish();
        reject(new SignInCancelled());
      }
    }, 400);
  });
}

/**
 * Google sign-in in a popup. Must be called straight from a click: the popup is
 * opened before anything is awaited, which is the only way browsers allow it.
 * A blocked popup throws at once, a closed one throws SignInCancelled.
 */
export async function addAccountWithGoogle(): Promise<Account> {
  const popup = openGooglePopup();
  if (!popup) {
    throw new Error("Your browser blocked the Google window. Allow pop-ups for this site and try again.");
  }
  const { client, key } = freshClient();
  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${OAUTH_CALLBACK_PATH}`, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw error ?? new Error("Google sign-in isn't available right now.");
    if (popup.closed) throw new SignInCancelled();
    popup.location.href = data.url;
    const code = await waitForCode(popup);
    const exchanged = await client.auth.exchangeCodeForSession(code, data.flowId ? { flowId: data.flowId } : undefined);
    if (exchanged.error) throw exchanged.error;
  } catch (err) {
    discard(client, key);
    throw err;
  } finally {
    if (!popup.closed) popup.close();
  }
  return register(client, key);
}

/**
 * Whether the server can email sign-in codes: email sign-in is on only once
 * SMTP is configured (Bedrock compose/propaganda-supabase). Without it, asking
 * for a code would fail, so the sign-in screen doesn't offer it.
 */
export async function emailCodesEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
    const settings = (await res.json()) as { external?: { email?: boolean } };
    return Boolean(settings.external?.email);
  } catch {
    return false;
  }
}

export interface PendingCode {
  email: string;
  client: Client;
  key: string;
}

/** Email a one-time sign-in code. A first-time address gets an account on the spot. */
export async function requestEmailCode(email: string): Promise<PendingCode> {
  const { client, key } = freshClient();
  const normalized = email.trim().toLowerCase();
  const { error } = await client.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: true } });
  if (error) {
    discard(client, key);
    throw new Error(error.message);
  }
  return { email: normalized, client, key };
}

export async function verifyEmailCode(pending: PendingCode, code: string): Promise<Account> {
  const { error } = await pending.client.auth.verifyOtp({ email: pending.email, token: code.trim(), type: "email" });
  if (error) throw new Error(error.message);
  return register(pending.client, pending.key);
}

/**
 * Sign one account out of this browser. Its local databases are kept: they may
 * hold drafts that haven't synced, and signing back in picks them up again.
 */
export function signOutAccount(userId: string): void {
  const account = getAccount(userId);
  if (!account) return;
  const client = clientFor(account);
  clients.delete(userId);
  saveAccounts(listAccounts().filter((a) => a.userId !== userId));
  // Ends the session on the server when online; the local copy goes either way.
  void client.auth
    .signOut({ scope: "local" })
    .catch(() => undefined)
    .finally(() => discard(client, account.storeKey));
}

function storedSession(account: Account): { refresh_token?: string } | null {
  return readJson<{ refresh_token?: string } | null>(account.storeKey, null);
}

/**
 * True when the account has a session it can use: one that renews itself. A
 * session the server refuses is removed by the client, and this turns false.
 */
export function hasValidSession(account: Account): boolean {
  return Boolean(account.authId && storedSession(account)?.refresh_token);
}

/** True when a session is stored at all (offline, it can't be checked). */
export function hasStoredSession(account: Account): boolean {
  return hasValidSession(account);
}

/**
 * Check one account's session and refresh its name and picture. A session the
 * server refuses is cleared, the account stays listed so it can sign in again.
 * Anything else (offline, server down) leaves it alone.
 */
export async function refreshAccount(account: Account): Promise<void> {
  if (!hasValidSession(account) || !navigator.onLine) return;
  const client = clientFor(account);
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (error.status === 401 || error.status === 403) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      forget(account.storeKey);
      emit();
    }
    return;
  }
  const next: Account = { ...account, email: data.user.email ?? account.email, name: nameOf(data.user), avatar: avatarOf(data.user) };
  const accounts = listAccounts();
  if (accounts.some((a) => a.userId === account.userId)) {
    saveAccounts(accounts.map((a) => (a.userId === account.userId ? next : a)));
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

interface SiteRow {
  id: string;
  name: string;
  slug: string;
  domain: string;
  analytics_tenant: string;
}

function siteRefOf(s: SiteRow, role: SiteRole): SiteRef {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    domain: s.domain ?? "",
    analyticsTenant: s.analytics_tenant || s.slug,
    role,
  };
}

/** The account's sites from the server (and cache them). Throws when offline. */
export async function fetchSites(account: Account): Promise<SiteRef[]> {
  const rows = (await must(
    clientFor(account)
      .from("site_members")
      .select("role, created, site:sites(id, name, slug, domain, analytics_tenant)")
      .eq("user_id", account.authId)
      .order("created"),
  )) as unknown as Array<{ role: SiteRole; site: SiteRow | null }>;
  const sites = rows.filter((r) => r.site).map((r) => siteRefOf(r.site!, r.role));
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

/** Create a site owned by this account. */
export async function createSite(account: Account, name: string, slug: string): Promise<SiteRef> {
  const res = (await must(clientFor(account).rpc("create_site", { site_name: name, site_slug: slug }))) as { site: SiteRow };
  const site = siteRefOf(res.site, "owner");
  cacheSites(account.userId, [...cachedSites(account.userId).filter((s) => s.id !== site.id), site]);
  return site;
}

/** Rename a site or change its address (owners only). */
export async function updateSite(
  account: Account,
  siteId: string,
  patch: { name?: string; slug?: string },
): Promise<SiteRef> {
  const res = (await must(
    clientFor(account).rpc("update_site", { site_id: siteId, site_name: patch.name ?? null, site_slug: patch.slug ?? null }),
  )) as { site: SiteRow };
  patchCachedSite(account.userId, { id: siteId, name: res.site.name, slug: res.site.slug });
  return cachedSites(account.userId).find((s) => s.id === siteId)!;
}

/**
 * Delete a site (owners only; the server refuses one that has posts) and drop
 * it from the cache. Its local database stays, like every local database.
 */
export async function deleteSite(account: Account, siteId: string): Promise<void> {
  await must(clientFor(account).rpc("delete_site", { site_id: siteId }));
  cacheSites(
    account.userId,
    cachedSites(account.userId).filter((s) => s.id !== siteId),
  );
}

/** Whether an address is free, for the onboarding form. */
export async function isSlugAvailable(client: Client, slug: string): Promise<boolean> {
  const { data, error } = await client.from("sites").select("id").eq("slug", slug).maybeSingle();
  return !error && !data;
}
