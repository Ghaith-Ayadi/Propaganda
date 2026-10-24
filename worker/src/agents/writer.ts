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
  collectionRulesBlock,
  styles,
  stylesBlock,
  collections,
  fillEmptyPost,
  getBrief,
  getPost,
  getSite,
  insertDraftPost,
  personVoice,
  pipelineBriefs,
  insertVersion,
  linkDraft,
  noteResearchGap,
  moveBrief,
  selectedForWriter,
  writingForWriter,
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
import { AGENT_QUEUE, dispatchAttributes, registerAgent, startOnceForTenant, type DispatchInput } from "../workflows/agents.js";
import { readPage, type Page } from "./web.js";
import { AUTHORITY_RULE, quotable } from "./authority.js";
import { ownHostsOf, vetSources } from "./sources.js";
import { SearchSession, searchDurably } from "./search.js";
import { HOUSE_RULES, RULE_NAMES, TITLE_RULES, contrastHits, hardHits, houseTitleHits, noDashes, proseNumbers, styleHits, titleHits, unsourcedNumbers, wordCount, type Hit, type PolishStats, type RhythmStats } from "./writing.js";
import { polishRhythm, polishTexts } from "./polish.js";
import { briefBlock, parseDraft, writerSystem } from "./writer-prompt.js";

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
  /** House-rule (contrast, lead-ins, "quietly", two-part subheads) and sourcing problems left in the draft, for the reviewer. */
  left?: { contrast: number; unsourced: number; offSourceLinks: number };
}

const APPROVED = ["todo", "in_progress"];
const MAX_PAGES = 6;
const PAGE_CHARS = 9000;

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
  // The wider check (2026-10-12) can fix a draft an older run recorded as clean: replays must match.
  const hits = (await DBOS.patch("writer-style-hits")) ? styleHits(markdown) : contrastHits(markdown);
  if (hits.length === 0) return markdown;
  const fixed = await askText(step, {
    site,
    job: "writer:rules",
    model: MODELS.base,
    maxOutputTokens: 12000,
    system: writerSystem(voice),
    prompt: `These sentences break the house rules:
${hitLines(hits)}

Rewrite only those sentences so they keep the rules (a contrast becomes a comparison, "This is much more X than it is Y"; a lead-in is deleted and the sentence after it carries the point; a two-part subhead becomes one statement), keeping the meaning and the voice. Change nothing else. Answer with the full post in Markdown and nothing else.

${markdown}`,
  });
  const cleaned = fixed.replace(/^```(?:markdown|md)?\s*|\s*```$/g, "").trim();
  // A rewrite that lost most of the post is worse than the rule break.
  return wordCount(cleaned) > wordCount(markdown) * 0.8 ? cleaned : markdown;
}

const hitLines = (hits: Hit[]) => hits.map((h) => `- "${h.sentence}" (${RULE_NAMES[h.rule]})`).join("\n");

/**
 * A title or subtitle that breaks the title rules is asked for again, once, in a
 * small call; what comes back is checked and kept only when it passes. Both
 * fields go in one call so the pair still reads as one.
 */
async function enforceTitle(site: string, voice: string, draft: { title: string; subtitle: string }, check = titleHits): Promise<{ title: string; subtitle: string }> {
  const hits = [...check(draft.title), ...check(draft.subtitle)];
  if (hits.length === 0) return draft;
  const again = await askJson(
    "retitle",
    {
      site,
      job: "writer:rules",
      model: MODELS.base,
      maxOutputTokens: 400,
      system: writerSystem(voice),
      prompt: `The title or subtitle of the post breaks the title rules:
${hitLines(hits)}

Title: ${draft.title}
Subtitle: ${draft.subtitle || "(none)"}

Write them again as one plain statement each, keeping what the post says. Answer with JSON only: {"title": "...", "subtitle": "..."}`,
    },
    (v) => {
      const o = obj(v, "The answer");
      return { title: str(o.title, "title", { max: 200 }), subtitle: str(o.subtitle, "subtitle", { optional: true, max: 300 }) };
    },
  );
  const ok = check(again.title).length === 0 && check(again.subtitle).length === 0;
  return ok ? again : draft;
}

/**
 * The twenty rules on a finished draft: one small call judges the flagged
 * sentences (polish.ts), then every em dash goes. A title the call changed is
 * kept only when it still passes the title rules.
 */
async function polishDraft(site: string, step: string, voice: string, d: { markdown: string; title: string; subtitle: string; excerpt: string }) {
  const { texts, stats } = await polishTexts(step, { site, job: "writer:rules", model: MODELS.base, system: writerSystem(voice) }, [d.markdown, d.title, d.subtitle, d.excerpt]);
  const [markdown, title, subtitle, excerpt] = texts;
  const titled = (t: string, was: string) => (t && houseTitleHits(t).length === 0 ? t : noDashes(was));
  return { markdown, title: titled(title, d.title), subtitle: d.subtitle ? titled(subtitle, d.subtitle) : "", excerpt, stats };
}

/**
 * Second person and sentence monotony (2026-10-24): one rewrite of the
 * paragraphs over the line (polish.ts). A pass for style only, on a draft that
 * is already good: a call that fails leaves the draft as it was and no
 * rhythm numbers (desk review of #261). A step that threw replays as a throw.
 */
async function fixRhythm(site: string, voice: string, markdown: string): Promise<{ markdown: string; rhythm: RhythmStats | null }> {
  try {
    const r = await polishRhythm("fix the rhythm", { site, job: "writer:rules", model: MODELS.writer, system: writerSystem(voice) }, markdown);
    return { markdown: r.markdown, rhythm: r.stats };
  } catch (err) {
    DBOS.logger.warn(`writer rhythm: the rewrite call failed, draft kept as it was: ${(err as Error).message}`);
    return { markdown, rhythm: null };
  }
}

/** Every house-rule problem left in a draft, for the reviewer. */
const leftHits = (markdown: string, styled: boolean) => (styled ? [...styleHits(markdown), ...hardHits(markdown)] : styleHits(markdown));

async function research(site: string, brief: BriefRow): Promise<{ pages: Page[]; claims: Claim[]; searches: SearchSession }> {
  const queries = await askJson(
    "plan research",
    {
      site,
      job: "writer:research",
      model: MODELS.base,
      maxOutputTokens: 800,
      system: "You plan web research for a blog post. Prefer primary sources: studies, official docs, the people involved. The brief's own sources are already read, so never search inside their sites (no site: filters on them) and never build a search around a competitor or a page the brief mentions.",
      prompt: `${briefBlock(brief)}\n\nGive three web searches that would find the facts, numbers and quotes this post needs. Answer with JSON only: {"searches": ["...", "...", "..."]}`,
    },
    (v) => strs(obj(v, "The answer").searches, "searches").slice(0, 3),
  );

  // Search hits are read for citing only if their domain has authority (authority.ts). The brief's
  // own sources were chosen by the Pitcher and a person, and the tenant's own pages stay citable.
  // Guarded: a run recorded before this reads its sources unfiltered.
  const gated = await DBOS.patch("writer-authority");
  const ownHosts = gated ? await DBOS.runStep(() => ownHostsOf(site), { name: "read the site's hosts" }) : [];
  // Attachments (images, PDFs) aren't pages to read; the prompt places them (briefBlock).
  const urls: string[] = (brief.sources ?? []).filter((s) => !s.kind).map((s) => s.url);
  const searches = new SearchSession();
  const found: Awaited<ReturnType<typeof searchDurably>> = [];
  for (const [n, q] of queries.entries()) {
    // A search the service refused (not an outage: those wait in searchDurably)
    // costs this post a few sources, not the draft.
    try {
      found.push(...(await searchDurably(searches, q, 5, { site, job: "writer:research" }, `search ${n + 1}`)));
    } catch (err) {
      DBOS.logger.warn(`writer research: search "${q}" refused: ${(err as Error).message}`);
    }
  }
  // Vetted once for the whole post (sources.ts); a run recorded before the vetting reads the list's verdict.
  let citable = new Set(found.map((h) => h.url).filter((u) => quotable(u, ownHosts)));
  let hits = found;
  if (gated && (await DBOS.patch("writer-authority-vet"))) {
    const v = await vetSources({ site, job: "writer:research", topic: brief.title, label: "post", hits: found, ownHosts, searches });
    hits = v.hits;
    citable = v.citable;
  }
  for (const h of hits) if (!urls.includes(h.url) && (!gated || citable.has(h.url))) urls.push(h.url);

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
  return { pages, claims, searches };
}

async function writeRun(input: WriteInput): Promise<WriteResult> {
  const { site, briefId } = input;
  const brief = await DBOS.runStep(() => getBrief(site, briefId), { name: "read the brief" });
  if (!brief) return { status: "skipped", reason: "no such brief" };
  const allowed = input.beforeApproval ? [...APPROVED, "pitched"] : APPROVED;
  if (!allowed.includes(brief.status)) return { status: "skipped", reason: `the brief is ${brief.status}` };
  // Selected becomes Writing while the Writer is at it (runs recorded before this replay without).
  if (brief.status === "todo" && (await DBOS.patch("writer-marks-writing"))) {
    await DBOS.runStep(() => moveBrief(site, brief.id, "in_progress", ["todo"]), { name: "mark it Writing" });
  }

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

  // The 4th value is the voice the person wrote themselves (Getting started,
  // Settings). A run recorded before it was read replays it as undefined.
  let [guide, tenant, cols, ownVoice] = await DBOS.runStep(
    () => Promise.all([voiceGuide(site), getSite(site), collections(site), personVoice(site)]),
    { name: "read the voice and the tenant" },
  );
  if (!guide && !ownVoice) {
    // The Writer's first job on a tenant: its voice guide, before any post.
    await voiceGuideWorkflow({ site, sourceSite: voiceSourceFor(site) });
    guide = await DBOS.runStep(() => voiceGuide(site), { name: "read the new voice guide" });
  }
  // The person's words go over the craft (2026-10-24); runs recorded before replay the old join.
  const voice = (await DBOS.patch("writer-voice-craft")) ? voiceFor(guide, ownVoice) : ownVoice || voiceFor(guide);
  // The collection's own rules (collection_rules). A run recorded before they were read has none.
  const rulesBlock = collectionRulesBlock(cols ?? [], brief.collection_name || cols?.find((c) => !c.is_hidden)?.name || "");
  // The tenant's style rules (kb_styles). A run recorded before they were read has none.
  const tenantStyles = (await DBOS.patch("writer-styles"))
    ? stylesBlock(await DBOS.runStep(() => styles(site), { name: "read the tenant's styles" }))
    : "";
  const { pages, claims, searches } = await research(site, brief);
  const researchGap = searches.notice();
  const edits = await DBOS.runStep(() => reviewerEdits(site, null, 5), { name: "read reviewer edits" });

  const draft = await askJson(
    "write the draft",
    {
      site,
      job: "writer:draft",
      model: MODELS.writer,
      maxOutputTokens: 12000,
      system: writerSystem(voice, tenantStyles),
      prompt: `Write the full post for ${tenant?.name ?? "the tenant"} from this brief.

${briefBlock(brief)}
${rulesBlock ? `\n${rulesBlock}\n` : ""}
What the tenant knows (knowledge base; the only source for facts about the tenant):
${renderClaims(claims)}

Sources you read (cite them as Markdown links on the words they support; use no other URLs):
${pagesBlock(pages)}
${edits.length ? `\nHow reviewers edited your recent drafts for this tenant (do what they did without being asked):\n${renderEdits(edits)}\n` : ""}
Write the whole post in Markdown: no H1 (the title is separate), H2 subheads, links inline. Place evidence where the argument needs it, through the whole post, not in the first paragraphs; the outline's order is the argument's order, not a queue of sources to spend early. No single page or vendor carries the post: use a source once or twice at most, and do not cite a competitor's own marketing page. ${AUTHORITY_RULE} Vary paragraph length and let some ideas run long. The subtitle is the post's one short description (one or two sentences): it is shown under the title, on listings and in the page meta, so the body never repeats it, and no standfirst or italic summary line goes at the top of the body. The body opens with the argument itself. Then list the facts about the tenant you needed and didn't have.

Answer with JSON only: {"title": "...", "subtitle": "the short description", "markdown": "...", "missingFacts": ["..."]}`,
    },
    parseDraft,
  );

  let markdown = await enforceRules(site, "keep the house rules", voice, draft.markdown);
  // The twenty rules (2026-10-12): new hard checks on the title and a polish
  // call after it. Runs recorded before them replay without either.
  const styled = await DBOS.patch("writer-house-style");
  // A new step (2026-10-12): runs recorded before it replay without it.
  let titled = (await DBOS.patch("writer-retitle")) ? await enforceTitle(site, voice, draft, styled ? houseTitleHits : titleHits) : draft;
  let excerpt = draft.excerpt;
  let polish: PolishStats | undefined;
  if (styled) {
    const p = await polishDraft(site, "polish the prose", voice, { markdown, title: titled.title, subtitle: titled.subtitle, excerpt });
    ({ markdown, excerpt } = p);
    titled = { title: p.title, subtitle: p.subtitle };
    polish = p.stats;
  }
  // Second person and sentence monotony (2026-10-24): one rewrite of the paragraphs over the line.
  // A new step: runs recorded before it replay without it.
  let rhythm: RhythmStats | null = null;
  if (await DBOS.patch("writer-rhythm")) ({ markdown, rhythm } = await fixRhythm(site, voice, markdown));
  // One short description, kept in both places that show it: the subtitle (editor, reader) and the excerpt (listings, meta).
  // A new step (2026-10-15): runs recorded before it replay without it.
  if (await DBOS.patch("writer-one-description")) excerpt = titled.subtitle || excerpt;
  const contrast = leftHits(markdown, styled);
  const unsourced = unsourcedNumbers(markdown);
  const offSource = offSourceLinks(markdown, pages.map((p) => p.url));
  const words = wordCount(markdown);

  // Approved while it was being written (day one drafts start before approval):
  // approving gave the brief an empty post meanwhile, and that is the one to fill.
  // A new step (2026-10-22): runs recorded before it replay without it.
  let late: string | null = null;
  if (!target.post && (await DBOS.patch("writer-approved-meanwhile"))) {
    late = await DBOS.runStep(
      async () => {
        const now = await getBrief(site, brief.id);
        if (!now?.post) return null;
        const [post, authors] = await Promise.all([getPost(site, now.post), versionAuthors(site, now.post)]);
        return post && post.status === "draft" && !post.content_md.trim() && authors.length === 0 ? now.post : null;
      },
      { name: "check the brief for a post made meanwhile" },
    );
  }
  const into = target.post ?? late;
  const postId = into ?? (await DBOS.runStep(() => Promise.resolve(newId()), { name: "mint the post" }));
  const fields = { title: titled.title, subtitle: titled.subtitle, excerpt, content_md: markdown, word_count: words };
  const wrote = await DBOS.runStep(
    async () => {
      if (into) return fillEmptyPost(site, into, fields);
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
        message: `First draft by the Writer, from the brief "${brief.title}".${researchGap ? ` ${researchGap}` : ""}`,
        attributes: {
          agent: "writer",
          brief: brief.id,
          title: titled.title,
          sources: pages.map((p) => ({ url: p.url, label: p.title })),
          claims: claims.map((c) => c.id),
          missingFacts: draft.missingFacts,
          ...(researchGap ? { research: researchGap, skippedSearches: searches.gaps } : {}),
          lint: {
            contrast: contrast.map((h) => h.sentence),
            unsourced: unsourced.map((h) => h.sentence),
            offSourceLinks: offSource,
            ...(polish ? { polish } : {}),
            ...(rhythm ? { rhythm } : {}),
            prose: proseNumbers(markdown),
          },
        },
      }),
    { name: "save the version" },
  );

  // Tell the reviewer on the pitch too: the draft is thinner than usual.
  if (researchGap) await DBOS.runStep(() => noteResearchGap(site, brief.id, researchGap), { name: "note the skipped searches" });

  await DBOS.runStep(
    async () => {
      if (!into) await linkDraft(site, brief.id, postId);
      // Drafted before approval (launch day one): the brief stays pitched and
      // the reviewer sees the draft with it. Otherwise (approved meanwhile too) it goes to review.
      if (!input.beforeApproval || brief.status !== "pitched" || late) await setAgentBriefStatus(site, brief.id, "in_review", APPROVED);
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
  // The poll's id for this brief (dispatchWriting), so a button and a tick never write it twice.
  // A run already going is the answer; one that ended (a failed first try) is
  // tried again under the next id, whatever the poll's own try limit says: a
  // person asked.
  const key = `write-${briefId}`;
  const runs = await runsOf(key);
  if (runs.live) return runs.liveId ?? key;
  const handle = await DBOS.startWorkflow(writer, { workflowID: tryId(key, runs.total), queueName: AGENT_QUEUE, workflowAttributes: dispatchAttributes("writer", input) })({
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
  /** The brief that was sent back: it goes Writing while this runs and back to review after. */
  brief?: string;
}

/**
 * Revise a draft after review notes, as a suggestion: a new version in the
 * post's history, created by the Writer. The post itself (what the person sees
 * and edits) is never changed, so nothing a person wrote can be overwritten.
 */
async function reviseRun(input: ReviseInput): Promise<WriteResult> {
  const { site, post } = input;
  const [current, guide, ownVoice] = await DBOS.runStep(() => Promise.all([getPost(site, post), voiceGuide(site), personVoice(site)]), {
    name: "read the post",
  });
  if (!current) return { status: "skipped", reason: "no such post" };
  if (current.status === "published") return { status: "skipped", reason: "the post is published" };
  if (input.brief) await DBOS.runStep(() => moveBrief(site, input.brief!, "in_progress", ["todo"]), { name: "mark it Writing" });
  const voice = (await DBOS.patch("writer-revise-voice-craft")) ? voiceFor(guide, ownVoice) : ownVoice || voiceFor(guide);
  const tenantStyles = (await DBOS.patch("writer-revise-styles"))
    ? stylesBlock(await DBOS.runStep(() => styles(site), { name: "read the tenant's styles" }))
    : "";

  const revised = await askText("revise", {
    site,
    job: "writer:revise",
    model: MODELS.writer,
    maxOutputTokens: 12000,
    system: writerSystem(voice, tenantStyles),
    prompt: `A reviewer left these notes on the post below:
${input.notes}

Revise the post to address every note. Keep everything the notes don't touch exactly as it is, including the person's own edits. Answer with the full revised post in Markdown and nothing else.

${current.content_md}`,
  });
  let markdown = await enforceRules(site, "keep the house rules", voice, revised.replace(/^```(?:markdown|md)?\s*|\s*```$/g, "").trim());
  // The twenty rules (2026-10-12); runs recorded before them replay without.
  const styled = await DBOS.patch("writer-revise-house-style");
  if (styled) markdown = (await polishTexts("polish the prose", { site, job: "writer:rules", model: MODELS.base, system: writerSystem(voice) }, [markdown])).texts[0];
  let rhythm: RhythmStats | null = null;
  if (await DBOS.patch("writer-revise-rhythm")) ({ markdown, rhythm } = await fixRhythm(site, voice, markdown));

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
          lint: {
            contrast: leftHits(markdown, styled).map((h) => h.sentence),
            unsourced: unsourcedNumbers(markdown).map((h) => h.sentence),
            ...(rhythm ? { rhythm } : {}),
            prose: proseNumbers(markdown),
          },
        },
      }),
    { name: "save the suggestion" },
  );
  if (input.brief) await DBOS.runStep(() => moveBrief(site, input.brief!, "in_review", ["in_progress", "todo"]), { name: "send back for review" });
  return { status: "drafted", post, version, words: wordCount(markdown) };
}

export const reviser = DBOS.registerWorkflow(reviseRun, { name: "writer:revise" });

// ---- the writing poll: Selected briefs and sent-back drafts ----

/** Notes on a brief that nobody has marked done, as the reviewer wrote them. */
export function openNotes(b: Pick<BriefRow, "notes">): string {
  return (b.notes ?? []).filter((n) => !n.done && n.text.trim()).map((n) => `- ${n.quote ? `"${n.quote}": ` : ""}${n.text.trim()}`).join("\n");
}

const LIVE = ["PENDING", "ENQUEUED", "DELAYED"];
const FAILED = ["ERROR", "MAX_RECOVERY_ATTEMPTS_EXCEEDED", "CANCELLED"];
/** Tries on one piece of work (one write, or one revision for one set of notes) before the Writer stops and leaves it in Writing for a person. */
const MAX_TRIES = 3;
/** A brief in Writing this long with no run behind it is moved back to Selected. */
const STUCK_MS = 60 * 60_000;

/** The runs under one key (the first try, then `<key>-r1`, `<key>-r2`...): are any live, and how many ended badly. */
async function runsOf(key: string): Promise<{ live: boolean; liveId?: string; total: number; failed: number }> {
  const rows = (await DBOS.listWorkflows({ workflow_id_prefix: key, loadInput: false, loadOutput: false })).filter(
    (w) => w.workflowID === key || w.workflowID.startsWith(`${key}-r`),
  );
  const live = rows.find((w) => LIVE.includes(w.status));
  return { live: Boolean(live), liveId: live?.workflowID, total: rows.length, failed: rows.filter((w) => FAILED.includes(w.status)).length };
}

/** The id for the next try under `key`: the key itself first, then `-r1`, `-r2`. */
const tryId = (key: string, total: number) => (total === 0 ? key : `${key}-r${total}`);

/** The key of the work a Writing brief was on: its revision when it has open notes on a written post, else its draft. */
async function workKey(b: BriefRow): Promise<string> {
  const post = b.post ? await getPost(b.site, b.post) : null;
  return post?.content_md.trim() && openNotes(b) ? `revise-${b.id}-${(b.notes ?? []).length}` : `write-${b.id}`;
}

/**
 * The catch-all: a brief the Writer owns that has sat in Writing for an hour
 * with no run behind it (the run failed, or the worker restarted past its
 * recovery) goes back to Selected, so the next pass of dispatchWriting tries it
 * again under a new run id. After MAX_TRIES failures of the same work it stays
 * in Writing, which is where a person looks: retry it from Admin > Runs.
 */
export async function sweepStuckWriting(now = Date.now(), stuckMs = STUCK_MS): Promise<string[]> {
  const moved: string[] = [];
  for (const b of await writingForWriter(new Date(now - stuckMs).toISOString())) {
    const runs = await runsOf(await workKey(b));
    if (runs.live || runs.failed >= MAX_TRIES) continue;
    await moveBrief(b.site, b.id, "todo", ["in_progress"]);
    moved.push(b.id);
  }
  return moved;
}

/**
 * Every Selected brief the Writer owns, a page at a time, oldest first: briefs
 * that ran out of tries stay Selected and would fill a single page for good.
 */
async function selectedBriefs(): Promise<BriefRow[]> {
  const all: BriefRow[] = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const page = await selectedForWriter(50, offset);
    all.push(...page);
    if (page.length < 50) break;
  }
  return all;
}

/**
 * Selected briefs the Writer owns, started: an approved pitch gets its draft, a
 * draft that was sent back gets a revision, each as soon as a tick sees it, so
 * nothing waits in Selected for a person to ask. A run's id comes from its work
 * (the brief, and for a revision how many notes it holds), so however many
 * ticks see a brief it runs once; a retry after the catch-all adds `-r<n>`.
 * Returns the run ids asked for.
 */
export async function dispatchWriting(now = Date.now(), stuckMs = STUCK_MS): Promise<string[]> {
  await sweepStuckWriting(now, stuckMs);
  const started: string[] = [];
  for (const b of await selectedBriefs()) {
    const post = b.post ? await getPost(b.site, b.post) : null;
    const written = Boolean(post && post.content_md.trim());
    if (!written) {
      const runs = await runsOf(`write-${b.id}`);
      if (runs.live || runs.failed >= MAX_TRIES) continue;
      const id = tryId(`write-${b.id}`, runs.total);
      await startOnceForTenant(b.site, id, writer, { site: b.site, briefId: b.id });
      started.push(id);
      continue;
    }
    const notes = openNotes(b);
    if (!notes || !b.post) continue; // a draft with words and no notes is waiting on a person, not on the Writer
    const key = `revise-${b.id}-${(b.notes ?? []).length}`;
    const runs = await runsOf(key);
    if (runs.live || runs.failed >= MAX_TRIES) continue;
    const id = tryId(key, runs.total);
    await startOnceForTenant(b.site, id, reviser, { site: b.site, post: b.post, notes, brief: b.id });
    started.push(id);
  }
  return started;
}
