// Apply a SQL migration from scripts/sql to the project's Supabase Postgres.
//
// The app's Supabase client uses the anon key, which can't run DDL, and
// Supabase has retired the direct db.<ref>.supabase.co host, so migrations go
// through the regional session pooler using SUPABASE_DB_PASSWORD from the repo
// .env files (never committed).
//
// Usage (from the app/ directory):
//   node scripts/run-migration.mjs 0014_briefs.sql
//   node scripts/run-migration.mjs            # lists available migrations
//
// Overridable via env: SUPABASE_DB_HOST, SUPABASE_DB_PORT, SUPABASE_DB_USER.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url)); // app/scripts
const root = join(here, "..", ".."); // repo root
const sqlDir = join(root, "scripts", "sql");

function loadEnv(p) {
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv(join(root, ".env.local"));
loadEnv(join(root, ".env.vercel-pull"));
loadEnv(join(root, ".env"));

const url = process.env.VITE_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!url || !password) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_DB_PASSWORD in env.");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/run-migration.mjs <file.sql>\nAvailable in scripts/sql:");
  for (const f of readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort()) {
    console.error("  " + f);
  }
  process.exit(1);
}
const sqlPath = isAbsolute(arg) ? arg : arg.includes("/") ? join(root, arg) : join(sqlDir, arg);
const sql = readFileSync(sqlPath, "utf8");

// Default to the project's eu-west-1 session pooler (IPv4). The DB password is
// the same for direct and pooler; the pooler just requires user postgres.<ref>.
const host = process.env.SUPABASE_DB_HOST || "aws-0-eu-west-1.pooler.supabase.com";
const isPooler = host.includes("pooler.supabase.com");
const user = process.env.SUPABASE_DB_USER || (isPooler ? `postgres.${ref}` : "postgres");

const client = new pg.Client({
  host,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user,
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

console.log(`Applying ${arg} to ${host} (project ${ref})…`);
try {
  await client.connect();
  await client.query(sql);
  console.log(`OK: applied ${arg}`);
} catch (e) {
  console.error("MIGRATION ERROR:", e.code || "", e.message);
  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch {}
}
