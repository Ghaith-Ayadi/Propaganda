// Shared auth helpers for Vercel functions. Underscore-prefixed so Vercel
// does not route this as an endpoint — it's imported by the handlers.
//
// Supabase holds the session; we don't mint our own tokens. A request is
// authenticated by making a read with its own access token: the server
// verifies it (signature, expiry) and refuses a bad one with a 401.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const SITE_RE = /^[a-z0-9]{15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AuthedUser {
  userId: string;
  /** The access token, without "Bearer ". */
  token: string;
}

/** The user id a token claims (unverified: the server checks it on use). */
function claimedUserId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.sub === "string" && UUID_RE.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

function tokenOf(request: Request): AuthedUser {
  if (!SUPABASE_URL || !ANON_KEY) throw new Response("Backend not configured", { status: 503 });
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const userId = token ? claimedUserId(token) : null;
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  return { token, userId };
}

/** A GET against the backend as the request's user. */
export async function backendGet(path: string, token: string): Promise<Response> {
  try {
    return await fetch(`${SUPABASE_URL}${path}`, {
      headers: { apikey: ANON_KEY!, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Response("Auth check failed", { status: 502 });
  }
}

/** Require a signed-in user. Throws a Response on failure. */
export async function requireUser(request: Request): Promise<AuthedUser> {
  const user = tokenOf(request);
  const res = await backendGet("/auth/v1/user", user.token);
  if (!res.ok) throw new Response("Unauthorized", { status: 401 });
  const body = (await res.json()) as { id?: string };
  if (body.id !== user.userId) throw new Response("Unauthorized", { status: 401 });
  return user;
}

/** Require a signed-in user who is a member of `siteId`. Throws a Response on failure. */
export async function requireMember(request: Request, siteId: string): Promise<AuthedUser> {
  if (!SITE_RE.test(siteId)) {
    throw new Response("Invalid site", { status: 400 });
  }
  const user = tokenOf(request);
  // A bad token is a 401 from the server. A good one sees only its own
  // memberships (and co-members'), so a match proves both the session and
  // the membership.
  const res = await backendGet(
    `/rest/v1/site_members?select=id&site=eq.${siteId}&user_id=eq.${user.userId}&limit=1`,
    user.token,
  );
  if (res.status === 401) throw new Response("Unauthorized", { status: 401 });
  if (!res.ok) throw new Response("Membership check failed", { status: 502 });
  const rows = (await res.json()) as unknown[];
  if (rows.length !== 1) {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}
