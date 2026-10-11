// The Pitcher (agents.md #4): turns ideas into pitches rated against the
// goals, or rejects them with a reason and keeps them. It never writes the post.
//
// An idea needs a reason to be pitched, and a pitch is a full brief: angle,
// audience, outline, sources, fit with its reasons. The model judges each idea
// (topics, timeliness, gaps, overlaps); code turns that into reasons with the
// goals and the pipeline (fit.ts), so the same facts always rate the same.
// Planned pitches go out in batches, at the tenant's cadence (batches.ts):
// weekly by default, or all at once. The rest of the plan waits for the next
// batch, and each batch reads what reviewers said about the last one.

import { DBOS } from "@dbos-inc/dbos-sdk";
import {
  collections,
  getSite,
  ideas as readIdeas,
  insertIdea,
  insertPitch,
  pipelineBriefs,
  publishedPosts,
  everyBrief,
  settleIdea,
  batchCadence,
  decidedPitches,
  poolIdeas,
  quarterBatches,
  quarterBriefs,
  saveBatch,
  sitesWithBatchWork,
  type BriefRow,
  type IdeaRow,
} from "./store.js";
import { rate, type FitReason, type Judgement } from "./fit.js";
import { APPROVED, approvalRate, isOpen, nextQuota, pitchesFor, targetMet, type BatchCount, type QuarterView } from "./batches.js";
import { isoWeek, quarterOf, readGoals, standing, type CountedPost, type Goals } from "./goals.js";
import { claimsFor, renderClaims } from "./kb.js";
import { nearest, readTaste, renderTaste, seenLine, type Seen } from "./taste.js";
import { MODELS, arr, askJson, obj, str, strs } from "./model.js";
import { newId } from "./ids.js";
import { type SearchHit } from "./web.js";
import { SearchSession, searchDurably } from "./search.js";
import { AGENT_QUEUE, registerAgent, startForDispatch, startForTenant, type DispatchInput } from "../workflows/agents.js";
import { writer } from "./writer.js";
import { voiceSuggest } from "./edits.js";

export interface PitchInput {
  site: string;
  /** These ideas; otherwise every idea still "new", oldest first. */
  ideaIds?: string[];
  /** Content batch these pitches belong to. Without one (and not asked by a person) the ideas wait for the next batch. */
  batch?: number | null;
  /** Most pitches in this run (the batch's slots, over-pitched). */
  max?: number;
  /** A top-up: why the batch is short, for the pitch prompt. */
  topUp?: string;
  /** Launch day one: draft the N strongest pitches right away (3). */
  draftTop?: number;
  /** The quarter's goals, until the Goals tables exist (goals.ts). */
  goals?: Goals | null;
  /** "Today", for tests and replays of a plan: YYYY-MM-DD. */
  today?: string;
  /** A person asked for these (Chat): pitch them now, outside the batches. */
  asked?: boolean;
}

export interface PitchResult {
  pitched: { idea: string; brief: string; title: string; grade: string }[];
  rejected: { idea: string; reason: string }[];
  waiting: string[];
  drafting: string[];
  /** Searches that gave up after DataForSEO kept failing; the pitches went out without them. */
  skippedSearches?: { step: string; query: string; message: string }[];
}

const MAX_IDEAS = 40;
/** The most pitches one run sends (a flood of a big plan). */
const MAX_BATCH = 500;
/** Ideas judged per model call. */
const JUDGE_CHUNK = 25;

// ---- the model's two jobs ----

interface Judged extends Judgement {
  idea: string;
  searches: string[];
  /** What materially changed since a close match was rejected or published ("" when nothing did). */
  changed: string;
}

export function parseJudgements(ids: string[]) {
  return (v: unknown): Judged[] => {
    const list = arr(obj(v, "The answer").ideas, "ideas");
    const out = list.map((x, i) => {
      const o = obj(x, `ideas[${i}]`);
      return {
        idea: str(o.id, `ideas[${i}].id`),
        topics: strs(o.topics, `ideas[${i}].topics`, { optional: true }).slice(0, 2),
        targetSearch: str(o.targetSearch, "targetSearch", { optional: true }),
        timely: o.timely === true,
        expiresAt: str(o.expiresAt, "expiresAt", { optional: true }),
        answersGap: str(o.answersGap, "answersGap", { optional: true, max: 300 }),
        demand: str(o.demand, "demand", { optional: true, max: 300 }),
        duplicateOf: str(o.duplicateOf, "duplicateOf", { optional: true, max: 300 }),
        replacesFlagged: str(o.replacesFlagged, "replacesFlagged", { optional: true, max: 300 }),
        searches: strs(o.searches, `ideas[${i}].searches`, { optional: true }).slice(0, 2),
        changed: str(o.changed, "changed", { optional: true, max: 600 }),
      };
    });
    const missing = ids.filter((id) => !out.some((j) => j.idea === id));
    if (missing.length) throw new Error(`No judgement for ideas ${missing.join(", ")}.`);
    return out;
  };
}

export interface Written {
  title: string;
  why: string;
  angle: string;
  audience: string;
  length: string;
  collection: string;
  outline: string[];
  sources: { url: string; label: string }[];
  /** One line: the feedback that shaped this pitch ("" when none applied). */
  learned: string;
}

/**
 * A URL without what search results add to it (Google's srsltid, utm_*), its
 * fragment and a trailing slash: models copy those tokens badly, and the page
 * is the same page.
 */
export function sameUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    for (const k of [...u.searchParams.keys()]) if (k === "srsltid" || k.startsWith("utm_")) u.searchParams.delete(k);
    u.hash = "";
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim();
  }
}

export function parsePitch(allowedUrls: Set<string>, collectionNames: string[]) {
  const given = new Map([...allowedUrls].map((u) => [sameUrl(u), u]));
  return (v: unknown): Written => {
    const o = obj(v, "The answer");
    const outline = strs(o.outline, "outline");
    if (outline.length < 4 || outline.length > 10) throw new Error("outline must have 4 to 10 lines.");
    const sources = arr(o.sources, "sources", { optional: true }).map((x, i) => {
      const s = obj(x, `sources[${i}]`);
      const asked = str(s.url, `sources[${i}].url`);
      const url = allowedUrls.has(asked) ? asked : given.get(sameUrl(asked));
      if (!url) throw new Error(`sources[${i}].url is not one of the URLs you were given: ${asked}`);
      return { url, label: str(s.label, `sources[${i}].label`, { max: 200 }) };
    });
    let collection = str(o.collection, "collection", { optional: true });
    if (collectionNames.length && !collectionNames.includes(collection)) collection = collectionNames[0];
    return {
      title: str(o.title, "title", { max: 200 }),
      why: str(o.why, "why", { max: 300 }),
      angle: str(o.angle, "angle", { max: 1200 }),
      audience: str(o.audience, "audience", { max: 600 }),
      length: str(o.length, "length", { optional: true, max: 60 }) || "1,000 to 1,400 words",
      collection,
      outline: outline.map((l) => l.slice(0, 400)),
      sources,
      learned: str(o.learned, "learned", { optional: true, max: 400 }),
    };
  };
}

// ---- helpers ----

function counted(briefs: BriefRow[], published: { tags: string[] | null; published_at: string | null }[], since: Date): CountedPost[] {
  const out: CountedPost[] = briefs.map((b) => ({ topics: b.topics ?? [], origin: b.origin, date: b.planned_date }));
  for (const p of published) {
    if (!p.published_at || new Date(p.published_at) < since) continue;
    // Published posts carry no topics yet; their tags stand in.
    out.push({ topics: p.tags ?? [], origin: "", date: p.published_at.slice(0, 10) });
  }
  return out;
}

/** Thursday of an ISO week (a publish-by date inside it). */
export function thursdayOf(week: string): string {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000 + (w - 1) * 7 * 86_400_000);
  return new Date(monday.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
}

function ideaBlock(i: IdeaRow): string {
  const ev = (i.evidence ?? [])
    .slice(0, 6)
    .map((e) => `  - ${e.label}${e.quote ? `: "${e.quote}"` : ""}${e.url ? ` <${e.url}>` : ""}${e.detail ? ` (${e.detail})` : ""}`)
    .join("\n");
  return `[${i.id}] ${i.title}\n  origin: ${i.origin}${i.expires_at ? `, expires ${i.expires_at.slice(0, 10)}` : ""}${i.target_search ? `, target search "${i.target_search}"` : ""}\n  ${i.summary}${ev ? `\n  evidence:\n${ev}` : ""}`;
}

function goalsBlock(goals: Goals | null): string {
  if (!goals) return "No goals approved yet for this quarter.";
  return [
    `Quarter ${goals.quarter}: ${goals.volume.total} posts.`,
    `Topics: ${goals.volume.topics.map((t) => `${t.name} (${t.low} to ${t.high})`).join(", ")}.`,
    `Target searches: ${goals.searches.map((s) => `"${s.query}"`).join(", ")}.`,
  ].join("\n");
}

/**
 * The judging prompt: every idea in `ideas` against the goals and what exists.
 * Pure, so Admin's Arena (src/arena.ts) asks other models exactly this.
 */
export function judgePrompt(o: {
  now: Date;
  tenantName: string | undefined;
  goals: Goals | null;
  existing: string[];
  ideas: IdeaRow[];
  close: Map<string, Seen | null>;
}): string {
  const { now, tenantName, goals, existing, ideas, close } = o;
  return `Today is ${now.toISOString().slice(0, 10)}. Judge each idea below for ${tenantName ?? "the tenant"}.

${goalsBlock(goals)}

Already published or in the pipeline:
${existing.join("\n") || "(nothing yet)"}

Ideas:
${ideas.map((i) => ideaBlock(i) + (close.get(i.id) ? `\n  close to something already ${seenLine(close.get(i.id)!)}` : "")).join("\n\n")}

For each idea, answer:
- topics: the one or two goal topics it belongs to (exact names from the goals; empty if none fit).
- targetSearch: the exact target search it would rank for, or "".
- timely: true only if it's tied to news, a date or a change that makes it worth less later; expiresAt: YYYY-MM-DD when it stops being worth it.
- answersGap: one sentence when it answers a question customers keep asking, an objection, or a claim the tenant makes without backing (say which); else "".
- demand: one sentence with the search-demand evidence in the idea (numbers only if the evidence has them); else "".
- duplicateOf: the title of a published or pipeline post it mostly repeats; else "".
- replacesFlagged: the title of a flagged post it would replace; else "".
- searches: one or two web searches that would find good sources for it.
- changed: only for an idea marked "close to something already ...": one sentence on what materially changed since then (a new source, news, a new number), or "" if nothing did.

Answer with JSON only: {"ideas": [{"id": "...", "topics": [], "targetSearch": "", "timely": false, "expiresAt": "", "answersGap": "", "demand": "", "duplicateOf": "", "replacesFlagged": "", "searches": [], "changed": ""}]}`;
}

export const PITCHER_SYSTEM = `You are the Pitcher for Propaganda, a content team that runs a tenant's blog. You turn ideas into pitches that serve the tenant's goals for the quarter. You are blunt about weak ideas: an idea with no reason to be written now is rejected and kept for later, and that's a good outcome.
You never write the post. You write briefs a writer can work from.
Use "tenant" for the business you work for. Never invent facts about the tenant: what it knows is in the knowledge base claims you're given.`;

// ---- the workflow ----

async function pitchRun(input: PitchInput): Promise<PitchResult> {
  const { site } = input;
  const max = Math.min(Math.max(input.max ?? 5, 1), MAX_BATCH);
  const now = input.today ? new Date(`${input.today}T12:00:00Z`) : new Date(await DBOS.now());
  const result: PitchResult = { pitched: [], rejected: [], waiting: [], drafting: [] };
  const searches = new SearchSession();

  const pending = await DBOS.runStep(
    async () => (await readIdeas(site, input.ideaIds ?? null, Math.max(MAX_IDEAS, input.ideaIds?.length ?? 0))).filter((i) => i.status === "new"),
    { name: "read ideas" },
  );
  if (pending.length === 0) return result;
  // Outside a batch, only a person's ask is pitched now; other ideas wait for the next batch.
  if (input.batch == null && !input.asked) {
    result.waiting.push(...pending.map((i) => i.id));
    return result;
  }

  const ctx = await DBOS.runStep(
    async () => {
      const [tenant, cols, briefs, published, every, titles, goals] = await Promise.all([
        getSite(site),
        collections(site),
        pipelineBriefs(site),
        publishedPosts(site, 60),
        everyBrief(site),
        publishedPosts(site, 2000),
        input.goals !== undefined ? Promise.resolve(input.goals) : readGoals(site),
      ]);
      return { tenant, cols, briefs, published, every, titles: titles.map((p) => ({ title: p.title, at: p.published_at })), goals };
    },
    { name: "read goals and pipeline" },
  );
  const { goals } = ctx;

  const collectionNames = ctx.cols.filter((c) => !c.is_hidden).map((c) => c.name);
  const posts = counted(ctx.briefs, ctx.published, quarterOf(now).start);

  // What the tenant decided before, and everything it has already been shown.
  const taste = await readTaste(site);
  const seen: Seen[] = [
    ...ctx.every.map((b) => ({
      title: b.title,
      kind: (b.status === "rejected" || b.status === "cancelled" ? "rejected" : b.status === "backlog" ? "not_now" : "pipeline") as Seen["kind"],
      date: b.created.slice(0, 10),
      reason: b.reject_reason,
    })),
    ...ctx.titles.map((p) => ({ title: p.title, kind: "published" as const, date: (p.at ?? "").slice(0, 10), reason: "" })),
  ];
  const close = new Map(pending.map((i) => [i.id, nearest(i.title, seen)]));

  // 1. Judge every idea in one call: topics, timeliness, gaps, overlaps.
  const existing = [
    ...ctx.published.map((p) => `published: ${p.title}`),
    ...ctx.briefs.map((b) => `${b.status}: ${b.title}`),
  ].slice(0, 120);
  const chunks: IdeaRow[][] = [];
  for (let i = 0; i < pending.length; i += JUDGE_CHUNK) chunks.push(pending.slice(i, i + JUDGE_CHUNK));
  const judged: Judged[] = [];
  for (const [n, chunk] of chunks.entries()) {
    const part = await askJson(
      chunks.length === 1 ? "judge ideas" : `judge ideas ${n + 1}`,
      {
        site,
        job: "pitcher:judge",
        model: MODELS.base,
        maxOutputTokens: 6000,
        system: PITCHER_SYSTEM,
        prompt: judgePrompt({ now, tenantName: ctx.tenant?.name, goals, existing, ideas: chunk, close }),
      },
      parseJudgements(chunk.map((i) => i.id)),
    );
    judged.push(...part);
  }

  // 2. No repeats: a near-duplicate of something already shown is dropped,
  // unless something material changed since a rejection.
  const fresh: IdeaRow[] = [];
  for (const idea of pending) {
    const near = close.get(idea.id);
    const j = judged.find((x) => x.idea === idea.id)!;
    const reason = !near
      ? ""
      : near.kind === "published"
        ? `Update suggestion: this is close to "${near.title}", published on ${near.date}. Update that post instead of writing a new one.`
        : near.kind === "pipeline"
          ? `Already in the pipeline as "${near.title}".`
          : j.changed
            ? ""
            : `Already ${seenLine(near)}. Nothing material has changed since.`;
    if (!reason) {
      fresh.push(idea);
      continue;
    }
    await DBOS.runStep(() => settleIdea(site, idea.id, "rejected", reason, null), { name: `reject ${idea.id}` });
    result.rejected.push({ idea: idea.id, reason });
  }

  // 3. Rate in code; the strongest go out in this batch, the rest wait.
  let st = standing(posts, goals?.perWeek ?? 0, now);
  const ordered = fresh
    .map((idea) => ({ idea, j: judged.find((x) => x.idea === idea.id)! }))
    .map((x) => ({ ...x, r: rate(x.j, x.idea.origin, goals, st, st.emptyWeeks[0] ?? null) }));

  for (const { idea, r } of ordered) {
    if (r.pitch) continue;
    const why = r.reasons.find((x) => x.kind === "duplicate")?.text;
    const reason = why ? `No reason yet: ${why}` : "No reason yet: it doesn't move a goal this quarter.";
    await DBOS.runStep(() => settleIdea(site, idea.id, "rejected", reason, null), { name: `reject ${idea.id}` });
    result.rejected.push({ idea: idea.id, reason });
  }

  const candidates = ordered
    .filter((x) => x.r.pitch)
    .sort((a, b) => {
      const s = (x: typeof a) => x.r.reasons.reduce((n, r) => n + (r.kind === "duplicate" ? -1 : r.counts ? 1 : 0), 0);
      const planned = (x: typeof a) => (x.idea.origin === "plan" ? 1 : 0);
      return s(b) - s(a) || planned(b) - planned(a) || (a.idea.expires_at ?? "9").localeCompare(b.idea.expires_at ?? "9");
    });

  const shown: Seen[] = [];

  for (const { idea, j } of candidates) {
    if (result.pitched.length >= max) {
      result.waiting.push(idea.id);
      continue;
    }
    // Re-rate against the pipeline as it stands after this batch's earlier pitches.
    const week = st.emptyWeeks[0] ?? null;
    const r = rate(j, idea.origin, goals, st, week);
    if (!r.pitch) {
      result.waiting.push(idea.id);
      continue;
    }

    // 4. Research: what's already out there, and what the tenant knows.
    const hits: SearchHit[] = [];
    const gapsBefore = searches.gaps.length;
    for (const [n, q] of j.searches.entries()) {
      hits.push(...(await searchDurably(searches, q, 6, { site, job: "pitcher:research" }, `search ${idea.id} ${n + 1}`)));
    }
    const researchGap = searches.notice(searches.gaps.slice(gapsBefore));
    const claims = await DBOS.runStep(() => claimsFor(site, [idea.title, ...j.topics], 8), { name: `knowledge ${idea.id}` });
    const evidenceUrls = (idea.evidence ?? []).filter((e) => e.url).map((e) => ({ url: e.url!, label: e.label }));
    const allowed = new Set([...evidenceUrls.map((e) => e.url), ...hits.map((h) => h.url)]);

    // 5. The brief.
    const written = await askJson(
      `pitch ${idea.id}`,
      {
        site,
        job: "pitcher:pitch",
        model: MODELS.base,
        maxOutputTokens: 3000,
        system: PITCHER_SYSTEM,
        prompt: `Write the pitch for this idea as a full brief.

Idea:
${ideaBlock(idea)}

Why it's worth pitching (already decided, don't argue it):
${r.reasons.filter((x) => x.counts).map((x) => `- ${x.text}`).join("\n")}

What the tenant knows (knowledge base):
${renderClaims(claims)}

What's already ranking for it:
${hits.map((h) => `- ${h.title} <${h.url}>: ${h.snippet}`).join("\n") || "(no search results)"}

Collections on this blog: ${collectionNames.join(", ") || "(none)"}.

What this tenant has decided before (learn from it; their own words win):
${renderTaste(taste)}
${input.topUp ? `\nThis is a top-up: ${input.topUp}\n` : ""}${j.changed ? `\nThis is close to something pitched before (${seenLine(close.get(idea.id)!)}). What changed since: ${j.changed} Make the brief about what changed.\n` : ""}

Answer with JSON only:
{"title": "a specific, slightly provocative title", "why": "one sentence: why this, why now", "angle": "the argument this post makes that the ranking pages don't", "audience": "who it's for and what they need", "length": "e.g. 1,000 to 1,400 words", "collection": "one of the collections", "outline": ["4 to 10 lines, each a section as a claim"], "sources": [{"url": "only URLs from the evidence or the search results above", "label": "what it backs"}], "learned": "one line, addressed to the tenant, naming the decision or note that shaped this pitch, e.g. Written after your note on batch 2: no product pitch in the intro. Empty if none applied."}`,
      },
      parsePitch(allowed, collectionNames),
    );

    // The brief's own title can land on something already shown, or on a pitch from this run.
    const again = j.changed ? null : nearest(written.title, [...seen, ...shown]);
    if (again) {
      const reason = `Came out as "${written.title}", too close to something already ${seenLine(again)}.`;
      await DBOS.runStep(() => settleIdea(site, idea.id, "rejected", reason, null), { name: `reject ${idea.id} as written` });
      result.rejected.push({ idea: idea.id, reason });
      continue;
    }
    shown.push({ title: written.title, kind: "pipeline", date: now.toISOString().slice(0, 10), reason: "" });

    const publishBy = week ? thursdayOf(week) : "";
    const briefId = await DBOS.runStep(() => Promise.resolve(newId()), { name: `mint brief ${idea.id}` });
    await DBOS.runStep(
      () =>
        insertPitch({
          id: briefId,
          site,
          title: written.title,
          body: briefBody(written, r.reasons, j.changed),
          collection_name: written.collection,
          planned_date: publishBy,
          topics: j.topics,
          fit: { why: written.why, grade: r.grade, reasons: r.reasons, goals: r.goals, ...(researchGap ? { research: researchGap } : {}) },
          origin: idea.origin,
          sources: written.sources,
          outline: written.outline.map((text, n) => ({ id: `l${n + 1}`, text })),
          angle: written.angle,
          audience: written.audience,
          length: written.length,
          batch: input.batch ?? null,
          idea: idea.id,
          expires_at: j.timely && j.expiresAt ? j.expiresAt : null,
          learned: written.learned,
          changed: j.changed,
        }),
      { name: `save pitch ${idea.id}` },
    );
    await DBOS.runStep(() => settleIdea(site, idea.id, "pitched", r.reasons.filter((x) => x.counts).map((x) => x.text).join(" "), briefId), {
      name: `settle ${idea.id}`,
    });
    result.pitched.push({ idea: idea.id, brief: briefId, title: written.title, grade: r.grade });

    posts.push({ topics: j.topics, origin: idea.origin, date: publishBy });
    st = standing(posts, goals?.perWeek ?? 0, now);
  }

  // 5. Launch day one: the strongest pitches are drafted before anyone approves them.
  const draftTop = Math.min(input.draftTop ?? 0, result.pitched.length);
  for (const p of result.pitched.slice(0, draftTop)) {
    const handle = await startForTenant(site, writer, { site, briefId: p.brief, beforeApproval: true });
    result.drafting.push(handle.workflowID);
  }
  if (searches.gaps.length) result.skippedSearches = searches.gaps;
  return result;
}

/** The brief as the editor's Brief tab shows it (briefs.body is Markdown). */
export function briefBody(w: Written, reasons: FitReason[], changed = ""): string {
  return [
    w.learned ? `_${w.learned}_` : "",
    `**Why this, why now.** ${w.why}`,
    changed ? `**What changed.** ${changed}` : "",
    `**Angle.** ${w.angle}`,
    `**Audience.** ${w.audience}`,
    `**Length.** ${w.length}`,
    `## Outline\n${w.outline.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
    w.sources.length ? `## Sources\n${w.sources.map((s) => `- [${s.label}](${s.url})`).join("\n")}` : "",
    `## Fit\n${reasons.map((r) => `- ${r.counts ? "" : r.kind === "duplicate" ? "(minus) " : "(noted) "}${r.text}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const pitcher = DBOS.registerWorkflow(pitchRun, { name: "pitcher" });

// ---- a request in Chat: "pitch me three posts on X" ----

/** Chat's hand-off: turns the request into ideas (origin "team"), then pitches them like any others. */
async function pitchFromRequestRun(input: DispatchInput): Promise<PitchResult> {
  const { site } = input;
  const asked = await askJson(
    "ideas from the request",
    {
      site,
      job: "pitcher:request",
      model: MODELS.base,
      maxOutputTokens: 1500,
      system: PITCHER_SYSTEM,
      prompt: `Someone on the tenant's team asked: "${input.task}"

Turn it into post ideas: as many as they asked for (one if they didn't say), at most 5. Each idea is a title and a two-sentence summary of what the post would argue.

Answer with JSON only: {"ideas": [{"title": "...", "summary": "..."}]}`,
    },
    (v) =>
      arr(obj(v, "The answer").ideas, "ideas")
        .slice(0, 5)
        .map((x, i) => {
          const o = obj(x, `ideas[${i}]`);
          return { title: str(o.title, `ideas[${i}].title`, { max: 300 }), summary: str(o.summary, `ideas[${i}].summary`, { optional: true, max: 2000 }) };
        }),
  );
  const ideaIds = await DBOS.runStep(
    async () => {
      const ids: string[] = [];
      for (const [n, i] of asked.entries()) {
        const row = await insertIdea({
          site,
          title: i.title,
          summary: i.summary,
          origin: "team",
          evidence: [{ label: `Asked in Chat${input.requestedBy ? ` by ${input.requestedBy}` : ""}`, quote: input.task.slice(0, 500), detail: input.conversation }],
          source_agent: "chat",
          expires_at: null,
          target_search: "",
        }, `${DBOS.workflowID ?? "req"}:${n}`);
        ids.push(row.id);
      }
      return ids;
    },
    { name: "save the ideas" },
  );
  // A person asked for these: pitch them all now, as bonus posts outside the batches.
  return pitchRun({ site, ideaIds, batch: null, max: ideaIds.length, asked: true });
}

export const pitchFromRequest = DBOS.registerWorkflow(pitchFromRequestRun, { name: "pitcher:request" });

// ---- the batches ----

export interface BatchInput {
  site: string;
  /**
   * schedule: the daily morning run: top-ups for short batches, and the
   * week's batch (once a week at most; flood: whenever approvals are still
   * needed). handoff: the plan just arrived (flood sends it; weekly sends only
   * the quarter's first, double batch). asked: a person wants the next batch now.
   */
  trigger: "schedule" | "handoff" | "asked";
  goals?: Goals | null;
  today?: string;
}

export interface BatchResult {
  /** The batch released by this run, if any. */
  released: number | null;
  toppedUp: number[];
  closed: number[];
  cancelled: number[];
  pitched: PitchResult["pitched"];
  rejected: PitchResult["rejected"];
}

/** Ideas judged for `n` pitches: some margin for the ones that get rejected. */
const poolFor = (n: number) => Math.max(Math.ceil(n * 1.5), 15);

async function batchRun(input: BatchInput): Promise<BatchResult> {
  const { site } = input;
  const now = input.today ? new Date(`${input.today}T12:00:00Z`) : new Date(await DBOS.now());
  const today = now.toISOString().slice(0, 10);
  const quarter = quarterOf(now);
  const out: BatchResult = { released: null, toppedUp: [], closed: [], cancelled: [], pitched: [], rejected: [] };

  const s = await DBOS.runStep(
    async () => {
      const [cadence, batches, briefs, decided, pool, goals] = await Promise.all([
        batchCadence(site),
        quarterBatches(site, quarter.label),
        quarterBriefs(site, quarter.start.toISOString()),
        decidedPitches(site),
        poolIdeas(site, 1000),
        input.goals !== undefined ? Promise.resolve(input.goals) : readGoals(site),
      ]);
      return { cadence, batches, briefs, decided, pool, goals };
    },
    { name: "read the quarter" },
  );
  const approvedIn = (n: number | null) => s.briefs.filter((b) => (n === null || b.batch === n) && APPROVED.includes(b.status)).length;
  const batches: BatchCount[] = s.batches.map((b) => ({
    ...b,
    approved: approvedIn(b.number),
    undecided: s.briefs.filter((x) => x.batch === b.number && x.status === "pitched").length,
  }));
  const view = (): QuarterView => ({
    target: s.goals?.volume.total ?? null,
    approved: approvedIn(null),
    batches,
    planWaiting: s.pool.filter((i) => i.origin === "plan").length,
    cadence: s.cadence,
    quarterStart: quarter.start,
    now,
  });
  const rate = approvalRate(s.decided);
  let pool = s.pool.map((i) => i.id);
  const save = (b: BatchCount, why: string) =>
    DBOS.runStep(() => saveBatch({ site, quarter: quarter.label, number: b.number, quota: b.quota, state: b.state, released_at: b.released_at, topups: b.topups }), {
      name: `batch ${b.number} ${why}`,
    });
  const pitchInto = async (b: BatchCount, n: number, topUp?: string) => {
    const r = await pitchRun({
      site,
      ideaIds: pool.slice(0, poolFor(n)),
      batch: b.number,
      max: n,
      ...(topUp ? { topUp } : {}),
      ...(input.goals !== undefined ? { goals: input.goals } : {}),
      ...(input.today ? { today: input.today } : {}),
    });
    const used = new Set([...r.pitched.map((p) => p.idea), ...r.rejected.map((x) => x.idea)]);
    pool = pool.filter((id) => !used.has(id));
    out.pitched.push(...r.pitched);
    out.rejected.push(...r.rejected);
    b.undecided += r.pitched.length;
  };

  // 1. Batches that reached their quota close; once the quarter's target is
  //    met, the rest are cancelled and nothing more is pitched.
  for (const b of batches.filter(isOpen)) {
    if (b.approved >= b.quota) {
      b.state = "closed";
      await save(b, "closed");
      out.closed.push(b.number);
    }
  }
  if (targetMet(view())) {
    for (const b of batches.filter(isOpen)) {
      b.state = "cancelled";
      await save(b, "cancelled");
      out.cancelled.push(b.number);
    }
    return out;
  }

  // 2. Top-ups: a batch released before today, every pitch decided, still short.
  if (input.trigger !== "handoff") {
    for (const b of batches.filter(isOpen)) {
      const short = b.quota - b.approved;
      if (short <= 0 || b.undecided > 0 || !b.released_at || b.released_at.slice(0, 10) >= today || pool.length === 0) continue;
      const rejected = s.briefs.filter((x) => x.batch === b.number && x.status === "rejected").length;
      b.state = "topping_up";
      b.topups += 1;
      await save(b, `top-up ${b.topups}`);
      await pitchInto(
        b,
        pitchesFor(short, 0, rate),
        `batch ${b.number} needs ${short} more approved (${b.approved} of ${b.quota}). ${rejected} of its pitches were rejected; their reasons are in the decisions above. Pitch what those reasons say they want instead.`,
      );
      out.toppedUp.push(b.number);
    }
  }

  // 3. The next batch.
  const released = batches.filter((b) => b.released_at);
  const thisWeek = released.some((b) => isoWeek(new Date(b.released_at!)) === isoWeek(now));
  const release =
    input.trigger === "asked" ||
    (s.cadence === "flood" && !batches.some(isOpen)) ||
    (s.cadence === "weekly" && input.trigger === "schedule" && !thisWeek) ||
    (s.cadence === "weekly" && input.trigger === "handoff" && released.length === 0);
  const quota = release && pool.length ? nextQuota(view()) : 0;
  if (quota > 0) {
    const b: BatchCount = {
      site,
      quarter: quarter.label,
      // After every batch number used this quarter, rows or not (a launch run numbers its own).
      number: Math.max(...batches.map((x) => x.number), ...s.briefs.map((x) => x.batch ?? 0), 0) + 1,
      quota,
      state: "in_review",
      released_at: now.toISOString(),
      topups: 0,
      approved: 0,
      undecided: 0,
    };
    batches.push(b);
    await save(b, "released");
    await pitchInto(b, Math.min(pitchesFor(quota, 0, rate), MAX_BATCH));
    out.released = b.number;
  }
  return out;
}

export const pitchBatch = DBOS.registerWorkflow(batchRun, { name: "pitcher:batch" });

async function batchFromRequestRun(input: DispatchInput) {
  return batchRun({ site: input.site, trigger: "asked" });
}
const batchFromRequest = DBOS.registerWorkflow(batchFromRequestRun, { name: "pitcher:batch-request" });

/** Chat's "send me the next batch" (or "another batch"). */
export const NEXT_BATCH = /\b(next|another|new)\s+batch\b/i;

registerAgent("pitcher", (input) =>
  NEXT_BATCH.test(input.task) ? startForDispatch("pitcher", batchFromRequest, input) : startForDispatch("pitcher", pitchFromRequest, input),
);

/** Every morning: each tenant with ideas waiting or a batch open gets its batch run. */
async function dailyBatchesRun(scheduled: Date): Promise<void> {
  const day = scheduled.toISOString().slice(0, 10);
  const sites = await DBOS.runStep(() => sitesWithBatchWork(), { name: "tenants" });
  for (const site of sites) {
    await DBOS.startWorkflow(pitchBatch, {
      workflowID: `pitcher-batch-${site}-${day}`,
      queueName: AGENT_QUEUE,
      workflowAttributes: { site },
    })({ site, trigger: "schedule" });
    // The Writer's side of the morning: voice-guide changes from reviewers' edits.
    await DBOS.startWorkflow(voiceSuggest, {
      workflowID: `writer-voice-suggest-${site}-${day}`,
      queueName: AGENT_QUEUE,
      workflowAttributes: { site },
    })({ site });
  }
}

export const dailyBatches = DBOS.registerWorkflow(dailyBatchesRun, { name: "pitcher:daily-batches" });

/**
 * Every day 10:00 UTC: after DeepSeek's weekday peak on the AI Gateway (2x
 * price 01:00-04:00 and 06:00-10:00 UTC), and still morning in Europe.
 */
export const BATCH_CRON = process.env.PITCHER_BATCH_CRON ?? "0 10 * * *";

/** Called once after launch: the morning schedule, kept in DBOS's own tables. */
export async function schedulePitcher(): Promise<void> {
  await DBOS.applySchedules([{ scheduleName: "pitcher-daily-batches", workflowFn: dailyBatches, schedule: BATCH_CRON, cronTimezone: "UTC" }]);
}
