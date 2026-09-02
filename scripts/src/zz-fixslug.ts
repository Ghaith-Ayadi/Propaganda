import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });
const url = process.env.VITE_SUPABASE_URL!;
const ref = new URL(url).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD!;
const c = new pg.Client({ connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`, ssl: { rejectUnauthorized: false } });
await c.connect();
// slugify title-derived slugs that still contain spaces/uppercase, published only
const bad = (await c.query(`select id, slug from public.posts where status='published' and slug ~ '[A-Z ]'`)).rows;
for (const r of bad) {
  const slug = r.slug.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g,"").trim().replace(/\s+/g,"-").replace(/-+/g,"-");
  const clash = (await c.query(`select 1 from public.posts where slug=$1 and id<>$2`, [slug, r.id])).rowCount;
  const finalSlug = clash ? `${slug}-${r.id}` : slug;
  await c.query(`update public.posts set slug=$1 where id=$2`, [finalSlug, r.id]);
  console.log(`${r.id}: "${r.slug}" -> "${finalSlug}"`);
}
console.log(`fixed ${bad.length} published slug(s)`);
await c.end();
