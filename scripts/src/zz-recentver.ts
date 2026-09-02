import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/Users/ghaithayadi/code/Personal/Propaganda/.env.local" });
const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const c = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await c.connect();
const v = await c.query(`select v.post_id, v.version, v.message, v.created_at, p.type, p.title
  from post_versions v join posts p on p.id = v.post_id
  where v.created_at > now() - interval '3 hours' order by v.created_at desc limit 10`);
console.log("version rows in the last 3h:", v.rowCount);
console.table(v.rows);
const p = await c.query(`select id, type, title, status, created_at from posts where created_at > now() - interval '3 hours' order by created_at desc limit 10`);
console.log("posts created in the last 3h:", p.rowCount);
console.table(p.rows);
await c.end();
