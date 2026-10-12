// The page reader on real home pages (test/fixtures, saved 2026-10-12): what a
// site shows must not come back as what the company says. No database; the
// fetch is a stub serving the fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { htmlToText, dropDecoration, sitePaths, siteClaims, readSite, setWebFetch } from "../dist/agents/testing.js";

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

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const propaganda = fixture("propaganda-home.html");
const granola = fixture("granola-home.html");

console.log("page reader");

await check("dropDecoration removes a hidden subtree and keeps its neighbours", () => {
  const html = `<p>Before.</p><div aria-hidden="true"><div><p>Hidden.</p></div><img src="x"></div><p>After.</p><img aria-hidden="true" src="y"><p>End.</p>`;
  assert.equal(htmlToText(dropDecoration(html)), "Before.\nAfter.\nEnd.");
});

await check("htmlToText drops illustrations, figures, testimonials and role=img, keeps a button's text", () => {
  const html = `<main><h2>Why</h2><p>Real copy.</p><div class="illo slot" data-slot="x"><p>Fake pipeline.</p></div><figure><figcaption>A caption.</figcaption></figure><button class="tab">Join</button><span role="img">★★★★★</span><section class="testimonials"><p>"Loved it", a customer.</p></section><p>More copy.</p></main>`;
  const text = htmlToText(html);
  assert.equal(text, "## Why\nReal copy.\nJoin More copy.");
});

await check("headings keep their level", () => {
  assert.equal(htmlToText("<h1>Title</h1><p>a</p><h3 class='x'>Sub</h3><p>b</p>"), "# Title\na\n\n### Sub\nb");
});

await check("propaganda.pub: none of the Closewell demo survives, the copy does", () => {
  const text = htmlToText(propaganda);
  for (const demo of ["Closewell", "Haldane", "Maya Okafor", "Lina Haddad", "month-end close", "SOC 2", "Strong fit", "Scale plan"]) {
    assert.ok(!text.includes(demo), `demo text "${demo}" survived`);
  }
  assert.ok(text.includes("## Writing is the easy part."), "the heading is kept as a heading");
  assert.ok(text.includes("knowing what's true"), "the body under it is kept");
  assert.ok(text.includes("We keep everything in sync"), "the feature list is kept");
  assert.ok(text.length < 8_000, `the whole page now fits the 8,000-character window (${text.length})`);
});

await check("granola.ai: the demo meeting goes, the product copy stays", () => {
  const text = htmlToText(granola);
  const before = htmlToText(granola.replace(/aria-hidden="true"/g, ""));
  assert.ok(before.toLowerCase().includes("northwind"), "the fixture does carry the demo");
  assert.ok(!text.toLowerCase().includes("northwind"), "the demo meeting is dropped");
  assert.ok(text.length > 1_500, `real copy remains (${text.length} chars)`);
});

await check("sitePaths ranks the menu's pages and skips blog, legal, app", () => {
  const paths = sitePaths(propaganda, new URL("https://propaganda.pub/"), 6);
  assert.deepEqual(paths.slice(0, 3).sort(), ["/goals", "/how-it-works", "/pricing"].sort(), paths.join(","));
  assert.ok(!paths.includes("/blog") && !paths.some((p) => p.startsWith("/admin")), paths.join(","));
  const g = sitePaths(granola, new URL("https://www.granola.ai/"), 6);
  assert.ok(g.includes("/pricing"), g.join(","));
  assert.ok(!g.some((p) => /^\/(blog|jobs|contact|policies|security|third-party-licenses)/.test(p)), g.join(","));
});

await check("siteClaims counts repeated sentences, trims punctuation, keeps page order", () => {
  const claims = siteClaims(["## Writing is the easy part.\nAnyone can make a machine write a blog post now.", "Writing is the easy part!\n- Knowledge base and the Guardian\nAnyone can make a machine write a blog post now."]);
  assert.deepEqual(claims[0], { text: "Writing is the easy part", count: 2 });
  assert.deepEqual(claims[1], { text: "Anyone can make a machine write a blog post now", count: 2 });
  assert.ok(claims.some((c) => c.text === "Knowledge base and the Guardian" && c.count === 1));
  assert.ok(!claims.some((c) => c.text.length < 20));
});

await check("readSite reads the home page, then the pages its menu links, and falls back", async () => {
  const pages = {
    "https://propaganda.pub/": propaganda,
    "https://propaganda.pub/pricing": "<main><h1>Pricing</h1><p>Cheaper than a content marketer. Doesn't quit after eight months.</p></main>",
    "https://propaganda.pub/goals": "<main><p>Content without goals is a hobby. Content without goals is a hobby.</p></main>",
  };
  const asked = [];
  setWebFetch(async (url) => {
    asked.push(String(url));
    const html = pages[String(url)];
    return new Response(html ?? "not found", { status: html ? 200 : 404, headers: { "content-type": "text/html" } });
  });
  const site = await readSite("propaganda.pub", { limit: 4 });
  assert.equal(site.pages[0].url, "https://propaganda.pub/");
  assert.ok(site.pages.some((p) => p.url.endsWith("/pricing")) && site.pages.some((p) => p.url.endsWith("/goals")), site.pages.map((p) => p.url).join(","));
  assert.ok(site.skipped.length >= 1 && site.skipped.every((s) => /answered 404/.test(s.reason)), JSON.stringify(site.skipped));
  assert.ok(!asked.some((u) => u.includes("/blog") || u.includes("/about")), "fixed paths are not tried when the menu has pages");
  assert.ok(site.claims.some((c) => c.text === "Content without goals is a hobby" && c.count === 2), "claims come from every page read");
  assert.ok(!JSON.stringify(site).includes("Closewell"));

  const bare = await (async () => {
    setWebFetch(async (url) => {
      const u = String(url);
      const html = u === "https://93.184.215.14/" ? "<main><p>A home page with no links at all, just this.</p></main>" : u.endsWith("/about") ? "<main><p>About us, one paragraph.</p></main>" : null;
      return new Response(html ?? "", { status: html ? 200 : 404, headers: { "content-type": "text/html" } });
    });
    return readSite("https://93.184.215.14");
  })();
  assert.deepEqual(bare.pages.map((p) => new URL(p.url).pathname), ["/", "/about"], "the old fixed paths are tried when the home page links nothing");
});

await check("readSite survives an unreadable home page", async () => {
  setWebFetch(async () => new Response("", { status: 503 }));
  const site = await readSite("https://93.184.215.14");
  assert.deepEqual(site.pages, []);
  assert.equal(site.skipped.length, 1);
});
setWebFetch(fetch);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
