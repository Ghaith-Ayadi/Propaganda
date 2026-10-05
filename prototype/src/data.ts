// THE dummy data file. Everything the prototype shows comes from here.
// Nothing is wired; edit freely, then throw the whole folder away.
//
// The company is fictional: Ledgerline, a finance-ops SaaS (month-end close,
// AP automation). Today is 2026-10-05, early Q4.

export const TODAY = "2026-10-05";
export const QUARTER = "Q4 2026";

export const me = { name: "Ghaith Ayadi", email: "ghaith@ledgerline.io", initials: "GA" };

export const site = {
  name: "Ledgerline",
  slug: "ledgerline",
  host: "blog.ledgerline.io",
  blogUrl: "https://ledgerline.io/blog",
  destination: "Framer",
};

export const team = [
  { name: "Ghaith Ayadi", email: "ghaith@ledgerline.io", initials: "GA", lastSeen: "now" },
  { name: "Maya Okafor", email: "maya@ledgerline.io", initials: "MO", lastSeen: "2 h ago" },
  { name: "Tomás Reyes", email: "tomas@ledgerline.io", initials: "TR", lastSeen: "yesterday" },
  { name: "Lina Haddad", email: "lina@ledgerline.io", initials: "LH", lastSeen: "Oct 1" },
];
export const pendingInvites = ["sales-lead@ledgerline.io"];

// ── Goals ────────────────────────────────────────────────────────────────

/** Content grade cut-offs: share of current content with no open flag. */
export const gradeCutoffs: Array<[grade: string, min: number]> = [
  ["A", 0.95],
  ["B", 0.85],
  ["C", 0.7],
  ["D", 0.5],
  ["F", 0],
];

export interface Topic {
  id: string;
  name: string;
  importance: 1 | 2 | 3 | 4;
  range: [min: number, max: number];
  published: number;
}

export const topics: Topic[] = [
  { id: "close", name: "Month-end close", importance: 1, range: [4, 6], published: 3 },
  { id: "ap", name: "AP automation", importance: 2, range: [3, 5], published: 4 },
  { id: "controls", name: "Audit & controls", importance: 3, range: [2, 4], published: 1 },
  { id: "erp", name: "ERP integrations", importance: 4, range: [1, 3], published: 2 },
];

export const coverage = {
  internal: { published: 6, opportunities: 23, goal: 10 },
  external: { published: 4, opportunities: 61, goal: 8 },
};

export const performance = {
  mode: "growth" as "growth" | "numbers",
  growthTarget: 0.15,
  metrics: [
    { key: "pageviews", label: "Pageviews", value: 18420, last: 16890, unit: "", spark: [12, 14, 13, 15, 16, 15, 17, 18, 17, 19, 18, 20] },
    { key: "pps", label: "Pages per session", value: 1.8, last: 1.7, unit: "", spark: [1.6, 1.7, 1.6, 1.7, 1.8, 1.7, 1.7, 1.8, 1.9, 1.8, 1.8, 1.8] },
    { key: "tpp", label: "Time per page", value: 142, last: 151, unit: "s", spark: [150, 155, 149, 152, 147, 150, 145, 148, 141, 143, 140, 142] },
  ],
};

// ── Content ──────────────────────────────────────────────────────────────

export interface Post {
  id: string;
  title: string;
  topic: string;
  date: string;
}

const T = (id: string, title: string, topic: string, date: string): Post => ({ id, title, topic, date });

export const posts: Post[] = [
  T("p1", "The 3-day close is a process problem, not a tooling problem", "close", "2026-09-28"),
  T("p2", "Pricing that grows with your finance team", "pricing", "2026-09-12"),
  T("p3", "What SOC 2 Type II means for your AP data", "controls", "2026-08-30"),
  T("p4", "Ledgerline vs. a lightweight ERP", "erp", "2026-08-19"),
  T("p5", "60+ integrations, one ledger", "erp", "2026-08-04"),
  T("p6", "Three-way matching without the spreadsheets", "ap", "2026-07-22"),
  T("p7", "How Brightwater closed their books in 5 days", "close", "2026-07-10"),
  T("p8", "Approval chains that auditors actually like", "controls", "2026-06-25"),
  T("p9", "Why we don't charge per invoice", "pricing", "2026-06-12"),
  T("p10", "A controller's checklist for Q4", "close", "2026-06-01"),
  T("p11", "Vendor onboarding in an afternoon", "ap", "2026-05-20"),
  T("p12", "Reconciling Stripe payouts automatically", "erp", "2026-05-02"),
  T("p13", "Accruals, explained for operators", "close", "2026-04-18"),
  T("p14", "The hidden cost of manual AP", "ap", "2026-04-03"),
  T("p15", "Data residency in the EU", "controls", "2026-03-21"),
  T("p16", "From NetSuite to Ledgerline in two weeks", "erp", "2026-03-07"),
];
/** Older back-catalogue read on connect; only counted, never listed. */
export const backCatalogue = 32;
export const totalContent = posts.length + backCatalogue; // 48

// ── Sources (transcripts and documents) ─────────────────────────────────

export interface Source {
  id: string;
  kind: "call" | "doc";
  title: string;
  date: string;
  insights: number;
}

export const sources: Source[] = [
  { id: "s1", kind: "call", title: "Discovery call, Brightwater Foods", date: "2026-10-03", insights: 7 },
  { id: "s2", kind: "call", title: "Renewal call, Haldane Logistics", date: "2026-10-02", insights: 4 },
  { id: "s3", kind: "doc", title: "Pricing & packaging 2026 (deck)", date: "2026-09-30", insights: 9 },
  { id: "s4", kind: "call", title: "Demo, Orchard Health", date: "2026-09-29", insights: 5 },
  { id: "s5", kind: "doc", title: "Security overview v4", date: "2026-09-18", insights: 6 },
  { id: "s6", kind: "call", title: "Churn interview, Kestrel Studio", date: "2026-09-16", insights: 3 },
];

// ── Consistency flags ────────────────────────────────────────────────────

export type GuardianVerdict = "admit" | "contested" | "reject" | "escalate";

export type FlagStatus =
  | "open"
  | "guardian" // waiting on the Guardian
  | "fixed"
  | "admitted"
  | "contested"
  | "rejected" // back to open, with the Guardian's reason
  | "escalated"
  | "not-worth-fixing"
  | "cant-fix";

export interface Flag {
  id: string;
  postId: string;
  theme: string;
  claim: string;
  conflict: { label: string; quote: string; kind: "call" | "doc" | "kb" | "post" };
  confidence: number;
  raised: string;
  status: FlagStatus;
  /** Prebaked so the prototype can show every outcome. */
  guardian: {
    draft: string;
    verdict: GuardianVerdict;
    reason: string;
  };
  rejection?: string;
}

export const flags: Flag[] = [
  {
    id: "f1",
    postId: "p2",
    theme: "Pricing tiers named two ways",
    claim: "Our Growth plan includes unlimited approvers.",
    conflict: { kind: "doc", label: "Pricing & packaging 2026 (deck), slide 6", quote: "The Growth tier is now called Scale. Approvers are capped at 25 on Scale." },
    confidence: 0.92,
    raised: "2026-10-01",
    status: "open",
    guardian: {
      draft: "The post was written before the Q3 repackaging. Both are true in their time: the Growth plan (sold until Sep 1) had unlimited approvers; Scale caps them at 25.",
      verdict: "reject",
      reason: "The post is live and undated as to plan names. A reader today buys Scale, so the post misleads now. Time scoping doesn't apply to evergreen pricing copy. Fix the content.",
    },
  },
  {
    id: "f2",
    postId: "p9",
    theme: "Pricing tiers named two ways",
    claim: "Every plan, from Growth to Enterprise, is priced per seat.",
    conflict: { kind: "doc", label: "Pricing & packaging 2026 (deck), slide 3", quote: "Scale and Enterprise are priced per entity, not per seat." },
    confidence: 0.88,
    raised: "2026-10-01",
    status: "open",
    guardian: {
      draft: "Per-seat pricing still applies to legacy customers on Growth; the post speaks to them.",
      verdict: "contested",
      reason: "Plausible but thin: no source shows how many legacy customers remain, or that the post targets them. Admitted as contested. It lowers the knowledge base grade until someone confirms the legacy terms.",
    },
  },
  {
    id: "f3",
    postId: "p3",
    theme: "Security claims ahead of the audit",
    claim: "Ledgerline is SOC 2 Type II certified.",
    conflict: { kind: "doc", label: "Security overview v4, p. 2", quote: "SOC 2 Type I complete. Type II observation window ends December 2026." },
    confidence: 0.97,
    raised: "2026-09-19",
    status: "open",
    guardian: {
      draft: "Type II is in progress and expected in December, so the claim will be true by year end.",
      verdict: "reject",
      reason: "A claim that becomes true later is false today. Security claims carry legal weight. Change the post to say Type I, Type II expected December 2026.",
    },
  },
  {
    id: "f4",
    postId: "p5",
    theme: "Integration count",
    claim: "60+ integrations, one ledger.",
    conflict: { kind: "call", label: "Demo, Orchard Health (Sep 29), 14:02", quote: "We have about forty native integrations; the rest go through Zapier." },
    confidence: 0.74,
    raised: "2026-09-30",
    status: "open",
    guardian: {
      draft: "Both are true at different scopes: 41 native integrations, 60+ counting the Zapier-backed connectors listed on the integrations page.",
      verdict: "admit",
      reason: "Sound. The integrations page lists 63 connectors with a 'via Zapier' badge on 22 of them. Admitted: 'native' and 'total' are now distinct terms in the knowledge base.",
    },
  },
  {
    id: "f5",
    postId: "p4",
    theme: "Are we an ERP?",
    claim: "Think of Ledgerline as a lightweight ERP for growing teams.",
    conflict: { kind: "kb", label: "Knowledge base: Positioning", quote: "Ledgerline is not an ERP. It sits on top of your ERP." },
    confidence: 0.9,
    raised: "2026-09-22",
    status: "open",
    guardian: {
      draft: "Sales has been pitching us as a lightweight ERP to sub-50-person companies since August; the positioning has moved.",
      verdict: "escalate",
      reason: "This isn't a reconciliation, it's a change of position. Positioning is canon. Someone has to declare the change before content can follow it.",
    },
  },
  {
    id: "f6",
    postId: "p1",
    theme: "How fast is the close?",
    claim: "Teams on Ledgerline close in 3 days.",
    conflict: { kind: "post", label: "How Brightwater closed their books in 5 days", quote: "Brightwater cut their close from 11 days to 5." },
    confidence: 0.81,
    raised: "2026-09-29",
    status: "open",
    guardian: {
      draft: "3 days is the median across customers; Brightwater is one case study, at 5.",
      verdict: "contested",
      reason: "No source for the 3-day median. Admitted as contested until someone attaches the benchmark data.",
    },
  },
  {
    id: "f7",
    postId: "p7",
    theme: "How fast is the close?",
    claim: "Brightwater cut their close from 11 days to 5.",
    conflict: { kind: "call", label: "Discovery call, Brightwater Foods (Oct 3), 08:40", quote: "We're at four days now, sometimes three." },
    confidence: 0.69,
    raised: "2026-10-03",
    status: "open",
    guardian: {
      draft: "The case study was true when published in July; they've improved since.",
      verdict: "admit",
      reason: "Sound. Case studies are dated by nature. Admitted with a time scope: '5 days (July 2026)'. Consider a follow-up post.",
    },
  },
  {
    id: "f8",
    postId: "p15",
    theme: "Security claims ahead of the audit",
    claim: "All customer data stays in Frankfurt.",
    conflict: { kind: "doc", label: "Security overview v4, p. 5", quote: "Backups are replicated to Dublin (eu-west-1)." },
    confidence: 0.85,
    raised: "2026-09-19",
    status: "open",
    guardian: {
      draft: "Dublin is still in the EU, which is what the post is about.",
      verdict: "reject",
      reason: "The post names a city, not a region. 'Stays in Frankfurt' is false while backups go to Dublin. Fix the wording to 'stays in the EU'.",
    },
  },
  {
    id: "f9",
    postId: "p12",
    theme: "Integration count",
    claim: "Stripe payouts reconcile in real time.",
    conflict: { kind: "call", label: "Renewal call, Haldane Logistics (Oct 2), 22:15", quote: "The Stripe sync runs every hour, so it's not instant." },
    confidence: 0.77,
    raised: "2026-10-02",
    status: "open",
    guardian: {
      draft: "Hourly is effectively real time for month-end reconciliation.",
      verdict: "reject",
      reason: "'Real time' is a specific claim and hourly isn't it. Say 'every hour'.",
    },
  },
  {
    id: "f10",
    postId: "p16",
    theme: "How fast is the close?",
    claim: "Migrate from NetSuite in two weeks.",
    conflict: { kind: "call", label: "Churn interview, Kestrel Studio (Sep 16), 05:30", quote: "The migration took us almost two months." },
    confidence: 0.58,
    raised: "2026-09-17",
    status: "open",
    guardian: {
      draft: "Kestrel had a custom chart of accounts; two weeks is the standard migration.",
      verdict: "contested",
      reason: "Possibly right, but one data point against a marketing claim. Admitted as contested: the knowledge base needs migration benchmarks.",
    },
  },
  {
    id: "f11",
    postId: "p6",
    theme: "Integration count",
    claim: "Three-way matching works with any ERP.",
    conflict: { kind: "kb", label: "Knowledge base: ERP integrations", quote: "Three-way matching is available for NetSuite, Sage Intacct and Xero." },
    confidence: 0.83,
    raised: "2026-09-25",
    status: "fixed",
    guardian: { draft: "", verdict: "reject", reason: "" },
  },
  {
    id: "f12",
    postId: "p10",
    theme: "Security claims ahead of the audit",
    claim: "Ledgerline is SOC 2 Type II certified.",
    conflict: { kind: "doc", label: "Security overview v4, p. 2", quote: "SOC 2 Type I complete." },
    confidence: 0.95,
    raised: "2026-09-19",
    status: "cant-fix",
    guardian: { draft: "", verdict: "reject", reason: "" },
  },
];

// ── Knowledge base (just enough to grade it) ─────────────────────────────

export const kb = {
  entries: 40,
  contested: [
    { id: "k1", claim: "Onboarding takes under a week for most customers.", since: "2026-09-02", why: "Only one call supports it." },
    { id: "k2", claim: "Approvals sync to Slack in both directions.", since: "2026-09-14", why: "The docs say one-way; a demo said two-way." },
  ],
  contradictions: [
    { id: "k3", a: "Support is 24/7 for Enterprise.", b: "Support hours are 7am to 7pm CET, all plans.", since: "2026-09-21" },
  ],
};

// ── Pitches (ideas with a reason) ────────────────────────────────────────

export type PitchStatus = "new" | "accepted" | "backlog" | "ditched";

export interface Pitch {
  id: string;
  title: string;
  reason: string;
  topic: string;
  origin: "internal" | "external";
  evidence: string[];
  status: PitchStatus;
}

export const pitches: Pitch[] = [
  {
    id: "i1",
    title: "Why your close slips in the last 48 hours",
    reason: "Objection in 3 of the last 6 calls; no post answers it.",
    topic: "close",
    origin: "internal",
    evidence: [
      "Brightwater (Oct 3): “Everything's fine until the last two days, then it's accruals hell.”",
      "Orchard Health (Sep 29): “Our close slips because of late vendor bills.”",
    ],
    status: "new",
  },
  {
    id: "i2",
    title: "SOC 2 Type I vs Type II, in plain words",
    reason: "Prospects keep asking; also fixes the confusion behind 2 open flags.",
    topic: "controls",
    origin: "internal",
    evidence: ["Haldane (Oct 2): “Is Type I enough for our auditors?”"],
    status: "new",
  },
  {
    id: "i3",
    title: "Accrual automation: a guide for controllers",
    reason: "880 searches a month, keyword difficulty 18, we rank nowhere.",
    topic: "close",
    origin: "external",
    evidence: ["“accrual automation”: 880/mo, KD 18", "“automate month end accruals”: 210/mo, KD 9"],
    status: "new",
  },
  {
    id: "i4",
    title: "NetSuite AP automation: what's native and what isn't",
    reason: "1.3k searches a month; Audit & controls is under its range.",
    topic: "erp",
    origin: "external",
    evidence: ["“netsuite ap automation”: 1,300/mo, KD 31"],
    status: "new",
  },
];

// ── Drafts waiting on a person ───────────────────────────────────────────

export const reviews = [
  { id: "r1", title: "Approval chains, revisited for Scale", topic: "controls", writer: "Agent", words: 1240, suggestions: 6, due: "2026-10-08" },
  { id: "r2", title: "The vendor onboarding checklist", topic: "ap", writer: "Maya Okafor", words: 980, suggestions: 2, due: "2026-10-10" },
];

// ── Activity (what the agents did) ───────────────────────────────────────

export const activity = [
  { when: "08:12", what: "Swept the Brightwater discovery call", detail: "7 insights, 1 flag, 1 pitch" },
  { when: "Yesterday", what: "Swept the Haldane renewal call", detail: "4 insights, 1 flag, 1 pitch" },
  { when: "Oct 2", what: "The Guardian admitted “41 native integrations”", detail: "Flag closed" },
  { when: "Oct 1", what: "Read the 2026 pricing deck", detail: "9 insights, 2 flags" },
  { when: "Sep 30", what: "Weekly sweep of 48 posts", detail: "3 new flags, 2 confirmed fixed" },
];

/** Vanity counts for the quarter (home only, not goals). */
export const vanity = { raised: 34, ditched: 21, pitched: 9 };

// ── Agent settings ───────────────────────────────────────────────────────

export const autonomy = [
  { stage: "Suggest", desc: "Find ideas and pitch the ones with a reason", level: "auto" },
  { stage: "Flag", desc: "Raise consistency flags against the knowledge base", level: "auto" },
  { stage: "Plan", desc: "Turn accepted pitches into briefs", level: "ask" },
  { stage: "Write", desc: "Draft from a brief", level: "ask" },
  { stage: "Review", desc: "Check drafts for veracity before a person sees them", level: "auto" },
  { stage: "Publish", desc: "Push to Framer", level: "off" },
] as const;

export const usage = { plan: "Team, $100 a month", credits: 30, used: 17.4, renews: "Nov 1" };
