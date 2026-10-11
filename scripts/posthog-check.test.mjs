// node --test scripts/posthog-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSince, queries } from "./posthog-check.mjs";

test("--since takes minutes, hours and days", () => {
  assert.equal(parseSince("30m"), 30);
  assert.equal(parseSince("2h"), 120);
  assert.equal(parseSince("1d"), 1440);
});

test("--since refuses anything else", () => {
  for (const bad of ["", "soon", "2", "0m", "99d", "1; drop table"]) assert.throws(() => parseSince(bad), bad);
});

test("every query is scoped to the window and leaves out the artificial test events", () => {
  for (const env of ["dev", "prod", "all"]) {
    for (const sql of Object.values(queries(env, 90))) {
      assert.match(sql, /interval 90 minute/);
      assert.match(sql, /artificial-test/);
    }
  }
});
