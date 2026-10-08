// GET  /api/chat/conversations?site=<site>   The account's conversations in that tenant, newest first
// POST /api/chat/conversations  { site, id }  Starts one (the id is minted by the client)

import { withTelemetry } from "../../_telemetry";
import { ID_RE, backendFailure, json, member, siteParam } from "../../_chat/http";
import { createConversation, listConversations } from "../../_chat/store";

async function list(request: Request): Promise<Response> {
  const site = siteParam(request);
  const user = await member(request, site);
  if (user instanceof Response) return user;
  try {
    return json(await listConversations(site, user.userId));
  } catch (err) {
    return backendFailure(err);
  }
}

async function create(request: Request): Promise<Response> {
  let body: { site?: unknown; id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const user = await member(request, body.site);
  if (user instanceof Response) return user;
  if (typeof body.id !== "string" || !ID_RE.test(body.id)) return json({ error: "Invalid id" }, 400);
  try {
    return json(await createConversation(body.site as string, user.userId, body.id), 201);
  } catch (err) {
    return backendFailure(err);
  }
}

export const GET = withTelemetry("chat/conversations", list);
export const POST = withTelemetry("chat/conversations", create);
