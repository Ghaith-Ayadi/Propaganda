// Audit: find all DB posts that have a subtitle in the Framer index but null in DB.
// Fixes them in place.
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const DATE_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d+,?\s+\d{4}$/i;
function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

const res = await fetch("https://framerusercontent.com/sites/1JWwNGfAEVJQbIDC7MQm79/searchIndex-rt28umwp0Kpt.json");
const index = await res.json() as Record<string, { h1?: string[]; p?: string[] }>;

const siteSubtitles = new Map<string, { title: string; subtitle: string }>();
for (const [url, entry] of Object.entries(index)) {
  if (!url.startsWith("/hokum/") && !url.startsWith("/im/")) continue;
  const h1 = (entry.h1 ?? [""])[0].trim();
  const ps = entry.p ?? [];
  let subtitle: string | null = null;
  for (let i = 0; i < ps.length; i++) {
    if (DATE_RE.test(ps[i].trim()) && i > 0) {
      const c = ps[i - 1].trim();
      if (c.length > 20 && !c.startsWith("←")) subtitle = c;
      break;
    }
  }
  if (h1 && subtitle) siteSubtitles.set(normalize(h1), { title: h1, subtitle });
}
console.log(`Framer index: ${siteSubtitles.size} posts have subtitles`);

const ref = new URL(process.env.VITE_SUPABASE_URL!).hostname.split(".")[0];
const conn = `postgresql://postgres.${ref}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query<{ id: number; title: string; subtitle: string | null }>(
  `select id, title, subtitle from public.posts where type in ('Hokum', 'IM Journal') order by id`
);

const missing: { id: number; title: string; subtitle: string }[] = [];
for (const row of rows) {
  const site = siteSubtitles.get(normalize(row.title ?? ""));
  if (site && !row.subtitle) missing.push({ id: row.id, title: row.title, subtitle: site.subtitle });
}

console.log(`\nDB posts missing subtitle that exist in Framer index: ${missing.length}`);
for (const m of missing) {
  console.log(`  [${m.id}] "${m.title.trim()}" → "${m.subtitle}"`);
  await client.query(`update public.posts set subtitle = $1, updated_at = now() where id = $2`, [m.subtitle, m.id]);
}
if (missing.length > 0) console.log(`\nFixed ${missing.length} posts.`);
else console.log("Nothing to fix.");

await client.end();
