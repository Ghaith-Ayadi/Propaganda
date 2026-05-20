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
const total = await c.query("select count(*)::int as n from public.posts");
const withNotion = await c.query("select count(*)::int as n from public.posts where notion_id is not null");
const sample = await c.query("select id, title, notion_id, created_at from public.posts where notion_id is not null limit 3");
console.log(JSON.stringify({ total: total.rows[0].n, withNotion: withNotion.rows[0].n, sample: sample.rows }, null, 2));
await c.end();
