// tsx --test _chat/chat.test.ts
// The Chat agent end to end against a stub of the backend's REST API and a
// scripted model: lookups, hand-offs, citations, and a reply stopped mid-stream.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { CitationStream, Sources } from "./citations.js";
import type { ChatChunk, ChatEvent } from "./types.js";
import { UiReply } from "./ui.js";

// ---- citations, no I/O ----

function run(s: CitationStream, deltas: string[]): ChatEvent[] {
  return [...deltas.flatMap((d) => s.push(d)), ...s.flush()];
}
const textOf = (es: ChatEvent[]) => es.map((e) => (e.type === "text" ? e.delta : e.type === "citation" ? `{${e.citation.n}}` : "")).join("");

test("markers split across deltas become numbered citations", () => {
  const src = new Sources();
  src.add({ kind: "claim", id: "claimaaaaaaaaaa", label: "Five seats." });
  src.add({ kind: "post", id: "postaaaaaaaaaaa", label: "Pricing" });
  const es = run(new CitationStream(src), ["It has five seats [[cla", "im:claimaaaaaaaaaa]] and the post [[post:posta", "aaaaaaaaaa]] says so [[claim:claimaaaaaaaaaa]]."]);
  assert.equal(textOf(es), "It has five seats {1} and the post {2} says so {1}.");
});

test("an unknown source is dropped; plain brackets stay text", () => {
  const src = new Sources();
  const es = run(new CitationStream(src), ["See [[claim:madeupmadeupmad]] and [this] or a[", "1]."]);
  assert.equal(textOf(es), "See  and [this] or a[1].");
  assert.ok(!es.some((e) => e.type === "citation"));
});

// ---- the agent ----

const calls: Record<string, unknown>[] = [];
const urls: string[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const u = req.url ?? "";
    if (u.startsWith("/rest/v1/rpc/cost_gate"))
      return void res.end(JSON.stringify({ tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false }));
    if (u.startsWith("/rest/v1/model_prices"))
      return void res.end(JSON.stringify([{ input_per_mtok: "3", output_per_mtok: "15", cache_read_per_mtok: "0", cache_write_per_mtok: "0" }]));
    if (u.startsWith("/rest/v1/model_calls")) { calls.push(JSON.parse(body)); res.statusCode = 201; return void res.end(""); }
    urls.push(decodeURIComponent(u));
    if (u.startsWith("/rest/v1/briefs"))
      return void res.end(JSON.stringify([{ id: "briefaaaaaaaaaa", title: "Best AI blog writer lists never ask the tool about your company", status: "pitched", angle: "Lists rank different winners.", body: `${"Filler. ".repeat(80)}Three lists rank three different winners because each tests one shared prompt on a topic nobody owns, where no claim can be wrong. More text after.` }]));
    if (u.startsWith("/rest/v1/agent_ideas"))
      return void res.end(JSON.stringify([{ id: "ideaaaaaaaaaaaa", title: "Lists never ask the tool", summary: "An idea.", status: "new", brief: null }]));
    if (u.startsWith("/rest/v1/kb_claims")) return void res.end("[]");
    if (u.startsWith("/rest/v1/posts"))
      return void res.end(JSON.stringify([
        { id: "postaaaaaaaaaaa", title: "Other lists", status: "draft", type: "Blog", published_at: null, excerpt: "", content_md: `lists lists ${"x ".repeat(300)}` },
        { id: "postbbbbbbbbbbb", title: "Prompt post", status: "draft", type: "Blog", published_at: null, excerpt: "", content_md: `${"y ".repeat(300)}each tests one shared prompt on a topic nobody owns, where no claim can be wrong. ${"z ".repeat(50)}` },
      ]));
    if (u.startsWith("/rest/v1/sites")) return void res.end(JSON.stringify([{ name: "Kontra" }]));
    if (u.startsWith("/rest/v1/goal_versions")) return void res.end("[]");
    if (u.startsWith("/rest/v1/strategy_proposals"))
      return void res.end(JSON.stringify([{
        quarter: "2026-Q4",
        status: "sent",
        proposal: {
          summary: "The blog answers what a director settles before July.",
          volume: { value: 20 },
          topics: [{ name: "What ultra-processed means on a tray", low: 2, high: 4, why: "The Collective session on October 22 gives the first post its material.", basis: "Their site says: the definition diverges (Collective session, Oct 22)." }],
          questions: ["Can we write a post from the October 22 Collective session?"],
        },
        inputs: { website: "https://www.example.com/", pages: ["https://www.example.com/", "https://www.example.com/collective", "https://www.example.com/collective"] },
      }]));
    if (u.startsWith("/rest/v1/app_settings")) return void res.end(JSON.stringify([{ value: "https://www.example.com/" }]));
    if (u.startsWith("/rest/v1/rpc/kb_search"))
      return void res.end(JSON.stringify([{ id: "claimaaaaaaaaaa", text: "The starter plan includes 5 seats.", status: "settled", topics: ["Pricing"] }]));
    res.statusCode = 404; res.end("{}");
  });
});

const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 100, text: 100, reasoning: 0 } };
const finish = (unified: "stop" | "tool-calls") => ({ type: "finish" as const, finishReason: { unified, raw: unified }, usage });

/** Step 1 searches the knowledge base; step 2 answers, citing what came back. */
function scripted(delayMs = 0) {
  let step = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      step++;
      // The mock's chunk union is wider than what TypeScript infers from either branch.
      const chunks: never[] = (
        step === 1
          ? [
              { type: "stream-start" as const, warnings: [] },
              { type: "tool-call" as const, toolCallId: "call1", toolName: "search_knowledge", input: JSON.stringify({ query: "starter seats" }) },
              finish("tool-calls"),
            ]
          : [
              { type: "stream-start" as const, warnings: [] },
              { type: "text-start" as const, id: "t" },
              ...["The starter plan ", "has five seats ", "[[claim:claimaaaaaaaaaa]]", ". That is ", "all it says."].map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
              { type: "text-end" as const, id: "t" },
              finish("stop"),
            ]) as never[];
      return { stream: simulateReadableStream({ initialDelayInMs: 0, chunkDelayInMs: delayMs, chunks }) };
    },
  });
}

type Agent = typeof import("./agent.js");
type Gateway = typeof import("../_ai/gateway.js");
let agent: Agent;
let gateway: Gateway;
before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.SUPABASE_ANON_KEY = "anon";
  gateway = await import("../_ai/gateway.js");
  agent = await import("./agent.js");
});

const turn = (signal: AbortSignal) => ({
  site: "siteaaaaaaaaaaa", userId: "00000000-0000-0000-0000-0000000000a1", token: "t", conversationId: "convaaaaaaaaaaa",
  text: "How many seats on starter?", history: [], signal,
});

test("a reply looks up the knowledge base, shows the hand-off, cites the claim, and logs each call", async () => {
  calls.length = 0;
  gateway.setModelResolver(() => scripted());
  const es: ChatEvent[] = [];
  for await (const e of agent.runChat(turn(new AbortController().signal))) es.push(e);

  const handoffs = es.flatMap((e) => (e.type === "handoff" ? [e] : []));
  assert.deepEqual(handoffs.map((h) => [h.id, h.handoff.agent, h.handoff.status]), [["call1", "guardian", "running"], ["call1", "guardian", "done"]]);
  const summaries = handoffs.map((h) => h.handoff.summary);
  assert.equal(summaries[1], "1 claim match");
  assert.equal(textOf(es), "The starter plan has five seats {1}. That is all it says.");
  const cite = es.find((e) => e.type === "citation");
  assert.equal(cite?.type === "citation" && cite.citation.label, "The starter plan includes 5 seats.");
  const done = es[es.length - 1];
  assert.equal(done.type, "done");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.job === "chat" && c.status === "ok" && c.background === false));
  assert.equal(done.type === "done" && done.costUsd, 2 * (1000 * 3 + 100 * 15) / 1e6);
});

test("Stop mid-reply ends the stream quietly and logs the stopped call", async () => {
  calls.length = 0;
  gateway.setModelResolver(() => scripted(25));
  const ctrl = new AbortController();
  const es: ChatEvent[] = [];
  for await (const e of agent.runChat(turn(ctrl.signal))) {
    es.push(e);
    if (e.type === "citation") ctrl.abort();
  }
  assert.ok(!es.some((e) => e.type === "done" || e.type === "error"));
  assert.deepEqual(calls.map((c) => c.status), ["ok", "stopped"]);
  assert.ok((calls[1].output_tokens as number) > 0);
});

test("history keeps text, names citations and summarizes hand-offs", () => {
  const msgs = agent.historyMessages([
    { id: "a", role: "user", parts: [{ type: "text", text: "Seats?" }] },
    {
      id: "b", role: "assistant", metadata: { stopped: true },
      parts: [
        { type: "data-handoff", id: "h", data: { agent: "guardian", task: "Search", status: "done", summary: "1 claim matches" } },
        { type: "text", text: "Five [1](#cite-1)" },
        { type: "data-citation", id: "cite-claim-x", data: { n: 1, kind: "claim", id: "x", label: "Five seats." } },
        { type: "data-action", id: "a1", data: { kind: "remember", label: "Remember this", statement: "Five seats." } },
      ],
    },
  ]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].content, "(guardian: Search: 1 claim matches, done)\nFive  [source: Five seats.]\n(stopped by the operator)");
});

// ---- the UI message stream ----

test("events become useChat's chunks, and the stored message is what the reader saw", () => {
  const chunks: ChatChunk[] = [];
  let k = 0;
  const r = new UiReply((c) => chunks.push(c), () => `p${++k}`, "reply0000000001");
  r.title("Seats on starter");
  const running = { agent: "guardian" as const, task: "Search", status: "running" as const };
  r.push({ type: "handoff", id: "call1", handoff: running });
  r.push({ type: "handoff", id: "call1", handoff: { ...running, status: "done", summary: "1 claim match" } });
  r.push({ type: "text", delta: "Five seats " });
  const cite = { n: 1, kind: "claim" as const, id: "x", label: "Five seats." };
  r.push({ type: "citation", citation: cite });
  r.push({ type: "text", delta: " and again " });
  r.push({ type: "citation", citation: cite });
  r.push({ type: "action", action: { kind: "remember", label: "Remember this", statement: "Five seats." } });
  r.push({ type: "done", costUsd: 0.0123 });

  assert.deepEqual(chunks.map((c) => c.type), [
    "start", "data-title", "data-handoff", "data-handoff", "text-start", "text-delta", "text-delta", "data-citation",
    "text-delta", "text-delta", "text-end", "data-action", "finish",
  ]);
  assert.deepEqual(chunks[0], { type: "start", messageId: "reply0000000001" });
  assert.equal((chunks[1] as { transient?: boolean }).transient, true);
  // The hand-off is re-sent under the tool call's id; the citation once per source.
  assert.deepEqual(chunks.filter((c) => c.type === "data-handoff").map((c) => (c as { id: string }).id), ["call1", "call1"]);
  assert.deepEqual(chunks[chunks.length - 1], { type: "finish", messageMetadata: { costUsd: 0.0123 } });

  assert.deepEqual(r.message, {
    id: "reply0000000001",
    role: "assistant",
    metadata: { costUsd: 0.0123 },
    parts: [
      { type: "data-handoff", id: "call1", data: { ...running, status: "done", summary: "1 claim match" } },
      { type: "text", text: "Five seats [1](#cite-1) and again [1](#cite-1)" },
      { type: "data-citation", id: "cite-claim-x", data: cite },
      { type: "data-action", id: "p2", data: { kind: "remember", label: "Remember this", statement: "Five seats." } },
    ],
  });
});

test("a stopped reply keeps what arrived, marked stopped; an error is sent as the SDK's error", () => {
  const chunks: ChatChunk[] = [];
  const r = new UiReply((c) => chunks.push(c), () => "t1", "reply0000000002");
  r.push({ type: "text", delta: "Half" });
  r.stopped();
  assert.deepEqual(chunks.slice(-2), [{ type: "text-end", id: "t1" }, { type: "abort" }]);
  assert.deepEqual(r.message.metadata, { stopped: true });
  assert.deepEqual(r.message.parts, [{ type: "text", text: "Half" }]);

  const e: ChatChunk[] = [];
  new UiReply((c) => e.push(c), () => "t2", "reply0000000003").push({ type: "error", message: "No." });
  assert.deepEqual(e.slice(-1), [{ type: "error", errorText: "No." }]);
});

// ---- lookups ----

test("an excerpt is cut around the whole phrase, else around the densest cluster of words", async () => {
  const { passage, searchWords } = await import("./lookups.js");
  const text = `${"alpha ".repeat(100)}omega beta gamma delta${" filler".repeat(100)} gamma alpha`;
  const q = "gamma delta beta";
  assert.match(passage(text, q, searchWords(q)), /beta gamma delta/);
  assert.match(passage(text, "omega beta", searchWords("omega beta")), /omega beta/);
});

test("search_posts puts the post that holds the sentence first and shows that sentence", async () => {
  const { searchPosts } = await import("./lookups.js");
  urls.length = 0;
  const q = "each tests one shared prompt on a topic nobody owns";
  const hits = await searchPosts("t", "siteaaaaaaaaaaa", q);
  assert.equal(hits[0].id, "postbbbbbbbbbbb");
  assert.equal(hits[0].exact, true);
  assert.match(hits[0].excerpt, /shared prompt on a topic nobody owns/);
  // Every word is asked for first, so a sentence does not match on one word alone.
  assert.match(urls[0], /and=\(/);
});

test("search_pitches finds a pitch by a sentence in its body and an idea by its title", async () => {
  const { searchPitches } = await import("./lookups.js");
  const hits = await searchPitches("t", "siteaaaaaaaaaaa", "three different winners because each tests one shared prompt");
  const brief = hits.find((h) => h.kind === "brief");
  assert.equal(brief?.id, "briefaaaaaaaaaa");
  assert.equal(brief?.exact, true);
  assert.match(brief?.excerpt ?? "", /three different winners/);
  assert.ok(hits.some((h) => h.kind === "idea"));
});

test("an empty knowledge base reports a count of zero", async () => {
  const { searchKnowledge } = await import("./lookups.js");
  const full = await searchKnowledge("t", "siteaaaaaaaaaaa", "starter seats");
  assert.ok(full.available && full.claims.length === 1 && full.total === null);
});

test("offer_open says a button shows, and the prompt does not let Chat claim it opened anything", async () => {
  calls.length = 0;
  let step = 0;
  gateway.setModelResolver(
    () =>
      new MockLanguageModelV3({
        doStream: async () => {
          step++;
          const chunks = (
            step === 1
              ? [
                  { type: "stream-start" as const, warnings: [] },
                  { type: "tool-call" as const, toolCallId: "c1", toolName: "search_pitches", input: JSON.stringify({ query: "different winners" }) },
                  finish("tool-calls"),
                ]
              : step === 2
                ? [
                    { type: "stream-start" as const, warnings: [] },
                    { type: "tool-call" as const, toolCallId: "c2", toolName: "offer_open", input: JSON.stringify({ kind: "brief", id: "briefaaaaaaaaaa" }) },
                    finish("tool-calls"),
                  ]
                : [{ type: "stream-start" as const, warnings: [] }, { type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: "It is the pitch below." }, { type: "text-end" as const, id: "t" }, finish("stop")]
          ) as never[];
          return { stream: simulateReadableStream({ initialDelayInMs: 0, chunkDelayInMs: 0, chunks }) };
        },
      }),
  );
  const es: ChatEvent[] = [];
  for await (const e of agent.runChat(turn(new AbortController().signal))) es.push(e);
  const action = es.find((e) => e.type === "action");
  assert.ok(action?.type === "action" && action.action.kind === "open" && action.action.target?.kind === "brief");
  assert.ok(es.some((e) => e.type === "handoff" && e.handoff.agent === "pitcher"));
});

test("read_goals shows a waiting proposal in full: topics, reasons, sources, questions and the pages it read", async () => {
  const { readGoals } = await import("./lookups.js");
  const out = await readGoals("t", "siteaaaaaaaaaaa");
  assert.match(out, /No goals approved yet/);
  assert.match(out, /PROPOSED goals for 2026-Q4/);
  assert.match(out, /Topic "What ultra-processed means on a tray": 2 to 4 posts/);
  assert.match(out, /Based on: Their site says: the definition diverges \(Collective session, Oct 22\)/);
  assert.match(out, /Can we write a post from the October 22 Collective session\?/);
  assert.match(out, /Website pages it read \(read_website opens them\): https:\/\/www\.example\.com\/, https:\/\/www\.example\.com\/collective$/);
});

test("read_website reads only the tenant's own host, follows redirects there, and finds the passage", async () => {
  const web = await import("./website.js");
  assert.equal(typeof web.onTheirSite("https://evil.example.org/x", "https://www.example.com/"), "string");
  assert.equal((web.onTheirSite("/collective", "https://www.example.com/") as URL).toString(), "https://www.example.com/collective");
  assert.equal((web.onTheirSite("https://example.com/a", "https://www.example.com/") as URL).hostname, "example.com");
  const html = `<html><head><title>Gaia Collective</title><script>x()</script></head><body><nav>Menu</nav><main>${"<p>Filler.</p>".repeat(900)}<h3>Making Sense of Ultra-Processed Foods</h3><p>Upcoming &middot; Oct 22. Tarrah Westercamp talks.</p></main></body></html>`;
  web.setWebsiteTransport(async (u) => {
    if (u.pathname === "/old") return { status: 301, headers: { location: "/collective" }, body: "" };
    if (u.pathname === "/off") return { status: 302, headers: { location: "https://elsewhere.org/" }, body: "" };
    return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html };
  });
  const r = await web.readWebsite("t", "siteaaaaaaaaaaa", "/old", "ultra-processed Oct 22", 1_000);
  assert.ok(r.ok);
  assert.equal(r.page.url, "https://www.example.com/collective");
  assert.equal(r.page.title, "Gaia Collective");
  assert.match(r.page.text, /### Making Sense of Ultra-Processed Foods/);
  assert.match(r.page.text, /Oct 22\. Tarrah Westercamp/);
  assert.doesNotMatch(r.page.text, /Menu|x\(\)/);
  const off = await web.readWebsite("t", "siteaaaaaaaaaaa", "/off");
  assert.ok(!off.ok && /off their site/.test(off.reason));
  assert.equal(typeof web.onTheirSite("https://www.example.com:9001/", "https://www.example.com/"), "string");
  web.setWebsiteTransport(null);
});

test("read_website's address guard: embedded IPv4 forms, and the address checked is the one connected to", async () => {
  const web = await import("./website.js");
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "192.0.0.8", "198.18.0.1", "::1", "::", "fe80::1", "fd00::1",
    "::ffff:7f00:1", "[::ffff:7f00:1]", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "ff02::1", "not-an-ip"]) {
    assert.equal(web.isPublicAddress(ip), false, ip);
  }
  for (const ip of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:5db8:d822", "2002:5db8:d822::1"]) assert.equal(web.isPublicAddress(ip), true, ip);
  assert.equal(new URL("http://[::ffff:127.0.0.1]:9001/").hostname, "[::ffff:7f00:1]");

  assert.equal(web.isPublicAddress(new URL("http://[::ffff:a9fe:a9fe]/").hostname), false);

  // The lookup the socket connects through resolves once and checks that answer:
  // a host that answers public first and loopback next is refused the second time.
  let calls = 0;
  const lookup = web.guardedLookup(async () => (++calls === 1 ? ["93.184.216.34"] : ["93.184.216.34", "127.0.0.1"]));
  const ask = () =>
    new Promise<{ err: string; address: unknown }>((r) =>
      lookup("rebind.example.com", { all: true }, (err, address) => r({ err: err?.message ?? "", address })),
    );
  const first = await ask();
  assert.equal(first.err, "");
  assert.deepEqual(first.address, [{ address: "93.184.216.34", family: 4 }]);
  const second = await ask();
  assert.match(second.err, /not a public address: rebind\.example\.com \(127\.0\.0\.1\)/);
  assert.equal(calls, 2);

  // The real request path: their host resolving to loopback is refused at connect.
  web.setWebsiteTransport(null, async () => ["127.0.0.1"]);
  const r = await web.readWebsite("t", "siteaaaaaaaaaaa", "/");
  assert.ok(!r.ok && /not a public address/.test(r.reason), JSON.stringify(r));
  web.setWebsiteTransport(null, async () => ["::ffff:7f00:1"]);
  const r2 = await web.readWebsite("t", "siteaaaaaaaaaaa", "/");
  assert.ok(!r2.ok && /not a public address/.test(r2.reason), JSON.stringify(r2));
});

test("a reply that promises a button without offer_open gets one for what it cited", () => {
  const c = { kind: "brief" as const, id: "briefaaaaaaaaaa", label: "Parents call any food they distrust ultra-processed", n: 1 };
  const a = agent.promisedButton("The button below opens that pitch.", [c], false);
  assert.equal(a?.kind, "open");
  assert.equal(a?.target?.id, "briefaaaaaaaaaa");
  assert.equal(agent.promisedButton("The button below opens it.", [c], true), null);
  assert.equal(agent.promisedButton("That pitch says so.", [c], false), null);
  assert.equal(agent.pageName("https://www.example.com/collective/"), "/collective");
  assert.equal(agent.pageName("https://www.example.com/"), "the home page");
});

test.after(() => server.close());

test("the tenant's style rules follow the twenty rules in Chat's prompt", async () => {
  const { systemPrompt } = await import("./toolkit.js");
  const { stylesBlock } = await import("../_ai/houseStyle.js");
  assert.equal(stylesBlock([]), "");
  assert.equal(stylesBlock([{ rule: "  ", example: "" }]), "");
  const block = stylesBlock([{ rule: "Jokes are welcome.", example: "A ski instructor line." }]);
  const prompt = systemPrompt("Acme", block);
  assert.ok(prompt.indexOf("Jokes are welcome.") > prompt.indexOf("20. Write to one reader"));
  assert.match(prompt, /never reuse the line\): A ski instructor line\./);
  assert.ok(!systemPrompt("Acme").includes("own style rules"));
});
