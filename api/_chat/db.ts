// The backend's REST API from Chat's functions. Two ways in:
//  - asUser(token): reads with the person's own rights, so row-level security
//    keeps every lookup (knowledge base, posts) inside their sites;
//  - asServer(): the service role, for the chat tables only browsers can't
//    write. Every query through it filters by site and user itself.

const URL_ = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export class BackendError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`backend answered ${status}: ${detail.slice(0, 300)}`);
    this.name = "BackendError";
  }
}

export interface Rest {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown, prefer?: string): Promise<T>;
  patch(path: string, body: unknown): Promise<void>;
  del(path: string): Promise<void>;
}

function client(key: string, bearer: string): Rest {
  const base = URL_();
  if (!base) throw new BackendError(503, "backend not configured");
  const call = async (path: string, init: RequestInit): Promise<Response> => {
    const res = await fetch(`${base}/rest/v1${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) throw new BackendError(res.status, await res.text().catch(() => ""));
    return res;
  };
  return {
    async get<T>(path: string) {
      return (await (await call(path, {})).json()) as T;
    },
    async post<T>(path: string, body: unknown, prefer = "return=minimal") {
      const res = await call(path, { method: "POST", body: JSON.stringify(body), headers: { Prefer: prefer } });
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T;
    },
    async patch(path: string, body: unknown) {
      await call(path, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
    },
    async del(path: string) {
      await call(path, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
  };
}

export function asUser(token: string): Rest {
  const anon = ANON();
  if (!anon) throw new BackendError(503, "backend not configured");
  return client(anon, token);
}

export function asServer(): Rest {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new BackendError(503, "SUPABASE_SERVICE_ROLE_KEY is not set");
  return client(key, key);
}

/** A PostgREST filter value, quoted. */
export const eq = (v: string) => `eq.${encodeURIComponent(v)}`;
