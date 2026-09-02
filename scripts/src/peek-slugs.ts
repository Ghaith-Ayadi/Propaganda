import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const c = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await c.connect();

const total = await c.query("select count(*)::int n from public.posts");
const stale = await c.query("select count(*)::int n from public.posts where slug is not distinct from post_id");
const noTitle = await c.query("select count(*)::int n from public.posts where coalesce(trim(title),'') = ''");
console.log("total posts:", total.rows[0].n);
console.log("slug == post_id (stale):", stale.rows[0].n);
console.log("empty title:", noTitle.rows[0].n);

// unique constraints / indexes on slug
const idx = await c.query(`
  select indexname, indexdef from pg_indexes
  where tablename='posts' and indexdef ilike '%slug%'`);
console.log("\nslug indexes:", JSON.stringify(idx.rows, null, 2));

// sample of stale rows
const sample = await c.query(`
  select id, slug, post_id, title, status from public.posts
  where slug is not distinct from post_id order by id limit 25`);
console.log("\nsample stale rows:");
for (const r of sample.rows) console.log(`  ${r.id} | slug=${r.slug} | pid=${r.post_id} | ${r.status} | ${r.title}`);

await c.end();
