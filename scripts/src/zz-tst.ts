import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });
const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const c = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = (await c.query(`select id, title, slug, post_id, type, status, word_count, length(content_md) md_len, updated_at from public.posts where post_id='TST·03' or slug='TST·03'`)).rows;
console.log("post:", r);
for(const p of r){
  console.log(`\n=== full content_md of ${p.id} ===`);
  console.log((await c.query(`select content_md from public.posts where id=$1`,[p.id])).rows[0].content_md);
}
console.log("\n=== Test collection hidden? ===");
console.log((await c.query(`select name, is_hidden from public.collections where name='Test'`)).rows);
await c.end();
