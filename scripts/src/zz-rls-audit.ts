import { join } from "node:path";
import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/Users/ghaithayadi/code/Personal/Propaganda/.env.local" });
const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const c = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await c.connect();
const tables = (await c.query(`
  select c.relname as table, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='r' order by c.relname`)).rows;
console.log("=== tables ===");
for (const t of tables) console.log(`${t.rls_enabled ? "RLS ON " : "rls off"}  ${t.table}`);
const pols = (await c.query(`
  select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname='public' order by tablename, policyname`)).rows;
console.log("\n=== policies ===");
if (!pols.length) console.log("(none)");
for (const p of pols) console.log(`${p.tablename} | ${p.policyname} | ${p.cmd} | roles=${p.roles} | using=${p.qual} | check=${p.with_check}`);
await c.end();
