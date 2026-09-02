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

console.log("=== post_versions cols ===");
const cols = (await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='post_versions' order by ordinal_position`)).rows.map(r=>r.column_name);
console.log(cols.join(", "));

console.log("\n=== versions mentioning 'balcon' ===");
console.log((await c.query(`select id, post_id, version, length(content) len, created_at, message, left(content,120) preview from public.post_versions where content ilike '%balcon%' order by created_at desc limit 10`)).rows);

console.log("\n=== UNTITLED posts (empty/near-empty title) touched today ===");
console.log((await c.query(`select id, title, status, slug, type, length(content_md) md, created_at, updated_at from public.posts where (title is null or trim(title)='') and updated_at::date='2026-07-10' order by updated_at desc`)).rows);

console.log("\n=== post 332 'On vision' current body head ===");
console.log((await c.query(`select id, title, status, left(content_md,300) body from public.posts where id=332`)).rows[0]);

console.log("\n=== all versions for post 332 ===");
console.log((await c.query(`select version, length(content) len, created_at, created_by, message from public.post_versions where post_id=332 order by version desc`)).rows);

console.log("\n=== posts updated at 00:33:04 today (the batch push) ===");
console.log((await c.query(`select id, title, status, length(content_md) md from public.posts where updated_at between '2026-07-10T00:33:00Z' and '2026-07-10T00:33:10Z' order by id`)).rows);
await c.end();
