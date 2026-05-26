import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });
const ref = new URL(process.env.VITE_SUPABASE_URL!).hostname.split(".")[0];
const client = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await client.connect();
// Check the actual columns
const { rows: cols } = await client.query(`select column_name from information_schema.columns where table_name = 'collections' order by ordinal_position`);
console.log("columns:", cols.map(r => r.column_name));
const { rows } = await client.query(`select * from public.collections order by position`);
console.log(JSON.stringify(rows, null, 2));
await client.end();
