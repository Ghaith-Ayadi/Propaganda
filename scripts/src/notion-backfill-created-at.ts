// Override posts.created_at with the original Notion page created_time.
// Walks every post with a notion_id, fetches the page, and updates the row.
// Rate-limited to ~3 req/s (Notion's published limit).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const dbPassword = process.env.SUPABASE_DB_PASSWORD!;
const notionToken = process.env.NOTION_API_TOKEN;
if (!notionToken) {
  console.error("Missing NOTION_API_TOKEN in .env.local");
  process.exit(1);
}

const ref = new URL(supabaseUrl).hostname.split(".")[0];
const connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query<{
  id: number;
  title: string | null;
  notion_id: string;
  created_at: string;
}>(`select id, title, notion_id, created_at from public.posts where notion_id is not null order by id`);

console.log(`Found ${rows.length} posts with notion_id.`);

let updated = 0;
let skipped = 0;
let failed = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const row of rows) {
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${row.notion_id}`, {
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
      },
    });
    if (!res.ok) {
      console.warn(`[${row.id}] ${row.title} — notion ${res.status}`);
      failed++;
      await sleep(350);
      continue;
    }
    const data = (await res.json()) as { created_time?: string };
    const createdTime = data.created_time;
    if (!createdTime) {
      console.warn(`[${row.id}] no created_time in response`);
      skipped++;
      continue;
    }
    const existing = new Date(row.created_at).getTime();
    const fromNotion = new Date(createdTime).getTime();
    if (existing === fromNotion) {
      skipped++;
    } else {
      await client.query(`update public.posts set created_at = $1 where id = $2`, [createdTime, row.id]);
      console.log(`[${row.id}] ${row.title ?? "(untitled)"} → ${createdTime}`);
      updated++;
    }
  } catch (err) {
    console.error(`[${row.id}] error:`, (err as Error).message);
    failed++;
  }
  await sleep(350);
}

console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed} total=${rows.length}`);
await client.end();
