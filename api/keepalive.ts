// Vercel cron target — keeps the Supabase project from being auto-paused.
//
// Supabase pauses free-tier projects after ~7 days with no activity. A paused
// project's REST host stops answering, so every network call in the app fails
// with "TypeError: Failed to fetch" and only a manual restore from the Supabase
// dashboard brings it back. This endpoint issues one tiny read against a real
// table, which counts as database activity and resets that idle clock.
//
// GET /api/keepalive   (scheduled daily in vercel.json → "crons")
// Returns: { ok: true, status, ms } or { ok: false, ... } with a 5xx so a
// failing keepalive shows up in the Vercel cron log instead of passing silently.

export async function GET(request: Request): Promise<Response> {
  // Vercel signs cron invocations with CRON_SECRET when that env var is set.
  // Only enforce it when it exists, so a manual curl still works without setup.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  // Publishable/anon key is enough: RLS may return zero rows, but the query
  // still reaches Postgres, which is the whole point.
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json({ ok: false, error: "Supabase env not configured" }, 503);
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/posts?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch (err) {
    // Network-level failure — usually the project is already paused or deleted.
    return json({ ok: false, error: String(err) }, 502);
  }
  const ms = Date.now() - started;

  if (!res.ok) {
    return json({ ok: false, status: res.status, body: await res.text(), ms }, 502);
  }
  return json({ ok: true, status: res.status, ms });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
