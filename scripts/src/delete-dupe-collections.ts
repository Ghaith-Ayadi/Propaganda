import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });
const ref = new URL(process.env.VITE_SUPABASE_URL!).hostname.split(".")[0];
const client = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await client.connect();
// Delete collections with no posts that are obvious lowercase duplicates
const { rowCount } = await client.query(`
  delete from public.collections
  where name in ('hokum', 'brief', 'journal')
    and not exists (select 1 from public.posts where posts.type = collections.name)
`);
console.log(`Deleted ${rowCount} duplicate collections.`);
await client.end();
