// tsx --test _ai/gateway.test.ts
// Runs callModel against a stub of the backend's REST API and a mock model.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";

const calls: Record<string, unknown>[] = [];
// What the gateway captured (model_call_io), and what that endpoint answers.
const captures: Record<string, any>[] = [];
let captureStatus = 201;
let gate: Record<string, unknown> = {};
let kills = 0;
// model_keys rows by site (sealed with encryptKey), and the PATCHes the gateway sends.
const keyRows: Record<string, Record<string, unknown>> = {};
const keyMarks: Record<string, unknown>[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/rest/v1/rpc/cost_gate")) return void res.end(JSON.stringify(gate));
    if (req.url?.startsWith("/rest/v1/rpc/cost_engage_kill")) { kills++; return void res.end("null"); }
    if (req.url?.startsWith("/rest/v1/model_prices"))
      return void res.end(JSON.stringify([{ input_per_mtok: "1", output_per_mtok: "2", cache_read_per_mtok: "0", cache_write_per_mtok: "0" }]));
    if (req.url?.startsWith("/rest/v1/model_keys")) {
      const site = /site=eq\.([a-z0-9]+)/.exec(req.url)?.[1] ?? "";
      if (req.method === "PATCH") { keyMarks.push(JSON.parse(body)); return void res.end("[]"); }
      return void res.end(JSON.stringify(keyRows[site] ? [keyRows[site]] : []));
    }
    if (req.url?.startsWith("/rest/v1/model_calls")) { calls.push(JSON.parse(body)); res.statusCode = 201; return void res.end("[]"); }
    if (req.url?.startsWith("/rest/v1/model_call_io")) {
      if (captureStatus !== 201) { res.statusCode = captureStatus; return void res.end("{}"); }
      captures.push(JSON.parse(body)); res.statusCode = 201; return void res.end("");
    }
    res.statusCode = 404; res.end("{}");
  });
});
type Gateway = typeof import("./gateway");
let g: Gateway;
before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.MODEL_KEY_SECRET = "a-test-secret-that-is-long-enough-for-aes";
  g = await import("./gateway"); // reads SUPABASE_URL at import time
  g.setModelResolver(() => ok);
});
const callModel: Gateway["callModel"] = (o) => g.callModel(o);
const setModelResolver: Gateway["setModelResolver"] = (f) => g.setModelResolver(f);
const setWorkflowContext: Gateway["setWorkflowContext"] = (f) => g.setWorkflowContext(f);
const BudgetError = class { static [Symbol.hasInstance](x: unknown) { return x instanceof g.BudgetError; } } as unknown as Gateway["BudgetError"];
const UsageLimitError = class { static [Symbol.hasInstance](x: unknown) { return x instanceof g.UsageLimitError; } } as unknown as Gateway["UsageLimitError"];

const open = { tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false };
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 500, text: 500, reasoning: 0 } };
const ok = new MockLanguageModelV3({
  doGenerate: async () => ({ content: [{ type: "text", text: "hi" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] }),
});
const opts = { site: "siteaaaaaaaaaaa", job: "t", model: "m", background: true, prompt: "p" };

test("a call is logged with tokens, priced cost, and workflow context", async () => {
  gate = open; calls.length = 0;
  setWorkflowContext(() => ({ workflowId: "wf1", stepId: 3 }));
  const r = await callModel(opts);
  assert.equal(r.text, "hi");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workflow_id, "wf1");
  assert.equal(calls[0].step_id, 3);
  assert.equal(calls[0].input_tokens, 1000);
  assert.equal(calls[0].output_tokens, 500);
  assert.equal(calls[0].cost_usd, 0.002); // 1000*$1/M + 500*$2/M
});

test("tenant at 100%: background refused and nothing logged; editor still runs", async () => {
  gate = { ...open, tenant_monthly_limit: 10, tenant_month_usd: 10 }; calls.length = 0;
  await assert.rejects(callModel(opts), (e: Error) => e instanceof BudgetError && e.reason === "tenant-budget");
  assert.equal(calls.length, 0);
  const r = await callModel({ ...opts, background: false });
  assert.equal(r.budgetWarning, true);
});

test("global daily cap engages the kill switch", async () => {
  gate = { ...open, global_daily_limit: 5, global_day_usd: 5 }; kills = 0;
  await assert.rejects(callModel({ ...opts, background: false }), BudgetError);
  assert.equal(kills, 1);
});

test("subscription 5-hour limit throws UsageLimitError and logs nothing", async () => {
  gate = open; calls.length = 0;
  setModelResolver(() => new MockLanguageModelV3({
    doGenerate: async () => { throw Object.assign(new Error("429"), { statusCode: 429, responseHeaders: { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": "1790000000" } }); },
  }));
  await assert.rejects(callModel(opts), (e: Error) => e instanceof UsageLimitError && (e as InstanceType<typeof UsageLimitError>).resetsAt === 1790000000_000);
  assert.equal(calls.length, 0);
});

test("a call the gateway refuses (no access to the model) is logged at a known $0; one that broke midway stays unpriced", async () => {
  gate = open; calls.length = 0;
  setModelResolver(() => failing(403, "Free tier users do not have access to this model."));
  await assert.rejects(callModel(opts), /Free tier/);
  assert.equal(calls[0].status, "error");
  assert.equal(calls[0].priced, true);
  assert.equal(calls[0].cost_usd, undefined); // the column's default, 0
  calls.length = 0;
  setModelResolver(() => failing(500, "upstream died"));
  await assert.rejects(callModel(opts));
  assert.equal(calls[0].priced, false);
  setModelResolver(() => ok);
});

test("a model that thinks gets room on top of the answer budget, and an answer that never came is an error, still logged", async () => {
  gate = open; calls.length = 0;
  let asked: number | undefined;
  let reasoning: unknown;
  setModelResolver(() => new MockLanguageModelV3({
    doGenerate: async (o) => {
      asked = o.maxOutputTokens; reasoning = o.reasoning;
      return { content: [], finishReason: { unified: "length", raw: "length" }, usage: { ...usage, outputTokens: { total: 6000, text: 0, reasoning: 6000 } }, warnings: [] };
    },
  }));
  await assert.rejects(callModel({ ...opts, maxOutputTokens: 6000 }), (e: Error) => e.name === "EmptyAnswerError" && e.message.startsWith("NO-ANSWER "));
  assert.equal(asked, 6000 + g.THINKING_TOKENS);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "ok");
  assert.equal(calls[0].output_tokens, 6000);
  await assert.rejects(callModel({ ...opts, maxOutputTokens: 500, reasoning: "none" }));
  assert.equal(asked, 500);
  assert.equal(reasoning, "none");
  assert.equal(g.thinkingBudget(undefined), undefined);
  setModelResolver(() => ok);
});

test("a paid API call is logged with the provider's cost and refused at the budget", async () => {
  gate = open; calls.length = 0;
  setWorkflowContext(() => ({ workflowId: "wf2", stepId: 1 }));
  const v = await g.callPaidApi({ site: opts.site, job: "scout", service: "dataforseo/serp-organic", background: true },
    async () => ({ value: 42, costUsd: 0.0021 }));
  assert.equal(v, 42);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "dataforseo/serp-organic");
  assert.equal(calls[0].cost_usd, 0.0021);
  assert.equal(calls[0].input_tokens, undefined);
  assert.equal(calls[0].workflow_id, "wf2");

  gate = { ...open, tenant_monthly_limit: 10, tenant_month_usd: 10 }; calls.length = 0;
  let ran = false;
  await assert.rejects(
    g.callPaidApi({ site: opts.site, job: "scout", service: "x", background: true }, async () => { ran = true; return { value: 1, costUsd: 1 }; }),
    BudgetError,
  );
  assert.equal(ran, false);
  assert.equal(calls.length, 0);
});

// ---- a tenant's own key ----

const KEY = "sk-ant-api03-tenantkeyTENANTKEY_abcd1234";
const tenantSite = "sitebbbbbbbbbbb";
const failing = (statusCode: number, message: string, responseHeaders: Record<string, string> = {}) =>
  new MockLanguageModelV3({ doGenerate: async () => { throw Object.assign(new Error(message), { statusCode, responseHeaders }); } });

async function withKey(status = "ok") {
  const { encryptKey } = await import("./modelKeys");
  keyRows[tenantSite] = { secret: encryptKey(tenantSite, KEY), last4: "1234", status, error: "", checked: "2026-10-08T00:00:00Z" };
}

test("a sealed key opens only for its own site", async () => {
  const { encryptKey, decryptKey, KeysUnavailableError } = await import("./modelKeys");
  const sealed = encryptKey(tenantSite, KEY);
  assert.ok(!sealed.includes(KEY.slice(7)));
  assert.equal(decryptKey(tenantSite, sealed), KEY);
  assert.throws(() => decryptKey("siteccccccccccc", sealed), KeysUnavailableError);
});

test("with a key, Anthropic calls use it, are logged as the tenant's, and skip our budget", async () => {
  await withKey();
  gate = { ...open, tenant_monthly_limit: 10, tenant_month_usd: 10 }; calls.length = 0;
  let ours = 0, used = "", model = "";
  setModelResolver(() => { ours++; return ok; });
  g.setTenantModelResolver((k, id) => { used = k; model = g.anthropicModelId(id); return ok; });
  const r = await callModel({ ...opts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" });
  assert.equal(r.text, "hi");
  assert.equal(used, KEY);
  assert.equal(model, "claude-sonnet-5-5");
  assert.equal(ours, 0);
  assert.equal(calls[0].paid_by, "tenant");
  assert.equal(calls[0].credential, "own");

  // Gemini stays on our account, and our budget applies to it.
  gate = open; calls.length = 0;
  await callModel({ ...opts, site: tenantSite, model: "google/gemini-2.5-flash-lite" });
  assert.equal(ours, 1);
  assert.equal(calls[0].paid_by, undefined);
});

test("the kill switch still stops calls on a tenant's key", async () => {
  await withKey();
  gate = { ...open, killed: true };
  await assert.rejects(callModel({ ...opts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" }), BudgetError);
});

test("a refused key fails with the tenant's error, is marked failed, and never falls back to ours", async () => {
  await withKey();
  gate = open; calls.length = 0; keyMarks.length = 0;
  let ours = 0;
  setModelResolver(() => { ours++; return ok; });
  g.setTenantModelResolver(() => failing(401, "invalid x-api-key"));
  await assert.rejects(
    callModel({ ...opts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" }),
    (e: Error) => e instanceof g.TenantKeyError && /refused the key: invalid x-api-key/.test(e.message),
  );
  assert.equal(ours, 0);
  assert.equal(calls[0].status, "error");
  assert.equal(keyMarks[0].status, "failed");
  assert.match(String(keyMarks[0].error), /invalid x-api-key/);
});

test("a rate-limited key says when to try again and stays marked ok", async () => {
  await withKey();
  gate = open; keyMarks.length = 0;
  g.setTenantModelResolver(() => failing(429, "rate_limit_error", { "retry-after": "30" }));
  await assert.rejects(
    callModel({ ...opts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" }),
    (e: Error) => e instanceof g.TenantKeyError && ((e as InstanceType<typeof g.TenantKeyError>).retryAt ?? 0) > Date.now(),
  );
  assert.equal(keyMarks.length, 0);
});

test("a key that works again is marked ok", async () => {
  await withKey("failed");
  gate = open; keyMarks.length = 0;
  g.setTenantModelResolver(() => ok);
  await callModel({ ...opts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" });
  assert.equal(keyMarks[0].status, "ok");
});

test("Test: green on an answer, red with Anthropic's words, and the key never in the log", async () => {
  calls.length = 0;
  g.setTenantModelResolver(() => ok);
  assert.deepEqual(await g.testTenantKey(tenantSite, KEY), { ok: true });
  assert.equal(calls[0].job, "key-test");
  assert.equal(calls[0].paid_by, "tenant");

  g.setTenantModelResolver(() => failing(400, `Your credit balance is too low (${KEY})`));
  const r = await g.testTenantKey(tenantSite, KEY);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /out of credit/);
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.ok(!JSON.stringify(calls).includes(KEY));
});

// ---- streamModel ----

const words = ["one ", "two ", "three ", "four"];
function streaming(delayMs: number) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: 0,
        chunkDelayInMs: delayMs,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          ...words.map((w) => ({ type: "text-delta" as const, id: "t", delta: w })),
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ],
      }),
    }),
  });
}
const streamOpts = { site: "siteaaaaaaaaaaa", job: "chat", model: "m", background: false, messages: [{ role: "user" as const, content: "hello" }] };

test("a streamed reply is logged once with the provider's usage", async () => {
  gate = open; calls.length = 0;
  setWorkflowContext(() => ({ workflowId: null, stepId: null }));
  setModelResolver(() => streaming(0));
  const s = await g.streamModel(streamOpts);
  let text = "";
  for await (const p of s.parts) if (p.type === "text-delta") text += p.text;
  assert.equal(text, "one two three four");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "ok");
  assert.equal(calls[0].output_tokens, 500);
  assert.equal(s.costUsd(), 0.002);
});

test("a reply stopped mid-stream is logged as stopped, with estimated tokens", async () => {
  gate = open; calls.length = 0;
  setModelResolver(() => streaming(30));
  const ctrl = new AbortController();
  const s = await g.streamModel({ ...streamOpts, abortSignal: ctrl.signal });
  let text = "";
  for await (const p of s.parts) {
    if (p.type === "text-delta") {
      text += p.text;
      if (text.length >= 8) ctrl.abort();
    }
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "stopped");
  assert.ok((calls[0].input_tokens as number) > 0);
  assert.equal(calls[0].output_tokens, Math.ceil(text.length / 4));
  assert.ok(s.costUsd() > 0);
});

test("a reader that leaves early still logs the stopped call", async () => {
  gate = open; calls.length = 0;
  setModelResolver(() => streaming(10));
  const s = await g.streamModel(streamOpts);
  for await (const p of s.parts) if (p.type === "text-delta") break;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "stopped");
  assert.equal(calls[0].output_tokens, 1);
});

test("a refused stream sends nothing and logs nothing", async () => {
  gate = { ...open, killed: true }; calls.length = 0;
  await assert.rejects(g.streamModel(streamOpts), BudgetError);
  assert.equal(calls.length, 0);
});

test("a streamed reply on a tenant's key uses it, is logged as the tenant's, and skips our budget", async () => {
  await withKey();
  gate = { ...open, tenant_monthly_limit: 10, tenant_month_usd: 10 }; calls.length = 0;
  let ours = 0, used = "", model = "";
  setModelResolver(() => { ours++; return streaming(0); });
  g.setTenantModelResolver((k, id) => { used = k; model = g.anthropicModelId(id); return streaming(0); });
  const s = await g.streamModel({ ...streamOpts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" });
  let text = "";
  for await (const p of s.parts) if (p.type === "text-delta") text += p.text;
  assert.equal(text, "one two three four");
  assert.equal(used, KEY);
  assert.equal(model, "claude-sonnet-5-5");
  assert.equal(ours, 0);
  assert.equal(calls[0].paid_by, "tenant");
});

test("a refused key fails the stream with the tenant's error and never falls back to ours", async () => {
  await withKey();
  gate = open; calls.length = 0; keyMarks.length = 0;
  let ours = 0;
  setModelResolver(() => { ours++; return streaming(0); });
  g.setTenantModelResolver(() => new MockLanguageModelV3({
    doStream: async () => { throw Object.assign(new Error("invalid x-api-key"), { statusCode: 401, responseHeaders: {} }); },
  }));
  const s = await g.streamModel({ ...streamOpts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" });
  await assert.rejects(
    (async () => { for await (const _ of s.parts) void _; })(),
    (e: Error) => e instanceof g.TenantKeyError && /refused the key/.test(e.message),
  );
  assert.equal(ours, 0);
  assert.equal(calls[0].status, "error");
  assert.equal(keyMarks[0].status, "failed");
});

// ---- a tenant with no key runs on our AI Gateway ----

const noKeySite = "siteccccccccccc";

test("no key saved: Anthropic calls run on our AI Gateway, paid by us, inside our budget", async () => {
  gate = open; calls.length = 0;
  let ours = 0, used = "";
  setModelResolver(() => { ours++; return ok; });
  g.setTenantModelResolver((k) => { used = k; return ok; });
  await callModel({ ...opts, site: noKeySite, model: "anthropic/claude-sonnet-5.5" });
  assert.equal(ours, 1);
  assert.equal(used, "");
  assert.equal(calls[0].paid_by, undefined);
  assert.equal(calls[0].credential, undefined);

  gate = { ...open, tenant_monthly_limit: 10, tenant_month_usd: 10 };
  await assert.rejects(callModel({ ...opts, site: noKeySite, model: "anthropic/claude-sonnet-5.5" }), BudgetError);
});

test("removing a key moves the tenant back to our AI Gateway", async () => {
  await withKey();
  gate = open;
  let ours = 0, used = "";
  setModelResolver(() => { ours++; return ok; });
  g.setTenantModelResolver((k) => { used = k; return ok; });
  await callModel({ ...opts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" });
  assert.equal(used, KEY);
  delete keyRows[tenantSite];
  await callModel({ ...opts, site: tenantSite, model: "anthropic/claude-sonnet-5.5" });
  assert.equal(ours, 1);
});

// ---- the default model ----

test("DEFAULT_MODEL runs on our gateway with no key, and as BYOK_MODEL on a tenant's key", async () => {
  gate = open; calls.length = 0;
  let ours = "", keyed = "";
  setModelResolver((id) => { ours = id; return ok; });
  g.setTenantModelResolver((_k, id) => { keyed = id; return ok; });
  await callModel({ ...opts, site: noKeySite, model: g.DEFAULT_MODEL });
  assert.equal(g.DEFAULT_MODEL, "deepseek/deepseek-v4-pro");
  assert.equal(ours, g.DEFAULT_MODEL);
  assert.equal(calls[0].model, g.DEFAULT_MODEL);
  assert.equal(calls[0].paid_by, undefined);

  await withKey(); calls.length = 0;
  await callModel({ ...opts, site: tenantSite, model: g.DEFAULT_MODEL });
  assert.equal(keyed, g.BYOK_MODEL);
  assert.equal(calls[0].model, g.BYOK_MODEL);
  assert.equal(calls[0].paid_by, "tenant");

  // A model asked for by name (the editor's Gemini) stays ours even with a key.
  calls.length = 0; ours = "";
  await callModel({ ...opts, site: tenantSite, model: "google/gemini-2.5-flash-lite" });
  assert.equal(ours, "google/gemini-2.5-flash-lite");
  assert.equal(calls[0].paid_by, undefined);
  delete keyRows[tenantSite];
});

test("the gateway's reported cost prices a call whose model has no price row", () => {
  assert.equal(g.gatewayCost({ gateway: { cost: "0.0012345678" } }), 0.001235);
  assert.equal(g.gatewayCost({ gateway: { cost: 0.5 } }), 0.5);
  assert.equal(g.gatewayCost({ gateway: {} }), null);
  assert.equal(g.gatewayCost(undefined), null);
  assert.equal(g.gatewayCost({ gateway: { cost: "nope" } }), null);
});

test.after(() => server.close());

// ---- the capture (capture.ts) ----

test("a call's full input and output are captured, linked to its cost-log row", async () => {
  gate = open; calls.length = 0; captures.length = 0;
  setModelResolver(() => ok);
  await callModel({ ...opts, system: "Be brief.", prompt: "Say hi.", maxOutputTokens: 100 });
  assert.equal(captures.length, 1);
  const c = captures[0];
  assert.match(String(calls[0].id), /^[a-z0-9]{15}$/);
  assert.equal(c.call, calls[0].id);
  assert.equal(c.site, opts.site);
  assert.equal(c.step, 1);
  assert.equal(c.turn, null);
  assert.deepEqual(c.request, { model: "m", system: "Be brief.", prompt: "Say hi.", maxOutputTokens: 100, reasoning: null });
  assert.equal(c.response.text, "hi");
  assert.equal(c.response.finishReason, "stop");
  assert.equal(c.truncated, false);
});

test("a failed call is captured with its error", async () => {
  gate = open; calls.length = 0; captures.length = 0;
  setModelResolver(() => new MockLanguageModelV3({ doGenerate: async () => { throw Object.assign(new Error("bad request"), { statusCode: 400 }); } }));
  await assert.rejects(callModel(opts));
  assert.equal(captures.length, 1);
  assert.equal(captures[0].call, calls[0].id);
  assert.equal(captures[0].request.prompt, "p");
  assert.equal(captures[0].response.error.message, "bad request");
  assert.equal(captures[0].response.error.status, 400);
  setModelResolver(() => ok);
});

test("a capture that fails, or a database without the table, never fails the call", async () => {
  gate = open; calls.length = 0; captures.length = 0;
  setModelResolver(() => ok);
  for (const status of [404, 500]) {
    captureStatus = status;
    const r = await callModel(opts);
    assert.equal(r.text, "hi");
  }
  captureStatus = 201;
  assert.equal(calls.length, 2);
  assert.equal(captures.length, 0);
});

test("a streamed reply with a tool round is captured step by step, under one turn", async () => {
  gate = open; calls.length = 0; captures.length = 0;
  let n = 0;
  setModelResolver(() => new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: n++ === 0
          ? [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: JSON.stringify({ q: "retries" }) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
          ]
          : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "Found it." },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
          ],
      }),
    }),
  }));
  const tools = { lookup: g.tool({ description: "Look up", inputSchema: z.object({ q: z.string() }), execute: async ({ q }: { q: string }) => `three posts on ${q}` }) };
  const s = await g.streamModel({ ...streamOpts, system: "You are Chat.", tools });
  for await (const _ of s.parts) { /* drain */ }
  assert.equal(calls.length, 2);
  assert.equal(captures.length, 2);
  const [one, two] = captures;
  assert.match(String(one.turn), /^[a-z0-9]{15}$/);
  assert.equal(two.turn, one.turn);
  assert.deepEqual([one.step, two.step], [1, 2]);
  assert.deepEqual([one.call, two.call], [calls[0].id, calls[1].id]);
  assert.equal(one.request.system, "You are Chat.");
  assert.deepEqual(one.request.messages, streamOpts.messages);
  assert.deepEqual(one.request.tools, ["lookup"]);
  assert.deepEqual(one.response.toolCalls, [{ id: "c1", tool: "lookup", input: { q: "retries" } }]);
  assert.equal(one.response.finishReason, "tool-calls");
  assert.deepEqual(two.request, { continues: one.turn, step: 2 });
  const results = [...one.response.toolResults, ...two.response.toolResults];
  assert.deepEqual(results, [{ id: "c1", tool: "lookup", output: "three posts on retries" }]);
  assert.equal(two.response.text, "Found it.");
});
