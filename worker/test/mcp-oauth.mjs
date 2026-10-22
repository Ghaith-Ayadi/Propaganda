// Signing in to the MCP server with OAuth: register, authorize, the consent
// page's answer, the code for a token. No database: approve's membership
// check is the one thing not run here (it is requireMember, tested elsewhere).
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

process.env.POSTGRES_PASSWORD ??= "unused";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-00";
process.env.SUPABASE_URL = "https://app.example.test";

const { registerClient, authorize, exchange, protectedResource, authorizationServer, originOf, redirectAllowed, OAuthError } = await import("../dist/mcp/testing.js");

// the origin: the request's host (Caddy keeps it), else SUPABASE_URL (the dev box's is an inside address)
assert.equal(originOf({ headers: { host: "dev.propaganda.pub", "x-forwarded-proto": "https" } }), "https://dev.propaganda.pub");
assert.equal(originOf({ headers: { host: "gateway:8000" } }), "https://app.example.test");
assert.equal(originOf(), "https://app.example.test");
const O = originOf();

// metadata
assert.equal(protectedResource(O).resource, "https://app.example.test/worker/v1/mcp");
assert.deepEqual(protectedResource(O).authorization_servers, ["https://app.example.test"]);
const as = authorizationServer(O);
assert.equal(as.issuer, "https://app.example.test");
assert.equal(as.token_endpoint, "https://app.example.test/worker/v1/mcp/token");
assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);

// redirect URIs
assert.ok(redirectAllowed("https://claude.ai/api/mcp/auth_callback"));
assert.ok(redirectAllowed("http://localhost:53123/callback"));
assert.ok(!redirectAllowed("http://evil.example/callback"));
assert.ok(!redirectAllowed("javascript:alert(1)"));
assert.throws(() => registerClient({ redirect_uris: ["http://evil.example/cb"] }), OAuthError);
// another https host may register, but never under Claude's name
assert.throws(() => registerClient({ redirect_uris: ["https://evil.example/cb"], client_name: "Claude" }), (e) => e.code === "invalid_client_metadata");
assert.equal(registerClient({ redirect_uris: ["https://tool.example/cb"] }).client_name, "An app");
assert.equal(registerClient({ redirect_uris: ["http://127.0.0.1:4000/cb"], client_name: "Claude Code" }).client_name, "Claude Code");

// register
const claudeAi = registerClient({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" });
assert.match(claudeAi.client_id, /^mcpc_/);

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const params = (extra = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: claudeAi.client_id,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st8",
    ...extra,
  });

// authorize: to the consent page
const consent = new URL(authorize(params(), O));
assert.equal(consent.origin + consent.pathname, "https://app.example.test/connect/claude");
const request = consent.searchParams.get("request");
assert.ok(request);
// a forged client or a redirect it didn't register stops here, not at the client
assert.throws(() => authorize(params({ client_id: "mcpc_forged.x" }), O), OAuthError);
assert.throws(() => authorize(params({ redirect_uri: "https://evil.example/cb" }), O), OAuthError);
// no PKCE: back to the client with an error
const noPkce = new URL(authorize(params({ code_challenge_method: "plain" }), O));
assert.equal(noPkce.searchParams.get("error"), "invalid_request");
assert.equal(noPkce.searchParams.get("state"), "st8");

// approve without the database: deny needs no membership
const { approve } = await import("../dist/mcp/testing.js");
const denied = new URL(await approve(null, undefined, { request, deny: true }));
assert.equal(denied.searchParams.get("error"), "access_denied");
await assert.rejects(approve(null, undefined, { request: request + "x", deny: true }));

// a yes: approve's code, made the way approve makes it (membership stubbed)
const db = { query: async () => ({ rowCount: 1 }) };
const { createHmac } = await import("node:crypto");
const jwt = (() => {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  const s = createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `Bearer ${h}.${p}.${s}`;
})();
const back = new URL(await approve(db, jwt, { request, site: "site00000000001" }));
assert.equal(back.origin + back.pathname, "https://claude.ai/api/mcp/auth_callback");
assert.equal(back.searchParams.get("state"), "st8");
const code = back.searchParams.get("code");
assert.ok(code);

// token: wrong verifier, then right, then the same code again
const minted = [];
const mint = async (site, user, label) => (minted.push({ site, user, label }), { token: "ppk_test" });
const form = (extra = {}) =>
  new URLSearchParams({ grant_type: "authorization_code", code, client_id: claudeAi.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: verifier, ...extra });
await assert.rejects(exchange(form({ code_verifier: "nope" }), mint), (e) => e.code === "invalid_grant");
const noClient = form();
noClient.delete("client_id");
await assert.rejects(exchange(noClient, mint), (e) => e.code === "invalid_grant");
const tok = await exchange(form(), mint);
assert.equal(tok.access_token, "ppk_test");
assert.equal(tok.token_type, "Bearer");
assert.deepEqual(minted, [{ site: "site00000000001", user: "00000000-0000-4000-8000-000000000001", label: "Claude (connected)" }]);
await assert.rejects(exchange(form(), mint), (e) => e.code === "invalid_grant" && /already used/.test(e.message));

console.log("mcp oauth: ok");
