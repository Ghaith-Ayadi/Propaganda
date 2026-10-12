// Admin > Runs' flows (src/flows.ts): which runs go together, in what order,
// and that every workflow the worker registers has a kind for the Display chips.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HIDDEN_BY_DEFAULT, KINDS, groupFlows } from "../dist/flows.js";

const run = (id, name, at, more = {}) => ({
  id, name, state: "done", status: "SUCCESS", site: "s1", createdAt: at, updatedAt: at + 5, completedAt: at + 5,
  stall: null, error: null, cost: { usd: 0.01, calls: 1, unpriced: 0 }, parentId: null, forkedFrom: null,
  recoveryAttempts: 1, queue: "agents", ...more,
});

// Day one: the plan, its pitches (one topic failed, then retried by fork), and the drafts a poll started later.
const runs = [
  run("strategist-p1", "strategist", 100),
  run("first-pitches-p1", "strategist:first-pitches", 110, { parentId: "strategist-p1" }),
  run("first-pitches-p1-t0", "strategist:topic-pitches", 111, { parentId: "first-pitches-p1" }),
  run("first-pitches-p1-t1", "strategist:topic-pitches", 112, { parentId: "first-pitches-p1", state: "failed", status: "ERROR", error: "boom" }),
  run("fork1", "strategist:topic-pitches", 150, { forkedFrom: "first-pitches-p1-t1" }),
  run("first-drafts-p1", "strategist:first-drafts", 200),
  run("w1", "writer", 201, { parentId: "first-drafts-p1", state: "running", status: "PENDING", completedAt: null }),
  // Unrelated: a Meet poll and a Checker run.
  run("poll1", "meet-poll", 300, { site: null }),
  run("chk1", "checker", 50, { cost: null }),
];

const flows = groupFlows(runs, new Map([["p1", "onboarding"]]));
assert.deepEqual(flows.map((f) => f.id), ["poll1", "strategist-p1", "chk1"], "three flows, newest first");

const day = flows.find((f) => f.id === "strategist-p1");
assert.equal(day.label, "Onboarding sequence");
assert.equal(day.kind, "onboarding");
assert.equal(day.category, "flows");
assert.deepEqual(
  day.runs.map((r) => [r.id, r.depth, r.retryOf]),
  [
    ["strategist-p1", 0, null],
    ["first-pitches-p1", 1, null],
    ["first-pitches-p1-t0", 2, null],
    ["first-pitches-p1-t1", 2, null],
    ["fork1", 2, "first-pitches-p1-t1"],
    ["first-drafts-p1", 0, null],
    ["w1", 1, null],
  ],
  "children nest, the retry follows what it retried, the drafts come next",
);
assert.equal(day.runs[3].superseded, true, "the failed topic was replaced by its retry");
assert.equal(day.runs[3].label, "Pitches for topic 2");
assert.equal(day.state, "running", "a draft still going: the flow is running");
assert.equal(day.endedAt, null);
assert.equal(day.retries, 1);
assert.equal(day.failures, 1);
assert.equal(day.cost.calls, 7);

const poll = flows.find((f) => f.id === "poll1");
assert.equal(poll.category, "crons");
assert.ok(HIDDEN_BY_DEFAULT.includes(poll.kind), "crons are hidden until shown");
assert.equal(flows.find((f) => f.id === "chk1").cost, null, "no cost log: no total");

// The retry failed too: the flow failed. Without the proposal's kind it is just a proposal.
const failed = groupFlows(runs.map((r) => (r.id === "fork1" ? { ...r, state: "failed", status: "ERROR" } : r.id === "w1" ? { ...r, state: "done", status: "SUCCESS", completedAt: 260 } : r)));
const plan = failed.find((f) => f.id === "strategist-p1");
assert.equal(plan.state, "failed");
assert.equal(plan.label, "Strategist proposal");
assert.equal(plan.endedAt, 260);

// A retry that worked: the flow is done.
const fixed = groupFlows(runs.map((r) => (r.id === "w1" ? { ...r, state: "done", status: "SUCCESS", completedAt: 260 } : r)), new Map([["p1", "onboarding"]]));
assert.equal(fixed.find((f) => f.id === "strategist-p1").state, "done");

// Every registered workflow has a kind.
const names = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) for (const m of readFileSync(p, "utf8").matchAll(/registerWorkflow\([^)]*\{\s*name:\s*"([^"]+)"/g)) names.push(m[1]);
  }
};
walk(new URL("../src", import.meta.url).pathname);
assert.ok(names.length > 20, `found the workflows (${names.length})`);
const known = new Set(KINDS.flatMap((k) => k.names));
assert.deepEqual(names.filter((n) => !known.has(n)), [], "every workflow is in a kind (src/flows.ts KINDS)");

console.log("flows: ok");
