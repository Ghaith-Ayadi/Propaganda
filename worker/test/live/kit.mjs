// What the real-model tests share: a stand-in PostgREST in memory, the checks,
// DBOS on a real Postgres (PGURL), and the cost report.
//
// These tests are the scripted tests' twins (../strategy.mjs, ../pitch-write.mjs)
// with the stand-in model taken out: every model call goes to the real AI Gateway
// through api/_ai/gateway.ts and is logged like any other call. Keyword data and
// web pages stay stand-ins (free, and the same every run). They cost money, so
// they run at a release (.github/workflows/release.yml), never on a PR.
//
// The Strategist runs on Claude Sonnet 5.5 here, not Fable: the same family and
// prompt-following at a fifth of the price. The other agents run on their prod
// model (DeepSeek V4 Pro), which is already cheap.

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import pg from "pg";

export const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";

/** The models a release test runs on, where they differ from prod. Read before the agents' code loads. */
export const TEST_MODELS = { AGENT_MODEL_STRATEGIST: "anthropic/claude-sonnet-5.5" };

/**
 * Before anything imports the agents: the test models, and the gateway key. With no key a
 * test is skipped, unless LIVE_REQUIRED is set (the release run), where that is a failure.
 */
export function liveEnv(name) {
  for (const [k, v] of Object.entries(TEST_MODELS)) process.env[k] ||= v;
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.log(`${name}: skipped, no AI_GATEWAY_API_KEY`);
    process.exit(process.env.LIVE_REQUIRED ? 1 : 0);
  }
  process.env.WORKER_DISPATCH_SECONDS = "0";
}

export function checks() {
  const state = { failures: 0 };
  const check = (cond, what) => {
    if (cond) console.log(`  ok   ${what}`);
    else {
      state.failures++;
      console.log(`  FAIL ${what}`);
    }
  };
  return { check, state };
}

function matches(row, key, cond) {
  if (key === "or") {
    // reviewerFeedback: (status.eq.rejected,notes.not.is.null)
    return row.status === "rejected" || (row.notes !== null && row.notes !== undefined);
  }
  const v = row[key];
  const [op, ...rest] = cond.split(".");
  const arg = decodeURIComponent(rest.join("."));
  if (op === "eq") return String(v ?? "") === arg;
  if (op === "neq") return String(v ?? "") !== arg;
  if (op === "is") return arg === "null" ? v === null || v === undefined : String(v) === arg;
  if (op === "like") return new RegExp(`^${arg.replace(/\*/g, ".*")}$`).test(String(v ?? ""));
  if (op === "lt") return String(v) < arg;
  if (op === "lte") return String(v) <= arg;
  if (op === "gte") return String(v) >= arg;
  if (op === "gt") return String(v) > arg;
  if (op === "not" && rest[0] === "is") return rest[1] === "null" ? v !== null && v !== undefined : String(v) !== rest[1];
  if (op === "in") return arg.slice(1, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(v));
  if (op === "not" && rest[0] === "in") return !rest.slice(1).join(".").slice(1, -1).split(",").includes(String(v));
  throw new Error(`stand-in PostgREST: no operator ${cond}`);
}

function filterRows(rows, params) {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    rows = rows.filter((r) => matches(r, k, v));
  }
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    rows = [...rows].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : String(a[col] ?? "") > String(b[col] ?? "") ? 1 : 0) * (dir === "desc" ? -1 : 1));
  }
  return rows.slice(0, Number(params.get("limit") ?? 1000));
}

/**
 * A PostgREST over `db` (table name -> rows), on a free port; sets SUPABASE_URL and the key.
 * model_prices answers nothing, so every call is priced at what the AI Gateway reported:
 * the cost report is what the run actually cost.
 */
export async function standInRest(db, { rpcs = {}, clock } = {}) {
  const all = {
    cost_gate: () => ({ tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false }),
    ...rpcs,
  };
  const server = createServer((req, res) => {
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
      if (req.headers.authorization !== "Bearer service-key") return out(401, { message: "no key" });
      if (path.startsWith("rpc/")) {
        const fn = all[path.slice(4)];
        return fn ? out(200, fn(JSON.parse(body || "{}"))) : out(404, { code: "PGRST202", message: "no function" });
      }
      if (path === "model_prices") return out(200, []);
      const table = db[path];
      if (!table) return out(404, { code: "PGRST205", message: `no table ${path}` });
      if (req.method === "GET") return out(200, filterRows(table, url.searchParams));
      if (req.method === "POST") {
        const now = clock ?? new Date().toISOString();
        const row = { created: now, updated: now, ...JSON.parse(body) };
        const conflict = url.searchParams.get("on_conflict");
        if (conflict) {
          const keys = conflict.split(",");
          const found = table.find((r) => keys.every((k) => String(r[k]) === String(row[k])));
          if (found) return out(201, [Object.assign(found, row)]);
        }
        table.push(row);
        return out(201, [row]);
      }
      if (req.method === "PATCH") {
        const rows = filterRows(table, url.searchParams);
        for (const r of rows) Object.assign(r, JSON.parse(body), { updated: new Date().toISOString() });
        return out(200, rows);
      }
      out(405, {});
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  return server;
}

/** DBOS on its own fresh system database. */
export async function launch(t, name) {
  const sysDb = `worker_live_${name.replace(/\W/g, "_")}_dbos`;
  const admin = new pg.Client({ connectionString: `${PGURL}/postgres` });
  await admin.connect();
  await admin.query(`drop database if exists ${sysDb} with (force)`);
  await admin.end();
  t.wireGateway();
  t.DBOS.setConfig({ name: `propaganda-live-${name}`, systemDatabaseUrl: `${PGURL}/${sysDb}`, applicationVersion: "live" });
  await t.DBOS.launch();
  await t.registerQueues();
}

/**
 * What the run cost, from the cost log the gateway wrote (one row per model call or paid
 * request): printed, and appended as one JSON line to LIVE_COST_FILE for the release notes.
 */
export function costReport(area, calls, failures) {
  const byModel = {};
  for (const c of calls) {
    const m = (byModel[c.model] ??= { calls: 0, input: 0, output: 0, usd: 0 });
    m.calls++;
    m.input += c.input_tokens ?? 0;
    m.output += c.output_tokens ?? 0;
    m.usd += Number(c.cost_usd ?? 0);
  }
  const usd = Object.values(byModel).reduce((s, m) => s + m.usd, 0);
  console.log(`\ncost: $${usd.toFixed(4)}`);
  for (const [model, m] of Object.entries(byModel)) {
    console.log(`  ${model}: ${m.calls} calls, ${m.input} in, ${m.output} out, $${m.usd.toFixed(4)}`);
  }
  if (process.env.LIVE_COST_FILE) {
    appendFileSync(process.env.LIVE_COST_FILE, JSON.stringify({ area, ok: failures === 0, usd: Math.round(usd * 1e6) / 1e6, byModel }) + "\n");
  }
}

/** Ends the test. DataForSEO is a stand-in here, so its rows carry made-up costs and are left out. */
export function finish(area, state, calls) {
  costReport(area, calls.filter((c) => !String(c.model).startsWith("dataforseo/")), state.failures);
  if (state.failures) {
    console.log(`\n${state.failures} FAILED`);
    process.exit(1);
  }
  console.log("\nALL PASSED");
  process.exit(0);
}
