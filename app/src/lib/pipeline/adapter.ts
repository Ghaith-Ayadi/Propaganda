// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER ADAPTER. Example data, kept in this browser only.
//
// The pipeline needs columns `briefs` doesn't have yet (pitched status, topics,
// fit reasons, sources, reviewer, batch, notes) and a source check and claim
// list the agents don't produce yet. Until they land, this file is the whole
// data source: it seeds a fictional tenant ("Ledgerline") relative to today and
// stores changes in localStorage per site. Replace `placeholderAdapter` with an
// adapter over Dexie/Supabase and nothing else in the pipeline changes.
//
// The draft schema is in the PR body; nothing here touches the server.
// ─────────────────────────────────────────────────────────────────────────────

import { siteId } from "@/lib/scope";
import { addDays, shortDate, ymd } from "./dates";
import type { BatchInfo, PipelineItem, PipelineSettings, PipelineSnapshot, Person } from "./types";

export interface PipelineAdapter {
  load(): PipelineSnapshot;
  saveItems(items: PipelineItem[]): void;
  reset(): void;
}

const VERSION = 1;
const key = () => `propaganda:pipeline-placeholder:v${VERSION}:${safeSiteId()}`;

function safeSiteId(): string {
  try {
    return siteId();
  } catch {
    return "none";
  }
}

const PEOPLE: Person[] = [
  { id: "me", name: "You" },
  { id: "agent", name: "Agent", agent: true },
  { id: "maya", name: "Maya Okafor" },
  { id: "lina", name: "Lina Haddad" },
  { id: "tomas", name: "Tomás Reyes" },
];

const SETTINGS: PipelineSettings = {
  cadence: 2,
  slotDays: [2, 4], // Tuesday and Thursday
  publishTime: "09:00",
  meId: "me",
};

function batchInfo(today: Date): BatchInfo {
  return { number: 2, total: 5, dueBy: ymd(addDays(today, 8)) };
}

let lineSeq = 0;
const lines = (...texts: string[]) => texts.map((text) => ({ id: `l${++lineSeq}`, text }));

function seed(): PipelineItem[] {
  const today = new Date();
  const d = (n: number) => ymd(addDays(today, n));
  const sd = (n: number) => shortDate(d(n));
  const now = Date.now();
  const base = {
    format: "blog" as const,
    sources: [],
    notes: [],
    postId: null,
    briefId: null,
    createdAt: now,
    updatedAt: now,
  };
  return [
    {
      ...base,
      id: "ex-close-48h",
      title: "Why your close slips in the last 48 hours",
      why: "The same objection came up in 3 of the last 6 calls, and nothing we've published answers it.",
      stage: "pitched",
      collection: "Guides",
      topics: ["Month-end close"],
      topicProgress: "3 published of 4–6",
      origin: "calls",
      reasons: [
        { kind: "demand", text: "The same objection came up in 3 of the last 6 calls.", counts: true },
        { kind: "mix", text: "Guides are at 31% of a 40% target.", counts: true },
        { kind: "cadence", text: `Fills the open slot on ${sd(13)}.`, counts: true },
        { kind: "gap", text: "Nothing we've published answers it.", counts: true },
      ],
      goals: [
        { goal: "volume", moves: true, note: "Fills an open slot." },
        { goal: "coverage", moves: true, note: "Month-end close is under target." },
        { goal: "ranking", moves: true, note: "\"close checklist\" is a target search." },
      ],
      writerId: "maya",
      reviewerId: "me",
      publishBy: d(13),
      length: "1,200–1,600 words",
      angle:
        "The close doesn't slip because of software. It slips because accruals and late vendor bills land in the last two days. Name the two causes, show the fix for each.",
      audience: "Controllers at 50 to 300 person companies who already close in under 10 days and want under 5.",
      outline: lines(
        "The pattern: fine until day 3, then accruals hell (open with the Brightwater quote, anonymised)",
        "Cause 1: late vendor bills. Why they arrive late, and how to accrue them before they do",
        "Cause 2: manual accruals. The three that can be automated",
        "What changes when both are fixed: Brightwater went from 5 days to 4",
        "Checklist: the last 48 hours, hour by hour",
      ),
      batch: 2,
    },
    {
      ...base,
      id: "ex-soc2",
      title: "SOC 2 Type I vs Type II, in plain words",
      why: "Prospects ask it on almost every security call, and it's searched 2,400 times a month.",
      stage: "pitched",
      collection: "Guides",
      topics: ["Security and audit", "Month-end close"],
      origin: "search",
      reasons: [
        { kind: "demand", text: "2,400 searches a month; asked on 5 of the last 9 security calls.", counts: true },
        { kind: "mix", text: "Security and audit has no post yet this quarter.", counts: true },
        { kind: "cadence", text: `Fills the open slot on ${sd(7)}.`, counts: true },
      ],
      goals: [
        { goal: "volume", moves: true, note: "Fills an open slot." },
        { goal: "coverage", moves: true, note: "Counts toward two topics." },
        { goal: "ranking", moves: true, note: "Target search, we're not in the top 50." },
      ],
      writerId: "lina",
      reviewerId: "me",
      publishBy: d(7),
      length: "900–1,200 words",
      angle: "Type I is a photo, Type II is a film. Which one a buyer should ask for, and when a Type I is enough.",
      audience: "Finance leads buying their first audited tool.",
      outline: lines(
        "The photo and the film",
        "What an auditor actually tests in each",
        "Which one your buyers will ask for",
        "Where we are, and when the Type II report lands",
      ),
      sources: [{ url: "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2", label: "AICPA: SOC 2" }],
      batch: 2,
    },
    {
      ...base,
      id: "ex-accruals",
      title: "Accrual automation: a guide for controllers",
      why: "Accruals come up in every second call, but the search volume is small.",
      stage: "pitched",
      collection: "Guides",
      topics: ["Month-end close"],
      origin: "calls",
      reasons: [
        { kind: "demand", text: "Raised in 4 of the last 9 calls; 140 searches a month.", counts: true },
        { kind: "mix", text: "Guides are at 31% of a 40% target.", counts: true },
        { kind: "duplicate", text: "Overlaps with \"Why your close slips\", pitched in this batch.", counts: false },
      ],
      goals: [
        { goal: "volume", moves: true, note: "Counts toward the quarter." },
        { goal: "coverage", moves: false, note: "Month-end close is covered by the other pitch." },
      ],
      writerId: "tomas",
      reviewerId: "me",
      publishBy: d(20),
      length: "1,400–1,800 words",
      angle: "Which accruals a controller can hand to software, which stay manual, and how to tell.",
      audience: "Controllers who still book accruals from a spreadsheet.",
      outline: lines("The three accruals everyone books by hand", "What automation needs to see first", "A month with and without"),
      batch: 2,
    },
    {
      ...base,
      id: "ex-netsuite",
      title: "NetSuite AP automation: what's native and what isn't",
      why: "1,300 searches a month, and ERP integrations is a focus topic.",
      stage: "pitched",
      collection: "Product",
      topics: ["ERP integrations"],
      topicProgress: "2 published of 1–3",
      origin: "search",
      reasons: [
        { kind: "demand", text: "1,300 searches a month, we rank #48.", counts: true },
        { kind: "mix", text: "Product is at 25% of a 20% target. On target, no boost.", counts: false },
        { kind: "cadence", text: `No open slot before ${sd(27)}.`, counts: false },
      ],
      goals: [
        { goal: "ranking", moves: true, note: "Target search." },
        { goal: "coverage", moves: false, note: "ERP integrations is on target." },
      ],
      writerId: "tomas",
      reviewerId: "maya",
      publishBy: d(27),
      length: "1,400–1,800 words",
      angle: "An honest map of what NetSuite does natively for AP and where a layer on top helps. Stays true to 'we sit on top of your ERP'.",
      audience: "NetSuite admins and controllers comparing add-ons.",
      outline: lines(
        "What NetSuite AP does well out of the box",
        "The gaps: approvals, three-way matching, vendor onboarding",
        "Where a layer on top helps, and where it doesn't",
      ),
      batch: 2,
    },
    {
      ...base,
      id: "ex-vendor-checklist",
      title: "The vendor onboarding checklist",
      why: "Onboarding is where most duplicate payments start.",
      stage: "writing",
      collection: "Guides",
      topics: ["Accounts payable"],
      origin: "calls",
      reasons: [{ kind: "demand", text: "Asked in 3 calls.", counts: true }],
      goals: [{ goal: "volume", moves: true, note: "Batch 1." }],
      writerId: "maya",
      reviewerId: "me",
      publishBy: d(8),
      length: "900–1,200 words",
      angle: "Ten checks before a vendor's first bill, in the order they go wrong.",
      audience: "AP leads.",
      outline: lines("Why onboarding is the leak", "The ten checks", "Who owns each"),
      notes: [
        { lineId: null, text: "Keep it to ten. No more." },
        { lineId: null, text: "Link the duplicate payments post." },
      ],
      batch: 1,
    },
    {
      ...base,
      id: "ex-close-days",
      title: "Stop measuring your close in days",
      why: "An opinion piece the team has argued about on two calls.",
      stage: "writing",
      collection: "Opinion",
      topics: ["Month-end close"],
      origin: "team",
      reasons: [{ kind: "mix", text: "Opinion is under target.", counts: true }],
      goals: [{ goal: "readership", moves: true, note: "Opinion posts hold readers longest." }],
      writerId: "agent",
      reviewerId: "maya",
      publishBy: d(10),
      length: "800–1,000 words",
      angle: "Days to close is a vanity metric; count the late adjustments instead.",
      audience: "CFOs.",
      outline: lines("The number everyone brags about", "What it hides", "What to count instead"),
      notes: [{ lineId: null, text: "Name no competitor." }],
      batch: 1,
    },
    {
      ...base,
      id: "ex-approval-chains",
      title: "Approval chains, revisited for Scale",
      why: "Scale customers asked for approval examples in 4 calls.",
      stage: "in_review",
      collection: "Guides",
      topics: ["Accounts payable"],
      origin: "calls",
      reasons: [{ kind: "demand", text: "Asked in 4 calls.", counts: true }],
      goals: [{ goal: "volume", moves: true, note: "Batch 1." }],
      writerId: "agent",
      reviewerId: "me",
      publishBy: d(1),
      length: "800–1,200 words",
      angle: "The three chains auditors like, and the one they flag.",
      audience: "Controllers on the Scale plan.",
      outline: lines("What changed on Scale", "The three chains auditors like", "The one they flag"),
      notes: [{ lineId: null, text: "Provide examples here, on “The three chains auditors like”", done: true }],
      batch: 1,
      review: {
        paragraphs: [
          "Approval chains got simpler on Scale: [[c1]]up to 25 approvers[[/]], any order, any threshold.",
          "This post walks through the three chains auditors like best, and the one they flag every time.",
          "The first is the plain two-step: whoever raised the bill, then a controller. Haldane moved every vendor under €5,000 onto it and [[c2]]cut audit findings on AP by 40%[[/]].",
          "The second adds a budget owner above a threshold. [[o1]]Approvers can be added mid-chain without restarting it[[/]], so a late sign-off doesn't send the bill back to the start.",
          "[[c3]]Most auditors now expect a four-eyes rule above €10,000[[/]]. The chain they flag every time is the one where the requester can also approve.",
        ],
        checks: [
          { id: "c1", status: "matches", quote: "up to 25 approvers", detail: "Matches the Scale plan sheet." },
          {
            id: "c2",
            status: "mismatch",
            quote: "cut audit findings on AP by 40%",
            detail: "The Haldane call says “about a third”. 40% isn't in any source.",
            where: "Haldane call, Oct 2, 14:20",
          },
          {
            id: "c3",
            status: "unsourced",
            quote: "Most auditors now expect a four-eyes rule above €10,000",
            detail: "Link one, or soften the sentence.",
          },
        ],
        ownClaims: [{ id: "o1", sentence: "Approvers can be added mid-chain without restarting it.", state: "open" }],
      },
    },
    {
      ...base,
      id: "ex-haldane",
      title: "Haldane cut their close from nine days to six",
      why: "A customer story with numbers they approved.",
      stage: "scheduled",
      collection: "Customer stories",
      topics: ["Month-end close"],
      origin: "calls",
      reasons: [],
      goals: [],
      writerId: "lina",
      reviewerId: "me",
      publishBy: d(2),
      scheduledFor: { date: d(2), time: "09:00" },
      length: "1,000 words",
      angle: "",
      audience: "",
      outline: [],
      batch: 1,
    },
    {
      ...base,
      id: "ex-stripe",
      title: "Stripe payouts now reconcile on arrival",
      why: "A product update.",
      stage: "scheduled",
      collection: "Product",
      topics: ["Integrations"],
      origin: "team",
      reasons: [],
      goals: [],
      writerId: "tomas",
      reviewerId: "me",
      publishBy: d(4),
      scheduledFor: { date: d(4), time: "09:00" },
      length: "600 words",
      angle: "",
      audience: "",
      outline: [],
      batch: null,
    },
    {
      ...base,
      id: "ex-auditors",
      title: "What auditors ask an AP team for in October",
      why: "Seasonal.",
      stage: "published",
      collection: "Guides",
      topics: ["Security and audit"],
      origin: "news",
      reasons: [],
      goals: [],
      writerId: "agent",
      reviewerId: "me",
      publishBy: d(-1),
      scheduledFor: { date: d(-1), time: "09:00" },
      length: "900 words",
      angle: "",
      audience: "",
      outline: [],
      batch: 1,
    },
  ];
}

function readStored(): PipelineItem[] | null {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PipelineItem[]) : null;
  } catch {
    return null;
  }
}

export const placeholderAdapter: PipelineAdapter = {
  load() {
    const items = readStored() ?? seed();
    return { items, people: PEOPLE, batch: batchInfo(new Date()), settings: SETTINGS, placeholder: true };
  },
  saveItems(items) {
    try {
      localStorage.setItem(key(), JSON.stringify(items));
    } catch {
      // Private mode or full storage: changes last until reload.
    }
  },
  reset() {
    try {
      localStorage.removeItem(key());
    } catch {
      // nothing stored
    }
  },
};
