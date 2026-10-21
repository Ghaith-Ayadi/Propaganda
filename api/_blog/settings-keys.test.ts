// tsx --test _blog/settings-keys.test.ts
// The rendering function fetches only PUBLIC_SETTING_KEYS (app/src/blog/server/
// api.ts). Every settings key the renderer reads must be in that list, or the
// server renders the page without it and the browser fills it in later.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const blog = resolve(import.meta.dirname, "../../app/src/blog");
const read = (file: string) => readFileSync(resolve(blog, file), "utf8");

/** The files whose settings reads end up in a server-rendered page or feed. */
const RENDERER = ["original.ts", "theme/input.ts", "server/page.tsx", "server/feeds.tsx", "server/entry.tsx"];
const KEY = /"((?:site|author|favicon|blog)\.[a-z.]+)"/g;

test("every settings key the renderer reads is fetched", () => {
  const list = read("server/api.ts").match(/PUBLIC_SETTING_KEYS = \[([^\]]*)\]/)?.[1];
  assert.ok(list, "PUBLIC_SETTING_KEYS found");
  const fetched = new Set([...list.matchAll(KEY)].map((m) => m[1]));
  const missing = new Set<string>();
  for (const file of RENDERER) for (const m of read(file).matchAll(KEY)) if (!fetched.has(m[1])) missing.add(`${m[1]} (${file})`);
  assert.deepEqual([...missing], [], "keys read but not in PUBLIC_SETTING_KEYS");
});
