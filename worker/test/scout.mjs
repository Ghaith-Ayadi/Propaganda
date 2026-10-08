// The Scout end to end, in this process, against a real Postgres: the app's
// migrations plus worker/sql/scout.draft.sql, DBOS in its own database, and
// local stand-ins for DataForSEO, the cost log's REST API, a watched page and
// the model. Run through test/run.sh.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import pg from "pg";
import { MockLanguageModelV3 } from "ai/test";

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";
const APP = "worker_test_scout_app";
const SYS = "worker_test_scout_dbos";
const SITE = "kontrasite00000";
const ROOT = new URL("../..", import.meta.url).pathname;

let failures = 0;
function check(cond, what) {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => handler(req, res, body));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;
const json = (res, v, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(v));
};

// ---- the database ----

const admin = new pg.Client({ connectionString: `${PGURL}/postgres` });
await admin.connect();
for (const db of [APP, SYS]) {
  await admin.query(`drop database if exists ${db} with (force)`);
}
await admin.query(`create database ${APP}`);
await admin.end();

const app = new pg.Client({ connectionString: `${PGURL}/${APP}` });
await app.connect();
const sql = (f) => readFileSync(f, "utf8");
await app.query(sql(new URL("./sql-shim.sql", import.meta.url)));
for (const f of readdirSync(`${ROOT}supabase/migrations`).sort()) {
  await app.query(sql(`${ROOT}supabase/migrations/${f}`));
}
await app.query(sql(`${ROOT}worker/sql/scout.draft.sql`));
await app.query("insert into public.sites (id, name, slug, domain) values ($1, 'Kontra', 'kontra', 'blog.kontra.run')", [SITE]);

// ---- stand-ins ----

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " +00:00");
const task = (items) => ({ status_code: 20000, status_message: "Ok.", cost: 0.002, tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.002, result: [{ items }] }] });
const organic = (rank, domain, path, title) => ({ type: "organic", rank_group: rank, domain, url: `https://${domain}${path}`, title, description: `About ${title}` });

const seo = [];
const dataforseo = await listen((req, res, body) => {
  const [t] = JSON.parse(body);
  seo.push({ path: req.url, ...t });
  if (req.headers.authorization !== `Basic ${Buffer.from("login:pw").toString("base64")}`) return json(res, { status_code: 40100, status_message: "auth" }, 401);
  if (req.url === "/v3/serp/google/organic/live/advanced") {
    if (t.keyword === "fleet scraping framework")
      return json(res, task([organic(1, "scrapy.org", "/", "Scrapy"), organic(4, "blog.kontra.run", "/fleet", "Kontra fleet"), organic(2, "apify.com", "/", "Apify")]));
    if (t.keyword === "durable crawling")
      return json(res, task([organic(1, "temporal.io", "/crawl", "Durable crawls"), organic(2, "dbos.dev", "/c", "DBOS crawls")]));
    if (t.keyword.endsWith(" reddit"))
      return json(res, task([organic(1, "www.reddit.com", "/r/webscraping/comments/abc/how_do_you_scale/", "How do you scale scrapers?"), organic(2, "example.com", "/r", "Not reddit")]));
    return json(res, task([]));
  }
  if (req.url === "/v3/serp/google/news/live/advanced") {
    return json(res, task([
      { type: "news_search", rank_group: 1, domain: "news.example", url: `https://news.example/${t.keyword.replace(/\W+/g, "-")}/ruling`, title: `Court rules on ${t.keyword}`, snippet: "A ruling.", timestamp: iso(now - 3600_000) },
      { type: "news_search", rank_group: 2, domain: "old.example", url: "https://old.example/story", title: "Old story about it", snippet: "Old.", timestamp: iso(now - 30 * 86_400_000) },
    ]));
  }
  if (req.url === "/v3/ai_optimization/llm_mentions/search_mentions/live") {
    if (t.platform === "google") return json(res, task([{ question: "what is the best framework for fleet scraping?", sources: [{ domain: "kontra.run" }], ai_search_volume: 90 }]));
    return json(res, task([]));
  }
  json(res, { status_code: 40400, status_message: "not found" }, 404);
});

const calls = [];
const stored = new Map(); // agent_ideas, by id
const rest = await listen((req, res, body) => {
  if (req.url.startsWith("/rest/v1/agent_ideas")) {
    if (req.method === "POST") {
      const row = { ...JSON.parse(body), created: new Date().toISOString() };
      stored.set(row.id, row);
      return json(res, [row], 201);
    }
    const id = /id=eq\.([a-z0-9]+)/.exec(req.url)?.[1];
    return json(res, id && stored.has(id) ? [stored.get(id)] : []);
  }
  if (req.url.startsWith("/rest/v1/rpc/cost_gate"))
    return json(res, { tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false });
  if (req.url.startsWith("/rest/v1/model_prices")) return json(res, []);
  if (req.url.startsWith("/rest/v1/model_calls")) {
    calls.push(JSON.parse(body));
    return json(res, [], 201);
  }
  json(res, {}, 404);
});

let pageVersion = 1;
const pages = await listen((req, res) => {
  const links = [
    '<a href="/news/2026/school-meals-guidance">Updated guidance on school meal standards</a>',
    '<a href="/about">About</a>',
    '<nav><a href="/menu-item-that-is-long-enough">This menu link is long enough but in nav</a></nav>',
  ];
  if (pageVersion > 1) links.unshift('<a href="https://other.example/rule?x=1&amp;y=2#top">Proposed rule on sodium limits, comments open</a>');
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<html><body><script>var a = '<a href="/x">not a link at all in a script</a>';</script>${links.join("\n")}</body></html>`);
});
await app.query(
  "insert into public.watched_sites (site, url, topic, why) values ($1, $2, 'Regulation', 'The regulator posts rule changes here')",
  [SITE, `${urlOf(pages)}/news`],
);
await app.query(
  `insert into public.scout_searches (site, quarter, query, prompt, topic) values
     ($1, '2026-Q4', 'fleet scraping framework', 'What is the best framework for fleet scraping?', 'Scraping at scale'),
     ($1, '2026-Q4', 'durable crawling', '', 'Durable workflows'),
     ($1, '2026-Q3', 'last quarter search', '', 'Old')`,
  [SITE],
);

let prompts = [];
let reply = null;
const model = new MockLanguageModelV3({
  doGenerate: async ({ prompt }) => {
    const text = prompt.map((m) => (Array.isArray(m.content) ? m.content.map((c) => c.text ?? "").join("") : m.content)).join("\n");
    prompts.push(text);
    return {
      content: [{ type: "text", text: reply(text) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 1200, noCache: 1200, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 300, text: 300, reasoning: 0 } },
      warnings: [],
    };
  },
});

// ---- the worker's modules, configured for all of the above ----

Object.assign(process.env, {
  APP_DATABASE_URL: `${PGURL}/${APP}`,
  DBOS_SYSTEM_DATABASE_URL: `${PGURL}/${SYS}`,
  DATAFORSEO_URL: urlOf(dataforseo),
  DATAFORSEO_LOGIN: "login",
  DATAFORSEO_PASSWORD: "pw",
  SUPABASE_URL: urlOf(rest),
  SUPABASE_SERVICE_ROLE_KEY: "test",
  SCOUT_ALLOW_PRIVATE_FETCH: "1",
});
const ideasOf = (origin) => [...stored.values()].filter((i) => i.site === SITE && (!origin || i.origin === origin));
const kit = await import("../dist/testkit.js");
const { DBOS } = await import("@dbos-inc/dbos-sdk");
kit.setModelResolver(() => model);
kit.setWorkflowContext(() => ({ workflowId: DBOS.workflowID ?? null, stepId: DBOS.stepID ?? null }));
DBOS.setConfig({ name: "propaganda-scout-test", systemDatabaseUrl: `${PGURL}/${SYS}`, applicationVersion: "test" });
await DBOS.launch();
await kit.registerQueues();

// ---- the pure parts ----

console.log("pure parts");
check(kit.quarterOf("2026-10-08") === "2026-Q4" && kit.quarterOf("2027-03-31") === "2027-Q1", "quarters");
const domains = kit.domainsOf("kontra", "blog.kontra.run");
check(domains.join() === "kontra.propaganda.pub,blog.kontra.run,kontra.run", "a blog subdomain counts the company's domain too");
check(kit.domainsOf("x", "shop.example.co.uk").join() === "x.propaganda.pub,shop.example.co.uk", "but not a public suffix");
check(kit.isOurs(domains, "www.kontra.run") && !kit.isOurs(domains, "notkontra.run"), "domain matching");
check(kit.sameQuestion("What is the best framework for fleet scraping?", "what framework for fleet scraping do people use") &&
  !kit.sameQuestion("durable crawling", "best pizza in naples"), "AI prompt matching");
check(["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"].every(kit.privateAddress) &&
  !kit.privateAddress("8.8.8.8") && !kit.privateAddress("2606:4700::1111"), "private addresses refused");
const links = kit.extractLinks('<a href="/a">A headline long enough to keep</a><a href="/a#x">A headline long enough to keep</a><a href="javascript:x">Some javascript link text here</a>', "https://site.example/news/");
check(links.length === 1 && links[0].url === "https://site.example/a", "links: absolute, one per address, web only");
check(kit.newLinks(null, links).length === 0, "the first check is a baseline");

process.env.SCOUT_ALLOW_PRIVATE_FETCH = "0";
await assert.rejects(kit.fetchPage(`${urlOf(pages)}/news`), /not a public address/);
check(true, "the worker won't fetch an internal address");
process.env.SCOUT_ALLOW_PRIVATE_FETCH = "1";

const ideas = kit.parseIdeas(
  '```json\n{"ideas":[{"title":"A","why":"w","topic":"Nope","items":[2,99]},{"title":"B","items":[2]},{"title":"","items":[1]}]}\n```',
  { tenant: "K", topics: ["T"], searches: [], day: "2026-10-08", candidates: [
    { kind: "news", url: "https://a", title: "a", snippet: "", topic: "T", published: null },
    { kind: "reddit", url: "https://b", title: "b", snippet: "", topic: "T", published: null },
  ] },
);
check(ideas.length === 1 && ideas[0].evidence.length === 1 && ideas[0].evidence[0].url === "https://b" && ideas[0].topic === "T" && ideas[0].kind === "reddit",
  "ideas cite only items the Scout saw, once, with a known topic");

// ---- day one: a Monday, so the AI answers are checked too ----

console.log("day one");
reply = (text) => {
  const ids = [...text.matchAll(/\[(\d+)\] (news|reddit|watched)/g)].map((m) => Number(m[1]));
  return JSON.stringify({ ideas: [
    { title: "What the ruling means for scrapers", why: "A court ruled this week.", topic: "Scraping at scale", items: [ids[0], 999], expires_in_days: 14 },
    { title: "Answering: how do you scale scrapers?", why: "People keep asking.", topic: "Scraping at scale", items: [ids.find((n) => text.includes(`[${n}] reddit`))] },
  ] });
};
const day1 = "2026-10-12";
const h1 = await DBOS.startWorkflow(kit.scout, { workflowID: "scout-test-day1" })({ site: SITE, day: day1 });
const s1 = await h1.getResult();
check(s1.searches === 2 && s1.pageOne === 1, `two target searches, one on page one (${JSON.stringify(s1)})`);
check(s1.aiMentioned === 1, "one target prompt mentioned in an AI answer");
check(!seo.some((r) => r.keyword === "last quarter search"), "only this quarter's searches");

const facts = (await app.query("select kind, value from public.daily_facts where site = $1 and day = $2 order by kind", [SITE, day1])).rows;
const rs = facts.find((f) => f.kind === "ranking_search")?.value;
const ra = facts.find((f) => f.kind === "ranking_ai")?.value;
check(rs?.pageOne === 1 && rs.searches.find((s) => s.query === "fleet scraping framework").position === 4, "ranking facts: position 4 on blog.kontra.run");
check(ra?.mentioned === 1 && ra.platforms.google.mentioned.length === 1 && ra.platforms.chat_gpt.mentioned.length === 0, "AI facts per platform");
check(seo.filter((r) => r.path.includes("llm_mentions")).every((r) => r.target[0].domain === "kontra.run"), "AI mentions asked for the company's domain");

const f1 = ideasOf();
const gap = f1.find((f) => f.origin === "search");
check(gap?.title === 'Rank for "durable crawling"' && gap.target_search === "durable crawling" && gap.evidence.length === 2 && gap.evidence[0].url.includes("temporal.io"),
  "a search gap is an idea, with its target search and what ranks");
check(!f1.some((f) => f.title.includes("fleet scraping")), "no gap idea for a search on page one");
const news = f1.find((f) => f.origin === "news" && f.evidence[0].url.startsWith("https://news.example/"));
check(news && news.evidence.length === 1 && news.expires_at, "news idea: only its real link, with an expiry");
check(f1.some((f) => f.origin === "news" && f.summary.includes("Reddit") && f.evidence[0].url.includes("/comments/")), "Reddit idea from a thread");
check(f1.every((f) => f.status === "new" && f.source_agent === "scout" && /^[a-z0-9]{15}$/.test(f.id)), "all new, from the Scout, waiting for the Pitcher");
check(!prompts[0].includes("old.example") && !prompts[0].includes("example.com/r"), "old news and non-Reddit results never reach the model");
check(!prompts[0].includes("watched"), "the first look at a watched page is only a baseline");

const w1 = (await app.query("select last_items, last_error from public.watched_sites where site = $1", [SITE])).rows[0];
check(w1.last_items.length === 1 && w1.last_error === null, "watched page: one content link kept (nav, scripts and short links dropped)");

const paidRows = calls.filter((c) => c.model.startsWith("dataforseo/"));
const modelRows = calls.filter((c) => !c.model.startsWith("dataforseo/"));
check(paidRows.length === seo.length && paidRows.every((c) => c.cost_usd === 0.002 && c.job === "scout" && c.workflow_id === "scout-test-day1" && Number.isInteger(c.step_id)),
  `every DataForSEO request logged with its cost, run and step (${paidRows.length})`);
check(modelRows.length === 1 && modelRows[0].input_tokens === 1200 && modelRows[0].workflow_id === "scout-test-day1", "the model call logged with the run");

// The same run again is DBOS's recorded result: nothing is paid twice.
const before = calls.length;
const again = await DBOS.startWorkflow(kit.scout, { workflowID: "scout-test-day1" })({ site: SITE, day: day1 });
await again.getResult();
check(calls.length === before, "re-running a finished day pays nothing");

// ---- day two: the watched page gained a link; yesterday's items are known ----

console.log("day two");
pageVersion = 2;
prompts = [];
reply = (text) => {
  const m = /\[(\d+)\] watched/.exec(text);
  return JSON.stringify({ ideas: m ? [{ title: "The sodium rule is open for comments", why: "Comments close soon.", topic: "Regulation", items: [Number(m[1])] }] : [] });
};
const seoBefore = seo.length;
const s2 = await (await DBOS.startWorkflow(kit.scout, { workflowID: "scout-test-day2" })({ site: SITE, day: "2026-10-13" })).getResult();
check(!seo.slice(seoBefore).some((r) => r.path.includes("llm_mentions")), "AI answers not re-checked on a Tuesday");
check(prompts.length === 1 && prompts[0].includes("other.example/rule?x=1&y=2") && !prompts[0].includes("#top"), "the new link reaches the model, decoded");
check(!prompts[0].includes("how_do_you_scale") && !prompts[0].includes("news.example"), "yesterday's items aren't read again");
const watchedIdea = ideasOf("watched");
check(watchedIdea.length === 1 && watchedIdea[0].summary.includes("Regulation"), "watched-site idea saved");
check(ideasOf("search").length === 1, `a search gap is one idea a quarter, not one a day (${JSON.stringify(s2)})`);

// ---- the schedule's run fans out, once per tenant per day ----

console.log("schedule");
await app.query("insert into public.sites (id, name, slug) values ('emptysite000000', 'Empty', 'empty')");
const daily = await DBOS.startWorkflow(kit.scoutDaily, { workflowID: "scout-daily-test" })(new Date("2026-10-14T06:00:00Z"), null);
await daily.getResult();
const child = DBOS.retrieveWorkflow(kit.dailyRunId(SITE, "2026-10-14"));
const s3 = await child.getResult();
check(s3.searches === 2, "the daily run started the tenant's Scout under its daily id");
const empty = await DBOS.getWorkflowStatus(kit.dailyRunId("emptysite000000", "2026-10-14"));
check(empty === null, "a tenant with nothing to follow isn't scouted");

// ---- Chat's hand-off: today, AI answers included ----

console.log("from Chat");
const seoChat = seo.length;
const s4 = await (await DBOS.startWorkflow(kit.scout)({ site: SITE, task: "anything new?", requestedBy: "u", conversation: "c", post: null })).getResult();
check(s4.aiMentioned === 1 && seo.slice(seoChat).some((r) => r.path.includes("llm_mentions")), "a run from Chat checks the AI answers whatever the day");
const today = new Date().toISOString().slice(0, 10);
check((await app.query("select 1 from public.daily_facts where site = $1 and day = $2", [SITE, today])).rowCount === 2, "and writes today's facts");

// ---- the Scout's database role can't touch content ----

console.log("role");
await assert.rejects(kit.scoutDb().query("update public.posts set title = 'x'"), /permission denied/);
await assert.rejects(kit.scoutDb().query("select * from public.site_members"), /permission denied/);
check(true, "propaganda_scout can't write posts or read members");

await DBOS.shutdown();
await kit.closeScoutDb();
await app.end();
for (const s of [dataforseo, rest, pages]) s.close();
console.log(failures ? `\n${failures} FAILED` : "\nscout: all passed");
process.exit(failures ? 1 : 0);
