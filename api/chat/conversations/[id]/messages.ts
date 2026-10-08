// GET /api/chat/conversations/<id>/messages?site=<site>   The conversation's messages, oldest first

import { withTelemetry } from "../../../_telemetry";
import { ID_RE, backendFailure, json, member, segmentAfter, siteParam } from "../../../_chat/http";
import { listMessages } from "../../../_chat/store";

async function list(request: Request): Promise<Response> {
  const site = siteParam(request);
  const user = await member(request, site);
  if (user instanceof Response) return user;
  const id = segmentAfter(request, "conversations");
  if (!ID_RE.test(id)) return json({ error: "Invalid id" }, 400);
  try {
    return json(await listMessages(site, user.userId, id));
  } catch (err) {
    return backendFailure(err);
  }
}

export const GET = withTelemetry("chat/messages", list);
