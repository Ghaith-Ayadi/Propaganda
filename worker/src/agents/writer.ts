// The Writer (agents.md #5): writes the full draft from an approved brief,
// minding tone, voice and veracity, then hands it to a person for review.
//
// - Voice: the tenant's voice guide (voice.ts), or the default voice.
// - Veracity: research on the web first, and every number and quote links its
//   source; facts about the tenant come from the knowledge base only.
// - House rules (writing.ts): checked on the draft by code, fixed once by the
//   model, and anything left is noted on the version for the reviewer.
//
// It only ever writes a new draft: into the empty post the pipeline made when
// the pitch was approved, or a new post. After review notes, `writer:revise`
// adds the revision as a suggested version and never changes the post itself.

import { DBOS } from "@dbos-inc/dbos-sdk";
import {
  collections,
  fillEmptyPost,
  getBrief,
  getPost,
  getSite,
  insertDraftPost,
  pipelineBriefs,
  insertVersion,
  linkDraft,
  setAgentBriefStatus,
  versionAuthors,
  voiceGuide,
  type BriefRow,
} from "./store.js";
import { newId } from "./ids.js";
import { claimsFor, renderClaims, type Claim } from "./kb.js";
import { MODELS, askJson, askText, obj, str, strs } from "./model.js";
import { voiceFor, voiceGuideWorkflow, voiceSourceFor } from "./voice.js";
import { renderEdits, reviewerEdits } from "./edits.js";
import { AGENT_QUEUE, dispatchAttributes, registerAgent, type DispatchInput } from "../workflows/agents.js";
import { readPage, searchWebOrNothing, type Page } from "./web.js";
import { HOUSE_RULES, contrastHits, unsourcedNumbers, wordCount } from "./writing.js";

export interface WriteInput {
  site: string;
  briefId: string;
  /** Launch day one: the strongest pitches are drafted before the brief is approved. */
  beforeApproval?: boolean;
}

export interface WriteResult {
  status: "drafted" | "skipped";
  reason?: string;
  post?: string;
  version?: number;
  words?: number;
  /** House-rule and sourcing problems left in the draft, for the reviewer. */
  left?: { contrast: number; unsourced: number; offSourceLinks: number };
}

const APPROVED = ["todo", "in_progress"];
const MAX_PAGES = 6;
const PAGE_CHARS = 9000;

interface Draft {
  title: string;
  subtitle: string;
  excerpt: string;
  markdown: string;
  missingFacts: string[];
}

function parseDraft(v: unknown): Draft {
  const o = obj(v, "The answer");
  const markdown = str(o.markdown, "markdown");
  if (wordCount(markdown) < 300) throw new Error("markdown is too short to be the full post.");
  return {
    title: str(o.title, "title", { max: 200 }),
    subtitle: str(o.subtitle, "subtitle", { optional: true, max: 300 }),
    excerpt: str(o.excerpt, "excerpt", { optional: true, max: 500 }),
    markdown,
    missingFacts: strs(o.missingFacts, "missingFacts", { optional: true }).slice(0, 20),
  };
}

function writerSystem(voice: string): string {
  return `You are the Writer for Propaganda: you write blog posts for a tenant, in the tenant's voice, from an approved brief. Your three concerns are tone, voice and veracity.

${HOUSE_RULES}

The tenant's voice guide (follow it closely):

${voice}`;
}

function briefBlock(b: BriefRow): string {
  const notes = (b.notes ?? []).map((n) => {
    const line = n.lineId ? (b.outline ?? []).find((l) => l.id === n.lineId)?.text : null;
    return `- ${line ? `On "${line}": ` : ""}${n.text}`;
  });
  return [
    `Title: ${b.title}`,
    b.angle && `Angle: ${b.angle}`,
    b.audience && `Audience: ${b.audience}`,
    b.length && `Length: ${b.length}`,
    b.outline?.length ? `Outline:\n${b.outline.map((l, i) => `${i + 1}. ${l.text}`).join("\n")}` : b.body,
    notes.length ? `Reviewer notes on the pitch (do what they say):\n${notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function pagesBlock(pages: Page[]): string {
  return pages.map((p, i) => `[S${i + 1}] ${p.title} <${p.url}>\n${p.text}`).join("\n\n---\n\n") || "(no sources could be read)";
}

/** Links in the draft that point at none of the pages it was given. */
function offSourceLinks(markdown: string, allowed: string[]): string[] {
  const norm = (u: string) => u.replace(/[#?].*$/, "").replace(/\/$/, "");
  const ok = new Set(allowed.map(norm));
  return [...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).filter((u) => !ok.has(norm(u)));
}

/** Fix house-rule breaks once; whatever is left is reported, never hidden. */
async function enforceRules(site: string, step: string, voice: string, markdown: string): Promise<string> {
  const hits = contrastHits(markdown);
  if (hits.length === 0) return markdown;
  const fixed = await askText(step, {
    site,
    job: "writer:rules",
    model: MODELS.base,
    maxOutputTokens: 12000,
    system: writerSystem(voice),
    prompt: `These sentences break house rule 1 (the "That's not X. It's Y." contrast):
${hits.map((h) => `- ${h.sentence}`).join("\n")}

Rewrite only those sentences as comparisons ("This is much more X than it is Y"), keeping the meaning and the voice. Change nothing else. Answer with the full post in Markdown and nothing else.

${markdown}`,
  });
  const cleaned = fixed.replace(/^```(?:markdown|md)?\s*|\s*```$/g, "").trim();
  // A rewrite that lost most of the post is worse than the rule break.
  return wordCount(cleaned) > wordCount(markdown) * 0.8 ? cleaned : markdown;
}

async function research(site: string, brief: BriefRow): Promise<{ pages: Page[]; claims: Claim[] }> {
  const queries = await askJson(
    "plan research",
    {
      site,
      job: "writer:research",
      model: MODELS.base,
      maxOutputTokens: 800,
      system: "You plan web research for a blog post. Prefer primary sources: studies, official docs, the people involved.",
      prompt: `${briefBlock(brief)}\n\nGive three web searches that would find the facts, numbers and quotes this post needs. Answer with JSON only: {"searches": ["...", "...", "..."]}`,
    },
    (v) => strs(obj(v, "The answer").searches, "searches").slice(0, 3),
  );

  const urls: string[] = (brief.sources ?? []).map((s) => s.url);
  for (const [n, q] of queries.entries()) {
    const hits = await DBOS.runStep(() => searchWebOrNothing(q, 5, { site, job: "writer:research" }), { name: `search ${n + 1}` });
    for (const h of hits) if (!urls.includes(h.url)) urls.push(h.url);
  }

  const pages: Page[] = [];
  for (const [n, url] of urls.slice(0, MAX_PAGES + 4).entries()) {
    if (pages.length >= MAX_PAGES) break;
    // An unreadable page is skipped, not retried: there are others.
    const page = await DBOS.runStep(() => readPage(url, PAGE_CHARS).catch(() => null), { name: `read source ${n + 1}` });
    if (page && page.text.length > 300) pages.push(page);
  }

  const claims = await DBOS.runStep(
    () => claimsFor(site, [brief.title, brief.angle, ...(brief.outline ?? []).map((l) => l.text)].filter(Boolean), 8),
    { name: "read the knowledge base" },
  );
  return { pages, claims };
}

async function writeRun(input: WriteInput): Promise<WriteResult> {
  const { site, briefId } = input;
  const brief = await DBOS.runStep(() => getBrief(site, briefId), { name: "read the brief" });
  if (!brief) return { status: "skipped", reason: "no such brief" };
  const allowed = input.beforeApproval ? [...APPROVED, "pitched"] : APPROVED;
  if (!allowed.includes(brief.status)) return { status: "skipped", reason: `the brief is ${brief.status}` };

  // The post to write into: the empty one the pipeline made on approval, or a new one.
  const target = await DBOS.runStep(
    async () => {
      if (!brief.post) return { post: null as string | null, empty: true };
      const [post, authors] = await Promise.all([getPost(site, brief.post), versionAuthors(site, brief.post)]);
      return { post: brief.post, empty: Boolean(post && post.status === "draft" && !post.content_md.trim() && authors.length === 0) };
    },
    { name: "check the post" },
  );
  if (target.post && !target.empty) return { status: "skipped", reason: "the post already has writing in it", post: target.post };

  let [guide, tenant, cols] = await DBOS.runStep(() => Promise.all([voiceGuide(site), getSite(site), collections(site)]), {
    name: "read the voice and the tenant",
  });
  if (!guide) {
    // The Writer's first job on a tenant: its voice guide, before any post.
    await voiceGuideWorkflow({ site, sourceSite: voiceSourceFor(site) });
    guide = await DBOS.runStep(() => voiceGuide(site), { name: "read the new voice guide" });
  }
  const voice = voiceFor(guide);
  const { pages, claims } = await research(site, brief);
  const edits = await DBOS.runStep(() => reviewerEdits(site, null, 5), { name: "read reviewer edits" });

  const draft = await askJson(
    "write the draft",
    {
      site,
      job: "writer:draft",
      model: MODELS.advanced,
      maxOutputTokens: 12000,
      system: writerSystem(voice),
      prompt: `Write the full post for ${tenant?.name ?? "the tenant"} from this brief.

${briefBlock(brief)}

What the tenant knows (knowledge base; the only source for facts about the tenant):
${renderClaims(claims)}

Sources you read (cite them as Markdown links on the words they support; use no other URLs):
${pagesBlock(pages)}
${edits.length ? `\nHow reviewers edited your recent drafts for this tenant (do what they did without being asked):\n${renderEdits(edits)}\n` : ""}
Write the whole post in Markdown: no H1 (the title is separate), H2 subheads, links inline. Then list the facts about the tenant you needed and didn't have.

Answer with JSON only: {"title": "...", "subtitle": "...", "excerpt": "one or two sentences for listings", "markdown": "...", "missingFacts": ["..."]}`,
    },
    parseDraft,
  );

  const markdown = await enforceRules(site, "keep the house rules", voice, draft.markdown);
  const contrast = contrastHits(markdown);
  const unsourced = unsourcedNumbers(markdown);
  const offSource = offSourceLinks(markdown, pages.map((p) => p.url));
  const words = wordCount(markdown);

  const postId = target.post ?? (await DBOS.runStep(() => Promise.resolve(newId()), { name: "mint the post" }));
  const fields = { title: draft.title, subtitle: draft.subtitle, excerpt: draft.excerpt, content_md: markdown, word_count: words };
  const wrote = await DBOS.runStep(
    async () => {
      if (target.post) return fillEmptyPost(site, target.post, fields);
      const collection = brief.collection_name || cols.find((c) => !c.is_hidden)?.name || "";
      await insertDraftPost({ id: postId, site, type: collection, ...fields });
      return true;
    },
    { name: "save the draft" },
  );
  if (!wrote) return { status: "skipped", reason: "someone started writing in the post first", post: postId };

  const versionId = await DBOS.runStep(() => Promise.resolve(newId()), { name: "mint the version" });
  const version = await DBOS.runStep(
    () =>
      insertVersion({
        id: versionId,
        site,
        post: postId,
        content: markdown,
        message: `First draft by the Writer, from the brief "${brief.title}".`,
        attributes: {
          agent: "writer",
          brief: brief.id,
          title: draft.title,
          sources: pages.map((p) => ({ url: p.url, label: p.title })),
          claims: claims.map((c) => c.id),
          missingFacts: draft.missingFacts,
          lint: {
            contrast: contrast.map((h) => h.sentence),
            unsourced: unsourced.map((h) => h.sentence),
            offSourceLinks: offSource,
          },
        },
      }),
    { name: "save the version" },
  );

  await DBOS.runStep(
    async () => {
      if (!target.post) await linkDraft(site, brief.id, postId);
      // Drafted before approval (launch day one): the brief stays pitched and
      // the reviewer sees the draft with it. Otherwise it goes to review.
      if (!input.beforeApproval || brief.status !== "pitched") await setAgentBriefStatus(site, brief.id, "in_review", APPROVED);
    },
    { name: "send for review" },
  );

  return {
    status: "drafted",
    post: postId,
    version,
    words,
    left: { contrast: contrast.length, unsourced: unsourced.length, offSourceLinks: offSource.length },
  };
}

export const writer = DBOS.registerWorkflow(writeRun, { name: "writer" });

/** The approved brief a request most likely means ("write the one about 3am jobs"), by title words. */
export function briefForTask(briefs: Pick<BriefRow, "id" | "title" | "status" | "post">[], task: string): string | null {
  const words = (x: string) => new Set(x.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const want = words(task);
  let best: { id: string; n: number } | null = null;
  for (const b of briefs) {
    if (!APPROVED.includes(b.status)) continue;
    const n = [...words(b.title)].filter((w) => want.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { id: b.id, n };
  }
  return best?.id ?? null;
}

/**
 * Chat's hand-off ("write the post about X"): the approved brief for the post
 * Chat names, else the one whose title matches the ask. Nothing approved
 * matches: null, and Chat hears there's nothing to write yet (422).
 */
async function writeFromRequest(input: DispatchInput): Promise<string | null> {
  const briefs = await pipelineBriefs(input.site);
  const briefId =
    (input.post ? briefs.find((b) => b.post === input.post && APPROVED.includes(b.status))?.id : undefined) ??
    briefForTask(briefs, input.task);
  if (!briefId) return null;
  const handle = await DBOS.startWorkflow(writer, { queueName: AGENT_QUEUE, workflowAttributes: dispatchAttributes("writer", input) })({
    site: input.site,
    briefId,
  });
  return handle.workflowID;
}

registerAgent("writer", writeFromRequest);

// ---- revisions ----

export interface ReviseInput {
  site: string;
  post: string;
  /** The reviewer's notes, in their words. */
  notes: string;
}

/**
 * Revise a draft after review notes, as a suggestion: a new version in the
 * post's history, created by the Writer. The post itself (what the person sees
 * and edits) is never changed, so nothing a person wrote can be overwritten.
 */
async function reviseRun(input: ReviseInput): Promise<WriteResult> {
  const { site, post } = input;
  const [current, guide] = await DBOS.runStep(() => Promise.all([getPost(site, post), voiceGuide(site)]), { name: "read the post" });
  if (!current) return { status: "skipped", reason: "no such post" };
  if (current.status === "published") return { status: "skipped", reason: "the post is published" };
  const voice = voiceFor(guide);

  const revised = await askText("revise", {
    site,
    job: "writer:revise",
    model: MODELS.advanced,
    maxOutputTokens: 12000,
    system: writerSystem(voice),
    prompt: `A reviewer left these notes on the post below:
${input.notes}

Revise the post to address every note. Keep everything the notes don't touch exactly as it is, including the person's own edits. Answer with the full revised post in Markdown and nothing else.

${current.content_md}`,
  });
  const markdown = await enforceRules(site, "keep the house rules", voice, revised.replace(/^```(?:markdown|md)?\s*|\s*```$/g, "").trim());

  const versionId = await DBOS.runStep(() => Promise.resolve(newId()), { name: "mint the version" });
  const version = await DBOS.runStep(
    () =>
      insertVersion({
        id: versionId,
        site,
        post,
        content: markdown,
        message: "Suggested revision by the Writer, after review notes. Not applied: restore it from history to use it.",
        attributes: {
          agent: "writer",
          suggestion: true,
          notes: input.notes.slice(0, 4000),
          lint: { contrast: contrastHits(markdown).map((h) => h.sentence), unsourced: unsourcedNumbers(markdown).map((h) => h.sentence) },
        },
      }),
    { name: "save the suggestion" },
  );
  return { status: "drafted", post, version, words: wordCount(markdown) };
}

export const reviser = DBOS.registerWorkflow(reviseRun, { name: "writer:revise" });
