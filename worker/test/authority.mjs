// Which web sources may be cited (src/agents/authority.ts). No database.
import assert from "node:assert/strict";
import { authority, quotable, needsVetting, authorityQuery } from "../dist/agents/testing.js";

const tier = (u) => authority(u).tier;
const cases = [
  ["https://www.gartner.com/en/articles/x", "B"],
  ["https://www.nytimes.com/2026/01/01/x.html", "B"],
  ["https://www.newyorker.com/magazine/x", "B"],
  ["https://www.bain.com/insights/x/", "B"],
  ["https://hbr.org/2024/x", "B"],
  ["https://news.stanford.edu/x", "A"],
  ["https://www.ox.ac.uk/news/x", "A"],
  ["https://www.bls.gov/x", "A"],
  ["https://stripe.com/blog/x", "C"],
  ["https://fireflies.ai/blog/ai-follow-ups", "D"],
  ["https://app.fireflies.ai/x", "D"],
  ["https://en.wikipedia.org/wiki/X", "D"],
  ["https://www.reddit.com/r/x", "D"],
  ["https://kla-group.example/blog", "U"],
  ["not a url", "U"],
];
let failures = 0;
for (const [url, want] of cases) {
  try {
    assert.equal(tier(url), want);
    console.log(`  ok   ${url} is ${want}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${url}: ${e.message}`);
  }
}
for (const [url, want, own] of [
  ["https://fireflies.ai/x", false, []],
  ["https://gartner.com/x", true, []],
  ["https://unknown.example/x", false, []],
  ["https://blog.ppgd.example/x", true, ["ppgd.example"]],
  ["https://notgartner.com/x", false, []],
]) {
  try {
    assert.equal(quotable(url, own), want);
    console.log(`  ok   quotable ${url} = ${want}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL quotable ${url}: ${e.message}`);
  }
}
for (const [url, want] of [
  ["https://ai.cms.gov/x", true],
  ["https://news.stanford.edu/x", true],
  ["https://www.gartner.com/x", false],
  ["https://unknown.example/x", true],
  ["https://fireflies.ai/x", false],
]) {
  try {
    assert.equal(needsVetting(url), want);
    console.log(`  ok   needsVetting ${url} = ${want}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL needsVetting ${url}: ${e.message}`);
  }
}
try {
  const q = authorityQuery("Why small companies that let ChatGPT answer for them lose the buyers who ask it what the product costs and who else sells it");
  assert.ok(q.includes("site:edu") && q.split(" (study")[0].split(" ").length === 8, q);
  console.log("  ok   the authority search names the sources that count");
} catch (e) {
  failures++;
  console.log(`  FAIL authorityQuery: ${e.message}`);
}
if (failures) process.exit(1);
