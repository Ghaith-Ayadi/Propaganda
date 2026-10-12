// Lite tenants get no AI: the dispatcher's look for KB work (kb/read.ts
// pendingWork) skips a tenant whose app_settings `tenant.plan` is "lite",
// against a real Postgres with the app's migrations. Run through test/run.sh.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { pendingWork, setAppDb } from "../dist/agents/testing.js";

const PGURL = process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432";
const APP = "worker_test_lite_app";
const ROOT = new URL("../..", import.meta.url).pathname;
const FULL = "fullsite0000000";
const LITE = "litesite0000000";

const admin = new pg.Client({ connectionString: `${PGURL}/postgres` });
await admin.connect();
await admin.query(`drop database if exists ${APP} with (force)`);
await admin.query(`create database ${APP}`);
await admin.end();

const pool = new pg.Pool({ connectionString: `${PGURL}/${APP}` });
const sql = (f) => readFileSync(f, "utf8");
await pool.query(sql(new URL("./sql-shim.sql", import.meta.url)));
for (const f of readdirSync(`${ROOT}supabase/migrations`).sort()) {
  await pool.query(sql(`${ROOT}supabase/migrations/${f}`));
}

try {
  // New sites get the Checker and the Guardian (kb_agents_on_new_site).
  await pool.query(`insert into public.sites (id, name, slug) values ('${FULL}', 'Full', 'full'), ('${LITE}', 'Lite', 'lite')`);
  for (const site of [FULL, LITE]) {
    const post = `${site.slice(0, 4)}post0000000`;
    await pool.query(`insert into public.posts (id, site, title, status) values ('${post}', '${site}', 'A post', 'published')`);
    await pool.query(`insert into public.post_versions (site, post, version, content, created_by) values ('${site}', '${post}', 1, 'Body', 'user')`);
  }
  await pool.query(`insert into public.app_settings (site, key, value) values ('${LITE}', 'tenant.plan', '"lite"')`);

  setAppDb(pool);
  const work = await pendingWork(0);
  const sites = new Set(work.map((w) => w.site));
  assert.ok(sites.has(FULL), "the full tenant's published post is checked");
  assert.ok(!sites.has(LITE), "the Lite tenant's published post is not");
  console.log("  ok   Lite tenants get no KB agent runs");

  // Back to full: its work shows up again.
  await pool.query(`update public.app_settings set value = '"full"' where site = '${LITE}' and key = 'tenant.plan'`);
  assert.ok((await pendingWork(0)).some((w) => w.site === LITE), "a tenant set back to full is checked");
  console.log("  ok   a tenant back on full is checked again");
} finally {
  await pool.end();
}
