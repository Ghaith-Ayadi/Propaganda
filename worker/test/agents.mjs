// The agents' code that needs no model or database: the verdict rules against
// the Guardian fixtures' expected checks, the number check, passages and links.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { cleanChecks, decide, links, numbersMatch, passages, severityOf } from "../dist/agents/testing.js";

// ---- verdicts: given the checks a fixture expects, the code reaches its verdict ----
const fixtures = parse(readFileSync(new URL("./guardian-fixtures.yaml", import.meta.url), "utf8"));
let n = 0;
for (const f of fixtures) {
  const checks = cleanChecks(
    Object.entries(f.expect.checks ?? {}).map(([check, result]) => ({ check, result, reason: "fixture" })),
  );
  const origin = f.origin === "pushback" ? "contest" : f.origin;
  // A fixture on an owned topic that supersedes is H2's case.
  const retiresProtected = Boolean(f.owned_topic && f.supersede);
  const out = decide({ origin, checks, retiresProtected });
  const verdict = out.sweepContested ? "admit" : out.verdict;
  assert.equal(verdict, f.expect.verdict, `${f.id}: ${out.verdict}`);
  if (f.expect.checks?.C11) assert.equal(severityOf(checks, ["supersede"]), f.expect.checks.C11, f.id);
  n++;
}
console.log(`  ok   ${n} fixture verdicts`);

// A Remember is admitted even with a failed check; a sweep never escalates.
assert.equal(decide({ origin: "remember", checks: cleanChecks([{ check: "C5", result: "fail" }]), retiresProtected: true }).verdict, "admit");
assert.equal(decide({ origin: "sweep", checks: cleanChecks([{ check: "C8", result: "escalate" }]), retiresProtected: false }).verdict, "admit");
// H2 is added when an admit would retire a protected claim.
const h2 = decide({ origin: "chat", checks: [], retiresProtected: true });
assert.equal(h2.verdict, "escalate");
assert.ok(h2.checks.some((c) => c.check === "H2" && c.result === "escalate"));
// The database's shape: unknown checks and results are dropped, duplicates keep the strictest.
assert.deepEqual(
  cleanChecks([{ check: "c1", result: "PASS" }, { check: "C1", result: "fail", reason: "x" }, { check: "Z9", result: "pass" }, { check: "C2", result: "warn" }]),
  [{ check: "C1", result: "fail", reason: "x" }],
);
console.log("  ok   verdict rules");

// ---- C5, mechanically ----
assert.deepEqual(numbersMatch("Tidewell has 300 clinics.", ["we're at about 300 clinics now"]).ok, false);
assert.equal(numbersMatch("Tidewell has about 300 clinics.", ["we're at about 300 clinics now"]).ok, true);
assert.equal(numbersMatch("Tidewell supports 6 languages.", ["available in 4 languages"]).ok, false);
assert.equal(numbersMatch("Tidewell has 1,200 users.", ["1200 users"]).ok, true);
assert.equal(numbersMatch("Onboarding takes one week.", ["a week"]).ok, true);
console.log("  ok   number check");

// ---- passages and links ----
const md = `# Title\n\nShort.\n\nThis paragraph is long enough to count as a passage.\n\n![img](https://x/y.png)\n\n` +
  "```\ncode block that is long enough to be skipped\n```\n\n" +
  `We grew 40% last year ([source](https://example.com/report)). See also https://example.org/a.`;
assert.deepEqual(passages(md), [
  "This paragraph is long enough to count as a passage.",
  "We grew 40% last year ([source](https://example.com/report)). See also https://example.org/a.",
]);
const ls = links(md);
assert.deepEqual(ls.map((l) => l.url), ["https://example.com/report", "https://example.org/a"]);
assert.ok(ls[0].context.includes("We grew 40%"));
console.log("  ok   passages and links");
