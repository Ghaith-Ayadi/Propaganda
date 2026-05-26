// Touch updated_at for all posts that have a subtitle, so the next sync
// cursor-pull picks up the subtitle value.
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const ref = new URL(process.env.VITE_SUPABASE_URL!).hostname.split(".")[0];
const conn = `postgresql://postgres.${ref}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rowCount } = await client.query(`
  update public.posts
  set updated_at = now()
  where subtitle is not null and subtitle != ''
`);
console.log(`Touched updated_at on ${rowCount} posts with subtitles.`);
await client.end();
