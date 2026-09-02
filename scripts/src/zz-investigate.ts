import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });
const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const c = new pg.Client({
  connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const anon = createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

console.log("=== enum values now ===");
console.log(
  (await c.query(
    `select e.enumlabel from pg_type t join pg_enum e on e.enumtypid=t.oid
     where t.typname='enum_posts_status' order by e.enumsortorder`,
  )).rows.map((r) => r.enumlabel),
);

// Verify anon upsert with status='done' now works, then revert.
const r = (await c.query(`select * from public.posts where id=234`)).rows[0];
const row = {
  id: r.id, title: r.title ?? "", slug: r.slug ?? "", post_id: r.post_id ?? null,
  type: r.type, status: "done", subtitle: r.subtitle ?? null, done_at: r.done_at,
  published_at: r.published_at, excerpt: r.excerpt, category: r.category,
  content_md: r.content_md, notion_id: r.notion_id, favorited: r.favorited,
  collection_seq: r.collection_seq ?? null, word_count: r.word_count ?? null,
  shareable_quotes: r.shareable_quotes ?? null,
};
const { error } = await anon.from("posts").upsert([row]).select("id,status");
console.log("anon upsert status='done' error:", error);
await c.query(`update public.posts set status='published' where id=234`);
console.log("(reverted 234 to published)");
await c.end();
