// One-off backfill: derive `posts.slug` from the title.
//
// History: migration 0011 introduced `post_id` ({PREFIX}·{SEQ}) and backfilled
// it FROM slug, leaving slug == post_id for every existing row. Slugs should be
// readable, title-derived strings; post_id stays as the immutable system code.
//
// Dry-run by default. Pass --apply to write.
//
//   node --experimental-strip-types src/backfill-slugs.ts          # preview
//   node --experimental-strip-types src/backfill-slugs.ts --apply  # commit

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { slugify, dedupeSlug } from "../../app/src/lib/postId.ts";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const apply = process.argv.includes("--apply");

const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const c = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query<{ id: number; title: string | null; slug: string }>(
  "select id, title, slug from public.posts order by id",
);

const taken = new Set<string>();
const updates: { id: number; from: string; to: string }[] = [];
for (const r of rows) {
  const title = (r.title ?? "").trim();
  const base = title ? slugify(title) : `untitled-${r.id}`;
  const next = dedupeSlug(base, taken);
  taken.add(next);
  if (next !== r.slug) updates.push({ id: r.id, from: r.slug, to: next });
}

console.log(`${rows.length} posts, ${updates.length} slug changes:`);
for (const u of updates.slice(0, 40)) console.log(`  ${u.id}: ${u.from}  →  ${u.to}`);
if (updates.length > 40) console.log(`  … and ${updates.length - 40} more`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write.");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  for (const u of updates) {
    await c.query("update public.posts set slug = $1 where id = $2", [u.to, u.id]);
  }
  await c.query("commit");
  console.log(`\nApplied ${updates.length} updates.`);
} catch (e) {
  await c.query("rollback");
  console.error("\nRolled back:", e);
  process.exitCode = 1;
}
await c.end();
