// The Strategist: its rules as pure functions, then a run end to end in
// process (real DBOS on a real Postgres, PGURL), against a stand-in PostgREST,
// a stand-in model and a stand-in web. Nothing here talks to a real model,
// search engine or site.

import { createServer } from "node:http";
import pg from "pg";
import { MockLanguageModelV3 } from "ai/test";

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";
const SYS_DB = "worker_test_strategist_dbos";
const SITE = "stratsite000001";
const WEB = "http://93.184.216.34";

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
  app_settings: [
    { site: SITE, key: "tenant.website", value: WEB },
    { site: SITE, key: "strategist.reviewPerMonth", value: "8" },
  ],
  tenant_profile: [
    {
      site: SITE,
      answers: { offer: "Durable batch jobs for platform teams.", searches: "batch job retries\nrun scrapers at scale", watch: "prefect.io\ndagster.io", upcoming: "v2 ships in November." },
      plan_text: "Focus on reliability first.",
      plan_files: [],
      plan_read_at: null,
    },
  ],
  strategy_proposals: [],
  goal_versions: [],
  drift_notes: [],
  posts: [],
  briefs: [],
  taste_profiles: [{ site: SITE, summary: "Rejects listicles.", summary_through: null, notes: "" }],
  agent_settings: [],
  daily_facts: [],
  model_calls: [],
};

function matches(row, key, cond) {
  const v = row[key];
  const [op, ...rest] = cond.split(".");
  const arg = decodeURIComponent(rest.join("."));
  if (op === "eq") return String(v ?? "") === arg;
  if (op === "neq") return String(v ?? "") !== arg;
  if (op === "gte") return String(v) >= arg;
  if (op === "lt") return String(v) < arg;
  if (op === "in") return arg.slice(1, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(v));
  throw new Error(`stand-in PostgREST: no operator ${cond}`);
}

function filterRows(table, params) {
  let rows = db[table];
  for (const [k, v] of params) {
    if (["select", "order", "limit"].includes(k)) continue;
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
    if (path === "model_prices") return out(200, [{ input_per_mtok: "2", output_per_mtok: "10", cache_read_per_mtok: "0", cache_write_per_mtok: "0" }]);
    const table = db[path];
    if (!table) return out(404, { code: "PGRST205", message: `no table ${path}` });
    if (req.method === "GET") return out(200, filterRows(path, url.searchParams));
    if (req.method === "POST") {
      const row = { created: new Date().toISOString(), ...JSON.parse(body) };
      if (path === "drift_notes" && table.some((r) => r.site === row.site && r.week === row.week && r.goal === row.goal && r.message === row.message)) {
        return out(409, { code: "23505", message: "duplicate key" });
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

// ---- a stand-in web (DataForSEO and the pages) ----

const KEYWORDS = [
  { keyword: "batch job retries", vol: 320, kd: 12 },
  { keyword: "durable batch jobs", vol: 140, kd: 18 },
  { keyword: "retry failed cron job", vol: 260, kd: 22 },
  { keyword: "nightly etl failures", vol: 90, kd: 15 },
  { keyword: "run scrapers at scale", vol: 210, kd: 25 },
  { keyword: "workflow orchestration", vol: 9900, kd: 78 },
];
const labsItem = (k) => ({ keyword: k.keyword, keyword_info: { search_volume: k.vol }, keyword_properties: { keyword_difficulty: k.kd } });
const calls = [];
const realFetch = globalThis.fetch;
async function web(input, init) {
  const url = String(input);
  if (url.startsWith("https://api.dataforseo.com/")) {
    calls.push(url);
    if (url.includes("keyword_ideas")) return Response.json({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: KEYWORDS.map(labsItem) }] }] });
    if (url.includes("ranked_keywords")) return Response.json({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
    if (url.includes("serp/google/organic")) {
      return Response.json({ cost: 0.002, tasks: [{ status_code: 20000, result: [{ items: [{ type: "organic", url: "https://prefect.io/blog/retries", title: "Retries", rank_absolute: 1 }] }] }] });
    }
  }
  if (url.startsWith(WEB)) {
    if (url.includes("/dead")) return new Response("gone", { status: 404 });
    return new Response(`<html><head><title>Kontra</title></head><body><p>Durable batch jobs. ${url}</p></body></html>`, { headers: { "content-type": "text/html" } });
  }
  return realFetch(input, init);
}
globalThis.fetch = web;

// ---- a stand-in model ----

const prompts = [];
let answers = [];
const usage = { inputTokens: { total: 4000, noCache: 4000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 800, text: 800, reasoning: 0 } };
const r = (value, why = "Because.", basis = "Your answers.") => ({ value, why, basis });
const GOOD = {
  summary: "Start steady: reliability first, two posts a week.",
  volume: r(18, "What your team can review.", "Your answer: 8 posts a month"),
  topics: [
    { name: "Reliability", low: 6, high: 9, why: "What you sell.", basis: "Your website" },
    { name: "Scraping at scale", low: 3, high: 5, why: "A search you named.", basis: "DataForSEO: 210/month" },
  ],
  ranking: {
    searches: ["batch job retries", "durable batch jobs", "retry failed cron job", "nightly etl failures", "run scrapers at scale"].map((q, i) => ({
      query: q,
      topic: i === 4 ? "Scraping at scale" : "Reliability",
      why: "Winnable.",
    })),
    pageOneTarget: r(2, "A new domain ranks slowly.", "Rule for a first quarter"),
    aiMentionTarget: r(null, "Not in a first quarter.", "Research"),
  },
  readership: r(null, "No readers yet; a target after 4 weeks.", "No data"),
  watchedSites: [
    { url: `${WEB}/blog`, topic: "Reliability", why: "Competitor blog." },
    { url: `${WEB}/news`, topic: "Reliability", why: "Trade press." },
    { url: `${WEB}/dead`, topic: "Scraping at scale", why: "Gone." },
    { url: `${WEB}/forum`, topic: "Scraping at scale", why: "Where they ask." },
  ],
  questions: ["Should v2's launch get its own topic?"],
};
const model = new MockLanguageModelV3({
  doGenerate: async ({ prompt }) => {
    const text = prompt.map((m) => (typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join(""))).join("\n");
    prompts.push(text);
    const next = answers.shift() ?? GOOD;
    return { content: [{ type: "text", text: typeof next === "string" ? next : JSON.stringify(next) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
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
t.wireGateway();
t.DBOS.setConfig({ name: "propaganda-strategist-test", systemDatabaseUrl: `${PGURL}/${SYS_DB}`, applicationVersion: "test" });
await t.DBOS.launch();
await t.registerQueues();

const kw = (list) => new Map(list.map((k) => [k.keyword, { keyword: k.keyword, volume: k.vol, difficulty: k.kd, position: k.pos ?? null }]));

try {
  console.log("the window and the Launch");
  const w1 = t.windowFor("onboarding", new Date("2026-10-09T12:00:00Z"));
  check(w1.quarter === "2026-Q4" && w1.join === "full" && w1.covers.from === "2026-10-09" && w1.covers.to === "2026-12-31" && w1.covers.prorated, `week 2: full goals for the rest of Q4 (${JSON.stringify(w1)})`);
  const w2 = t.windowFor("onboarding", new Date("2026-11-10T12:00:00Z"));
  check(w2.quarter === "2026-Q4" && w2.join === "prorated", "week 7: prorated");
  const w3 = t.windowFor("onboarding", new Date("2026-12-10T12:00:00Z"));
  check(w3.quarter === "2027-Q1" && w3.join === "next_quarter" && w3.covers.weeks === 13, `week 11: goals for next quarter (${w3.quarter}, ${w3.covers.weeks} weeks)`);
  const l3 = t.launchFor(new Date("2026-12-10T12:00:00Z"), "next_quarter");
  check(l3.prorated && l3.target === 11, `and a Launch prorated to the days left (15 × 21 ÷ 30 = ${l3.target})`);
  check(t.launchFor(new Date("2026-12-28T12:00:00Z"), "next_quarter").target === 3, "at least 3");
  check(t.launchFor(new Date("2026-10-09T12:00:00Z"), "full").target === 15, "a full Launch is 15");
  check(t.windowFor("quarterly", new Date("2026-12-17T06:00:00Z")).quarter === "2027-Q1", "the quarterly run plans the next quarter");

  console.log("rules");
  check(t.volumeCap({ weeks: 12, perMonth: 8, lastQuarterPublished: null }) === 22, "day one: 8 a month over 12 weeks is 22");
  check(t.volumeCap({ weeks: 12, perMonth: 40, lastQuarterPublished: null }) === 24, "and never more than 2 a week");
  check(t.volumeCap({ weeks: 13, perMonth: 8, lastQuarterPublished: 20 }) === 24, "with history: last quarter + 20%");
  check(t.winnable({ keyword: "x", volume: 50, difficulty: 29, position: null }), "easy and searched is winnable");
  check(!t.winnable({ keyword: "x", volume: 9900, difficulty: 78, position: null }), "hard is not");
  check(t.winnable({ keyword: "x", volume: 10, difficulty: 80, position: 14 }), "page two is");
  check(!t.winnable({ keyword: "ai assistant", volume: 301000, difficulty: 25, position: null }, { newDomain: true }), "a head term is not, for a new domain, whatever its difficulty");
  check(t.winnable({ keyword: "ai assistant", volume: 301000, difficulty: 25, position: null }), "but is with history");
  check(t.looksLikeSource("https://www.airops.com/") && t.looksLikeSource("https://example.com/blog"), "a site or a blog index is a source");
  check(!t.looksLikeSource("https://buffer.com/resources/ai-social-media-content-creation/") && !t.looksLikeSource("https://x.com/a/b.pdf"), "an article or a file is not");
  check(t.MODELS.strategist === (process.env.AGENT_MODEL_STRATEGIST || "anthropic/claude-fable-5.1"), `the Strategist runs on Claude Fable 5.1 (${t.MODELS.strategist})`);
  check(t.pickHost("AirOps", ["instagram.com", "www.airops.com", "g2.com"], "propaganda.pub") === "airops.com", "a bare competitor name picks the host that carries it, not the first result");
  check(t.pickHost("AirOps", ["app.airops.com", "airops.com"], "propaganda.pub") === "airops.com", "the company's site, not its app host");
  check(t.pickHost("Box", ["dropbox.com", "box.com"], "propaganda.pub") === "box.com", "the exact name wins over a host that merely contains it");
  check(t.pickHost("Acme", ["blog.acme.co.uk"], "propaganda.pub") === "acme.co.uk", "a country second-level domain keeps the company's label");
  check(t.pickHost("Acme Corp", ["uk.linkedin.com", "m.facebook.com", "app.acmecorp.io"], "propaganda.pub") === "acmecorp.io", "regional profile hosts are still profile sites; the fallback is the site, not the app host");
  check(t.pickHost("Acme Corp", ["instagram.com", "linkedin.com", "acme-tools.io"], "propaganda.pub") === "acme-tools.io", "profile sites never stand in for a company");
  check(t.pickHost("Propaganda", ["propaganda.pub", "instagram.com"], "propaganda.pub") === "", "our own domain and nothing else resolves to nothing");
  check(t.thinAnswers({ offer: "We sell content software", searches: "AI CMS", watch: "AirOps", upcoming: "Beta" }, true), "a 4-word offer is thin");
  check(t.thinAnswers(db.tenant_profile[0].answers, false), "capacity not answered is thin");
  check(!t.thinAnswers(db.tenant_profile[0].answers, true), "Kontra's answers are not");
  const draft = t.parseDraft(GOOD);
  const rules = { volumeCap: 22, hasHistory: false, readerWeeks: 0, keywords: kw(KEYWORDS) };
  check(t.validate(draft, rules).length === 0, `a good proposal passes (${t.validate(draft, rules).join(" | ")})`);
  const bad = t.parseDraft({
    ...GOOD,
    volume: r(40),
    readership: r(5000),
    topics: [{ name: "Batch job retries", low: 6, high: 9, why: "x", basis: "y" }, ...GOOD.topics.slice(1)],
    ranking: { ...GOOD.ranking, searches: [...GOOD.ranking.searches, { query: "workflow orchestration", topic: "Nope", why: "Big." }], pageOneTarget: r(5), aiMentionTarget: r(2) },
    watchedSites: [...GOOD.watchedSites, { url: `${WEB}/resources/whitepapers/ai-in-your-cms`, topic: "Reliability", why: "An article." }],
    questions: [],
  });
  const errs = t.validate(bad, { ...rules, seedSearches: ["batch job retries", "run scrapers at scale"], thinAnswers: true });
  for (const [frag, what] of [
    ["most allowed is 22", "volume over the cap"],
    ["Search \"workflow orchestration\"", "a search that isn't winnable"],
    ["not one of the topics", "a search in no topic"],
    ["at most 2 searches on page one", "page-one target too high for a new domain"],
    ["No AI-mention target", "an AI target in quarter one"],
    ["No Readership target", "a Readership target without data"],
    ["pasted back", "a topic that is a seed search"],
    ["one article, not a source", "a watched site that is an article"],
    ["ask at least one question", "no question on a thin brief"],
  ]) check(errs.some((e) => e.includes(frag)), `catches ${what}`);
  const head = { keyword: "ai assistant", vol: 301000, kd: 25 };
  const headDraft = t.parseDraft({ ...GOOD, ranking: { ...GOOD.ranking, searches: [...GOOD.ranking.searches.slice(1), { query: "ai assistant", topic: "Reliability", why: "Huge." }] } });
  check(t.validate(headDraft, { ...rules, keywords: kw([...KEYWORDS, head]) }).some((e) => e.includes("is a head term")), "catches a head term on a new domain");
  const rich = Array.from({ length: 20 }, (_, i) => ({ keyword: `long tail ${i}`, vol: 100 + i, kd: 10 }));
  check(t.validate(draft, { ...rules, keywords: kw([...KEYWORDS, ...rich]) }).some((e) => e.includes("at least 8 target searches")), "rich data wants 8 searches, 6 from the data");
  let threw = false;
  try { t.parseDraft({ summary: "x" }); } catch { threw = true; }
  check(threw, "a draft missing its parts doesn't parse");

  console.log("weekly check");
  const targets = { volume: { total: 18, topics: [{ name: "Reliability", low: 6, high: 9 }, { name: "Scraping at scale", low: 3, high: 5 }] } };
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2027-01-01T00:00:00Z");
  const behind = t.weeklyNotes(targets, { now: new Date("2026-11-02T06:00:00Z"), from, to, published: 4, publishedByTopic: { Reliability: 4 }, pageOneTrend: [] });
  check(behind.length === 1 && behind[0].goal === "volume" && behind[0].severity === "behind" && behind[0].action.kind === "pitch", `behind: one Volume note with a pitch action (${behind.map((n) => n.message).join(" | ")})`);
  const late = t.weeklyNotes(targets, { now: new Date("2026-11-23T06:00:00Z"), from, to, published: 2, publishedByTopic: { Reliability: 2 }, pageOneTrend: [3, 2, 1] });
  check(late[0]?.severity === "out_of_reach" && late[0].action.kind === "revise", "out of reach: Revise goals first");
  check(late.some((n) => n.goal === "topic" && n.message.startsWith("Scraping at scale")), "a topic with nothing past halfway");
  check(late.some((n) => n.goal === "ranking") && late.length <= 3, "page one going down two weeks running; at most 3 notes");
  check(t.weeklyNotes(targets, { now: new Date("2026-11-02T06:00:00Z"), from, to, published: 7, publishedByTopic: { Reliability: 4, "Scraping at scale": 3 }, pageOneTrend: [] }).length === 0, "on track: nothing");

  console.log("a run, end to end");
  db.strategy_proposals.push({ id: "proposal0000001", site: SITE, quarter: "2026-Q4", kind: "onboarding", status: "requested", request: "", requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  answers = [{ ...GOOD, volume: r(40) }, GOOD];
  const ids = await t.dispatchStrategist();
  check(ids[0] === "strategist-proposal0000001", "the poller starts one run per requested row");
  check((await t.dispatchStrategist())[0] === ids[0], "asking again starts the same run");
  const res = await t.DBOS.retrieveWorkflow(ids[0]).getResult();
  const row = db.strategy_proposals[0];
  check(res.status === "sent" && row.status === "sent" && row.sent_at, `sent (${JSON.stringify(res)}, ${row.error ?? ""})`);
  check(prompts.length === 2 && prompts[1].includes("most allowed is"), "a draft over the cap went back once with the error");
  check(prompts[0].includes("Durable batch jobs for platform teams") && prompts[0].includes("Focus on reliability first") && prompts[0].includes("Rejects listicles"), "the prompt carries the answers, the plan and the taste summary");
  check(prompts[0].includes("batch job retries: 320/month, difficulty 12") && prompts[0].includes("Volume cap: 22"), "and keyword data and the cap");
  const p = row.proposal;
  check(p.quarter === "2026-Q4" && p.covers.from && p.kind === "onboarding" && p.launch?.target === 15, "with its window and the Launch");
  check(p.watchedSites.length === 3 && !p.watchedSites.some((w) => w.url.includes("dead")), "the watched site that didn't answer was dropped");
  check(p.ranking.searches.find((s) => s.query === "batch job retries")?.volume === 320, "searches carry their volume");
  check(p.batches.value >= 1 && /Weekly/.test(p.batches.why), "and the batch count from the cadence");
  check(db.tenant_profile[0].plan_read_at, "the plan is marked read");
  check(db.model_calls.some((c) => c.job === "strategist") && db.model_calls.some((c) => String(c.model).startsWith("dataforseo/")), "model calls and DataForSEO are in the cost log");
  check(calls.some((u) => u.includes("keyword_ideas")) && calls.filter((u) => u.includes("serp/google")).length === 2, "it asked DataForSEO for keyword ideas and searched both of the tenant's searches");

  console.log("a run that keeps breaking the rules");
  db.strategy_proposals.push({ id: "proposal0000002", site: SITE, quarter: "2026-Q4", kind: "revision", status: "requested", request: "Make it bigger", requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  answers = [{ ...GOOD, volume: r(40) }, { ...GOOD, volume: r(41) }];
  const [id2] = await t.dispatchStrategist();
  const res2 = await t.DBOS.retrieveWorkflow(id2).getResult();
  const row2 = db.strategy_proposals[1];
  check(res2.status === "failed" && row2.status === "failed" && row2.error.includes("Broke the rules twice"), "fails instead of reaching the tenant");
  check(db.strategy_proposals[0].status === "sent", "and the earlier proposal stays");

  console.log("goals for the Pitcher and the weekly check");
  db.goal_versions.push({ site: SITE, quarter: "2026-Q4", version: 1, targets: { volume: { total: 18, topics: targets.volume.topics }, ranking: { searches: [{ query: "batch job retries" }], pageOneTarget: 2 } }, covers: { from: "2026-10-01", to: "2026-12-31", weeks: 13, prorated: false }, approved_at: "2026-10-09T00:00:00Z" });
  db.daily_facts.push({ site: SITE, day: "2026-11-01", kind: "ranking_search", value: { pageOne: 0, searches: [{ query: "batch job retries", position: 14 }] } });
  const g = await t.readGoals(SITE, new Date("2026-11-02T06:00:00Z"));
  check(g?.volume.total === 18 && g.searches[0].position === 14 && g.perWeek === 2, `the Pitcher reads the approved goals (${JSON.stringify(g?.searches)})`);
  db.posts.push({ id: "post00000000001", site: SITE, title: "One", status: "published", published_at: "2026-10-10T00:00:00Z" });
  db.briefs.push({ site: SITE, post: "post00000000001", topics: ["Reliability"] });
  const h = await t.DBOS.startWorkflow(t.strategistWeeklyCheck)(SITE, "2026-11-02");
  const n = await h.getResult();
  check(n === 1 && db.drift_notes[0]?.goal === "volume", `Monday's check writes a note (${db.drift_notes.map((x) => x.message).join(" | ")})`);
  await (await t.DBOS.startWorkflow(t.strategistWeeklyCheck, { workflowID: "again" })(SITE, "2026-11-02")).getResult();
  check(db.drift_notes.length === 1, "and the same note twice in a week is kept once");
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
