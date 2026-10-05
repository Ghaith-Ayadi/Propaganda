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

// ── Objects (every flag is about one) ─────────────────────────────────────

export type ObjectType = "blog" | "newsletter" | "linkedin" | "x";

/** What each type is, and whether it can still be changed once it's out.
 *  "Can't fix" is decided here, per type, never by a person. */
export const objectTypes: Record<ObjectType, { label: string; fixable: boolean; why?: string }> = {
  blog: { label: "Blog post", fixable: true },
  newsletter: { label: "Newsletter", fixable: false, why: "A sent newsletter can't be unsent." },
  linkedin: { label: "LinkedIn post", fixable: true },
  x: { label: "X post", fixable: false, why: "Posts on X can't be edited after an hour." },
};

// Top-level kinds of content, each with its own way of grouping:
// a blog has collections, social has channels (a platform plus a specific
// account), email has threads. Sales enablement comes after 0.2.

export type Kind = "blog" | "social" | "email" | "sales";

export const kindOf = (t: ObjectType): Kind => (t === "blog" ? "blog" : t === "newsletter" ? "email" : "social");

export const collections = [
  { id: "guides", name: "Guides", emoji: "📘" },
  { id: "stories", name: "Customer stories", emoji: "🤝" },
  { id: "product", name: "Product", emoji: "🧾" },
  { id: "opinion", name: "Opinion", emoji: "✍️" },
];

export const channels = [
  { id: "li-co", type: "linkedin" as ObjectType, name: "Ledgerline", handle: "Company page", followers: "4,210" },
  { id: "li-ga", type: "linkedin" as ObjectType, name: "Ghaith Ayadi", handle: "Founder", followers: "2,870" },
  { id: "x-co", type: "x" as ObjectType, name: "@ledgerline", handle: "Company account", followers: "1,130" },
];

export const threads = [
  { id: "close", name: "The Close", desc: "Monthly newsletter for controllers", audience: "1,940 subscribers" },
  { id: "onboarding", name: "Onboarding sequence", desc: "Five emails over a customer's first two weeks", audience: "New customers" },
];

export type PostStatus = "draft" | "published";

export interface ContentObject {
  id: string;
  type: ObjectType;
  /** Collection (blog), channel (social) or thread (email). */
  group: string;
  title: string;
  topic: string;
  date: string;
  url: string;
  status: PostStatus;
  /** The pitch this was written from, if any. */
  briefId?: string;
}

const O = (id: string, type: ObjectType, group: string, title: string, topic: string, date: string, url: string, status: PostStatus = "published"): ContentObject => ({ id, type, group, title, topic, date, url, status });

export const objects: ContentObject[] = [
  O("p1", "blog", "opinion", "The 3-day close is a process problem, not a tooling problem", "close", "2026-09-28", "ledgerline.io/blog/3-day-close"),
  O("p2", "blog", "product", "Pricing that grows with your finance team", "pricing", "2026-09-12", "ledgerline.io/blog/pricing-that-grows"),
  O("p3", "blog", "guides", "What SOC 2 Type II means for your AP data", "controls", "2026-08-30", "ledgerline.io/blog/soc-2-type-ii"),
  O("p4", "blog", "opinion", "Ledgerline vs. a lightweight ERP", "erp", "2026-08-19", "ledgerline.io/blog/vs-lightweight-erp"),
  O("p5", "blog", "product", "60+ integrations, one ledger", "erp", "2026-08-04", "ledgerline.io/blog/integrations"),
  O("p6", "blog", "guides", "Three-way matching without the spreadsheets", "ap", "2026-07-22", "ledgerline.io/blog/three-way-matching"),
  O("p7", "blog", "stories", "How Brightwater closed their books in 5 days", "close", "2026-07-10", "ledgerline.io/blog/brightwater"),
  O("p8", "blog", "guides", "Approval chains that auditors actually like", "controls", "2026-06-25", "ledgerline.io/blog/approval-chains"),
  O("p9", "blog", "opinion", "Why we don't charge per invoice", "pricing", "2026-06-12", "ledgerline.io/blog/per-invoice"),
  O("p10", "newsletter", "close", "The Close, issue 14: audit season", "controls", "2026-09-03", "ledgerline.io/newsletter/14"),
  O("p11", "linkedin", "li-co", "Stripe payouts, reconciled the moment they land", "erp", "2026-09-24", "linkedin.com/posts/ledgerline_stripe"),
  O("p12", "x", "x-co", "60+ integrations. One ledger. Zero CSVs.", "erp", "2026-08-04", "x.com/ledgerline/status/1821"),
  O("p13", "blog", "guides", "Accruals, explained for operators", "close", "2026-04-18", "ledgerline.io/blog/accruals"),
  O("p14", "blog", "opinion", "The hidden cost of manual AP", "ap", "2026-04-03", "ledgerline.io/blog/manual-ap"),
  O("p15", "blog", "guides", "Data residency in the EU", "controls", "2026-03-21", "ledgerline.io/blog/eu-residency"),
  O("p16", "blog", "stories", "From NetSuite to Ledgerline in two weeks", "erp", "2026-03-07", "ledgerline.io/blog/netsuite-migration"),
  O("p17", "blog", "guides", "Approval chains, revisited for Scale", "controls", "2026-10-08", "", "draft"),
  O("p18", "blog", "guides", "The vendor onboarding checklist", "ap", "2026-10-10", "", "draft"),
  O("p19", "linkedin", "li-ga", "What I learned sitting in on 40 month-end closes", "close", "2026-09-30", "linkedin.com/posts/ghaith_40-closes"),
  O("p20", "linkedin", "li-co", "Brightwater: from 11 days to 5", "close", "2026-07-11", "linkedin.com/posts/ledgerline_brightwater"),
  O("p21", "x", "x-co", "Your close slips in the last 48 hours. Here's why.", "close", "2026-10-06", "", "draft"),
  O("p22", "newsletter", "close", "The Close, issue 15: accruals", "close", "2026-10-07", "", "draft"),
  O("p23", "newsletter", "close", "The Close, issue 13: Q3 wrap", "close", "2026-08-05", "ledgerline.io/newsletter/13"),
  O("p24", "newsletter", "onboarding", "Day 1: connect your ERP", "erp", "2026-05-02", "ledgerline.io/email/onboarding-1"),
  O("p25", "newsletter", "onboarding", "Day 3: your first approval chain", "controls", "2026-05-02", "ledgerline.io/email/onboarding-2"),
];

/** Paragraphs for the editor. Pieces without one get a stub built from their title. */
export const bodies: Record<string, string[]> = {
  p2: [
    "Every team starts somewhere. Our Growth plan includes unlimited approvers, so nobody waits on a bottleneck at month end.",
    "As you add entities, Ledgerline grows with you. You don't renegotiate, you don't migrate, and you don't lose history.",
    "Enterprise adds SSO, custom approval rules and a named account manager. Talk to us when you get there.",
  ],
  p1: [
    "Teams on Ledgerline close in 3 days. Here's what the other teams are doing wrong.",
    "It isn't the software. Most teams we meet have perfectly good tools and still take ten days, because the last two days are spent chasing accruals and late bills.",
    "Fix the process first. Then automate the parts that are left.",
  ],
  p3: [
    "Your AP data is sensitive. Ledgerline is SOC 2 Type II certified, and every approval leaves an audit trail.",
    "Here's what that means in practice for the people who sign off on vendors and payments.",
  ],
  p4: [
    "ERPs are built to be the system of record. They are not built to be pleasant to approve an invoice in.",
    "So which should you pick? Think of Ledgerline as a lightweight ERP for growing teams. Everything you need, nothing you don't.",
  ],
  p5: [
    "60+ integrations, one ledger. Connect your ERP, bank and cards in minutes.",
    "NetSuite, Sage Intacct and Xero sync both ways. Everything else arrives through Zapier.",
  ],
  p9: [
    "Per-invoice pricing punishes you for growing. We looked at every model.",
    "We looked at every model. Every plan, from Growth to Enterprise, is priced per seat. You pay for the people who use it, not the invoices they touch.",
  ],
  p15: [
    "We picked one region and stayed there. All customer data stays in Frankfurt. Your auditors will thank you.",
  ],
  p16: [
    "Most migrations die in the chart of accounts. Ours doesn't.",
    "Here's the plan we run with every NetSuite customer, week by week.",
  ],
  p17: [
    "Approval chains got simpler on Scale: up to 25 approvers, any order, any threshold.",
    "This post walks through the three chains auditors like best, and the one they flag every time.",
  ],
};
/** The Content screen still says "posts"; objects are the same list. */
export const posts = objects;
/** Older back-catalogue read on connect; only counted, never listed. */
export const backCatalogue = 32;
export const totalContent = objects.filter((o) => o.status === "published").length + backCatalogue;

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

/** A quote always carries a bit of what came before and after, and a link. */
export interface Excerpt {
  before: string;
  text: string;
  after: string;
  /** Where it is: a heading, a slide, a timestamp. */
  at: string;
  url: string;
}

/** Evidence behind a knowledge base claim, or behind a pitch. */
export interface Evidence extends Excerpt {
  sourceId: string;
}

// ── Knowledge base ──────────────────────────────────────────────────────

export type ClaimStatus = "Settled" | "Contested";

export interface Claim {
  id: string;
  text: string;
  status: ClaimStatus;
  topic: string;
  addedBy: string;
  since: string;
  evidence: Evidence[];
}

export const claims: Claim[] = [
  {
    id: "c1",
    text: "The Growth plan was renamed Scale on 1 September 2026. Scale caps approvers at 25.",
    status: "Settled",
    topic: "pricing",
    addedBy: "Maya Okafor",
    since: "2026-09-30",
    evidence: [
      { sourceId: "s3", at: "Slide 6, Packaging", before: "Tiers for FY27. ", text: "The Growth tier is now called Scale. Approvers are capped at 25 on Scale.", after: " Enterprise keeps unlimited approvers.", url: "drive/pricing-2026#slide=6" },
    ],
  },
  {
    id: "c2",
    text: "Scale and Enterprise are priced per entity. Growth customers on legacy contracts keep per-seat pricing.",
    status: "Settled",
    topic: "pricing",
    addedBy: "Maya Okafor",
    since: "2026-09-30",
    evidence: [
      { sourceId: "s3", at: "Slide 3, Price metric", before: "We're moving off seats. ", text: "Scale and Enterprise are priced per entity, not per seat.", after: " Legacy Growth contracts renew on their current terms.", url: "drive/pricing-2026#slide=3" },
    ],
  },
  {
    id: "c3",
    text: "SOC 2 Type I is complete. Type II is expected in December 2026, when the observation window ends.",
    status: "Settled",
    topic: "controls",
    addedBy: "Lina Haddad",
    since: "2026-09-18",
    evidence: [
      { sourceId: "s5", at: "p. 2, Certifications", before: "Ledgerline is audited annually. ", text: "SOC 2 Type I complete. Type II observation window ends December 2026.", after: " ISO 27001 is not planned for 2026.", url: "drive/security-v4#page=2" },
      { sourceId: "s2", at: "22:40", before: "Haldane: So you're Type II today? Lina: ", text: "Not yet, Type I today, Type II lands in December.", after: " We can share the bridge letter.", url: "calls/haldane-1002#t=1360" },
    ],
  },
  {
    id: "c4",
    text: "Ledgerline has 41 native integrations and 63 in total, counting the ones that run through Zapier.",
    status: "Settled",
    topic: "erp",
    addedBy: "Tomás Reyes",
    since: "2026-10-02",
    evidence: [
      { sourceId: "s4", at: "14:02", before: "Orchard: How many integrations do you have? Tomás: ", text: "About forty native ones; the rest go through Zapier.", after: " NetSuite and Xero are native.", url: "calls/orchard-0929#t=842" },
    ],
  },
  {
    id: "c5",
    text: "Ledgerline is not an ERP. It sits on top of your ERP.",
    status: "Settled",
    topic: "erp",
    addedBy: "Ghaith Ayadi",
    since: "2026-06-01",
    evidence: [
      { sourceId: "s3", at: "Slide 2, Positioning", before: "One line: ", text: "Ledgerline is not an ERP. It sits on top of your ERP.", after: " We never ask a customer to rip anything out.", url: "drive/pricing-2026#slide=2" },
    ],
  },
  {
    id: "c6",
    text: "Customer data is stored in Frankfurt (eu-central-1). Backups are replicated to Dublin (eu-west-1).",
    status: "Settled",
    topic: "controls",
    addedBy: "Lina Haddad",
    since: "2026-09-18",
    evidence: [
      { sourceId: "s5", at: "p. 5, Data residency", before: "Primary storage is Frankfurt. ", text: "Backups are replicated to Dublin (eu-west-1).", after: " No data leaves the EU.", url: "drive/security-v4#page=5" },
    ],
  },
  {
    id: "c7",
    text: "The Stripe sync runs every hour.",
    status: "Settled",
    topic: "erp",
    addedBy: "Tomás Reyes",
    since: "2026-10-02",
    evidence: [
      { sourceId: "s2", at: "22:15", before: "Haldane: Is it live? Tomás: ", text: "The Stripe sync runs every hour, so it's not instant.", after: " Most teams only look at it daily.", url: "calls/haldane-1002#t=1335" },
    ],
  },
  {
    id: "c8",
    text: "A NetSuite migration takes two weeks for a standard chart of accounts.",
    status: "Contested",
    topic: "erp",
    addedBy: "Tomás Reyes",
    since: "2026-09-17",
    evidence: [
      { sourceId: "s6", at: "05:30", before: "Kestrel: We had a custom chart of accounts, so ", text: "the migration took us almost two months.", after: " Support was great though.", url: "calls/kestrel-0916#t=330" },
    ],
  },
  {
    id: "c9",
    text: "Brightwater closes in 4 days as of October 2026, down from 11 before Ledgerline.",
    status: "Settled",
    topic: "close",
    addedBy: "Maya Okafor",
    since: "2026-10-03",
    evidence: [
      { sourceId: "s1", at: "08:40", before: "Brightwater: The case study said five, but ", text: "we're at four days now, sometimes three.", after: " The accruals are the last bit.", url: "calls/brightwater-1003#t=520" },
    ],
  },
];

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
  | "cant-fix"; // acknowledged on an object type that can't be changed

/** A flag contrasts a passage with either a knowledge base claim or another piece of content. */
export type Against =
  | { kind: "kb"; claimId: string }
  | { kind: "content"; objectId: string; excerpt: Excerpt };

export interface Flag {
  id: string;
  objectId: string;
  theme: string;
  excerpt: Excerpt;
  against: Against;
  /** The fix, for types that can be fixed: the flagged text replaced with this. */
  fix?: string;
  confidence: number;
  raised: string;
  status: FlagStatus;
  /** Prebaked so the prototype can show every outcome. */
  guardian: { draft: string; verdict: GuardianVerdict; reason: string };
  rejection?: string;
}

export const flags: Flag[] = [
  {
    id: "f1",
    objectId: "p2",
    theme: "Pricing tiers named two ways",
    excerpt: { at: "Section: Plans at a glance", before: "Every team starts somewhere. ", text: "Our Growth plan includes unlimited approvers,", after: " so nobody waits on a bottleneck at month end.", url: "ledgerline.io/blog/pricing-that-grows#plans" },
    against: { kind: "kb", claimId: "c1" },
    fix: "Our Scale plan includes up to 25 approvers,",
    confidence: 0.92,
    raised: "2026-10-01",
    status: "open",
    guardian: {
      draft: "The post was written before the repackaging. Both were true in their time: Growth (sold until Sep 1) had unlimited approvers; Scale caps them at 25.",
      verdict: "reject",
      reason: "The post is live and doesn't say when it was written. A reader today buys Scale, so the post misleads now. Fix the content.",
    },
  },
  {
    id: "f2",
    objectId: "p9",
    theme: "Pricing tiers named two ways",
    excerpt: { at: "Paragraph 2", before: "We looked at every model. ", text: "Every plan, from Growth to Enterprise, is priced per seat.", after: " You pay for the people who use it, not the invoices they touch.", url: "ledgerline.io/blog/per-invoice#p2" },
    against: { kind: "kb", claimId: "c2" },
    fix: "Scale and Enterprise are priced per entity, not per invoice.",
    confidence: 0.88,
    raised: "2026-10-01",
    status: "open",
    guardian: {
      draft: "Per-seat pricing still applies to legacy Growth customers, and the post speaks to them.",
      verdict: "contested",
      reason: "Plausible but thin: nothing shows the post targets legacy customers. Admitted as contested. It lowers the knowledge base grade until someone confirms who the post is for.",
    },
  },
  {
    id: "f3",
    objectId: "p3",
    theme: "Security claims ahead of the audit",
    excerpt: { at: "Intro", before: "Your AP data is sensitive. ", text: "Ledgerline is SOC 2 Type II certified,", after: " and every approval leaves an audit trail.", url: "ledgerline.io/blog/soc-2-type-ii#intro" },
    against: { kind: "kb", claimId: "c3" },
    fix: "Ledgerline is SOC 2 Type I certified, with Type II expected in December 2026,",
    confidence: 0.97,
    raised: "2026-09-19",
    status: "open",
    guardian: {
      draft: "Type II is in progress and expected in December, so the claim will be true by year end.",
      verdict: "reject",
      reason: "A claim that becomes true later is false today, and security claims carry legal weight. Say Type I, Type II expected December 2026.",
    },
  },
  {
    id: "f4",
    objectId: "p5",
    theme: "Integration count",
    excerpt: { at: "Title and first line", before: "", text: "60+ integrations, one ledger.", after: " Connect your ERP, bank and cards in minutes.", url: "ledgerline.io/blog/integrations" },
    against: { kind: "kb", claimId: "c4" },
    fix: "63 integrations, 41 of them native, one ledger.",
    confidence: 0.74,
    raised: "2026-09-30",
    status: "open",
    guardian: {
      draft: "Both are true at different scopes: 41 native, 63 counting Zapier-backed connectors.",
      verdict: "admit",
      reason: "Sound, and the knowledge base already says 63 in total. Admitted: the next sweep won't raise it again.",
    },
  },
  {
    id: "f5",
    objectId: "p4",
    theme: "Are we an ERP?",
    excerpt: { at: "Conclusion", before: "So which should you pick? ", text: "Think of Ledgerline as a lightweight ERP for growing teams.", after: " Everything you need, nothing you don't.", url: "ledgerline.io/blog/vs-lightweight-erp#conclusion" },
    against: { kind: "kb", claimId: "c5" },
    fix: "Think of Ledgerline as the finance layer on top of your ERP.",
    confidence: 0.9,
    raised: "2026-09-22",
    status: "open",
    guardian: {
      draft: "Sales has pitched us as a lightweight ERP to small companies since August; the positioning has moved.",
      verdict: "escalate",
      reason: "This isn't a reconciliation, it's a change of position. The owner of the topic has to decide it before content can follow.",
    },
  },
  {
    id: "f6",
    objectId: "p1",
    theme: "How fast is the close?",
    excerpt: { at: "Opening line", before: "", text: "Teams on Ledgerline close in 3 days.", after: " Here's what the other teams are doing wrong.", url: "ledgerline.io/blog/3-day-close" },
    against: {
      kind: "content",
      objectId: "p7",
      excerpt: { at: "Results", before: "Six months in, ", text: "Brightwater cut their close from 11 days to 5.", after: " Their controller now leaves on time on day 5.", url: "ledgerline.io/blog/brightwater#results" },
    },
    fix: "Teams on Ledgerline close in as little as 3 days.",
    confidence: 0.81,
    raised: "2026-09-29",
    status: "open",
    guardian: {
      draft: "3 days is the median across customers; Brightwater is one case study, at 5.",
      verdict: "contested",
      reason: "Nothing supports a 3-day median. Admitted as contested until someone attaches the benchmark.",
    },
  },
  {
    id: "f7",
    objectId: "p10",
    theme: "Security claims ahead of the audit",
    excerpt: { at: "Lead story", before: "Audit season is here. ", text: "Good news: Ledgerline is now SOC 2 Type II.", after: " Ask your account manager for the report.", url: "ledgerline.io/newsletter/14#lead" },
    against: { kind: "kb", claimId: "c3" },
    confidence: 0.95,
    raised: "2026-09-19",
    status: "open",
    guardian: {
      draft: "The newsletter meant the audit had started.",
      verdict: "reject",
      reason: "It says 'is now SOC 2 Type II'. That's false whatever was meant.",
    },
  },
  {
    id: "f8",
    objectId: "p15",
    theme: "Security claims ahead of the audit",
    excerpt: { at: "Where your data lives", before: "We picked one region and stayed there. ", text: "All customer data stays in Frankfurt.", after: " Your auditors will thank you.", url: "ledgerline.io/blog/eu-residency#where" },
    against: { kind: "kb", claimId: "c6" },
    fix: "All customer data stays in the EU: Frankfurt, with backups in Dublin.",
    confidence: 0.85,
    raised: "2026-09-19",
    status: "open",
    guardian: {
      draft: "Dublin is still in the EU, which is what the post is about.",
      verdict: "reject",
      reason: "The post names a city, not a region. 'Stays in Frankfurt' is false while backups go to Dublin.",
    },
  },
  {
    id: "f9",
    objectId: "p11",
    theme: "Integration count",
    excerpt: { at: "Post text", before: "Month end shouldn't start with a CSV. ", text: "Stripe payouts, reconciled the moment they land.", after: " Link in comments.", url: "linkedin.com/posts/ledgerline_stripe" },
    against: { kind: "kb", claimId: "c7" },
    fix: "Stripe payouts, reconciled every hour.",
    confidence: 0.77,
    raised: "2026-10-02",
    status: "open",
    guardian: {
      draft: "Hourly is effectively real time for month-end reconciliation.",
      verdict: "reject",
      reason: "'The moment they land' is a specific claim and hourly isn't it.",
    },
  },
  {
    id: "f10",
    objectId: "p12",
    theme: "Integration count",
    excerpt: { at: "Post", before: "", text: "60+ integrations.", after: " One ledger. Zero CSVs.", url: "x.com/ledgerline/status/1821" },
    against: { kind: "kb", claimId: "c4" },
    confidence: 0.6,
    raised: "2026-09-30",
    status: "open",
    guardian: {
      draft: "63 is 60+.",
      verdict: "admit",
      reason: "Correct: 63 in total is more than 60. Admitted.",
    },
  },
  {
    id: "f11",
    objectId: "p16",
    theme: "How fast is the close?",
    excerpt: { at: "Title", before: "", text: "From NetSuite to Ledgerline in two weeks", after: "", url: "ledgerline.io/blog/netsuite-migration" },
    against: { kind: "kb", claimId: "c8" },
    fix: "From NetSuite to Ledgerline in weeks, not months",
    confidence: 0.58,
    raised: "2026-09-17",
    status: "open",
    guardian: {
      draft: "Kestrel had a custom chart of accounts; two weeks is the standard migration.",
      verdict: "contested",
      reason: "Possibly right, but one data point against a marketing claim. Admitted as contested: the knowledge base needs migration numbers.",
    },
  },
  {
    id: "f12",
    objectId: "p6",
    theme: "Integration count",
    excerpt: { at: "How it works", before: "", text: "Three-way matching works with any ERP.", after: "", url: "ledgerline.io/blog/three-way-matching" },
    against: { kind: "kb", claimId: "c4" },
    confidence: 0.83,
    raised: "2026-09-25",
    status: "fixed",
    guardian: { draft: "", verdict: "reject", reason: "" },
  },
];

// ── Pitches: an idea with a reason, written as a full brief ──────────────

export type PitchStatus = "new" | "accepted" | "backlog" | "ditched";

export interface Pitch {
  id: string;
  title: string;
  reason: string;
  topic: string;
  origin: "internal" | "external";
  type: ObjectType;
  /** The brief. */
  angle: string;
  audience: string;
  outline: string[];
  words: [number, number];
  keywords: string[];
  claimIds: string[];
  evidence: Evidence[];
  search?: Array<{ keyword: string; volume: number; difficulty: number; rank: string }>;
  /** What we already have on this, so it isn't a duplicate. */
  related: Array<{ objectId: string; overlap: string }>;
  suggestedOwner: string;
  suggestedDate: string;
  status: PitchStatus;
}

export const pitches: Pitch[] = [
  {
    id: "i1",
    title: "Why your close slips in the last 48 hours",
    reason: "The same objection came up in 3 of the last 6 calls, and nothing we've published answers it.",
    topic: "close",
    origin: "internal",
    type: "blog",
    angle: "The close doesn't slip because of software. It slips because accruals and late vendor bills land in the last two days. Name the two causes, show the fix for each.",
    audience: "Controllers at 50 to 300 person companies who already close in under 10 days and want under 5.",
    outline: [
      "The pattern: fine until day 3, then accruals hell (open with the Brightwater quote, anonymised)",
      "Cause 1: late vendor bills. Why they arrive late, and how to accrue them before they do",
      "Cause 2: manual accruals. The three that can be automated",
      "What changes when both are fixed: Brightwater went from 5 days to 4",
      "Checklist: the last 48 hours, hour by hour",
    ],
    words: [1200, 1600],
    keywords: ["month end close", "accruals", "late vendor bills"],
    claimIds: ["c9"],
    evidence: [
      { sourceId: "s1", at: "08:12", before: "Brightwater: The first three days are fine. ", text: "Everything's fine until the last two days, then it's accruals hell.", after: " We're at four days now, sometimes three.", url: "calls/brightwater-1003#t=492" },
      { sourceId: "s4", at: "21:40", before: "Orchard: Honestly, ", text: "our close slips because of late vendor bills.", after: " Half of them come in after the 3rd.", url: "calls/orchard-0929#t=1300" },
      { sourceId: "s2", at: "11:05", before: "Haldane: We'd hit day four and then ", text: "spend two days chasing accruals in a spreadsheet.", after: " That's the bit we wanted gone.", url: "calls/haldane-1002#t=665" },
    ],
    related: [
      { objectId: "p1", overlap: "Same topic, but argues process over tooling in general; doesn't name the last-48-hours problem." },
      { objectId: "p13", overlap: "Explains accruals, doesn't say why they cause slippage." },
    ],
    suggestedOwner: "Maya Okafor",
    suggestedDate: "2026-10-20",
    status: "new",
  },
  {
    id: "i2",
    title: "SOC 2 Type I vs Type II, in plain words",
    reason: "Prospects keep asking, and the confusion is behind two of our open flags.",
    topic: "controls",
    origin: "internal",
    type: "blog",
    angle: "Be the honest vendor: we're Type I today, Type II in December. Explain what each proves and what an auditor actually needs from a finance tool.",
    audience: "Controllers and auditors evaluating AP tools during audit season.",
    outline: [
      "What Type I proves, what Type II proves",
      "Where Ledgerline is today, and the date for Type II",
      "What your auditor will ask for in the meantime (the bridge letter)",
      "What an audit trail in AP should show",
    ],
    words: [900, 1200],
    keywords: ["soc 2 type 1 vs type 2", "soc 2 ap software"],
    claimIds: ["c3"],
    evidence: [
      { sourceId: "s2", at: "22:30", before: "Haldane: Quick one. ", text: "Is Type I enough for our auditors?", after: " They asked last year.", url: "calls/haldane-1002#t=1350" },
      { sourceId: "s5", at: "p. 2, Certifications", before: "Ledgerline is audited annually. ", text: "SOC 2 Type I complete. Type II observation window ends December 2026.", after: "", url: "drive/security-v4#page=2" },
    ],
    search: [{ keyword: "soc 2 type 1 vs type 2", volume: 2400, difficulty: 34, rank: "not ranking" }],
    related: [{ objectId: "p3", overlap: "Claims Type II today (flagged). This piece would replace it." }],
    suggestedOwner: "Lina Haddad",
    suggestedDate: "2026-10-14",
    status: "new",
  },
  {
    id: "i3",
    title: "Accrual automation: a guide for controllers",
    reason: "880 searches a month at low difficulty, and we don't rank. Month-end close is our top topic and it's under its range.",
    topic: "close",
    origin: "external",
    type: "blog",
    angle: "A practical guide, not a product page: which accruals to automate first, what rules look like, and where a human stays in the loop.",
    audience: "Controllers searching for how to automate month-end accruals.",
    outline: [
      "Which accruals are worth automating (and which never are)",
      "Rules that work: recurring, usage-based, and PO-based accruals",
      "Reversals and true-ups",
      "Where a person signs off",
    ],
    words: [1600, 2200],
    keywords: ["accrual automation", "automate month end accruals"],
    claimIds: [],
    evidence: [],
    search: [
      { keyword: "accrual automation", volume: 880, difficulty: 18, rank: "not ranking" },
      { keyword: "automate month end accruals", volume: 210, difficulty: 9, rank: "not ranking" },
    ],
    related: [{ objectId: "p13", overlap: "Defines accruals; doesn't cover automating them." }],
    suggestedOwner: "Tomás Reyes",
    suggestedDate: "2026-10-27",
    status: "new",
  },
  {
    id: "i4",
    title: "NetSuite AP automation: what's native and what isn't",
    reason: "1,300 searches a month, and ERP integrations is a focus topic.",
    topic: "erp",
    origin: "external",
    type: "blog",
    angle: "An honest map of what NetSuite does natively for AP and where a layer on top helps. Stays true to 'we sit on top of your ERP'.",
    audience: "NetSuite admins and controllers comparing add-ons.",
    outline: [
      "What NetSuite AP does well out of the box",
      "The gaps: approvals, three-way matching, vendor onboarding",
      "How a layer on top fills them without replacing anything",
    ],
    words: [1400, 1800],
    keywords: ["netsuite ap automation"],
    claimIds: ["c4", "c5"],
    evidence: [],
    search: [{ keyword: "netsuite ap automation", volume: 1300, difficulty: 31, rank: "#48" }],
    related: [{ objectId: "p16", overlap: "About migrating off NetSuite, the opposite case." }],
    suggestedOwner: "Tomás Reyes",
    suggestedDate: "2026-11-03",
    status: "new",
  },
];

// ── Drafts waiting on a person ───────────────────────────────────────────

export const reviews = [
  { id: "r1", objectId: "p17", title: "Approval chains, revisited for Scale", topic: "controls", writer: "Agent", words: 1240, suggestions: 6, due: "2026-10-08" },
  { id: "r2", objectId: "p18", title: "The vendor onboarding checklist", topic: "ap", writer: "Maya Okafor", words: 980, suggestions: 2, due: "2026-10-10" },
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
