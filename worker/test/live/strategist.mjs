// The Strategist on a real model (Sonnet 5.5 standing in for Fable, kit.mjs): a
// day-one proposal for a fictional tenant, end to end through the real workflow,
// its rules and its one retry. Keyword data and the tenant's site are stand-ins.

import { checks, finish, launch, liveEnv, standInRest } from "./kit.mjs";

liveEnv("strategist");
const { check, state } = checks();

const SITE = "livestrat000001";
const WEB = "http://93.184.216.34";

const db = {
  sites: [{ id: SITE, name: "Closewell", slug: "closewell", domain: "" }],
  app_settings: [
    { site: SITE, key: "tenant.website", value: WEB },
    { site: SITE, key: "strategist.reviewPerMonth", value: "8" },
  ],
  tenant_profile: [
    {
      site: SITE,
      answers: {
        offer: "A CRM for small sales teams that makes sure no follow-up is forgotten: every deal gets a next step, and Closewell nags until it's done.",
        searches: "sales follow up reminders\ncrm for small teams",
        watch: "pipedrive.com\nclose.com",
        upcoming: "A Gmail add-on ships in November.",
      },
      plan_text: "Win small B2B teams switching off spreadsheets.",
      plan_files: [],
      plan_read_at: null,
    },
  ],
  strategy_proposals: [],
  goal_versions: [],
  drift_notes: [],
  posts: [],
  briefs: [],
  taste_profiles: [{ site: SITE, summary: "", summary_through: null, notes: "" }],
  agent_settings: [],
  daily_facts: [],
  model_calls: [],
};

// ---- a stand-in web: DataForSEO and the tenant's pages ----

const KEYWORDS = [
  { keyword: "sales follow up reminders", vol: 390, kd: 14 },
  { keyword: "crm for small teams", vol: 880, kd: 28 },
  { keyword: "how to follow up after a sales call", vol: 320, kd: 11 },
  { keyword: "sales follow up email template", vol: 1900, kd: 24 },
  { keyword: "spreadsheet vs crm", vol: 170, kd: 9 },
  { keyword: "deal pipeline next steps", vol: 110, kd: 6 },
  { keyword: "simple crm", vol: 2400, kd: 27 },
  { keyword: "follow up cadence b2b", vol: 140, kd: 12 },
  { keyword: "crm", vol: 450000, kd: 92 },
];
const labsItem = (k) => ({ keyword: k.keyword, keyword_info: { search_volume: k.vol }, keyword_properties: { keyword_difficulty: k.kd } });
const realFetch = globalThis.fetch;
async function web(input, init) {
  const url = String(input);
  if (url.startsWith("https://api.dataforseo.com/")) {
    if (url.includes("keyword_ideas")) return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items: KEYWORDS.map(labsItem) }] }] });
    if (url.includes("ranked_keywords")) return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
    if (url.includes("serp/google/organic")) {
      return Response.json({ cost: 0, tasks: [{ status_code: 20000, result: [{ items: [
        { type: "organic", url: "https://www.pipedrive.com/en/blog/sales-follow-up", title: "Sales follow-up", rank_absolute: 1 },
        { type: "organic", url: "https://www.close.com/blog/", title: "The Close blog", rank_absolute: 2 },
      ] }] }] });
    }
    return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
  }
  if (url.startsWith(WEB)) {
    return new Response(
      `<html><head><title>Closewell</title></head><body><h1>Never forget a follow-up</h1><p>Closewell is a CRM for sales teams of 2 to 20. Every deal has a next step. Pricing from $19 a seat.</p></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  }
  if (/pipedrive\.com|close\.com/.test(url)) return new Response(`<html><head><title>Blog</title></head><body><p>Sales articles.</p></body></html>`, { headers: { "content-type": "text/html" } });
  return realFetch(input, init);
}
globalThis.fetch = web;
process.env.DATAFORSEO_LOGIN = "login";
process.env.DATAFORSEO_PASSWORD = "password";

const rest = await standInRest(db);
const t = await import("../../dist/agents/testing.js");
t.setWebFetch(web);
await launch(t, "strategist");

try {
  console.log(`a day-one proposal on ${t.MODELS.strategist}`);
  check(t.MODELS.strategist !== "anthropic/claude-fable-5.1", "not on Fable");
  db.strategy_proposals.push({ id: "liveproposal001", site: SITE, quarter: "2026-Q4", kind: "onboarding", status: "requested", request: "", requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  const [id] = await t.dispatchStrategist();
  const res = await t.DBOS.retrieveWorkflow(id).getResult();
  const row = db.strategy_proposals[0];
  check(res.status === "sent" && row.status === "sent", `the proposal reached the tenant (${res.status}${row.error ? `: ${row.error}` : ""})`);
  const p = row.proposal ?? {};
  check(p.kind === "onboarding" && p.quarter && p.covers?.from && p.launch?.target >= 3, "with its window and the Launch");
  check(typeof p.summary === "string" && p.summary.length > 20, "a summary");
  check(p.volume?.value > 0 && p.volume.why && p.volume.basis, "a volume target with its reason and basis");
  check(Array.isArray(p.topics) && p.topics.length >= 1 && p.topics.length <= 4, `1 to 4 topics (${p.topics?.map((x) => x.name).join(", ")})`);
  const searches = p.ranking?.searches ?? [];
  check(searches.length >= 3 && searches.every((s) => p.topics.some((x) => x.name === s.topic)), `target searches, each in a topic (${searches.map((s) => s.query).join(", ")})`);
  check(!searches.some((s) => s.query === "crm"), "not the head term a new domain can't win");
  check(p.readership?.value == null, "no Readership target without readers");
  check(Array.isArray(p.questions), "questions for the tenant");
  const calls = db.model_calls.filter((c) => c.job === "strategist" && !String(c.model).startsWith("dataforseo/"));
  check(calls.length >= 1 && calls.every((c) => c.status === "ok" && c.priced), `every model call logged and priced (${calls.length})`);
  check(calls.length <= 4, `two drafts at most, each with one retry for bad JSON (${calls.length} calls)`);
} catch (err) {
  // A run that throws is a failure like any other; the cost so far is still reported.
  check(false, `threw: ${err.message}`);
} finally {
  await t.DBOS.shutdown();
  rest.close();
}

finish("strategist", state, db.model_calls);
