// node --experimental-strip-types --test (npm test in app/): the words the
// table puts next to a search's numbers follow the bands the header promises.
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalOf, verdictOf } from "./verdict.ts";

test("what page one takes follows the links alone, in the header's four bands", () => {
  assert.equal(verdictOf({ referringDomains: null }), "no data");
  assert.equal(verdictOf({ referringDomains: 0 }), "open ground");
  assert.equal(verdictOf({ referringDomains: 9 }), "open ground");
  assert.equal(verdictOf({ referringDomains: 10 }), "a quarter");
  assert.equal(verdictOf({ referringDomains: 30 }), "a quarter");
  assert.equal(verdictOf({ referringDomains: 31 }), "a year");
  assert.equal(verdictOf({ referringDomains: 80 }), "a year");
  assert.equal(verdictOf({ referringDomains: 81 }), "beyond a post");
  assert.equal(verdictOf({ referringDomains: 120 }), "beyond a post");
});

test("the goal line follows the bucket, and page one needs the top 20 today", () => {
  assert.equal(goalOf({ bucket: "now", position: null }).label, "Climb toward page one");
  assert.equal(goalOf({ bucket: undefined, position: 45 }).label, "Climb toward page one");
  assert.equal(goalOf({ bucket: "now", position: 14 }).label, "Page one");
  assert.equal(goalOf({ bucket: "later", position: 14 }).label, "Top 30, then top 20");
  assert.equal(goalOf({ bucket: "nodata", position: null }).label, "Tracked");
});
