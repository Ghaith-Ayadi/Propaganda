// The agents' shared helpers (src/agents): no database, no network.
import assert from "node:assert/strict";
import { extractJson, htmlToText, assertPublicUrl, newId, stableId, setWebFetch } from "../dist/agents/testing.js";

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

console.log("shared agent helpers");
await check("extractJson reads fenced JSON", () => assert.deepEqual(extractJson('Here:\n```json\n{"a": 1}\n```'), { a: 1 }));
await check("extractJson finds JSON inside prose", () => assert.deepEqual(extractJson('Sure. [1, 2] Done.'), [1, 2]));
await check("extractJson throws on no JSON", () => assert.throws(() => extractJson("nothing here")));
await check("htmlToText keeps the article, drops scripts", () => {
  const text = htmlToText(`<nav>menu</nav><script>x()</script><article>${"<p>Body text.</p>".repeat(60)}</article>`);
  assert.ok(text.startsWith("Body text."));
  assert.ok(!text.includes("menu") && !text.includes("x()"));
});
await check("assertPublicUrl refuses the box's neighbours", async () => {
  for (const u of ["http://127.0.0.1/", "http://10.0.0.5/", "http://[::1]/", "http://169.254.169.254/", "file:///etc/passwd", "http://a:b@example.com/"]) {
    await assert.rejects(assertPublicUrl(u), undefined, u);
  }
});
await check("assertPublicUrl accepts a public address", async () => assert.equal((await assertPublicUrl("http://93.184.215.14/")).hostname, "93.184.215.14"));
await check("ids have the app's shape", () => {
  assert.match(newId(), /^[a-z0-9]{15}$/);
  assert.equal(stableId("k"), stableId("k"));
  assert.notEqual(stableId("k"), stableId("l"));
});
setWebFetch(fetch);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
