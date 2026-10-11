// Day one: the pure parts (the split of 10 over the topics, what a revision
// changed, the 3 strongest, the progress lines), then the workflows end to
// end in process (real DBOS on a real Postgres, PGURL) against a stand-in
// PostgREST, a stand-in model and a stand-in web. Nothing here talks to a
// real model, search engine or site.

import { createServer } from "node:http";
import pg from "pg";
import { MockLanguageModelV3 } from "ai/test";

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";
const SYS_DB = "worker_test_first_day_dbos";
const SITE = "dayonesite00001";
const LITE = "litesite0000001";

let failures = 0;
function check(cond, what) {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

// ---- a stand-in PostgREST ----

const NOW = () => new Date().toISOString();
const db = {
  sites: [
    { id: SITE, name: "Kontra", slug: "kontra", domain: "" },
    { id: LITE, name: "Lite", slug: "lite", domain: "" },
  ],
  collections: [{ site: SITE, name: "Blog", slug: "blog", description: "", is_hidden: false, position: 0 }],
  posts: [],
  post_versions: [],
  briefs: [],
  agent_ideas: [],
  content_batches: [],
  taste_log: [],
  taste_profiles: [],
  strategy_proposals: [],
  tenant_profile: [{ site: SITE, answers: { offer: "Durable batch jobs for platform teams." }, plan_text: "", plan_files: [], plan_read_at: null }],
  app_settings: [{ site: SITE, key: "tenant.website", value: "https://kontra.example" }],
  agent_settings: [],
  goal_versions: [],
  daily_facts: [],
  voice_guides: [],
  model_calls: [],
};

function matches(row, key, cond) {
  const v = row[key];
  const [op, ...rest] = cond.split(".");
  const arg = rest.join(".");
  if (op === "eq") return String(v ?? "") === arg;
  if (op === "neq") return String(v ?? "") !== arg;
  if (op === "is") return arg === "null" ? v === null || v === undefined : String(v) === arg;
  if (op === "like") return new RegExp(`^${arg.replace(/\*/g, ".*")}$`).test(String(v ?? ""));
  if (op === "gte") return String(v) >= arg;
  if (op === "gt") return String(v) > arg;
  if (op === "lt") return String(v) < arg;
  if (op === "in") return arg.slice(1, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(v));
  if (op === "not" && rest[0] === "in") return !rest.slice(1).join(".").slice(1, -1).split(",").includes(String(v));
  throw new Error(`stand-in PostgREST: no operator ${cond}`);
}

function filterRows(table, params) {
  let rows = db[table];
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

const rpcs = {
  cost_gate: () => ({ tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false }),
  kb_search: () => [{ id: "claim0000000001", text: "Kontra runs batch jobs on Temporal.", status: "settled", topics: ["Product"] }],
};

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
    if (req.headers.authorization !== "Bearer service-key") return out(401, { message: "no key" });
    if (path.startsWith("rpc/")) {
      const fn = rpcs[path.slice(4)];
      return fn ? out(200, fn(JSON.parse(body || "{}"))) : out(404, { code: "PGRST202", message: "no function" });
    }
    if (path === "model_prices") return out(200, [{ input_per_mtok: "10", output_per_mtok: "50", cache_read_per_mtok: "0", cache_write_per_mtok: "0" }]);
    const table = db[path];
    if (!table) return out(404, { code: "PGRST205", message: `no table ${path}` });
    if (req.method === "GET") return out(200, filterRows(path, url.searchParams));
    if (req.method === "POST") {
      const row = { created: NOW(), updated: NOW(), ...JSON.parse(body) };
      if (url.searchParams.get("on_conflict")) {
        const keys = url.searchParams.get("on_conflict").split(",");
        const found = table.find((r) => keys.every((k) => String(r[k]) === String(row[k])));
        if (found) {
          Object.assign(found, row);
          return out(201, [found]);
        }
      }
      table.push(row);
      return out(201, [row]);
    }
    if (req.method === "PATCH") {
      const rows = filterRows(path, url.searchParams);
      for (const r of rows) Object.assign(r, JSON.parse(body));
      return out(200, rows);
    }
    out(405, {});
  });
});
await new Promise((r) => rest.listen(0, r));
process.env.SUPABASE_URL = `http://127.0.0.1:${rest.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.DATAFORSEO_LOGIN = "login";
process.env.DATAFORSEO_PASSWORD = "password";
process.env.WORKER_DISPATCH_SECONDS = "0";
process.env.WORKER_LITE_SITES = LITE;

// ---- a stand-in web ----

const searches = [];
// Searches the service refuses (a 4xxxx task, not an outage).
const refused = new Set();
const web = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://api.dataforseo.com/")) {
    const [{ keyword }] = JSON.parse(init.body);
    searches.push(keyword);
    if (refused.has(keyword)) return Response.json({ cost: 0.002, tasks: [{ status_code: 40000, status_message: "Internal SE Server Error." }] });
    const slug = keyword.replace(/\W+/g, "-");
    return Response.json({
      cost: 0.002,
      tasks: [{ status_code: 20000, result: [{ items: [{ type: "organic", url: `https://ranking.example/${slug}`, title: `On ${keyword}`, description: "A page.", rank_absolute: 1 }] }] }],
    });
  }
  throw new Error(`stand-in web: unexpected fetch ${url}`);
};

// ---- a stand-in model ----

const prompts = [];
const usage = { inputTokens: { total: 3000, noCache: 3000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1200, text: 1200, reasoning: 0 } };
let nth = 0;
function pitch(topic, url, i) {
  nth++;
  return {
    title: `${topic}: pitch ${i + 1} (${nth})`,
    why: "Buyers ask this before they buy.",
    angle: "A specific argument.",
    audience: "Platform engineers.",
    length: "1,200 words",
    collection: "Blog",
    outline: ["One", "Two", "Three", "Four"],
    sources: url ? [{ url, label: "What ranks" }] : [],
    targetSearch: i === 0 ? "batch job retries" : "",
    timely: false,
    expiresAt: "",
    answersGap: i % 2 === 0 ? "Answers why jobs die overnight." : "",
    demand: "",
    learned: "",
  };
}
function answer(prompt) {
  if (prompt.includes("Write the new summary.")) return "Rejects listicles.";
  const topic = /The topic: (.*) \(\d+ to \d+ posts/.exec(prompt)?.[1];
  const url = /<(https:\/\/ranking\.example\/[^>]+)>/.exec(prompt)?.[1];
  if (topic && prompt.includes("Write ONE replacement")) return JSON.stringify({ pitches: [pitch(topic, url, 1)] });
  const n = Number(/Write (\d+) different pitches/.exec(prompt)?.[1]);
  if (topic && n) return JSON.stringify({ pitches: Array.from({ length: n }, (_, i) => pitch(topic, url, i)) });
  throw new Error(`stand-in model: no answer for ${prompt.slice(0, 80)}`);
}
const model = new MockLanguageModelV3({
  doGenerate: async ({ prompt }) => {
    const text = prompt.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join(""))).join("\n");
    prompts.push(text);
    return { content: [{ type: "text", text: answer(text) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
  },
});

// ---- run ----

const admin = new pg.Client({ connectionString: `${PGURL}/postgres` });
await admin.connect();
await admin.query(`drop database if exists ${SYS_DB} with (force)`);
await admin.end();

const t = await import("../dist/agents/testing.js");
t.setModelResolver(() => model);
t.setWebFetch(web);
t.setSearchSleep(async () => {});
t.wireGateway();
t.DBOS.setConfig({ name: "propaganda-first-day-test", systemDatabaseUrl: `${PGURL}/${SYS_DB}`, applicationVersion: "test", enablePatching: true });
await t.DBOS.launch();
await t.registerQueues();

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const r = (value) => ({ value, why: "Because.", basis: "Your answers." });
function proposal(topics, extra = {}) {
  return {
    summary: "Reliability first, two posts a week.",
    volume: r(18),
    topics: topics.map(([name, low, high]) => ({ name, low, high, why: `${name} matters.`, basis: "Your website" })),
    ranking: {
      searches: [
        { query: "batch job retries", topic: "Reliability", why: "Winnable.", volume: 320, difficulty: 12, position: null },
        { query: "retry failed cron job", topic: "Reliability", why: "Winnable.", volume: 260, difficulty: 22, position: null },
      ],
      pageOneTarget: r(2),
      aiMentionTarget: r(null),
    },
    readership: r(null),
    watchedSites: [],
    questions: [],
    quarter: "2026-Q4",
    kind: "onboarding",
    covers: { from: "2026-10-10", to: "2026-12-31", weeks: 12, prorated: true },
    join: "prorated",
    batches: r(6),
    launch: { startsOn: "2026-10-10", target: 15, floor: 12, ceiling: 20, produceByDay: 20, publishOverDays: 30, dayOne: { briefs: 8, drafted: 3 }, prorated: false },
    ...extra,
  };
}
const row = (id, kind, status, p, site = SITE) => ({ id, site, quarter: "2026-Q4", kind, status, request: "", requested_by: "u1", proposal: p, edits: null, created: NOW(), approved_at: null, run_id: "" });
const run = (wf, id, ...args) => t.DBOS.startWorkflow(wf, { workflowID: id })(...args).then((h) => h.getResult());
const strategistBriefs = () => db.briefs.filter((b) => b.site === SITE && b.pitched_by === "agent:strategist");
// The progress route reads the proposal through the read-only pool; this stands in for it.
const pool = { query: async (_sql, [site]) => ({ rows: db.strategy_proposals.filter((p) => p.site === site).sort((a, b) => (a.created < b.created ? 1 : -1)).slice(0, 1) }) };

try {
  console.log("the split of 10 over the topics");
  check(JSON.stringify(t.splitPitches([6, 3])) === "[7,3]", `proportional to the low ends (${t.splitPitches([6, 3])})`);
  check(JSON.stringify(t.splitPitches([5, 5, 5, 5])) === "[3,3,2,2]", "ties go to the earlier topic");
  check(JSON.stringify(t.splitPitches([10, 1, 1])) === "[6,2,2]", `at least 2 a topic (${t.splitPitches([10, 1, 1])})`);
  check(JSON.stringify(t.splitPitches([4])) === "[10]" && JSON.stringify(t.splitPitches([0, 0])) === "[5,5]", "one topic takes all; no low ends split evenly");
  let always = true;
  for (let k = 1; k <= 4; k++) {
    for (let trial = 0; trial < 200; trial++) {
      const lows = Array.from({ length: k }, () => Math.floor(Math.random() * 12));
      const s = t.splitPitches(lows);
      if (sum(s) !== 10 || s.some((x) => x < 2)) always = false;
    }
  }
  check(always, "always 10 in all, at least 2 each, for 1 to 4 topics");

  console.log("what a revision changed");
  const ch = t.topicChanges(["Reliability", "Scraping at scale", "Pricing"], ["reliability ", "Web data pipelines", "Pricing"]);
  check(JSON.stringify(ch.kept) === '["reliability ","Pricing"]', "kept, case and spacing aside");
  check(JSON.stringify(ch.removed) === '["Scraping at scale"]' && JSON.stringify(ch.added) === '["Web data pipelines"]', "a rename is a removal and an addition");
  const none = t.topicChanges([], ["A", "B"]);
  check(none.added.length === 2 && !none.kept.length && !none.removed.length, "a first round adds every topic");

  console.log("the 3 strongest");
  const reason = (counts) => ({ kind: "gap", text: "x", counts });
  const top = t.strongest([
    { id: "a", fit: { grade: "fair", reasons: [reason(true), reason(true)] }, created: "1" },
    { id: "b", fit: { grade: "strong", reasons: [reason(true), reason(true), reason(true)] }, created: "2" },
    { id: "c", fit: { grade: "fair", reasons: [reason(true), reason(true), reason(false)] }, created: "0" },
    { id: "d", fit: { grade: "fair", reasons: [reason(true)] }, created: "0" },
    { id: "e", fit: { grade: "strong", reasons: [reason(true), reason(true), reason(true), reason(true)] }, created: "3" },
  ]);
  check(top.map((x) => x.id).join() === "e,b,c", `Strong first, then by fit reasons, then the oldest (${top.map((x) => x.id)})`);

  console.log("the progress lines");
  const lines = (status, names, done = names) => t.planSteps(status, names.map((name) => ({ name, done: done.includes(name) })));
  check(lines(null, []).every((s) => s.state === "waiting") && t.PLAN_STEPS.length === 5, "nothing yet: five waiting lines");
  let p = lines("running", ["gather", "keyword data"], ["gather"]);
  check(p.map((s) => s.state).join() === "done,running,waiting,waiting,waiting", `reading searches (${p.map((s) => s.state)})`);
  p = lines("running", ["gather", "keyword data", "who ranks", "propose"], ["gather", "keyword data", "who ranks"]);
  check(p.map((s) => s.state).join() === "done,done,done,running,waiting", "writing the plan");
  p = lines("running", ["gather", "keyword data", "propose", "propose (fix)"], ["gather", "keyword data", "propose"]);
  check(p.map((s) => s.state).join() === "done,done,done,done,running", "sent back once: checking (an older run, one keyword step)");
  check(lines("sent", ["gather"]).every((s) => s.state === "done"), "sent: all done");
  check(lines("failed", ["gather", "keyword data"]).map((s) => s.state).join() === "done,done,done,waiting,waiting", "failed: nothing running");
  check(t.dayOneQuota({ dayOne: { briefs: 8 } }) === 5 && t.dayOneQuota({ dayOne: { briefs: 3 } }) === 3 && t.dayOneQuota(null) === 5, "batch 1's quota: the Launch's day one, at most 5");

  console.log("the answer's shape");
  const parse = t.parseTopicPitches(new Set(["https://ok.example/a"]), ["Blog"], 2, ["batch job retries"]);
  let threw = "";
  try {
    parse({ pitches: [pitch("X", "https://ok.example/a", 0)] });
  } catch (err) {
    threw = err.message;
  }
  check(/Write 2 pitches/.test(threw), "too few pitches go back");
  try {
    threw = "";
    parse({ pitches: [pitch("X", "https://elsewhere.example/a", 0), pitch("X", "", 1)] });
  } catch (err) {
    threw = err.message;
  }
  check(/not one of the URLs/.test(threw), "a source it wasn't given goes back");
  const ok = parse({ pitches: [{ ...pitch("X", "", 0), targetSearch: "Batch Job Retries" }, { ...pitch("X", "", 1), targetSearch: "made up" }] });
  check(ok[0].judgement.targetSearch === "batch job retries" && ok[1].judgement.targetSearch === "", "only the plan's searches count as targets");

  console.log("the first pitches");
  const P1 = "proposal1000001";
  db.strategy_proposals.push(row(P1, "onboarding", "sent", proposal([["Reliability", 6, 9], ["Scraping at scale", 3, 5]])));
  refused.add("batch job retries");
  const res1 = await run(t.firstPitches, t.firstPitchesId(P1), P1);
  refused.clear();
  const b1 = strategistBriefs();
  check(res1.written === 10 && b1.length === 10, `10 pitches, though one search was refused (${JSON.stringify(res1)})`);
  check(b1.filter((b) => b.topics[0] === "Reliability").length === 7 && b1.filter((b) => b.topics[0] === "Scraping at scale").length === 3, "7 and 3, by the low ends");
  check(b1.every((b) => b.status === "pitched" && b.batch === 1 && b.origin === "plan" && b.outline.length === 4 && b.body.includes("## Fit")), "briefs in the Pitcher's format, pitched, batch 1");
  check(
    b1.every((b) => ["strong", "fair", "weak"].includes(b.fit.grade) && b.fit.reasons.length > 0) &&
      b1.filter((b) => b.fit.reasons.some((x) => x.kind === "mix" && x.text.includes("under target"))).length >= 9,
    `rated by fit.ts against the plan (${b1.map((b) => b.fit.reasons.map((x) => x.kind).join("+")).join(" ")})`,
  );
  check(b1.some((b) => b.fit.reasons.some((x) => x.text.includes('Targets "batch job retries"'))), "a pitch on a target search says so");
  const ideas1 = db.agent_ideas.filter((i) => i.source_agent === "strategist");
  check(ideas1.length === 10 && ideas1.every((i) => i.status === "pitched" && i.origin === "plan" && i.brief && i.evidence[0].label.includes(P1)), "each with its idea, settled pitched, naming the proposal");
  check(ideas1.some((i) => i.id === t.stableId(`first-${P1}-0-1`)), "ideas keyed first-<proposal>-<topic>-<n>");
  const batch1 = db.content_batches.find((b) => b.site === SITE && b.number === 1);
  check(batch1?.state === "in_review" && batch1.quota === 5 && batch1.released_at, "batch 1 released now, quota 5");
  const calls1 = db.model_calls.filter((c) => c.job === "strategist:pitch" && !String(c.model).startsWith("dataforseo"));
  check(calls1.length === 2 && calls1.every((c) => String(c.model).includes("fable")), `one Fable call per topic, logged (${calls1.map((c) => c.model)})`);
  check(searches.length === 10, `one search per pitch (${searches.length})`);
  check(prompts.some((x) => x.includes("Write 7 different pitches") && x.includes("Kontra runs batch jobs on Temporal")), "the prompt carries the count and the knowledge base");

  let pg1 = await t.strategistProgress(pool, SITE);
  check(pg1.proposalId === P1 && pg1.status === "sent" && pg1.steps.every((s) => s.state === "done"), "progress: the plan is done");
  check(JSON.stringify(pg1.pitches) === JSON.stringify({ topicsDone: 2, topics: 2, written: 10 }) && pg1.drafts.length === 0, `progress: 2 of 2 topics, 10 written (${JSON.stringify(pg1.pitches)})`);

  console.log("the Pitcher's morning run the same day");
  db.agent_ideas.push({ id: "scoutidea000001", site: SITE, title: "A Scout idea", summary: "", origin: "search", evidence: [], source_agent: "scout", expires_at: null, target_search: "", status: "new", reason: "", brief: null, created: NOW() });
  const morning = await run(t.pitchBatch, "pitcher-batch-test", { site: SITE, trigger: "schedule" });
  check(morning.released === null && morning.toppedUp.length === 0 && db.content_batches.filter((b) => b.site === SITE).length === 1, `no second batch 1, no same-day top-up (${JSON.stringify(morning)})`);

  console.log("a revision re-pitches only what changed");
  const scraping = b1.filter((b) => b.topics[0] === "Scraping at scale");
  scraping[0].status = "todo"; // a person approved one
  const P2 = "proposal2000002";
  db.strategy_proposals[0].status = "superseded";
  db.strategy_proposals.push(row(P2, "revision", "sent", proposal([["Reliability", 6, 9], ["Web data pipelines", 3, 5]], { kind: "revision", launch: null })));
  const fable = () => db.model_calls.filter((c) => String(c.model).includes("fable")).length;
  const callsBefore = fable();
  const res2 = await run(t.firstPitches, t.firstPitchesId(P2), P2);
  check(res2.kept.includes("Reliability") && JSON.stringify(res2.topics) === '["Web data pipelines"]' && res2.written === 3, `only the new topic is pitched (${JSON.stringify(res2)})`);
  check(scraping[0].status === "todo" && scraping.slice(1).every((b) => b.status === "cancelled" && b.reject_reason === "Topic left the plan"), "undecided pitches on the dropped topic are withdrawn; a decided one stays");
  check(strategistBriefs().filter((b) => b.topics[0] === "Reliability" && b.status === "pitched").length === 7, "the kept topic's pitches stay");
  check(fable() - callsBefore === 1, "one model call, for the new topic");

  console.log("one replacement for a rejected pitch");
  const rejected = strategistBriefs().find((b) => b.topics[0] === "Reliability");
  rejected.status = "rejected";
  rejected.reject_reason = "No listicles, please.";
  const started = await t.dispatchFirstDay();
  check(started.includes(t.replaceId(rejected.id)), `the poll starts replace-<brief> (${started})`);
  const rep = await t.DBOS.retrieveWorkflow(t.replaceId(rejected.id)).getResult();
  const replacement = db.briefs.find((b) => b.fit?.replaces === rejected.id);
  check(rep.written === 1 && replacement?.topics[0] === "Reliability" && replacement.status === "pitched" && replacement.batch === 1, `a replacement on the same topic (${JSON.stringify(rep)})`);
  check(replacement?.learned === "Written after your note: No listicles, please." && replacement.body.startsWith("_Written after your note"), "it says which note it answers");
  check(prompts.at(-1).includes("No listicles, please.") && prompts.at(-1).includes("Write ONE replacement"), "the model read the reason");
  replacement.status = "rejected";
  replacement.reject_reason = "Still no.";
  t.forgetAsked();
  const again = await t.dispatchFirstDay();
  check(!again.includes(t.replaceId(replacement.id)), "a replacement is never replaced");

  console.log("drafts once the plan is approved");
  const P2row = db.strategy_proposals.find((x) => x.id === P2);
  P2row.status = "approved";
  P2row.approved_at = NOW();
  t.forgetAsked();
  const startedDrafts = await t.dispatchFirstDay();
  check(startedDrafts.includes(t.firstDraftsId(P2)), `the poll starts first-drafts-<proposal> (${startedDrafts})`);
  const drafts = await t.DBOS.retrieveWorkflow(t.firstDraftsId(P2)).getResult();
  const live = strategistBriefs().filter((b) => b.status === "pitched" || b.status === "todo");
  const want = t.strongest(live, 3).filter((b) => b.status === "pitched").map((b) => b.id);
  check(drafts.drafting.length === want.length && drafts.drafting.every((d, i) => d.briefId === want[i]), `the strongest pitched ones are drafted (${drafts.drafting.length})`);
  // The Writer runs themselves are its own tests' business.
  for (const d of drafts.drafting) await t.DBOS.cancelWorkflow(d.runId).catch(() => {});
  const pg2 = await t.strategistProgress(pool, SITE);
  check(pg2.proposalId === P2 && pg2.status === "approved" && pg2.drafts.length === drafts.drafting.length && pg2.drafts.every((d) => ["running", "done", "failed"].includes(d.state)), `progress lists the drafts (${JSON.stringify(pg2.drafts)})`);
  check(JSON.stringify(pg2.pitches) === JSON.stringify({ topicsDone: 1, topics: 1, written: 3 }), "and the revision's pitches");

  console.log("a run that ended without a word");
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  db.strategy_proposals.push(
    { ...row("stuckcancelled1", "revision", "running", null), run_id: drafts.drafting[0]?.runId ?? "" },
    { ...row("stucknorun00001", "revision", "running", null), run_id: "never-started", created: ago(20) },
    { ...row("stillfresh00001", "revision", "running", null), run_id: "not-yet-started" },
  );
  const settled = await t.settleStrategist();
  const st = (id) => db.strategy_proposals.find((x) => x.id === id);
  check(drafts.drafting.length > 0 && st("stuckcancelled1").status === "failed" && st("stuckcancelled1").error === t.STOPPED_ERROR, "a running proposal whose run was cancelled is failed, saying to ask again");
  check(st("stucknorun00001").status === "failed", "one with no run after 15 minutes too");
  check(st("stillfresh00001").status === "running" && settled.length === 2, `a fresh one is left alone (${settled})`);
  for (const id of ["stuckcancelled1", "stucknorun00001", "stillfresh00001"]) st(id).status = "superseded";

  console.log("not day one");
  const P3 = "proposal3000003";
  db.strategy_proposals.push(row(P3, "onboarding", "sent", proposal([["Reliability", 6, 9]]), LITE));
  const lite = await run(t.firstPitches, t.firstPitchesId(P3), P3);
  check(/Lite/.test(lite.skipped ?? ""), "a Lite tenant gets no pitches");
  const P4 = "proposal4000004";
  db.strategy_proposals.push(row(P4, "revision", "sent", proposal([["Reliability", 6, 9], ["New", 2, 3]], { kind: "revision", launch: null })));
  const after = await run(t.firstPitches, t.firstPitchesId(P4), P4);
  check(/approved before/.test(after.skipped ?? ""), `after a plan was approved, the Pitcher pitches (${after.skipped})`);
} finally {
  await t.DBOS.shutdown();
  rest.close();
}

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nALL PASSED");
process.exit(0);
