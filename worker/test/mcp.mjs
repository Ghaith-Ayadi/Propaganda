// The MCP server's JSON-RPC handling, with its own tools: no database, no
// model. And the assign door's input check and the token shape.
import assert from "node:assert/strict";

process.env.POSTGRES_PASSWORD ??= "unused";

const { handle, handleBody, TOOLS, PROTOCOL, checkAssign, AssignError, allowAssign, ASSIGNS_PER_HOUR, newApiToken, hashToken, TOKEN_RE } = await import("../dist/mcp/testing.js");

const token = { id: "tok000000000001", site: "site00000000001", label: "t", scopes: ["read", "assign"], createdBy: "00000000-0000-4000-8000-000000000001", lastSeen: null, created: "" };
const ctx = { db: null, token };
const tools = [
  { name: "echo", description: "says it back", scope: "read", inputSchema: { type: "object" }, run: async (args) => ({ got: args }) },
  { name: "boom", description: "fails", scope: "assign", inputSchema: { type: "object" }, run: async () => { throw new AssignError(404, "no such collection"); } },
];

// initialize
const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }, ctx, tools);
assert.equal(init.result.protocolVersion, PROTOCOL);
assert.equal(init.result.serverInfo.name, "propaganda");
assert.ok(init.result.capabilities.tools);

// a notification gets nothing back
assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx, tools), null);

// tools/list, filtered by the token's scopes
const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx, tools);
assert.deepEqual(list.result.tools.map((t) => t.name), ["echo", "boom"]);
const readOnly = await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { ...ctx, token: { ...token, scopes: ["read"] } }, tools);
assert.deepEqual(readOnly.result.tools.map((t) => t.name), ["echo"]);

// tools/call
const call = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } }, ctx, tools);
assert.deepEqual(call.result.structuredContent, { got: { a: 1 } });
assert.equal(call.result.content[0].type, "text");
const refused = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom", arguments: {} } }, ctx, tools);
assert.equal(refused.result.isError, true);
assert.match(refused.result.content[0].text, /no such collection/);
const noScope = await handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "boom" } }, { ...ctx, token: { ...token, scopes: ["read"] } }, tools);
assert.equal(noScope.error.code, -32602);
const unknown = await handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nope" } }, ctx, tools);
assert.equal(unknown.error.code, -32602);
assert.equal((await handle({ jsonrpc: "2.0", id: 8, method: "resources/list" }, ctx, tools)).error.code, -32601);
assert.equal((await handle({ id: 9, method: "ping" }, ctx, tools)).error.code, -32600);
assert.deepEqual((await handle({ jsonrpc: "2.0", id: 10, method: "ping" }, ctx, tools)).result, {});

// a batch answers the requests and drops the notifications
const batch = await handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 11, method: "ping" }], ctx, tools);
assert.equal(batch.length, 1);
assert.equal(await handleBody([{ jsonrpc: "2.0", method: "notifications/initialized" }], ctx, tools), null);

// the real tools exist and have schemas
assert.deepEqual(TOOLS.map((t) => t.name), ["list_collections", "assign_post"]);
for (const t of TOOLS) assert.equal(t.inputSchema.type, "object");

// assign input
const ok = checkAssign({ title: "  A post ", markdown: "# body", assets: [{ name: "fig", kind: "image", url: "https://x/y.png" }] });
assert.equal(ok.title, "A post");
assert.equal(ok.assets[0].url, "https://x/y.png");
assert.throws(() => checkAssign({ markdown: "x" }), /title/);
assert.throws(() => checkAssign({ title: "x" }), /markdown/);
assert.throws(() => checkAssign({ title: "x", markdown: "y", assets: [{ name: "a", kind: "video", url: "https://x" }] }), /image or pdf/);
assert.throws(() => checkAssign({ title: "x", markdown: "y", assets: [{ name: "a", kind: "pdf" }] }), /url or base64/);
assert.equal(checkAssign({ title: "x", markdown: "y", assets: [{ name: "a", kind: "pdf", data: "AAAA" }] }).assets[0].data, "AAAA");

// the hourly cap per token
const t0 = 1_000_000_000_000;
for (let i = 0; i < ASSIGNS_PER_HOUR; i++) assert.equal(allowAssign("tok", t0 + i), true);
assert.equal(allowAssign("tok", t0 + 100), false);
assert.equal(allowAssign("other", t0 + 100), true);
assert.equal(allowAssign("tok", t0 + 3_600_001), true);

// tokens
const t = newApiToken();
assert.match(t, TOKEN_RE);
assert.match(hashToken(t), /^[0-9a-f]{64}$/);
assert.notEqual(newApiToken(), t);

console.log("mcp: ok");

// ---- assignPost against a stub PostgREST (fetch is replaced; no database, no Writer) ----
process.env.SUPABASE_URL = "http://stub";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub";
process.env.WORKER_DISPATCH_SECRET = "";
const { assignPost } = await import("../dist/mcp/testing.js");

/** The calls made, and a backend that fails where `failOn` says. */
function stubBackend({ failOn = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const path = u.pathname.replace(/^\/rest\/v1/, "");
    calls.push(`${method} ${path}`);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/collections") return json([{ id: "col000000000001", name: "Research", slug: "research", description: "", is_hidden: false }]);
    if (path === "/collection_rules") return json([]);
    if (path === "/posts" && method === "GET") return json([]);
    if (path === "/posts" && method === "POST") return json([JSON.parse(init.body)]);
    if (path === "/posts" && method === "DELETE") return json([]);
    if (path === "/briefs" && method === "POST") return failOn === "briefs" ? json({ code: "23503", message: "nope" }, 409) : json([JSON.parse(init.body)]);
    return json({ message: `unexpected ${method} ${path}` }, 500);
  };
  return calls;
}

const base = { site: "site00000000001", user: "00000000-0000-4000-8000-000000000001", title: "A post", collection: "research", markdown: "# body", via: "test" };
{
  const calls = stubBackend();
  const r = await assignPost(null, base);
  assert.match(r.post, /^[a-z0-9]{15}$/);
  assert.equal(r.collection, "Research");
  assert.match(r.url, new RegExp(`/admin#/post/${r.post}$`));
  // the draft goes in before the brief that references it
  assert.deepEqual(calls.filter((c) => c.startsWith("POST")), ["POST /posts", "POST /briefs"]);
  assert.ok(!calls.some((c) => c.startsWith("DELETE")));
  // no Writer is registered here: said so, not thrown
  assert.equal(r.run, null);
  assert.match(r.notStarted, /Writer/);
}
{
  const calls = stubBackend({ failOn: "briefs" });
  await assert.rejects(() => assignPost(null, base), /briefs insert/);
  // the empty draft is taken back
  assert.ok(calls.some((c) => c.startsWith("DELETE /posts")));
}
{
  stubBackend();
  await assert.rejects(() => assignPost(null, { ...base, collection: "Nope" }), (err) => err instanceof AssignError && err.status === 404);
}

console.log("mcp assign: ok");
