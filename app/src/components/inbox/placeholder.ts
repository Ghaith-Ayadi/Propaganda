// PLACEHOLDER ADAPTER: example inbox items, kept in memory.
//
// Stands in for tables that don't exist on the server yet: kb_flags and
// kb_claims (draft in project files, kb-data-model/), briefs.status 'pitched'
// with content_batches (Strategist cold-start doc, section 3), and escalated
// kb_proposals. Actions change this in-memory copy only and say so: nothing is
// written anywhere, and no real post is touched. Replace this file's import in
// data.ts with the live source when the tables land.

import type { Claim, Flag, FlagClose, InboxSnapshot, InboxSource, KnowledgeItem, PitchBatch } from "./data";
import { toast } from "@/components/base/toast/toast";
import { addDays, dayKey } from "@/components/shared/quarter";

const today = new Date();
const day = (n: number) => dayKey(addDays(today, n));

const scaleClaim: Claim = {
  text: "The Growth plan was renamed Scale on 1 September 2026. Scale caps approvers at 25.",
  topic: "Pricing",
  origin: "Remembered by Maya Okafor",
  since: "2026-09-30",
  status: "settled",
  evidence: 1,
};

const soc2Claim: Claim = {
  text: "The SOC 2 Type II audit window closes on 30 November 2026. Until the report is issued, we say “audit in progress”.",
  topic: "Security",
  origin: "From the security review call, 2026-09-18",
  since: "2026-09-18",
  status: "settled",
  evidence: 2,
};

const integrationsClaim: Claim = {
  text: "Ledgerline has 42 native integrations. Zapier connectors are not counted.",
  topic: "Product",
  origin: "Remembered by Sam Reyes",
  since: "2026-08-21",
  status: "contested",
  evidence: 3,
};

const flags: Flag[] = [
  {
    id: "flag-pricing-1",
    object: { kind: "blog", title: "Pricing that grows with your finance team", state: "published 2026-09-12", url: "#" },
    topic: "Pricing tiers named two ways",
    raised: "2026-10-01",
    confidence: 0.92,
    says: {
      before: "Every team starts somewhere. ",
      quote: "Our Growth plan includes unlimited approvers,",
      after: " so nobody waits on a bottleneck at month end.",
      section: "Plans at a glance",
    },
    against: { kind: "claim", claim: scaleClaim },
    fix: { replacement: "Our Scale plan includes up to 25 approvers," },
    cantFix: false,
    status: "open",
  },
  {
    id: "flag-close-1",
    object: { kind: "blog", title: "The 3-day close is a process problem, not a tooling problem", state: "published 2026-09-28", url: "#" },
    topic: "How fast is the close?",
    raised: "2026-09-29",
    confidence: 0.81,
    says: {
      before: "",
      quote: "Teams on Ledgerline close in 3 days.",
      after: " Here's what the other teams are doing wrong.",
      section: "Opening line",
    },
    against: {
      kind: "content",
      object: { kind: "blog", title: "How Brightwater closed their books in 5 days", state: "published 2026-07-10", url: "#" },
      passage: {
        before: "Six months in, ",
        quote: "Brightwater cut their close from 11 days to 5.",
        after: " Their controller now leaves on time on day 5.",
        section: "Results",
      },
      note: "Neither is in the knowledge base yet, so one of them has to give.",
    },
    fix: { replacement: "Teams on Ledgerline close in as little as 3 days." },
    cantFix: false,
    status: "open",
  },
  {
    id: "flag-soc2-news",
    object: { kind: "newsletter", title: "The Close, issue 14: audit season", state: "sent 2026-09-30" },
    topic: "Security claims ahead of the audit",
    raised: "2026-10-02",
    confidence: 0.95,
    says: {
      before: "A quick one before quarter end: ",
      quote: "Ledgerline is SOC 2 Type II certified,",
      after: " so your auditors can stop asking for screenshots.",
      section: "Second paragraph",
    },
    against: { kind: "claim", claim: soc2Claim },
    fix: null,
    cantFix: true,
    status: "open",
  },
  {
    id: "flag-soc2-blog",
    object: { kind: "blog", title: "What SOC 2 Type II means for your AP data", state: "published 2026-09-05", url: "#" },
    topic: "Security claims ahead of the audit",
    raised: "2026-10-02",
    confidence: 0.97,
    says: {
      before: "Here is the short version: ",
      quote: "we completed our SOC 2 Type II audit this summer.",
      after: " The longer version is below.",
      section: "Introduction",
    },
    against: { kind: "claim", claim: soc2Claim },
    fix: { replacement: "our SOC 2 Type II audit is in progress and closes this November." },
    cantFix: false,
    status: "open",
  },
  {
    id: "flag-integrations-li",
    object: { kind: "linkedin", title: "Stripe payouts, reconciled the moment they land", state: "posted 2026-09-24", url: "#" },
    topic: "Integration count",
    raised: "2026-09-25",
    confidence: 0.77,
    says: {
      before: "Stripe, Brex, Ramp and ",
      quote: "60+ other integrations",
      after: " feed one ledger. No exports, no CSVs.",
    },
    against: { kind: "claim", claim: integrationsClaim },
    fix: { replacement: "40+ other integrations" },
    cantFix: false,
    status: "open",
  },
  {
    id: "flag-integrations-x",
    object: { kind: "x", title: "60+ integrations. One ledger. Zero CSVs.", state: "posted 2026-09-26", url: "#" },
    topic: "Integration count",
    raised: "2026-09-26",
    confidence: 0.6,
    says: { before: "", quote: "60+ integrations.", after: " One ledger. Zero CSVs." },
    against: { kind: "claim", claim: integrationsClaim },
    fix: null,
    cantFix: true,
    status: "open",
  },
];

const batch: PitchBatch = {
  number: 2,
  of: 5,
  due: day(8),
  pitches: [
    {
      id: "pitch-approvals",
      title: "Approval chains that don't stall at month end",
      topic: "Approvals",
      collection: "Guides",
      fit: "strong",
      reasons: [
        "Volume: Guides is 2 posts short of this quarter's plan.",
        "Coverage: 3 sales calls this month asked how approvals scale; nothing published answers it.",
        "Ranking: “invoice approval workflow” is one of your 10 target searches.",
      ],
      angle: "Walk a controller through setting approval tiers by amount and vendor, with the month-end failure modes first.",
      outline: ["Where approvals stall today", "Tiers by amount, then by vendor", "What to do when the approver is out", "A checklist for the next close"],
      sources: [{ label: "Sales call with Northwind, 2026-09-22" }, { label: "Knowledge base: Scale caps approvers at 25" }],
      drafted: true,
      publishOn: day(12),
      decision: null,
    },
    {
      id: "pitch-erp",
      title: "When you don't need an ERP yet",
      topic: "Positioning",
      collection: "Opinion",
      fit: "fair",
      reasons: [
        "Coverage: “are we an ERP?” comes up in a third of first calls.",
        "Consistency: two published posts answer it differently; this one settles it.",
      ],
      angle: "An honest line between a finance ledger and a full ERP, and the signs you've outgrown the first.",
      outline: ["What an ERP does that we don't", "The three signs you need one", "What to keep when you switch"],
      sources: [{ label: "Knowledge base: Positioning (4 claims)" }],
      drafted: false,
      publishOn: day(19),
      decision: null,
    },
    {
      id: "pitch-netsuite",
      title: "Moving off NetSuite in two weeks: a field guide",
      topic: "Migration",
      collection: "Guides",
      fit: "weak",
      reasons: ["Ranking: “NetSuite alternative” is a head term a new domain won't win this quarter.", "Volume: counts toward Guides."],
      angle: "The migration checklist our onboarding team uses, step by step.",
      outline: ["Export what matters", "Map the chart of accounts", "Run both for one close"],
      sources: [{ label: "Onboarding runbook (document)" }],
      drafted: false,
      publishOn: day(26),
      decision: null,
    },
  ],
};

const knowledge: KnowledgeItem[] = [
  {
    id: "kb-integrations",
    kind: "conflict",
    title: "Integration count",
    why: "Two claims in the knowledge base disagree. You own Product, so you decide which one stands.",
    a: integrationsClaim,
    b: {
      text: "Ledgerline connects to 60+ tools, counting Zapier connectors.",
      topic: "Product",
      origin: "From the website's integrations page",
      since: "2026-06-02",
      status: "settled",
      evidence: 1,
    },
    choices: ["Keep 42 native", "Keep 60+ with Zapier"],
  },
  {
    id: "kb-close-days",
    kind: "escalation",
    title: "How fast is the close?",
    why: "The Guardian wants to supersede a claim Maya remembered. Only a topic owner can retire it.",
    a: {
      text: "Customers close their books in 3 days on average.",
      topic: "Product",
      origin: "Remembered by Maya Okafor",
      since: "2026-05-14",
      status: "settled",
      evidence: 1,
    },
    b: {
      text: "Customers close their books in 5 days on average; the fastest close in 3.",
      topic: "Product",
      origin: "Proposed from 6 customer stories",
      since: "today",
      status: "settled",
      evidence: 6,
    },
    choices: ["Keep the current claim", "Accept the change"],
  },
];

let state: InboxSnapshot = { flags, batch, knowledge };
const listeners = new Set<() => void>();

function set(next: InboxSnapshot) {
  state = next;
  listeners.forEach((l) => l());
}

function updateFlag(id: string, patch: Partial<Flag> | null) {
  set({
    ...state,
    flags: patch === null ? state.flags.filter((f) => f.id !== id) : state.flags.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
}

function nothingSaved(title: string) {
  toast.add({ type: "success", title, description: "Example data: nothing was saved." });
}

const closeLabels: Record<FlagClose, string> = {
  wont_fix: "Closed as not worth fixing. It still counts against the content grade.",
  retracted: "Closed as taken down. It leaves the grade.",
  noted: "Noted. The checker keeps it in mind for the next one.",
};

export const placeholderInbox: InboxSource = {
  example: true,
  snapshot: () => state,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async applyFix(id) {
    updateFlag(id, null);
    nothingSaved("Fix applied as a suggestion in the editor.");
  },
  async contest(id, argument) {
    updateFlag(id, { status: "contesting" });
    nothingSaved("Sent to the Guardian.");
    // The example Guardian answers a thin argument with a no, like the prototype.
    window.setTimeout(() => {
      const thin = argument.trim().split(/\s+/).length < 12;
      if (thin) {
        updateFlag(id, {
          status: "rejected",
          guardian: {
            verdict: "rejected",
            argument:
              "The post is live and doesn't say when it was written. A reader today would take it as current, so it misleads now. Fix the content, or give a scope or date that makes both true.",
          },
        });
        toast.add({ type: "error", title: "The Guardian rejected it. The flag stays open." });
      } else {
        updateFlag(id, null);
        toast.add({ type: "success", title: "The Guardian admitted it as contested.", description: "The flag is closed; the knowledge base grade takes the hit until someone settles it." });
      }
    }, 2200);
  },
  async closeFlag(id, how) {
    updateFlag(id, null);
    nothingSaved(closeLabels[how]);
  },
  async decidePitch(id, kind, note) {
    if (!state.batch) return;
    set({
      ...state,
      batch: { ...state.batch, pitches: state.batch.pitches.map((p) => (p.id === id ? { ...p, decision: { kind, note } } : p)) },
    });
    nothingSaved(kind === "approved" ? "Approved. The Writer starts on it." : "Rejected. The Pitcher reads why before the next batch.");
  },
  async rule(id) {
    set({ ...state, knowledge: state.knowledge.filter((k) => k.id !== id) });
    nothingSaved("Ruled. The knowledge base changes and affected posts get a re-check.");
  },
};
