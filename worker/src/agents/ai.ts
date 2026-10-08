// The knowledge base agents' model calls: askText() from model.ts (the gateway,
// one modelStep per call) with the answer parsed as JSON. With
// WORKER_FAKE_ANSWERS set (tests), canned answers instead and nothing is logged.

import { readFileSync } from "node:fs";
import { config } from "../config.js";
import { modelStep } from "../limits.js";
import { askText, extractJson, type Ask } from "./model.js";

let fake: Record<string, unknown[]> | null = null;
const fakeCalls: Record<string, number> = {};

/** Tests: canned answers by job, in order (the last one repeats). */
function fakeAnswer(job: string): unknown {
  fake ??= JSON.parse(readFileSync(config.fakeAnswers, "utf8")) as Record<string, unknown[]>;
  const list = fake[job];
  if (!list?.length) throw new Error(`No fake answer for ${job}`);
  const i = Math.min(fakeCalls[job] ?? 0, list.length - 1);
  fakeCalls[job] = (fakeCalls[job] ?? 0) + 1;
  return list[i];
}

/** One model call as a step of the current run; returns the parsed answer. */
export async function ask<T>(step: string, opts: Ask): Promise<T> {
  if (config.fakeAnswers) return modelStep(step, async () => fakeAnswer(opts.job) as T);
  return extractJson(await askText(step, { maxOutputTokens: 8000, ...opts })) as T;
}
