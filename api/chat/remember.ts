// POST /api/chat/remember  { site, statement, conversationId, messageId }
// Proposes the statement to the Guardian with public.kb_remember, as the
// person who pressed the button (a Remember is theirs, never the agent's).
// Only the Guardian admits it into the knowledge base.

import { withTelemetry } from "../_telemetry";
import { json, member } from "../_chat/http";
import { remember } from "../_chat/lookups";

async function handle(request: Request): Promise<Response> {
  let body: { site?: unknown; statement?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const user = await member(request, body.site);
  if (user instanceof Response) return user;
  const statement = typeof body.statement === "string" ? body.statement.trim() : "";
  if (statement.length < 3 || statement.length > 1000) return json({ error: "statement must be 3 to 1000 characters" }, 400);
  const r = await remember(user.token, body.site as string, statement);
  if (!r.available) return json({ error: "The knowledge base is not set up on this server yet" }, 503);
  return json({ proposal: r.proposal });
}

export const POST = withTelemetry("chat/remember", handle);
