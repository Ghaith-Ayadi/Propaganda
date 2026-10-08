// Shared bits of the api/chat/* handlers.

import { requireMember, type AuthedUser } from "../_auth";
import { BackendError } from "./db";

export const ID_RE = /^[a-z0-9]{15}$/;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** The signed-in member of `site`, or the Response that refuses the request. */
export async function member(request: Request, site: unknown): Promise<AuthedUser | Response> {
  try {
    return await requireMember(request, typeof site === "string" ? site : "");
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export const siteParam = (request: Request) => new URL(request.url).searchParams.get("site") ?? "";

/** The path segment after `after`: /api/chat/conversations/<id>/messages. */
export function segmentAfter(request: Request, after: string): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const i = parts.indexOf(after);
  return i >= 0 ? decodeURIComponent(parts[i + 1] ?? "") : "";
}

/** Backend failures as answers: the chat tables not deployed yet reads as 503, not 500. */
export function backendFailure(err: unknown): Response {
  if (err instanceof BackendError && (err.status === 404 || err.status === 503)) {
    return json({ error: "Chat's tables are not set up on this server yet" }, 503);
  }
  throw err;
}
