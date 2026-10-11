// Day one (onboarding/first-day-flow.md, "Decided by Ayadi" and stage 3b),
// the worker's side:
//
//   strategist:first-pitches  (first-pitches-<proposal>)  started by the
//       Strategist right after it sends an onboarding proposal or one of its
//       revisions: 10 pitches over the plan's topics (splitPitches), one
//       child per topic, run at once. A revision re-pitches only the topics
//       that changed; pitches on kept topics stay, with any decision on them,
//       and undecided ones on topics that left the plan are withdrawn.
//   strategist:topic-pitches  (first-pitches-<proposal>-t<i>)  one topic: one
//       search per pitch, one Fable call (MODELS.strategist) for all of the
//       topic's pitches in the Pitcher's brief format, rated by fit.ts.
//   strategist:first-drafts   (first-drafts-<proposal>)  the plan approved:
//       the Writer drafts the 3 strongest pitches before anyone approves them.
//   strategist:replace        (replace-<brief>)  a day-one pitch rejected with
//       a reason: one replacement for the same topic, written after that
//       reason. Replacements are never replaced.
//
// The pitches are briefs like the Pitcher's (status pitched, batch 1,
// pitched_by agent:strategist), each with its agent_ideas row (origin plan,
// source_agent strategist). Batch 1's content_batches row is released with
// them, so the Pitcher's morning run neither releases another batch 1 nor
// tops it up the same day, and numbers its own from 2.
//
// The approvals and rejections are found by a poll (dispatchFirstDay) every
// WORKER_FIRST_DAY_SECONDS (15); each run's id comes from its work, so
// however many ticks see it, it runs once.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { AGENT_QUEUE, startForTenant, startOnceForTenant } from "./agents.js";
import { MODELS, askJson } from "../agents/model.js";
import { SearchSession, searchDurably } from "../agents/search.js";
import type { SearchHit } from "../agents/web.js";
import { claimsFor, renderClaims } from "../agents/kb.js";
import { readTaste, renderTaste } from "../agents/taste.js";
import { rate } from "../agents/fit.js";
import { quarterOf, standing, type CountedPost, type Goals } from "../agents/goals.js";
import { APPROVED } from "../agents/batches.js";
import { briefBody, thursdayOf } from "../agents/pitcher.js";
import { writer } from "../agents/writer.js";
import { stableId } from "../agents/ids.js";
import {
  collections,
  everyBrief,
  getSite,
  insertIdea,
  insertPitch,
  pipelineBriefs,
  publishedPosts,
  quarterBatches,
  saveBatch,
  settleIdea,
} from "../agents/store.js";
import { getProposal, profile, settings, type ProposalRow } from "../agents/strategy-store.js";
import {
  approvedProposals,
  currentPlan,
  recentlyApproved,
  recentlyRejected,
  shownProposals,
  strategistBrief,
  strategistBriefs,
  withdrawPitches,
} from "../agents/first-day-store.js";
import {
  DRAFT_TOP,
  FIRST_BATCH,
  FIRST_PITCH_SYSTEM,
  dayOneQuota,
  firstPitchKey,
  goalsFromProposal,
  isLite,
  parseTopicPitches,
  replacementKey,
  replacementLearned,
  sameTopic,
  searchesFor,
  splitPitches,
  strongest,
  topicChanges,
  topicPitchPrompt,
} from "../agents/first-day.js";
import type { LaunchPlan, ProposedSearch, ProposedTopic, StoredProposal } from "../agents/strategy.js";

const JOB = "strategist:pitch";
export const TOPIC_LEFT = "Topic left the plan";

export const firstPitchesId = (proposalId: string) => `first-pitches-${proposalId}`;
export const topicPitchesId = (proposalId: string, topicIndex: number) => `first-pitches-${proposalId}-t${topicIndex}`;
export const firstDraftsId = (proposalId: string) => `first-drafts-${proposalId}`;
export const replaceId = (briefId: string) => `replace-${briefId}`;

/** Workflow events the progress route reads. */
export const PLAN_EVENT = "plan";
export const DRAFTS_EVENT = "drafts";

// ---- is this day one? ----

/**
 * Day one: an onboarding proposal with a Launch (a tenant with no history),
 * or a revision of one, before the tenant ever approved a plan. Lite tenants
 * never get here.
 */
async function dayOneOf(row: ProposalRow): Promise<{ ok: boolean; why: string; launch: LaunchPlan | null }> {
  if (isLite(row.site)) return { ok: false, why: "Lite tenant: no AI", launch: null };
  if (!row.proposal) return { ok: false, why: "no proposal", launch: null };
  if (row.kind !== "onboarding" && row.kind !== "revision") return { ok: false, why: `a ${row.kind} proposal`, launch: null };
  const [shown, approved] = await Promise.all([shownProposals(row.site, row.quarter), approvedProposals(row.site)]);
  if (approved.some((a) => a.id !== row.id && String(a.approved_at ?? "") < row.created)) {
    return { ok: false, why: "a plan was approved before: the Pitcher pitches from here", launch: null };
  }
  const launch = row.proposal.launch ?? shown.find((p) => p.kind === "onboarding" && p.proposal?.launch)?.proposal?.launch ?? null;
  if (!launch) return { ok: false, why: "no Launch: not a new tenant", launch: null };
  return { ok: true, why: "", launch };
}

// ---- what every pitch call reads ----

export interface DayOneContext {
  tenantName: string;
  website: string;
  offer: string;
  plan: { summary: string; topics: ProposedTopic[]; searches: ProposedSearch[] };
  goals: Goals;
  collections: string[];
  taste: string;
  existing: string[];
  counted: CountedPost[];
}

async function readContext(site: string, p: StoredProposal): Promise<DayOneContext> {
  const ctx = await DBOS.runStep(
    async () => {
      const [tenant, cols, pipeline, every, published, prof, set] = await Promise.all([
        getSite(site),
        collections(site),
        pipelineBriefs(site),
        everyBrief(site),
        publishedPosts(site, 200),
        profile(site),
        settings(site, ["tenant.website", "strategist.reviewPerMonth"]),
      ]);
      const perMonth = parseInt(String(set["strategist.reviewPerMonth"] ?? ""), 10) || 8;
      return {
        tenantName: tenant?.name ?? "the tenant",
        website: String(set["tenant.website"] ?? ""),
        offer: String(prof?.answers?.offer ?? "").slice(0, 2000),
        perWeek: Math.max(1, Math.round(perMonth / 4.33)),
        collections: cols.filter((c) => !c.is_hidden).map((c) => c.name),
        existing: [...published.map((x) => x.title), ...every.filter((b) => b.status !== "cancelled").map((b) => b.title)],
        counted: pipeline.map((b) => ({ topics: b.topics ?? [], origin: b.origin, date: b.planned_date })),
      };
    },
    { name: "read the tenant" },
  );
  const taste = renderTaste(await readTaste(site));
  return {
    tenantName: ctx.tenantName,
    website: ctx.website,
    offer: ctx.offer,
    plan: { summary: p.summary, topics: p.topics, searches: p.ranking?.searches ?? [] },
    goals: goalsFromProposal(p, ctx.perWeek),
    collections: ctx.collections,
    taste,
    existing: ctx.existing,
    counted: ctx.counted,
  };
}

/** The topic is in the plan the tenant has now (its newest sent or approved proposal). */
async function stillPlanned(site: string, quarter: string, topic: string): Promise<boolean> {
  const plan = await currentPlan(site, quarter);
  return Boolean(plan?.proposal?.topics?.some((t) => sameTopic(t.name, topic)));
}

// ---- one topic's pitches ----

export interface TopicInput {
  site: string;
  proposalId: string;
  quarter: string;
  topicIndex: number;
  n: number;
  context: DayOneContext;
  /** A replacement for a rejected pitch (strategist:replace). */
  replacing?: { briefId: string; title: string; angle: string; reason: string } | null;
}

export interface TopicResult {
  topic: string;
  written: number;
  briefs: string[];
  skipped?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function topicPitchesRun(input: TopicInput): Promise<TopicResult> {
  const { site, context: c, replacing } = input;
  const topic = c.plan.topics[input.topicIndex];
  if (!topic) return { topic: "", written: 0, briefs: [], skipped: "no such topic" };
  if (!(await DBOS.runStep(() => stillPlanned(site, input.quarter, topic.name), { name: "still in the plan" }))) {
    return { topic: topic.name, written: 0, briefs: [], skipped: TOPIC_LEFT };
  }
  const n = replacing ? 1 : Math.max(1, input.n);
  const targets = c.plan.searches.filter((s) => sameTopic(s.topic, topic.name));

  // One search per pitch, on the plan's searches for this topic.
  const session = new SearchSession();
  const hits: SearchHit[] = [];
  for (const [i, q] of searchesFor(topic.name, targets.map((t) => t.query), n).entries()) {
    // A search the service refused (not an outage: those wait in searchDurably)
    // costs this pitch its sources, not the topic its pitches.
    let found: SearchHit[] = [];
    try {
      found = await searchDurably(session, q, 5, { site, job: JOB }, `search ${i + 1}`);
    } catch (err) {
      DBOS.logger.warn(`first pitches, ${topic.name}: search "${q}" refused: ${(err as Error).message}`);
    }
    for (const h of found) {
      if (!hits.some((x) => x.url === h.url)) hits.push(h);
    }
  }
  const claims = await DBOS.runStep(() => claimsFor(site, [topic.name], 8), { name: "knowledge" });

  const pitches = await askJson(
    replacing ? "write the replacement" : "write the pitches",
    {
      site,
      job: JOB,
      model: MODELS.strategist,
      maxOutputTokens: 1_500 * n + 500,
      system: FIRST_PITCH_SYSTEM,
      prompt: topicPitchPrompt({
        tenantName: c.tenantName,
        website: c.website,
        offer: c.offer,
        summary: c.plan.summary,
        topic,
        otherTopics: c.plan.topics.filter((t) => !sameTopic(t.name, topic.name)).map((t) => t.name),
        targets,
        n,
        hits,
        claims: renderClaims(claims),
        collections: c.collections,
        taste: c.taste,
        existing: c.existing,
        replacing: replacing ?? null,
      }),
    },
    parseTopicPitches(new Set(hits.map((h) => h.url)), c.collections, n, targets.map((t) => t.query)),
  );

  const now = new Date(await DBOS.now());
  const posts = [...c.counted];
  const researchGap = session.notice();
  const out: TopicResult = { topic: topic.name, written: 0, briefs: [] };
  for (const [i, p] of pitches.entries()) {
    const j = { ...p.judgement, topics: [topic.name] };
    const st = standing(posts, c.goals.perWeek, now);
    const week = st.emptyWeeks[0] ?? null;
    const r = rate(j, "plan", c.goals, st, week);
    const key = replacing ? replacementKey(replacing.briefId) : firstPitchKey(input.proposalId, input.topicIndex, i + 1);
    const briefId = stableId(`brief:${key}`);
    const written = replacing ? { ...p.written, learned: replacementLearned(replacing.reason) } : p.written;
    const expires = j.timely && DAY.test(j.expiresAt) ? j.expiresAt : null;
    const publishBy = week ? thursdayOf(week) : "";
    const saved = await DBOS.runStep(
      async () => {
        // A revision can drop the topic while this was being written.
        const planned = await stillPlanned(site, input.quarter, topic.name);
        const idea = await insertIdea(
          {
            site,
            title: written.title,
            summary: written.why,
            origin: "plan",
            evidence: [
              replacing
                ? { label: "Replacement for a rejected pitch", quote: replacing.reason.slice(0, 500), detail: `replaces ${replacing.briefId}; topic: ${topic.name}` }
                : { label: `The Strategist's plan (proposal ${input.proposalId})`, detail: `topic: ${topic.name}` },
            ],
            source_agent: "strategist",
            expires_at: expires,
            target_search: j.targetSearch,
          },
          key,
        );
        await insertPitch(
          {
            id: briefId,
            site,
            title: written.title,
            body: briefBody(written, r.reasons),
            collection_name: written.collection,
            planned_date: publishBy,
            topics: [topic.name],
            fit: {
              why: written.why,
              grade: r.grade,
              reasons: r.reasons,
              goals: r.goals,
              ...(researchGap ? { research: researchGap } : {}),
              ...(replacing ? { replaces: replacing.briefId } : {}),
            },
            origin: "plan",
            sources: written.sources,
            outline: written.outline.map((text, n) => ({ id: `l${n + 1}`, text })),
            angle: written.angle,
            audience: written.audience,
            length: written.length,
            batch: FIRST_BATCH,
            idea: idea.id,
            expires_at: expires,
            learned: written.learned,
            changed: "",
            ...(planned ? {} : { reject_reason: TOPIC_LEFT }),
          } as Parameters<typeof insertPitch>[0],
          "agent:strategist",
          planned ? "pitched" : "cancelled",
        );
        await settleIdea(site, idea.id, "pitched", r.reasons.filter((x) => x.counts).map((x) => x.text).join(" ") || "Day one: the Strategist's plan.", briefId);
        return planned;
      },
      { name: `save pitch ${i + 1}` },
    );
    if (!saved) continue;
    out.written++;
    out.briefs.push(briefId);
    posts.push({ topics: [topic.name], origin: "plan", date: publishBy });
  }
  return out;
}

export const topicPitches = DBOS.registerWorkflow(topicPitchesRun, { name: "strategist:topic-pitches" });

// ---- the first pitches ----

export interface FirstPitchesResult {
  topics: string[];
  written: number;
  kept: string[];
  withdrawn: number;
  skipped?: string;
}

async function firstPitchesRun(proposalId: string): Promise<FirstPitchesResult> {
  const none = (skipped: string): FirstPitchesResult => ({ topics: [], written: 0, kept: [], withdrawn: 0, skipped });
  const row = await DBOS.runStep(() => getProposal(proposalId), { name: "read the plan" });
  if (!row?.proposal || !["sent", "approved"].includes(row.status)) return none(`the proposal is ${row?.status ?? "missing"}`);
  const day = await DBOS.runStep(() => dayOneOf(row), { name: "day one?" });
  if (!day.ok) return none(day.why);
  const { site } = row;
  const p = row.proposal;

  // What earlier rounds pitched: the previous round's topics (when its pitches
  // were started), and the topics of the day-one pitches that exist.
  const earlier = await DBOS.runStep(
    async () => {
      const shown = await shownProposals(site, row.quarter);
      const prev = shown.filter((x) => x.id !== row.id && x.created < row.created && x.proposal).at(-1) ?? null;
      const prevStarted = prev ? Boolean(await DBOS.getWorkflowStatus(firstPitchesId(prev.id))) : false;
      const briefs = await strategistBriefs(site);
      return { prevTopics: prevStarted ? (prev!.proposal!.topics ?? []).map((t) => t.name) : [], briefs };
    },
    { name: "earlier rounds" },
  );
  const before = [
    ...earlier.prevTopics,
    ...earlier.briefs.filter((b) => b.status !== "cancelled").map((b) => b.topics?.[0] ?? "").filter(Boolean),
  ];
  const after = p.topics.map((t) => t.name);
  const changes = topicChanges(before, after);

  // Undecided pitches on topics that left the plan are withdrawn.
  const drop = earlier.briefs.filter((b) => b.status === "pitched" && !after.some((t) => sameTopic(t, b.topics?.[0] ?? ""))).map((b) => b.id);
  const withdrawn = drop.length ? await DBOS.runStep(() => withdrawPitches(site, drop, TOPIC_LEFT), { name: "withdraw dropped topics" }) : 0;

  // Batch 1, released now, sized to day one's approvals.
  const now = new Date(await DBOS.now());
  await DBOS.runStep(
    async () => {
      const quarter = quarterOf(now).label;
      const batches = await quarterBatches(site, quarter);
      if (batches.some((b) => b.number === FIRST_BATCH)) return;
      await saveBatch({ site, quarter, number: FIRST_BATCH, quota: dayOneQuota(day.launch), state: "in_review", released_at: now.toISOString(), topups: 0 });
    },
    { name: "batch 1" },
  );

  // 10 over the plan's topics; only new (or renamed) topics are pitched now.
  const split = splitPitches(p.topics.map((t) => t.low));
  const toPitch = p.topics
    .map((t, i) => ({ i, name: t.name, n: split[i] ?? 0 }))
    .filter((t) => t.n > 0 && changes.added.some((a) => sameTopic(a, t.name)));
  const result: FirstPitchesResult = { topics: toPitch.map((t) => t.name), written: 0, kept: changes.kept, withdrawn };
  await DBOS.setEvent(PLAN_EVENT, { topics: toPitch.map((t) => t.name), children: toPitch.map((t) => topicPitchesId(proposalId, t.i)) });
  if (!toPitch.length) return result;

  const context = await readContext(site, p);
  // One child per topic, all at once. Not on the agents queue: this run holds
  // a slot while it waits for them, and they are a handful of model calls.
  const handles = [];
  for (const t of toPitch) {
    handles.push(
      await DBOS.startWorkflow(topicPitches, { workflowID: topicPitchesId(proposalId, t.i), workflowAttributes: { site } })({
        site,
        proposalId,
        quarter: row.quarter,
        topicIndex: t.i,
        n: t.n,
        context,
      }),
    );
  }
  for (const h of handles) {
    try {
      result.written += (await h.getResult()).written;
    } catch (err) {
      // One topic failing (Admin > Runs shows it) doesn't lose the others.
      DBOS.logger.error(`${h.workflowID}: ${(err as Error).message}`);
    }
  }
  return result;
}

export const firstPitches = DBOS.registerWorkflow(firstPitchesRun, { name: "strategist:first-pitches" });

/** From the Strategist's run, after it sent `row`: the first pitches, unless it can't be day one. */
export async function startFirstPitches(row: Pick<ProposalRow, "id" | "site" | "kind">, launch: boolean): Promise<string | null> {
  if (!(row.kind === "revision" || (row.kind === "onboarding" && launch))) return null;
  const handle = await DBOS.startWorkflow(firstPitches, { workflowID: firstPitchesId(row.id), queueName: AGENT_QUEUE, workflowAttributes: { site: row.site } })(row.id);
  return handle.workflowID;
}

// ---- drafts once the plan is approved ----

async function firstDraftsRun(proposalId: string): Promise<{ drafting: { briefId: string; runId: string }[]; skipped?: string }> {
  const row = await DBOS.runStep(() => getProposal(proposalId), { name: "read the plan" });
  if (!row || row.status !== "approved") return { drafting: [], skipped: `the proposal is ${row?.status ?? "missing"}` };
  const day = await DBOS.runStep(() => dayOneOf(row), { name: "day one?" });
  if (!day.ok) return { drafting: [], skipped: day.why };
  const briefs = await DBOS.runStep(() => strategistBriefs(row.site), { name: "day one's pitches" });
  const live = briefs.filter((b) => b.status === "pitched" || APPROVED.includes(b.status));
  const drafting: { briefId: string; runId: string }[] = [];
  for (const b of strongest(live, DRAFT_TOP)) {
    // An approved one is already being written (approving starts the Writer).
    if (b.status !== "pitched" || b.post) continue;
    const handle = await startForTenant(row.site, writer, { site: row.site, briefId: b.id, beforeApproval: true });
    drafting.push({ briefId: b.id, runId: handle.workflowID });
  }
  await DBOS.setEvent(DRAFTS_EVENT, drafting);
  return { drafting };
}

export const firstDrafts = DBOS.registerWorkflow(firstDraftsRun, { name: "strategist:first-drafts" });

// ---- one replacement for a rejected day-one pitch ----

async function replaceRun(site: string, briefId: string): Promise<TopicResult | { skipped: string }> {
  if (isLite(site)) return { skipped: "Lite tenant: no AI" };
  const b = await DBOS.runStep(() => strategistBrief(site, briefId), { name: "read the rejected pitch" });
  if (!b || b.status !== "rejected") return { skipped: `the pitch is ${b?.status ?? "missing"}` };
  if (!b.reject_reason.trim()) return { skipped: "no reason given" };
  if (b.fit?.replaces) return { skipped: "a replacement is never replaced" };
  const plan = await DBOS.runStep(() => currentPlan(site), { name: "the plan" });
  const topicIndex = plan?.proposal?.topics.findIndex((t) => sameTopic(t.name, b.topics?.[0] ?? "")) ?? -1;
  if (!plan?.proposal || topicIndex < 0) return { skipped: TOPIC_LEFT };
  const context = await readContext(site, plan.proposal);
  return topicPitchesRun({
    site,
    proposalId: plan.id,
    quarter: plan.quarter,
    topicIndex,
    n: 1,
    context,
    replacing: { briefId, title: b.title, angle: b.angle, reason: b.reject_reason.slice(0, 1000) },
  });
}

export const replacer = DBOS.registerWorkflow(replaceRun, { name: "strategist:replace" });

// ---- the poll ----

const IN_FLIGHT = ["PENDING", "ENQUEUED", "DELAYED"];
/** Ids this process already started: skipped for a while instead of asking DBOS again every tick. */
const asked = new Map<string, number>();
const ASK_AGAIN_MS = 10 * 60_000;

function askedRecently(id: string, now: number): boolean {
  const at = asked.get(id);
  return at !== undefined && now - at < ASK_AGAIN_MS;
}

/** Day one's pitches still being written for `site`. */
async function pitchesInFlight(site: string): Promise<boolean> {
  for (const name of ["strategist:first-pitches", "strategist:topic-pitches"]) {
    const rows = await DBOS.listWorkflows({ workflowName: name, attributes: { site }, status: IN_FLIGHT as never, limit: 1, loadInput: false, loadOutput: false });
    if (rows.length) return true;
  }
  return false;
}

/**
 * Plans approved and day-one pitches rejected in the last two days: start
 * their runs (once each). A plan approved while its pitches are still being
 * written waits for them: the next tick looks again.
 */
export async function dispatchFirstDay(nowMs = Date.now()): Promise<string[]> {
  const since = new Date(nowMs - 2 * 86_400_000).toISOString();
  const started: string[] = [];
  for (const r of await recentlyApproved(since)) {
    if (isLite(r.site) || !(r.proposal?.launch || r.kind === "revision")) continue;
    const id = firstDraftsId(r.id);
    if (askedRecently(id, nowMs)) continue;
    if (await pitchesInFlight(r.site)) continue;
    await startOnceForTenant(r.site, id, firstDrafts, r.id);
    asked.set(id, nowMs);
    started.push(id);
  }
  for (const b of await recentlyRejected(since)) {
    if (isLite(b.site) || b.fit?.replaces || !b.reject_reason.trim()) continue;
    const id = replaceId(b.id);
    if (askedRecently(id, nowMs)) continue;
    await startOnceForTenant(b.site, id, replacer, b.site, b.id);
    asked.set(id, nowMs);
    started.push(id);
  }
  return started;
}

/** For tests: forget what this process started. */
export function forgetAsked(): void {
  asked.clear();
}
