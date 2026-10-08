// Who may use the Runs API: a signed-in superadmin. The browser sends the
// Supabase access token of the account that opened Admin; the worker checks it
// itself (HS256 with the stack's JWT secret, the same check every Supabase
// service makes), then looks the user up in private.superadmins.
//
// A table, not a JWT claim (the Admin thread's choice): removing a row revokes
// at once. Until that table exists on the box, nobody is a superadmin and the
// API answers 403: it fails closed.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Claims {
  sub: string;
  role: string;
  email?: string;
  exp: number;
}

/** The verified claims of `token`, or an HttpError(401). */
export function verifyToken(token: string, secret: string, now = Date.now()): Claims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Unauthorized");
  const [head, body, sig] = parts as [string, string, string];
  let header: { alg?: string };
  let claims: Partial<Claims>;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(401, "Unauthorized");
  }
  if (header.alg !== "HS256") throw new HttpError(401, "Unauthorized");
  const want = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "Unauthorized");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) throw new HttpError(401, "Session expired");
  if (claims.role !== "authenticated" || typeof claims.sub !== "string" || !UUID_RE.test(claims.sub)) {
    throw new HttpError(401, "Unauthorized");
  }
  return claims as Claims;
}

let warnedMissing = false;

export async function isSuperadmin(db: Pool, userId: string): Promise<boolean> {
  try {
    const r = await db.query("select 1 from private.superadmins where user_id = $1", [userId]);
    return (r.rowCount ?? 0) > 0;
  } catch (err) {
    // 42P01: the Admin migration isn't on this database yet.
    if ((err as { code?: string }).code === "42P01") {
      if (!warnedMissing) console.warn("private.superadmins is missing: the Runs API refuses everyone until it exists");
      warnedMissing = true;
      return false;
    }
    throw err;
  }
}

/** The superadmin behind `authorization` (a "Bearer <token>" header), or an HttpError. */
export async function requireSuperadmin(db: Pool, authorization: string | undefined, secret: string): Promise<Claims> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Unauthorized");
  const claims = verifyToken(token, secret);
  if (!(await isSuperadmin(db, claims.sub))) throw new HttpError(403, "Forbidden");
  return claims;
}
