// Example content for the Getting started demo (UI preview only, see
// GettingStartedDemo.tsx). Harborlight Freight is fictional: a freight
// visibility tool for mid-size importers, the tenant the dev-box E2E run used.

export const TENANT = {
  name: "Harborlight Freight",
  initial: "H",
  website: "https://harborlight.example",
  host: "harborlight.propaganda.pub",
};

export type StepId = "business" | "strategy" | "planning" | "plan" | "pitches" | "drafts" | "publish";

export interface TimelineStep {
  id: StepId;
  label: string;
  /** Minutes, for the estimate. */
  minutes: number;
  /** An agent works; the person can do other things. */
  agent?: boolean;
}

export const TIMELINE: TimelineStep[] = [
  { id: "business", label: "Your business", minutes: 2 },
  { id: "strategy", label: "Your strategy questions", minutes: 5 },
  { id: "planning", label: "The Strategist writes your plan", minutes: 3, agent: true },
  { id: "plan", label: "Read and approve your plan", minutes: 5 },
  { id: "pitches", label: "Your first 10 pitches", minutes: 10 },
  { id: "drafts", label: "The Writer drafts 3 posts", minutes: 5, agent: true },
  { id: "publish", label: "Approve and publish your first article", minutes: 5 },
];

export const ANSWERS = {
  offer: "Shipment visibility for mid-size importers: one screen for every container, with the delays and the fees they'll cost. Bought by import managers and CFOs at companies moving 200 to 2,000 containers a year.",
  searches: "demurrage vs detention\ncontainer tracking for importers\nhow long does customs clearance take\ndetention charges explained",
  watch: "portwise.example\nboxtrail.example\nfreightdaily.example",
  upcoming: "Peak season pricing report in November. Booth at Manifest in February.",
};

export const PLANNING_STEPS = [
  "Read your website (6 pages)",
  "Looked up 55 searches and their volumes",
  "Checked who ranks for your 4 searches",
  "Writing the plan",
  "Checking it against the Launch rules",
];

export interface Reasoned {
  value: string;
  label: string;
  why: string;
  basis: string;
}

export const NUMBERS: Reasoned[] = [
  {
    value: "15",
    label: "posts in your Launch, over 30 days",
    why: "Enough for Google and readers to tell what you're about, few enough that every post carries something you actually know.",
    basis: "Launch rules; your team reviews 8 a month, so production runs ahead and publishing is spread.",
  },
  {
    value: "20",
    label: "posts this quarter (Q4)",
    why: "The Launch's 15, then one a week to the end of December.",
    basis: "Your answer: 8 posts a month reviewed. You joined in week 2, so full targets.",
  },
  {
    value: "3 of 10",
    label: "target searches on page one by 31 Dec",
    why: "A new blog ranks slowly. Three long-tail searches with weak results today are winnable this quarter; the rest are for Q1.",
    basis: "DataForSEO: 55 searches checked; 7 of your 10 have forum or thin vendor pages in the top 10.",
  },
];

export const SUMMARY =
  "Own the cost of delay for mid-size importers: four topics where Harborlight knows more than the carriers do, 15 posts in 30 days, long-tail searches first.";

export interface Pitch {
  id: string;
  topic: number;
  title: string;
  grade: "Strong" | "Fair";
  why: string;
  angle: string;
  audience: string;
  outline: string[];
  sources: string[];
  /** One of the 3 strongest: drafted before approval. */
  drafted?: boolean;
  learned?: string;
}

export interface Topic {
  name: string;
  range: string;
  why: string;
}

export const TOPICS: Topic[] = [
  { name: "The real cost of delay", range: "4 to 6 posts", why: "Your product exists because of this. Demurrage and detention searches have buyers behind them and weak answers today." },
  { name: "Customs holds", range: "3 to 4 posts", why: "Your support team answers these every week. Nobody vendor-neutral writes about them in plain words." },
  { name: "Visibility without an enterprise TMS", range: "3 to 4 posts", why: "The comparison your buyers make before a demo. Written from their budget, not from the enterprise vendors'." },
  { name: "Peak season, planned early", range: "2 to 3 posts", why: "Your November pricing report gives you first-party numbers nobody else has." },
];

export const PITCHES: Pitch[] = [
  {
    id: "p1",
    topic: 0,
    title: "What demurrage really costs a mid-size importer",
    grade: "Strong",
    drafted: true,
    why: "The pillar of your biggest topic, and \"demurrage vs detention\" (2,400 a month) has no good answer for importers.",
    angle: "The fees are the small part. The real cost is the stock that isn't on the shelf, and nobody puts a number on it.",
    audience: "Import managers who approve the invoices and CFOs who see the total.",
    outline: [
      "Demurrage and detention are two different clocks, and most invoices mix them up",
      "A typical 3-day hold at Long Beach costs $1,100 in fees per container",
      "The lost sales from a late container usually cost more than the fees",
      "Three numbers to track every week",
      "What you can negotiate in your next contract",
    ],
    sources: ["FMC, demurrage and detention rule (2024)", "Port of Long Beach tariff", "Your onboarding answers"],
  },
  {
    id: "p2",
    topic: 0,
    title: "Detention charges explained, with a real invoice",
    grade: "Strong",
    drafted: true,
    why: "\"detention charges explained\" (880 a month): the top results are forum threads.",
    angle: "Walk through one real invoice line by line instead of defining terms.",
    audience: "People who just received their first detention invoice.",
    outline: ["The invoice, annotated", "Where the free days went", "The two lines you can dispute", "How to stop it next time"],
    sources: ["FMC guidance", "A redacted invoice from your plan"],
  },
  {
    id: "p3",
    topic: 0,
    title: "Free time is not free: reading your carrier contract",
    grade: "Fair",
    why: "Supports the pillar; buying intent is lower.",
    angle: "Free-time clauses are where the money is decided, months before the ship arrives.",
    audience: "Whoever signs carrier contracts.",
    outline: ["Where free time is defined", "Merchant vs carrier haulage", "Three clauses worth fighting for"],
    sources: ["Sample service contract", "FMC rule"],
  },
  {
    id: "p4",
    topic: 1,
    title: "How long does customs clearance take? The honest answer",
    grade: "Strong",
    drafted: true,
    why: "6,600 searches a month. Too hard to rank for this quarter, but it's the post your support team keeps writing in emails.",
    angle: "Usually a day. When it isn't, it's one of five reasons, and four of them are avoidable.",
    audience: "Importers whose container just went on hold.",
    outline: ["The normal timeline", "The five reasons for a hold", "Which ones you can prevent", "What to send your broker today"],
    sources: ["CBP processing times", "Your support tickets (from onboarding)"],
  },
  {
    id: "p5",
    topic: 1,
    title: "The 5 paperwork mistakes behind most customs holds",
    grade: "Fair",
    why: "A checklist people bookmark; long-tail searches around \"customs hold\".",
    angle: "Specific mistakes, each with the exact field on the form.",
    audience: "Import coordinators.",
    outline: ["ISF late or wrong", "HTS code too vague", "Value mismatch", "Missing PGA data", "Consignee details"],
    sources: ["CBP ISF guidance"],
  },
  {
    id: "p6",
    topic: 1,
    title: "Exam holds: what happens when CBP picks your container",
    grade: "Fair",
    why: "Fills a gap: no plain-language explainer ranks today.",
    angle: "A day-by-day walk through an intensive exam, with the costs.",
    audience: "Importers facing their first exam.",
    outline: ["VACIS vs intensive", "The CES and its fees", "How long each step takes"],
    sources: ["CBP exam documentation"],
  },
  {
    id: "p7",
    topic: 2,
    title: "Container tracking for importers who don't need a TMS",
    grade: "Strong",
    why: "\"container tracking for importers\" (1,300 a month), buying intent, and it's your product's home turf.",
    angle: "Under 2,000 containers a year, an enterprise TMS costs more than the delays it prevents.",
    audience: "Import managers comparing tools.",
    outline: ["What a TMS actually does", "What you need at 200 to 2,000 containers", "The spreadsheet that breaks first", "What to ask in a demo"],
    sources: ["Your pricing page", "Public TMS pricing"],
  },
  {
    id: "p8",
    topic: 2,
    title: "Carrier ETAs are wrong 4 times out of 10. Plan around it",
    grade: "Fair",
    why: "Uses your own data on ETA accuracy, which nobody else has.",
    angle: "Your ETA data, published: how far off carrier ETAs are, by lane.",
    audience: "Planners and buyers.",
    outline: ["The numbers by lane", "Why ETAs drift", "Buffers that work"],
    sources: ["Harborlight ETA data (to confirm with you)"],
  },
  {
    id: "p9",
    topic: 3,
    title: "Peak season 2026: book now or pay double in November",
    grade: "Strong",
    why: "Timely: rates move in the next 6 weeks, and it sets up your November report.",
    angle: "A dated, practical calendar for the next 8 weeks.",
    audience: "Importers with Q1 stock to land.",
    outline: ["Where rates are heading", "The booking calendar", "What to lock in now"],
    sources: ["A weekly container rate index", "Your pricing report draft"],
  },
  {
    id: "p10",
    topic: 3,
    title: "What we learned from 40,000 containers last peak season",
    grade: "Fair",
    why: "First-party numbers from your November report; holds until the report is out.",
    angle: "The report's findings, as a post that links to it.",
    audience: "Everyone who'll read the report, and those who won't.",
    outline: ["The three findings", "What changed since 2025", "Download the report"],
    sources: ["Your November report"],
  },
];

export const REPLACEMENT = (reason: string, topic: number): Pitch => ({
  id: `r${Date.now()}`,
  topic,
  title: topic === 0 ? "The demurrage dispute letter that gets fees waived" : topic === 1 ? "Your broker's customs checklist, made shorter" : topic === 2 ? "Spreadsheet or software: the honest threshold" : "The peak season mistakes we see every year",
  grade: "Strong",
  why: "A replacement, written after your rejection.",
  angle: "Practical first: something the reader can use the same day.",
  audience: "Import managers.",
  outline: ["The situation", "What to do", "What it saves"],
  sources: ["FMC guidance"],
  learned: `Written after your note: "${reason}"`,
});

export const SEARCHES = [
  { query: "demurrage vs detention", volume: "2,400", ranks: "Forums, a carrier glossary", when: "Winnable now" },
  { query: "detention charges explained", volume: "880", ranks: "Reddit, thin vendor pages", when: "Winnable now" },
  { query: "container tracking for importers", volume: "1,300", ranks: "Two vendors, one directory", when: "Winnable now" },
  { query: "how long does customs clearance take", volume: "6,600", ranks: "CBP, large brokers", when: "Later" },
  { query: "customs hold reasons", volume: "720", ranks: "Broker blogs", when: "Later" },
  { query: "freight visibility software", volume: "1,900", ranks: "Enterprise vendors", when: "Later" },
];

export const WATCHED = ["portwise.example", "boxtrail.example", "freightdaily.example", "lanewatch.example"];

export const QUESTIONS = [
  "Can we publish your ETA accuracy numbers (pitch 8), or are they confidential?",
  "Who signs the posts: one person for all, or the right expert per topic?",
  "Is the November report's date fixed? Peak season posts depend on it.",
];

export const ARTICLE = {
  title: "What demurrage really costs a mid-size importer",
  byline: "Dana Okafor, Head of Customs Operations",
  collection: "Essays",
  url: "https://harborlight.propaganda.pub/essays/what-demurrage-really-costs",
  paragraphs: [
    { h: null, t: "Every import manager knows the line on the invoice. Few know the number that matters: what the late container cost the business, not the carrier." },
    { h: "Two clocks, one invoice", t: "Demurrage runs while your container sits in the terminal. Detention runs once it leaves and the empty box isn't back. Carriers often bill both on one line, and that's where most disputes start." },
    { h: "The fees are the small part", t: "A three-day hold at Long Beach costs about $1,100 per container in fees. The stock that isn't on the shelf usually costs more: a mid-size importer with a 30% gross margin loses that much in sales in a day and a half." },
    { h: "Three numbers to track every week", t: "Free days left per container, containers past their last free day, and the dollar total accruing today. If you track nothing else, track these." },
    { h: "What to negotiate next time", t: "Free time is decided in your contract, months before the ship arrives. Ask for free time counted from availability, not discharge, and a cap on combined charges." },
  ],
  notes: ["Lead with the cost to the business, not the definition.", "No product pitch before the last section."],
  flagged: "A three-day hold at Long Beach costs about $1,100 per container in fees.",
};
