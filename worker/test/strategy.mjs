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
/** A tenant that never answered onboarding: nothing to plan from. */
const BLANK = "stratsite000002";
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
  sites: [
    { id: SITE, name: "Kontra", slug: "kontra", domain: "" },
    { id: BLANK, name: "Blank", slug: "blank", domain: "" },
  ],
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
    { site: BLANK, answers: { offer: "", searches: "", watch: "", upcoming: "" }, plan_text: "", plan_files: [], plan_read_at: null },
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
// Day one's first pitches have their own tests (first-day.mjs); here the tenant is Lite, so they skip.
process.env.WORKER_LITE_SITES = SITE;

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
/** The job vocabulary the stand-in model writes: two the ideas pull priced, one only Google Ads prices, one nobody does. */
const VOCAB = ["batch job retries", "retry failed cron job", "job queue backoff", "idempotent jobs", "dead letter queue retries", "exponential backoff cron"];
const months = (vol) => Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: 12 - i, search_volume: i < 6 ? vol * 1.5 : vol }));
/** An overview row with SERP info: page one's links, the AI overview, the intent and a year of months (peaks in December, up by half). */
const richItem = (k, links = 8) => ({
  ...labsItem(k),
  keyword_info: { search_volume: k.vol, monthly_searches: months(k.vol) },
  serp_info: { serp_item_types: ["organic", "ai_overview"] },
  avg_backlinks_info: { referring_main_domains: links },
  search_intent_info: { main_intent: "informational" },
});
const calls = [];
const realFetch = globalThis.fetch;
async function web(input, init) {
  const url = String(input);
  if (url.startsWith("https://api.dataforseo.com/")) {
    calls.push(url);
    if (url.includes("keyword_suggestions")) return Response.json({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: KEYWORDS.map(labsItem) }] }] });
    if (url.includes("related_keywords")) return Response.json({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [{ keyword_data: labsItem({ keyword: "ai image generator", vol: 500000, kd: 90 }) }] }] }] });
    if (url.includes("ranked_keywords")) return Response.json({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
    if (url.includes("keyword_overview")) {
      const task = JSON.parse(init.body)[0];
      const asked = task.keywords;
      const rows = KEYWORDS.filter((k) => asked.includes(k.keyword));
      if (asked.includes("cron job alerting")) rows.push({ keyword: "cron job alerting", vol: 140, kd: 9 });
      const priced = rows.map((k) => (task.include_serp_info ? richItem(k) : labsItem(k)));
      return Response.json({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{ items: priced }] }] });
    }
    if (url.includes("google_ads/search_volume")) {
      const asked = JSON.parse(init.body)[0].keywords;
      const rows = asked.includes("job queue backoff") ? [{ keyword: "job queue backoff", search_volume: 70, monthly_searches: months(70) }] : [];
      return Response.json({ status_code: 20000, cost: 0.05, tasks: [{ status_code: 20000, result: rows }] });
    }
    if (url.includes("serp_competitors")) {
      const items = [
        { domain: WEB.replace(/^https?:\/\//, ""), keywords_count: 3, avg_position: 4 },
        { domain: "www.youtube.com", keywords_count: 2, avg_position: 20.4 },
      ];
      return Response.json({ status_code: 20000, cost: 0.015, tasks: [{ status_code: 20000, result: [{ items }] }] });
    }
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
/** The job-vocabulary step's prompts, kept apart from the proposal's. */
const vocabPrompts = [];
let answers = [];
const usage = { inputTokens: { total: 4000, noCache: 4000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 800, text: 800, reasoning: 0 } };
const r = (value, why = "Because.", basis = "Your answers.") => ({ value, why, basis });
const GOOD = {
  profile: "Kontra sells durable batch jobs to platform teams. It grows through its docs and competes with Prefect and Dagster.",
  readersFind: "Page one for these searches is Prefect's docs and YouTube; a plain answer from a vendor that runs the jobs is missing.",
  summary: "Start steady: reliability first, two posts a week.",
  volume: r(18, "What your team can review.", "Your answer: 8 posts a month"),
  topics: [
    { name: "Reliability", thesis: "A batch job that retries on its own is worth more to a platform team than a faster one.", low: 6, high: 9, why: "What you sell.", basis: "Your website" },
    { name: "Scraping at scale", thesis: "Scrapers fail on volume long before they fail on parsing, and nobody plans for that.", low: 3, high: 5, why: "A search you named.", basis: "DataForSEO: 210/month" },
  ],
  ranking: {
    searches: ["batch job retries", "durable batch jobs", "retry failed cron job", "nightly etl failures", "run scrapers at scale", "cron job alerting", "job queue backoff"].map((q, i) => ({
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
    if (/never a target for its blog/.test(text)) {
      vocabPrompts.push(text);
      const vocab = { job: "platform engineers keeping batch jobs running", searches: VOCAB, notTargets: ["kontra login"] };
      return { content: [{ type: "text", text: JSON.stringify(vocab) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
    }
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
t.DBOS.setConfig({ name: "propaganda-strategist-test", systemDatabaseUrl: `${PGURL}/${SYS_DB}`, applicationVersion: "test", enablePatching: true });
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
  check(t.volumeCap({ weeks: 12, perMonth: 40, lastQuarterPublished: null }) === 110, "40 a month is 110: the cap is their number (2026-10-20)");
  check(t.volumeCap({ weeks: 12, perMonth: 40, lastQuarterPublished: null, firstQuarterLimit: true }) === 24, "a run recorded before keeps the 2-a-week line");
  check(t.volumeCap({ weeks: 13, perMonth: 8, lastQuarterPublished: 20 }) === 24, "with history: last quarter + 20%");
  check(t.winnable({ keyword: "x", volume: 50, difficulty: 29, position: null }), "easy and searched is winnable");
  check(!t.winnable({ keyword: "x", volume: 9900, difficulty: 78, position: null }), "hard is not");
  check(t.winnable({ keyword: "x", volume: 10, difficulty: 80, position: 14 }), "page two is");
  check(!t.winnable({ keyword: "ai assistant", volume: 301000, difficulty: 25, position: null }, { newDomain: true }), "a head term is not, for a new domain, whatever its difficulty");
  check(t.winnable({ keyword: "ai assistant", volume: 301000, difficulty: 25, position: null }), "but is with history");
  check(t.winnable({ keyword: "x", volume: null, difficulty: null, position: null }), "no data passes the winnable check");
  check(!t.winnable({ keyword: "smart snacks", volume: 1600, difficulty: 0, position: null, referringDomains: 48 }), "difficulty 0 with 48 linking sites on page one is not winnable");
  check(t.bucketOf({ keyword: "x", volume: 320, difficulty: 0, position: null, referringDomains: 3 }) === "now", "easy, searched and open page one is \"now\"");
  check(t.bucketOf({ keyword: "cep", volume: 18100, difficulty: 34, position: null, referringDomains: 49 }) === "later", "18,100 a month at difficulty 34 and 49 links is a must-win");
  check(t.bucketOf({ keyword: "usda foods", volume: 1600, difficulty: 47, position: null, referringDomains: 2993 }) === null, "page one with 2,993 links is no target at all");
  check(t.bucketOf({ keyword: "x", volume: 90, difficulty: 44, position: null, referringDomains: 60 }) === null, "too small for a must-win and too hard for now is no target");
  check(t.bucketOf({ keyword: "x", volume: null, difficulty: null, position: null }) === "nodata" && t.bucketOf(undefined) === "nodata", "no number is \"nodata\"");
  check(t.mustWin({ keyword: "school lunch", volume: 49500, difficulty: 46, position: null, referringDomains: 106 }), "difficulty at most 50 keeps a must-win even past 100 links");
  check(t.bucketNamed("Must win over time") === "later" && t.bucketNamed("no data") === "nodata" && t.bucketNamed("winnable now") === "now" && t.bucketNamed("") === undefined, "a bucket in the model's own words is read");
  check(t.looksLikeSource("https://www.airops.com/") && t.looksLikeSource("https://example.com/blog"), "a site or a blog index is a source");
  check(!t.looksLikeSource("https://buffer.com/resources/ai-social-media-content-creation/") && !t.looksLikeSource("https://x.com/a/b.pdf"), "an article or a file is not");
  check(t.MODELS.strategist === (process.env.AGENT_MODEL_STRATEGIST || "anthropic/claude-opus-5.5"), `the Strategist runs on Claude Opus 5.5 (${t.MODELS.strategist})`);
  check(t.MODELS.pitcher === (process.env.AGENT_MODEL_PITCHER || "anthropic/claude-sonnet-5.5"), `the first pitches run on Claude Sonnet 5.5 (${t.MODELS.pitcher})`);
  check(t.MODELS.writer === (process.env.AGENT_MODEL_WRITER || "alibaba/qwen3.7-plus"), `the Writer drafts on Qwen3.7 Plus (${t.MODELS.writer})`);
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
  const blank = { website: "", answers: { offer: "", searches: "", watch: "", upcoming: "" }, planText: "", planFiles: 0, published: 0 };
  check(t.emptyBrief(blank), "no website, blank answers, no plan and no posts is nothing to plan from");
  check(!t.emptyBrief({ ...blank, website: "propaganda.pub" }) && !t.emptyBrief({ ...blank, answers: { ...blank.answers, offer: "We sell content software" } }) && !t.emptyBrief({ ...blank, published: 3 }), "a website, one answer or posts is enough to plan from");
  check(t.effectiveKind("revision", { hasHistory: false, hasGoals: false }) === "onboarding", "a by-hand run for a tenant with no history and no goals is an onboarding run");
  check(t.effectiveKind("revision", { hasHistory: false, hasGoals: true }) === "revision" && t.effectiveKind("quarterly", { hasHistory: true, hasGoals: true }) === "quarterly", "with goals or history the asked kind stands");
  console.log("revision rounds");
  const REQUEST = "Answers to your questions:\n\n1. How many posts a month can your team review?\n2 a week, maybe 3 later.\n\n2. Should v2's launch get its own topic?\nYes, give it one.";
  const parsed = t.parseAnswers(REQUEST);
  check(parsed.length === 2 && parsed[0].question === "How many posts a month can your team review?" && parsed[1].answer === "Yes, give it one.", `the app's answers block parses (${JSON.stringify(parsed)})`);
  check(t.parseAnswers("Make it bigger").length === 0, "any other request parses to nothing");
  check(t.sameQuestion("How many posts a month can your team review?", "How many posts per month is your team able to review?"), "the same question, reworded, is the same");
  check(!t.sameQuestion("How many posts a month can your team review?", "Which competitor should we watch first?"), "a different question is not");
  check(t.perMonthFromAnswers(parsed) === 9, `"2 a week" is 9 a month (${t.perMonthFromAnswers(parsed)})`);
  check(t.perMonthFromAnswers([{ question: "How many posts a month can your team review?", answer: "About 8." }]) === 8, "a plain number is itself");
  check(t.perMonthFromAnswers([{ question: "Which competitor first?", answer: "Prefect, 2 of them" }]) === null, "a number in another answer is not capacity");
  const renamed = t.parseDraft({
    ...GOOD,
    topics: [{ ...GOOD.topics[0], name: "Reliability of batch jobs" }, { ...GOOD.topics[1], name: "Large-scale scraping" }],
    ranking: { ...GOOD.ranking, searches: GOOD.ranking.searches.map((s) => ({ ...s, topic: s.topic === "Reliability" ? "Reliability of batch jobs" : "Large-scale scraping" })) },
    watchedSites: GOOD.watchedSites.map((w) => ({ ...w, topic: w.topic === "Reliability" ? "Reliability of batch jobs" : "Large-scale scraping" })),
  });
  const kept = t.keepTopicNames(renamed, ["Reliability", "Scraping at scale"]);
  check(kept.topics.map((x) => x.name).join("|") === "Reliability|Scraping at scale", `reworded topics get their previous names back (${kept.topics.map((x) => x.name).join("|")})`);
  check(kept.ranking.searches.every((s) => ["Reliability", "Scraping at scale"].includes(s.topic)) && kept.watchedSites.every((w) => ["Reliability", "Scraping at scale"].includes(w.topic)), "and the searches and watched sites follow");
  const fresh = t.keepTopicNames(renamed, ["Pricing pages", "Hiring"]);
  check(fresh.topics[0].name === "Reliability of batch jobs", "a topic unlike any previous one keeps its new name");
  check(t.asksAboutTopics("Drop the scraping topic, add one on pricing") && !t.asksAboutTopics("Make it bigger"), "a request about the topics is recognised");
  check(!t.asksAboutTopics(REQUEST), "but a question echoed back in the answers block is not the tenant asking about topics");
  const draft = t.parseDraft(GOOD);
  const rules = { volumeCap: 22, hasHistory: false, readerWeeks: 0, keywords: kw(KEYWORDS) };

  console.log("names, theses and claims");
  const SITE_TEXT = "# Durable batch jobs for platform teams\nWriting the job is the easy part. The hard part is knowing it ran.\nEvery company is quietly losing a nightly job and doesn't know which.\nPricing | Docs | Blog";
  const sentences = t.siteSentences([SITE_TEXT]);
  check(sentences.includes("Writing the job is the easy part.") && sentences.includes("Durable batch jobs for platform teams") && !sentences.some((x) => /Pricing \|/.test(x)), `a site's text splits into its sentences and headings (${JSON.stringify(sentences)})`);
  check(t.siteSentences([SITE_TEXT, SITE_TEXT]).length === sentences.length, "repeated once however often the site repeats it");
  check(t.echoesSite("Writing the job is the easy part", sentences) && t.echoesSite("Writing the job is the easy part, knowing it ran is not", sentences), "a name or thesis that repeats a site sentence, trimmed or reworded, echoes it");
  check(!t.echoesSite("Scraping at scale", sentences) && !t.echoesSite("Scrapers fail on volume long before they fail on parsing", sentences), "a short label or a claim of its own does not");
  check(t.sameClaim({ name: "Retries", thesis: "A job that retries on its own beats a faster one." }, { name: "Self-healing jobs", thesis: "Jobs that retry on their own beat faster jobs." }) && !t.sameClaim(GOOD.topics[0], GOOD.topics[1]), "two topics saying one thing are the same claim; two different ones are not");
  const claims = { ...rules, thesis: true, siteSentences: sentences };
  check(t.validate(draft, claims).length === 0, `a good proposal with theses passes (${t.validate(draft, claims).join(" | ")})`);
  const noThesis = t.validate(t.parseDraft({ ...GOOD, topics: GOOD.topics.map(({ thesis, ...x }) => x) }), claims);
  check(noThesis.length === 2 && noThesis.every((e) => /has no thesis/.test(e)), `a topic without a thesis is sent back (${noThesis.join(" | ")})`);
  check(t.validate(draft, { ...rules, siteSentences: sentences }).length === 0, "and not on a run recorded before theses existed");
  const longName = "Anyone can make a machine write a post but the hard part is knowing what your company believes";
  const named = t.validate(t.parseDraft({ ...GOOD, topics: [{ ...GOOD.topics[0], name: longName }, GOOD.topics[1]], ranking: { ...GOOD.ranking, searches: GOOD.ranking.searches.map((x) => ({ ...x, topic: x.topic === "Reliability" ? longName : x.topic })) }, watchedSites: GOOD.watchedSites.map((w) => ({ ...w, topic: w.topic === "Reliability" ? longName : w.topic })) }), claims);
  check(named.some((e) => /label of 2 to 6 words/.test(e)) && t.parseDraft({ ...GOOD, topics: [{ ...GOOD.topics[0], name: longName }] }).topics[0].name === longName, `a long name is sent back whole, never cut (${named.join(" | ")})`);
  check(t.validate(t.parseDraft({ ...GOOD, topics: [{ ...GOOD.topics[0], name: longName }, GOOD.topics[1]], ranking: { ...GOOD.ranking, searches: GOOD.ranking.searches.map((x) => ({ ...x, topic: x.topic === "Reliability" ? longName : x.topic })) }, watchedSites: GOOD.watchedSites.map((w) => ({ ...w, topic: w.topic === "Reliability" ? longName : w.topic })) }), { ...claims, previousTopics: [longName] }).length === 0, "unless it is a name kept from the previous proposal");
  const slogan = t.validate(t.parseDraft({ ...GOOD, topics: [{ ...GOOD.topics[0], thesis: "Writing the job is the easy part; the hard part is knowing it ran." }, GOOD.topics[1]] }), claims);
  check(slogan.length === 1 && /repeats a sentence from their own site/.test(slogan[0]), `a thesis that is the site's slogan is sent back (${slogan.join(" | ")})`);
  const headline = { ...GOOD, topics: [{ ...GOOD.topics[0], name: "Writing the job is the easy part" }, GOOD.topics[1]], ranking: { ...GOOD.ranking, searches: GOOD.ranking.searches.map((x) => ({ ...x, topic: x.topic === "Reliability" ? "Writing the job is the easy part" : x.topic })) }, watchedSites: GOOD.watchedSites.map((w) => ({ ...w, topic: w.topic === "Reliability" ? "Writing the job is the easy part" : w.topic })) };
  check(t.validate(t.parseDraft(headline), claims).some((e) => /is a sentence from their own site/.test(e)), "a name that is a site headline is sent back on a run recorded before headline names");
  check(!t.validate(t.parseDraft(headline), { ...claims, headlineNames: true }).some((e) => /own site/.test(e)), "a name may borrow a site headline");
  const slogan2 = t.validate(t.parseDraft({ ...headline, topics: [{ ...headline.topics[0], thesis: "Writing the job is the easy part; the hard part is knowing it ran." }, headline.topics[1]] }), { ...claims, headlineNames: true });
  check(slogan2.some((e) => /thesis repeats a sentence from their own site/.test(e)), "but the thesis under it still may not");
  const twice = t.validate(t.parseDraft({ ...GOOD, topics: [GOOD.topics[0], { ...GOOD.topics[1], thesis: "A batch job that retries on its own is worth more than a faster batch job." }] }), claims);
  check(twice.length === 1 && /make the same claim/.test(twice[0]), `two topics with one claim are sent back (${twice.join(" | ")})`);
  const colon = t.validate(t.parseDraft({ ...GOOD, topics: [{ ...GOOD.topics[0], thesis: "Retries are the easy part: what a founder should ask before paying." }, GOOD.topics[1]] }), claims);
  check(colon.some((e) => /the thesis breaks the title rules/.test(e)), `a thesis is held to the title rules too (${colon.join(" | ")})`);

  console.log("one idea, one budget");
  const PRICE = ["Posts that outlive the price. Every post stops being true the day a price changes.", "Why AI blog tools get cancelled. A founder cancels a writer the first time a post states a wrong price.", "Your calls hold the posts. A fumbled answer on a sales call is a post nobody has written.", "ChatGPT describes you from old pricing pages. A founder who never checked is described by stale prices."];
  const lean = t.sharedIdeas(PRICE, { max: 1, own: ["AI blog", "AI CMS"] });
  check(lean.length === 1 && lean[0].idea === t.ideaRoot("price") && lean[0].items.length === 3, `price, prices and pricing are one idea, carried by three of four topics (${JSON.stringify(lean.map((m) => [m.word, m.items.length]))})`);
  check(t.sharedIdeas(PRICE, { max: 1, own: ["AI blog", "price"] }).length === 0, "the tenant's own subject is never flagged");
  check(t.overusedIdeas(PRICE.slice(0, 5)).length === 0 && t.overusedIdeas([...PRICE, "Posts that outlive the price", "Prices change on Tuesday", "Retries are cheap"]).some((m) => m.idea === t.ideaRoot("price")), "a pipeline is judged from six titles on, then one idea in more than a quarter of them is flagged");
  const PLAIN = ["Buying content help without a team. A company without a marketer gets more from a tool that checks posts against what the company has said than from one that writes faster.", "Sales calls as the source of posts. A founder gives the best answer to a buyer's question dozens of times a month on calls, and that answer is almost never written down.", "Posts that outlive the facts. At a company under 200 people nobody owns the old posts, so after a change the blog and the deck describe different products.", "What ChatGPT says about small companies. An AI answer describes a small company from the handful of pages it can find, so whatever those pages agree on becomes its description."];
  check(t.sharedIdeas(PLAIN, { max: 2 }).length === 0, "ordinary wording shares function words without tripping the rule");
  const three = (a, b, c) => t.parseDraft({ ...GOOD, topics: [{ ...GOOD.topics[0], thesis: a }, { ...GOOD.topics[1], thesis: b }, { ...GOOD.topics[1], name: "Hiring slowdowns", low: 2, high: 3, thesis: c }] });
  const motif = (d, flags, prev = []) => t.validate(d, { ...claims, ...flags, previousTopics: prev }).filter((e) => /runs through/.test(e));
  const loud = three("A platform team loses a night to a failed scraper before anyone notices.", "A scraper fails on volume long before it fails on parsing, and nobody plans for that.", "Hiring slows down the week a scraper breaks and nobody owns it.");
  const calm = three("A batch job that retries on its own is worth more than a faster one.", "Volume breaks collection long before parsing, and nobody plans for that.", "Hiring slows down the week something breaks and nobody owns it.");
  check(motif(loud, { motifs: true }).length === 1 && /"scraper" runs through 3 topics/.test(motif(loud, { motifs: true })[0]), `one idea in all three topics is sent back (${motif(loud, { motifs: true }).join(" | ")})`);
  check(motif(calm, { motifs: true }).length === 0, "three topics about different things pass");
  check(motif(loud, {}).length === 0, "and the rule is off on a run recorded before it");
  check(motif(loud, { motifs: true }, ["Reliability", "Scraping at scale", "Hiring slowdowns"]).length === 0, "and never aimed at names kept from the previous proposal");

  console.log("search seeds and the keyword pull");
  check(t.searchSeeds(["I don't know what searches I want to be found by. It has to be something about AI content publishing", "AI CMS", "AI blogging and social posting... you tell me", "ai cms"]).join("|") === "AI CMS", `a sentence typed as a search is no seed; a phrase is, once (${JSON.stringify(t.searchSeeds(["I don't know what searches I want to be found by", "AI CMS", "ai cms"]))})`);
  const pulled = [
    { keyword: "ai", volume: 5000000 },
    { keyword: "character ai", volume: 2000000 },
    { keyword: "headless ai cms", volume: 90 },
    { keyword: "ai cms", volume: 320 },
    { keyword: "AI CMS", volume: 320 },
    { keyword: "content marketing automation", volume: 1900 },
    { keyword: "best cms for blogs", volume: 2400 },
  ];
  const keptRows = t.relevantKeywords(pulled, ["AI CMS"], "An AI content platform that writes and publishes a company's blog.", 100).map((k) => k.keyword);
  check(keptRows.join("|") === "ai cms|headless ai cms|best cms for blogs", `rows made of the seed's words, or one of them and a word from the offer, stay; seed words first, then volume, once each; "character ai" and "content marketing automation" go (${keptRows.join("|")})`);
  check(t.relevantKeywords(pulled, ["AI CMS"], "", 2).length === 2, "and the limit holds");
  const reask = t.validate(draft, { ...rules, answered: parsed });
  check(reask.length === 1 && reask[0].includes("You already asked") && reask[0].includes("Yes, give it one."), `a question they already answered is an error (${reask.join(" | ")})`);
  const allNew = t.validate(t.parseDraft({ ...GOOD, questions: [] }), { ...rules, previousTopics: ["Pricing pages", "Hiring"], requestAboutTopics: false });
  check(allNew.length === 1 && allNew[0].includes("You renamed every topic"), `renaming every topic unasked is an error (${allNew.join(" | ")})`);
  check(t.validate(t.parseDraft({ ...GOOD, questions: [] }), { ...rules, previousTopics: ["Pricing pages", "Hiring"], requestAboutTopics: true }).length === 0, "unless they asked about the topics");
  check(t.validate(t.parseDraft({ ...GOOD, questions: [] }), { ...rules, previousTopics: ["Reliability", "Hiring"], requestAboutTopics: false }).length === 0, "keeping one is enough");

  console.log("the validator");
  check(t.validate(draft, rules).length === 0, `a good proposal passes (${t.validate(draft, rules).join(" | ")})`);
  const bad = t.parseDraft({
    ...GOOD,
    volume: r(40),
    readership: r(5000),
    topics: [{ name: "Batch job retries", low: 6, high: 9, why: "x", basis: "y" }, { name: "Retries are the easy part: what a founder should ask before paying", low: 1, high: 2, why: "x", basis: "y" }, ...GOOD.topics.slice(1)],
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
    ["title rules (two-part)", "a two-part topic name"],
    ["one article, not a source", "a watched site that is an article"],
    ["ask at least one question", "no question on a thin brief"],
  ]) check(errs.some((e) => e.includes(frag)), `catches ${what}`);
  const head = { keyword: "ai assistant", vol: 301000, kd: 25 };
  const headDraft = t.parseDraft({ ...GOOD, ranking: { ...GOOD.ranking, searches: [...GOOD.ranking.searches.slice(1), { query: "ai assistant", topic: "Reliability", why: "Huge." }] } });
  check(t.validate(headDraft, { ...rules, keywords: kw([...KEYWORDS, head]) }).some((e) => e.includes("is a head term")), "catches a head term on a new domain");
  const rich = Array.from({ length: 20 }, (_, i) => ({ keyword: `long tail ${i}`, vol: 100 + i, kd: 10 }));
  check(t.validate(draft, { ...rules, keywords: kw([...KEYWORDS, ...rich]) }).some((e) => e.includes("at least 8 target searches")), "rich data wants 8 searches, 6 from the data");

  console.log("searches first (2026-10-20)");
  const JOB = [
    ...KEYWORDS.slice(0, 5).map((k) => ({ ...k, links: 6 })),
    { keyword: "community eligibility provision", vol: 18100, kd: 34, links: 49 },
    { keyword: "school lunch", vol: 49500, kd: 46, links: 106 },
    { keyword: "menus for schools", vol: 12100, kd: 52, links: 82 },
    { keyword: "smart snacks", vol: 1600, kd: 0, links: 48 },
    { keyword: "usda foods", vol: 1600, kd: 47, links: 2993 },
    { keyword: "cron job alerting", vol: 140, kd: 9, links: 2 },
    { keyword: "job queue backoff", vol: 70, kd: null, links: null },
  ];
  const kwJob = (list) => new Map(list.map((k) => [k.keyword, { keyword: k.keyword, volume: k.vol, difficulty: k.kd, position: k.pos ?? null, referringDomains: k.links ?? null, aiOverview: k.keyword !== "usda foods" }]));
  const firstRules = { ...rules, keywords: kwJob(JOB), searchesFirst: true, notTargets: ["kontra login", "audubon elementary lunch menu"], whoRanks: ["fns.usda.gov", "education.mn.gov", "schoolnutrition.org"] };
  const sf = (patch) => t.validate(t.parseDraft({ ...GOOD, ...patch }), firstRules);
  const errs1 = sf({});
  check(errs1.some((e) => /Give \d+ to 20 target searches/.test(e)), `7 searches is too few when the data holds more (${errs1.find((e) => /target searches/.test(e))})`);
  check(errs1.some((e) => /searches the business has to own over time/.test(e)), "and the must-win bucket is required when the data has candidates");
  check(errs1.some((e) => /among those that rank for the reader's searches/.test(e)), "and watched sites must come from who ranks");
  const topicsOf = (n) => Array.from({ length: n }, (_, i) => ({ name: `Topic number ${i + 1}`, thesis: `Claim ${i + 1} about the buyer's week that posts can show.`, low: 1, high: 2, why: "x", basis: "y" }));
  check(sf({ topics: topicsOf(8) }).every((e) => !/Give 1 to/.test(e)) && sf({ topics: topicsOf(9) }).some((e) => /Give 1 to 8 topics/.test(e)), "up to 8 topics");
  check(sf({ profile: "" }).some((e) => /profile is missing/.test(e)), "a profile paragraph is required");
  const searchesOf = (list) => list.map(([query, bucket]) => ({ query, topic: "Reliability", bucket, why: "x" }));
  const full = searchesOf([
    ["batch job retries", "now"], ["durable batch jobs", "now"], ["retry failed cron job", "now"], ["nightly etl failures", "now"], ["run scrapers at scale", "now"], ["cron job alerting", "now"], ["job queue backoff", "now"],
    ["community eligibility provision", "later"], ["school lunch", "later"], ["menus for schools", "later"],
    ["idempotent jobs", "nodata"],
  ]);
  const okSites = [{ url: "https://www.fns.usda.gov/", topic: "Reliability", why: "USDA." }, { url: "https://education.mn.gov/", topic: "Reliability", why: "State agency." }, { url: "https://schoolnutrition.org/", topic: "Reliability", why: "SNA." }];
  const good1 = sf({ ranking: { ...GOOD.ranking, searches: full, aiMentionTarget: r(2) }, watchedSites: okSites });
  check(good1.length === 0, `11 searches in three buckets, an AI target and watched sites from who ranks pass (${good1.join(" | ")})`);
  const smart = sf({ ranking: { ...GOOD.ranking, searches: [...full, ...searchesOf([["smart snacks", "now"]])], aiMentionTarget: r(2) }, watchedSites: okSites });
  check(smart.some((e) => /"smart snacks" is not winnable this quarter/.test(e) && /fits "later"/.test(e)), "difficulty 0 with 48 links on page one is sent back as a must-win, not a now");
  const usda = sf({ ranking: { ...GOOD.ranking, searches: [...full, ...searchesOf([["usda foods", "later"]])], aiMentionTarget: r(2) }, watchedSites: okSites });
  check(usda.some((e) => /"usda foods" is not a must-win/.test(e)), "2,993 links on page one is no must-win");
  const brand = sf({ ranking: { ...GOOD.ranking, searches: [...full, ...searchesOf([["audubon elementary lunch menu", "now"]])], aiMentionTarget: r(2) }, watchedSites: okSites });
  check(brand.some((e) => /page it hosts for a customer/.test(e)), "a hosted customer page is never a target");
  const noData = sf({ ranking: { ...GOOD.ranking, searches: [...full, ...searchesOf([["nobody searches this", "nodata"], ["nor this", "nodata"], ["nor that", "nodata"]])], aiMentionTarget: r(2) }, watchedSites: okSites });
  check(noData.some((e) => /4 searches have no data; at most 3/.test(e)), "at most 3 with no data");
  const ai = sf({ ranking: { ...GOOD.ranking, searches: full, aiMentionTarget: r(5) }, watchedSites: okSites });
  check(ai.some((e) => /ranking.aiMentionTarget is 5/.test(e)) && sf({ ranking: { ...GOOD.ranking, searches: full, aiMentionTarget: r(null) }, watchedSites: okSites }).length === 0, "an AI target is allowed in a first quarter, up to 3 of the searches with an overview");
  const inferred = t.finish(t.parseDraft({ ...GOOD, ranking: { ...GOOD.ranking, searches: full.map(({ bucket, ...x }) => x) } }), { kind: "onboarding", window: t.windowFor("onboarding", new Date("2026-10-20T12:00:00Z")), cadence: "weekly", launch: null, keywords: kwJob(JOB), searchesFirst: true });
  check(inferred.ranking.searches.find((x) => x.query === "school lunch")?.bucket === "later" && inferred.ranking.searches.find((x) => x.query === "idempotent jobs")?.bucket === "nodata" && inferred.ranking.searches.find((x) => x.query === "batch job retries")?.referringDomains === 6, `finish() fills the bucket from the data when the model wrote none, and carries page one's links (${JSON.stringify(inferred.ranking.searches[0])})`);
  check(!("volume" in inferred.ranking.searches.find((x) => x.query === "idempotent jobs")), "and no volume at all for a search without a number, never 0");
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
  // The cap follows the weeks left in the quarter, so it depends on today's date.
  const weeks = Number(/\((\d+) weeks\)/.exec(prompts[0])?.[1]);
  const cap = t.volumeCap({ weeks, perMonth: 8, lastQuarterPublished: null });
  check(prompts[0].includes("batch job retries: 320/month, difficulty 12") && prompts[0].includes(`Volume cap: ${cap} posts`), `and keyword data and the cap (${weeks} weeks, cap ${cap})`);
  const p = row.proposal;
  check(p.quarter === "2026-Q4" && p.covers.from && p.kind === "onboarding" && p.launch?.target === 15, "with its window and the Launch");
  check(p.watchedSites.length === 3 && !p.watchedSites.some((w) => w.url.includes("dead")), "the watched site that didn't answer was dropped");
  check(p.ranking.searches.find((s) => s.query === "batch job retries")?.volume === 320, "searches carry their volume");
  // Two: "cron job alerting" (never in any pull) and "nightly etl failures" (dropped by the relevance filter, so looked up).
  check(row.inputs?.pricedSearches === 2, `the inputs count the priced searches (${JSON.stringify(row.inputs)})`);
  check(calls.filter((u) => u.includes("keyword_overview")).length === 2, `two overview calls (the job vocabulary, then the proposed search), and none for the fix draft since nothing new was proposed (${calls.filter((u) => u.includes("keyword_overview")).length})`);
  check(vocabPrompts.length === 1 && vocabPrompts[0].includes("Durable batch jobs") && prompts[0].includes("job queue backoff: 70/month") && prompts[0].includes("idempotent jobs: no data") && prompts[0].includes("batch job retries: 320/month, difficulty 12, page one averages 8 referring domains, 6-month trend +50%, peaks in Dec, intent informational, AI overview yes"), `the job vocabulary was asked once, priced wide (Ads for what Labs lacks, no data kept as no data) and put in the prompt with page one's links and the season (${prompts[0].split("\n").filter((l) => /job queue|idempotent|batch job retries: 320/.test(l)).join(" | ")})`);
  check(prompts[0].includes("Who ranks in Google's top 100 across the 3 biggest") && prompts[0].includes("youtube.com (video)") && prompts[0].includes("Never targets") && prompts[0].includes("kontra login"), "and who ranks across them, by kind, and the never-targets");
  check(p.ranking.searches.every((s) => s.bucket === "now") && p.ranking.searches.find((s) => s.query === "job queue backoff")?.volume === 70 && row.inputs?.jobSearches === 6 && row.inputs?.jobSearchesPriced === 3 && row.inputs?.whoRanks === 2, `the sent proposal carries each search's bucket and the inputs count the job searches (${JSON.stringify({ buckets: p.ranking.searches.map((s) => s.bucket), inputs: row.inputs })})`);
  check(p.profile === GOOD.profile && p.readersFind === GOOD.readersFind, "and the profile and readers-find paragraphs");
  if (process.env.STRATEGY_DUMP) (await import("node:fs")).writeFileSync(process.env.STRATEGY_DUMP, `${vocabPrompts[0]}\n\n=====\n\n${prompts[0]}`);
  check(p.ranking.searches.find((s) => s.query === "cron job alerting")?.volume === 140, `a search the data never listed was priced before the check and carries its numbers (${JSON.stringify(p.ranking.searches.find((s) => s.query === "cron job alerting"))}, priced ${row.inputs?.pricedSearches}, overview calls ${calls.filter((u) => u.includes("keyword_overview")).length})`);
  check(p.batches.value >= 1 && /Weekly/.test(p.batches.why), "and the batch count from the cadence");
  check(db.tenant_profile[0].plan_read_at, "the plan is marked read");
  check(db.model_calls.some((c) => c.job === "strategist") && db.model_calls.some((c) => String(c.model).startsWith("dataforseo/")), "model calls and DataForSEO are in the cost log");
  check(calls.filter((u) => u.includes("keyword_suggestions")).length === 2 && calls.filter((u) => u.includes("related_keywords")).length === 2 && calls.filter((u) => u.includes("serp/google")).length === 2, `it asked DataForSEO for suggestions and related searches per seed and searched both of the tenant's searches (${calls.filter((u) => u.includes("dataforseo_labs")).length} labs calls)`);
  check(row.inputs?.keywords === 4 && !prompts[0].includes("ai image generator"), `the keyword list kept the rows that share a word with a seed or the offer and dropped the rest (${row.inputs?.keywords} kept)`);
  const stepNames = ((await t.DBOS.listWorkflowSteps(ids[0])) ?? []).map((s) => s.name);
  check(stepNames.includes("keyword data") && stepNames.indexOf("job searches") > stepNames.indexOf("keyword data") && stepNames.indexOf("who ranks") > stepNames.indexOf("job searches"), `keyword data, then the job searches, then who ranks, as steps (${stepNames.join(", ")})`);
  const first = await t.DBOS.retrieveWorkflow(t.firstPitchesId("proposal0000001")).getResult();
  check(/Lite/.test(first?.skipped ?? ""), `sending started the first pitches (a Lite tenant here, so none: ${first?.skipped})`);

  console.log("a run that keeps breaking the rules");
  db.strategy_proposals.push({ id: "proposal0000002", site: SITE, quarter: "2026-Q4", kind: "revision", status: "requested", request: "Make it bigger", requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  answers = [{ ...GOOD, volume: r(40) }, { ...GOOD, volume: r(41) }];
  const [id2] = await t.dispatchStrategist();
  const res2 = await t.DBOS.retrieveWorkflow(id2).getResult();
  const row2 = db.strategy_proposals[1];
  check(res2.status === "failed" && row2.status === "failed" && row2.error.includes("Broke the rules twice"), "fails instead of reaching the tenant");
  check(db.strategy_proposals[0].status === "sent", "and the earlier proposal stays");
  check(prompts[2].includes("-post Launch runs first"), "a by-hand run for a tenant with no goals yet still plans the Launch");

  console.log("a run with nothing to plan from");
  db.strategy_proposals.push({ id: "proposal0000003", site: BLANK, quarter: "2026-Q4", kind: "revision", status: "requested", request: "Run by hand from the Goals page.", requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  const before = prompts.length;
  const [id3] = await t.dispatchStrategist();
  const res3 = await t.DBOS.retrieveWorkflow(id3).getResult();
  const row3 = db.strategy_proposals[2];
  check(res3.status === "failed" && row3.status === "failed" && row3.error.startsWith("Nothing to plan from yet"), `stops and says what to answer first (${row3.error})`);
  check(prompts.length === before, "without asking the model");

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

  console.log("a revision round, end to end");
  db.strategy_proposals.push({ id: "proposal0000004", site: SITE, quarter: "2026-Q4", kind: "revision", status: "requested", request: REQUEST, requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  const reworded = { ...renamed, volume: r(18), ranking: { ...renamed.ranking, pageOneTarget: r(2), aiMentionTarget: r(null) }, readership: r(null) };
  answers = [{ ...reworded, questions: ["Roughly how many posts per month can your team review?"] }, { ...reworded, questions: [] }];
  const before4 = prompts.length;
  const [id4] = await t.dispatchStrategist();
  const res4 = await t.DBOS.retrieveWorkflow(id4).getResult();
  const row4 = db.strategy_proposals.find((x) => x.id === "proposal0000004");
  check(res4.status === "sent" && row4.status === "sent", `sent (${JSON.stringify(res4)}, ${row4.error ?? ""})`);
  const p4 = prompts[before4] ?? "";
  check(p4.includes("Your previous proposal this quarter") && p4.includes('"Reliability" (6 to 9)') && p4.includes('"Scraping at scale" (3 to 5)'), "the prompt carries the previous proposal's topics by name");
  check(p4.includes("Questions you asked in earlier rounds") && p4.includes("A: Yes, give it one."), "and the earlier questions with their answers");
  check(prompts.length === before4 + 2 && prompts[before4 + 1].includes("You already asked"), `a re-asked question went back once with the error (${prompts.length - before4} prompts)`);
  check(row4.proposal.topics.map((x) => x.name).join("|") === "Reliability|Scraping at scale", `the sent proposal keeps the previous topic names (${row4.proposal.topics.map((x) => x.name).join("|")})`);
  check(row4.proposal.ranking.searches.every((s) => ["Reliability", "Scraping at scale"].includes(s.topic)) && row4.proposal.watchedSites.every((w) => ["Reliability", "Scraping at scale"].includes(w.topic)), "with its searches and watched sites on those names");
  check(row4.proposal.questions.length === 0 && db.strategy_proposals[0].status === "superseded", "no question left, and the earlier proposal is superseded");

  console.log("the revision limit");
  const LIMITED = "limitedsite0000";
  for (let i = 0; i < t.MAX_PLAN_ROUNDS; i++) {
    db.strategy_proposals.push({ id: `limited${String(i).padStart(8, "0")}`, site: LIMITED, quarter: "2026-Q4", kind: i ? "revision" : "onboarding", status: "superseded", request: "", requested_by: "u1", proposal: null, edits: null, created: new Date(Date.now() - 1000 * (20 - i)).toISOString(), approved_at: null });
  }
  db.strategy_proposals.push({ id: "limitedlast0000", site: LIMITED, quarter: "2026-Q4", kind: "revision", status: "requested", request: "once more", requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  const beforeLimit = prompts.length;
  const [idLimit] = await t.dispatchStrategist();
  const resLimit = await t.DBOS.retrieveWorkflow(idLimit).getResult();
  const rowLimit = db.strategy_proposals.find((x) => x.id === "limitedlast0000");
  check(resLimit.status === "failed" && rowLimit.status === "failed" && rowLimit.error === t.ROUND_LIMIT_ERROR, `a revision past the limit stops with the limit's own message (${JSON.stringify(resLimit)})`);
  check(prompts.length === beforeLimit, "before any model call");
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
