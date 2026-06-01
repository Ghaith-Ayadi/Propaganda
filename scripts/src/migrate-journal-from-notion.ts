// Backfill the "Journal" Notion database into Propaganda's posts table.
//
// Pulls every page in the database (paginated), converts the page body to
// Markdown, and inserts into public.posts as a Journal collection entry.
// Preserves Notion's created_time / last_edited_time so the post history
// looks the way the author lived it.
//
// Idempotent: re-running skips rows whose notion_id already exists.
// Posts are ordered by Notion created_time ascending — oldest is JRN·01.
//
// Required env (in ../.env.local):
//   VITE_SUPABASE_URL
//   SUPABASE_DB_PASSWORD
//   NOTION_API_TOKEN   ← integration must be shared with the Journal DB

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const dbPassword = process.env.SUPABASE_DB_PASSWORD!;
const notionToken = process.env.NOTION_API_TOKEN!;
if (!supabaseUrl || !dbPassword || !notionToken) {
  console.error("Missing env: VITE_SUPABASE_URL / SUPABASE_DB_PASSWORD / NOTION_API_TOKEN");
  process.exit(1);
}

const JOURNAL_DB_ID = "0561e91d-2bc6-4e82-b7ae-c03f4bd481e3";
const COLLECTION_NAME = "Journal";
const COLLECTION_EMOJI = "🖋️";

const ref = new URL(supabaseUrl).hostname.split(".")[0];
const connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

// --- Notion API helpers ---------------------------------------------------

const NOTION_HEADERS = {
  Authorization: `Bearer ${notionToken}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface NotionPageStub {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, any>;
}

async function listJournalPages(): Promise<NotionPageStub[]> {
  const out: NotionPageStub[] = [];
  let cursor: string | undefined;
  for (;;) {
    const body: Record<string, unknown> = {
      page_size: 100,
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
    };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${JOURNAL_DB_ID}/query`, {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion query failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { results: NotionPageStub[]; next_cursor: string | null; has_more: boolean };
    out.push(...json.results);
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
    await sleep(350);
  }
  return out;
}

async function fetchChildren(blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  for (;;) {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    const res = await fetch(url, { headers: NOTION_HEADERS });
    if (!res.ok) throw new Error(`Notion children failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { results: any[]; next_cursor: string | null; has_more: boolean };
    out.push(...json.results);
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
    await sleep(350);
  }
  return out;
}

// --- Rich text → Markdown -------------------------------------------------

function escapeMd(s: string): string {
  // Conservative: escape backslash, backtick, asterisk, underscore. Don't touch
  // brackets / parens — they're common in prose and unambiguous in our content.
  return s.replace(/([\\`*_])/g, "\\$1");
}

function renderRich(rich: any[] | undefined): string {
  if (!Array.isArray(rich)) return "";
  return rich
    .map((r) => {
      const text = r?.plain_text ?? "";
      if (!text) return "";
      const a = r.annotations ?? {};
      let out = a.code ? text : escapeMd(text);
      if (a.code) out = "`" + out.replace(/`/g, "\\`") + "`";
      if (a.strikethrough) out = `~~${out}~~`;
      if (a.italic) out = `_${out}_`;
      if (a.bold) out = `**${out}**`;
      const href = r.href ?? r.text?.link?.url;
      if (href) out = `[${out}](${href})`;
      return out;
    })
    .join("");
}

// --- Block → Markdown -----------------------------------------------------

async function renderBlocks(blocks: any[], depth = 0): Promise<string> {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  // Numbered-list state: Notion gives sibling numbered_list_items as a flat
  // list, but we want them numbered 1., 2., 3., …
  let numIdx = 0;
  let lastWasNumbered = false;

  for (const b of blocks) {
    const t = b.type as string;
    const data = b[t] ?? {};
    if (t !== "numbered_list_item") { lastWasNumbered = false; numIdx = 0; }

    switch (t) {
      case "paragraph": {
        const text = renderRich(data.rich_text);
        lines.push(`${indent}${text}`);
        if (b.has_children) {
          const kids = await fetchChildren(b.id);
          lines.push(await renderBlocks(kids, depth + 1));
        }
        break;
      }
      case "heading_1":
        lines.push(`${indent}# ${renderRich(data.rich_text)}`);
        break;
      case "heading_2":
        lines.push(`${indent}## ${renderRich(data.rich_text)}`);
        break;
      case "heading_3":
        lines.push(`${indent}### ${renderRich(data.rich_text)}`);
        break;
      case "bulleted_list_item": {
        lines.push(`${indent}- ${renderRich(data.rich_text)}`);
        if (b.has_children) {
          const kids = await fetchChildren(b.id);
          lines.push(await renderBlocks(kids, depth + 1));
        }
        break;
      }
      case "numbered_list_item": {
        if (!lastWasNumbered) numIdx = 0;
        numIdx += 1;
        lastWasNumbered = true;
        lines.push(`${indent}${numIdx}. ${renderRich(data.rich_text)}`);
        if (b.has_children) {
          const kids = await fetchChildren(b.id);
          lines.push(await renderBlocks(kids, depth + 1));
        }
        break;
      }
      case "to_do": {
        const mark = data.checked ? "x" : " ";
        lines.push(`${indent}- [${mark}] ${renderRich(data.rich_text)}`);
        break;
      }
      case "quote":
        for (const ln of renderRich(data.rich_text).split("\n")) {
          lines.push(`${indent}> ${ln}`);
        }
        break;
      case "code": {
        const lang = data.language ?? "";
        const body = renderRich(data.rich_text);
        lines.push(`${indent}\`\`\`${lang}\n${body}\n${indent}\`\`\``);
        break;
      }
      case "divider":
        lines.push(`${indent}---`);
        break;
      case "toggle": {
        // Render as plain text + nested content; no <details> in markdown.
        lines.push(`${indent}**${renderRich(data.rich_text)}**`);
        if (b.has_children) {
          const kids = await fetchChildren(b.id);
          lines.push(await renderBlocks(kids, depth + 1));
        }
        break;
      }
      case "image": {
        const src = data.file?.url ?? data.external?.url;
        const caption = renderRich(data.caption);
        if (src) lines.push(`${indent}![${caption}](${src})`);
        break;
      }
      case "bookmark":
      case "embed":
      case "link_preview":
      case "video":
      case "file": {
        const src = data.url ?? data.external?.url ?? data.file?.url;
        if (src) lines.push(`${indent}<${src}>`);
        break;
      }
      case "callout": {
        const icon = data.icon?.emoji ?? "💡";
        lines.push(`${indent}> ${icon} ${renderRich(data.rich_text)}`);
        if (b.has_children) {
          const kids = await fetchChildren(b.id);
          lines.push(await renderBlocks(kids, depth + 1));
        }
        break;
      }
      case "child_page":
      case "child_database":
        // Skip nested page / db — we're flattening a journal, not a tree.
        break;
      default:
        // Last resort: dump rich_text if present, otherwise log + skip.
        if (Array.isArray(data.rich_text)) {
          const text = renderRich(data.rich_text);
          if (text) lines.push(`${indent}${text}`);
        } else {
          console.warn(`  ! unhandled block type: ${t}`);
        }
        break;
    }

    // Paragraph separator after most block types (lists keep tight spacing).
    if (
      t === "paragraph" || t === "heading_1" || t === "heading_2" || t === "heading_3" ||
      t === "quote" || t === "code" || t === "divider" || t === "callout" || t === "image"
    ) {
      lines.push("");
    }
  }
  return lines.join("\n");
}

// --- Slug / postId per the JRN·NN convention ------------------------------

const VOWELS = new Set("aeiouyAEIOUY");

function collectionPrefix(name: string): string {
  const letters = [...name].filter((ch) => /[a-zA-Z]/.test(ch));
  const consonants = letters.filter((ch) => !VOWELS.has(ch));
  const pool = consonants.length >= 3 ? consonants : letters;
  const picked = pool.slice(0, 3).join("").toUpperCase();
  return picked.length === 3 ? picked : (picked + "XXX").slice(0, 3);
}

function padSeq(seq: number): string {
  return seq.toString().padStart(2, "0");
}

function postSlug(collection: string, seq: number): string {
  return `${collectionPrefix(collection)}·${padSeq(seq)}`;
}

// --- Word count -----------------------------------------------------------

function wordCount(md: string): number {
  return (md.match(/\S+/g) ?? []).length;
}

// --- Title from Notion properties -----------------------------------------

function titleOf(page: NotionPageStub): string {
  const t = page.properties?.Name?.title;
  if (!Array.isArray(t)) return "";
  return t.map((r: any) => r.plain_text ?? "").join("").trim();
}

// --- Main -----------------------------------------------------------------

await client.connect();
console.log(`Connected to Supabase project ${ref}`);

// 1. Ensure the Journal collection row exists.
{
  const existing = await client.query<{ name: string; position: number }>(
    "select name, position from public.collections where name = $1",
    [COLLECTION_NAME],
  );
  if (existing.rows.length === 0) {
    const maxPos = await client.query<{ m: number | null }>(
      "select max(position)::int as m from public.collections",
    );
    const nextPos = (maxPos.rows[0].m ?? -1) + 1;
    await client.query(
      `insert into public.collections (name, emoji, description, position, is_hidden)
       values ($1, $2, $3, $4, false)`,
      [COLLECTION_NAME, COLLECTION_EMOJI, null, nextPos],
    );
    console.log(`  · created collection "${COLLECTION_NAME}" at position ${nextPos}`);
  } else {
    console.log(`  · collection "${COLLECTION_NAME}" already exists at position ${existing.rows[0].position}`);
  }
}

// 1b. Free the JRN prefix: rename "The mechanics" slugs JRN·NN → THM·NN.
// "The mechanics" was previously called "Journal", which is why its posts
// carry JRN slugs. The current rule is "prefix derives from current name",
// so this is a one-time cleanup that aligns slugs with the live name.
{
  const stale = await client.query<{ id: number; slug: string; post_id: string | null }>(
    `select id, slug, post_id from public.posts
     where type = 'The mechanics' and (slug like 'JRN%' or post_id like 'JRN%')`,
  );
  let touched = 0;
  for (const row of stale.rows) {
    const newSlug = row.slug.startsWith("JRN") ? "THM" + row.slug.slice(3) : row.slug;
    const newPid =
      row.post_id && row.post_id.startsWith("JRN") ? "THM" + row.post_id.slice(3) : row.post_id;
    if (newSlug === row.slug && newPid === row.post_id) continue;
    await client.query(
      `update public.posts set slug = $1, post_id = $2 where id = $3`,
      [newSlug, newPid, row.id],
    );
    touched += 1;
  }
  console.log(`  · The mechanics: reslugged ${touched} posts (JRN → THM)`);
}

// 1c. Clean up Journal stubs left over from the manual prep:
//     - TST·01 "New post" (empty) → delete
//     - TST·02 "On the remodeling of kitchens" → link to its Notion page so
//       the migration treats it as the canonical record (preserves any edits
//       you made after pasting it in).
const REMODELING_NOTION_ID = "36f73ad5-6c72-8090-9684-c4d727b8960a";
{
  const stub = await client.query<{ id: number }>(
    `select id from public.posts where type = $1 and slug = 'TST·01'`,
    [COLLECTION_NAME],
  );
  if (stub.rows.length > 0) {
    await client.query(`delete from public.posts where id = $1`, [stub.rows[0].id]);
    console.log(`  · deleted empty stub TST·01`);
  }
}
{
  const kitchens = await client.query<{ id: number; notion_id: string | null }>(
    `select id, notion_id from public.posts where type = $1 and title ilike '%remodeling of kitchens%'`,
    [COLLECTION_NAME],
  );
  if (kitchens.rows.length > 0 && kitchens.rows[0].notion_id == null) {
    await client.query(
      `update public.posts set notion_id = $1 where id = $2`,
      [REMODELING_NOTION_ID, kitchens.rows[0].id],
    );
    console.log(`  · linked "On the remodeling of kitchens" to Notion ${REMODELING_NOTION_ID}`);
  }
}

// 2. Pull every page in the Journal DB.
const pages = await listJournalPages();
console.log(`Found ${pages.length} pages in Notion Journal DB.`);

// 3. Walk pages in created_time ascending order. The sequence position is
// the post's permanent JRN·NN slot — this is the same whether we're
// inserting fresh or fixing up an existing row.
let inserted = 0;
let updated = 0;
let failed = 0;

for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  const seq = i + 1;
  const slug = postSlug(COLLECTION_NAME, seq);
  const title = titleOf(page) || "Untitled";
  const notionId = page.id;
  const created = page.created_time;
  const edited = page.last_edited_time;

  try {
    const existing = await client.query<{ id: number; slug: string }>(
      `select id, slug from public.posts where notion_id = $1 limit 1`,
      [notionId],
    );
    if (existing.rows.length > 0) {
      // Already in the DB. Don't overwrite content — that may contain
      // post-paste edits. Just align metadata.
      const row = existing.rows[0];
      await client.query(
        `update public.posts set
            title = $1,
            slug = $2,
            post_id = $3,
            type = $4,
            status = 'published',
            collection_seq = $5,
            created_at = $6,
            updated_at = $7,
            published_at = $8,
            done_at = $9
         where id = $10`,
        [title, slug, slug, COLLECTION_NAME, seq, created, edited, created, created, row.id],
      );
      console.log(`  ~ ${slug}  ${title}  (kept content, updated metadata; was ${row.slug})`);
      updated += 1;
      continue;
    }

    const blocks = await fetchChildren(notionId);
    const content_md = (await renderBlocks(blocks)).replace(/\n{3,}/g, "\n\n").trim();

    await client.query(
      `insert into public.posts
        (title, slug, post_id, type, status, content_md, notion_id,
         collection_seq, word_count,
         created_at, updated_at, published_at, done_at)
       values
        ($1, $2, $3, $4, 'published', $5, $6,
         $7, $8,
         $9, $10, $11, $12)`,
      [
        title,
        slug,
        slug, // post_id mirrors slug for the JRN·NN scheme
        COLLECTION_NAME,
        content_md,
        notionId,
        seq,
        wordCount(content_md),
        created,
        edited,
        created,
        created,
      ],
    );
    console.log(`  ✓ ${slug}  ${title}  (${wordCount(content_md)} words, ${created.slice(0, 10)})`);
    inserted += 1;
    await sleep(120);
  } catch (err) {
    console.error(`  ✗ "${title}" — ${(err as Error).message}`);
    failed += 1;
  }
}

await client.end();
console.log(`Done. inserted=${inserted} updated=${updated} failed=${failed}`);
