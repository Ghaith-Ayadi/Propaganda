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
  reviewerFeedback,
  settleIdea,
  batchCadence,
  batchedBriefs,
  planIdeas,
  sitesWithPlanIdeas,
  type BriefRow,
  type IdeaRow,
} from "./store.js";
import { rate, type FitReason, type Judgement } from "./fit.js";
import { batchSize } from "./batches.js";
import { isoWeek, quarterOf, readGoals, standing, type CountedPost, type Goals } from "./goals.js";
import { claimsFor, renderClaims } from "./kb.js";
import { MODELS, arr, askJson, obj, str, strs } from "./model.js";
import { newId } from "./ids.js";
import { searchWeb, type SearchHit } from "./web.js";
import { AGENT_QUEUE, registerAgent, startForDispatch, startForTenant, type DispatchInput } from "../workflows/agents.js";
import { writer } from "./writer.js";

export interface PitchInput {
  site: string;
  /** These ideas; otherwise every idea still "new", oldest first. */
  ideaIds?: string[];
  /** Content batch these pitches belong to (null or absent: bonus posts outside the plan). */
  batch?: number | null;
  /** Most pitches in this run: a batch is 3 to 5 (launch day one: up to 8). */
  max?: number;
  /** Launch day one: draft the N strongest pitches right away (3). */
  draftTop?: number;
  /** The quarter's goals, until the Goals tables exist (goals.ts). */
  goals?: Goals | null;
  /** "Today", for tests and replays of a plan: YYYY-MM-DD. */
  today?: string;
  /** A person asked for these (Chat): pitch them all, past the bonus cap. */
  asked?: boolean;
}

export interface PitchResult {
  pitched: { idea: string; brief: string; title: string; grade: string }[];
  rejected: { idea: string; reason: string }[];
  waiting: string[];
  drafting: string[];
}

const MAX_IDEAS = 40;
/** The most pitches one run sends (a flood of a big plan). */
const MAX_BATCH = 500;
/** Ideas judged per model call. */
const JUDGE_CHUNK = 25;
/** Bonus pitches (no batch) open in the inbox at once; the rest wait as ideas for a later run. */
export const BONUS_OPEN = 3;

// ---- the model's two jobs ----

interface Judged extends Judgement {
  idea: string;
  searches: string[];
}

function parseJudgements(ids: string[]) {
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
      };
    });
    const missing = ids.filter((id) => !out.some((j) => j.idea === id));
    if (missing.length) throw new Error(`No judgement for ideas ${missing.join(", ")}.`);
    return out;
  };
}

interface Written {
  title: string;
  why: string;
  angle: string;
  audience: string;
  length: string;
  collection: string;
  outline: string[];
  sources: { url: string; label: string }[];
}

function parsePitch(allowedUrls: Set<string>, collectionNames: string[]) {
  return (v: unknown): Written => {
    const o = obj(v, "The answer");
    const outline = strs(o.outline, "outline");
    if (outline.length < 4 || outline.length > 10) throw new Error("outline must have 4 to 10 lines.");
    const sources = arr(o.sources, "sources", { optional: true }).map((x, i) => {
      const s = obj(x, `sources[${i}]`);
      const url = str(s.url, `sources[${i}].url`);
      if (!allowedUrls.has(url)) throw new Error(`sources[${i}].url is not one of the URLs you were given: ${url}`);
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
function thursdayOf(week: string): string {
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

const PITCHER_SYSTEM = `You are the Pitcher for Propaganda, a content team that runs a tenant's blog. You turn ideas into pitches that serve the tenant's goals for the quarter. You are blunt about weak ideas: an idea with no reason to be written now is rejected and kept for later, and that's a good outcome.
You never write the post. You write briefs a writer can work from.
Use "tenant" for the business you work for. Never invent facts about the tenant: what it knows is in the knowledge base claims you're given.`;

// ---- the workflow ----

async function pitchRun(input: PitchInput): Promise<PitchResult> {
  const { site } = input;
  const max = Math.min(Math.max(input.max ?? 5, 1), MAX_BATCH);
  const now = input.today ? new Date(`${input.today}T12:00:00Z`) : new Date(await DBOS.now());
  const result: PitchResult = { pitched: [], rejected: [], waiting: [], drafting: [] };

  const pending = await DBOS.runStep(
    async () => (await readIdeas(site, input.ideaIds ?? null, Math.max(MAX_IDEAS, input.ideaIds?.length ?? 0))).filter((i) => i.status === "new"),
    { name: "read ideas" },
  );
  if (pending.length === 0) return result;

  const ctx = await DBOS.runStep(
    async () => {
      const [tenant, cols, briefs, published, feedback, goals] = await Promise.all([
        getSite(site),
        collections(site),
        pipelineBriefs(site),
        publishedPosts(site, 60),
        reviewerFeedback(site),
        input.goals !== undefined ? Promise.resolve(input.goals) : readGoals(site),
      ]);
      return { tenant, cols, briefs, published, feedback, goals };
    },
    { name: "read goals and pipeline" },
  );
  const { goals } = ctx;

  // Bonus pitches from the Scout and the Listener: at most BONUS_OPEN undecided
  // in the inbox at once. Batches and a person's own ask aren't capped.
  let cap = max;
  if (input.batch == null && !input.asked) {
    const open = ctx.briefs.filter((b) => b.status === "pitched" && b.pitched_by === "agent:pitcher" && b.batch == null).length;
    cap = Math.min(max, Math.max(BONUS_OPEN - open, 0));
    if (cap === 0) {
      result.waiting.push(...pending.map((i) => i.id));
      return result;
    }
  }
  const collectionNames = ctx.cols.filter((c) => !c.is_hidden).map((c) => c.name);
  const posts = counted(ctx.briefs, ctx.published, quarterOf(now).start);

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
        prompt: `Today is ${now.toISOString().slice(0, 10)}. Judge each idea below for ${ctx.tenant?.name ?? "the tenant"}.

${goalsBlock(goals)}

Already published or in the pipeline:
${existing.join("\n") || "(nothing yet)"}

Ideas:
${chunk.map(ideaBlock).join("\n\n")}

For each idea, answer:
- topics: the one or two goal topics it belongs to (exact names from the goals; empty if none fit).
- targetSearch: the exact target search it would rank for, or "".
- timely: true only if it's tied to news, a date or a change that makes it worth less later; expiresAt: YYYY-MM-DD when it stops being worth it.
- answersGap: one sentence when it answers a question customers keep asking, an objection, or a claim the tenant makes without backing (say which); else "".
- demand: one sentence with the search-demand evidence in the idea (numbers only if the evidence has them); else "".
- duplicateOf: the title of a published or pipeline post it mostly repeats; else "".
- replacesFlagged: the title of a flagged post it would replace; else "".
- searches: one or two web searches that would find good sources for it.

Answer with JSON only: {"ideas": [{"id": "...", "topics": [], "targetSearch": "", "timely": false, "expiresAt": "", "answersGap": "", "demand": "", "duplicateOf": "", "replacesFlagged": "", "searches": []}]}`,
      },
      parseJudgements(chunk.map((i) => i.id)),
    );
    judged.push(...part);
  }

  // 2. Rate in code; the strongest go out in this batch, the rest wait.
  let st = standing(posts, goals?.perWeek ?? 0, now);
  const ordered = pending
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
      return s(b) - s(a) || (a.idea.expires_at ?? "9").localeCompare(b.idea.expires_at ?? "9");
    });

  const feedback = ctx.feedback
    .map((f) =>
      f.status === "rejected"
        ? `- Rejected "${f.title}": ${f.reject_reason || "no reason given"}`
        : `- Approved "${f.title}" with notes: ${(f.notes ?? []).map((n) => n.text).join("; ")}`,
    )
    .join("\n");

  for (const { idea, j } of candidates) {
    if (result.pitched.length >= cap) {
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

    // 3. Research: what's already out there, and what the tenant knows.
    const hits: SearchHit[] = [];
    for (const [n, q] of j.searches.entries()) {
      hits.push(...(await DBOS.runStep(() => searchWeb(q, 6, { site, job: "pitcher:research" }), { name: `search ${idea.id} ${n + 1}` })));
    }
    const claims = await DBOS.runStep(() => claimsFor(site, [idea.title, ...j.topics], 8), { name: `knowledge ${idea.id}` });
    const evidenceUrls = (idea.evidence ?? []).filter((e) => e.url).map((e) => ({ url: e.url!, label: e.label }));
    const allowed = new Set([...evidenceUrls.map((e) => e.url), ...hits.map((h) => h.url)]);

    // 4. The brief.
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

What reviewers said about recent pitches (learn from it):
${feedback || "(nothing yet)"}

Answer with JSON only:
{"title": "a specific, slightly provocative title", "why": "one sentence: why this, why now", "angle": "the argument this post makes that the ranking pages don't", "audience": "who it's for and what they need", "length": "e.g. 1,000 to 1,400 words", "collection": "one of the collections", "outline": ["4 to 10 lines, each a section as a claim"], "sources": [{"url": "only URLs from the evidence or the search results above", "label": "what it backs"}]}`,
      },
      parsePitch(allowed, collectionNames),
    );

    const publishBy = week ? thursdayOf(week) : "";
    const briefId = await DBOS.runStep(() => Promise.resolve(newId()), { name: `mint brief ${idea.id}` });
    await DBOS.runStep(
      () =>
        insertPitch({
          id: briefId,
          site,
          title: written.title,
          body: briefBody(written, r.reasons),
          collection_name: written.collection,
          planned_date: publishBy,
          topics: j.topics,
          fit: { why: written.why, grade: r.grade, reasons: r.reasons, goals: r.goals },
          origin: idea.origin,
          sources: written.sources,
          outline: written.outline.map((text, n) => ({ id: `l${n + 1}`, text })),
          angle: written.angle,
          audience: written.audience,
          length: written.length,
          batch: input.batch ?? null,
          idea: idea.id,
          expires_at: j.timely && j.expiresAt ? j.expiresAt : null,
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
  return result;
}

/** The brief as the editor's Brief tab shows it (briefs.body is Markdown). */
export function briefBody(w: Written, reasons: FitReason[]): string {
  return [
    `**Why this, why now.** ${w.why}`,
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

// ---- the plan's batches ----

export interface BatchInput {
  site: string;
  /**
   * schedule: the weekly run (once a week at most). handoff: the plan just
   * arrived (flood sends it all; weekly sends only the quarter's first, double
   * batch). asked: a person wants the next batch now.
   */
  trigger: "schedule" | "handoff" | "asked";
  goals?: Goals | null;
  today?: string;
}

/** Send the plan's next batch, sized by the tenant's cadence (batches.ts). */
async function batchRun(input: BatchInput): Promise<PitchResult & { batch: number | null }> {
  const { site } = input;
  const now = input.today ? new Date(`${input.today}T12:00:00Z`) : new Date(await DBOS.now());
  const { start } = quarterOf(now);
  const state = await DBOS.runStep(
    async () => {
      const [cadence, waiting, sent] = await Promise.all([batchCadence(site), planIdeas(site, 10_000), batchedBriefs(site, start.toISOString())]);
      return { cadence, waiting: waiting.map((i) => i.id), sent };
    },
    { name: "read the plan" },
  );
  const none = { pitched: [], rejected: [], waiting: state.waiting, drafting: [], batch: null };
  const released = state.sent.reduce((n, b) => Math.max(n, b.batch), 0);
  if (input.trigger === "handoff" && state.cadence === "weekly" && released > 0) return none; // the weekly run sends it
  if (input.trigger === "schedule" && state.sent.some((b) => isoWeek(new Date(b.created)) === isoWeek(now))) return none; // already sent this week
  const size = batchSize({ remaining: state.waiting.length, released, cadence: state.cadence, quarterStart: start, now });
  if (size === 0) return none;
  const batch = released + 1;
  const out = await pitchRun({
    site,
    ideaIds: state.waiting.slice(0, size),
    batch,
    max: size,
    ...(input.goals !== undefined ? { goals: input.goals } : {}),
    ...(input.today ? { today: input.today } : {}),
  });
  return { ...out, waiting: [...out.waiting, ...state.waiting.slice(size)], batch };
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

/** Every Monday: each tenant with planned ideas waiting gets its weekly batch. */
async function weeklyBatchesRun(scheduled: Date): Promise<void> {
  const week = isoWeek(scheduled);
  const sites = await DBOS.runStep(() => sitesWithPlanIdeas(), { name: "tenants" });
  for (const site of sites) {
    await DBOS.startWorkflow(pitchBatch, {
      workflowID: `pitcher-batch-${site}-${week}`,
      queueName: AGENT_QUEUE,
      workflowAttributes: { site },
    })({ site, trigger: "schedule" });
  }
}

export const weeklyBatches = DBOS.registerWorkflow(weeklyBatchesRun, { name: "pitcher:weekly-batches" });

export const BATCH_CRON = process.env.PITCHER_BATCH_CRON ?? "0 7 * * 1";

/** Called once after launch: the weekly schedule, kept in DBOS's own tables. */
export async function schedulePitcher(): Promise<void> {
  await DBOS.applySchedules([{ scheduleName: "pitcher-weekly-batches", workflowFn: weeklyBatches, schedule: BATCH_CRON, cronTimezone: "UTC" }]);
}
