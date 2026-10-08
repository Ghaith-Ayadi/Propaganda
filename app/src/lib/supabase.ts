import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// The backend: Propaganda's self-hosted Supabase on Bedrock (Ghaith-Ayadi/Bedrock),
// schema in supabase/migrations. Same host as the app: Caddy sends /auth/v1,
// /rest/v1 and /realtime/v1 to it.
// UI preview mode (lib/preview.ts) runs without a server: a placeholder address
// that never answers stands in when none is configured.
const preview = import.meta.env.VITE_UI_PREVIEW === "1";
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || (preview ? "http://preview.invalid" : undefined);
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || (preview ? "preview" : undefined);

if (!url || !anonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;

export type Client = SupabaseClient;

/**
 * A client whose session lives in localStorage under `storeKey`. Every account
 * signed in on this browser has its own (see lib/accounts.ts), which is what
 * makes switching accounts instant: nothing is re-authenticated, the app just
 * starts talking through a different client.
 */
export function createClient(storeKey: string): Client {
  return createSupabaseClient(url!, anonKey!, {
    auth: {
      storageKey: storeKey,
      persistSession: true,
      autoRefreshToken: true,
      // Sign-in codes come back through lib/oauth.ts, to the client that asked.
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
}

function anonymousClient(): Client {
  return createSupabaseClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Signed-out reads (the public blog). Never carries a session. */
export const publicSb = anonymousClient();

/**
 * The client of the active account. A live binding: lib/scope.ts swaps it when
 * the author switches account, and every `import { sb }` sees the new client.
 * Signed out, it is an anonymous client.
 *
 * Code that awaits between two uses of `sb` and must stay on one account
 * captures it first (`const client = sb`); see lib/scope.ts.
 */
export let sb: Client = publicSb;

export function setActiveClient(client: Client | null): void {
  sb = client ?? publicSb;
}

/** `Authorization` for the app's own functions (api/*): the client's current access token. */
export async function authHeader(client: Client = sb): Promise<string> {
  const { data } = await client.auth.getSession();
  return data.session ? `Bearer ${data.session.access_token}` : "";
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Mint a record id on the client: 15 chars of [a-z0-9], the shape every id has
 * had since PocketBase (the tables check it). Records are created locally with
 * their final id, so nothing has to be re-keyed after the first push, offline
 * or not.
 */
export function newId(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

/**
 * A server timestamp to milliseconds. Postgres sends ISO 8601 with an offset
 * ("2026-10-02T18:13:06.815+00:00"); some paths send a space instead of the T,
 * or "+00" without minutes, which Safari's Date refuses.
 */
export function dateToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Milliseconds to an ISO string for a timestamp column, or null for none. */
export function msToDate(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

// ---- errors ----

/** A failed request: PostgREST's error code (a Postgres SQLSTATE, or PGRSTxxx) and the HTTP status. */
export class BackendError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string;

  constructor(error: { message: string; code?: string; details?: string | null }, status: number) {
    super(error.message);
    this.name = "BackendError";
    this.code = error.code ?? "";
    this.status = status;
    this.details = error.details ?? "";
  }
}

interface Result<T> {
  data: T;
  error: { message: string; code?: string; details?: string | null } | null;
  status: number;
}

/** The data of a supabase-js call, or throw a BackendError. */
export async function must<T>(request: PromiseLike<Result<T>>): Promise<T> {
  const { data, error, status } = await request;
  if (error) throw new BackendError(error, status);
  return data;
}

/** A unique constraint was violated, optionally the one named `constraint`. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return err instanceof BackendError && err.code === "23505" && (!constraint || err.message.includes(constraint));
}

/** A foreign key points at a row that isn't there (e.g. a version whose post isn't on the server yet). */
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof BackendError && err.code === "23503";
}

// ---- reading many rows ----

/** PostgREST answers at most this many rows per request (Supabase Cloud's cap too). */
const PAGE = 1000;

/**
 * Every row a query matches, a page at a time. `page(from, to)` builds the
 * query for one range; give it a total order (end with a unique column) so
 * pages don't overlap or skip.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<Result<T[] | null>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = (await must(page(from, from + PAGE - 1))) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Every row changed after `since` by a timestamp column, in (timestamp, id)
 * order, paged by keyset rather than offset: a row written while the pages are
 * read moves to the end instead of shifting the others past a page boundary.
 * `query()` returns a fresh, already filtered select.
 */
export async function fetchSince<T extends { id: string }>(
  // A select on one table with its own filters (site, ...) applied.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: () => any,
  column: string,
  since: string,
): Promise<T[]> {
  const out: T[] = [];
  let after: { at: string; id: string } | null = null;
  for (;;) {
    const q = after
      ? query().or(`${column}.gt."${after.at}",and(${column}.eq."${after.at}",id.gt.${after.id})`)
      : query().gt(column, since);
    const rows: T[] = (await must<T[] | null>(q.order(column).order("id").limit(PAGE))) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    const last = rows[rows.length - 1] as T & Record<string, string>;
    after = { at: last[column], id: last.id };
  }
}
