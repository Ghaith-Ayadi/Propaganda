// node --test scripts/check-function-count.test.mjs (or npm test in api/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFunction } from "./check-function-count.mjs";

test("route files are functions", () => {
  for (const p of ["agents.ts", "chat/index.ts", "chat/conversations/[id]/messages.ts", "tool.mjs", "page.tsx"]) assert.equal(isFunction(p), true, p);
});

test("helpers, types, dependencies and data are not", () => {
  for (const p of ["_auth.ts", "_ai/gateway.ts", "chat/_x.ts", "types.d.ts", "node_modules/x/index.js", "package.json", ".hidden.ts"])
    assert.equal(isFunction(p), false, p);
});
