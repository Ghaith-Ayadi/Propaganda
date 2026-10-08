// Product analytics and error tracking (PostHog Cloud, EU), for the editor
// only. Blog readers are counted by the analytics worker (lib/analytics),
// never here.
//
// Nothing else in the app imports posthog-js: use track() and reportError()
// from this file, so changing tools is a one-file job. Without
// VITE_POSTHOG_KEY (local dev, previews) every call only logs or does nothing.
//
// Events go to /ingest on our own host (vercel.json rewrites it to PostHog),
// so ad blockers don't drop them. Server errors from the Vercel functions land
// in the same project (api/_telemetry.ts).

import posthog, { type CaptureResult } from "posthog-js";
import { currentScope, onScopeReset } from "@/lib/scope";
import { COMMIT_SHA, DEPLOY_ENV } from "@/lib/version";
import { causeDetails, codeOf, describe } from "@/lib/errors";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

let enabled = false;
let identifiedAs: string | null = null;

// ---- exception budget ----
// The free plan takes 100k exceptions a month and drops the rest. A loop that
// throws once a second would spend that in a day, so each distinct error is
// sent a few times per window, and one page load sends at most MAX_PER_LOAD.
// PostHog's own limiter only covers autocaptured errors; this covers all.

const SAME_ERROR_LIMIT = 3;
const SAME_ERROR_WINDOW_MS = 10 * 60_000;
const MAX_PER_LOAD = 100;

const recent = new Map<string, { count: number; since: number }>();
let sentThisLoad = 0;

function exceptionBudget(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== "$exception") return event;
  if (sentThisLoad >= MAX_PER_LOAD) return null;
  const list = event.properties.$exception_list as { type?: string; value?: string }[] | undefined;
  const key = `${list?.[0]?.type}:${list?.[0]?.value}`;
  const now = Date.now();
  const entry = recent.get(key);
  if (!entry || now - entry.since > SAME_ERROR_WINDOW_MS) {
    recent.set(key, { count: 1, since: now });
  } else if (entry.count >= SAME_ERROR_LIMIT) {
    return null;
  } else {
    entry.count++;
  }
  sentThisLoad++;
  return event;
}

// ---- who and where ----

/** The signed-in account is the person; the active site rides on every event. */
function identify(): void {
  const scope = currentScope();
  if (!scope) {
    // Signed out of the last account. On a fresh load (nobody identified yet
    // in this tab) keep the stored identity: a scope is about to activate.
    if (identifiedAs) posthog.reset();
    identifiedAs = null;
    return;
  }
  const { account, site } = scope;
  if (identifiedAs && identifiedAs !== account.userId) posthog.reset();
  posthog.identify(account.userId, { email: account.email, name: account.name });
  posthog.register({ site_id: site.id, site_slug: site.slug, site_role: site.role });
  identifiedAs = account.userId;
}

// ---- public API ----

/** Start PostHog. Called once by the editor; blogs never call it. */
export function initTelemetry(): void {
  if (enabled || !KEY) return;
  posthog.init(KEY, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-08-30",
    person_profiles: "identified_only",
    capture_exceptions: true,
    // Pre-GA, we watch everything: every click, and replays with nothing
    // masked (the writing and inputs included). Revisit before GA.
    autocapture: true,
    session_recording: { maskAllInputs: false, maskTextSelector: null },
    before_send: exceptionBudget,
  });
  posthog.register({ app_env: DEPLOY_ENV, commit: COMMIT_SHA });
  // The editor routes by hash (lib/route.ts), which PostHog's own pageview
  // tracking doesn't see. `route` drops the id so views group by screen.
  window.addEventListener("hashchange", () => {
    const route = window.location.hash.replace(/^(#\/(?:post|brief)\/).+$/, "$1:id") || "#/";
    posthog.capture("$pageview", { route });
  });
  enabled = true;
  onScopeReset(identify);
  identify();
}

/** A product event, e.g. track("post_published", { collection }). */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (enabled) posthog.capture(event, properties);
}

/**
 * An error the app caught and carried on from (a failed push, a failed pull).
 * Logs it like console.error did, and sends it unless the browser is offline:
 * this app is offline-first, so offline failures are expected, not bugs.
 */
export function reportError(where: string, err: unknown, extra?: Record<string, unknown>): void {
  // One identifiable line first (lib/errors.ts: the app's code, then the
  // cause's HTTP status, PostgREST/Postgres code and message), then the object.
  console.error(`${where}: ${describe(err)}`, err);
  if (!enabled || navigator.onLine === false) return;
  posthog.captureException(err, {
    where,
    app_error_code: codeOf(err),
    // Backend errors (lib/supabase.ts BackendError) carry the HTTP status (0: no
    // answer at all) and PostgREST's code (a Postgres SQLSTATE such as 23505, or PGRSTxxx).
    ...causeDetails(err),
    request_url: (err as { url?: string } | null)?.url,
    ...extra,
  });
}
