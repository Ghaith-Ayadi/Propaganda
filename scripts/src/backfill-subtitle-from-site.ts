// One-time backfill: pull subtitles from the live Framer site's search index.
// Matches posts by normalized title, updates subtitle where null/empty.
// Only covers Hokum and IM Journal (the only collections published on the site).
//
// Usage:
//   cd scripts && node --experimental-strip-types src/backfill-subtitle-from-site.ts

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

const SEARCH_INDEX_URL =
  "https://framerusercontent.com/sites/1JWwNGfAEVJQbIDC7MQm79/searchIndex-rt28umwp0Kpt.json";

// Matches both full ("February 1, 2025") and short ("Jan 7, 2024") date formats.
const DATE_RE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d+,?\s+\d{4}$/i;

// Normalize a title for fuzzy matching: lowercase, strip punctuation, collapse spaces.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const dbPassword = process.env.SUPABASE_DB_PASSWORD!;
const ref = new URL(supabaseUrl).hostname.split(".")[0];
const connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

// 1. Fetch the search index.
console.log("Fetching search index from Framer site…");
const res = await fetch(SEARCH_INDEX_URL);
if (!res.ok) throw new Error(`Failed to fetch search index: ${res.status}`);
const index = (await res.json()) as Record<string, {
  h1?: string[];
  p?: string[];
}>;

// 2. Extract subtitle for every hokum/im post.
const siteSubtitles = new Map<string, string>(); // normalizedTitle → subtitle

for (const [url, entry] of Object.entries(index)) {
  if (!url.startsWith("/hokum/") && !url.startsWith("/im/")) continue;

  const h1 = entry.h1 ?? [];
  const ps = entry.p ?? [];
  const rawTitle = h1[0]?.trim() ?? "";

  let subtitle: string | null = null;
  for (let i = 0; i < ps.length; i++) {
    if (DATE_RE.test(ps[i].trim()) && i > 0) {
      const candidate = ps[i - 1].trim();
      // Reject short strings and breadcrumb arrows (← …).
      if (candidate.length > 20 && !candidate.startsWith("←")) {
        subtitle = candidate;
      }
      break;
    }
  }

  if (rawTitle && subtitle) {
    siteSubtitles.set(normalize(rawTitle), subtitle);
  }
}

console.log(`Found ${siteSubtitles.size} posts with subtitles in search index.`);

// 3. Load all DB posts in Hokum / IM Journal that still lack a subtitle.
const { rows } = await client.query<{
  id: number;
  title: string | null;
  type: string;
}>(`
  select id, title, type
  from public.posts
  where type in ('Hokum', 'IM Journal')
    and (subtitle is null or subtitle = '')
  order by type, collection_seq
`);

console.log(`Found ${rows.length} DB posts without subtitle to update.`);

// 4. Match and update.
let updated = 0;
let unmatched = 0;

for (const row of rows) {
  const key = normalize(row.title ?? "");
  const subtitle = siteSubtitles.get(key);

  if (!subtitle) {
    console.warn(`  [${row.id}] NO MATCH — ${row.type} | ${row.title!.trim()}`);
    unmatched++;
    continue;
  }

  await client.query(`update public.posts set subtitle = $1 where id = $2`, [subtitle, row.id]);
  console.log(`  [${row.id}] ${row.title!.trim()} → "${subtitle}"`);
  updated++;
}

console.log(`\nDone. updated=${updated} unmatched=${unmatched} total=${rows.length}`);
await client.end();
