import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/Users/ghaithayadi/code/Personal/Propaganda/.env.local" });
const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const c = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  select email,
         encrypted_password is not null and encrypted_password <> '' as has_password,
         last_sign_in_at,
         updated_at
  from auth.users`);
console.table(r.rows);
await c.end();
