// Errors people can report and we can find. Every failure the app shows or
// logs carries a short, stable code naming where it happened; the screen shows
// a plain sentence plus the code, the console and PostHog get the code with the
// full cause (HTTP status, PostgREST/Postgres code, the server's message).
//
// Codes (keep this list in step with the call sites; never reuse one):
//
//   AUTH-POPUP-BLOCKED  the browser blocked the Google window
//   AUTH-OAUTH-START    the auth server wouldn't start Google sign-in
//   AUTH-GOOGLE         Google (or the auth server) sent back an error
//   AUTH-EXCHANGE       the code from Google couldn't be turned into a session
//   AUTH-NO-SESSION     sign-in finished without a session
//   AUTH-CODE-SEND      the sign-in email couldn't be sent
//   AUTH-CODE-VERIFY    the emailed code was refused
//   SITES-FETCH         the account's sites couldn't be loaded
//   SITE-CREATE         creating a site failed
//   SITE-UPDATE         renaming a site or changing its address failed
//   SITE-DELETE         deleting a site failed
//   SITE-SEED           a new site's first settings and collections failed
//   SITE-SWITCH         switching account or site failed
//   UPLOAD              an image upload failed
//   COST-USAGE          the tenant's model usage for the month couldn't be loaded
//   COST-ADMIN          the Admin consumption figures or limits couldn't be loaded or saved
//   RUNS-LOAD           Admin couldn't load agent runs from the worker
//   RUN-RETRY           retrying a run failed
//   RUN-CANCEL          cancelling a run failed
//   RUN-DEMO            starting a demo run failed
//   MODEL-KEY-LOAD      the tenant's own Anthropic key status couldn't be loaded
//   MODEL-KEY-SAVE      testing a new Anthropic key failed on our side (not a red test)
//   MODEL-KEY-TEST      re-testing the saved Anthropic key failed on our side
//   MODEL-KEY-REMOVE    removing the saved Anthropic key failed
//   KB-LOAD             a knowledge base page couldn't load its data
//   KB-REMEMBER         a Remember couldn't be sent
//   KB-FLAG-CLOSE       closing or snoozing a flag failed
//   KB-FIX              applying a flag's fix failed
//   KB-CONTEST          contesting a flag, or sending the contest, failed
//   KB-BULK             a bulk action on a re-check thread failed

import { BackendError } from "@/lib/supabase";

export class AppError extends Error {
  readonly code: string;
  readonly cause: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.cause = cause;
  }
}

/** `err` as an AppError with `code`, keeping it as the cause (an AppError passes through). */
export function coded(code: string, err: unknown, message?: string): AppError {
  if (err instanceof AppError) return err;
  // A request that never got an answer says so, instead of "Failed to fetch".
  const unreachable = err instanceof BackendError && err.status === 0;
  const fallback = unreachable
    ? "Couldn't reach the server. Check your connection and try again."
    : err instanceof Error && err.message
      ? err.message
      : "Something failed.";
  return new AppError(code, message ?? fallback, err);
}

/** `promise`, with a failure turned into an AppError with `code`. */
export function withCode<T>(code: string, promise: PromiseLike<T>): Promise<T> {
  return Promise.resolve(promise).catch((err: unknown) => {
    throw coded(code, err);
  });
}

/** The code of an error, if it has one. */
export function codeOf(err: unknown): string | undefined {
  return err instanceof AppError ? err.code : undefined;
}

/** Details of the underlying failure, for logs and telemetry. */
export function causeDetails(err: unknown): Record<string, unknown> {
  const cause = err instanceof AppError ? err.cause : err;
  if (!cause || typeof cause !== "object") return cause === undefined ? {} : { cause: String(cause) };
  const c = cause as { name?: string; message?: string; status?: number; code?: string; details?: string };
  return {
    cause_name: c.name,
    cause_message: c.message,
    http_status: c.status,
    error_code: cause instanceof BackendError || typeof c.code === "string" ? c.code || undefined : undefined,
    error_details: c.details || undefined,
  };
}

/** One line that identifies the failure: "AUTH-EXCHANGE: <message> (http 400, code bad_code_verifier)". */
export function describe(err: unknown): string {
  const d = causeDetails(err);
  const bits = [
    d.http_status !== undefined ? `http ${d.http_status}` : "",
    d.error_code ? `code ${d.error_code}` : "",
    d.cause_message && d.cause_message !== (err as Error)?.message ? String(d.cause_message) : "",
  ].filter(Boolean);
  const head = `${codeOf(err) ?? "UNCODED"}: ${(err as Error)?.message ?? String(err)}`;
  return bits.length ? `${head} (${bits.join(", ")})` : head;
}

/** What the screen shows: the sentence, then the code to quote. */
export function userMessage(err: unknown): string {
  const message = err instanceof Error && err.message ? err.message : "Something failed.";
  const code = codeOf(err);
  return code ? `${message} (${code})` : message;
}
