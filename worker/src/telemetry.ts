// A failed run, sent to PostHog (the same project as the editor and the Vercel
// functions: app/src/lib/telemetry.ts, api/_telemetry.ts), so every error in
// the product is read in one place. The failure log (failures.ts) stays the
// record and the source of tickets; this is the second copy that lands in
// PostHog's error tracking, with the tenant on it.
//
// Each run is sent once (failures.ts records it once). Without POSTHOG_KEY (or
// VITE_POSTHOG_KEY) this does nothing, and it never throws.

import { PostHog } from "posthog-node";

const KEY = () => process.env.POSTHOG_KEY ?? process.env.VITE_POSTHOG_KEY ?? "";

let client: PostHog | null = null;
function posthog(): PostHog | null {
  const key = KEY();
  if (!key) return null;
  client ??= new PostHog(key, { host: process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com", flushAt: 1, flushInterval: 0 });
  return client;
}

export interface RunFailure {
  workflow: string;
  step: string | null;
  fingerprint: string;
  runId: string;
  site: string | null;
  error: string;
  stack: string | null;
  models: string[];
  environment: string;
  commit: string | null;
}

export async function reportRunFailure(f: RunFailure): Promise<void> {
  const ph = posthog();
  if (!ph) return;
  try {
    const err = new Error(f.error.slice(0, 1000));
    err.name = "WorkerRunFailure";
    if (f.stack) err.stack = f.stack;
    await ph.captureExceptionImmediate(err, undefined, {
      route: `worker/${f.workflow}`,
      source: "worker",
      workflow: f.workflow,
      step: f.step,
      fingerprint: f.fingerprint,
      run_id: f.runId,
      tenant_id: f.site,
      site_id: f.site,
      models: f.models,
      app_env: f.environment === "prod" ? "production" : f.environment,
      commit: f.commit?.slice(0, 7),
    });
  } catch (e) {
    console.error("telemetry: couldn't send a run failure:", (e as Error).message);
  }
}
