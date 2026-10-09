// End to end against a real Postgres: the worker as a process, its Runs API
// over HTTP, DBOS's own database. Run through test/run.sh.
//
// PGURL is a server where the test may create and drop the databases
// worker_test_app and worker_test_dbos.

import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";
const APP_DB = `${PGURL}/worker_test_app`;
const SYS_DB = `${PGURL}/worker_test_dbos`;
const SECRET = "test-secret-test-secret-test-secret-0000";
const PORT = 3911;
const API = `http://localhost:${PORT}`;
const SITE = "testsite0000000";

let failures = 0;
function check(cond, what) {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

function jwt(sub, role = "authenticated", expIn = 3600) {
  const b = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const head = b({ alg: "HS256", typ: "JWT" });
  const body = b({ sub, role, exp: Math.floor(Date.now() / 1000) + expIn });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const admin = randomUUID();
const stranger = randomUUID();
const ADMIN = { Authorization: `Bearer ${jwt(admin)}` };

async function api(path, { method = "GET", body, headers = ADMIN } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

let worker;
const DISPATCH = "dispatch-secret-for-the-test";
const MEMBER = randomUUID();

function startWorker(extra = { WORKER_DISPATCH_SECRET: DISPATCH, WORKER_TEST_AGENT: "__test,__nobody" }) {
  worker = spawn(process.execPath, ["dist/main.js"], {
    env: {
      ...process.env,
      ...extra,
      APP_DATABASE_URL: APP_DB,
      DBOS_SYSTEM_DATABASE_URL: SYS_DB,
      JWT_SECRET: SECRET,
      WORKER_PORT: String(PORT),
      WORKER_STALL_SLACK_MS: "500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.on("data", (d) => process.env.VERBOSE && process.stdout.write(`    [worker] ${d}`));
  worker.stderr.on("data", (d) => process.stdout.write(`    [worker!] ${d}`));
  return until("the worker", async () => {
    try {
      return (await fetch(`${API}/health`)).ok;
    } catch {
      return false;
    }
  });
}
async function stopWorker(signal = "SIGTERM") {
  const exited = new Promise((r) => worker.once("exit", r));
  worker.kill(signal);
  await exited;
}

const run = async (id) => (await api(`/runs/${id}`)).json;

async function main() {
  const root = new pg.Client({ connectionString: `${PGURL}/postgres` });
  await root.connect();
  await root.query("drop database if exists worker_test_app with (force)");
  await root.query("drop database if exists worker_test_dbos with (force)");
  await root.query("create database worker_test_app");
  await root.end();

  // What the worker reads from the app's database: the shapes of the Admin
  // thread's private.superadmins and the cost log's public.model_calls.
  const app = new pg.Client({ connectionString: APP_DB });
  await app.connect();

  console.log("before the Admin migration");
  await startWorker({});
  check((await api("/runs")).status === 403, "no superadmins table: everyone refused (fails closed)");
  check((await api("/agents/__test", { method: "POST", body: {}, headers: { Authorization: "Bearer x" } })).status === 503, "no dispatch secret configured: 503");
  await stopWorker();

  await app.query(`
    create schema private;
    create table private.superadmins (user_id uuid primary key);
    insert into private.superadmins values ('${admin}');
    create table public.sites (id text primary key, name text not null default '');
    insert into public.sites values ('${SITE}', 'Test tenant');
  `);
  await startWorker();

  console.log("auth");
  check((await api("/health", { headers: {} })).status === 200, "health needs no token");
  check((await api("/runs", { headers: {} })).status === 401, "no token: 401");
  check((await api("/runs", { headers: { Authorization: `Bearer ${jwt(stranger)}` } })).status === 403, "not a superadmin: 403");
  check((await api("/runs", { headers: { Authorization: `Bearer ${jwt(admin, "authenticated", -10)}` } })).status === 401, "expired token: 401");
  check((await api("/runs", { headers: { Authorization: `Bearer ${jwt(admin, "anon")}` } })).status === 401, "anon role: 401");
  const forged = jwt(admin).slice(0, -2) + "xx";
  check((await api("/runs", { headers: { Authorization: `Bearer ${forged}` } })).status === 401, "bad signature: 401");

  console.log("a run that succeeds");
  const ok = (await api("/runs/demo", { method: "POST", body: { site: SITE } })).json.id;
  const done = await until("done", async () => ((await run(ok))?.state === "done" ? run(ok) : null));
  check(done.site === SITE, "the run carries its tenant");
  check(done.steps.map((s) => s.name).join(",") === "plan,draft,finish", `steps listed in order (${done.steps.map((s) => s.name)})`);
  check(done.steps.every((s) => s.state === "done"), "every step done");
  check(done.cost === null, "no cost log yet: cost is null, not $0");

  console.log("the cost log join");
  await app.query(`
    create table public.model_calls (id text primary key, site text, workflow_id text, step_id integer,
      cost_usd numeric(12,6) not null default 0, priced boolean not null default true);
    insert into public.model_calls values
      ('a', '${SITE}', '${ok}', 1, 0.012, true),
      ('b', '${SITE}', '${ok}', 1, 0.003, true),
      ('c', '${SITE}', '${ok}', 2, 0, false),
      ('d', '${SITE}', 'someotherrun', 1, 9, true);
  `);
  const costed = await run(ok);
  check(Math.abs(costed.cost.usd - 0.015) < 1e-9 && costed.cost.calls === 3 && costed.cost.unpriced === 1, `run cost summed by workflow_id (${JSON.stringify(costed.cost)})`);
  check(costed.steps[1].cost.calls === 2 && costed.steps[2].cost.unpriced === 1, "step cost by (workflow_id, step_id)");
  const listed = (await api(`/runs?site=${SITE}`)).json;
  check(listed.costLog === true && listed.runs.find((r) => r.id === ok)?.cost.calls === 3, "the list carries cost too");

  console.log("the usage limit: a stall, not a failure");
  const stalled = (await api("/runs/demo", { method: "POST", body: { site: SITE, stallSeconds: 6 } })).json.id;
  const s1 = await until("stalled", async () => ((await run(stalled))?.state === "stalled" ? run(stalled) : null));
  check(s1.status === "PENDING" && s1.error === null, "DBOS still has it as pending, with no error");
  check(s1.stall?.step === "draft" && s1.stall.until > Date.now(), `stall says which step and until when (${s1.stall && new Date(s1.stall.until).toISOString()})`);
  check(s1.steps.some((s) => s.state === "stalled"), "the attempt that hit the limit shows as stalled");
  check((await api("/runs?state=stalled")).json.runs.some((r) => r.id === stalled), "filter by stalled");
  check(!(await api("/runs?state=failed")).json.runs.some((r) => r.id === stalled), "not listed as failed");

  console.log("a worker restart in the middle of the stall");
  await stopWorker("SIGKILL");
  await startWorker();
  const s2 = await until("done after restart", async () => ((await run(stalled))?.state === "done" ? run(stalled) : null), 40000);
  check(s2.completedAt >= s1.stall.until - 1000, "resumed only after the limit reset");
  check(s2.steps.filter((s) => s.name === "plan").length === 1, "the step before the stall ran once");
  check(s2.stall === null, "stall cleared");

  console.log("a failure, and retry by fork");
  const bad = (await api("/runs/demo", { method: "POST", body: { site: SITE, fail: true } })).json.id;
  const failed = await until("failed", async () => ((await run(bad))?.state === "failed" ? run(bad) : null));
  check(/asked to fail/.test(failed.error ?? ""), `error message shown (${failed.error})`);
  check(failed.steps.find((s) => s.name === "finish")?.state === "failed", "the failed step is marked");
  check(failed.retry === "fork" && failed.cancellable === false, "offers retry, not cancel");
  const retried = (await api(`/runs/${bad}/retry`, { method: "POST" })).json;
  check(retried.how === "fork" && retried.id !== bad, "retry forks a new run");
  const forked = await until("fork ends", async () => {
    const r = await run(retried.id);
    return r && ["failed", "done"].includes(r.state) ? r : null;
  });
  check(forked.forkedFrom === bad, "the new run says what it was forked from");
  check(forked.site === SITE, `the fork keeps its tenant (${forked.site})`);
  const planOutputs = forked.steps.filter((s) => s.name === "plan");
  check(planOutputs.length === 1, "steps before the failure carried over, not redone");

  console.log("cancel, then resume");
  const long = (await api("/runs/demo", { method: "POST", body: { site: SITE, stallSeconds: 120 } })).json.id;
  await until("stalled", async () => (await run(long))?.state === "stalled");
  check((await api(`/runs/${long}/cancel`, { method: "POST" })).status === 200, "cancel a stalled run");
  check((await run(long)).state === "cancelled", "shows cancelled");
  check((await api(`/runs/${long}/cancel`, { method: "POST" })).status === 409, "can't cancel twice");
  check((await run(long)).retry === "resume", "a cancelled run offers resume");
  const resumed = (await api(`/runs/${long}/retry`, { method: "POST" })).json;
  check(resumed.how === "resume" && resumed.id === long, "resume keeps the id");
  await until("pending again", async () => ["stalled", "running"].includes((await run(long))?.state));
  check(true, "running again after resume");
  await api(`/runs/${long}/cancel`, { method: "POST" });

  console.log("dispatch from Chat");
  const D = { Authorization: `Bearer ${DISPATCH}` };
  const handoff = { site: SITE, task: "Check the post about pricing", requestedBy: MEMBER, conversation: "conv123" };
  check((await api("/agents/__test", { method: "POST", body: handoff, headers: {} })).status === 401, "no secret: 401");
  check((await api("/agents/__test", { method: "POST", body: handoff, headers: { Authorization: "Bearer wrong" } })).status === 401, "wrong secret: 401");
  check((await api("/agents/__test", { method: "POST", body: handoff })).status === 401, "a superadmin token is not the dispatch secret");
  check((await api("/agents/__test", { method: "GET", headers: D })).status === 405, "GET: 405");
  check((await api("/agents/nobody", { method: "POST", body: handoff, headers: D })).status === 404, "unknown agent: 404");
  check((await api("/agents/__nobody", { method: "POST", body: handoff, headers: D })).status === 404, "an agent nobody registered yet: 404 (Chat says not running yet)");
  check((await api("/agents/__test", { method: "POST", body: { ...handoff, task: " " }, headers: D })).status === 400, "empty task: 400");
  check((await api("/agents/__test", { method: "POST", body: { ...handoff, requestedBy: "me" }, headers: D })).status === 400, "bad requestedBy: 400");
  check((await api("/agents/__test", { method: "POST", body: { ...handoff, site: "nosuchsite0000a" }, headers: D })).status === 422, "unknown tenant: 422");
  check((await api("/agents/__test", { method: "POST", body: { ...handoff, post: "not a post id" }, headers: D })).status === 400, "bad post: 400");
  check((await api("/agents/__test", { method: "POST", body: { ...handoff, task: "nothing" }, headers: D })).status === 422, "the agent finds nothing to work on: 422");
  const started = await api("/agents/__test", { method: "POST", body: handoff, headers: D });
  check(started.status === 202 && typeof started.json?.runId === "string", "starts the run: 202 { runId }");
  const dispatched = await until("dispatched run done", async () => ((await run(started.json.runId))?.state === "done" ? run(started.json.runId) : null));
  check(dispatched.name === "demo-agent" && dispatched.site === SITE, "the run is the agent's workflow, for that tenant");
  check(dispatched.output === "got: Check the post about pricing", "it got Chat's task");
  check(dispatched.input?.[0]?.post === null, "no post named: post is null");
  check((await api(`/runs?site=${SITE}`)).json.runs.some((r) => r.id === started.json.runId), "listed on the Runs page");

  console.log("run now (Admin)");
  check((await api("/triggers", { headers: { Authorization: `Bearer ${jwt(stranger)}` } })).status === 403, "triggers: not a superadmin: 403");
  const trig = await api("/triggers");
  check(trig.status === 200 && trig.json.triggers.some((t) => t.id === "scout" && t.scope === "tenant"), "lists the triggers");
  check(trig.json.triggers.some((t) => t.id === "listener-granola" && t.scope === "all"), "a trigger for every tenant is marked so");
  check(trig.json.tenants.some((t) => t.id === SITE && t.name === "Test tenant"), "lists the tenants for the picker");
  check((await api("/triggers/nope", { method: "POST", body: { site: SITE } })).status === 404, "unknown trigger: 404");
  check((await api("/triggers/scout", { method: "POST", body: {} })).status === 400, "a tenant trigger needs a tenant: 400");
  check((await api("/triggers/scout", { method: "POST", body: { site: "bad" } })).status === 400, "bad site: 400");
  check((await api("/triggers/scout", { method: "POST", body: { site: "nosuchsite0000a" } })).status === 422, "unknown tenant: 422");
  const fired = await api("/triggers/writer-voice-suggest", { method: "POST", body: { site: SITE } });
  check(fired.status === 200 && fired.json.runs.length === 1, "Run now starts one run");
  const manualRun = await until("manual run listed", async () => (await api(`/runs?site=${SITE}&limit=200`)).json.runs.find((r) => r.id === fired.json.runs[0]));
  check(manualRun.name === "writer:voice-suggest" && manualRun.site === SITE, "it is the agent's own workflow, for that tenant, on the Runs page");

  console.log("errors");
  check((await api("/runs/nope")).status === 404, "unknown run: 404");
  check((await api(`/runs/${ok}/retry`, { method: "POST" })).status === 409, "a finished run can't be retried");
  check((await api("/runs?state=bogus")).status === 400, "unknown state: 400");

  console.log("the Scout")
  const scoutRun = await api("/agents/scout", { method: "POST", body: handoff, headers: D });
  check(scoutRun.status === 202 && (await run(scoutRun.json.runId))?.name === "scout", "Chat starts the Scout");
  check((await api("/runs/scout", { method: "POST", body: { site: SITE }, headers: { Authorization: `Bearer ${jwt(stranger)}` } })).status === 403,
    "only a superadmin starts one from Admin");

  await stopWorker();
  await app.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  worker?.kill("SIGKILL");
  process.exit(1);
});
