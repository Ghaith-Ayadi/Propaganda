// Vercel serverless function: the pipeline's buttons that start an agent.
//
// POST /api/agents { site, agent: "writer", post, task }  the Writer drafts an
//      approved pitch whose writer is the agent (post: its empty draft)
// POST /api/agents { site, agent: "pitcher" }              "Run now": the next
//      batch of pitches, whatever the tenant's batching
//   -> 202 { runId } | 200 { started: false, reason }
//
// Members only. The worker does the rest (worker/src/http.ts /agents/:name),
// the same hand-off Chat uses (_chat/dispatch.ts).

import { requireMember } from "./_auth";
import { withTelemetry } from "./_telemetry";
import { dispatch } from "./_chat/dispatch";

const POST_RE = /^[a-z0-9]{15}$/;

async function post(request: Request): Promise<Response> {
  let body: { site?: unknown; agent?: unknown; post?: unknown; task?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const site = typeof body.site === "string" ? body.site : "";
  let user;
  try {
    user = await requireMember(request, site);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: "Auth failed" }, 500);
  }

  if (body.agent === "writer") {
    const postId = typeof body.post === "string" && POST_RE.test(body.post) ? body.post : null;
    if (!postId) return json({ error: "A post id is required" }, 400);
    const task = typeof body.task === "string" ? body.task.slice(0, 500) : "";
    const r = await dispatch("writer", { site, task: `Write the post: ${task}`, requestedBy: user.userId, conversation: "pipeline", post: postId });
    return r.started ? json({ runId: r.runId }, 202) : json(r);
  }
  if (body.agent === "pitcher") {
    const r = await dispatch("pitcher", { site, task: "Send the next batch", requestedBy: user.userId, conversation: "pipeline" });
    return r.started ? json({ runId: r.runId }, 202) : json(r);
  }
  return json({ error: "Unknown agent" }, 400);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const POST = withTelemetry("agents", post);
