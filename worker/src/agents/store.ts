// The Pitcher's and the Writer's reads and writes, on the shared PostgREST
// plumbing (backend.ts). Writes are narrow on purpose. These agents only ever:
//   - insert new rows (ideas, pitched briefs, draft posts, post versions,
//     voice guides);
//   - update rows an agent made (agent_ideas; briefs whose pitched_by is an
//     agent; a draft post an agent created and nobody has written in yet).
// Every write filters on the site as well as the id. Nothing here can touch a
// post a person wrote (CLAUDE.md, the highest-priority rule).

import { enc, insert, isMissing, patch, rest, select } from "./backend.js";
import { newId, stableId } from "./ids.js";

// ---- rows ----

export interface SiteRow {
  id: string;
  name: string;
  slug: string;
  domain: string;
}

export interface PostRow {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  status: string;
  excerpt: string;
  slug: string;
  tags: string[] | null;
  content_md: string;
  published_at: string | null;
  word_count: number;
}

export interface CollectionRow {
  name: string;
  slug: string;
  description: string;
  is_hidden: boolean;
}

export interface BriefRow {
  id: string;
  site: string;
  title: string;
  status: string;
  planned_date: string;
  collection_name: string;
  body: string;
  post: string | null;
  topics: string[] | null;
  fit: unknown;
  origin: string;
  sources: { url: string; label: string }[] | null;
  notes: { lineId: string | null; text: string; done?: boolean }[] | null;
  outline: { id: string; text: string }[] | null;
  angle: string;
  audience: string;
  length: string;
  batch: number | null;
  pitched_by: string;
  idea: string | null;
  expires_at: string | null;
  learned?: string;
  changed?: string;
}

export interface IdeaRow {
  id: string;
  site: string;
  title: string;
  summary: string;
  origin: string;
  evidence: { label: string; url?: string; quote?: string; at?: string; detail?: string }[] | null;
  source_agent: string;
  expires_at: string | null;
  target_search: string;
  status: string;
  reason: string;
  brief: string | null;
  created: string;
}

export interface VoiceGuideRow {
  site: string;
  body: string;
  samples: { title: string; passage: string }[] | null;
  source: "content" | "default" | "person";
  source_site: string | null;
  updated_by: string;
  updated: string;
  suggestion?: string;
  suggestion_through?: string | null;
}

// ---- reads ----

export async function getSite(site: string): Promise<SiteRow | null> {
  const [row] = await select<SiteRow>("sites", `id=eq.${enc(site)}&select=id,name,slug,domain`);
  return row ?? null;
}

const POST_COLS = "id,title,subtitle,type,status,excerpt,slug,tags,published_at,word_count";

/** Published posts, newest first. `withBody` adds content_md (the voice guide reads it). */
export async function publishedPosts(site: string, limit: number, withBody = false): Promise<PostRow[]> {
  const cols = withBody ? `${POST_COLS},content_md` : POST_COLS;
  const rows = await select<PostRow>(
    "posts",
    `site=eq.${enc(site)}&status=eq.published&select=${cols}&order=published_at.desc.nullslast&limit=${limit}`,
  );
  return rows.map((r) => ({ ...r, content_md: r.content_md ?? "" }));
}

export async function collections(site: string): Promise<CollectionRow[]> {
  return select<CollectionRow>("collections", `site=eq.${enc(site)}&select=name,slug,description,is_hidden&order=position`);
}

const BRIEF_COLS =
  "id,site,title,status,planned_date,collection_name,body,post,topics,fit,origin,sources,notes,outline,angle,audience,length,batch,pitched_by,idea,expires_at";

/** Briefs in the pipeline (not done, cancelled or rejected). */
export async function pipelineBriefs(site: string): Promise<BriefRow[]> {
  return select<BriefRow>(
    "briefs",
    `site=eq.${enc(site)}&status=not.in.(done,cancelled,rejected)&select=${BRIEF_COLS}&order=created.desc&limit=200`,
  );
}

export async function getBrief(site: string, id: string): Promise<BriefRow | null> {
  const [row] = await select<BriefRow>("briefs", `site=eq.${enc(site)}&id=eq.${enc(id)}&select=${BRIEF_COLS}`);
  return row ?? null;
}

export async function getPost(site: string, id: string): Promise<PostRow | null> {
  const [row] = await select<PostRow>("posts", `site=eq.${enc(site)}&id=eq.${enc(id)}&select=${POST_COLS},content_md`);
  return row ?? null;
}

/** Who wrote each version of a post, oldest first. */
export async function versionAuthors(site: string, post: string): Promise<{ version: number; created_by: string }[]> {
  return select("post_versions", `site=eq.${enc(site)}&post=eq.${enc(post)}&select=version,created_by&order=version`);
}

export async function ideas(site: string, ids: string[] | null, limit: number): Promise<IdeaRow[]> {
  const which = ids ? `id=in.(${ids.map(enc).join(",")})` : "status=eq.new";
  return select<IdeaRow>("agent_ideas", `site=eq.${enc(site)}&${which}&select=*&order=created&limit=${limit}`);
}

export async function voiceGuide(site: string): Promise<VoiceGuideRow | null> {
  try {
    const [row] = await select<VoiceGuideRow>("voice_guides", `site=eq.${enc(site)}&select=*`);
    return row ?? null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

// ---- writes ----

/**
 * A new idea. Inside a workflow step pass `key` (stable across replays) so a
 * step retried after a crash finds the row it already wrote.
 */
export async function insertIdea(row: Omit<IdeaRow, "id" | "status" | "reason" | "brief" | "created">, key?: string): Promise<IdeaRow> {
  const id = key ? stableId(key) : newId();
  if (key) {
    const [existing] = await select<IdeaRow>("agent_ideas", `id=eq.${id}&select=*`);
    if (existing) return existing;
  }
  return insert<IdeaRow>("agent_ideas", { id, ...row, status: "new" });
}

export async function settleIdea(site: string, id: string, status: "pitched" | "rejected", reason: string, brief: string | null) {
  await patch("agent_ideas", `site=eq.${enc(site)}&id=eq.${enc(id)}`, { status, reason, brief });
}

/** A new pitched brief. The id is minted by the caller so a replayed step writes the same row. */
export async function insertPitch(row: Partial<BriefRow> & { id: string; site: string; title: string }): Promise<void> {
  const [existing] = await select<{ id: string }>("briefs", `id=eq.${enc(row.id)}&select=id`);
  if (existing) return; // the step ran before the worker restarted
  await insert("briefs", { ...row, status: "pitched", pitched_by: "agent:pitcher" });
}

/** Link the draft to an agent-made brief. Briefs a person made are never changed. */
export async function linkDraft(site: string, brief: string, post: string): Promise<void> {
  await patch("briefs", `site=eq.${enc(site)}&id=eq.${enc(brief)}&pitched_by=like.agent:*&post=is.null`, { post });
}

/** A new draft post with the Writer's first version as its content. */
export async function insertDraftPost(row: {
  id: string;
  site: string;
  title: string;
  subtitle: string;
  type: string;
  excerpt: string;
  content_md: string;
  word_count: number;
}): Promise<void> {
  const [existing] = await select<{ id: string }>("posts", `id=eq.${enc(row.id)}&select=id`);
  if (existing) return;
  await insert("posts", { ...row, status: "draft" });
}

export async function insertVersion(row: {
  id: string;
  site: string;
  post: string;
  content: string;
  message: string;
  attributes: Record<string, unknown>;
}): Promise<number> {
  const [existing] = await select<{ version: number }>("post_versions", `id=eq.${enc(row.id)}&select=version`);
  if (existing) return existing.version;
  const authors = await versionAuthors(row.site, row.post);
  const version = (authors.at(-1)?.version ?? 0) + 1;
  await insert("post_versions", {
    ...row,
    version,
    created_by: "agent:writer",
    authored: new Date().toISOString(),
  });
  return version;
}

/** Writes the voice guide unless a person has edited it: theirs always wins. */
export async function saveVoiceGuide(row: Omit<VoiceGuideRow, "updated" | "updated_by">): Promise<boolean> {
  const current = await voiceGuide(row.site);
  if (current?.source === "person") return false;
  if (current) {
    await patch("voice_guides", `site=eq.${enc(row.site)}&source=neq.person`, { ...row, updated_by: "agent:writer" });
  } else {
    await insert("voice_guides", { ...row, updated_by: "agent:writer" });
  }
  return true;
}

/** What reviewers said about recent pitches: rejections with reasons and approvals with notes. */
export async function reviewerFeedback(site: string, limit = 20): Promise<{ title: string; status: string; reject_reason: string; notes: BriefRow["notes"] }[]> {
  return select(
    "briefs",
    `site=eq.${enc(site)}&pitched_by=like.agent:*&or=(status.eq.rejected,notes.not.is.null)&select=title,status,reject_reason,notes&order=updated.desc&limit=${limit}`,
  );
}

/** Say on an agent-made pitch that its research is thinner than usual (shown on the pitch). */
export async function noteResearchGap(site: string, brief: string, note: string): Promise<void> {
  const [row] = await select<{ fit: unknown }>("briefs", `site=eq.${enc(site)}&id=eq.${enc(brief)}&pitched_by=like.agent:*&select=fit`);
  if (!row) return;
  const fit = row.fit && typeof row.fit === "object" ? (row.fit as Record<string, unknown>) : {};
  await patch("briefs", `site=eq.${enc(site)}&id=eq.${enc(brief)}&pitched_by=like.agent:*`, { fit: { ...fit, research: note } });
}

/** Mark an agent-made brief's stage. Briefs a person made are never changed. */
export async function setAgentBriefStatus(site: string, brief: string, status: string, from: string[]): Promise<void> {
  await patch("briefs", `site=eq.${enc(site)}&id=eq.${enc(brief)}&pitched_by=like.agent:*&status=in.(${from.join(",")})`, { status });
}

/**
 * Put the Writer's first draft into a post the pipeline created empty when the
 * pitch was approved. Only while it is still empty: the filter makes the
 * check and the write one statement, so a person who started writing wins.
 */
export async function fillEmptyPost(site: string, post: string, values: { title: string; subtitle: string; excerpt: string; content_md: string; word_count: number }): Promise<boolean> {
  const rows = await patch("posts", `site=eq.${enc(site)}&id=eq.${enc(post)}&content_md=eq.&status=eq.draft`, values);
  return rows.length === 1;
}

// ---- batches ----

export type BatchCadence = "weekly" | "flood";

/** The tenant's batch cadence; weekly when it never chose (or the table isn't on the server yet). */
export async function batchCadence(site: string): Promise<BatchCadence> {
  try {
    const [row] = await select<{ batch_cadence: string }>("agent_settings", `site=eq.${enc(site)}&select=batch_cadence`);
    return row?.batch_cadence === "flood" ? "flood" : "weekly";
  } catch (err) {
    if (isMissing(err)) return "weekly";
    throw err;
  }
}

/** Ideas waiting for a batch: the plan's oldest first, then the rest newest first. */
export async function poolIdeas(site: string, limit: number): Promise<{ id: string; origin: string }[]> {
  const [plan, other] = await Promise.all([
    select<{ id: string; origin: string }>("agent_ideas", `site=eq.${enc(site)}&status=eq.new&origin=eq.plan&select=id,origin&order=created&limit=${limit}`),
    select<{ id: string; origin: string }>("agent_ideas", `site=eq.${enc(site)}&status=eq.new&origin=neq.plan&select=id,origin&order=created.desc&limit=${limit}`),
  ]);
  return [...plan, ...other].slice(0, limit);
}

export interface BatchRow {
  site: string;
  quarter: string;
  number: number;
  quota: number;
  state: "pending" | "in_review" | "topping_up" | "closed" | "cancelled";
  released_at: string | null;
  topups: number;
}

export async function quarterBatches(site: string, quarter: string): Promise<BatchRow[]> {
  return select<BatchRow>("content_batches", `site=eq.${enc(site)}&quarter=eq.${enc(quarter)}&select=*&order=number`);
}

/** Write a batch row; a replayed step writes the same one. */
export async function saveBatch(row: BatchRow): Promise<void> {
  const res = await rest(`/content_batches?on_conflict=site,quarter,number`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ ...row, updated: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`content_batches write answered ${res.status}`);
}

/** Briefs created since the quarter started: what counts toward its target. */
export async function quarterBriefs(site: string, since: string): Promise<{ id: string; status: string; batch: number | null; pitched_by: string; created: string }[]> {
  return select("briefs", `site=eq.${enc(site)}&created=gte.${enc(since)}&select=id,status,batch,pitched_by,created&limit=10000`);
}

/** The Pitcher's pitches people decided, all time: for the approval rate. */
export async function decidedPitches(site: string): Promise<{ status: string }[]> {
  return select("briefs", `site=eq.${enc(site)}&pitched_by=eq.agent:pitcher&status=neq.pitched&select=status&limit=10000`);
}

/** Everything ever pitched or written for the tenant: the no-repeats check reads it. */
export async function everyBrief(site: string): Promise<{ id: string; title: string; angle: string; status: string; reject_reason: string; created: string }[]> {
  return select("briefs", `site=eq.${enc(site)}&select=id,title,angle,status,reject_reason,created&order=created.desc&limit=10000`);
}

/** Tenants with work for the daily batch run: ideas waiting, or a batch still open. */
export async function sitesWithBatchWork(): Promise<string[]> {
  const [ideas, open] = await Promise.all([
    select<{ site: string }>("agent_ideas", `status=eq.new&select=site&limit=10000`),
    select<{ site: string }>("content_batches", `state=in.(in_review,topping_up)&select=site&limit=10000`).catch((err) => {
      if (isMissing(err)) return [];
      throw err;
    }),
  ]);
  return [...new Set([...ideas, ...open].map((r) => r.site))];
}

// ---- taste ----

export interface TasteRow {
  id: string;
  at: string;
  actor: string;
  object_kind: "pitch" | "draft" | "plan";
  object_id: string;
  decision: string;
  reason: string;
  notes: { text?: string }[] | null;
  title: string;
  topic: string;
  angle: string;
  origin: string;
}

/** The tenant's decisions, newest first (none when the table isn't on the server yet). */
export async function tasteLog(site: string, opts: { since?: string | null; kind?: TasteRow["object_kind"]; limit?: number } = {}): Promise<TasteRow[]> {
  const filters = [`site=eq.${enc(site)}`];
  if (opts.since) filters.push(`at=gt.${enc(opts.since)}`);
  if (opts.kind) filters.push(`object_kind=eq.${opts.kind}`);
  try {
    return await select<TasteRow>("taste_log", `${filters.join("&")}&select=*&order=at.desc&limit=${opts.limit ?? 200}`);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

export interface TasteProfileRow {
  site: string;
  summary: string;
  summary_through: string | null;
  notes: string;
}

export async function tasteProfile(site: string): Promise<TasteProfileRow | null> {
  try {
    const [row] = await select<TasteProfileRow>("taste_profiles", `site=eq.${enc(site)}&select=site,summary,summary_through,notes`);
    return row ?? null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** The Pitcher's summary. Never touches the tenant's notes. */
export async function saveTasteSummary(site: string, summary: string, through: string): Promise<void> {
  const rows = await patch("taste_profiles", `site=eq.${enc(site)}`, { summary, summary_through: through });
  if (rows.length === 0) await insert("taste_profiles", { site, summary, summary_through: through });
}

/** Posts whose drafts a reviewer edited after the Writer, newest first. */
export async function editedDrafts(site: string, since: string | null, limit = 10): Promise<TasteRow[]> {
  return (await tasteLog(site, { since, kind: "draft", limit: limit * 3 })).filter((r) => r.decision === "edited").slice(0, limit);
}

/** A post's versions with their text, oldest first. */
export async function versionsOf(site: string, post: string): Promise<{ version: number; created_by: string; content: string }[]> {
  return select("post_versions", `site=eq.${enc(site)}&post=eq.${enc(post)}&select=version,created_by,content&order=version`);
}

/** The Writer's proposed change to the voice guide. Never the guide itself. */
export async function saveVoiceSuggestion(site: string, suggestion: string, through: string): Promise<void> {
  await patch("voice_guides", `site=eq.${enc(site)}`, { suggestion, suggestion_through: through });
}
