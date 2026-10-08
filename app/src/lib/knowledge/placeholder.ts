// PLACEHOLDER ADAPTER. Sample data for a made-up tenant (Tidewell, scheduling
// software for physiotherapy clinics: the tenant of the Guardian's fixtures),
// held in memory and lost on reload. It behaves like the server will: it pages
// and searches claims itself instead of handing the page everything, takes a
// moment to answer, and simulates the Guardian's rulings with the policy v1
// verdict rules. Nothing here talks to the network or touches a real post.
//
// Delete this file once the draft knowledge base migration is applied and
// `KB_BACKEND` in adapter.ts is "live".

import type { KnowledgeBackend } from "./adapter";
import { changed } from "./hooks";
import {
  letterFor,
  type BulkAction,
  type CheckLine,
  type ClaimDetail,
  type ClaimStatus,
  type ClaimSummary,
  type ContestAxis,
  type ContestState,
  type Decision,
  type Evidence,
  type FixPreview,
  type FlagDetail,
  type FlagKind,
  type FlagStatus,
  type FlagSummary,
  type Grades,
  type PendingProposal,
  type Person,
  type RecheckThread,
  type Reliance,
  type Severity,
  type Source,
  type SuggestedAction,
  type Topic,
} from "./types";

// ---- the sample tenant ----

const pid = (prefix: string, n: number) => (prefix + String(n).padStart(15 - prefix.length, "0")).slice(0, 15);

const people: Record<string, Person> = {
  maya: { id: pid("pe", 1), name: "Maya Okafor" },
  sam: { id: pid("pe", 2), name: "Sam Reyes" },
  lina: { id: pid("pe", 3), name: "Lina Haddad" },
  joel: { id: pid("pe", 4), name: "Joel Park" },
  you: { id: pid("pe", 5), name: "You" },
};

const topics: Topic[] = [
  { id: pid("to", 1), name: "Product", parent: null },
  { id: pid("to", 2), name: "Integrations", parent: pid("to", 1) },
  { id: pid("to", 3), name: "Onboarding", parent: null },
  { id: pid("to", 4), name: "Data privacy", parent: null },
  { id: pid("to", 5), name: "Company", parent: null },
  { id: pid("to", 6), name: "Clinic operations", parent: null },
  { id: pid("to", 7), name: "Support", parent: null },
];
const T = Object.fromEntries(topics.map((t) => [t.name, t.id])) as Record<string, string>;

const owners: Record<string, Person[]> = {
  [T.Product]: [people.maya],
  [T.Integrations]: [people.lina],
  [T["Data privacy"]]: [people.sam],
};
const TOP_AUTHORITY = people.sam;

interface S {
  id: string;
  kind: Source["kind"];
  tier: Source["tier"];
  title: string;
  uri: string;
  occurred: string | null;
  person: Person | null;
  body: string;
}

const sources: S[] = [
  {
    id: pid("so", 1),
    kind: "document",
    tier: 2,
    title: "Security and data handling overview (signed), 2026-08",
    uri: "https://example.com/tidewell/security-overview.pdf",
    occurred: "2026-08-14",
    person: people.sam,
    body:
      "Section 3, Hosting. Tidewell runs on a single cloud provider. All patient data is stored in the EU (Frankfurt region) and never leaves it, including backups. Support staff can view a clinic's data only after the clinic grants access from Settings. Section 4, Retention. A clinic's data is deleted 90 days after it cancels, unless it asks for an export first.",
  },
  {
    id: pid("so", 2),
    kind: "call",
    tier: 3,
    title: "Onboarding review with the success team, 2026-09-03",
    uri: "https://example.com/tidewell/calls/onboarding-review",
    occurred: "2026-09-03",
    person: null,
    body:
      "So where are we on time to live? Honestly it hasn't moved much. Onboarding a new clinic takes about a week, most of it waiting on their old system's export. The fastest we've done is three days, but that was a single-practitioner clinic with clean data. We should stop promising days in sales calls.",
  },
  {
    id: pid("so", 3),
    kind: "slack",
    tier: 2,
    title: "#product, thread on the patient app, 2026-09-22",
    uri: "https://example.slack.com/archives/C01/p1727000000",
    occurred: "2026-09-22",
    person: people.maya,
    body:
      "Okay, decision time. After the clinic council we're reversing the call from last year: Tidewell is building a patient app, launching in 2027. Booking and reminders first, exercises later. I'll update the roadmap doc today. Old posts that say we won't build one need a look.",
  },
  {
    id: pid("so", 4),
    kind: "document",
    tier: 3,
    title: "Integrations catalogue, September 2026",
    uri: "https://example.com/tidewell/integrations",
    occurred: "2026-09-01",
    person: people.lina,
    body:
      "As of September 2026 Tidewell has about 30 integrations. Practice management: Cliniko, Nookal. Payments: Stripe, Tyro. Accounting: Xero, MYOB. Messaging: Twilio. The integration with Nookal shipped in August 2026 after six months in beta.",
  },
  {
    id: pid("so", 5),
    kind: "person",
    tier: 1,
    title: "Remembered by Joel Park",
    uri: "",
    occurred: "2026-09-29",
    person: people.joel,
    body: "Tidewell has no limit on practitioners per clinic.",
  },
  {
    id: pid("so", 6),
    kind: "document",
    tier: 2,
    title: "Plans and limits, internal wiki",
    uri: "https://example.com/tidewell/wiki/limits",
    occurred: "2026-06-10",
    person: people.maya,
    body:
      "Limits. Tidewell supports up to 40 practitioners per clinic. Larger groups run several clinics under one organisation. Calendars sync every five minutes.",
  },
  {
    id: pid("so", 7),
    kind: "post",
    tier: 5,
    title: "Why we're not building a patient app (post, version 3)",
    uri: "",
    occurred: "2025-11-04",
    person: null,
    body:
      "Every few months someone asks when the app is coming. Tidewell will not build a patient app. Clinics already have booking pages their patients know, and a second app is one more password.",
  },
  {
    id: pid("so", 8),
    kind: "document",
    tier: 2,
    title: "Support handbook, October 2026",
    uri: "https://example.com/tidewell/support-handbook",
    occurred: "2026-10-01",
    person: people.sam,
    body:
      "Hours. From October, support is available 7am to 7pm AEST on weekdays. Weekend coverage stays email only, answered on Monday.",
  },
  {
    id: pid("so", 9),
    kind: "chat",
    tier: 4,
    title: "Chat with the agent, 2026-09-18",
    uri: "",
    occurred: "2026-09-18",
    person: people.joel,
    body:
      "We picked physiotherapy first because the founders ran a clinic for eight years. Tidewell is built for clinics with 2 to 40 practitioners.",
  },
];
const src = (n: number) => sources[n - 1];

interface C {
  id: string;
  text: string;
  status: ClaimStatus;
  topics: string[];
  validFrom?: string;
  validUntil?: string;
  reviewAfter?: string;
  scope?: Record<string, string>;
  rationale?: string;
  rememberedBy?: Person;
  created: string;
  retired?: string;
  admittedBy?: string;
  retiredBy?: string;
  supersedes?: string;
}

// The bulk of a ~200-claim knowledge base is quiet settled facts like these.
const quiet: [string, string, string][] = [
  ["Tidewell is scheduling software for physiotherapy clinics.", "Product", "2026-07-02"],
  ["Tidewell integrates with Cliniko.", "Integrations", "2026-07-02"],
  ["Tidewell integrates with Stripe for card payments.", "Integrations", "2026-07-02"],
  ["Tidewell integrates with Tyro terminals.", "Integrations", "2026-07-03"],
  ["Tidewell integrates with Xero.", "Integrations", "2026-07-03"],
  ["Tidewell integrates with MYOB.", "Integrations", "2026-07-03"],
  ["Appointment reminders are sent by SMS through Twilio.", "Integrations", "2026-07-04"],
  ["Calendars sync every five minutes.", "Product", "2026-07-04"],
  ["Larger groups run several clinics under one organisation.", "Product", "2026-07-05"],
  ["A clinic's data is deleted 90 days after it cancels, unless it asks for an export first.", "Data privacy", "2026-07-05"],
  ["Support staff can view a clinic's data only after the clinic grants access.", "Data privacy", "2026-07-05"],
  ["Tidewell was founded in Melbourne in 2021.", "Company", "2026-07-06"],
  ["Tidewell picked physiotherapy first because its founders ran a clinic for eight years.", "Company", "2026-07-06"],
  ["Most of onboarding time is spent waiting on the old system's data export.", "Onboarding", "2026-07-07"],
  ["Each clinic gets a named onboarding specialist.", "Onboarding", "2026-07-07"],
  ["Clinics can import patients from a CSV file.", "Onboarding", "2026-07-08"],
  ["Waitlists fill cancelled slots automatically.", "Clinic operations", "2026-07-08"],
  ["Practitioners can block time for notes between appointments.", "Clinic operations", "2026-07-09"],
  ["Group classes and one-to-one appointments share the same calendar.", "Clinic operations", "2026-07-09"],
  ["Weekend support is email only, answered on Monday.", "Support", "2026-07-10"],
  ["Tidewell runs on a single cloud provider.", "Data privacy", "2026-07-10"],
  ["Tidewell does not sell or share patient data with third parties.", "Data privacy", "2026-07-11"],
  ["No-show fees can be charged automatically to a card on file.", "Clinic operations", "2026-07-11"],
  ["Tidewell's mobile site works for practitioners on a phone.", "Product", "2026-07-12"],
];

let claims: C[] = [
  ...quiet.map(([text, topic, created], i) => ({
    id: pid("cq", i + 1),
    text,
    status: "settled" as const,
    topics: [T[topic]],
    created,
    admittedBy: pid("de", 1),
  })),
  {
    id: pid("cl", 1),
    text: "All patient data is stored in the EU (Frankfurt region), including backups.",
    status: "settled",
    topics: [T["Data privacy"]],
    created: "2026-08-15",
    validFrom: "2026-08-14",
    admittedBy: pid("de", 2),
  },
  {
    id: pid("cl", 2),
    text: "Onboarding a new clinic takes about a week.",
    status: "settled",
    topics: [T.Onboarding],
    created: "2026-09-04",
    validFrom: "2026-09-03",
    reviewAfter: "2027-03-01",
    admittedBy: pid("de", 3),
  },
  {
    id: pid("cl", 3),
    text: "Tidewell will not build a patient app.",
    status: "superseded",
    topics: [T.Product],
    created: "2025-11-05",
    retired: "2026-09-23",
    rationale: "Clinics already have booking pages their patients know, and a second app is one more password.",
    admittedBy: pid("de", 4),
    retiredBy: pid("de", 5),
  },
  {
    id: pid("cl", 4),
    text: "Tidewell is building a patient app, launching in 2027.",
    status: "settled",
    topics: [T.Product],
    created: "2026-09-23",
    validFrom: "2026-09-22",
    rationale: "The clinic council asked for booking and reminders in one place; booking ships first, exercises later.",
    admittedBy: pid("de", 5),
    supersedes: pid("cl", 3),
  },
  {
    id: pid("cl", 5),
    text: "Tidewell has about 30 integrations.",
    status: "settled",
    topics: [T.Integrations],
    created: "2026-09-02",
    validFrom: "2026-09-01",
    scope: { as_of: "2026-09" },
    admittedBy: pid("de", 6),
  },
  {
    id: pid("cl", 6),
    text: "Tidewell integrates with Nookal.",
    status: "settled",
    topics: [T.Integrations],
    created: "2026-09-02",
    validFrom: "2026-08-01",
    admittedBy: pid("de", 6),
  },
  {
    id: pid("cl", 7),
    text: "Tidewell supports up to 40 practitioners per clinic.",
    status: "settled",
    topics: [T.Product],
    created: "2026-06-11",
    admittedBy: pid("de", 7),
  },
  {
    id: pid("cl", 8),
    text: "Tidewell has no limit on practitioners per clinic.",
    status: "settled",
    topics: [T.Product],
    created: "2026-09-29",
    rememberedBy: people.joel,
    admittedBy: pid("de", 8),
  },
  {
    id: pid("cl", 9),
    text: "Tidewell is built for clinics with 2 to 40 practitioners.",
    status: "contested",
    topics: [T.Company],
    created: "2026-09-18",
    admittedBy: pid("de", 9),
  },
  {
    id: pid("cl", 10),
    text: "Support is available 8am to 6pm AEST on weekdays.",
    status: "superseded",
    topics: [T.Support],
    created: "2026-07-10",
    retired: "2026-10-02",
    admittedBy: pid("de", 1),
    retiredBy: pid("de", 10),
  },
  {
    id: pid("cl", 11),
    text: "Support is available 7am to 7pm AEST on weekdays.",
    status: "settled",
    topics: [T.Support],
    created: "2026-10-02",
    validFrom: "2026-10-01",
    admittedBy: pid("de", 10),
    supersedes: pid("cl", 10),
  },
  {
    id: pid("cl", 12),
    text: "Tidewell offers a free 14-day trial.",
    status: "retracted",
    topics: [T.Product],
    created: "2026-07-12",
    retired: "2026-09-01",
    admittedBy: pid("de", 1),
    retiredBy: pid("de", 11),
  },
  {
    id: pid("cl", 13),
    text: "Most clinics on Tidewell have fewer than ten practitioners.",
    status: "contested",
    topics: [T.Company],
    created: "2026-09-25",
    admittedBy: pid("de", 12),
  },
];

let relationships: { id: string; from: string; to: string; kind: "supersedes" | "contradicts" | "refines" | "depends_on" }[] = [
  { id: pid("re", 1), from: pid("cl", 4), to: pid("cl", 3), kind: "supersedes" },
  { id: pid("re", 2), from: pid("cl", 11), to: pid("cl", 10), kind: "supersedes" },
  { id: pid("re", 3), from: pid("cl", 8), to: pid("cl", 7), kind: "contradicts" },
  { id: pid("re", 4), from: pid("cl", 6), to: pid("cl", 5), kind: "refines" },
  { id: pid("re", 5), from: pid("cl", 9), to: pid("cl", 7), kind: "depends_on" },
];

let evidence: { id: string; claim: string; source: string; quote: string; stance: "supports" | "contradicts" }[] = [
  { id: pid("ev", 1), claim: pid("cl", 1), source: src(1).id, quote: "All patient data is stored in the EU (Frankfurt region) and never leaves it, including backups.", stance: "supports" },
  { id: pid("ev", 2), claim: pid("cl", 2), source: src(2).id, quote: "Onboarding a new clinic takes about a week", stance: "supports" },
  { id: pid("ev", 3), claim: pid("cl", 3), source: src(7).id, quote: "Tidewell will not build a patient app.", stance: "supports" },
  { id: pid("ev", 4), claim: pid("cl", 4), source: src(3).id, quote: "Tidewell is building a patient app, launching in 2027.", stance: "supports" },
  { id: pid("ev", 5), claim: pid("cl", 5), source: src(4).id, quote: "As of September 2026 Tidewell has about 30 integrations.", stance: "supports" },
  { id: pid("ev", 6), claim: pid("cl", 6), source: src(4).id, quote: "The integration with Nookal shipped in August 2026", stance: "supports" },
  { id: pid("ev", 7), claim: pid("cl", 7), source: src(6).id, quote: "Tidewell supports up to 40 practitioners per clinic.", stance: "supports" },
  { id: pid("ev", 8), claim: pid("cl", 8), source: src(5).id, quote: "Tidewell has no limit on practitioners per clinic.", stance: "supports" },
  { id: pid("ev", 9), claim: pid("cl", 9), source: src(9).id, quote: "Tidewell is built for clinics with 2 to 40 practitioners.", stance: "supports" },
  { id: pid("ev", 10), claim: pid("cl", 11), source: src(8).id, quote: "support is available 7am to 7pm AEST on weekdays", stance: "supports" },
  { id: pid("ev", 11), claim: pid("cl", 2), source: src(2).id, quote: "The fastest we've done is three days", stance: "supports" },
  { id: pid("ev", 12), claim: pid("cq", 13), source: src(9).id, quote: "We picked physiotherapy first because the founders ran a clinic for eight years.", stance: "supports" },
  { id: pid("ev", 13), claim: pid("cq", 10), source: src(1).id, quote: "A clinic's data is deleted 90 days after it cancels, unless it asks for an export first.", stance: "supports" },
];

interface P {
  id: string;
  title: string;
  version: number;
  published: boolean;
}
const posts: P[] = [
  { id: pid("po", 1), title: "Getting a clinic live in three days", version: 4, published: true },
  { id: pid("po", 2), title: "Your patients' data never leaves the EU", version: 2, published: true },
  { id: pid("po", 3), title: "Why we're not building a patient app", version: 3, published: true },
  { id: pid("po", 4), title: "Ten integrations every clinic needs", version: 5, published: true },
  { id: pid("po", 5), title: "Tidewell for multi-site physio groups", version: 2, published: true },
  { id: pid("po", 6), title: "What our clinic council asked for in 2026", version: 1, published: true },
  { id: pid("po", 7), title: "Booking pages your patients already know", version: 2, published: true },
  { id: pid("po", 8), title: "Switching from paper diaries, a checklist", version: 3, published: true },
  { id: pid("po", 9), title: "How we answer support tickets", version: 2, published: true },
  { id: pid("po", 10), title: "Reminders that cut no-shows in half", version: 1, published: true },
  { id: pid("po", 11), title: "Cliniko and Tidewell, side by side", version: 2, published: true },
];
/** The tenant's other published posts: no flags, counted in the content grade. */
const QUIET_PUBLISHED = 72;
const post = (n: number) => posts[n - 1];

const postClaims: { post: string; claim: string; reliance: Reliance; quote: string }[] = [
  { post: post(1).id, claim: pid("cl", 2), reliance: "asserts", quote: "Most clinics are live in three days." },
  { post: post(8).id, claim: pid("cl", 2), reliance: "assumes", quote: "Plan for your first week on Tidewell to overlap with the old diary." },
  { post: post(2).id, claim: pid("cl", 1), reliance: "asserts", quote: "We store data in Frankfurt and Singapore." },
  { post: post(3).id, claim: pid("cl", 3), reliance: "asserts", quote: "Tidewell will not build a patient app." },
  { post: post(7).id, claim: pid("cl", 3), reliance: "asserts", quote: "That's why there's no Tidewell app for patients to download." },
  { post: post(6).id, claim: pid("cl", 3), reliance: "mentions", quote: "Last year we said no to a patient app." },
  { post: post(10).id, claim: pid("cl", 3), reliance: "assumes", quote: "Reminders go by SMS, since patients don't install anything." },
  { post: post(6).id, claim: pid("cl", 4), reliance: "asserts", quote: "the council asked for booking and reminders in one place" },
  { post: post(4).id, claim: pid("cl", 5), reliance: "asserts", quote: "Tidewell integrates with 60+ tools." },
  { post: post(11).id, claim: pid("cl", 6), reliance: "mentions", quote: "and if you're on Nookal, that works too" },
  { post: post(5).id, claim: pid("cl", 7), reliance: "asserts", quote: "Each clinic in your group can have up to 40 practitioners." },
  { post: post(5).id, claim: pid("cl", 9), reliance: "assumes", quote: "built for growing clinics" },
  { post: post(9).id, claim: pid("cl", 10), reliance: "asserts", quote: "We answer the phone from 8am to 6pm AEST." },
  { post: post(8).id, claim: pid("cl", 10), reliance: "mentions", quote: "call us during business hours" },
  { post: post(11).id, claim: pid("cq", 2), reliance: "asserts", quote: "Tidewell integrates with Cliniko" },
  { post: post(10).id, claim: pid("cq", 7), reliance: "asserts", quote: "SMS reminders through Twilio" },
  { post: post(2).id, claim: pid("cq", 22), reliance: "asserts", quote: "We never sell patient data." },
  { post: post(7).id, claim: pid("cl", 13), reliance: "assumes", quote: "most clinics we work with are small" },
  { post: post(5).id, claim: pid("cl", 13), reliance: "mentions", quote: "most clinics are small, but some aren't" },
];

const guardian = (policyVersion = 1) => ({ kind: "guardian" as const, agent: "guardian", policyVersion });
const decisions: Record<string, Decision> = {
  [pid("de", 1)]: { id: pid("de", 1), verdict: "admit", argument: "First sweep: drawn from published posts, nothing contradicts it. Admitted settled.", checks: [{ check: "C4", result: "pass", reason: "Quoted in the post." }, { check: "C8", result: "pass", reason: "No live claim contradicts it." }], severity: "", decidedBy: guardian(), created: "2026-07-02T09:00:00Z" },
  [pid("de", 2)]: { id: pid("de", 2), verdict: "admit", argument: "Signed overview, quoted exactly. Dated from the document.", checks: [{ check: "C4", result: "pass", reason: "Section 3 says it." }, { check: "C5", result: "pass", reason: "Region matches." }, { check: "C6", result: "pass", reason: "Dated 2026-08-14." }], severity: "", decidedBy: guardian(), created: "2026-08-15T10:00:00Z" },
  [pid("de", 3)]: { id: pid("de", 3), verdict: "admit", argument: "The call states it plainly; \"about a week\" kept as said.", checks: [{ check: "C4", result: "pass", reason: "Quoted from the call." }, { check: "C5", result: "pass", reason: "\"About a week\" kept, not rounded." }, { check: "C6", result: "pass", reason: "Dated from the call." }], severity: "", decidedBy: guardian(), created: "2026-09-04T08:00:00Z" },
  [pid("de", 4)]: { id: pid("de", 4), verdict: "admit", argument: "First sweep: the post says it, nothing contradicts it.", checks: [{ check: "C3", result: "pass", reason: "A decision with its reason, not a style rule." }], severity: "", decidedBy: guardian(), created: "2025-11-05T09:00:00Z" },
  [pid("de", 5)]: { id: pid("de", 5), verdict: "admit", argument: "A change of position, ruled by the owner of Product. Major: the meaning reversed, so every post relying on the old claim gets a re-check.", checks: [{ check: "C8", result: "escalate", reason: "Contradicts a settled claim; the source is newer and tier 2." }, { check: "C11", result: "pass", reason: "Major: the meaning reversed." }], severity: "major", decidedBy: { kind: "person", person: people.maya }, created: "2026-09-23T07:30:00Z" },
  [pid("de", 6)]: { id: pid("de", 6), verdict: "admit", argument: "From the integrations catalogue; the count keeps \"about\" and its date.", checks: [{ check: "C5", result: "pass", reason: "\"About 30\" as written." }, { check: "C6", result: "pass", reason: "As of September 2026." }], severity: "", decidedBy: guardian(), created: "2026-09-02T09:00:00Z" },
  [pid("de", 7)]: { id: pid("de", 7), verdict: "admit", argument: "From the internal wiki, owned by Product.", checks: [{ check: "C4", result: "pass", reason: "Quoted from the wiki." }], severity: "", decidedBy: guardian(), created: "2026-06-11T09:00:00Z" },
  [pid("de", 8)]: { id: pid("de", 8), verdict: "admit", argument: "A Remember goes in. It contradicts \"up to 40 practitioners per clinic\", so the owner of Product has a flag to settle it.", checks: [{ check: "C8", result: "pass", reason: "Contradicts a settled claim; a Remember, so related, not rejected." }], severity: "", decidedBy: guardian(), created: "2026-09-29T11:00:00Z" },
  [pid("de", 9)]: { id: pid("de", 9), verdict: "admit_contested", argument: "Only a chat line backs it. Admitted as contested until a document or the owner confirms the range.", checks: [{ check: "C4", result: "weak", reason: "Tier 4: a chat line." }, { check: "C6", result: "weak", reason: "No date on a fact that can change." }], severity: "", decidedBy: guardian(), created: "2026-09-18T12:00:00Z" },
  [pid("de", 10)]: { id: pid("de", 10), verdict: "admit", argument: "The support handbook moves the hours from October. Minor: same fact, new dates, so re-checks are advisory.", checks: [{ check: "C8", result: "escalate", reason: "Newer tier 2 source." }, { check: "C11", result: "pass", reason: "Minor: new hours, same meaning." }], severity: "minor", decidedBy: { kind: "person", person: people.sam }, created: "2026-10-02T06:00:00Z" },
  [pid("de", 11)]: { id: pid("de", 11), verdict: "admit", argument: "The trial ended with the September plans. Retracted; nothing relies on it.", checks: [{ check: "C11", result: "pass", reason: "Major: retracted." }], severity: "major", decidedBy: { kind: "person", person: people.maya }, created: "2026-09-01T08:00:00Z" },
  [pid("de", 12)]: { id: pid("de", 12), verdict: "admit_contested", argument: "A push back on a flag; the only evidence is the flagged post. Admitted as contested until a real count backs it.", checks: [{ check: "C9", result: "weak", reason: "Names scope, rests only on the post." }, { check: "C10", result: "weak", reason: "The post is the only evidence for the claim that excuses it." }], severity: "", decidedBy: guardian(), created: "2026-09-25T15:00:00Z" },
};

interface F {
  id: string;
  kind: FlagKind;
  status: FlagStatus;
  post: string | null;
  claim: string;
  otherClaim?: string;
  headline: string;
  passage: { before: string; quote: string; after: string; section: string };
  explanation: string;
  suggestedAction: SuggestedAction;
  fix: FixPreview | null;
  confidence: number | null;
  created: string;
  batch: string | null;
  note: string;
  snoozedUntil: string | null;
  contest: ContestState | null;
  tldr: string;
}

const flags: F[] = [
  {
    id: pid("fl", 1),
    kind: "contradiction",
    status: "open",
    post: post(1).id,
    claim: pid("cl", 2),
    headline: "Time to go live",
    passage: { before: "Switching is less work than you think. ", quote: "Most clinics are live in three days.", after: " We move your patients, your diary and your templates.", section: "Intro" },
    explanation: "The post promises three days; onboarding takes about a week. Three days was the fastest case, a one-practitioner clinic.",
    suggestedAction: "edit_wording",
    fix: { before: "Switching is less work than you think. ", removed: "Most clinics are live in three days.", added: "Most clinics are live within a week, and small ones in as little as three days.", after: " We move your patients, your diary and your templates.", section: "Intro" },
    confidence: 0.94,
    created: "2026-10-05T08:12:00Z",
    batch: null,
    note: "",
    snoozedUntil: null,
    contest: null,
    tldr: "",
  },
  {
    id: pid("fl", 2),
    kind: "contradiction",
    status: "open",
    post: post(2).id,
    claim: pid("cl", 1),
    headline: "Where patient data is stored",
    passage: { before: "Your patients trust you with their health records. ", quote: "We store data in Frankfurt and Singapore.", after: " Both regions are certified and encrypted at rest.", section: "Where your data lives" },
    explanation: "The post names Singapore; the signed security overview says all patient data stays in the EU, backups included.",
    suggestedAction: "edit_wording",
    fix: { before: "Your patients trust you with their health records. ", removed: "We store data in Frankfurt and Singapore.", added: "All patient data is stored in the EU, in Frankfurt, backups included.", after: " Both regions are certified and encrypted at rest.", section: "Where your data lives" },
    confidence: 0.97,
    created: "2026-10-04T16:40:00Z",
    batch: null,
    note: "",
    snoozedUntil: null,
    contest: null,
    tldr: "",
  },
  {
    id: pid("fl", 3),
    kind: "contradiction",
    status: "open",
    post: post(4).id,
    claim: pid("cl", 5),
    headline: "Integration count",
    passage: { before: "One login for the whole clinic. ", quote: "Tidewell integrates with 60+ tools.", after: " Here are the ten we see most.", section: "Opening" },
    explanation: "The post says 60+; the integrations catalogue counts about 30 as of September 2026.",
    suggestedAction: "edit_wording",
    fix: { before: "One login for the whole clinic. ", removed: "Tidewell integrates with 60+ tools.", added: "Tidewell integrates with about 30 tools.", after: " Here are the ten we see most.", section: "Opening" },
    confidence: 0.88,
    created: "2026-10-03T10:05:00Z",
    batch: null,
    note: "",
    snoozedUntil: null,
    contest: null,
    tldr: "",
  },
  {
    id: pid("fl", 4),
    kind: "kb_conflict",
    status: "open",
    post: null,
    claim: pid("cl", 8),
    otherClaim: pid("cl", 7),
    headline: "Practitioners per clinic",
    passage: { before: "", quote: "Tidewell has no limit on practitioners per clinic.", after: "", section: "" },
    explanation: "A Remember says there's no limit; the wiki says up to 40. Both are in the knowledge base until the owner of Product settles it.",
    suggestedAction: "",
    fix: null,
    confidence: null,
    created: "2026-09-29T11:00:00Z",
    batch: null,
    note: "",
    snoozedUntil: null,
    contest: null,
    tldr: "",
  },
  {
    id: pid("fl", 5),
    kind: "contradiction",
    status: "snoozed",
    post: post(5).id,
    claim: pid("cl", 7),
    headline: "Practitioners per clinic",
    passage: { before: "Run every site from one account. ", quote: "Each clinic in your group can have up to 40 practitioners.", after: " Need more? Split it into two clinics.", section: "Limits" },
    explanation: "Relies on the 40-practitioner limit, which a newer Remember contradicts. Waiting on the owner of Product.",
    suggestedAction: "leave",
    fix: null,
    confidence: 0.71,
    created: "2026-09-30T09:00:00Z",
    batch: null,
    note: "Until Maya settles the limit.",
    snoozedUntil: "2026-10-14",
    contest: null,
    tldr: "",
  },
  {
    id: pid("fl", 6),
    kind: "contradiction",
    status: "reconciled",
    post: post(11).id,
    claim: pid("cl", 5),
    headline: "Nookal support",
    passage: { before: "", quote: "and if you're on Nookal, that works too", after: "", section: "Practice management" },
    explanation: "The knowledge base only listed Cliniko.",
    suggestedAction: "",
    fix: null,
    confidence: 0.8,
    created: "2026-09-01T09:00:00Z",
    batch: null,
    note: "",
    snoozedUntil: null,
    contest: {
      proposalId: pid("pr", 1),
      status: "admitted",
      reason: "Nookal shipped in August, it's in the integrations catalogue.",
      axis: "time",
      changes: [{ op: "add", text: "Tidewell integrates with Nookal." }],
      decision: { id: pid("de", 6), verdict: "admit", argument: "Not a contradiction: the knowledge base was incomplete. The catalogue backs it.", checks: [{ check: "C8", result: "pass", reason: "Adds to, doesn't contradict." }, { check: "C9", result: "pass", reason: "Time, with a tier 3 source." }], severity: "", decidedBy: guardian(), created: "2026-09-02T09:00:00Z" },
    },
    tldr: "",
  },
  {
    id: pid("fl", 7),
    kind: "contradiction",
    status: "wont_fix",
    post: post(7).id,
    claim: pid("cl", 13),
    headline: "Clinic size",
    passage: { before: "", quote: "most clinics we work with are small", after: "", section: "Who it's for" },
    explanation: "Rests on a contested claim.",
    suggestedAction: "",
    fix: null,
    confidence: 0.6,
    created: "2026-09-26T09:00:00Z",
    batch: null,
    note: "Old post, not worth a rewrite.",
    snoozedUntil: null,
    contest: null,
    tldr: "",
  },
  // The re-check thread after the patient-app reversal (decision de5, major).
  ...[
    { n: 3, status: "open" as FlagStatus, action: "rewrite" as SuggestedAction, tldr: "The whole post argues against an app. Rewrite it as the story of the reversal, or take it down.", quote: "Tidewell will not build a patient app." },
    { n: 7, status: "open" as FlagStatus, action: "edit_wording" as SuggestedAction, tldr: "One line says there's no app to download. True today, wrong next year: say the app is coming in 2027.", quote: "That's why there's no Tidewell app for patients to download." },
    { n: 6, status: "cleared" as FlagStatus, action: "leave" as SuggestedAction, tldr: "Mentions the old decision as history, dated. Still true as written.", quote: "Last year we said no to a patient app." },
    { n: 10, status: "open" as FlagStatus, action: "dated_note" as SuggestedAction, tldr: "Assumes patients never install anything. Add a dated note that reminders move into the app in 2027.", quote: "Reminders go by SMS, since patients don't install anything." },
  ].map((r, i): F => ({
    id: pid("fr", i + 1),
    kind: "recheck",
    status: r.status,
    post: post(r.n).id,
    claim: pid("cl", 3),
    headline: "Patient app",
    passage: { before: "", quote: r.quote, after: "", section: "" },
    explanation: "",
    suggestedAction: r.action,
    fix:
      r.action === "edit_wording"
        ? { before: "", removed: r.quote, added: "There's no Tidewell app for patients yet; one is coming in 2027.", after: "", section: "" }
        : r.action === "dated_note"
          ? { before: "", removed: "", added: "Update, September 2026: reminders move into the Tidewell patient app when it launches in 2027.", after: "", section: "End of post" }
          : null,
    confidence: null,
    created: "2026-09-23T07:31:00Z",
    batch: pid("de", 5),
    note: "",
    snoozedUntil: null,
    contest: null,
    tldr: r.tldr,
  })),
  // The support-hours change (decision de10, minor).
  ...[
    { n: 9, status: "open" as FlagStatus, action: "edit_wording" as SuggestedAction, tldr: "States the old hours. Change 8am to 6pm to 7am to 7pm.", quote: "We answer the phone from 8am to 6pm AEST." },
    { n: 8, status: "cleared" as FlagStatus, action: "leave" as SuggestedAction, tldr: "Says \"business hours\" without times. Still holds.", quote: "call us during business hours" },
  ].map((r, i): F => ({
    id: pid("fs", i + 1),
    kind: "recheck",
    status: r.status,
    post: post(r.n).id,
    claim: pid("cl", 10),
    headline: "Support hours",
    passage: { before: "", quote: r.quote, after: "", section: "" },
    explanation: "",
    suggestedAction: r.action,
    fix: r.action === "edit_wording" ? { before: "", removed: r.quote, added: "We answer the phone from 7am to 7pm AEST.", after: "", section: "Contact" } : null,
    confidence: null,
    created: "2026-10-02T06:01:00Z",
    batch: pid("de", 10),
    note: "",
    snoozedUntil: null,
    contest: null,
    tldr: r.tldr,
  })),
];

let pending: PendingProposal[] = [
  { id: pid("pr", 2), origin: "ingest", status: "escalated", title: "From the call \"Pricing page review\": 2 claims", openedBy: null, created: "2026-10-06T14:00:00Z" },
];

// ---- helpers ----

const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let seq = 100;
const nextId = (prefix: string) => pid(prefix, ++seq);

const topicOf = (id: string) => topics.find((t) => t.id === id)!;
const postOf = (id: string) => posts.find((p) => p.id === id)!;
const isLive = (c: C) => c.status === "settled" || c.status === "contested";

function weight(c: C): number {
  const relying = new Set(postClaims.filter((pc) => pc.claim === c.id && pc.reliance !== "mentions").map((pc) => pc.post));
  return 1 + relying.size;
}

function inConflict(c: C): boolean {
  return relationships.some((r) => {
    if (r.kind !== "contradicts" || (r.from !== c.id && r.to !== c.id)) return false;
    const other = claims.find((o) => o.id === (r.from === c.id ? r.to : r.from));
    return !!other && isLive(other);
  });
}

function summary(c: C): ClaimSummary {
  return {
    id: c.id,
    text: c.text,
    status: c.status,
    topics: c.topics.map(topicOf),
    validFrom: c.validFrom ?? null,
    weight: weight(c),
    postCount: new Set(postClaims.filter((pc) => pc.claim === c.id).map((pc) => pc.post)).size,
    inConflict: isLive(c) && inConflict(c),
    created: c.created,
  };
}

/** The quote with the text around it, as the server cuts it from kb_sources.body. */
function withContext(body: string, quote: string): { before: string; after: string } {
  const at = body.indexOf(quote);
  if (at < 0) return { before: "", after: "" };
  return { before: body.slice(Math.max(0, at - 160), at), after: body.slice(at + quote.length, at + quote.length + 160) };
}

function topicLineage(id: string): string[] {
  const out: string[] = [];
  let t: Topic | undefined = topicOf(id);
  while (t) {
    out.push(t.id);
    t = t.parent ? topicOf(t.parent) : undefined;
  }
  return out;
}

function detail(c: C): ClaimDetail {
  const ev: Evidence[] = evidence
    .filter((e) => e.claim === c.id)
    .map((e) => {
      const s = sources.find((x) => x.id === e.source)!;
      const { body, ...source } = s;
      return { id: e.id, source, quote: e.quote, ...withContext(body, e.quote), stance: e.stance };
    })
    .sort((a, b) => a.source.tier - b.source.tier);
  const history: ClaimDetail["history"] = [];
  let prev = c.supersedes;
  while (prev) {
    const p = claims.find((x) => x.id === prev);
    if (!p) break;
    history.push({ id: p.id, text: p.text, status: p.status, created: p.created });
    prev = p.supersedes;
  }
  const ownerSet = new Map<string, Person>();
  for (const t of c.topics) for (const l of topicLineage(t)) for (const o of owners[l] ?? []) ownerSet.set(o.id, o);
  return {
    ...summary(c),
    scope: c.scope ?? {},
    validUntil: c.validUntil ?? null,
    reviewAfter: c.reviewAfter ?? null,
    rationale: c.rationale ?? "",
    rememberedBy: c.rememberedBy ?? null,
    retired: c.retired ?? null,
    owners: [...ownerSet.values()],
    evidence: ev,
    relationships: relationships
      .filter((r) => r.from === c.id || r.to === c.id)
      .map((r) => {
        const out = r.from === c.id;
        const o = claims.find((x) => x.id === (out ? r.to : r.from))!;
        return { id: r.id, kind: r.kind, direction: out ? ("out" as const) : ("in" as const), other: { id: o.id, text: o.text, status: o.status } };
      }),
    posts: postClaims
      .filter((pc) => pc.claim === c.id)
      .map((pc) => {
        const p = postOf(pc.post);
        return { postId: p.id, title: p.title, version: p.version, reliance: pc.reliance, quote: pc.quote, published: p.published };
      }),
    admittedBy: c.admittedBy ? decisions[c.admittedBy] ?? null : null,
    retiredBy: c.retiredBy ? decisions[c.retiredBy] ?? null : null,
    history,
  };
}

function flagSummary(f: F): FlagSummary {
  return {
    id: f.id,
    kind: f.kind,
    status: f.status,
    postId: f.post,
    postTitle: f.post ? postOf(f.post).title : "Two claims disagree",
    headline: f.headline,
    confidence: f.confidence,
    created: f.created,
    batch: f.batch,
  };
}

const OPEN: FlagStatus[] = ["open", "snoozed"];
const COUNTS: FlagStatus[] = ["open", "snoozed", "wont_fix"];

function closeAs(f: F, status: FlagStatus, note = "") {
  f.status = status;
  if (note) f.note = note;
  if (status !== "snoozed") f.snoozedUntil = null;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 3) ?? []);

/** Guardian, policy v1 verdict rules, for a contest. Order: escalate, fail, weak, else admit. */
function ruleOnContest(reason: string, axis: ContestAxis | null): { verdict: Decision["verdict"]; checks: CheckLine[]; argument: string } {
  const r = reason.toLowerCase();
  if (/changed our mind|we decided|decided to|no longer/.test(r)) {
    return {
      verdict: "escalate",
      checks: [{ check: "C9", result: "escalate", reason: "A change of position, not a reconciliation." }],
      argument: "This changes what the company says. The owner of the topic rules on it.",
    };
  }
  if (!axis) {
    return {
      verdict: "reject",
      checks: [{ check: "C9", result: "fail", reason: "No axis: say how both can be true (time, scope, audience or wording)." }],
      argument: "The argument doesn't say how both statements hold. Name the time, scope, audience or wording, and add a source if you have one.",
    };
  }
  const sourced = /https?:\/\/|\b(doc|document|catalogue|contract|handbook|release|changelog|call|slack)\b/.test(r) || /\b20\d\d\b/.test(r);
  if (sourced) {
    return {
      verdict: "admit",
      checks: [
        { check: "C9", result: "pass", reason: `Names ${axis}, with a source other than the post.` },
        { check: "C10", result: "pass", reason: "Not circular." },
      ],
      argument: `Both hold once ${axis} is taken into account, and the source backs it. The flag closes as reconciled.`,
    };
  }
  return {
    verdict: "admit_contested",
    checks: [
      { check: "C9", result: "weak", reason: `Names ${axis}, but rests only on your sentence.` },
      { check: "C10", result: "weak", reason: "Nothing but the flagged post backs it." },
    ],
    argument: "Plausible, but nothing besides the post backs it. It goes in as contested: the flag closes, and the knowledge base grade carries it until someone adds a source.",
  };
}

function draftChange(claim: C, reason: string, axis: ContestAxis | null): ContestState["changes"] {
  const sentence = reason.trim().replace(/\s+/g, " ").replace(/[.!]*$/, ".");
  if (axis === "scope" || axis === "audience") return [{ op: "add", text: `${claim.text.replace(/\.$/, "")}, except where noted: ${sentence}` }];
  if (axis === "time") return [{ op: "add", text: sentence.charAt(0).toUpperCase() + sentence.slice(1) }];
  return [{ op: "relate", text: `Treat the post's wording as the same fact as "${claim.text}"` }];
}

// ---- the backend ----

export const placeholderKb: KnowledgeBackend = {
  sample: true,

  async topics() {
    await wait(80);
    return topics;
  },

  async claims(q) {
    await wait();
    const needle = q.search.trim().toLowerCase();
    let rows = claims.filter((c) => q.statuses.includes(c.status));
    if (q.topic) rows = rows.filter((c) => c.topics.some((t) => topicLineage(t).includes(q.topic!)));
    if (needle) {
      const terms = needle.split(/\s+/);
      rows = rows.filter((c) => terms.every((t) => c.text.toLowerCase().includes(t)));
    }
    let out = rows.map(summary);
    if (q.problemsOnly) out = out.filter((c) => c.status === "contested" || c.inConflict);
    out.sort((a, b) => (q.sort === "weight" ? b.weight - a.weight : 0) || b.created.localeCompare(a.created));
    const slice = out.slice(q.offset, q.offset + q.limit);
    return { rows: slice, total: out.length, next: q.offset + q.limit < out.length ? q.offset + q.limit : null };
  },

  async claim(id) {
    await wait(140);
    const c = claims.find((x) => x.id === id);
    return c ? detail(c) : null;
  },

  async pending() {
    await wait(80);
    return pending.filter((p) => p.status === "open" || p.status === "escalated" || p.status === "draft");
  },

  async remember(input) {
    await wait(300);
    const id = nextId("pr");
    pending = [{ id, origin: "remember", status: "open", title: input.text, openedBy: people.you, created: now() }, ...pending];
    // The Guardian rules a moment later. A Remember is always admitted; a live
    // claim saying something close but different gets a `contradicts`
    // relationship and a flag for its owner.
    setTimeout(() => {
      const claimId = nextId("cl");
      const decisionId = nextId("de");
      const mine = words(input.text);
      const near = claims.find((c) => {
        if (!isLive(c)) return false;
        const theirs = words(c.text);
        const shared = [...mine].filter((w) => theirs.has(w)).length;
        return shared >= Math.max(2, Math.ceil(Math.min(mine.size, theirs.size) * 0.6)) && c.text !== input.text;
      });
      const checks: CheckLine[] = [
        { check: "C4", result: "pass", reason: "A Remember is its own source." },
        { check: "C8", result: "pass", reason: near ? `Contradicts "${near.text}"; a Remember, so related, not rejected.` : "Nothing it contradicts." },
      ];
      if (/\b(says|said|thinks|according to)\b/i.test(input.text)) checks.push({ check: "C2", result: "fail", reason: "Names who said it; admitted anyway, the next proposal fixes the wording." });
      decisions[decisionId] = {
        id: decisionId,
        verdict: "admit",
        argument: near ? `Admitted. It disagrees with "${near.text}", so the topic owner has a flag to settle it.` : "Admitted. Nothing in the knowledge base disagrees with it.",
        checks,
        severity: "",
        decidedBy: guardian(),
        created: now(),
      };
      const sourceId = nextId("so");
      sources.push({ id: sourceId, kind: "person", tier: 1, title: "Remembered by you", uri: "", occurred: now().slice(0, 10), person: people.you, body: input.text });
      claims = [
        {
          id: claimId,
          text: input.text,
          status: "settled",
          topics: input.topics,
          scope: input.scope,
          rememberedBy: people.you,
          created: now(),
          admittedBy: decisionId,
        },
        ...claims,
      ];
      evidence = [...evidence, { id: nextId("ev"), claim: claimId, source: sourceId, quote: input.text, stance: "supports" }];
      if (near) {
        relationships = [...relationships, { id: nextId("re"), from: claimId, to: near.id, kind: "contradicts" }];
        flags.unshift({
          id: nextId("fl"),
          kind: "kb_conflict",
          status: "open",
          post: null,
          claim: claimId,
          otherClaim: near.id,
          headline: topicOf(input.topics[0] ?? near.topics[0])?.name ?? "Two claims disagree",
          passage: { before: "", quote: input.text, after: "", section: "" },
          explanation: "Your Remember disagrees with a claim already in the knowledge base. Both stay in until the topic owner settles it.",
          suggestedAction: "",
          fix: null,
          confidence: null,
          created: now(),
          batch: null,
          note: "",
          snoozedUntil: null,
          contest: null,
          tldr: "",
        });
      }
      pending = pending.map((p) => (p.id === id ? { ...p, status: "admitted" } : p));
      changed();
    }, 1600);
    return id;
  },

  async flags(q) {
    await wait();
    let rows = flags.filter((f) => (q.status === "open" ? OPEN.includes(f.status) : !OPEN.includes(f.status)));
    if (q.kind !== "all") rows = rows.filter((f) => f.kind === q.kind);
    // Re-checks live in their threads, not one by one in the flag list.
    else rows = rows.filter((f) => f.kind !== "recheck");
    rows.sort((a, b) => b.created.localeCompare(a.created));
    const slice = rows.slice(q.offset, q.offset + q.limit).map(flagSummary);
    return { rows: slice, total: rows.length, next: q.offset + q.limit < rows.length ? q.offset + q.limit : null };
  },

  async flag(id) {
    await wait(140);
    const f = flags.find((x) => x.id === id);
    if (!f) return null;
    const claim = claims.find((c) => c.id === f.claim)!;
    const other = f.otherClaim ? claims.find((c) => c.id === f.otherClaim) : undefined;
    return {
      ...flagSummary(f),
      passage: { ...f.passage, uri: "" },
      claim: detail(claim),
      otherClaim: other ? detail(other) : null,
      explanation: f.explanation,
      suggestedAction: f.suggestedAction,
      fix: f.fix,
      note: f.note,
      snoozedUntil: f.snoozedUntil,
      contest: f.contest,
      cantFixReason: null,
    } satisfies FlagDetail;
  },

  async closeFlag(id, status, opts) {
    await wait();
    const f = flags.find((x) => x.id === id);
    if (!f) throw new Error("No such flag.");
    closeAs(f, status, opts?.note);
    if (status === "snoozed") f.snoozedUntil = opts?.until ?? null;
  },

  async applyFix(id) {
    await wait(400);
    const f = flags.find((x) => x.id === id);
    if (!f) throw new Error("No such flag.");
    // In the live app the fix lands as a new post version and the reviewing
    // agent closes the flag when it sees it. Here it closes straight away.
    closeAs(f, "fixed");
  },

  async contest(flagId, reason, axis) {
    await wait(700);
    const f = flags.find((x) => x.id === flagId);
    if (!f) throw new Error("No such flag.");
    const claim = claims.find((c) => c.id === f.claim)!;
    f.contest = { proposalId: nextId("pr"), status: "draft", reason, axis, changes: draftChange(claim, reason, axis), decision: null };
    return f.contest;
  },

  async submitContest(flagId) {
    await wait(1200);
    const f = flags.find((x) => x.id === flagId);
    if (!f?.contest) throw new Error("Nothing to submit.");
    const ruling = ruleOnContest(f.contest.reason, f.contest.axis);
    const decision: Decision = { id: nextId("de"), ...ruling, severity: "", decidedBy: guardian(), created: now() };
    decisions[decision.id] = decision;
    const status = ruling.verdict === "admit" || ruling.verdict === "admit_contested" ? "admitted" : ruling.verdict === "reject" ? "rejected" : "escalated";
    f.contest = { ...f.contest, status, decision };
    if (status === "admitted") {
      const change = f.contest.changes.find((c) => c.op === "add");
      if (change) {
        const id = nextId("cl");
        claims = [{ id, text: change.text, status: ruling.verdict === "admit" ? "settled" : "contested", topics: claims.find((c) => c.id === f.claim)!.topics, created: now(), admittedBy: decision.id }, ...claims];
        if (f.post) postClaims.push({ post: f.post, claim: id, reliance: "asserts", quote: f.passage.quote });
      }
      closeAs(f, "reconciled");
    }
    if (status === "escalated") pending = [{ id: f.contest.proposalId, origin: "contest", status: "escalated", title: f.contest.reason, openedBy: people.you, created: now() }, ...pending];
    return f.contest;
  },

  async rechecks() {
    await wait();
    const batches = [...new Set(flags.filter((f) => f.batch).map((f) => f.batch!))];
    return batches
      .map((b) => {
        const items = flags.filter((f) => f.batch === b);
        const d = decisions[b];
        const old = claims.find((c) => c.retiredBy === b);
        return {
          id: b,
          title: old ? `"${old.text}" changed` : "A claim changed",
          severity: d.severity as Severity,
          open: items.filter((f) => OPEN.includes(f.status)).length,
          total: items.length,
          created: d.created,
        };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
  },

  async recheck(id) {
    await wait(160);
    const d = decisions[id];
    if (!d) return null;
    const old = claims.find((c) => c.retiredBy === id);
    const replacement = claims.find((c) => c.supersedes === old?.id);
    const items = flags.filter((f) => f.batch === id);
    const t = old?.topics[0];
    return {
      id,
      title: old ? `"${old.text}" changed` : "A claim changed",
      severity: d.severity,
      open: items.filter((f) => OPEN.includes(f.status)).length,
      total: items.length,
      created: d.created,
      oldClaim: { id: old?.id ?? "", text: old?.text ?? "" },
      newClaim: replacement ? { id: replacement.id, text: replacement.text } : null,
      decision: d,
      owner: (t && owners[t]?.[0]) || TOP_AUTHORITY,
      items: items.map((f) => ({
        flagId: f.id,
        postId: f.post ?? "",
        postTitle: f.post ? postOf(f.post).title : "",
        status: f.status,
        tldr: f.tldr,
        quote: f.passage.quote,
        suggestedAction: f.suggestedAction,
        fix: f.fix,
      })),
    } satisfies RecheckThread;
  },

  async bulk(ids, action: BulkAction) {
    await wait(500);
    for (const f of flags.filter((x) => ids.includes(x.id) && OPEN.includes(x.status))) {
      if (action === "apply_fix") {
        if (f.fix) closeAs(f, "fixed");
      } else if (action === "snooze") {
        closeAs(f, "snoozed");
        f.snoozedUntil = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
      } else closeAs(f, action);
    }
  },

  async grades(): Promise<Grades> {
    await wait();
    const published = posts.filter((p) => p.published);
    const total = published.length + QUIET_PUBLISHED;
    const counting = flags.filter((f) => f.post && (f.kind === "contradiction" || f.kind === "recheck") && COUNTS.includes(f.status));
    const flaggedPosts = new Set(counting.map((f) => f.post!));
    const share = 1 - flaggedPosts.size / total;
    const byTheme = new Map<string, { label: string; posts: Set<string>; href: string }>();
    for (const f of counting) {
      const key = f.batch ?? claims.find((c) => c.id === f.claim)!.topics[0];
      const label = f.batch ? `Re-check: ${f.headline}` : topicOf(key).name;
      const href = f.batch ? `#/knowledge/rechecks/${f.batch}` : `#/knowledge/flags`;
      const e = byTheme.get(key) ?? { label, posts: new Set(), href };
      e.posts.add(f.post!);
      byTheme.set(key, e);
    }
    const live = claims.filter(isLive).map(summary);
    const totalWeight = live.reduce((s, c) => s + c.weight, 0);
    const bad = live.filter((c) => c.status === "contested" || c.inConflict);
    const badWeight = bad.reduce((s, c) => s + c.weight, 0);
    const kbShare = totalWeight ? 1 - badWeight / totalWeight : 1;
    return {
      content: {
        letter: letterFor(share),
        posts: total,
        flagged: flaggedPosts.size,
        share,
        breakdown: {
          open: new Set(counting.filter((f) => f.kind === "contradiction" && f.status === "open").map((f) => f.post)).size,
          snoozed: new Set(counting.filter((f) => f.status === "snoozed").map((f) => f.post)).size,
          wontFix: new Set(counting.filter((f) => f.status === "wont_fix").map((f) => f.post)).size,
          rechecks: new Set(counting.filter((f) => f.kind === "recheck" && f.status === "open").map((f) => f.post)).size,
        },
        notes: [...byTheme.values()]
          .map((e) => ({ label: e.label, count: e.posts.size, href: e.href }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      },
      knowledge: {
        letter: letterFor(kbShare),
        claims: live.length,
        contested: live.filter((c) => c.status === "contested").length,
        inConflict: live.filter((c) => c.inConflict).length,
        share: kbShare,
        totalWeight,
        badWeight,
        todo: bad.sort((a, b) => b.weight - a.weight).slice(0, 8),
      },
    };
  },
};

