// Admin's Arena (src/arena.ts), in process: the real round code and the real
// model gateway, against a stand-in PostgREST (in memory), stand-in models and
// a stand-in price list. Nothing here talks to a real model.

import { createServer } from "node:http";
import { MockLanguageModelV3 } from "ai/test";

const SITE = "testsite0000000";
const ARENA_SITE = "verbatimsite000";
let failures = 0;
function check(cond, what) {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

// ---- a stand-in PostgREST ----

const db = {
  sites: [{ id: SITE, name: "Kontra", slug: "kontra", domain: "" }],
  agent_ideas: [
    { id: "idea00000000001", site: SITE, status: "new", title: "Why batch jobs die at 3am", summary: "Night failures.", origin: "scout", evidence: [], created: "2026-10-01" },
    { id: "idea00000000002", site: SITE, status: "new", title: "Temporal vs cron", summary: "A comparison.", origin: "listener", evidence: [], created: "2026-10-02" },
    { id: "idea00000000003", site: SITE, status: "pitched", title: "Already pitched", summary: "", origin: "scout", evidence: [], created: "2026-10-03" },
  ],
  briefs: [{ id: "brief0000000001", site: SITE, title: "Retries, explained", status: "todo", created: "2026-09-01", reject_reason: "" }],
  posts: [],
  goal_versions: [],
  daily_facts: [],
  app_settings: [],
  kb_sources: [{ id: "source000000001", site: SITE, kind: "call", tier: 2, title: "Kontra demo", uri: "", body: "Ana: Our Pro plan includes 3 seats.\nGuest: Do you support SSO?", sha256: "", occurred: null, status: "done", created: "2026-10-05" }],
  model_calls: [],
};

function rows(table, params) {
  let out = db[table] ?? [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const arg = rest.join(".");
    if (op === "eq") out = out.filter((r) => String(r[k] ?? "") === arg);
    else if (op === "in") out = out.filter((r) => arg.slice(1, -1).split(",").map((x) => x.replace(/"/g, "")).includes(String(r[k])));
    else if (op === "not" && rest[0] === "in") out = out.filter((r) => !rest.slice(1).join(".").slice(1, -1).split(",").includes(String(r[k])));
  }
  return out.slice(0, Number(params.get("limit") ?? 1000));
}

const rest = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    res.setHeader("Content-Type", "application/json");
    const out = (status, value) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    if (path === "rpc/cost_gate") return out(200, { tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false });
    if (path === "model_prices" || path === "model_keys") return out(200, []);
    if (!db[path]) return out(404, { code: "PGRST205", message: `no table ${path}` });
    if (req.method === "GET") return out(200, rows(path, url.searchParams));
    if (req.method === "POST") {
      db[path].push(JSON.parse(body));
      return out(201, []);
    }
    out(405, {});
  });
});
await new Promise((r) => rest.listen(0, r));
process.env.SUPABASE_URL = `http://127.0.0.1:${rest.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
// The worker's config wants database URLs at import; this test never connects.
process.env.ARENA_TENANTS = SITE;
process.env.APP_DATABASE_URL ??= "postgres://unused@127.0.0.1:1/postgres";
process.env.DBOS_SYSTEM_DATABASE_URL ??= "postgres://unused@127.0.0.1:1/dbos";

// ---- stand-in prices and models ----

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).endsWith("/v1/models")) {
    return Response.json({
      data: [
        { id: "cheap/a", pricing: { input: "0.0000005", output: "0.000002" } },
        { id: "cheap/b", pricing: { input: "0.0000004", output: "0.0000009" } },
        { id: "dear/c", pricing: { input: "0.00003", output: "0.0002" } },
      ],
    });
  }
  return realFetch(input, init);
};

const { setModelResolver, runRound, worstCase, checkModels, judgePrompt } = await import("../dist/testkit.js");

const prompts = [];
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 200, text: 200, reasoning: 0 } };
setModelResolver((id) =>
  new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const text = prompt.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join(""))).join("\n");
      prompts.push({ id, text });
      let answer;
      if (text.includes("Judge each idea")) {
        const ids = [...text.matchAll(/^\[([a-z0-9]{15})\]/gm)].map((m) => m[1]);
        // cheap/b forgets an idea: the agent couldn't use its answer.
        const judged = (id === "cheap/b" ? ids.slice(1) : ids).map((i) => ({ id: i, topics: [], targetSearch: "", timely: false, expiresAt: "", answersGap: `gap from ${id}`, demand: "", duplicateOf: "", replacesFlagged: "", searches: [] }));
        answer = JSON.stringify({ ideas: judged });
      } else {
        answer = JSON.stringify({ ideas: [{ title: "SSO", kind: "question", why: "asked", quote: "Do you support SSO?", speaker: "Guest" }], facts: [] });
      }
      return {
        content: [{ type: "text", text: answer }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
        providerMetadata: { gateway: { cost: id === "cheap/a" ? "0.0012" : "0.0007" } },
      };
    },
  }),
);

// ---- the Pitcher ----

console.log("Pitcher round");
const round = await runRound(null, { agent: "pitcher", site: SITE, models: ["cheap/a", "cheap/b"] });
check(round.entries.length === 2 && new Set(round.entries.map((e) => e.model)).size === 2, "both models answered");
check(round.ideas.length === 2 && !round.ideas.some((i) => i.id === "idea00000000003"), "only waiting ideas are judged");
check(round.task === "2 waiting ideas of Kontra", `the task names the work: ${round.task}`);
const a = round.entries.find((e) => e.model === "cheap/a");
const b = round.entries.find((e) => e.model === "cheap/b");
check(a.problem === "" && Array.isArray(a.answer.ideas), "a complete answer has no problem");
check(/No judgement for ideas idea00000000001/.test(b.problem), `an incomplete answer says why: ${b.problem}`);
check(round.costUsd === 0.0019, `round cost is the gateway's reported cost: ${round.costUsd}`);
const same = prompts.filter((p) => p.text.includes("Judge each idea"));
check(same.length === 2 && same[0].text === same[1].text, "every model gets the same prompt");
const expected = judgePrompt({
  now: new Date(),
  tenantName: "Kontra",
  goals: null,
  existing: ["todo: Retries, explained"],
  ideas: db.agent_ideas.slice(0, 2).map((i) => ({ ...i })),
  close: new Map(),
});
check(same[0].text.includes(expected), "it is the Pitcher's own judging prompt");
const logged = db.model_calls.filter((c) => c.job === "arena:pitcher");
check(logged.length === 2 && logged.every((c) => c.site === ARENA_SITE && c.priced === true), "every call is logged on Ayadi's own tenant, priced");

// ---- the Listener ----

console.log("Listener round");
prompts.length = 0;
const fakeDb = {
  query: async (sql) =>
    sql.includes("from public.sites") ? { rows: [{ name: "Kontra", domain: "" }] } : { rows: [] },
};
const call = await runRound(fakeDb, { agent: "listener", site: SITE, models: ["cheap/a", "cheap/b"], source: "source000000001" });
check(call.task === "Call: Kontra demo", "a stored call is read by id");
check(prompts.every((p) => p.text.includes("Do you support SSO?") && p.text.includes("You are the Listener for Kontra")), "the Listener's own prompt with the call's text");
check(call.entries.every((e) => e.problem === "" && e.answer.ideas.length === 1), "both answers are usable");
const pasted = await runRound(fakeDb, { agent: "listener", site: SITE, models: ["cheap/a", "cheap/b"], transcript: "Hello there.", title: "Pasted one" });
check(pasted.task === "Call: Pasted one", "a pasted transcript works too");

// ---- guards ----

console.log("Guards");
await runRound(null, { agent: "pitcher", site: SITE, models: ["cheap/a", "dear/c"] }).then(
  () => check(false, "an expensive round is refused"),
  (err) => check(/over the \$1\.00 cap/.test(err.message), `an expensive round is refused before any call: ${err.message}`),
);
await runRound(null, { agent: "pitcher", site: SITE, models: ["cheap/a", "nobody/x"] }).then(
  () => check(false, "an unknown model is refused"),
  (err) => check(/no price for nobody\/x/.test(err.message), "a model the gateway doesn't list is refused"),
);
check(Math.abs(worstCase(3000, ["cheap/a"], new Map([["cheap/a", { input: 1e-6, output: 2e-6 }]])) - (1000 * 1e-6 + 6000 * 2e-6)) < 1e-12, "worst case is the whole prompt plus every output token");
await runRound(null, { agent: "pitcher", site: "othersite000000", models: ["cheap/a", "cheap/b"] }).then(
  () => check(false, "a customer's tenant is refused"),
  (err) => check(err.status === 403, "a tenant outside ARENA_TENANTS is refused before any read"),
);
check(db.model_calls.filter((c) => c.job === "arena:pitcher").every((c) => c.background === true), "rounds run as background work");
let threw = 0;
for (const bad of [["a/b"], ["a/b", "a/b"], ["a/b", "c/d", "e/f", "g/h"], ["a/b", "NOT VALID"]]) {
  try {
    checkModels(bad);
  } catch {
    threw++;
  }
}
check(threw === 4, "model lists are checked: two or three, different, well formed");
check(checkModels(undefined).length === 3, "no models means the three defaults");

rest.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
