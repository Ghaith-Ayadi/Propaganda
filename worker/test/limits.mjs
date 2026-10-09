// usageLimitOf against every shape a usage limit can arrive in.
import assert from "node:assert/strict";
import { UsageLimitError, refusedOf, tenantKeyOf, usageLimitOf } from "../dist/limits.js";

const at = 1_791_410_433_000;
// The gateway's own error (api/_ai/gateway.ts): a different class, same shape.
class GatewayUsageLimitError extends Error {
  constructor(resetsAt) {
    super("Usage limit reached");
    this.name = "UsageLimitError";
    this.resetsAt = resetsAt;
  }
}
assert.equal(usageLimitOf(new GatewayUsageLimitError(at)), at);
assert.equal(usageLimitOf(new UsageLimitError(at)), at);
// After DBOS stored and reloaded it: a plain object, message kept.
assert.equal(usageLimitOf({ name: "UsageLimitError", message: `USAGE-LIMIT until ${at}` }), at);
// The AI SDK's APICallError, headers as a record or a Headers object.
const apiError = (headers) => Object.assign(new Error("Too Many Requests"), { statusCode: 429, responseHeaders: headers });
assert.equal(usageLimitOf(apiError({ "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": String(at / 1000) })), at);
assert.equal(usageLimitOf(apiError(new Headers({ "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": String(at / 1000) }))), at);
// Wrapped: DBOS's retry error, a cause chain.
assert.equal(usageLimitOf({ name: "DBOSMaxStepRetriesError", errors: [new Error("x"), new UsageLimitError(at)] }), at);
assert.equal(usageLimitOf(new Error("outer", { cause: new UsageLimitError(at) })), at);
// Not a usage limit: an ordinary 429 (per-minute rate limit), a 500, nothing.
assert.equal(usageLimitOf(apiError({ "anthropic-ratelimit-unified-status": "allowed" })), null);
assert.equal(usageLimitOf(Object.assign(new Error("boom"), { statusCode: 500 })), null);
assert.equal(usageLimitOf(null), null);
assert.equal(usageLimitOf("text"), null);
// A tenant's own key that failed (BYOK, api/_ai/modelKeys.ts): its own stall, never a usage limit.
class TenantKeyError extends Error {
  constructor(message, retryAt = null) {
    super(`TENANT-KEY ${message}`);
    this.name = "TenantKeyError";
    this.retryAt = retryAt;
  }
}
assert.deepEqual(tenantKeyOf(new TenantKeyError("Anthropic refused the key: invalid x-api-key")), { retryAt: null, message: "Anthropic refused the key: invalid x-api-key" });
assert.equal(tenantKeyOf(new TenantKeyError("rate limited", at)).retryAt, at);
assert.equal(tenantKeyOf({ name: "Error", message: "TENANT-KEY out of credit" }).message, "out of credit");
assert.equal(tenantKeyOf({ name: "DBOSMaxStepRetriesError", errors: [new TenantKeyError("x")] }).message, "x");
assert.equal(usageLimitOf(new TenantKeyError("x")), null);
assert.equal(tenantKeyOf(new UsageLimitError(at)), null);
assert.equal(tenantKeyOf(new Error("boom")), null);
// Refused before it ran (the AI Gateway's free tier, a bad request): never retried.
assert.equal(refusedOf(Object.assign(new Error("Free tier users do not have access to this model."), { statusCode: 403 })), true);
assert.equal(refusedOf(Object.assign(new Error("bad"), { statusCode: 400 })), true);
assert.equal(refusedOf(Object.assign(new Error("slow down"), { statusCode: 429 })), false);
assert.equal(refusedOf(Object.assign(new Error("timeout"), { statusCode: 408 })), false);
assert.equal(refusedOf(Object.assign(new Error("boom"), { statusCode: 500 })), false);
assert.equal(refusedOf(new Error("no status")), false);
console.log("limits: all passed");
