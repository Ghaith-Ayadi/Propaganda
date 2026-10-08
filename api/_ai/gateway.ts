// The one path to a model. Every call to a language model in this repo goes
// through callModel(): it checks the budget rules, runs the call with the
// Vercel AI SDK, and writes one row to public.model_calls (tenant, job, model,
// tokens, cost at API prices). api/check-model-paths.mjs fails when anything
// else reaches a provider. Schema and rules: supabase draft cost_log.sql, and
// cost.ts for the arithmetic.
//
// Paid APIs that aren't models (DataForSEO for the Scout) go through
// callPaidApi(): the same budget rules, one row per request with the cost the
// provider reported and zero tokens, so they count against the same budgets.
//
// Server-side only: it writes with the service role key, which never reaches a
// browser. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { costUsd, decide, type Gate, type Price, type Usage } from "./cost";
import { BudgetError, CostLogUnavailableError, UsageLimitError } from "./errors";
import {
  markTenantKey,
  readKeyInfo,
  readTenantKey,
  removeTenantKey,
  saveTenantKey,
  scrub,
  TenantKeyError,
  type TenantKey,
} from "./modelKeys";

export { BudgetError, CostLogUnavailableError, UsageLimitError } from "./errors";
export { KeysUnavailableError, TenantKeyError } from "./modelKeys";

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

// ---- a tenant's own key (BYOK, modelKeys.ts) ----
//
// A tenant with a key set has every Anthropic call made with that key, and
// nothing else of ours: no fallback to our account when it fails. Our budget
// rules don't apply to its spend (cost_gate leaves out rows paid_by 'tenant'),
// only the kill switch does. Other providers (Gemini for the editor) stay ours.

/** Gateway ids to Anthropic's: 'anthropic/claude-sonnet-5.5' is 'claude-sonnet-5-5'. */
export function anthropicModelId(id: string): string {
  return id.slice("anthropic/".length).replace(/\./g, "-");
}

let tenantResolve: (apiKey: string, id: string) => LanguageModel = (apiKey, id) =>
  createAnthropic({ apiKey })(anthropicModelId(id));

/** For tests: swap how a tenant's key and a model id become a model. */
export function setTenantModelResolver(fn: (apiKey: string, id: string) => LanguageModel): void {
  tenantResolve = fn;
}

/** The model the Test button calls: the cheapest one, one token out. */
export const KEY_TEST_MODEL = process.env.KEY_TEST_MODEL ?? "anthropic/claude-haiku-5.5";

/**
 * A failure that is the key's (refused, out of credit, rate limited), as a
 * TenantKeyError with Anthropic's own words; null for anything else (a bad
 * request, an outage), which fails or retries like any call.
 */
function tenantKeyFailure(err: unknown): { error: TenantKeyError; broken: boolean } | null {
  const e = err as { statusCode?: number; message?: string; responseHeaders?: Record<string, string> };
  const said = scrub(String(e?.message ?? "no answer"));
  if (e?.statusCode === 401 || e?.statusCode === 403) {
    return { error: new TenantKeyError(`Anthropic refused the key: ${said}`), broken: true };
  }
  if (e?.statusCode === 400 && /credit|billing/i.test(said)) {
    return { error: new TenantKeyError(`The key's Anthropic account is out of credit: ${said}`), broken: true };
  }
  if (e?.statusCode === 429) {
    const wait = Number(e.responseHeaders?.["retry-after"]);
    const at = Date.now() + (Number.isFinite(wait) && wait > 0 ? wait * 1000 : 60_000);
    return { error: new TenantKeyError(`The key hit its Anthropic rate limit: ${said}`, at), broken: false };
  }
  return null;
}

/**
 * How a call for `site` reaches `model`: on the tenant's own key when it has
 * one and the model is Anthropic's, else on ours. Every path to a model goes
 * through this (callModel here, and streamModel for Chat), so a tenant's key
 * is never skipped. `logged` goes into the cost-log row; `budgetFree` means
 * our budget limits don't apply (the kill switch still does).
 */
export async function routeModel(
  site: string,
  model: string,
): Promise<{ model: LanguageModel; tenant: TenantKey | null; logged: { paid_by?: "tenant" }; budgetFree: boolean }> {
  const tenant = model.startsWith("anthropic/") ? await readTenantKey(rest, site) : null;
  if (!tenant) return { model: resolveModel(model), tenant: null, logged: {}, budgetFree: false };
  // paid_by is only sent when it isn't the default, so the log works before migration 20261008000050.
  return { model: tenantResolve(tenant.apiKey, model), tenant, logged: { paid_by: "tenant" }, budgetFree: true };
}

/** Our budget limits off for a call on the tenant's key: only the kill switch applies. */
export function gateFor(gate: Gate, budgetFree: boolean): Gate {
  return budgetFree ? { ...gate, tenantMonthlyLimit: null, globalDailyLimit: null } : gate;
}

/**
 * After a call on a tenant's key failed: the TenantKeyError to throw (the key
 * marked failed when it is broken), or null when the failure isn't the key's.
 * Never retry such a failure on our account.
 */
export async function tenantKeyFailed(site: string, err: unknown): Promise<TenantKeyError | null> {
  const failed = tenantKeyFailure(err);
  if (!failed) return null;
  if (failed.broken) await markTenantKey(rest, site, "failed", failed.error.message.replace(/^TENANT-KEY /, "")).catch(() => {});
  return failed.error;
}

/** After a call on a tenant's key worked: clear a failed mark. */
export async function tenantKeyWorked(site: string, tenant: TenantKey | null): Promise<void> {
  if (tenant && tenant.status !== "ok") await markTenantKey(rest, site, "ok").catch(() => {});
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
  const route = await routeModel(opts.site, opts.model);
  // On the tenant's key, only the kill switch applies: the spend is theirs.
  const verdict = decide(gateFor(await readGate(opts.site), route.budgetFree), opts.background);
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
    ...route.logged,
  };

  const result = await run(base, route, opts);

  const { usage, cost } = await logDone(base, opts.model, result.totalUsage);
  return { text: result.text, usage, costUsd: cost, budgetWarning: verdict.warn };
}

type Logged = Record<string, unknown>;

/** The call itself, on our account or the tenant's key. A failure is logged before it is thrown. */
async function run(base: Logged, route: Awaited<ReturnType<typeof routeModel>>, opts: CallOptions) {
  const { tenant } = route;
  try {
    const result = await generateText({
      model: route.model,
      system: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.abortSignal,
      // A refused key is refused again: no point in the SDK's own retries.
      ...(tenant ? { maxRetries: 0 } : {}),
    });
    await tenantKeyWorked(opts.site, tenant);
    return result;
  } catch (err) {
    if (tenant) {
      const failed = await tenantKeyFailed(opts.site, err);
      if (failed) {
        await writeCall({ ...base, status: "error", priced: false }).catch(() => {});
        throw failed;
      }
    } else {
      const limit = usageLimit(err);
      if (limit) throw limit;
    }
    // A failed call may still have been billed upstream, for an amount we don't know:
    // keep the trace at zero tokens and mark it unpriced so Consumption counts the gap.
    await writeCall({ ...base, status: "error", priced: false }).catch(() => {});
    throw err;
  }
}

/** Price a finished call and write its row. */
async function logDone(
  base: Logged,
  model: string,
  u: Awaited<ReturnType<typeof generateText>>["totalUsage"],
): Promise<{ usage: Usage; cost: number }> {
  const usage: Usage = {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
  const price = await readPrice(model).catch(() => null);
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
  return { usage, cost };
}

// ---- the Test button ----

export type KeyTest = { ok: true } | { ok: false; error: string };

/**
 * One tiny real call with `apiKey` (one token out of the cheapest model),
 * logged to the tenant as paid by its key. Green when Anthropic answers.
 * Never throws for the key's own failures: they come back as { ok: false }.
 */
export async function testTenantKey(site: string, apiKey: string): Promise<KeyTest> {
  const base = { site, job: "key-test", model: KEY_TEST_MODEL, background: false, workflow_id: null, step_id: null, paid_by: "tenant" };
  try {
    const result = await generateText({
      model: tenantResolve(apiKey, KEY_TEST_MODEL),
      prompt: "Reply with OK.",
      maxOutputTokens: 1,
      maxRetries: 0,
    });
    await logDone(base, KEY_TEST_MODEL, result.totalUsage);
    return { ok: true };
  } catch (err) {
    if (err instanceof CostLogUnavailableError) throw err;
    await writeCall({ ...base, status: "error", priced: false }).catch(() => {});
    const failed = tenantKeyFailure(err);
    const said = failed ? failed.error.message.replace(/^TENANT-KEY /, "") : scrub(String((err as Error)?.message ?? err));
    return { ok: false, error: said };
  }
}

// ---- paid APIs that aren't models ----

export interface PaidCallOptions {
  site: string;
  job: string;
  /** Stored in model_calls.model: 'dataforseo/serp-organic', ... */
  service: string;
  background: boolean;
}

/**
 * Run one request to a paid API under the budget rules, and log what it cost.
 * `run` returns the value and the cost the provider reported (USD). A failed
 * request is logged unpriced, like a failed model call.
 */
export async function callPaidApi<T>(
  opts: PaidCallOptions,
  run: () => Promise<{ value: T; costUsd: number }>,
): Promise<T> {
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
    model: opts.service,
    background: opts.background,
    workflow_id: ctx.workflowId,
    step_id: ctx.stepId,
  };
  let out;
  try {
    out = await run();
  } catch (err) {
    await writeCall({ ...base, status: "error", priced: false }).catch(() => {});
    throw err;
  }
  const cost = Math.round(Math.max(0, out.costUsd) * 1e6) / 1e6;
  await writeCall({ ...base, cost_usd: cost, priced: true, status: "ok" });
  return out.value;
}

// ---- the key store, for the Settings endpoint (api/model-key.ts) ----

export const tenantKeys = {
  info: (site: string) => readKeyInfo(rest, site),
  read: (site: string) => readTenantKey(rest, site),
  save: (site: string, apiKey: string) => saveTenantKey(rest, site, apiKey),
  mark: (site: string, ok: boolean, error = "") => markTenantKey(rest, site, ok ? "ok" : "failed", error),
  remove: (site: string) => removeTenantKey(rest, site),
};
