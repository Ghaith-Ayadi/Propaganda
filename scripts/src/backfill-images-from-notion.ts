// Backfill images from Notion into posts.content_md.
//
// For each post with a notion_id that has image blocks, this script:
//   1. Fetches the full block tree from Notion.
//   2. Converts every block to Markdown (text + images).
//   3. Downloads each image and uploads it to Vercel Blob.
//   4. Overwrites content_md with the fully rebuilt Markdown.
//
// Safe to re-run: only touches posts that have ≥1 image block in Notion.
//
// Usage:
//   cd scripts && node --experimental-strip-types src/backfill-images-from-notion.ts
//
// To preview without writing to DB:
//   ... src/backfill-images-from-notion.ts --dry-run

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const DRY_RUN = process.argv.includes("--dry-run");
const NOTION_TOKEN = process.env.NOTION_API_TOKEN!;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN!;
const BLOB_BASE = "https://api.vercel.com/v1/blobs";
const NOTION_VERSION = "2022-06-28";
const RATE_MS = 350; // ~3 req/s

if (!NOTION_TOKEN) { console.error("Missing NOTION_API_TOKEN"); process.exit(1); }
if (!BLOB_TOKEN)   { console.error("Missing BLOB_READ_WRITE_TOKEN"); process.exit(1); }

// ---- Types ----

interface NotionRichText {
  plain_text: string;
  href: string | null;
  annotations: { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

// ---- Notion helpers ----

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function notionGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION },
  });
  if (!res.ok) throw new Error(`Notion ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function getBlocks(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  do {
    const url = `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const data = await notionGet<{ results: NotionBlock[]; next_cursor: string | null }>(url);
    blocks.push(...data.results);
    cursor = data.next_cursor;
    if (cursor) await sleep(RATE_MS);
  } while (cursor);
  return blocks;
}

// ---- Rich-text → Markdown ----

function rtToMd(rts: NotionRichText[]): string {
  return (rts ?? []).map(rt => {
    let t = rt.plain_text;
    if (!t) return "";
    // Code wins — wrap first, then skip other annotations.
    if (rt.annotations.code) return `\`${t}\``;
    if (rt.annotations.strikethrough) t = `~~${t}~~`;
    if (rt.annotations.italic) t = `_${t}_`;
    if (rt.annotations.bold) t = `**${t}**`;
    if (rt.href) t = `[${t}](${rt.href})`;
    return t;
  }).join("");
}

// ---- Image upload ----

async function uploadImageFromUrl(notionUrl: string, filename: string): Promise<string> {
  // Download from Notion (these are time-limited S3 URLs).
  const imgRes = await fetch(notionUrl);
  if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status} ${notionUrl}`);
  const blob = await imgRes.blob();

  // Determine extension from content-type.
  const ct = imgRes.headers.get("content-type") ?? "image/jpeg";
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
    "image/webp": "webp", "image/svg+xml": "svg",
  };
  const ext = extMap[ct] ?? "jpg";
  const safeName = filename.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40) + "." + ext;
  const year = new Date().getFullYear();
  const ts = Date.now().toString(36);
  const pathname = `${year}/${ts}-${safeName}`;

  // Upload to Vercel Blob.
  const uploadRes = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      "content-type": ct,
      "x-api-version": "7",
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "31536000",
    },
    body: blob,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Blob upload failed: ${uploadRes.status} — ${text}`);
  }
  const { url } = (await uploadRes.json()) as { url: string };
  return url;
}

// ---- Block → Markdown ----

async function blockToMd(block: NotionBlock, postTitle: string, imgIndex: { n: number }): Promise<string> {
  const type = block.type;
  const data = block[type] as Record<string, unknown> | undefined;
  if (!data) return "";

  const rts = (data.rich_text as NotionRichText[] | undefined) ?? [];

  switch (type) {
    case "paragraph":
      return rtToMd(rts);

    case "heading_1":
      return `# ${rtToMd(rts)}`;
    case "heading_2":
      return `## ${rtToMd(rts)}`;
    case "heading_3":
      return `### ${rtToMd(rts)}`;

    case "bulleted_list_item":
      return `- ${rtToMd(rts)}`;
    case "numbered_list_item":
      return `1. ${rtToMd(rts)}`;

    case "quote":
      return `> ${rtToMd(rts)}`;

    case "code": {
      const lang = String(data.language ?? "");
      const code = rtToMd(rts);
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "divider":
      return "---";

    case "callout":
      return `> ${rtToMd(rts)}`;

    case "bookmark": {
      const url = String(data.url ?? "");
      const caption = rtToMd((data.caption as NotionRichText[] | undefined) ?? []);
      return `[${caption || url}](${url})`;
    }

    case "image": {
      imgIndex.n++;
      const imgData = data as { type: string; file?: { url: string }; external?: { url: string }; caption?: NotionRichText[] };
      const rawUrl = imgData.file?.url ?? imgData.external?.url ?? "";
      const caption = rtToMd(imgData.caption ?? []);
      if (!rawUrl) return "";

      const filename = `${postTitle.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 30)}-img${imgIndex.n}`;
      console.log(`    ↑ uploading image ${imgIndex.n}: ${filename}`);
      try {
        const blobUrl = await uploadImageFromUrl(rawUrl, filename);
        return `![${caption}](${blobUrl})`;
      } catch (err) {
        console.warn(`    ✗ image upload failed: ${(err as Error).message}`);
        return caption ? `_[Image: ${caption}]_` : `_[Image unavailable]_`;
      }
    }

    default:
      // Try to recover plain text from unknown block types.
      if (rts.length > 0) return rtToMd(rts);
      return "";
  }
}

async function blocksToMarkdown(blocks: NotionBlock[], postTitle: string): Promise<string> {
  const lines: string[] = [];
  const imgIndex = { n: 0 };

  for (const block of blocks) {
    await sleep(0); // yield
    const md = await blockToMd(block, postTitle, imgIndex);
    if (md) lines.push(md);

    // Notion nested children (e.g. toggle, callout children) — flatten inline.
    if (block.has_children && block.type !== "child_page") {
      try {
        await sleep(RATE_MS);
        const children = await getBlocks(block.id);
        for (const child of children) {
          const childMd = await blockToMd(child, postTitle, imgIndex);
          if (childMd) lines.push(childMd);
        }
      } catch (err) {
        console.warn(`    could not fetch children of block ${block.id}: ${(err as Error).message}`);
      }
    }
  }

  return lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ---- Main ----

const ref = new URL(process.env.VITE_SUPABASE_URL!).hostname.split(".")[0];
const connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`Connected. ${DRY_RUN ? "[DRY RUN]" : ""}`);

// Load only posts that have notion_id (we'll filter to image-bearing ones below).
const { rows } = await client.query<{
  id: number;
  title: string | null;
  type: string;
  notion_id: string;
  content_md: string | null;
}>(`
  select id, title, type, notion_id, content_md
  from public.posts
  where notion_id is not null
  order by id
`);

console.log(`Scanning ${rows.length} Notion-imported posts for image blocks…`);

let updated = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  try {
    await sleep(RATE_MS);
    const blocks = await getBlocks(row.notion_id);
    const imageBlocks = blocks.filter(b => b.type === "image");

    if (imageBlocks.length === 0) {
      skipped++;
      continue;
    }

    const title = row.title?.trim() ?? "untitled";
    console.log(`\n[${row.id}] ${title} (${row.type}) — ${imageBlocks.length} image(s)`);

    const newMd = await blocksToMarkdown(blocks, title);

    if (DRY_RUN) {
      console.log("--- preview (first 400 chars) ---");
      console.log(newMd.substring(0, 400));
      console.log("---");
    } else {
      await client.query(`update public.posts set content_md = $1 where id = $2`, [newMd, row.id]);
      console.log(`  ✓ updated`);
    }
    updated++;
  } catch (err) {
    console.error(`[${row.id}] error: ${(err as Error).message}`);
    failed++;
  }
}

console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed} total=${rows.length}`);
if (DRY_RUN) console.log("(dry run — no DB writes)");
await client.end();
