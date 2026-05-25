// One-time backfill: pull the subtitle from existing Notion pages into posts.subtitle.
// Reads the Notion "Subtitle" property (plain_text, rich_text type).
// Skips posts that already have a subtitle set.
// Rate-limited to ~3 req/s (Notion's published limit).
//
// Usage:
//   cd scripts && npx tsx src/notion-backfill-subtitle.ts
//
// If your Notion property is named differently, update SUBTITLE_PROPERTY below.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

const SUBTITLE_PROPERTY = "Subtitle"; // Notion property name to look for

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
  subtitle: string | null;
}>(`
  select id, title, notion_id, subtitle
  from public.posts
  where notion_id is not null
    and (subtitle is null or subtitle = '')
  order by id
`);

console.log(`Found ${rows.length} posts with notion_id and no subtitle yet.`);
if (rows.length === 0) {
  console.log("Nothing to do.");
  await client.end();
  process.exit(0);
}

// Peek at first page's properties to help diagnose wrong property names.
const firstRes = await fetch(`https://api.notion.com/v1/pages/${rows[0].notion_id}`, {
  headers: { Authorization: `Bearer ${notionToken}`, "Notion-Version": "2022-06-28" },
});
if (firstRes.ok) {
  const firstData = (await firstRes.json()) as { properties?: Record<string, unknown> };
  const propNames = Object.keys(firstData.properties ?? {});
  console.log(`\nNotion property names on first post: ${propNames.join(", ")}`);
  if (!propNames.includes(SUBTITLE_PROPERTY)) {
    console.warn(`\n⚠️  Property "${SUBTITLE_PROPERTY}" not found. Update SUBTITLE_PROPERTY in this script to one of the above.`);
    await client.end();
    process.exit(1);
  }
  console.log(`✓ Using property: "${SUBTITLE_PROPERTY}"\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let updated = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${row.notion_id}`, {
      headers: { Authorization: `Bearer ${notionToken}`, "Notion-Version": "2022-06-28" },
    });
    if (!res.ok) {
      console.warn(`[${row.id}] ${row.title} — notion ${res.status}`);
      failed++;
      await sleep(350);
      continue;
    }

    const data = (await res.json()) as {
      properties?: Record<string, { type: string; rich_text?: { plain_text: string }[] }>;
    };
    const prop = data.properties?.[SUBTITLE_PROPERTY];
    if (!prop || prop.type !== "rich_text") {
      skipped++;
      await sleep(350);
      continue;
    }

    const subtitle = prop.rich_text?.map((r) => r.plain_text).join("").trim() || null;
    if (!subtitle) {
      skipped++;
      await sleep(350);
      continue;
    }

    await client.query(`update public.posts set subtitle = $1 where id = $2`, [subtitle, row.id]);
    console.log(`[${row.id}] ${row.title ?? "(untitled)"} → "${subtitle}"`);
    updated++;
  } catch (err) {
    console.error(`[${row.id}] error:`, (err as Error).message);
    failed++;
  }
  await sleep(350);
}

console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed} total=${rows.length}`);
await client.end();
