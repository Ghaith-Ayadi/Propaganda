// Vercel serverless function: a tenant's own Anthropic key (BYOK), for the
// "Your Anthropic key" card in Settings > Agents.
//
// The key goes in once and never comes back out: answers carry only its last
// four characters and the last test's result. It is stored encrypted
// (_ai/modelKeys.ts) and only after one tiny real call with it succeeds.
// Any member of the site may set, test or remove it.
//
// GET    /api/model-key?site=<id>             -> { key: KeyInfo | null }
// POST   /api/model-key { site, key }          -> test, and save when green: { ok, error?, key }
// POST   /api/model-key { site, action: "test" } -> re-test the saved key: { ok, error?, key }
// DELETE /api/model-key?site=<id>             -> { key: null } (back to Propaganda's account)

import { requireMember } from "./_auth";
import { withTelemetry } from "./_telemetry";
import { KeysUnavailableError, tenantKeys, testTenantKey } from "./_ai/gateway";
import { looksLikeKey } from "./_ai/modelKeys";

async function member(request: Request, site: string): Promise<Response | null> {
  try {
    await requireMember(request, site);
    return null;
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: "Auth failed" }, 500);
  }
}

async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof KeysUnavailableError) return json({ error: "Own keys are not set up on this server yet." }, 503);
    throw err;
  }
}

async function get(request: Request): Promise<Response> {
  const site = new URL(request.url).searchParams.get("site") ?? "";
  return (await member(request, site)) ?? guarded(async () => json({ key: await tenantKeys.info(site) }));
}

async function post(request: Request): Promise<Response> {
  let body: { site?: unknown; key?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const site = typeof body.site === "string" ? body.site : "";
  const denied = await member(request, site);
  if (denied) return denied;

  return guarded(async () => {
    if (body.action === "test") {
      const saved = await tenantKeys.read(site);
      if (!saved) return json({ error: "No key saved" }, 404);
      const result = await testTenantKey(site, saved.apiKey);
      await tenantKeys.mark(site, result.ok, result.ok ? "" : result.error);
      return json({ ...result, key: await tenantKeys.info(site) });
    }

    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!looksLikeKey(key)) {
      return json({ ok: false, error: "That doesn't look like an Anthropic API key. It starts with sk-ant-." }, 400);
    }
    const result = await testTenantKey(site, key);
    // Only a key that works is saved; a red test leaves whatever was there.
    if (!result.ok) return json({ ...result, key: await tenantKeys.info(site) });
    return json({ ok: true, key: await tenantKeys.save(site, key) });
  });
}

async function del(request: Request): Promise<Response> {
  const site = new URL(request.url).searchParams.get("site") ?? "";
  return (
    (await member(request, site)) ??
    guarded(async () => {
      await tenantKeys.remove(site);
      return json({ key: null });
    })
  );
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET = withTelemetry("model-key", get);
export const POST = withTelemetry("model-key", post);
export const DELETE = withTelemetry("model-key", del);
