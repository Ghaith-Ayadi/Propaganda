// The knowledge base agents end to end on the laptop stack: the worker as a
// process (worker/dist, `npm run build` there first) with canned model answers,
// its dispatcher finding work in the database, the Checker and the Guardian
// writing through PostgREST with the service key, and members going through
// the API as the app does.
//
//   Remember -> the Guardian admits it and flags the claim it contradicts
//   a post in review -> the Checker links it and opens a contradiction flag
//   contest the flag -> the Checker drafts it, the member submits, the Guardian
//     admits it contested and the flag closes as reconciled
//   a claim the post asserts is retracted -> a re-check, which the Checker clears
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admin, check, done, newId, ok, sql, user } from "./lib.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${HERE}../.env`, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}
const one = (q) => sql(q)[0]?.[0];
const DBOS_DB = "kb_agents_test_dbos";
const dbosSql = (q) =>
  execFileSync("docker", ["compose", "-f", `${HERE}../docker-compose.yml`, "exec", "-T", "db", "psql", "-U", "postgres",
    "-d", DBOS_DB, "-tA", "-F", "\t", "-c", q], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.split("\t"));
sql(`drop database if exists ${DBOS_DB}`);

// ---- a tenant with the agents on, a member, a claim, a post in review ----
const S = newId();
const member = await user(`kb-agents-${S}@test.local`);
await ok(admin.from("sites").insert({ id: S, name: "Acme (agents test)", slug: `acme-${S}` }));
await ok(admin.from("site_members").insert({ site: S, user_id: member.userId, role: "owner" }));
await ok(admin.from("collections").insert({ site: S, name: "Test", emoji: "🧪", position: 1 }));
sql(`insert into public.kb_agent_sites (site, since) values ('${S}', now() - interval '1 day')`);

// The knowledge base starts with one settled claim, admitted the way the Guardian does.
const seedProp = newId();
sql(`insert into public.kb_proposals (id, site, origin, title, opened_by_agent) values ('${seedProp}', '${S}', 'chat', 'Seed', 'test');
     insert into public.kb_changes (site, proposal, op, text) values ('${S}', '${seedProp}', 'add', 'Setting up Acme takes one week.');
     select public.kb_guardian_decide('${seedProp}', 'admit', 'Seed.', '[]', '', 'test', 1);`);
const week = one(`select id from public.kb_claims where site = '${S}' and text like 'Setting up Acme%'`);

const post = newId();
const version = newId();
await ok(member.from("posts").insert({ id: post, site: S, title: "Setup guide", type: "Test", status: "done", content_md: "Acme takes a day to set up." }));
await ok(member.from("post_versions").insert({ id: version, site: S, post, version: 1, content: "Acme takes a day to set up.", created_by: "user" }));

// A member remembers something that contradicts the claim.
const remember = await ok(member.rpc("kb_remember", { p_site: S, p_text: "Setting up Acme takes two days." }));
const rememberChange = one(`select id from public.kb_changes where proposal = '${remember}'`);

// ---- the canned answers, by job, in the order the runs ask ----
const dir = mkdtempSync(join(tmpdir(), "kb-agents-"));
const answers = join(dir, "answers.json");
writeFileSync(answers, JSON.stringify({
  checker: [{
    links: [{ claim: week, reliance: "asserts", quote: "Acme takes a day to set up." }, { claim: "notaclaim000000", reliance: "asserts", quote: "x" }],
    conflicts: [{ claim: week, quote: "Acme takes a day to set up.", explanation: "The knowledge base says a week.",
                  suggested_action: "edit_wording", suggested_fix: "Acme takes a week to set up." }],
    sources: [], remember: [{ text: "Acme has a setup guide.", quote: "Setup guide" }], summary: "One conflict.",
  }],
  guardian: [
    // 1. the Remember: it contradicts the week claim
    { checks: [{ check: "C8", result: "pass", reason: "Contradicts the week claim; the owner decides." }],
      relations: [{ change: rememberChange, claim: week, relation: "contradicts" }], argument: "A Remember." },
    // 2. the contest: argued only from the person's word
    { checks: [{ check: "C9", result: "weak", reason: "Scope, but only the person's word." }, { check: "C10", result: "pass", reason: "" }],
      relations: [], argument: "Admitted contested: needs a source." },
    // 3. the retraction
    { checks: [{ check: "C11", result: "major", reason: "Retracted." }], relations: [], argument: "Wrong." },
  ],
  "checker-contest": [{
    changes: [{ op: "add", text: "On the self-serve plan, setting up Acme takes one day.", scope: { plan: "self-serve" } },
              { op: "supersede", text: "made up", target: "notaclaim000000" }],
    argument: "Scope: the guide covers the self-serve plan.",
  }],
  "checker-recheck": [{ holds: true, explanation: "Only says a day, which is the self-serve claim.", suggested_action: "leave", suggested_fix: "" }],
}));

// ---- the worker ----
const port = 3920;
const worker = spawn("node", ["dist/main.js"], {
  cwd: `${HERE}../../worker`,
  env: {
    ...process.env,
    PGHOST: "localhost", PGPORT: "54322", POSTGRES_PASSWORD: env.POSTGRES_PASSWORD, JWT_SECRET: env.JWT_SECRET,
    SUPABASE_URL: "http://localhost:54321", SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
    DBOS_SYSTEM_DATABASE_URL: `postgres://postgres:${encodeURIComponent(env.POSTGRES_PASSWORD)}@localhost:54322/${DBOS_DB}`,
    WORKER_PORT: String(port), WORKER_DISPATCH_SECONDS: "1", WORKER_SETTLE_SECONDS: "0", WORKER_FAKE_ANSWERS: answers,
    WORKER_DISPATCH_SECRET: "test-dispatch-secret",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
worker.stdout.on("data", (d) => (log += d));
worker.stderr.on("data", (d) => (log += d));
const stop = () => worker.kill("SIGTERM");
process.on("exit", stop);

try {
  // The Remember: admitted, and the contradiction goes to the owner as a flag.
  await until("the Remember ruled", () => one(`select status from public.kb_proposals where id = '${remember}'`) === "admitted");
  check("a Remember is admitted", true);
  check("its contradiction is a kb_conflict flag",
    one(`select count(*) from public.kb_flags where site = '${S}' and kind = 'kb_conflict' and status = 'open'`) === "1");
  check("the ruling's checks are stored",
    one(`select checks->0->>'check' from public.kb_decisions where proposal = '${remember}'`) === "C8");

  // The post: linked, flagged, report kept. The made-up claim id was dropped.
  await until("the post checked", () => one(`select count(*) from public.kb_checks where post_version = '${version}'`) === "1");
  check("the post version is linked to the claim it asserts",
    one(`select string_agg(claim || ':' || reliance, ',') from public.kb_post_claims where post_version = '${version}'`) === `${week}:asserts`);
  const flag = one(`select id from public.kb_flags where post = '${post}' and kind = 'contradiction' and status = 'open'`);
  check("a contradiction flag is open", Boolean(flag));
  check("the report offers Remember",
    one(`select report->'remember'->0->>'text' from public.kb_checks where post_version = '${version}'`) === "Acme has a setup guide.");
  const { data: seen } = await member.from("kb_checks").select("id").eq("post", post);
  check("members read the report", seen?.length === 1);

  // Contest: the member's sentence, the Checker's draft, the member submits, the Guardian rules.
  const contest = await ok(member.rpc("kb_contest", { p_flag: flag, p_reason: "The guide is about the self-serve plan.", p_axis: "scope" }));
  await until("the contest drafted", () => one(`select count(*) from public.kb_changes where proposal = '${contest}'`) === "1");
  check("the draft keeps the valid change and drops the made-up target", true);
  check("the draft cites the person and the flagged post",
    one(`select jsonb_array_length(evidence) from public.kb_changes where proposal = '${contest}'`) === "2");
  await ok(member.rpc("kb_submit", { p_proposal: contest }));
  await until("the contest ruled", () => one(`select status from public.kb_proposals where id = '${contest}'`) === "admitted");
  check("the weak contest is admitted contested",
    one(`select status from public.kb_claims where text like 'On the self-serve plan%' and site = '${S}'`) === "contested");
  check("the flag closes as reconciled", one(`select status from public.kb_flags where id = '${flag}'`) === "reconciled");

  // A change: the week claim is retracted, the post relied on it, the Checker re-reads it.
  const retract = newId();
  sql(`insert into public.kb_proposals (id, site, origin, title, opened_by_agent) values ('${retract}', '${S}', 'chat', 'Retract', 'test');
       insert into public.kb_changes (site, proposal, op, target) values ('${S}', '${retract}', 'retract', '${week}');`);
  await until("the retraction ruled", () => one(`select status from public.kb_proposals where id = '${retract}'`) === "admitted");
  check("a retraction is major", one(`select severity from public.kb_decisions where proposal = '${retract}'`) === "major");
  await until("the re-check read", () => one(`select status from public.kb_flags where post = '${post}' and kind = 'recheck'`) === "cleared");
  check("a re-check that still holds clears", true);

  // Chat's hand-off: by the title in the request, the same run as the dispatcher's.
  const handoff = async (body, secret = "test-dispatch-secret") => {
    const res = await fetch(`http://localhost:${port}/agents/checker`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const ask = { site: S, requestedBy: member.userId, conversation: "conv-kb-agents" };
  const byTitle = await handoff({ ...ask, task: "Can you check the setup guide again?" });
  check("Chat starts the Checker on a post it names", byTitle.status === 202 && byTitle.json?.runId === `checker-${version}`, JSON.stringify(byTitle));
  check("a wrong secret is refused", (await handoff({ ...ask, task: "setup guide" }, "nope")).status === 401);
  check("by id too", (await handoff({ ...ask, task: "check this", post })).json?.runId === `checker-${version}`);
  check("no matching post is a 422", (await handoff({ ...ask, task: "the pricing page" })).status === 422);

  // Every run belongs to the tenant, once.
  const runs = dbosSql(`select name, count(*) from dbos.workflow_status group by name order by name`);
  const count = (name) => runs.find(([n]) => n === name)?.[1];
  check("each piece of work ran once",
    count("checker") === "1" && count("guardian") === "3" && count("checker-contest") === "1" && count("checker-recheck") === "1",
    JSON.stringify(runs));
  check("every run is the tenant's",
    dbosSql(`select count(*) from dbos.workflow_status where attributes->>'site' is distinct from '${S}'`)[0]?.[0] === "0");
} catch (err) {
  check(String(err.message), false);
  console.log(log.split("\n").slice(-40).join("\n"));
} finally {
  stop();
  sql(`delete from public.kb_agent_sites where site = '${S}'`);
}
done("kb_agents");
