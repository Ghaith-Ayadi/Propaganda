// tsx --test _chat/http.test.ts
// The api/chat/* functions over HTTP shapes: auth, DefaultChatTransport's
// body, storing both sides of a conversation, the UI message stream (SSE),
// Retry replacing a reply, and a stopped reply kept as stopped.
// The backend is an in-memory stub of the REST endpoints they use.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

const USER = "00000000-0000-0000-0000-0000000000a1";
const SITE = "siteaaaaaaaaaaa";
const token = `x.${Buffer.from(JSON.stringify({ sub: USER })).toString("base64url")}.y`;
const db = { conversations: [] as Record<string, unknown>[], messages: [] as Record<string, unknown>[], calls: [] as Record<string, unknown>[] };

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const u = new URL(req.url ?? "/", "http://x");
    const send = (v: unknown, status = 200) => { res.statusCode = status; res.end(v === undefined ? "" : JSON.stringify(v)); };
    const p = u.pathname;
    if (p === "/auth/v1/user") return send({ id: USER });
    if (p === "/rest/v1/site_members") return send(u.searchParams.get("site") === `eq.${SITE}` ? [{ id: "m" }] : []);
    if (p === "/rest/v1/rpc/cost_gate") return send({ tenant_month_usd: 0, tenant_monthly_limit: null, tenant_warn_ratio: 0.8, global_day_usd: 0, global_daily_limit: null, killed: false });
    if (p === "/rest/v1/model_prices") return send([]);
    if (p === "/rest/v1/model_calls") { db.calls.push(JSON.parse(body)); return send(undefined, 201); }
    if (p === "/rest/v1/sites") return send([{ name: "Kontra" }]);
    if (p === "/rest/v1/chat_conversations") {
      if (req.method === "POST") {
        const row = { ...JSON.parse(body), title: "New chat", created: "2026-10-08T00:00:00Z", updated: "2026-10-08T00:00:00Z" };
        db.conversations.push(row);
        return send([row], 201);
      }
      const id = u.searchParams.get("id")?.slice(3);
      const rows = db.conversations.filter((c) => !id || c.id === id);
      if (req.method === "PATCH") { rows.forEach((r) => Object.assign(r, JSON.parse(body))); return send(undefined, 204); }
      return send(rows);
    }
    if (p === "/rest/v1/chat_messages") {
      if (req.method === "POST") {
        const row = JSON.parse(body);
        // on_conflict=conversation,id with ignore-duplicates
        if (!db.messages.some((m) => m.id === row.id && m.conversation === row.conversation)) db.messages.push(row);
        return send(undefined, 201);
      }
      if (req.method === "DELETE") {
        const id = u.searchParams.get("id")?.slice(3);
        db.messages = db.messages.filter((m) => m.id !== id);
        return send(undefined, 204);
      }
      return send([...db.messages].reverse());
    }
    send({}, 404);
  });
});

function model(delayMs: number) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunkDelayInMs: delayMs,
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          ...["Hello ", "there, ", "operator", "."].map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 4, text: 4, reasoning: 0 } } },
        ],
      }),
    }),
  });
}

let chat: typeof import("../chat/index");
let conversations: typeof import("../chat/conversations/index");
let messages: typeof import("../chat/conversations/[id]/messages");
let gateway: typeof import("../_ai/gateway");
const settle = () => new Promise((r) => setTimeout(r, 50));

before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  gateway = await import("../_ai/gateway");
  // On our account (the private list), so the scripted model answers.
  gateway.setAccounts({ siteaaaaaaaaaaa: "private" });
  chat = await import("../chat/index");
  conversations = await import("../chat/conversations/index");
  messages = await import("../chat/conversations/[id]/messages");
});

const req = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });

test("a stranger to the site is refused", async () => {
  const res = await conversations.GET(req(`/api/chat/conversations?site=sitebbbbbbbbbbb`));
  assert.equal(res.status, 403);
});

/** DefaultChatTransport's body, as app/src/lib/chat/adapter.ts sends it. */
const send = (text: string, id: string, trigger = "submit-message") =>
  JSON.stringify({ site: SITE, id: "convaaaaaaaaaaa", trigger, message: { id, role: "user", parts: [{ type: "text", text }] } });

/** The SSE body as the UI message chunks useChat reads. */
async function chunksOf(res: Response): Promise<Record<string, unknown>[]> {
  const body = await res.text();
  return body
    .split("\n\n")
    .map((e) => e.replace(/^data: /, "").trim())
    .filter((d) => d && d !== "[DONE]")
    .map((d) => JSON.parse(d));
}

test("create, send, stream, store both sides", async () => {
  gateway.setModelResolver(() => model(0));
  const c = await conversations.POST(req("/api/chat/conversations", { method: "POST", body: JSON.stringify({ site: SITE, id: "convaaaaaaaaaaa" }) }));
  assert.equal(c.status, 201);

  const res = await chat.POST(req("/api/chat", { method: "POST", body: send("Say hello to the operator please", "Ab3dE6gH9jK2mN5p") }));
  assert.equal(res.headers.get("x-vercel-ai-ui-message-stream"), "v1");
  const chunks = await chunksOf(res);
  assert.equal(chunks[0].type, "start");
  const replyId = chunks[0].messageId;
  assert.deepEqual(chunks[1], { type: "data-title", data: { title: "Say hello to the operator please" }, transient: true });
  assert.equal(chunks.filter((e) => e.type === "text-delta").map((e) => e.delta).join(""), "Hello there, operator.");
  assert.deepEqual(chunks[chunks.length - 1], { type: "finish", messageMetadata: { costUsd: 0 } });
  await settle();

  const list = await (await messages.GET(req(`/api/chat/conversations/convaaaaaaaaaaa/messages?site=${SITE}`))).json();
  assert.deepEqual(list, [
    { id: "Ab3dE6gH9jK2mN5p", role: "user", parts: [{ type: "text", text: "Say hello to the operator please" }], metadata: {} },
    { id: replyId, role: "assistant", parts: [{ type: "text", text: "Hello there, operator." }], metadata: { costUsd: 0 } },
  ]);
  assert.equal(db.conversations[0].title, "Say hello to the operator please");
});

test("Retry replaces the reply and keeps one copy of the question", async () => {
  gateway.setModelResolver(() => model(0));
  const before = db.messages.find((m) => m.role === "assistant")?.id;
  const res = await chat.POST(req("/api/chat", { method: "POST", body: send("Say hello to the operator please", "Ab3dE6gH9jK2mN5p", "regenerate-message") }));
  const chunks = await chunksOf(res);
  assert.ok(!chunks.some((e) => e.type === "data-title"), "a title only on the first reply");
  await settle();
  assert.deepEqual(db.messages.map((m) => m.role), ["user", "assistant"]);
  assert.notEqual(db.messages[1].id, before);
});

test("a bad body is refused before anything is stored", async () => {
  const n = db.messages.length;
  for (const body of [
    JSON.stringify({ site: SITE, id: "convaaaaaaaaaaa", trigger: "nope", message: { id: "x", role: "user", parts: [{ type: "text", text: "hi" }] } }),
    JSON.stringify({ site: SITE, id: "convaaaaaaaaaaa", trigger: "submit-message", message: { id: "x", role: "assistant", parts: [{ type: "text", text: "hi" }] } }),
    JSON.stringify({ site: SITE, id: "convaaaaaaaaaaa", trigger: "submit-message", message: { id: "x", role: "user", parts: [] } }),
  ]) {
    assert.equal((await chat.POST(req("/api/chat", { method: "POST", body }))).status, 400);
  }
  assert.equal(db.messages.length, n);
});

test("the reader leaving keeps the reply as stopped and logs the call", async () => {
  gateway.setModelResolver(() => model(40));
  db.messages.length = 0; db.calls.length = 0;
  const res = await chat.POST(req("/api/chat", { method: "POST", body: send("Again", "Qw3rTy6uI9oP2aS5") }));
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("text-delta")) seen += decoder.decode((await reader.read()).value);
  await reader.cancel(); // closing the tab: only the response is cancelled
  await new Promise((r) => setTimeout(r, 300));
  const reply = db.messages.find((m) => m.role === "assistant");
  assert.deepEqual(reply?.metadata, { stopped: true });
  assert.equal((reply?.parts as { text: string }[])[0].text, "Hello ");
  assert.deepEqual(db.calls.map((c) => c.status), ["stopped"]);
});

test.after(() => server.close());
