// The agents' one door into writing the app's data: PostgREST with the service
// role key, the same backend the model gateway (api/_ai/gateway.ts) writes the
// cost log through. The worker's own pg pool stays read-only.
//
// This file is the plumbing only. Each agent keeps its own reads and writes in
// its own module, narrow on purpose: new rows, or rows an agent made, always
// filtered on the site as well as the id. Nothing an agent writes may touch a
// post a person wrote (CLAUDE.md, the highest-priority rule).

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = "",
  ) {
    super(message);
    this.name = "BackendError";
  }
}

function settings(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new BackendError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set", 0);
  return { url: url.replace(/\/$/, ""), key };
}

export async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = settings();
  return fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function fail(res: Response, what: string): Promise<never> {
  let code = "";
  let detail = "";
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    code = body.code ?? "";
    detail = body.message ?? "";
  } catch {
    /* not JSON */
  }
  throw new BackendError(`${what} answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status, code);
}

/** PostgREST's "relation does not exist" (a table or function not on this server yet). */
export function isMissing(err: unknown): boolean {
  return (
    err instanceof BackendError &&
    (err.code === "42P01" || err.code === "PGRST202" || err.code === "PGRST205" || err.status === 404)
  );
}

/** For PostgREST filters: `id=eq.${enc(id)}`. */
export const enc = encodeURIComponent;

export async function select<T>(table: string, query: string): Promise<T[]> {
  const res = await rest(`/${table}?${query}`);
  if (!res.ok) await fail(res, `${table} read`);
  return (await res.json()) as T[];
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await rest(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  if (!res.ok) await fail(res, `${fn}()`);
  return (await res.json()) as T;
}

/** Insert one row and return it. Mint the id in the caller, so a replayed step writes the same row. */
export async function insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await rest(`/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) await fail(res, `${table} insert`);
  const [out] = (await res.json()) as T[];
  return out as T;
}

/** PATCH with filters; returns the rows changed (none when the filters didn't match). */
export async function patch<T>(table: string, filters: string, values: Record<string, unknown>): Promise<T[]> {
  const res = await rest(`/${table}?${filters}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await fail(res, `${table} update`);
  return (await res.json()) as T[];
}
