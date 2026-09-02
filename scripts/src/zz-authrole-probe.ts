// Verifies the `authenticated` RLS policies by switching role inside a
// transaction that is always rolled back. Nothing is written.
import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/Users/ghaithayadi/code/Personal/Propaganda/.env.local" });
const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const c = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin");
await c.query("set local role authenticated");
const check = async (label: string, sql: string) => {
  try { const r = await c.query(sql); console.log(`${label} → OK${r.rowCount !== null ? ` (${r.rowCount} rows)` : ""}`); }
  catch (e) { console.log(`${label} → ${(e as Error).message}`); }
};
await check("authenticated INSERT post    ", `insert into posts (title, slug, post_id, type, status, content_md, collection_seq) values ('rls probe','zz-rls-probe','TST-99','Test','draft','',99) returning id`);
await check("authenticated SELECT drafts  ", `select id from posts where status='draft' limit 3`);
await check("authenticated INSERT version ", `insert into post_versions (post_id, version, content, created_by) select id, 999, 'probe', 'user' from posts where status='draft' limit 1 returning id`);
await check("authenticated SELECT briefs  ", `select id from briefs limit 1`);
await check("authenticated SELECT activity", `select day from writing_activity limit 1`);
await c.query("rollback");
console.log("\nrolled back — nothing written");
const after = await c.query("select count(*) from posts where slug='zz-rls-probe'");
console.log("probe rows left behind:", after.rows[0].count);
await c.end();
