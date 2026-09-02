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
console.log("=== app_settings ===");
console.log((await c.query(`select key, value from public.app_settings order by key`)).rows);
console.log("\n=== writing_activity this-month + last-30d totals (server truth) ===");
console.log((await c.query(`select
  sum(words) filter (where day >= date_trunc('month', now())) as this_month,
  sum(words) filter (where day >= now()::date - 30) as last_30d,
  sum(words) filter (where day >= now()::date - 7) as last_7d,
  max(day) as last_day
 from public.writing_activity where tenant='verbatim'`)).rows);
await c.end();
