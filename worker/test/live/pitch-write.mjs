// The Pitcher and the Writer on their prod model: a voice guide from a tenant's
// posts, ideas judged and pitched, and the strongest pitch drafted into a post,
// end to end through the real workflows. Search results and pages are stand-ins.

import { checks, finish, launch, liveEnv, standInRest } from "./kit.mjs";

liveEnv("pitch-write");
const { check, state } = checks();

const SITE = "livepitch000001";
const CLOCK = "2026-10-08T12:00:00.000Z";
const PAGE = "http://93.184.216.34/follow-up-study";

const ESSAY = (topic) =>
  `## ${topic}\n\n` +
  "We sell to small teams, so we write like one. Short sentences. A real deal, a real number, and the next step. " +
  "Most deals don't die in a no; they die in a silence nobody followed up on. ".repeat(5);
const db = {
  sites: [{ id: SITE, name: "Closewell", slug: "closewell", domain: "" }],
  collections: [{ site: SITE, name: "Test", slug: "test", description: "", is_hidden: false, position: 0 }],
  posts: [
    { id: "livepost0000001", site: SITE, title: "The deal that went quiet", subtitle: "", type: "Blog", status: "published", excerpt: "", slug: "quiet", tags: [], content_md: ESSAY("Silence"), published_at: "2026-09-01T00:00:00Z", word_count: 120 },
    { id: "livepost0000002", site: SITE, title: "Next steps, always", subtitle: "", type: "Blog", status: "published", excerpt: "", slug: "next-steps", tags: [], content_md: ESSAY("Next steps"), published_at: "2026-09-08T00:00:00Z", word_count: 120 },
  ],
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

const fetched = [];
const web = async (input, init) => {
  const url = String(input);
  fetched.push(url);
  if (url.startsWith("https://api.dataforseo.com/")) {
    const [{ keyword }] = JSON.parse(init.body);
    return Response.json({
      tasks: [{ status_code: 20000, result: [{ items: [
        { type: "organic", url: PAGE, title: `A study on ${keyword}`, description: "Numbers on sales follow-ups.", rank_absolute: 1 },
        { type: "organic", url: "http://10.0.0.5/internal", title: "Should never be read", description: "", rank_absolute: 2 },
      ] }] }],
    });
  }
  if (url.startsWith("http://93.184.216.34/")) {
    const html = `<html><head><title>Follow-up study</title></head><body><article><h1>Follow-ups</h1><p>${"In a 2026 survey of 600 small sales teams, 44% of reps gave up after one follow-up, while deals that closed took five touches on average. ".repeat(6)}</p></article></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  throw new Error(`stand-in web: unexpected fetch ${url}`);
};
process.env.DATAFORSEO_LOGIN = "login";
process.env.DATAFORSEO_PASSWORD = "password";

const rest = await standInRest(db, {
  clock: CLOCK,
  rpcs: {
    kb_search: ({ p_site }) =>
      p_site === SITE ? [{ id: "liveclaim000001", text: "Closewell costs $19 a seat a month.", status: "settled", scope: {}, topics: ["Product"], score: 1 }] : [],
  },
});
const t = await import("../../dist/agents/testing.js");
t.setWebFetch(web);
t.setSearchSleep(async () => {});
await launch(t, "pitch-write");

const goals = {
  quarter: "2026-Q4",
  volume: { total: 12, topics: [{ name: "Follow-ups", low: 4, high: 6 }, { name: "Product", low: 2, high: 4 }] },
  coverage: { internal: 6, external: 6 },
  searches: [{ query: "sales follow up reminders", position: 23 }],
  perWeek: 1,
};

try {
  console.log("voice guide");
  const v = await (await t.DBOS.startWorkflow(t.voiceGuideWorkflow)({ site: SITE, refresh: true })).getResult();
  const guide = db.voice_guides[0];
  check(v.source === "content" && guide?.body?.length > 100, `a voice guide from the tenant's posts (${v.source}, ${guide?.body?.length ?? 0} chars)`);

  console.log("pitcher");
  const ids = await t.handOffIdeas(
    SITE,
    [
      { title: "Reps give up after one follow-up", summary: "Three customers said on calls their reps stop after the first email.", origin: "calls", evidence: [{ label: "Call", quote: "they send one email and forget it" }], sourceAgent: "listener" },
      { title: "Something about sales maybe", summary: "A vague thought.", origin: "team", evidence: [], sourceAgent: "chat" },
    ],
    { pitchNow: false },
  );
  const p = await (await t.DBOS.startWorkflow(t.pitcher)({ site: SITE, ideaIds: ids, batch: 1, max: 1, draftTop: 1, goals, today: "2026-10-08" })).getResult();
  check(p.pitched.length === 1, `the idea with evidence was pitched (pitched ${p.pitched.length}, waiting ${p.waiting.length}, rejected ${p.rejected.length})`);
  const brief = db.briefs[0];
  check(brief?.status === "pitched" && brief.title && brief.angle && brief.audience, `a full pitch: "${brief?.title}"`);
  check(brief?.outline?.length >= 3, `with an outline (${brief?.outline?.length ?? 0} parts)`);
  check(brief?.fit?.reasons?.length >= 1, "and its fit");
  check(!fetched.some((u) => u.includes("10.0.0.5")), "never fetched the private address a search returned");

  console.log("writer");
  check(p.drafting?.length === 1, "the strongest pitch went to the Writer");
  const w = p.drafting?.[0] ? await t.DBOS.retrieveWorkflow(p.drafting[0]).getResult() : { status: "none" };
  check(w.status === "drafted", `drafted (${w.status}${w.reason ? `: ${w.reason}` : ""})`);
  const post = db.posts.find((x) => x.id === w.post);
  const words = post?.content_md?.split(/\s+/).filter(Boolean).length ?? 0;
  check(post?.status === "draft" && post.type === "Test" && words >= 400, `a draft post in the brief's collection (${words} words)`);
  check(post && t.contrastHits(post.content_md).length === 0, "house rule 1 held: no \"That's not X. It's Y.\"");
  const ver = db.post_versions.find((x) => x.post === w.post);
  check(ver?.created_by === "agent:writer" && ver.version === 1, "version 1, by the Writer");
  check(brief?.post === w.post, "the brief links the draft");

  const models = db.model_calls.filter((c) => !String(c.model).startsWith("dataforseo/"));
  check(models.length >= 3 && models.every((c) => c.status === "ok" && c.priced), `every model call logged and priced (${models.length})`);
} catch (err) {
  // A run that throws is a failure like any other; the cost so far is still reported.
  check(false, `threw: ${err.message}`);
} finally {
  await t.DBOS.shutdown();
  rest.close();
}

finish("pitch-write", state, db.model_calls);
