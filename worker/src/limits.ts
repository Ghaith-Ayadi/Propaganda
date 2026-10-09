// The Claude Max case: the subscription stops answering for a while (the
// 5-hour window, or the weekly one) and says when it resets. That is not a
// failure. A model step that hits it records the stall, sleeps durably until
// the reset, then tries again; a worker restart in between resumes the sleep
// where it was (DBOS.sleep counts from when it started, not from the restart).
//
// The Runs page reads the stall through the workflow's "stall" event and shows
// "Stalled until 14:05" instead of an error.
//
// Model calls go through the gateway (api/_ai/gateway.ts, the cost log thread),
// which throws its own UsageLimitError { resetsAt }. This file doesn't import it:
// usageLimitOf() recognises that error by shape, the AI SDK's raw APICallError
// by its headers, and both again after DBOS has stored and reloaded them.

import { DBOS } from "@dbos-inc/dbos-sdk";

/** The workflow event the Runs page reads. Null once the run is going again. */
export const STALL_EVENT = "stall";

export interface Stall {
  /** usage-limit: our Claude subscription. tenant-key: the tenant's own Anthropic key failed (BYOK). */
  reason: "usage-limit" | "tenant-key";
  /** For tenant-key: Anthropic's answer, which the tenant sees in Settings too. */
  message?: string;
  /** The step that hit the limit. */
  step: string;
  /** Epoch ms: when the run stopped, and when it tries again. */
  since: number;
  until: number;
}

/** No reset time in the answer: try again after this long. */
const DEFAULT_WAIT_MS = 30 * 60 * 1000;
/** A tenant's key that failed is tried again this often, until it works or is replaced. */
const KEY_RETRY_MS = Number(process.env.WORKER_KEY_RETRY_MS ?? 15 * 60 * 1000);
/** Wake a minute after the announced reset, not on the dot. */
const SLACK_MS = Number(process.env.WORKER_STALL_SLACK_MS ?? 60 * 1000);

export class UsageLimitError extends Error {
  readonly resetsAt: number;
  constructor(resetsAt: number, cause?: unknown) {
    // The time is in the message too: it survives any serialisation.
    super(`USAGE-LIMIT until ${resetsAt}`, cause === undefined ? undefined : { cause });
    this.name = "UsageLimitError";
    this.resetsAt = resetsAt;
  }
}

type Headers = Record<string, string | undefined>;

function header(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const h = headers as Headers;
  return h[name] ?? h[name.toLowerCase()];
}

/**
 * When the usage limit `err` reports resets (epoch ms), or null when `err` is
 * something else. Looks through DBOS's retry wrapper and `cause` chains.
 */
export function usageLimitOf(err: unknown, depth = 0): number | null {
  if (!err || typeof err !== "object" || depth > 5) return null;
  const e = err as Record<string, unknown>;

  if (e.name === "UsageLimitError") {
    if (typeof e.resetsAt === "number") return e.resetsAt;
    const m = /USAGE-LIMIT until (\d+)/.exec(String(e.message ?? ""));
    return m ? Number(m[1]) : Date.now() + DEFAULT_WAIT_MS;
  }

  // The AI SDK's APICallError, straight from Anthropic with the subscription's token.
  const status = e.statusCode ?? e.status;
  if (status === 429) {
    const headers = e.responseHeaders ?? e.headers;
    if (header(headers, "anthropic-ratelimit-unified-status") === "rejected") {
      const reset = Number(header(headers, "anthropic-ratelimit-unified-reset"));
      return Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + DEFAULT_WAIT_MS;
    }
  }

  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      const r = usageLimitOf(inner, depth + 1);
      if (r !== null) return r;
    }
  }
  return usageLimitOf(e.cause, depth + 1);
}

/**
 * The gateway's TenantKeyError (api/_ai/modelKeys.ts), by shape, also after
 * DBOS has stored and reloaded it: when to try again and what Anthropic said.
 * Null for anything else.
 */
export function tenantKeyOf(err: unknown, depth = 0): { retryAt: number | null; message: string } | null {
  if (!err || typeof err !== "object" || depth > 5) return null;
  const e = err as Record<string, unknown>;
  const message = String(e.message ?? "");
  if (e.name === "TenantKeyError" || message.startsWith("TENANT-KEY ")) {
    return {
      retryAt: typeof e.retryAt === "number" ? e.retryAt : null,
      message: message.replace(/^TENANT-KEY /, ""),
    };
  }
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      const r = tenantKeyOf(inner, depth + 1);
      if (r) return r;
    }
  }
  return tenantKeyOf(e.cause, depth + 1);
}

/**
 * True when the provider turned the call down before running it: a 4xx other
 * than a timeout, conflict or rate limit (no access to the model, a bad
 * request). Asking again gets the same answer, so the step fails at once.
 * The gateway's refused() is the same test; this file doesn't import it.
 */
export function refusedOf(err: unknown): boolean {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

/**
 * The gateway's EmptyAnswerError (api/_ai/errors.ts), by shape, also after
 * DBOS has stored and reloaded it: the model thought until the budget ran out
 * and answered nothing. The same ask gets the same result, so it isn't retried
 * as is; askJson asks again with less thinking.
 */
export function emptyAnswerOf(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 5) return false;
  const e = err as Record<string, unknown>;
  if (e.name === "EmptyAnswerError" || String(e.message ?? "").startsWith("NO-ANSWER ")) return true;
  if (Array.isArray(e.errors) && e.errors.some((inner) => emptyAnswerOf(inner, depth + 1))) return true;
  return emptyAnswerOf(e.cause, depth + 1);
}

// Once one call has hit the limit, every other step in this process knows
// until when, and stalls without spending a request to find out.
let limitedUntil = 0;

/** For tests. */
export function resetKnownLimit(): void {
  limitedUntil = 0;
}

export interface ModelStepOptions {
  /** Ordinary failures (network, 5xx) are retried this many times. */
  maxAttempts?: number;
  intervalSeconds?: number;
  /** Tell the other steps in this process about the limit (default true; the demo run turns it off). */
  shareLimit?: boolean;
}

/**
 * Run `fn`, a step that calls a model, inside a workflow. Errors are retried
 * like any step; a usage limit is waited out instead, as many times as it
 * takes, and so is a tenant's own key that failed (it is tried again every
 * WORKER_KEY_RETRY_MS, and never replaced by ours). Each stalled attempt stays in the run's history as its own step, so
 * the Runs page can show when it happened.
 */
export async function modelStep<T>(name: string, fn: () => Promise<T>, opts: ModelStepOptions = {}): Promise<T> {
  for (;;) {
    try {
      return await DBOS.runStep(
        async () => {
          const share = opts.shareLimit ?? true;
          if (share && limitedUntil > Date.now()) throw new UsageLimitError(limitedUntil);
          try {
            return await fn();
          } catch (err) {
            const resetsAt = usageLimitOf(err);
            if (resetsAt === null) throw err;
            if (share) limitedUntil = Math.max(limitedUntil, resetsAt);
            throw err instanceof UsageLimitError ? err : new UsageLimitError(resetsAt, err);
          }
        },
        {
          name,
          retriesAllowed: true,
          maxAttempts: opts.maxAttempts ?? 3,
          intervalSeconds: opts.intervalSeconds ?? 5,
          shouldRetry: (err) => usageLimitOf(err) === null && tenantKeyOf(err) === null && !refusedOf(err) && !emptyAnswerOf(err),
        },
      );
    } catch (err) {
      const now = await DBOS.now();
      let stall: Stall;
      const key = tenantKeyOf(err);
      if (key) {
        // One tenant's key: the other tenants' steps carry on, so nothing is shared.
        const until = Math.max(key.retryAt ?? now + KEY_RETRY_MS, now + 1000);
        stall = { reason: "tenant-key", message: key.message, step: name, since: now, until };
      } else {
        const resetsAt = usageLimitOf(err);
        if (resetsAt === null) throw err;
        stall = { reason: "usage-limit", step: name, since: now, until: Math.max(resetsAt, now) + SLACK_MS };
      }
      const until = stall.until;
      await DBOS.setEvent(STALL_EVENT, stall);
      DBOS.logger.info(`${DBOS.workflowID}: ${stall.reason} at ${name}, sleeping until ${new Date(until).toISOString()}`);
      await DBOS.sleep(until - now);
      await DBOS.setEvent(STALL_EVENT, null);
    }
  }
}
