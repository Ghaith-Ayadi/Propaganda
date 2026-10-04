// Server errors to PostHog, the same project as the editor
// (app/src/lib/telemetry.ts). Underscore-prefixed so Vercel does not route it.
//
// withTelemetry() wraps a handler: a throw is reported and answered with a 500,
// and a 5xx the handler returns on purpose (an upstream failure) is reported
// too. Each report is sent before the response, because a serverless function
// may be frozen the moment it returns. Without VITE_POSTHOG_KEY it does nothing.

import { PostHog } from "posthog-node";

const KEY = process.env.VITE_POSTHOG_KEY;

const client = KEY
  ? new PostHog(KEY, { host: "https://eu.i.posthog.com", flushAt: 1, flushInterval: 0 })
  : null;

type Handler = (request: Request) => Promise<Response>;

async function report(err: unknown, route: string, extra: Record<string, unknown>): Promise<void> {
  console.error(`${route}:`, err);
  if (!client) return;
  try {
    // No distinct id: the event is not tied to a person (server errors are rare
    // enough to read one by one).
    await client.captureExceptionImmediate(err, undefined, {
      route,
      app_env: process.env.VERCEL_ENV ?? "development",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
      ...extra,
    });
  } catch {
    // Telemetry never takes a request down with it.
  }
}

export function withTelemetry(route: string, handler: Handler): Handler {
  return async (request) => {
    try {
      const response = await handler(request);
      if (response.status >= 500) {
        const body = (await response.clone().text()).slice(0, 500);
        await report(new Error(`${route} answered ${response.status}`), route, {
          http_status: response.status,
          response_body: body,
        });
      }
      return response;
    } catch (err) {
      await report(err, route, { http_status: 500 });
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
