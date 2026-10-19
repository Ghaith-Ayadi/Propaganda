// Assign a post: the one door through which a post someone has already
// decided on (and often already written) reaches the Writer, skipping the
// Pitcher. The Claude plugin and the app's Assign dialog both come here.
//
// The post is a regular post. What makes it an assigned one is its brief:
// origin "assigned", the writing the person sent as its body (the Writer
// reads it as source material, writer-prompt.ts) and the attachments as its
// sources, each with a kind (image, pdf). Images arrive as base64 and go to
// the app's upload function (Vercel Blob) under the site, as the editor's
// uploads do; a URL is kept as it is.

import type { Pool } from "pg";
import { insert } from "../agents/backend.js";
import { newId } from "../agents/ids.js";
import { collections, insertDraftPost } from "../agents/store.js";
import { config } from "../config.js";
import { publicUrl } from "../listener/sources/public.js";
import { dispatchAgent } from "../workflows/agents.js";

export type AssetKind = "image" | "pdf";
export const ASSET_KINDS: readonly AssetKind[] = ["image", "pdf"];

export interface AssetIn {
  name: string;
  kind: AssetKind;
  /** One of the two: a public URL, or the bytes. */
  url?: string;
  data?: string;
  mediaType?: string;
}

export interface AssignInput {
  site: string;
  /** The member the post is assigned by (the brief's reviewer). */
  user: string;
  title: string;
  collection: string;
  /** The source material, Markdown. */
  markdown: string;
  assets?: AssetIn[];
  /** Where it was assigned from, for the run's record ("mcp", "pipeline"). */
  via: string;
}

export interface AssignResult {
  post: string;
  brief: string;
  collection: string;
  /** The Writer's run, or why it didn't start. */
  run: string | null;
  notStarted?: string;
  assets: { url: string; label: string; kind: AssetKind }[];
  /** Where to watch it: the post in the editor. */
  url: string;
}

export class AssignError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_MARKDOWN = 200_000;
const MAX_ASSETS = 20;
/** Vercel takes 4.5 MB a request; base64 adds a third. */
const MAX_ASSET_BYTES = 4_000_000;

/** The input, checked. Throws AssignError(400) on bad input. */
export function checkAssign(body: Record<string, unknown>): Pick<AssignInput, "title" | "collection" | "markdown" | "assets"> {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";
  if (!title) throw new AssignError(400, "A title is required");
  const collection = typeof body.collection === "string" ? body.collection.trim() : "";
  const markdown = typeof body.markdown === "string" ? body.markdown.trim() : "";
  if (!markdown) throw new AssignError(400, "The markdown is required: the material the post is written from");
  if (markdown.length > MAX_MARKDOWN) throw new AssignError(400, `The markdown is over ${MAX_MARKDOWN} characters`);
  const raw = Array.isArray(body.assets) ? body.assets : [];
  if (raw.length > MAX_ASSETS) throw new AssignError(400, `At most ${MAX_ASSETS} assets`);
  const assets: AssetIn[] = raw.map((a, n) => {
    const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const kind = x.kind as AssetKind;
    if (!ASSET_KINDS.includes(kind)) throw new AssignError(400, `Asset ${n + 1}: kind must be image or pdf`);
    const name = typeof x.name === "string" && x.name.trim() ? x.name.trim().slice(0, 200) : `asset-${n + 1}`;
    const url = typeof x.url === "string" && /^https?:\/\//.test(x.url) ? x.url.slice(0, 2000) : undefined;
    const data = typeof x.data === "string" && x.data ? x.data : undefined;
    if (!url && !data) throw new AssignError(400, `Asset ${n + 1}: a url or base64 data is required`);
    if (data && data.length > (MAX_ASSET_BYTES * 4) / 3) throw new AssignError(400, `Asset ${n + 1}: over ${MAX_ASSET_BYTES / 1_000_000} MB`);
    const mediaType = typeof x.mediaType === "string" ? x.mediaType.slice(0, 100) : undefined;
    return { name, kind, url, data, mediaType };
  });
  return { title, collection, markdown, assets };
}

/** Store the bytes an asset came with, through the app's upload function (the worker holds no Blob token). */
async function storeAsset(site: string, a: AssetIn): Promise<string> {
  if (a.url) return a.url;
  const secret = config.dispatchSecret;
  if (!secret) throw new AssignError(503, "The worker can't store files: no dispatch secret");
  const bytes = Buffer.from(a.data!, "base64");
  if (!bytes.length) throw new AssignError(400, `${a.name}: empty file`);
  const type = a.mediaType ?? (a.kind === "pdf" ? "application/pdf" : "image/png");
  const name = /\.[a-z0-9]{2,5}$/i.test(a.name) ? a.name : `${a.name}.${a.kind === "pdf" ? "pdf" : type.split("/")[1] ?? "png"}`;
  const form = new FormData();
  form.set("site", site);
  form.set("file", new Blob([bytes], { type }), name);
  const res = await fetch(`${publicUrl()}/api/upload`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: form });
  if (!res.ok) throw new AssignError(502, `Storing ${a.name} failed: the upload answered ${res.status}`);
  const { url } = (await res.json()) as { url?: string };
  if (!url) throw new AssignError(502, `Storing ${a.name} failed: no URL came back`);
  return url;
}

export async function assignPost(db: Pool, input: AssignInput): Promise<AssignResult> {
  const cols = await collections(input.site);
  const visible = cols.filter((c) => !c.is_hidden);
  const col = input.collection
    ? cols.find((c) => c.name.toLowerCase() === input.collection.toLowerCase() || c.slug === input.collection.toLowerCase())
    : visible[0];
  if (!col) {
    throw new AssignError(
      input.collection ? 404 : 422,
      input.collection ? `No collection called "${input.collection}". The blog has: ${cols.map((c) => c.name).join(", ") || "none"}` : "The blog has no collection yet",
    );
  }

  const assets: AssignResult["assets"] = [];
  for (const a of input.assets ?? []) assets.push({ url: await storeAsset(input.site, a), label: a.name, kind: a.kind });

  const postId = newId();
  const briefId = newId();
  await insertDraftPost({ id: postId, site: input.site, title: input.title, subtitle: "", type: col.name, excerpt: "", content_md: "", word_count: 0 });
  await insert("briefs", {
    id: briefId,
    site: input.site,
    title: input.title,
    status: "in_progress",
    collection_name: col.name,
    body: input.markdown,
    sources: assets,
    post: postId,
    origin: "assigned",
    writer: "agent",
    reviewer: input.user,
    planned_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
  });

  let run: string | null = null;
  let notStarted: string | undefined;
  try {
    const started = await dispatchAgent("writer", { site: input.site, task: `Write the post: ${input.title}`, requestedBy: input.user, conversation: input.via, post: postId });
    if (started) run = started;
    else notStarted = started === undefined ? "the Writer isn't running on this server" : "the Writer found no brief for the post";
  } catch (err) {
    notStarted = (err as Error).message;
  }
  void db;
  return { post: postId, brief: briefId, collection: col.name, run, notStarted, assets, url: `${publicUrl()}/admin#/post/${postId}` };
}
