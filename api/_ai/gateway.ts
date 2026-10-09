// The one path to a model. Every call to a language model in this repo goes
// through callModel(): it checks the budget rules, runs the call with the
// Vercel AI SDK, and writes one row to public.model_calls (tenant, job, model,
// tokens, cost at API prices). scripts/check-model-paths.mjs fails when anything
// else reaches a provider. Schema and rules: supabase draft cost_log.sql, and
// cost.ts for the arithmetic.
//
// Paid APIs that aren't models (DataForSEO for the Scout) go through
// callPaidApi(): the same budget rules, one row per request with the cost the
// provider reported and zero tokens, so they count against the same budgets.
//
// Server-side only: it writes with the service role key, which never reaches a
// browser. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamWriter,
} from "ai";
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
// Tool definitions and the UI message stream are plain data, not model calls:
// callers (Chat) use these instead of importing the SDK, which
// check-model-paths.mjs allows only in this file.
export { createUIMessageStream, createUIMessageStreamResponse, stepCountIs, tool };
export type { ModelMessage, TextStreamPart, ToolSet, UIMessage, UIMessageChunk, UIMessageStreamWriter };

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

/**
 * The model every agent and Chat asks for unless told otherwise (Ayadi,
 * 2026-10-09: no Anthropic models on our account). DEFAULT_MODEL overrides it.
 */
export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "deepseek/deepseek-v4-pro";

/** What a call for DEFAULT_MODEL runs on instead for a tenant that saved its own Anthropic key. BYOK_MODEL overrides it. */
export const BYOK_MODEL = process.env.BYOK_MODEL || "anthropic/claude-sonnet-5.5";

/** For tests: swap how a model id becomes a model. */
export function setModelResolver(fn: (id: string) => LanguageModel): void {
  resolveModel = fn;
}

// ---- a tenant's own key (BYOK, modelKeys.ts) ----
//
// A tenant with a key set has every Anthropic call made with that key, and
// nothing else of ours: no fallback to our account when it fails. Our budget
// rules don't apply to its spend (cost_gate leaves out rows paid_by 'tenant'),
// only the kill switch does. A call for DEFAULT_MODEL becomes BYOK_MODEL on the
// key; other providers asked for by name (Gemini for the editor) stay ours.

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

export interface Route {
  /** The model id the call actually runs on: what is logged and priced. */
  id: string;
  model: LanguageModel;
  /** The tenant's own key, when the call runs on it (marked ok or failed after the call). */
  tenant: TenantKey | null;
  /** True when the call goes straight to Anthropic with one key: its failures are the key's, and never retried on another. */
  keyed: boolean;
  /** Extra cost-log columns, sent only when not the default, so the log works before migration 20261008000050. */
  /** credential 'own' marks the tenant's key; the column's default ('private') is our account. */
  logged: { paid_by?: "tenant"; credential?: "own" };
  /** Our budget limits don't apply (the tenant pays); the kill switch still does. */
  budgetFree: boolean;
}

/**
 * How a call for `site` reaches `model`. Every path to a model goes through
 * this (callModel here, and streamModel for Chat). A tenant that saved its own
 * Anthropic key runs every `anthropic/` call on it, and every DEFAULT_MODEL
 * call as BYOK_MODEL, paid by the tenant and outside our budgets, and never on
 * ours, even when the key fails. Every other call (a tenant with no key, or
 * another provider) runs on our AI Gateway, paid by us and inside our budgets.
 */
export async function routeModel(site: string, model: string): Promise<Route> {
  const ours = (): Route => ({ id: model, model: resolveModel(model), tenant: null, keyed: false, logged: {}, budgetFree: false });
  const keyed = model === DEFAULT_MODEL ? BYOK_MODEL : model;
  if (!keyed.startsWith("anthropic/")) return ours();
  const tenant = await readTenantKey(rest, site);
  if (!tenant) return ours();
  return {
    id: keyed,
    model: tenantResolve(tenant.apiKey, keyed),
    tenant,
    keyed: true,
    logged: { paid_by: "tenant", credential: "own" },
    budgetFree: true,
  };
}

/** Our budget limits off for a call on the tenant's key: only the kill switch applies. */
export function gateFor(gate: Gate, budgetFree: boolean): Gate {
  return budgetFree ? { ...gate, tenantMonthlyLimit: null, globalDailyLimit: null } : gate;
}

/**
 * After a call on one Anthropic key failed (route.keyed): the TenantKeyError
 * to throw, or null when the failure isn't the key's. The tenant's own key is
 * marked failed when it is broken. Never retry such a failure on another key.
 */
export async function tenantKeyFailed(site: string, route: Route, err: unknown): Promise<TenantKeyError | null> {
  if (!route.keyed) return null;
  const failed = tenantKeyFailure(err);
  if (!failed) return null;
  if (failed.broken && route.tenant) {
    await markTenantKey(rest, site, "failed", failed.error.message.replace(/^TENANT-KEY /, "")).catch(() => {});
  }
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
    model: route.id,
    background: opts.background,
    workflow_id: ctx.workflowId,
    step_id: ctx.stepId,
    ...route.logged,
  };

  const result = await run(base, route, opts);

  const { usage, cost } = await logDone(base, route.id, result.totalUsage, gatewayCost(result.providerMetadata));
  return { text: result.text, usage, costUsd: cost, budgetWarning: verdict.warn };
}

type Logged = Record<string, unknown>;

/** The call itself, on our account or the tenant's key. A failure is logged before it is thrown. */
async function run(base: Logged, route: Route, opts: CallOptions) {
  const { tenant } = route;
  try {
    const result = await generateText({
      model: route.model,
      system: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.abortSignal,
      // A refused key is refused again: no point in the SDK's own retries.
      ...(route.keyed ? { maxRetries: 0 } : {}),
    });
    await tenantKeyWorked(opts.site, tenant);
    return result;
  } catch (err) {
    if (route.keyed) {
      const failed = await tenantKeyFailed(opts.site, route, err);
      if (failed) {
        await writeCall({ ...base, status: "error", priced: refused(err) }).catch(() => {});
        throw failed;
      }
    } else {
      const limit = usageLimit(err);
      if (limit) throw limit;
    }
    // A failed call may still have been billed upstream, for an amount we don't know:
    // keep the trace at zero tokens and mark it unpriced so Consumption counts the gap.
    // A refused one never ran, so it is a known $0.
    await writeCall({ ...base, status: "error", priced: refused(err) }).catch(() => {});
    throw err;
  }
}

/**
 * True when the provider turned the request down before running it (a 4xx
 * other than a timeout, conflict or rate limit: no access to the model, a bad
 * request, a refused key). Nothing ran, so nothing was billed, and asking
 * again gets the same answer.
 */
export function refused(err: unknown): boolean {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

/**
 * The cost the AI Gateway reported for a call (providerMetadata.gateway.cost),
 * or null when it reported none (a tenant's key, a direct provider).
 */
export function gatewayCost(meta: unknown): number | null {
  const v = (meta as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost;
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6) / 1e6 : null;
}

/** The AI Gateway's public model list (no key, no model call): list prices per token. */
export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

export async function gatewayListPrices(): Promise<Map<string, { input: number; output: number }>> {
  const res = await fetch(GATEWAY_MODELS_URL);
  if (!res.ok) throw new Error(`The AI Gateway's model list answered ${res.status}`);
  const body = (await res.json()) as { data?: { id: string; pricing?: { input?: string; output?: string } }[] };
  const byId = new Map<string, { input: number; output: number }>();
  for (const m of body.data ?? []) {
    const input = Number(m.pricing?.input), output = Number(m.pricing?.output);
    if (Number.isFinite(input) && Number.isFinite(output)) byId.set(m.id, { input, output });
  }
  return byId;
}

/**
 * A call's cost: at our price row for the model, else what the AI Gateway
 * reported (so a model with no row yet is still counted), else unpriced.
 */
function priceCall(price: Price | null, usage: Usage, reported: number | null): { cost: number; priced: boolean } {
  if (price) return { cost: costUsd(price, usage), priced: true };
  if (reported !== null) return { cost: reported, priced: true };
  return { cost: 0, priced: false };
}

/** Price a finished call and write its row. */
async function logDone(
  base: Logged,
  model: string,
  u: Awaited<ReturnType<typeof generateText>>["totalUsage"],
  reported: number | null = null,
): Promise<{ usage: Usage; cost: number }> {
  const usage: Usage = {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
  const price = await readPrice(model).catch(() => null);
  const { cost, priced } = priceCall(price, usage, reported);
  // The answer is already paid for: a log failure is thrown after it is
  // reported, but never silently skipped (callers see CostLogUnavailableError).
  await writeCall({
    ...base,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_write_tokens: usage.cacheWriteTokens,
    cost_usd: cost,
    priced,
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

// ---- the streaming call (Chat) ----

export interface StreamOptions extends Omit<CallOptions, "prompt"> {
  messages: ModelMessage[];
  tools?: ToolSet;
  /** Model calls the reply may take, tool rounds included. Default 6. */
  maxSteps?: number;
}

export interface ModelStream {
  /** True when the tenant is past the warn ratio of its monthly budget. */
  budgetWarning: boolean;
  /** The SDK's stream parts. Every model call in it is logged as it ends, a stopped one included. */
  parts: AsyncIterable<TextStreamPart<ToolSet>>;
  /** What the logged calls cost so far; the whole reply once `parts` is done. */
  costUsd(): number;
}

/** About four characters a token: the estimate for a call stopped before the provider reported usage. */
const estimateTokens = (chars: number) => Math.ceil(chars / 4);

function usageOf(u: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
}): Usage {
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}

/**
 * callModel() for a reply that streams, with tools. Same routing (a tenant's
 * own key for Anthropic models, never a fallback to ours) and budget rules.
 * Each step (one request to the model) is one row in public.model_calls. A
 * reply stopped mid-stream (the reader left, or `abortSignal` fired) never
 * reports its usage, but the provider bills what it produced, so the step in
 * flight is logged as `stopped` with tokens estimated from what had arrived:
 * the input from the previous step's count (or the prompt's length) and the
 * output from the text streamed so far.
 */
export async function streamModel(opts: StreamOptions): Promise<ModelStream> {
  const route = await routeModel(opts.site, opts.model);
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
    model: route.id,
    background: opts.background,
    workflow_id: ctx.workflowId,
    step_id: ctx.stepId,
    ...route.logged,
  };
  const { tenant } = route;

  let price: Price | null | undefined;
  const priceOf = async () => (price === undefined ? (price = await readPrice(route.id).catch(() => null)) : price);
  let total = 0;
  let logFailure: unknown = null;

  const log = async (usage: Usage, status: "ok" | "stopped", reported: number | null = null) => {
    const { cost, priced } = priceCall(await priceOf(), usage, reported);
    total = Math.round((total + cost) * 1e6) / 1e6;
    try {
      await writeCall({
        ...base,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
        cache_write_tokens: usage.cacheWriteTokens,
        cost_usd: cost,
        priced,
        status,
      });
    } catch (err) {
      // The reply is already paid for: finish it, then fail (as callModel does).
      logFailure ??= err;
    }
  };

  const result = streamText({
    model: route.model,
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    stopWhen: stepCountIs(opts.maxSteps ?? 6),
    maxOutputTokens: opts.maxOutputTokens,
    abortSignal: opts.abortSignal,
    // A refused key is refused again: no point in the SDK's own retries.
    ...(route.keyed ? { maxRetries: 0 } : {}),
  });

  const promptChars = (opts.system?.length ?? 0) + JSON.stringify(opts.messages).length;

  async function* parts(): AsyncGenerator<TextStreamPart<ToolSet>> {
    let open = false; // a step has started and not reported its usage
    let started = false; // any step started at all
    let chars = 0; // output streamed in the open step
    let input = estimateTokens(promptChars); // best guess at the open step's input
    let failed: unknown = null;
    let thrown: unknown = null;
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "start-step":
            open = started = true;
            chars = 0;
            break;
          case "text-delta":
          case "reasoning-delta":
            chars += part.text.length;
            break;
          case "tool-input-delta":
            chars += part.delta.length;
            break;
          case "finish-step": {
            open = false;
            const usage = usageOf(part.usage);
            // The next step re-sends this one's input and output.
            input = usage.inputTokens + usage.outputTokens;
            await log(usage, "ok", gatewayCost(part.providerMetadata));
            break;
          }
          case "error":
            failed = part.error;
            break;
        }
        if (failed) break;
        yield part;
      }
    } catch (err) {
      failed = err;
    } finally {
      // Reached on a normal end, an abort, an error, or the reader returning early.
      if (failed) {
        if (route.keyed) {
          const keyErr = await tenantKeyFailed(opts.site, route, failed);
          // Never usageLimit, never a retry on another account.
          if (keyErr) thrown = keyErr;
          await writeCall({ ...base, status: "error", priced: !started && refused(failed) }).catch(() => {});
        } else {
          const limit = usageLimit(failed);
          if (limit) thrown = limit; // cost nothing: not logged
          // As callModel: billed upstream for an amount we don't know, unless refused before it ran.
          else await writeCall({ ...base, status: "error", priced: !started && refused(failed) }).catch(() => {});
        }
      } else {
        if (open || (!started && opts.abortSignal?.aborted)) {
          await log({ inputTokens: input, outputTokens: estimateTokens(chars), cacheReadTokens: 0, cacheWriteTokens: 0 }, "stopped");
        }
        if (started) await tenantKeyWorked(opts.site, tenant);
      }
    }
    if (failed) throw thrown ?? failed;
    if (logFailure) throw new CostLogUnavailableError(String(logFailure));
  }

  return { budgetWarning: verdict.warn, parts: parts(), costUsd: () => total };
}
