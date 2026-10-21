// tsx --test _blog/fill.test.ts
// Values with `$&`, `$'`, `` $` `` and `$$` in them (a title, an excerpt, a
// theme value) must land in the shell as written: String.prototype.replace
// would otherwise splice the shell into the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fillModule from "../../app/src/blog/server/fill.js";
const { fillShell } = fillModule;

const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Propaganda</title>
    <script type="module" src="/assets/index.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

test("fillShell keeps $ patterns in the head, the styles, the markup and the attributes as written", () => {
  const head = `<title>Money $& $' tips</title>`;
  const css = [`.pg{--price:"$$5";--q:"$\`"}`];
  const markup = `<h1>Money $& $' tips</h1><p>Costs $$5, see $\` and $1.</p>`;
  const out = fillShell(shell, { head, css, markup, htmlAttrs: `style="background:#fff;content:'$&'"`, favicon: "/x$&.png" });
  assert.ok(out.includes(head));
  assert.ok(out.includes(`<style>${css[0]}</style>`));
  assert.ok(out.includes(`<div id="pg-ssr">${markup}</div>`));
  assert.ok(out.includes(`<html lang="en" style="background:#fff;content:'$&'">`));
  assert.ok(out.includes(`<link rel="icon" href="/x$&.png">`));
  assert.equal(out.match(/<div id="root"><\/div>/g)?.length, 1, "one #root");
  assert.ok(!out.includes("<title>Propaganda</title>"), "the shell's title is replaced");
  assert.ok(out.includes('src="/assets/index.js"'), "the shell's script stays");
});

test("fillShell leaves the html tag and favicon alone when not asked", () => {
  const out = fillShell(shell, { head: "<title>T</title>", css: [], markup: "<p>x</p>" });
  assert.ok(out.includes('<html lang="en">'));
  assert.ok(out.includes('href="/favicon.svg"'));
});

test("a fragment wrapped in the shell's pieces is the filled shell, with and without a favicon or attributes", () => {
  const { fragmentOf, shellPieces, wrap } = fillModule;
  const pieces = shellPieces(shell);
  const cases = [
    { head: `<title>Money $& $' tips</title>`, css: [`.pg{--price:"$$5"}`], markup: `<h1>$&</h1>`, htmlAttrs: `style="background:#fff"`, favicon: "/x$&.png" },
    { head: "<title>T</title>", css: [], markup: "<p>x</p>" },
  ];
  for (const c of cases) assert.equal(wrap(pieces, fragmentOf(c)), fillShell(shell, c));
  assert.throws(() => shellPieces("<html><body></body></html>"), /not the app's shell/);
});
