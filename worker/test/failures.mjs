// Fingerprints and scrubbing for the failure log (src/failures.ts). The sweep,
// the Admin routes and ticket filing run end to end in test/e2e.mjs.
import assert from "node:assert/strict";
import { fingerprintOf, scrub, signatureOf, stepKey } from "../dist/failures.js";

// The Strategist failure that started this: DBOS's retry wrapper around three gateway refusals.
const refusal = (id) =>
  `Free tier users do not have access to this model. Upgrade to paid credits at https://vercel.com/d?to=%2F%5Bteam%5D for unrestricted access. [gen_${id}]`;
const wrapped = (id) => `DBOSMaxStepRetriesError: Step propose has exceeded its maximum of 3 retries. Previous errors: Error 1: ${refusal(id)}. Error 2: ${refusal(id)}. Error 3: ${refusal(id)}.`;
const sig = signatureOf(wrapped("01K7ABCDEF123"));
assert.equal(sig, "free tier users do not have access to this model. upgrade to paid credits at <url> for unrestricted access");
// Same failure, other run: same group. Another step or workflow: another group.
assert.equal(signatureOf(wrapped("01K7ZZZZZZ999")), sig);
assert.equal(fingerprintOf("strategist", "propose", sig), fingerprintOf("strategist", "propose (again)", sig));
assert.notEqual(fingerprintOf("strategist", "propose", sig), fingerprintOf("pitcher", "propose", sig));
assert.match(fingerprintOf("strategist", "propose", sig), /^[0-9a-f]{16}$/);
// Ids, numbers and uuids don't split a group.
assert.equal(signatureOf("post abc123def456gh not found after 3 tries"), signatureOf("post zz9988776655aa not found after 4 tries"));
assert.equal(signatureOf("run 1b4e28ba-2fa1-11d2-883f-0016d3cca427 died"), "run <uuid> died");
assert.equal(stepKey("draft 2"), "draft");
assert.equal(stepKey("search arenaseed000001 1"), "search <id>");
assert.equal(stepKey("search arenaseed000004 2"), stepKey("search arenaseed000001 1"));
assert.equal(stepKey("judge ideas"), "judge ideas");
// Keys and tokens never leave the worker.
assert.doesNotMatch(scrub("Anthropic refused sk-ant-api03-abcdefghijklmnop"), /abcdefghij/);
assert.doesNotMatch(scrub("Authorization: Bearer eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl"), /eyJzdWIi/);
assert.doesNotMatch(scrub('{"api_key":"hunter2hunter2"}'), /hunter2/);
console.log("failures: all passed");
