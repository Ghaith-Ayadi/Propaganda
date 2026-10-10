// The Pitcher and the Writer end to end, in process: real DBOS on a real
// Postgres (PGURL), the real model gateway and backend code, against a
// stand-in PostgREST (in memory), a stand-in model and a stand-in web.
// Nothing here talks to a real model, search engine or site.

import { createServer } from "node:http";
import pg from "pg";
import { MockLanguageModelV3 } from "ai/test";

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";
const SYS_DB = "worker_test_agents_dbos";
const SITE = "testsite0000000";
const OTHER = "versesite000000";

let failures = 0;
function check(cond, what) {
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what}`);
  }
}

// ---- a stand-in PostgREST ----

const CLOCK = "2026-10-08T12:00:00.000Z";

const db = {
  sites: [
    { id: SITE, name: "Kontra", slug: "kontra", domain: "" },
    { id: OTHER, name: "Verbatim", slug: "verbatim", domain: "" },
  ],
  collections: [{ site: SITE, name: "Test", slug: "test", description: "", is_hidden: false, position: 0 }],
  posts: [],
  post_versions: [],
  briefs: [],
  agent_ideas: [],
  voice_guides: [],
  agent_settings: [],
  content_batches: [],
  taste_log: [],
  taste_profiles: [],
  model_calls: [],
};
const ESSAY = (n) =>
  `## Part ${n}\n\n` +
  "We write the way we talk, and we keep it short. Every week the batch jobs fall over at three in the morning, and every week we learn something new about why. ".repeat(6);
db.posts.push(
  { id: "vpost0000000001", site: OTHER, title: "On writing", subtitle: "", type: "Blog", status: "published", excerpt: "", slug: "on-writing", tags: [], content_md: ESSAY(1), published_at: "2026-09-01T00:00:00Z", word_count: 200 },
  { id: "vpost0000000002", site: OTHER, title: "On editing", subtitle: "", type: "Blog", status: "published", excerpt: "", slug: "on-editing", tags: [], content_md: ESSAY(2), published_at: "2026-09-02T00:00:00Z", word_count: 200 },
);

function matches(row, key, cond) {
  if (key === "or") {
    // reviewerFeedback: (status.eq.rejected,notes.not.is.null)
    return row.status === "rejected" || (row.notes !== null && row.notes !== undefined);
  }
  const v = row[key];
  const [op, ...rest] = cond.split(".");
  const arg = rest.join(".");
  if (op === "eq") return String(v ?? "") === arg;
  if (op === "neq") return String(v ?? "") !== arg;
  if (op === "is") return arg === "null" ? v === null || v === undefined : String(v) === arg;
  if (op === "like") return new RegExp(`^${arg.replace(/\*/g, ".*")}$`).test(String(v ?? ""));
  if (op === "lte") return String(v) <= arg;
  if (op === "gte") return String(v) >= arg;
  if (op === "gt") return String(v) > arg;
  if (op === "not" && rest[0] === "is") return rest[1] === "null" ? v !== null && v !== undefined : String(v) !== rest[1];
  if (op === "in") return arg.slice(1, -1).split(",").includes(String(v));
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
  const limit = Number(params.get("limit") ?? 1000);
  return rows.slice(0, limit);
}

const rpcs = {
  cost_gate: () => ({ tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false }),
  kb_search: ({ p_site }) =>
    p_site === SITE ? [{ id: "claim0000000001", text: "Kontra runs batch jobs on Temporal.", status: "settled", scope: {}, topics: ["Product"], score: 1 }] : [],
};

let patches = 0;
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
    if (path === "model_prices") return out(200, [{ input_per_mtok: "3", output_per_mtok: "15", cache_read_per_mtok: "0", cache_write_per_mtok: "0" }]);
    const table = db[path];
    if (!table) return out(404, { code: "PGRST205", message: `no table ${path}` });
    if (req.method === "GET") return out(200, filterRows(path, url.searchParams));
    if (req.method === "POST") {
      // Rows are stamped on the tests' "today", so week and quarter checks don't depend on the real date.
      const row = { created: CLOCK, updated: CLOCK, ...JSON.parse(body) };
      if (path === "briefs" && !row.status) return out(400, { code: "23514", message: "status" });
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
      patches++;
      const rows = filterRows(path, url.searchParams);
      for (const r of rows) Object.assign(r, JSON.parse(body), { updated: new Date().toISOString() });
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

// ---- a stand-in web ----

const PAGE = "http://93.184.216.34/temporal-study";
const fetched = [];
// How many searches in a row DataForSEO fails on its side, as it did on 2026-10-10.
let searchOutage = 0;
const web = async (input, init) => {
  const url = String(input);
  fetched.push(url);
  if (url.startsWith("https://api.dataforseo.com/") && searchOutage > 0) {
    searchOutage--;
    return Response.json({ cost: 0, tasks: [{ status_code: 50000, status_message: "Internal SE Server Error.", cost: 0 }] });
  }
  if (url.startsWith("https://api.dataforseo.com/")) {
    const [{ keyword }] = JSON.parse(init.body);
    return Response.json({
      tasks: [{ status_code: 20000, result: [{ items: [
        { type: "organic", url: PAGE, title: `A study on ${keyword}`, description: "Numbers on job failures.", rank_absolute: 1 },
        { type: "organic", url: "http://10.0.0.5/internal", title: "Should never be read", description: "", rank_absolute: 2 },
      ] }] }],
    });
  }
  if (url.startsWith("http://93.184.216.34/")) {
    const html = `<html><head><title>Temporal study</title><script>evil()</script></head><body><nav>menu</nav><article><h1>Study</h1><p>${"Batch jobs fail 37% more often at night, according to the 2026 survey of 400 teams. ".repeat(8)}</p></article></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  throw new Error(`stand-in web: unexpected fetch ${url}`);
};

// ---- a stand-in model ----

const prompts = [];
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 200, text: 200, reasoning: 0 } };
const DRAFT_BODY =
  "## Why three in the morning\n\nThat's not bad luck. It's a scheduling problem.\n\n" +
  "Night jobs fail more often than day jobs: [the 2026 survey](http://93.184.216.34/temporal-study) puts it at 37% more. " +
  "Kontra runs batch jobs on Temporal, so a failed step resumes where it stopped. ".repeat(40) +
  "\n\n## What to do about it\n\nAbout 12% of teams retry by hand.\n";
function answer(prompt) {
  if (prompt.includes("Write the voice guide")) {
    return JSON.stringify({
      guide: "# Voice\n\n**In one line:** a tired engineer telling the truth.",
      samples: [{ title: "On writing", passage: "We write the way we talk, and we keep it short." }],
    });
  }
  if (prompt.includes("Judge each idea")) {
    const ids = [...prompt.matchAll(/^\[([a-z0-9]{15})\] (.*)$/gm)].map((m) => ({ id: m[1], title: m[2] }));
    return "Here you go:\n```json\n" + JSON.stringify({
      ideas: ids.map(({ id, title }) =>
        title.includes("Nothing")
          ? { id, topics: [], targetSearch: "", timely: false, expiresAt: "", answersGap: "", demand: "", duplicateOf: "", replacesFlagged: "", searches: [] }
          : { id, topics: ["Reliability"], targetSearch: "batch job retries", timely: title.includes("news"), expiresAt: "2026-11-01", answersGap: "Customers keep asking why jobs die overnight.", demand: "", duplicateOf: "", replacesFlagged: "", searches: ["batch jobs failing at night"] },
      ),
    }) + "\n```";
  }
  if (prompt.includes("Write the pitch")) {
    const url = /<(http:\/\/93\.184\.216\.34\/[^>]+)>/.exec(prompt)?.[1];
    const idea = /Idea:\n\[[a-z0-9]{15}\] (.*)/.exec(prompt)?.[1] ?? "Why your batch jobs die at 3am";
    return JSON.stringify({
      title: `${idea}: a field guide`,
      learned: prompt.includes("No listicles") ? "Written after your note: no listicles." : "",
      why: "Customers keep asking.",
      angle: "Night failures are a scheduling problem more than an infrastructure one.",
      audience: "Platform engineers running nightly ETL.",
      length: "1,200 words",
      collection: "Test",
      outline: ["The 3am pattern", "What the numbers say", "Durable steps", "What to change tonight"],
      sources: url ? [{ url, label: "The 2026 survey" }] : [],
    });
  }
  if (prompt.includes("Give three web searches")) return JSON.stringify({ searches: ["batch job failure rate night", "durable execution retries"] });
  if (prompt.includes("Write the full post")) {
    return JSON.stringify({ title: "Why your batch jobs die at 3am", subtitle: "And what to do tonight", excerpt: "Night jobs fail more.", markdown: DRAFT_BODY, missingFacts: ["Kontra's pricing"] });
  }
  if (prompt.includes("break house rule 1")) {
    const post = prompt.split("Answer with the full post in Markdown and nothing else.\n\n").pop();
    return post.replace("That's not bad luck. It's a scheduling problem.", "This is much more of a scheduling problem than it is bad luck.");
  }
  if (prompt.includes("Turn it into post ideas")) {
    return JSON.stringify({ ideas: [{ title: "Retries that don't page anyone", summary: "Durable steps." }, { title: "The cost of a 3am page", summary: "On-call math." }] });
  }
  if (prompt.includes("A reviewer left these notes")) return DRAFT_BODY.replace("## What to do about it", "## What to change tonight");
  if (prompt.includes("Write the new summary.")) return "Rejects listicles. Approves customer stories.";
  if (prompt.includes("Propose changes to the guide")) return JSON.stringify({ changes: [{ change: "End on the next step, never a summary.", from: ["Edited one", "Edited two"] }] });
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
t.setSearchWaits([10, 10, 10, 10]);
t.wireGateway();
t.DBOS.setConfig({ name: "propaganda-agents-test", systemDatabaseUrl: `${PGURL}/${SYS_DB}`, applicationVersion: "test" });
await t.DBOS.launch();
await t.registerQueues();

const goals = {
  quarter: "2026-Q4",
  volume: { total: 12, topics: [{ name: "Reliability", low: 4, high: 6 }, { name: "Product", low: 2, high: 4 }] },
  coverage: { internal: 6, external: 6 },
  searches: [{ query: "batch job retries", position: 23 }],
  perWeek: 1,
};

try {
  console.log("pure parts");
  check(t.contrastHits("That's not art. That's maintenance.").length === 1, "catches \"That's not X. That's Y.\"");
  check(t.contrastHits("It isn't about speed, it's about trust.").length === 1, "catches \"It isn't X, it's Y\" in one sentence");
  check(t.contrastHits("This is much more of a maintenance job than it is the ol' art of writing.").length === 0, "lets the comparison through");
  check(t.contrastHits("It's not raining. We went out anyway.").length === 0, "lets an ordinary negation through");
  check(t.unsourcedNumbers("About 12% of teams do it.").length === 1, "flags a number with no link");
  check(t.unsourcedNumbers("About [12%](https://x.y/z) of teams do it.").length === 0, "accepts a linked number");
  check(t.htmlToText("<p>a</p><script>x()</script><p>b</p>") === "a\nb", "page text drops scripts");
  let refused = false;
  try { await t.assertPublicUrl("http://169.254.169.254/latest/meta-data"); } catch { refused = true; }
  check(refused, "refuses a private address");
  const st = t.standing([], 1, new Date("2026-10-08T12:00:00Z"));
  const r0 = t.rate({ topics: [], targetSearch: "", timely: false, expiresAt: "", answersGap: "", demand: "", duplicateOf: "", replacesFlagged: "" }, "news", null, { ...st, emptyWeeks: [] }, null);
  check(!r0.pitch, "no reason, no pitch");
  const r1 = t.rate({ topics: ["Reliability"], targetSearch: "batch job retries", timely: false, expiresAt: "", answersGap: "x", demand: "", duplicateOf: "", replacesFlagged: "" }, "calls", goals, st, st.emptyWeeks[0]);
  check(r1.grade === "strong" && r1.reasons.length >= 4, `a topic under target, an empty week, a target search and a gap is strong (${r1.reasons.length} reasons)`);
  check(t.fitGrade(r1.reasons) === r1.grade, "the UI's rule gives the same grade");

  console.log("voice guide");
  const v1 = await (await t.DBOS.startWorkflow(t.voiceGuideWorkflow)({ site: SITE })).getResult();
  check(v1.source === "default" && db.voice_guides[0]?.body === t.DEFAULT_VOICE, "a tenant with no posts gets the default voice");
  const v2 = await (await t.DBOS.startWorkflow(t.voiceGuideWorkflow)({ site: SITE, sourceSite: OTHER, refresh: true })).getResult();
  check(v2.source === "content" && db.voice_guides[0].source === "content" && db.voice_guides[0].source_site === OTHER, "a voice from another site's posts (Verbatim for PPGD)");
  db.voice_guides[0].source = "person";
  db.voice_guides[0].body = "Edited by a person";
  const v3 = await (await t.DBOS.startWorkflow(t.voiceGuideWorkflow)({ site: SITE, sourceSite: OTHER, refresh: true })).getResult();
  check(v3.source === "kept" && db.voice_guides[0].body === "Edited by a person", "never overwrites a person's guide");

  console.log("pitcher");
  const ids = await t.handOffIdeas(
    SITE,
    [
      { title: "Jobs die at 3am", summary: "Three customers said it on calls.", origin: "calls", evidence: [{ label: "Call", quote: "it dies every night" }], sourceAgent: "listener" },
      { title: "Temporal news", summary: "A release changes retries.", origin: "news", evidence: [{ label: "Release notes", url: PAGE }], sourceAgent: "scout" },
      { title: "Nothing in particular", summary: "A vague thought.", origin: "team", evidence: [], sourceAgent: "chat" },
    ],
    { pitchNow: false },
  );
  check(ids.length === 3 && db.agent_ideas.every((i) => i.status === "new"), "ideas handed off as new");
  const p = await (await t.DBOS.startWorkflow(t.pitcher)({ site: SITE, ideaIds: ids, batch: 1, max: 1, draftTop: 1, goals, today: "2026-10-08" })).getResult();
  check(p.pitched.length === 1 && p.waiting.length === 1 && p.rejected.length === 1, `one pitched, one waiting for the next batch, one rejected (${JSON.stringify({ pitched: p.pitched.length, waiting: p.waiting.length, rejected: p.rejected.length })})`);
  const brief = db.briefs[0];
  check(brief?.status === "pitched" && brief.pitched_by === "agent:pitcher" && brief.batch === 1, "the pitch is a pitched brief in batch 1");
  check(brief?.outline?.length === 4 && brief.angle && brief.audience && brief.sources?.length === 1 && brief.fit?.reasons?.length >= 1, "the pitch is a full brief: outline, angle, audience, sources, fit");
  check(!fetched.some((u) => u.includes("10.0.0.5")), "never fetched the private address a search returned");
  const rejected = db.agent_ideas.find((i) => i.title === "Nothing in particular");
  check(rejected.status === "rejected" && rejected.reason.startsWith("No reason yet"), "an idea with no reason is rejected with a reason and kept");
  check(db.agent_ideas.find((i) => i.brief === brief.id)?.status === "pitched", "the pitched idea points at its brief");

  console.log("writer (launch: drafted before approval)");
  const draftRun = t.DBOS.retrieveWorkflow(p.drafting[0]);
  const w = await draftRun.getResult();
  check(w.status === "drafted", `the strongest pitch was drafted (${w.status}${w.reason ? `: ${w.reason}` : ""})`);
  const post = db.posts.find((x) => x.id === w.post);
  check(post?.status === "draft" && post.type === "Test" && post.site === SITE, "a new draft post in the brief's collection");
  check(!post?.content_md.includes("That's not bad luck") && post?.content_md.includes("much more of a scheduling problem"), "the house rule was enforced");
  const ver = db.post_versions.find((x) => x.post === w.post);
  check(ver?.created_by === "agent:writer" && ver.version === 1, "the draft is version 1, by the Writer");
  check(ver?.attributes.lint.unsourced.length >= 1 && w.left.unsourced >= 1, "an unsourced number is noted for the reviewer");
  check(ver?.attributes.claims.includes("claim0000000001") && ver.attributes.missingFacts.includes("Kontra's pricing"), "knowledge base claims and missing facts are recorded");
  check(brief.post === w.post && brief.status === "pitched", "the brief links the draft and stays pitched until approved");
  check(prompts.some((x) => x.includes("Edited by a person")), "the Writer wrote in the tenant's voice guide");

  console.log("writer (approved, into the pipeline's empty post)");
  db.posts.push({ id: "emptypost000001", site: SITE, title: "", subtitle: "", type: "Test", status: "draft", excerpt: "", slug: "", tags: [], content_md: "", published_at: null, word_count: 0 });
  db.briefs.push({ ...brief, id: "approvedbrief01", status: "todo", post: "emptypost000001" });
  const w2 = await (await t.DBOS.startWorkflow(t.writer)({ site: SITE, briefId: "approvedbrief01" })).getResult();
  check(w2.status === "drafted" && db.posts.find((x) => x.id === "emptypost000001").content_md.length > 100, "fills the empty post");
  check(db.briefs.find((b) => b.id === "approvedbrief01").status === "in_review", "and sends it for review");

  console.log("writer never touches a person's writing");
  db.posts.push({ id: "humanpost000001", site: SITE, title: "Mine", subtitle: "", type: "Test", status: "draft", excerpt: "", slug: "", tags: [], content_md: "My own words.", published_at: null, word_count: 3 });
  db.briefs.push({ ...brief, id: "humanbrief00001", status: "todo", post: "humanpost000001" });
  const w3 = await (await t.DBOS.startWorkflow(t.writer)({ site: SITE, briefId: "humanbrief00001" })).getResult();
  check(w3.status === "skipped" && db.posts.find((x) => x.id === "humanpost000001").content_md === "My own words.", "skips a post with writing in it");
  const w4 = await (await t.DBOS.startWorkflow(t.writer)({ site: SITE, briefId: brief.id })).getResult();
  check(w4.status === "skipped", "won't draft an unapproved pitch without the launch flag");

  console.log("revision as a suggestion");
  const before = db.posts.find((x) => x.id === "emptypost000001").content_md;
  const rv = await (await t.DBOS.startWorkflow(t.reviser)({ site: SITE, post: "emptypost000001", notes: "Rename the last section." })).getResult();
  const sug = db.post_versions.find((x) => x.post === "emptypost000001" && x.version === rv.version);
  check(rv.status === "drafted" && sug?.attributes.suggestion === true && sug.content.includes("What to change tonight"), "the revision is a new suggested version");
  check(db.posts.find((x) => x.id === "emptypost000001").content_md === before, "and the post itself is unchanged");

  console.log("a search engine outage");
  const searchRowsBefore = db.model_calls.filter((c) => String(c.model).startsWith("dataforseo/")).length;
  searchOutage = 1;
  const [blip] = await t.handOffIdeas(SITE, [{ title: "Retries after a blip", summary: "Customers asked.", origin: "calls", evidence: [{ label: "Call", quote: "it blipped" }], sourceAgent: "listener" }], { pitchNow: false });
  const h1 = await t.DBOS.startWorkflow(t.pitcher)({ site: SITE, ideaIds: [blip], batch: 1, max: 1, draftTop: 0, goals, today: "2026-10-08" });
  const o1 = await h1.getResult();
  const blipRows = db.model_calls.filter((c) => String(c.model).startsWith("dataforseo/")).slice(searchRowsBefore);
  check(o1.pitched.length === 1 && searchOutage === 0 && !o1.skippedSearches, "one failed search is asked again after a wait and the pitch goes out");
  check(blipRows.length === 2 && blipRows[0].status === "error" && blipRows[0].priced === true && blipRows[0].cost_usd === 0, `the failed attempt is logged at the $0 DataForSEO reported, not unpriced (${JSON.stringify(blipRows.map((c) => [c.status, c.priced, c.cost_usd]))})`);
  const s1 = await t.DBOS.listWorkflowSteps(h1.workflowID);
  const names1 = s1.map((x) => x.name);
  check(names1.includes(`search ${blip} 1`) && names1.includes(`search ${blip} 1 (try 2)`) && names1.includes("DBOS.sleep"), `each attempt is its own step, with a durable wait between (${names1.filter((n) => n.startsWith("search") || n === "DBOS.sleep").join(" | ")})`);
  const first = s1.find((x) => x.name === `search ${blip} 1`);
  check(first?.output?.failure?.next === "retry" && first.output.failure.note === "trying again in 0 s" && !first.error, "the failed attempt returns its failure instead of failing the run");
  check(!db.briefs.find((b) => b.idea === blip)?.fit?.research, "a pitch whose search came back carries no research note");

  searchOutage = 99;
  const [down] = await t.handOffIdeas(SITE, [{ title: "Retries while search is down", summary: "Customers asked again.", origin: "calls", evidence: [{ label: "Call", quote: "still down" }], sourceAgent: "listener" }], { pitchNow: false });
  const o2 = await (await t.DBOS.startWorkflow(t.pitcher)({ site: SITE, ideaIds: [down], batch: 1, max: 1, draftTop: 0, goals, today: "2026-10-08" })).getResult();
  check(o2.pitched.length === 1 && searchOutage === 94, `search down for good: five attempts, then the pitch is written without results (${99 - searchOutage} attempts)`);
  check(prompts.filter((x) => x.includes("Write the pitch")).pop().includes("(no search results)"), "and the brief is told there were none");
  const downBrief = db.briefs.find((b) => b.idea === down);
  check(/^Written without one web search: the search service \(DataForSEO\) kept failing \(Internal SE Server Error\)/.test(downBrief?.fit?.research ?? ""), `the person is told on the pitch (${downBrief?.fit?.research})`);
  check(o2.skippedSearches?.length === 1 && o2.skippedSearches[0].message.includes("Internal SE Server Error"), "and the run's result lists the skipped search");
  searchOutage = 0;

  console.log("a request from Chat");
  const runId = await t.dispatchAgent("pitcher", { site: SITE, task: "Pitch me two posts on retries", requestedBy: "11111111-1111-1111-1111-111111111111", conversation: "conv1", post: null });
  const req = await t.DBOS.retrieveWorkflow(runId).getResult();
  const chatIdeas = db.agent_ideas.filter((i) => i.evidence[0]?.label?.startsWith("Asked in Chat"));
  check(chatIdeas.length === 2 && chatIdeas.every((i) => i.origin === "team" && i.evidence[0].quote.includes("two posts")), "the request became two ideas, with the ask as evidence");
  check(req.pitched.length + req.rejected.length === 2, `both were judged (${req.pitched.length} pitched)`);
  const approved = [{ id: "a00000000000001", title: "Why your batch jobs die at 3am", status: "todo", post: null }, { id: "a00000000000002", title: "Pricing pages", status: "todo", post: null }];
  check(t.briefForTask(approved, "write the one about batch jobs") === "a00000000000001", "Chat's \"write the one about batch jobs\" finds its brief");
  check(t.briefForTask(approved, "write about penguins") === null, "and finds nothing when nothing matches");
  const none = await t.dispatchAgent("writer", { site: SITE, task: "write about penguins", requestedBy: "11111111-1111-1111-1111-111111111111", conversation: "conv1", post: null });
  check(none === null, "Chat's writer hand-off finds nothing to write when no approved brief matches (422)");

  console.log("ideas wait for a batch");
  const scoutIdeas = ["Retries explained", "Retry budgets", "Idempotent steps"].map((title, n) => ({
    title, summary: "Search demand for it.", origin: "search", evidence: [{ label: "Search", quote: title }], sourceAgent: "scout", key: `scout:${SITE}:cap${n}`,
  }));
  const sIds = await t.handOffIdeas(SITE, scoutIdeas, { pitchNow: false });
  const again = await t.handOffIdeas(SITE, scoutIdeas, { pitchNow: false });
  check(JSON.stringify(again) === JSON.stringify(sIds) && db.agent_ideas.filter((i) => sIds.includes(i.id)).length === 3, "the same key never adds a second idea");
  const judgeCalls = prompts.filter((x) => x.includes("Judge each idea")).length;
  const b0 = await (await t.DBOS.startWorkflow(t.pitcher)({ site: SITE, ideaIds: sIds, goals, today: "2026-10-08" })).getResult();
  check(b0.pitched.length === 0 && b0.waiting.length === 3 && prompts.filter((x) => x.includes("Judge each idea")).length === judgeCalls, "outside a batch, the Scout's ideas wait for one, without a model call");

  console.log("batch arithmetic");
  const view = (o) => ({ target: 18, approved: 0, batches: [], planWaiting: 0, cadence: "weekly", quarterStart: new Date("2026-10-01T00:00:00Z"), now: new Date("2026-10-01T07:00:00Z"), ...o });
  const open = (number, quota, approved) => ({ site: SITE, quarter: "2026-Q4", number, quota, state: "in_review", released_at: "2026-10-01T07:00:00Z", topups: 0, approved, undecided: 0 });
  check(t.nextQuota(view()) === 4, "weekly: 18 posts start with a double batch of 4");
  check(t.nextQuota(view({ approved: 4, batches: [{ ...open(1, 4, 4), state: "closed" }], now: new Date("2026-10-08T07:00:00Z") })) === 2, "then 2 a week");
  check(t.unassigned(view({ approved: 10, batches: [open(5, 2, 0)] })) === 6, "what's left is target minus approved, minus open batches' shortfall");
  check(t.nextQuota(view({ approved: 18 })) === 0, "nothing once the target is met");
  check(t.nextQuota(view({ cadence: "flood", target: 400 })) === 400, "flood: everything at once");
  check(t.nextQuota(view({ approved: 3, now: new Date("2026-12-07T07:00:00Z") })) === 15, "past the first two months, the rest at once");
  check(t.nextQuota(view({ target: null, planWaiting: 0 })) === 3, "no goals and no plan: 3 a batch");
  check(t.approvalRate([]) === 0.5 && t.pitchesFor(4, 0, 0.5) === 8, "two pitches per slot to start");
  const decided = (a, r) => [...Array(a).fill({ status: "todo" }), ...Array(r).fill({ status: "rejected" })];
  check(t.approvalRate(decided(6, 2)) === 0.75 && t.pitchesFor(3, 0, 0.75) === 4, "then the tenant's real approval rate");
  check(t.approvalRate(decided(0, 10)) === 0.25, "never more than 4 pitches per slot");
  check(t.pitchesFor(4, 3, 0.5) === 5, "undecided pitches count toward a batch");

  console.log("no repeats");
  check(t.similarity("Why your batch jobs die at 3am", "Why batch jobs die at 3am") >= 0.5, "a reworded title is the same post");
  check(t.similarity("Why your batch jobs die at 3am", "Pricing pages that convert") < 0.5, "a different post isn't");

  console.log("batches by approvals");
  const goals6 = (extra) => ({ ...goals, volume: { ...goals.volume, total: approvedNow() + extra } });
  const approvedNow = () => db.briefs.filter((b) => ["todo", "in_progress", "in_review", "scheduled", "done"].includes(b.status)).length;
  const runBatch = async (trigger, today, g) => (await t.DBOS.startWorkflow(t.pitchBatch)({ site: SITE, trigger, goals: g, today })).getResult();
  const plan = await t.handOffIdeas(
    SITE,
    ["Durable steps explained", "Night shift for robots", "Retry storms", "Queue depth alarms", "Backoff that works", "Checkpoint everything", "Idempotency keys", "Dead letter queues"].map((title) => ({ title, summary: "From the plan.", origin: "plan", evidence: [{ label: "Plan", quote: title }], sourceAgent: "strategist" })),
    { pitchNow: false },
  );
  const g4 = goals6(4);
  const q1 = await runBatch("handoff", "2026-10-08", g4);
  const batch1 = db.content_batches.find((b) => b.number === q1.released);
  check(q1.released !== null && batch1?.quota === 1 && batch1.state === "in_review", `the plan arriving sends the quarter's first batch (batch ${q1.released}, quota ${batch1?.quota})`);
  check(q1.pitched.length === 2, `over-pitched: 2 pitches for 1 approval (${q1.pitched.length})`);
  check(q1.pitched.every((x) => db.agent_ideas.find((i) => i.id === x.idea)?.status === "pitched"), "from the ideas waiting, whatever their source");
  // A person approves one and rejects the other; the database logs both.
  const [p1, p2] = q1.pitched.map((x) => db.briefs.find((b) => b.id === x.brief));
  p1.status = "todo";
  p2.status = "rejected";
  p2.reject_reason = "No listicles, ever.";
  db.taste_log.push(
    { id: "taste0000000001", site: SITE, at: "2026-10-08T15:00:00.000Z", actor: "u1", object_kind: "pitch", object_id: p1.id, decision: "approved", reason: "", notes: null, title: p1.title, topic: "", angle: "", origin: "plan" },
    { id: "taste0000000002", site: SITE, at: "2026-10-08T15:01:00.000Z", actor: "u1", object_kind: "pitch", object_id: p2.id, decision: "rejected", reason: "No listicles, ever.", notes: null, title: p2.title, topic: "", angle: "", origin: "plan" },
  );
  const q2 = await runBatch("asked", "2026-10-08", g4);
  check(q2.closed.includes(q1.released), "a batch that reached its quota closes");
  check(q2.released === q1.released + 1, `"next batch" sends one now (batch ${q2.released})`);
  check(db.taste_profiles[0]?.summary.includes("Rejects listicles") && db.taste_profiles[0].summary_through === "2026-10-08T15:01:00.000Z", "the Pitcher rewrote the taste summary from the new decisions");
  const pitchPrompt = prompts.filter((x) => x.includes("Write the pitch")).pop();
  check(pitchPrompt.includes("No listicles, ever.") && pitchPrompt.includes("Rejects listicles"), "and read the decisions and the summary before pitching");
  const learnedBrief = db.briefs.find((b) => b.id === q2.pitched[0]?.brief);
  check(learnedBrief?.learned === "Written after your note: no listicles." && learnedBrief.body.includes("_Written after your note"), "each pitch says what it learned");
  // Batch 2: both rejected. The next morning tops it up, the same week sends no new batch.
  for (const x of q2.pitched) Object.assign(db.briefs.find((b) => b.id === x.brief), { status: "rejected", reject_reason: "Too generic." });
  const q3 = await runBatch("schedule", "2026-10-09", g4);
  const batch2 = db.content_batches.find((b) => b.number === q2.released);
  check(q3.toppedUp.includes(q2.released) && batch2.state === "topping_up" && batch2.topups === 1 && q3.pitched.length >= 1, `a short batch is topped up the next morning (${q3.pitched.length} pitches)`);
  check(prompts.filter((x) => x.includes("Write the pitch")).pop().includes("This is a top-up"), "the top-up is told why it's short");
  check(q3.released === null, "and no second batch goes out the same week");
  // No repeats: an idea close to the rejected pitch is dropped.
  const [repeat] = await t.handOffIdeas(SITE, [{ title: p2.title.replace(": a field guide", ""), summary: "Again.", origin: "search", evidence: [{ label: "Search", quote: "again" }], sourceAgent: "scout" }], { pitchNow: false });
  for (const x of q3.pitched) db.briefs.find((b) => b.id === x.brief).status = "todo";
  const q4 = await runBatch("asked", "2026-10-09", goals6(2));
  const rep = db.agent_ideas.find((i) => i.id === repeat);
  check(rep.status === "rejected" && rep.reason.startsWith("Already rejected"), `a rejected pitch never comes back unchanged (${rep.reason.slice(0, 60)})`);
  // Approvals reach the target: the open batches are cancelled, nothing more is pitched.
  for (const b of db.briefs.filter((x) => x.status === "pitched")) b.status = "todo";
  const before5 = db.briefs.length;
  const q5 = await runBatch("schedule", "2026-10-12", goals6(0));
  check(q5.released === null && db.briefs.length === before5, "once approvals reach the target, nothing more is pitched");
  db.content_batches.push({ site: SITE, quarter: "2026-Q4", number: 9, quota: 3, state: "in_review", released_at: "2026-10-12T07:00:00.000Z", topups: 0 });
  const q6 = await runBatch("schedule", "2026-10-13", goals6(0));
  check(q6.cancelled.includes(9) && db.content_batches.find((b) => b.number === 9).state === "cancelled" && q6.pitched.length === 0, "a batch still short when the target is met is cancelled");
  // The morning schedule.
  await (await t.DBOS.startWorkflow(t.dailyBatches)(new Date("2026-10-13T07:00:00Z"))).getResult();
  const day = await t.DBOS.retrieveWorkflow(`pitcher-batch-${SITE}-2026-10-13`).getResult();
  check(day && "released" in day, "the morning schedule runs each tenant with ideas waiting or a batch open");

  console.log("the Writer learns from edits");
  const diff = t.diffDraft("Intro.\n\nIn conclusion, all good.", "Intro.\n\nTry it tonight.");
  check(diff.removed[0] === "In conclusion, all good." && diff.added[0] === "Try it tonight.", "a reviewer's edit, paragraph by paragraph");
  for (const [n, title] of ["Edited one", "Edited two"].entries()) {
    const id = `editpost0000000${n}`;
    db.posts.push({ id, site: SITE, title, subtitle: "", type: "Test", status: "draft", excerpt: "", slug: "", tags: [], content_md: "", published_at: null, word_count: 0 });
    db.post_versions.push({ site: SITE, post: id, version: 1, created_by: "agent:writer", content: "Body.\n\nIn conclusion, it works." }, { site: SITE, post: id, version: 2, created_by: "user", content: "Body.\n\nTry it tonight." });
    db.taste_log.push({ id: `tasteedit00000${n}`, site: SITE, at: `2026-10-10T0${n}:00:00.000Z`, actor: "u1", object_kind: "draft", object_id: id, decision: "edited", reason: "", notes: null, title, topic: "", angle: "", origin: "" });
  }
  const guideBefore = db.voice_guides[0].body;
  const vs = await (await t.DBOS.startWorkflow(t.voiceSuggest)({ site: SITE })).getResult();
  check(vs.status === "suggested" && db.voice_guides[0].suggestion.includes("End on the next step") && db.voice_guides[0].body === guideBefore, "repeated edits become a suggested voice change, never an edit to the guide");
  check(prompts.filter((x) => x.includes("Propose changes to the guide")).pop().includes("cut: In conclusion, it works."), "from what the reviewers actually cut");

  console.log("cost log");
  const modelRows = db.model_calls.filter((c) => !String(c.model).startsWith("dataforseo/"));
  const searchRows = db.model_calls.filter((c) => String(c.model).startsWith("dataforseo/"));
  check(modelRows.length === prompts.length && db.model_calls.every((c) => c.site === SITE || c.site === undefined), `every model call was logged (${modelRows.length} of ${prompts.length})`);
  check(db.model_calls.every((c) => c.background === true && c.workflow_id), "as background work, with its workflow");
  check(db.model_calls.some((c) => c.job === "pitcher:pitch") && db.model_calls.some((c) => c.job === "writer:draft"), "under the agents' job names");
  check(searchRows.some((c) => c.job === "pitcher:research") && searchRows.some((c) => c.job === "writer:research"), `web searches are logged too (${searchRows.length})`);
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
