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
console.log("=== posts titled like balcon ===");
const posts=(await c.query(`select id, title, status, type, word_count, length(content_md) md, length(content::text) jsonb_len, created_at, updated_at from public.posts where title ilike '%balcon%'`)).rows;
console.log(posts);
for(const p of posts){
  console.log(`\n--- post ${p.id} '${p.title}' content_md head ---`);
  console.log((await c.query(`select left(content_md,200) h from public.posts where id=$1`,[p.id])).rows[0].h);
  console.log(`--- versions for ${p.id} ---`);
  console.log((await c.query(`select version, length(content) len, created_at, message, left(content,80) head from public.post_versions where post_id=$1 order by version desc`,[p.id])).rows);
  console.log(`--- jsonb head ---`);
  console.log((await c.query(`select left(content::text,300) h from public.posts where id=$1`,[p.id])).rows[0].h);
}
await c.end();
