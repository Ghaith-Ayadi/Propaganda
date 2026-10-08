// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER ADAPTER. Sample data, in memory, for a made-up tenant (Ledgerline,
// the prototype's accounting-software tenant). Nothing here reads or writes the
// server. Replace with a Supabase adapter when the goal tables exist; the pages
// only see lib/goals/adapter.ts.
//
// It mimics the real system where it matters for the UI:
// - facts are fixed once they happen; approving new targets recalculates the
//   quarter's scores from the same facts (scoreSeries), and the graph marks the day;
// - the Launch, content batches, join-week rule and next-quarter clock follow
//   agents/strategist-cold-start-and-pacing.md;
// - scenarios let you see each state a tenant can be in (new, mid-quarter, late, established).
// ─────────────────────────────────────────────────────────────────────────────

import type { GoalsAdapter } from "./adapter";
import type {
  BatchBrief,
  BatchCadence,
  BatchBriefState,
  BatchPlan,
  ContentBatch,
  Day,
  GoalTargets,
  GoalVersion,
  Launch,
  PlanDrop,
  PlanFile,
  PlanFileKind,
  Proposal,
  ProposalEdit,
  QuarterGoals,
  QuarterKey,
  TenantGoalsContext,
} from "./types";
import {
  addDays,
  daysBetween,
  joinState,
  nextQuarterClock,
  quarterEnd,
  quarterLabel,
  quarterOf,
  quarterStart,
  shiftQuarter,
  shortDate,
  toDay,
  weekStart,
} from "./quarter";
import { planBatches } from "./batching";
import {
  consistencyNow,
  coverageScore,
  rankingPageOne,
  scoreSeries,
  volumeScore,
  type QuarterFacts,
} from "./score";

// ── Scenarios ───────────────────────────────────────────────────────────────

export type ScenarioId = "proposal" | "launch" | "prorated" | "late" | "established";

export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: "proposal", label: "New tenant, proposal waiting", hint: "Onboarded today; nothing approved yet" },
  { id: "launch", label: "New tenant, Launch day 5", hint: "Joined in week 1: full quarter goals" },
  { id: "prorated", label: "Joined in week 6", hint: "Quarter goals prorated to the weeks left" },
  { id: "late", label: "Joined in week 10", hint: "No goals this quarter; next quarter's proposal" },
  { id: "established", label: "Established tenant", hint: "Two quarters of history and a goal change" },
];

const SCENARIO_KEY = "propaganda:goals-placeholder-scenario";

// ── Sample tenant ───────────────────────────────────────────────────────────

const TOPICS = ["Month-end close", "AP automation", "Audit & controls", "ERP integrations"];
const CLUSTERS = TOPICS.slice(0, 2);

const SEARCHES: { query: string; topic: string; volume: number; difficulty: number; why: string }[] = [
  { query: "month end close checklist", topic: "Month-end close", volume: 880, difficulty: 24, why: "Buying intent: people searching this are fixing their close." },
  { query: "how to shorten month end close", topic: "Month-end close", volume: 320, difficulty: 18, why: "Your product's main promise, phrased as a question." },
  { query: "reconciliation automation software", topic: "Month-end close", volume: 260, difficulty: 29, why: "Comparison stage; you're already on page two." },
  { query: "ap automation for small business", topic: "AP automation", volume: 590, difficulty: 27, why: "Long-tail version of a head term you can't win yet." },
  { query: "three way match accounts payable", topic: "AP automation", volume: 390, difficulty: 14, why: "Low difficulty, and your onboarding answer says this is the top support question." },
  { query: "invoice approval workflow", topic: "AP automation", volume: 210, difficulty: 21, why: "Matches the approval feature you shipped in September." },
  { query: "sox controls for startups", topic: "Audit & controls", volume: 170, difficulty: 12, why: "Few good answers out there; your controller can write the best one." },
  { query: "audit trail accounting software", topic: "Audit & controls", volume: 140, difficulty: 19, why: "Comes up on sales calls as a blocker." },
  { query: "netsuite month end close", topic: "ERP integrations", volume: 210, difficulty: 22, why: "Your biggest integration; buyers search with the ERP's name." },
  { query: "quickbooks reconciliation tips", topic: "ERP integrations", volume: 480, difficulty: 26, why: "Large audience on the way up to you." },
];

const POST_TITLES: Record<string, string[]> = {
  "Month-end close": [
    "The month-end close checklist we give every new controller",
    "Why your close takes 10 days, and the 4 that are waiting",
    "Reconciliations that don't need a human",
    "Closing the books when half the team is remote",
    "Accruals without the spreadsheet",
    "What a 3-day close actually looks like",
    "The close calendar, week by week",
    "Flux analysis your CFO will read",
    "Cutoff errors and how to catch them early",
    "The last mile of the close: sign-off",
  ],
  "AP automation": [
    "Three-way match, explained with real invoices",
    "AP automation for a team of two",
    "Invoice approval workflows that people follow",
    "Duplicate payments: how they happen",
    "Vendor onboarding without email threads",
    "Early payment discounts: worth it?",
    "Paying international vendors without surprises",
    "The AP inbox is a database. Treat it like one",
  ],
  "Audit & controls": [
    "SOX controls for startups that aren't public yet",
    "What auditors look for in an audit trail",
    "Segregation of duties with a small team",
    "The controls you can automate on day one",
    "Preparing for your first audit",
  ],
  "ERP integrations": [
    "Closing faster on NetSuite",
    "QuickBooks reconciliation tips from 200 closes",
    "When to leave QuickBooks",
    "ERP migrations without a lost month",
  ],
};

// ── Seeded randomness, so the sample data is stable across reloads ──────────

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ── Targets and proposals ───────────────────────────────────────────────────

const LAUNCH_SIZE = 15;
const LAUNCH_BATCH_SIZES = [6, 5, 4]; // day 1 (3 already drafted), by day 8, by day 15

function newTenantTargets(total: number): GoalTargets {
  const internal = Math.round(total * 0.3);
  return {
    volume: {
      total,
      topics: [
        { name: TOPICS[0], low: Math.round(total * 0.33), high: Math.round(total * 0.42) },
        { name: TOPICS[1], low: Math.round(total * 0.25), high: Math.round(total * 0.33) },
        { name: TOPICS[2], low: Math.max(1, Math.round(total * 0.12)), high: Math.round(total * 0.21) },
        { name: TOPICS[3], low: Math.max(1, Math.round(total * 0.08)), high: Math.round(total * 0.17) },
      ],
    },
    coverage: { internal, external: total - internal },
    readership: { pageviews: null, pagesPerSession: null, corpusMinutes: null, secondsPerPost: null },
    ranking: {
      searches: SEARCHES.map((s) => ({ query: s.query, topic: s.topic, position: null, volume: s.volume, difficulty: s.difficulty })),
      pageOneTarget: 2,
      aiMentionTarget: null,
    },
  };
}

function establishedTargets(total: number, pageOne: number): GoalTargets {
  const t = newTenantTargets(total);
  t.coverage = { internal: Math.round(total * 0.5), external: total - Math.round(total * 0.5) };
  t.readership = { pageviews: 9000, pagesPerSession: 1.5, corpusMinutes: 5200, secondsPerPost: 150 };
  t.ranking.pageOneTarget = pageOne;
  t.ranking.aiMentionTarget = 2;
  return t;
}

function buildProposal(
  quarter: QuarterKey,
  kind: Proposal["kind"],
  from: Day,
  total: number,
  opts: { status: Proposal["status"]; createdAt: Day; prorated?: { factor: number; full: number }; fromPlan?: boolean; established?: boolean },
): Proposal {
  const t = opts.established ? establishedTargets(total, 5) : newTenantTargets(total);
  const to = quarterEnd(quarter);
  const weeks = Math.round((daysBetween(from, to) + 1) / 7);
  const plan = opts.fromPlan;
  const launch = kind === "onboarding";
  const batches = launch
    ? 3 + planBatches("weekly", quarter, addDays(from, 21), Math.max(0, total - LAUNCH_SIZE)).length
    : planBatches("weekly", quarter, addDays(from, -7), total).length;
  return {
    id: `prop-${quarter}-${kind}`,
    quarter,
    kind,
    status: opts.status,
    createdAt: opts.createdAt,
    summary: launch
      ? `Launch with ${LAUNCH_SIZE} posts in two topics over 30 days, then keep a steady ${Math.max(1, Math.round((total - LAUNCH_SIZE) / Math.max(1, weeks - 4)))} a week. Mostly outside topics until calls are connected.`
      : opts.established
        ? "Keep the pace you proved last quarter, add a little, and go after the searches you're already close on."
        : `Your first full quarter: ${total} posts, built on what the Launch taught us.`,
    covers: { from, to, weeks, prorated: !!opts.prorated },
    volume: {
      value: total,
      why: opts.prorated
        ? `You join in week ${13 - Math.round(opts.prorated.factor * 13)}, so the full ${opts.prorated.full} is prorated to the weeks left. The Launch's ${LAUNCH_SIZE} posts count here, so it can't go below that.`
        : launch
          ? `The Launch's ${LAUNCH_SIZE} posts, then about ${Math.max(1, Math.round((total - LAUNCH_SIZE) / Math.max(1, weeks - 4)))} a week. Never more than the 8 a month you said you can review, after the Launch.`
          : opts.established
            ? "Last quarter you published 19. The cap is your real output plus 20%; this is under it."
            : "Your Launch output plus the review capacity you gave us.",
      basis: opts.established ? "Q3: 19 published, 2 rejected briefs" : "Your answer: 8 posts a month reviewed",
      origin: plan ? "plan_changed" : undefined,
      planSaid: plan ? "40 posts this quarter" : undefined,
    },
    topics: t.volume.topics.map((x, i) => ({
      ...x,
      why: [
        "What you sell, and what buyers search for before a demo. Your pillar.",
        "Your second product line; the cluster the Launch builds alongside the first.",
        "Few good answers online and your controller has real opinions. Starts small.",
        "Buyers search with their ERP's name. One or two posts per ERP.",
      ][i],
      basis: ["Your website, pricing page, onboarding answer 1", "Product page, DataForSEO: 1,980 searches/month across the cluster", "Onboarding answer 4, competitor gap", "Integrations page"][i],
      origin: plan ? (i === 0 ? "plan" : i === 1 ? "plan" : i === 2 ? "added" : "plan_changed") : undefined,
    })),
    coverage: {
      internal: t.coverage.internal,
      external: t.coverage.external,
      why: opts.established
        ? "Last quarter half of the approved pitches came from your calls. Keep it."
        : "You haven't connected calls yet, so most ideas start from search demand. Connect Granola and we'll shift this.",
      basis: opts.established ? "Q3: 11 of 21 approved pitches internal" : "No sources connected",
    },
    ranking: {
      searches: SEARCHES.map((s) => ({ query: s.query, topic: s.topic, position: null, volume: s.volume, difficulty: s.difficulty, why: s.why, origin: plan && s.topic === TOPICS[0] ? "plan" : undefined })),
      pageOneTarget: {
        value: opts.established ? 5 : 2,
        why: opts.established
          ? "Three are on page one now and two more are on page two."
          : "A new blog ranks slowly. Aim for indexing first, 10 to 30 long-tail searches in the top 20, and 1 to 5 in the top 10.",
        basis: opts.established ? "DataForSEO, positions this week" : "New domain, no history",
      },
      aiMentionTarget: {
        value: opts.established ? 2 : null,
        why: opts.established
          ? "AI answers mention you for 1 of 10 prompts today."
          : "No AI target in your first quarter: AI answers follow mentions of you elsewhere on the web, not how many posts you have. We'll measure it on brand and product prompts and report it.",
        basis: opts.established ? "DataForSEO LLM Mentions, this week" : "Ahrefs study of 75K brands",
      },
    },
    readership: {
      value: opts.established ? 5200 : null,
      why: opts.established ? "Last quarter's reading time plus 15%." : "No readers yet. We'll propose a target after 4 weeks of readers.",
      basis: opts.established ? "Q3: 4,510 minutes read" : "No data",
    },
    watchedSites: [
      { url: "https://www.fasb.org/standards", topic: TOPICS[2], why: "Standards changes are timely posts for controllers." },
      { url: "https://www.aicpa-cima.com/news", topic: TOPICS[2], why: "The profession's own news; your readers follow it." },
      { url: "https://www.irs.gov/newsroom", topic: TOPICS[1], why: "1099 and payment rules land here first." },
      { url: "https://www.netsuite.com/portal/resource/articles.shtml", topic: TOPICS[3], why: "Your biggest integration's own content; we answer what it skips." },
    ],
    batches: {
      value: batches,
      why: launch
        ? `The Launch's 3 batches (day 1, 8 and 15), then a batch every week until ${shortDate(weekStart(quarter, 9))}. Published across the whole quarter.`
        : `A double batch to start, then one every week through the first two months. Published across the whole quarter.`,
      basis: "Batching: Weekly (recommended). You can switch to Flood, or ask for the next batch early, any time",
    },
    questions: launch
      ? [
          "You mentioned the close checklist launch in November. Should it get its own topic, or sit in Month-end close?",
          plan ? "Your plan lists 12 glossary posts. Glossaries are the first thing Google demotes on new AI-assisted blogs; we left them out. Keep them out?" : "Who should the byline be on the Launch posts? Every post needs a named person.",
        ]
      : ["Two of last quarter's planned posts moved here to make room for bonus posts. Keep them first?"],
  };
}

// ── Plans: what gets published when (fixed once it happens) ─────────────────

interface PlannedPost {
  id: string;
  title: string;
  topics: string[];
  origin: "internal" | "external";
  publishOn: Day;
  batch: number;
  launch: boolean;
  /** Drafted before the batch landed (the Launch's day-one three). */
  preDrafted: boolean;
  /** Its Launch batch (1 to 3), kept when the tenant re-batches; 0 outside the Launch. */
  launchBatch: number;
}

interface QuarterPlan {
  quarter: QuarterKey;
  start: Day; // first day the plan covers
  batchDue: Day[];
  posts: PlannedPost[];
  bonus: { day: Day; topic: string; source: string }[];
  pushedToNext: number;
}

function titleFor(topic: string, i: number): string {
  const list = POST_TITLES[topic];
  return list[i % list.length] + (i >= list.length ? ` (part ${Math.floor(i / list.length) + 1})` : "");
}

function buildPlan(quarter: QuarterKey, start: Day, targets: GoalTargets, launchFrom: Day | null, cadence: BatchCadence = "weekly"): QuarterPlan {
  const r = rng(hash(quarter + start));
  const total = targets.volume.total;
  const topicOrder: string[] = [];
  for (const t of targets.volume.topics) for (let i = 0; i < t.low; i++) topicOrder.push(t.name);
  while (topicOrder.length < total) topicOrder.push(targets.volume.topics[topicOrder.length % targets.volume.topics.length].name);
  const internalShare = targets.coverage.internal / Math.max(1, targets.coverage.internal + targets.coverage.external);
  const end = quarterEnd(quarter);

  const posts: PlannedPost[] = [];
  const batchDue: Day[] = [];
  const perTopic: Record<string, number> = {};
  const push = (topic: string, publishOn: Day, batch: number, launch: boolean, preDrafted: boolean) => {
    const n = perTopic[topic] ?? 0;
    perTopic[topic] = n + 1;
    const second = r() < 0.2 ? TOPICS.find((t) => t !== topic && targets.volume.topics.some((x) => x.name === t)) : undefined;
    posts.push({
      id: `${quarter}-${posts.length + 1}`,
      title: titleFor(topic, n),
      topics: second ? [topic, second] : [topic],
      origin: r() < internalShare ? "internal" : "external",
      publishOn,
      batch,
      launch,
      preDrafted,
      launchBatch: launch ? batch : 0,
    });
  };

  let rest = total;
  let afterLaunch = start;
  if (launchFrom) {
    // Launch: 15 posts in two clusters, batches on day 1, 8 and 15, published over 30 days.
    const sizes = LAUNCH_BATCH_SIZES;
    let k = 0;
    sizes.forEach((size, b) => {
      batchDue.push(addDays(launchFrom, b * 7));
      for (let i = 0; i < size; i++, k++) {
        const publishOn = addDays(launchFrom, 2 + Math.round((k * 27) / (LAUNCH_SIZE - 1)));
        push(CLUSTERS[k % 2 === 0 || k % 5 === 0 ? 0 : 1], publishOn, b + 1, true, b === 0 && i < 3);
      }
    });
    rest = Math.max(0, total - LAUNCH_SIZE);
    afterLaunch = addDays(launchFrom, 30);
    // Launch posts used cluster topics; take them out of the topic order.
    for (const p of posts) {
      const i = topicOrder.indexOf(p.topics[0]);
      if (i >= 0) topicOrder.splice(i, 1);
    }
  }

  if (rest > 0) {
    // An established tenant's first batch was written in the last week of the quarter before.
    const ongoing = !launchFrom && start === quarterStart(quarter);
    const firstDue = launchFrom ? addDays(launchFrom, 21) : ongoing ? addDays(start, -7) : start;
    const pubFrom = launchFrom ? afterLaunch : ongoing ? addDays(start, 1) : addDays(start, 10);
    const span = Math.max(1, daysBetween(pubFrom, addDays(end, -3)));
    let k = 0;
    for (const slot of planBatches(cadence, quarter, firstDue, rest)) {
      batchDue.push(slot.due);
      for (let i = 0; i < slot.size; i++, k++) {
        let publishOn = addDays(pubFrom, Math.round((k * span) / Math.max(1, rest - 1)));
        if (publishOn < addDays(slot.due, 7)) publishOn = addDays(slot.due, 7);
        push(topicOrder.shift() ?? TOPICS[k % TOPICS.length], publishOn, batchDue.length, false, false);
      }
    }
  }

  const bonus: QuarterPlan["bonus"] = [];
  const bonusDays = [daysBetween(start, end) * 0.3, daysBetween(start, end) * 0.55].map((d) => addDays(start, Math.round(d)));
  bonusDays.forEach((day, i) => bonus.push({ day, topic: TOPICS[2 + (i % 2)], source: i === 0 ? "news" : "a sales call" }));
  return { quarter, start, batchDue, posts, bonus, pushedToNext: 1 };
}

/** Grow or shrink a plan's future after a goal change. The past never changes. */
function reshapePlan(plan: QuarterPlan, targets: GoalTargets, today: Day): QuarterPlan {
  const total = targets.volume.total;
  const posts = [...plan.posts];
  if (posts.length > total) {
    for (let i = posts.length - 1; i >= 0 && posts.length > total; i--) if (posts[i].publishOn > today) posts.splice(i, 1);
  }
  const end = quarterEnd(plan.quarter);
  const extra = total - posts.length;
  for (let i = 0; i < extra; i++) {
    const topic = targets.volume.topics[i % targets.volume.topics.length].name;
    posts.push({
      id: `${plan.quarter}-x${i + 1}`,
      title: titleFor(topic, 20 + i),
      topics: [topic],
      origin: "external",
      publishOn: addDays(today, Math.round(((i + 1) * daysBetween(today, end)) / (extra + 1))),
      batch: plan.batchDue.length,
      launch: false,
      preDrafted: false,
      launchBatch: 0,
    });
  }
  return { ...plan, posts };
}

/**
 * Re-batch what hasn't reached the inbox yet with a new cadence, the Launch's
 * remaining batches included. Delivered batches stay; publish dates don't move.
 */
function rebatch(plan: QuarterPlan, cadence: BatchCadence, today: Day): QuarterPlan {
  const keep = plan.batchDue.map((due) => due <= today);
  const waiting = plan.posts.filter((p) => !keep[p.batch - 1]).sort((a, b) => (a.publishOn < b.publishOn ? -1 : 1));
  if (!waiting.length) return plan;
  const renumber = new Map<number, number>();
  const batchDue: Day[] = [];
  plan.batchDue.forEach((due, i) => {
    if (keep[i]) {
      batchDue.push(due);
      renumber.set(i + 1, batchDue.length);
    }
  });
  const posts = plan.posts.map((p) => (keep[p.batch - 1] ? { ...p, batch: renumber.get(p.batch)! } : p));
  let k = 0;
  for (const slot of planBatches(cadence, plan.quarter, addDays(today, 1), waiting.length)) {
    batchDue.push(slot.due);
    for (let i = 0; i < slot.size; i++, k++) {
      const p = posts.find((x) => x.id === waiting[k].id)!;
      p.batch = batchDue.length;
    }
  }
  return { ...plan, batchDue, posts };
}

function factsFor(plan: QuarterPlan, today: Day, established: boolean): QuarterFacts {
  const r = rng(hash("facts" + plan.quarter + plan.start));
  const published = plan.posts
    .filter((p) => p.publishOn <= today && p.publishOn >= plan.start)
    .map((p) => ({ day: p.publishOn, topics: p.topics, origin: p.origin, planned: true }));
  for (const b of plan.bonus) if (b.day <= today && b.day >= plan.start) published.push({ day: b.day, topics: [b.topic], origin: "external", planned: false });
  published.sort((a, b) => (a.day < b.day ? -1 : 1));

  const readership: QuarterFacts["readership"] = [];
  const ranking: QuarterFacts["ranking"] = [];
  const consistency: QuarterFacts["consistency"] = [];
  const startPos = SEARCHES.map((_, i) => (established ? [6, 9, 14, 8, 22, 31, 12, 48, null, 27][i] : [null, 64, null, 88, 71, null, 93, null, null, 80][i]));
  const days = Math.max(0, daysBetween(plan.start, today));
  const base = established ? 40 : 0;
  for (let i = 0; i <= days; i++) {
    const day = addDays(plan.start, i);
    const live = published.filter((p) => p.day <= day).length + (established ? 30 : 0);
    const pv = Math.round(live * (2 + r() * 4) + base * r());
    readership.push({ day, pageviews: pv, sessions: Math.round(pv / (1.25 + r() * 0.4)), readingSeconds: Math.round(pv * (60 + r() * 110)), postsRead: Math.max(1, live) });
    const positions: Record<string, number | null> = {};
    SEARCHES.forEach((s, k) => {
      const p0 = startPos[k];
      if (p0 == null) positions[s.query] = i > 25 + k * 4 && k % 2 === 0 ? Math.max(4, 95 - i) : null;
      else positions[s.query] = Math.max(2, Math.round(p0 - i * (k % 3 === 0 ? 0.25 : 0.1) + (r() - 0.5) * 3));
    });
    ranking.push({ day, positions, aiMentions: established ? (i > 40 ? 2 : 1) : 0 });
    const any = published.some((p) => p.day <= day);
    consistency.push({
      day,
      contentClean: any ? Math.min(1, 0.86 + r() * 0.12 + i * 0.0006) : null,
      kbClean: established || i > 9 ? Math.min(1, 0.8 + r() * 0.08 + i * 0.001) : null,
    });
  }
  return { published, readership, ranking, consistency };
}

// ── The store ───────────────────────────────────────────────────────────────

interface State {
  scenario: ScenarioId;
  ctx: TenantGoalsContext;
  /** null until the tenant approves their first plan. */
  launchFrom: Day | null;
  versions: GoalVersion[];
  proposals: Proposal[];
  plans: Map<QuarterKey, QuarterPlan>;
  facts: Map<QuarterKey, QuarterFacts>;
  drop: PlanDrop;
  cadence: BatchCadence;
}

let state: State;
let ver = 0;
const listeners = new Set<() => void>();

function emit() {
  ver++;
  listeners.forEach((l) => l());
}

function readScenario(): ScenarioId {
  try {
    const v = localStorage.getItem(SCENARIO_KEY) as ScenarioId | null;
    if (v && SCENARIOS.some((s) => s.id === v)) return v;
  } catch {
    /* storage blocked: default */
  }
  return "launch";
}

function build(scenario: ScenarioId): State {
  const realToday = toDay(new Date());
  const q = quarterOf(realToday);
  const s: State = {
    scenario,
    ctx: { joinedAt: realToday, today: realToday },
    launchFrom: null,
    versions: [],
    proposals: [],
    plans: new Map(),
    facts: new Map(),
    drop: { text: "", files: [], readAt: null },
    cadence: "weekly",
  };
  const approve = (quarter: QuarterKey, version: number, approvedAt: Day, targets: GoalTargets, changes: string[] = [], note?: string, covers?: GoalVersion["covers"]) =>
    s.versions.push({ quarter, version, approvedAt, approvedBy: "Ayadi", changes, note, targets, covers });

  if (scenario === "proposal") {
    const today = addDays(quarterStart(q), Math.min(10, daysBetween(quarterStart(q), realToday)));
    s.ctx = { joinedAt: today, today };
    s.drop = {
      text: "Q4 ideas from our marketing offsite:\n- 40 posts this quarter\n- Close checklist series (launching Nov)\n- 12 glossary posts (accruals, deferrals, ...)\n- Customer story with Northwind",
      files: [{ id: "f1", name: "Content plan Q4.pdf", size: 412_000, kind: "pdf", uploadedAt: today }],
      readAt: today,
    };
    s.proposals.push(buildProposal(q, "onboarding", today, 24, { status: "sent", createdAt: today, fromPlan: true }));
  }

  if (scenario === "launch") {
    const joined = addDays(realToday, -4);
    s.ctx = { joinedAt: joined, today: realToday };
    s.launchFrom = joined;
    const p = buildProposal(quarterOf(joined), "onboarding", joined, 24, { status: "approved", createdAt: addDays(joined, -1) });
    p.approvedAt = joined;
    p.approvedBy = "Ayadi";
    s.proposals.push(p);
    approve(quarterOf(joined), 1, joined, newTenantTargets(24));
  }

  if (scenario === "prorated") {
    const joined = weekStart(q, 6);
    const today = addDays(joined, 9);
    s.ctx = { joinedAt: joined, today };
    s.launchFrom = joined;
    const js = joinState(joined);
    const factor = js.kind === "prorated" ? js.factor : 1;
    const total = Math.max(LAUNCH_SIZE, Math.round(24 * factor));
    const p = buildProposal(q, "onboarding", joined, total, { status: "approved", createdAt: joined, prorated: { factor, full: 24 } });
    p.approvedAt = joined;
    p.approvedBy = "Ayadi";
    s.proposals.push(p);
    approve(q, 1, joined, newTenantTargets(total), [], undefined, js.kind === "prorated" ? { from: js.from, weeks: js.weeksLeft } : undefined);
  }

  if (scenario === "late") {
    const joined = weekStart(q, 10);
    const today = addDays(joined, 6);
    s.ctx = { joinedAt: joined, today };
    s.launchFrom = joined;
    const next = shiftQuarter(q, 1);
    s.proposals.push(buildProposal(next, "onboarding", quarterStart(next), 24, { status: "sent", createdAt: joined }));
  }

  if (scenario === "established") {
    const prev = shiftQuarter(q, -1);
    s.ctx = { joinedAt: quarterStart(shiftQuarter(q, -2)), today: realToday };
    approve(prev, 1, addDays(quarterStart(prev), -12), establishedTargets(16, 3));
    approve(prev, 2, addDays(quarterStart(prev), 42), establishedTargets(18, 3), ["Volume 16 → 18"], "We hired a second writer for the AP series.");
    approve(q, 1, addDays(quarterStart(q), -10), establishedTargets(20, 4));
    const changeDay = addDays(quarterStart(q), Math.max(1, Math.min(daysBetween(quarterStart(q), realToday) - 1, 30)));
    approve(q, 2, changeDay, establishedTargets(22, 5), ["Volume 20 → 22", "Ranking: page one 4 → 5"], "The close checklist launches in November; two extra posts for it.");
    const p = buildProposal(q, "quarterly", quarterStart(q), 20, { status: "approved", createdAt: addDays(quarterStart(q), -26), established: true });
    p.approvedAt = addDays(quarterStart(q), -10);
    p.approvedBy = "Ayadi";
    s.proposals.push(p);
    // The next quarter's draft exists from week 9 on.
    const clock = nextQuarterClock(q);
    if (realToday >= clock.draftOn) {
      s.proposals.push(buildProposal(shiftQuarter(q, 1), "quarterly", quarterStart(shiftQuarter(q, 1)), 23, { status: "sent", createdAt: clock.draftOn, established: true }));
    }
  }
  return s;
}

function latestVersion(quarter: QuarterKey): GoalVersion | null {
  const vs = state.versions.filter((v) => v.quarter === quarter);
  return vs.length ? vs[vs.length - 1] : null;
}

function planFor(quarter: QuarterKey): QuarterPlan | null {
  const v = latestVersion(quarter);
  if (!v) return null;
  let plan = state.plans.get(quarter);
  if (!plan) {
    const start = v.covers?.from && state.launchFrom == null ? v.covers.from : quarterStart(quarter) > state.ctx.joinedAt ? quarterStart(quarter) : state.ctx.joinedAt;
    const launchHere = state.launchFrom && quarterOf(state.launchFrom) === quarter ? state.launchFrom : null;
    plan = buildPlan(quarter, start, v.targets, launchHere, state.cadence);
    state.plans.set(quarter, plan);
  } else if (plan.posts.length !== v.targets.volume.total) {
    plan = reshapePlan(plan, v.targets, state.ctx.today);
    state.plans.set(quarter, plan);
  }
  return plan;
}

function factsForQuarter(quarter: QuarterKey): QuarterFacts | null {
  let f = state.facts.get(quarter);
  if (f) return f;
  const plan = planFor(quarter);
  if (plan) {
    f = factsFor(plan, quarterEnd(quarter) < state.ctx.today ? quarterEnd(quarter) : state.ctx.today, state.scenario === "established");
  } else if (state.launchFrom && quarterOf(state.launchFrom) === quarter) {
    // Joined in weeks 9-13: the Launch publishes, but the quarter isn't graded.
    const launchPlan = buildPlan(quarter, state.launchFrom, newTenantTargets(LAUNCH_SIZE), state.launchFrom);
    state.plans.set(quarter, launchPlan);
    f = factsFor(launchPlan, state.ctx.today, false);
  } else return null;
  state.facts.set(quarter, f);
  return f;
}

function briefState(p: PlannedPost, due: Day, today: Day, idx: number): BatchBriefState {
  if (p.publishOn <= today) return "published";
  const age = daysBetween(due, today);
  if (age < 0) return "brief";
  if (age >= 6) return "scheduled";
  if (p.preDrafted) return age >= 1 ? "scheduled" : "drafted";
  if (age >= 3) return idx % 4 === 3 ? "rejected" : "drafted";
  if (age >= 1) return idx % 3 === 0 ? "approved" : "brief";
  return "brief";
}

const EMPTY_FACTS: QuarterFacts = { published: [], readership: [], ranking: [], consistency: [] };

// ── Adapter ─────────────────────────────────────────────────────────────────

state = build(readScenario());

export const placeholderAdapter: GoalsAdapter = {
  placeholder: true,
  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  version: () => ver,
  context: () => state.ctx,

  quarters() {
    const cur = quarterOf(state.ctx.today);
    const first = quarterOf(state.ctx.joinedAt);
    const out: QuarterKey[] = [];
    for (let k = first; k <= cur; k = shiftQuarter(k, 1)) out.push(k);
    out.push(shiftQuarter(cur, 1));
    return out;
  },

  quarterGoals(quarter): QuarterGoals {
    const history = state.versions.filter((v) => v.quarter === quarter);
    const current = history.length ? history[history.length - 1] : null;
    const facts = factsForQuarter(quarter) ?? EMPTY_FACTS;
    const until = quarterEnd(quarter) < state.ctx.today ? quarterEnd(quarter) : state.ctx.today;
    const targets = current?.targets ?? newTenantTargets(0);
    const scores = current
      ? scoreSeries(quarter, until, facts, targets)
      : { volume: [], coverage: [], consistency: [], readership: [], ranking: [] };
    const vol = volumeScore(facts.published, targets.volume);
    const cov = coverageScore(facts.published, targets.coverage);
    const rd = facts.readership;
    const pv = rd.reduce((a, x) => a + x.pageviews, 0);
    const sessions = rd.reduce((a, x) => a + x.sessions, 0);
    const secs = rd.reduce((a, x) => a + x.readingSeconds, 0);
    const lastRank = facts.ranking[facts.ranking.length - 1];
    return {
      quarter,
      current,
      history,
      scores,
      now: {
        volume: { published: vol.published, byTopic: vol.byTopic, bonus: vol.bonus },
        coverage: { internal: cov.internal, external: cov.external },
        consistency: consistencyNow(facts.consistency[facts.consistency.length - 1]),
        readership: {
          pageviews: pv,
          pagesPerSession: sessions ? pv / sessions : 0,
          corpusMinutes: Math.round(secs / 60),
          secondsPerPost: Math.round(secs / Math.max(1, pv)),
        },
        ranking: { positions: lastRank?.positions ?? {}, aiMentions: lastRank?.aiMentions ?? 0 },
      },
    };
  },

  proposal(quarter) {
    const ps = state.proposals.filter((p) => p.quarter === quarter && p.status !== "superseded");
    return ps.length ? ps[ps.length - 1] : null;
  },

  launch(): Launch | null {
    const from = state.launchFrom;
    if (!from) return null;
    const day = daysBetween(from, state.ctx.today) + 1;
    if (day > 30) return null;
    const quarter = quarterOf(from);
    factsForQuarter(quarter);
    const plan = state.plans.get(quarter);
    if (!plan) return null;
    const today = state.ctx.today;
    const lp = plan.posts.filter((p) => p.launch);
    const states = lp.map((p, i) => briefState(p, plan.batchDue[p.batch - 1], today, i));
    const live = lp.filter((p) => p.publishOn <= today);
    const pubDays = live.map((p) => p.publishOn);
    let gap = 0;
    for (let i = 1; i < pubDays.length; i++) gap = Math.max(gap, daysBetween(pubDays[i - 1], pubDays[i]));
    return {
      startedAt: from,
      day,
      target: LAUNCH_SIZE,
      floor: 12,
      ceiling: 20,
      produced: states.filter((s) => s === "scheduled" || s === "published").length,
      live: live.length,
      indexed: Math.floor(live.length * 0.8),
      clusters: CLUSTERS.map((name) => ({ name, planned: lp.filter((p) => p.topics[0] === name).length, live: live.filter((p) => p.topics[0] === name).length })),
      batches: LAUNCH_BATCH_SIZES.map((size, b) => {
        const posts = lp.filter((p) => p.launchBatch === b + 1);
        const st = posts.map((p) => states[lp.indexOf(p)]);
        return {
          number: (b + 1) as 1 | 2 | 3,
          dueDay: 1 + b * 7,
          arrived: posts.length > 0 && plan.batchDue[posts[0].batch - 1] <= today,
          briefs: size,
          drafted: st.filter((s) => s === "drafted" || s === "scheduled" || s === "published").length,
          approved: st.filter((s) => s === "scheduled" || s === "published").length,
        };
      }),
      longestGap: gap,
      firstPublicPost: pubDays[0] ?? null,
    };
  },

  batchPlan(quarter): BatchPlan | null {
    if (!latestVersion(quarter)) return null;
    factsForQuarter(quarter);
    const plan = planFor(quarter);
    if (!plan) return null;
    const today = state.ctx.today;
    const batches: ContentBatch[] = plan.batchDue.map((due, i) => {
      const posts = plan.posts.filter((p) => p.batch === i + 1);
      const briefs: BatchBrief[] = posts.map((p, k) => ({
        id: p.id,
        title: p.title,
        topic: p.topics.join(" + "),
        origin: p.origin,
        state: briefState(p, due, today, k),
        publishOn: p.publishOn,
      }));
      const open = briefs.some((b) => b.state === "brief" || b.state === "drafted" || b.state === "approved");
      return {
        id: `${quarter}-b${i + 1}`,
        quarter,
        number: i + 1,
        dueAt: due,
        state: due > today ? "pending" : open ? "in_review" : "decided",
        briefs,
        launch: posts.some((p) => p.launch),
      };
    });
    const bonusDone = plan.bonus.filter((b) => b.day <= today);
    return {
      quarter,
      cadence: state.cadence,
      planned: plan.posts.length,
      batches,
      bonus: { count: bonusDone.length, sources: bonusDone.map((b) => b.source) },
      pushedToNext: bonusDone.length ? plan.pushedToNext : 0,
      allWrittenBy: addDays(plan.batchDue[plan.batchDue.length - 1] ?? quarterStart(quarter), 7),
    };
  },

  planDrop: () => state.drop,

  async approveProposal(id, edited, edits) {
    const p = state.proposals.find((x) => x.id === id);
    if (!p) throw new Error("No such proposal");
    const today = state.ctx.today;
    const prev = latestVersion(p.quarter);
    const targets: GoalTargets = {
      volume: { total: edited.volume.value, topics: edited.topics.map(({ name, low, high }) => ({ name, low, high })) },
      coverage: { internal: edited.coverage.internal, external: edited.coverage.external },
      readership: { pageviews: null, pagesPerSession: null, corpusMinutes: edited.readership.value, secondsPerPost: null },
      ranking: {
        searches: edited.ranking.searches.map(({ query, topic, position, volume, difficulty }) => ({ query, topic, position, volume, difficulty })),
        pageOneTarget: edited.ranking.pageOneTarget.value,
        aiMentionTarget: edited.ranking.aiMentionTarget.value,
      },
    };
    const v: GoalVersion = {
      quarter: p.quarter,
      version: (prev?.version ?? 0) + 1,
      approvedAt: today,
      approvedBy: "You",
      changes: prev ? edits.map((e) => `${e.field} ${e.from} → ${e.to}`) : [],
      note: edits.find((e) => e.reason)?.reason,
      targets,
    };
    state.versions.push(v);
    Object.assign(p, edited, { status: "approved", approvedAt: today, approvedBy: "You" });
    // First approval starts the Launch (the plan's batch 1 lands the next morning).
    if (!state.launchFrom && p.kind === "onboarding" && quarterOf(today) === p.quarter) state.launchFrom = today;
    state.facts.delete(p.quarter); // recalculated from the same facts on next read
    if (state.plans.has(p.quarter)) state.plans.set(p.quarter, reshapePlan(state.plans.get(p.quarter)!, targets, today));
    emit();
    return v;
  },

  async requestChanges(id, note) {
    const p = state.proposals.find((x) => x.id === id);
    if (!p) return;
    p.status = "changes_requested";
    p.changeRequest = note;
    emit();
  },

  async savePlanDrop(text, files) {
    const added: PlanFile[] = files.map((f, i) => ({
      id: `f${Date.now()}-${i}`,
      name: f.name,
      size: f.size,
      kind: kindOf(f),
      uploadedAt: state.ctx.today,
    }));
    state.drop = { text, files: [...state.drop.files, ...added], readAt: null };
    emit();
    return state.drop;
  },

  async setBatchCadence(cadence) {
    if (cadence === state.cadence) return;
    state.cadence = cadence;
    for (const [q, plan] of state.plans) state.plans.set(q, rebatch(plan, cadence, state.ctx.today));
    emit();
  },

  async requestNextBatch(quarter) {
    const plan = state.plans.get(quarter);
    if (!plan) return null;
    const i = plan.batchDue.findIndex((due) => due > state.ctx.today);
    if (i < 0) return null;
    const batchDue = [...plan.batchDue];
    batchDue[i] = state.ctx.today;
    state.plans.set(quarter, { ...plan, batchDue });
    emit();
    return i + 1;
  },

  async removePlanFile(id) {
    state.drop = { ...state.drop, files: state.drop.files.filter((f) => f.id !== id) };
    emit();
  },
};

export function kindOf(f: { name: string; type: string }): PlanFileKind {
  const n = f.name.toLowerCase();
  if (f.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (f.type.startsWith("image/")) return "image";
  if (/\.(docx?|odt|rtf|pages)$/.test(n)) return "doc";
  if (/\.(md|markdown)$/.test(n)) return "markdown";
  if (/\.(xlsx?|csv|ods|numbers)$/.test(n)) return "spreadsheet";
  return "text";
}

/** Placeholder only: switch the sample tenant's situation. */
export function placeholderScenario(): ScenarioId {
  return state.scenario;
}

export function setPlaceholderScenario(id: ScenarioId) {
  try {
    localStorage.setItem(SCENARIO_KEY, id);
  } catch {
    /* storage blocked: still switch for this page load */
  }
  state = build(id);
  emit();
}

/** For the next-quarter card: "Q1 2027 is drafted on 26 Nov". */
export function describeQuarter(key: QuarterKey) {
  return { label: quarterLabel(key), start: quarterStart(key), end: quarterEnd(key) };
}
