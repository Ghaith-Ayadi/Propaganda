// The one path to a model. Every call to a language model in this repo goes
// through callModel(): it checks the budget rules, runs the call with the
// Vercel AI SDK, and writes one row to public.model_calls (tenant, job, model,
// tokens, cost at API prices). api/check-model-paths.mjs fails when anything
// else reaches a provider. Schema and rules: supabase draft cost_log.sql, and
// cost.ts for the arithmetic.
//
// Server-side only: it writes with the service role key, which never reaches a
// browser. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { generateText, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { costUsd, decide, type Gate, type Price, type Usage } from "./cost";
import { BudgetError, CostLogUnavailableError, UsageLimitError } from "./errors";

export { BudgetError, CostLogUnavailableError, UsageLimitError } from "./errors";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

export interface WorkflowContext {
  workflowId: string | null;
  stepId: number | null;
}

let workflowContext: () => WorkflowContext = () => ({ workflowId: null, stepId: null });

/**
 * The worker registers DBOS's context once (DBOS.workflowID, DBOS.stepID) so
 * every logged call carries its workflow and step and callers never pass them.
 */
export function setWorkflowContext(fn: () => WorkflowContext): void {
  workflowContext = fn;
}

export interface CallOptions {
  /** The tenant (site id) the cost is charged to. */
  site: string;
  /** What asked, a stable name: 'extract-quotes', 'writer', 'scout', ... */
  job: string;
  /** Model id as the AI SDK / AI Gateway spells it: 'google/gemini-2.5-flash-lite'. */
  model: string;
  /** True for agent work that may stop at the tenant's budget; false for the editor. */
  background: boolean;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

export interface CallResult {
  text: string;
  usage: Usage;
  costUsd: number;
  /** True when the tenant is past the warn ratio of its monthly budget. */
  budgetWarning: boolean;
}

// ---- backend access (service role) ----

function backend(): { url: string; key: string } {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) throw new CostLogUnavailableError("backend not configured");
  return { url: SUPABASE_URL, key };
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = backend();
  try {
    return await fetch(`${url}/rest/v1${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (err) {
    throw new CostLogUnavailableError(String(err));
  }
}

async function readGate(site: string): Promise<Gate> {
  const res = await rest("/rpc/cost_gate", { method: "POST", body: JSON.stringify({ p_site: site }) });
  if (!res.ok) throw new CostLogUnavailableError(`cost_gate answered ${res.status}`);
  const g = (await res.json()) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    tenantMonthUsd: Number(g.tenant_month_usd),
    tenantMonthlyLimit: num(g.tenant_monthly_limit),
    tenantWarnRatio: Number(g.tenant_warn_ratio),
    globalDayUsd: Number(g.global_day_usd),
    globalDailyLimit: num(g.global_daily_limit),
    killed: g.killed === true,
  };
}

/** The newest price row for a model, or null when it has none (the call is logged unpriced). */
async function readPrice(model: string): Promise<Price | null> {
  const res = await rest(
    `/model_prices?model=eq.${encodeURIComponent(model)}&effective_from=lte.${encodeURIComponent(new Date().toISOString())}` +
      `&order=effective_from.desc&limit=1`,
  );
  if (!res.ok) throw new CostLogUnavailableError(`model_prices answered ${res.status}`);
  const [row] = (await res.json()) as Record<string, string | number>[];
  if (!row) return null;
  return {
    inputPerMtok: Number(row.input_per_mtok),
    outputPerMtok: Number(row.output_per_mtok),
    cacheReadPerMtok: Number(row.cache_read_per_mtok),
    cacheWritePerMtok: Number(row.cache_write_per_mtok),
  };
}

async function writeCall(row: Record<string, unknown>): Promise<void> {
  const res = await rest("/model_calls", { method: "POST", body: JSON.stringify(row) });
  if (!res.ok) throw new CostLogUnavailableError(`model_calls insert answered ${res.status}`);
}

// ---- provider choice ----

/**
 * Google models keep using GEMINI_API_KEY when it is set; every other id goes
 * through the AI Gateway by name (AI_GATEWAY_API_KEY, or OIDC on Vercel). Adding
 * a provider is a line here, never a call elsewhere.
 */
function defaultResolve(id: string): LanguageModel {
  const gemini = process.env.GEMINI_API_KEY;
  if (id.startsWith("google/") && gemini) {
    return createGoogleGenerativeAI({ apiKey: gemini })(id.slice("google/".length));
  }
  return id;
}

let resolveModel: (id: string) => LanguageModel = defaultResolve;

/** For tests: swap how a model id becomes a model. */
export function setModelResolver(fn: (id: string) => LanguageModel): void {
  resolveModel = fn;
}

/** The subscription's 5-hour limit: a 429 whose unified status is 'rejected'. */
function usageLimit(err: unknown): UsageLimitError | null {
  const e = err as { statusCode?: number; responseHeaders?: Record<string, string> };
  const h = e?.responseHeaders;
  if (e?.statusCode !== 429 || !h || h["anthropic-ratelimit-unified-status"] !== "rejected") return null;
  const reset = Number(h["anthropic-ratelimit-unified-reset"]);
  return new UsageLimitError(Number.isFinite(reset) ? reset * 1000 : Date.now() + 5 * 3600_000);
}

// ---- the call ----

export async function callModel(opts: CallOptions): Promise<CallResult> {
  const verdict = decide(await readGate(opts.site), opts.background);
  if (!verdict.allow) {
    if (verdict.engageKill) {
      await rest("/rpc/cost_engage_kill", {
        method: "POST",
        body: JSON.stringify({ p_reason: "Global daily cap reached" }),
      }).catch(() => {});
    }
    throw new BudgetError(verdict.reason);
  }

  const ctx = workflowContext();
  const base = {
    site: opts.site,
    job: opts.job,
    model: opts.model,
    background: opts.background,
    workflow_id: ctx.workflowId,
    step_id: ctx.stepId,
  };

  let result;
  try {
    result = await generateText({
      model: resolveModel(opts.model),
      system: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.abortSignal,
    });
  } catch (err) {
    const limit = usageLimit(err);
    if (limit) throw limit;
    // A failed call may still have been billed upstream, for an amount we don't know:
    // keep the trace at zero tokens and mark it unpriced so Consumption counts the gap.
    await writeCall({ ...base, status: "error", priced: false }).catch(() => {});
    throw err;
  }

  const u = result.totalUsage;
  const usage: Usage = {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
  const price = await readPrice(opts.model).catch(() => null);
  const cost = price ? costUsd(price, usage) : 0;
  // The answer is already paid for: a log failure is thrown after it is
  // reported, but never silently skipped (callers see CostLogUnavailableError).
  await writeCall({
    ...base,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_write_tokens: usage.cacheWriteTokens,
    cost_usd: cost,
    priced: price !== null,
    status: "ok",
  });

  return { text: result.text, usage, costUsd: cost, budgetWarning: verdict.warn };
}
