// tsx --test _ai/gateway.test.ts
// Runs callModel against a stub of the backend's REST API and a mock model.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MockLanguageModelV3 } from "ai/test";

const calls: Record<string, unknown>[] = [];
let gate: Record<string, unknown> = {};
let kills = 0;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/rest/v1/rpc/cost_gate")) return void res.end(JSON.stringify(gate));
    if (req.url?.startsWith("/rest/v1/rpc/cost_engage_kill")) { kills++; return void res.end("null"); }
    if (req.url?.startsWith("/rest/v1/model_prices"))
      return void res.end(JSON.stringify([{ input_per_mtok: "1", output_per_mtok: "2", cache_read_per_mtok: "0", cache_write_per_mtok: "0" }]));
    if (req.url?.startsWith("/rest/v1/model_calls")) { calls.push(JSON.parse(body)); res.statusCode = 201; return void res.end("[]"); }
    res.statusCode = 404; res.end("{}");
  });
});
type Gateway = typeof import("./gateway");
let g: Gateway;
before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
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

test.after(() => server.close());
