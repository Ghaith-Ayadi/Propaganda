// DELETE /api/chat/conversations/<id>?site=<site>   Deletes the conversation and its messages

import { withTelemetry } from "../../_telemetry";
import { ID_RE, backendFailure, json, member, segmentAfter, siteParam } from "../../_chat/http";
import { deleteConversation } from "../../_chat/store";

async function remove(request: Request): Promise<Response> {
  const site = siteParam(request);
  const user = await member(request, site);
  if (user instanceof Response) return user;
  const id = segmentAfter(request, "conversations");
  if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
  try {
    await deleteConversation(site, user.userId, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return backendFailure(err);
  }
}

export const DELETE = withTelemetry("chat/conversations/delete", remove);
