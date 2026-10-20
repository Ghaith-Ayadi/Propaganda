// The Strategist on a real model (DeepSeek V4 Pro standing in for Fable, kit.mjs): a
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
const months = (vol) => Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: 12 - i, search_volume: i < 6 ? Math.round(vol * 1.2) : vol }));
/** An overview row with SERP info: page one's links, the intent, a year of months and, on some, an AI overview. */
const richItem = (k) => ({
  ...labsItem(k),
  keyword_info: { search_volume: k.vol, monthly_searches: months(k.vol) },
  serp_info: { serp_item_types: k.ai ? ["organic", "ai_overview"] : ["organic"] },
  avg_backlinks_info: { referring_main_domains: k.links },
  search_intent_info: { main_intent: "informational" },
});
/** A small stable hash of a phrase, so a real model's own vocabulary prices the same way on every run. */
const hashOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/**
 * The numbers behind any phrase the model asks about: the listed ones as listed; the rest by hash,
 * most of them winnable (under 30 links and difficulty 30), one in five a must-win (bigger, harder),
 * one in five unknown to Labs (Google Ads may still price it, below), as real data looks.
 */
function priced(keyword) {
  const known = KEYWORDS.find((k) => k.keyword === keyword);
  if (known) return { ...known, links: known.kd < 30 ? 6 + (known.kd % 20) : 60 + known.kd, ai: known.kd % 2 === 0 };
  const h = hashOf(keyword);
  if (h % 5 === 0) return null;
  if (h % 5 === 1) return { keyword, vol: 300 + (h % 900), kd: 32 + (h % 18), links: 45 + (h % 50), ai: h % 3 === 0 };
  return { keyword, vol: 60 + (h % 700), kd: 6 + (h % 22), links: 4 + (h % 24), ai: h % 3 === 0 };
}
const realFetch = globalThis.fetch;
async function web(input, init) {
  const url = String(input);
  if (url.startsWith("https://api.dataforseo.com/")) {
    if (url.includes("keyword_suggestions")) return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items: KEYWORDS.map(labsItem) }] }] });
    if (url.includes("related_keywords")) return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
    if (url.includes("ranked_keywords")) return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
    if (url.includes("keyword_overview")) {
      const task = JSON.parse(init.body)[0];
      const rows = task.keywords.map(priced).filter(Boolean);
      return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items: rows.map((k) => (task.include_serp_info ? richItem(k) : labsItem(k))) }] }] });
    }
    if (url.includes("google_ads/search_volume")) {
      // Google Ads knows half of what Labs does not, at a lower volume.
      const asked = JSON.parse(init.body)[0].keywords;
      const rows = asked.filter((k) => !priced(k) && hashOf(k) % 2 === 0).map((k) => ({ keyword: k, search_volume: 40 + (hashOf(k) % 60), monthly_searches: months(40 + (hashOf(k) % 60)) }));
      return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: rows }] });
    }
    if (url.includes("serp_competitors")) {
      const items = [
        { domain: "www.pipedrive.com", keywords_count: 6, avg_position: 3.2 },
        { domain: "www.close.com", keywords_count: 4, avg_position: 5.8 },
        { domain: "www.youtube.com", keywords_count: 3, avg_position: 12.1 },
      ];
      return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, result: [{ items }] }] });
    }
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

// Day one's first pitches are the Pitcher's work, tested in pitch-write.mjs and first-day.mjs;
// a Lite tenant skips them here, as in ../strategy.mjs.
process.env.WORKER_LITE_SITES = SITE;
const rest = await standInRest(db);
const t = await import("../../dist/agents/testing.js");
t.setWebFetch(web);
await launch(t, "strategist");

try {
  console.log(`a day-one proposal on ${t.MODELS.strategist}`);
  check(!t.MODELS.strategist.startsWith("anthropic/"), "not on a Claude model");
  db.strategy_proposals.push({ id: "liveproposal001", site: SITE, quarter: "2026-Q4", kind: "onboarding", status: "requested", request: "", requested_by: "u1", proposal: null, edits: null, created: new Date().toISOString(), approved_at: null });
  const [id] = await t.dispatchStrategist();
  const res = await t.DBOS.retrieveWorkflow(id).getResult();
  const row = db.strategy_proposals[0];
  check(res.status === "sent" && row.status === "sent", `the proposal reached the tenant (${res.status}${row.error ? `: ${row.error}` : ""})`);
  const p = row.proposal ?? {};
  check(p.kind === "onboarding" && p.quarter && p.covers?.from && p.launch?.target >= 3, "with its window and the Launch");
  check(typeof p.summary === "string" && p.summary.length > 20, "a summary");
  check(p.volume?.value > 0 && p.volume.why && p.volume.basis, "a volume target with its reason and basis");
  check(Array.isArray(p.topics) && p.topics.length >= 1 && p.topics.length <= t.TOPICS_MAX, `1 to ${t.TOPICS_MAX} topics (${p.topics?.map((x) => x.name).join(", ")})`);
  const searches = p.ranking?.searches ?? [];
  check(searches.length >= 3 && searches.every((s) => p.topics.some((x) => x.name === s.topic)), `target searches, each in a topic (${searches.map((s) => s.query).join(", ")})`);
  check(typeof p.profile === "string" && p.profile.length > 40, "the tenant's profile, as the model read it");
  check(searches.every((s) => t.bucketNamed(s.bucket)) && searches.some((s) => s.bucket === "now"), `every search in a bucket, some winnable now (${searches.map((s) => `${s.query}: ${s.bucket}`).join("; ")})`);
  check(!searches.some((s) => s.query === "crm"), "not the head term a new domain can't win");
  check(p.readership?.value == null, "no Readership target without readers");
  check(Array.isArray(p.questions), "questions for the tenant");
  const calls = db.model_calls.filter((c) => c.job === "strategist" && !String(c.model).startsWith("dataforseo/"));
  // A call the gateway timed out on is logged as an error at $0 (billed upstream for an amount we
  // don't know) and the step runs it again; the plumbing is right when every answer is priced.
  const answered = calls.filter((c) => c.status === "ok");
  const failed = calls.filter((c) => c.status !== "ok");
  check(answered.length >= 1 && answered.every((c) => c.priced) && failed.every((c) => !c.priced), `every model call logged, each answer priced, a timed-out call unpriced and retried (${answered.length} answered, ${failed.length} failed)`);
  check(answered.length <= 5, `the vocabulary, then two drafts at most, each with one retry for bad JSON (${answered.length} answered)`);
  // Only a sent proposal starts the first pitches; waiting on them after a failure never returns.
  const first = res.status === "sent" ? await t.DBOS.retrieveWorkflow(t.firstPitchesId("liveproposal001")).getResult() : null;
  check(/Lite/.test(first?.skipped ?? ""), `sending started the first pitches (skipped here: ${first?.skipped})`);
} catch (err) {
  // A run that throws is a failure like any other; the cost so far is still reported.
  check(false, `threw: ${err.message}`);
} finally {
  await t.DBOS.shutdown();
  rest.close();
}

finish("strategist", state, db.model_calls);
