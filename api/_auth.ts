// Shared auth helpers for Vercel functions. Underscore-prefixed so Vercel
// does not route this as an endpoint — it's imported by the handlers.
//
// PocketBase holds the session; we don't mint our own tokens. A request is
// authenticated by making a read with its own Authorization header that only
// succeeds for that user: PocketBase verifies the token (signature, expiry)
// and treats a bad one as a guest. No auth-refresh call: those share PB's auth
// rate limit, and every request from this function comes from one IP.

const PB_URL = process.env.PB_URL || process.env.VITE_PB_URL;

const ID_RE = /^[a-z0-9]{15}$/;

export interface AuthedUser {
  userId: string;
  token: string;
}

/** The record id a PocketBase token claims (unverified: PocketBase checks it on use). */
function claimedUserId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.id === "string" && ID_RE.test(payload.id) ? payload.id : null;
  } catch {
    return null;
  }
}

function tokenOf(request: Request): { token: string; userId: string } {
  if (!PB_URL) throw new Response("Backend not configured", { status: 503 });
  const token = request.headers.get("Authorization") ?? "";
  const userId = token ? claimedUserId(token) : null;
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  return { token, userId };
}

async function pbGet(path: string, token: string): Promise<Response> {
  try {
    return await fetch(`${PB_URL}${path}`, { headers: { Authorization: token } });
  } catch {
    throw new Response("Auth check failed", { status: 502 });
  }
}

/** Require a signed-in PocketBase user. Throws a Response on failure. */
export async function requireUser(request: Request): Promise<AuthedUser> {
  const { token, userId } = tokenOf(request);
  // users.viewRule is `id = @request.auth.id`: 200 only with a valid token for this id.
  const res = await pbGet(`/api/collections/users/records/${userId}?fields=id`, token);
  if (!res.ok) throw new Response("Unauthorized", { status: 401 });
  return { userId, token };
}

/** Require a signed-in user who is a member of `siteId`. Throws a Response on failure. */
export async function requireMember(request: Request, siteId: string): Promise<AuthedUser> {
  if (!ID_RE.test(siteId)) {
    throw new Response("Invalid site", { status: 400 });
  }
  const { token, userId } = tokenOf(request);
  // With an invalid token PocketBase answers as a guest, and site_members is
  // invisible to guests: zero rows. A valid token only sees its own rows (and
  // co-members'), so a match proves both the session and the membership.
  const filter = encodeURIComponent(`site="${siteId}" && user="${userId}"`);
  const res = await pbGet(`/api/collections/site_members/records?filter=${filter}&perPage=1&fields=id`, token);
  if (res.status === 401) throw new Response("Unauthorized", { status: 401 });
  if (!res.ok) throw new Response("Membership check failed", { status: 502 });
  const data = (await res.json()) as { items?: unknown[] };
  if ((data.items?.length ?? 0) !== 1) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { userId, token };
}
