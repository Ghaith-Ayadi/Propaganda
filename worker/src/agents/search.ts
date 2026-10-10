// Searching from inside a workflow. Each attempt is its own step (one logged
// request). When DataForSEO fails on its side, the workflow waits durably,
// 10 s, 1 min, 5 min, then 15 min, and asks again; after the fifth failure it
// carries on without results and says so to the person (Ayadi, 2026-10-10).
// A failed attempt is a step that returns, not one that throws, so the run
// isn't marked failed: Admin > Runs shows it as "retried" or "carried on"
// with DataForSEO's message (runs.ts reads `failure`).

import { DBOS } from "@dbos-inc/dbos-sdk";
import { searchOnce, type SearchHit, type SearchOptions } from "./web.js";

export const SEARCH_WAITS_MS = [10_000, 60_000, 5 * 60_000, 15 * 60_000];
let waitsMs = SEARCH_WAITS_MS;

/** For tests: shorter waits, same count. */
export function setSearchWaits(ms: number[]): void {
  waitsMs = ms;
}

/** What a step that failed but let the run carry on returns. Admin > Runs shows it. */
export interface StepFailure {
  message: string;
  /** "retry": another attempt follows; "carry on": the run went on without it. */
  next: "retry" | "carry on";
  /** One line for the Runs page: what happens next. */
  note: string;
}

interface Attempt {
  hits: SearchHit[];
  failure?: StepFailure;
}

/**
 * One run's searches. Once one gives up, DataForSEO is taken to be down for
 * the rest of the run: later searches try once and carry on, so a batch of
 * twenty searches doesn't wait twenty times twenty minutes.
 */
export class SearchSession {
  down: string | null = null;
  /** The searches that gave up, for the person and the run's result. */
  readonly gaps: { step: string; query: string; message: string }[] = [];

  /** One line for the person, or "" when every search answered. */
  notice(): string {
    if (this.gaps.length === 0) return "";
    const n = this.gaps.length;
    return `Written without ${n === 1 ? "one web search" : `${n} web searches`}: the search service (DataForSEO) kept failing (${this.gaps[0]!.message.replace(/^web search (failed|answered|didn't answer):?\s*/i, "").replace(/\.$/, "")}) after waiting about 20 minutes, so ${n === 1 ? "it was" : "they were"} skipped.`;
  }
}

const unavailable = (err: unknown) => err instanceof Error && err.name === "SearchUnavailableError";

function wait(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/** Google's results for `query`, waiting out a DataForSEO outage; [] when it gives up. Call from a workflow. */
export async function searchDurably(
  session: SearchSession,
  query: string,
  limit: number,
  opts: SearchOptions,
  step: string,
): Promise<SearchHit[]> {
  const waits = session.down ? [] : waitsMs;
  for (let n = 0; ; n++) {
    const last = n >= waits.length;
    const failure = (message: string): StepFailure =>
      last
        ? { message, next: "carry on", note: `gave up after ${n + 1} tr${n ? "ies" : "y"}${session.down && n === 0 ? " (search was already down in this run)" : ""}; carried on without results` }
        : { message, next: "retry", note: `trying again in ${wait(waits[n]!)}` };
    const out = await DBOS.runStep(
      async (): Promise<Attempt> => {
        try {
          return { hits: await searchOnce(query, limit, opts) };
        } catch (err) {
          if (!unavailable(err)) throw err;
          return { hits: [], failure: failure((err as Error).message) };
        }
      },
      { name: n === 0 ? step : `${step} (try ${n + 1})` },
    );
    if (!out.failure) {
      session.down = null;
      return out.hits;
    }
    if (last) {
      session.down = out.failure.message;
      session.gaps.push({ step, query, message: out.failure.message });
      return [];
    }
    await DBOS.sleep(waits[n]!);
  }
}
