// tsx --test _chat/chat.test.ts
// The Chat agent end to end against a stub of the backend's REST API and a
// scripted model: lookups, hand-offs, citations, and a reply stopped mid-stream.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { CitationStream, Sources } from "./citations";
import type { ChatChunk, ChatEvent } from "./types";
import { UiReply } from "./ui";

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
    if (u.startsWith("/rest/v1/sites")) return void res.end(JSON.stringify([{ name: "Kontra" }]));
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

type Agent = typeof import("./agent");
type Gateway = typeof import("../_ai/gateway");
let agent: Agent;
let gateway: Gateway;
before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.SUPABASE_ANON_KEY = "anon";
  gateway = await import("../_ai/gateway");
  agent = await import("./agent");
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

test.after(() => server.close());
