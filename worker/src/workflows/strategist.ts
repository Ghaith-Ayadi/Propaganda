// The Strategist (agents/strategist.md, approved 2026-10-09): says what a
// tenant should aim for this quarter, with a reason for every number, then
// says early and plainly when they're drifting.
//
// Mostly code, one model call in the middle:
//   1. gather (code): the onboarding answers and plan, the website, last
//      quarter's output and pitch outcomes, the last approved proposal's edits,
//      the taste summary, keyword data from DataForSEO, and who ranks for the
//      tenant's own searches;
//   2. one model call (MODELS.strategist, Claude Opus 5.5) writes the proposal as JSON;
//   3. the validator (agents/strategy.ts) checks the rules; a draft that
//      breaks one goes back once with the errors, and a second failure fails
//      the run (Admin > Runs) instead of reaching the tenant;
//   4. watched sites the Scout couldn't read are dropped; the proposal is sent.
//
// How runs start: anything that wants a proposal adds a 'requested' row to
// strategy_proposals (the app through strategy_request(), Chat, the quarterly
// schedule); a poller starts one run per row, under the id strategist-<row>.
// The weekly check (Mondays) is code only and writes drift_notes.

import { DBOS } from "@dbos-inc/dbos-sdk";
import { HOUSE_STYLE, TITLE_RULES } from "../agents/writing.js";
import { appended, arr, askJson, MODELS, obj, str } from "../agents/model.js";
import { sharedIdeas } from "../agents/motifs.js";
import { assertPublicUrl, readPage, readSite, searchWeb, searchConfigured, type SiteClaim } from "../agents/web.js";
import { getSite, publishedPosts, tasteProfile } from "../agents/store.js";
import {
  claimProposal,
  earlierProposals,
  failProposal,
  roundsOf,
  getProposal,
  hasApprovedGoals,
  lastApproved,
  latestGoals,
  markPlanRead,
  pageOneSeries,
  pitchOutcomes,
  profile,
  publishedBetween,
  requestedProposals,
  runningProposals,
  requestProposal,
  runCost,
  saveNotes,
  sendProposal,
  settings,
  sitesWithGoals,
} from "../agents/strategy-store.js";
import {
  asksAboutTopics,
  dayOf,
  effectiveKind,
  emptyBrief,
  EMPTY_BRIEF_ERROR,
  MAX_PLAN_ROUNDS,
  ROUND_LIMIT_ERROR,
  finish,
  keepTopicNames,
  parseAnswers,
  perMonthFromAnswers,
  launchFor,
  nextQuarter,
  parseDraft,
  quarterBounds,
  quarterLabelOf,
  reviewPerMonth,
  thinAnswers,
  pickHost,
  proposalWithoutDashes,
  validate,
  volumeCap,
  weeklyNotes,
  windowFor,
  type Answered,
  type Draft,
  type Keyword,
  type ProposalKind,
  relevantKeywords,
  searchSeeds,
  siteOf,
  siteSentences,
  LATER_MAX,
  LATER_MIN,
  MUST_WIN_HARD_LINKS,
  MUST_WIN_MAX_DIFFICULTY,
  MUST_WIN_MAX_LINKS,
  NODATA_MAX,
  NOW_MAX,
  SEARCHES_MAX,
  SEARCHES_MIN,
  TOPICS_MAX,
  WINNABLE_MAX_LINKS,
} from "../agents/strategy.js";
import { batchCadence } from "../agents/store.js";
import { adsSearchVolume, dataForSeoConfigured, type KeywordRow, keywordOverview, keywordSuggestions, rankedKeywords, relatedKeywords, serpCompetitors } from "../scout/dataforseo.js";
import { AGENT_QUEUE, registerAgent, startOnceForTenant, type DispatchInput } from "./agents.js";
import { dispatchFirstDay, startFirstPitches } from "./first-day.js";

const JOB = "strategist";
const LOCATION = { locationCode: 2840, languageCode: "en" };

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function lines(s: unknown): string[] {
  return String(s ?? "")
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---- 1. gather ----

interface Pack {
  site: { id: string; name: string; domain: string; blog: string };
  website: string;
  perMonth: number;
  /** False when review capacity was never answered and perMonth is the default. */
  perMonthAnswered: boolean;
  answers: Record<string, string>;
  plan: { text: string; files: string[] };
  pages: { url: string; title: string; text: string }[];
  /** The site's sentences with how often they repeat across the pages read (agents/web.ts readSite); absent on a run recorded before 2026-10-12. */
  siteClaims?: SiteClaim[];
  history: {
    lastQuarter: string;
    publishedLastQuarter: number;
    recentTitles: string[];
    approved: number;
    rejected: number;
    rejectReasons: string[];
  };
  lastEdits: { field: string; from: string; to: string; reason?: string }[];
  taste: string;
  request: string;
  /** This quarter's earlier rounds: what was asked and answered, and the last proposal's topics. */
  rounds: {
    answered: Answered[];
    previous: { summary: string; topics: { name: string; low: number; high: number }[]; questions: string[] } | null;
    /** Review capacity came from an answer in a round ("8", "2 a week"), not from Settings. */
    perMonthAnswer: string;
  };
}

async function gather(site: string, request: string, now: Date, quarter = quarterLabelOf(now)): Promise<Pack> {
  const [s, prof, set, taste] = await Promise.all([
    getSite(site),
    profile(site),
    settings(site, ["tenant.website", "strategist.reviewPerMonth"]),
    tasteProfile(site),
  ]);
  if (!s) throw new Error(`site ${site} not found`);
  const website = String(set["tenant.website"] ?? "").trim();

  // The website as text, read the way a visitor skims it: the home page and
  // the pages its own menu points at, decoration dropped (agents/web.ts).
  let pages: Pack["pages"] = [];
  let siteClaims: SiteClaim[] = [];
  if (website) {
    try {
      const read = await readSite(website, { homeChars: 8_000, pageChars: 3_000, limit: 6 });
      pages = read.pages;
      siteClaims = read.claims;
    } catch {
      /* unreadable: the model plans from the answers */
    }
  }

  // Plan files the Strategist can read as text (Markdown, plain text, CSV); the
  // rest (PDF, Word, images) are listed by name for now.
  const planTexts: string[] = [];
  for (const f of (prof?.plan_files ?? []).slice(0, 5)) {
    if (!f.url || !/\.(md|markdown|txt|csv)$/i.test(f.name)) continue;
    try {
      const url = await assertPublicUrl(f.url);
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) planTexts.push(`## ${f.name}\n${(await res.text()).slice(0, 10_000)}`);
    } catch {
      /* unreadable: listed by name */
    }
  }

  const last = quarterBounds(quarterLabelOf(new Date(quarterBounds(quarterLabelOf(now)).start.getTime() - 86_400_000)));
  const [lastPosts, recent, outcomes, approved, earlier] = await Promise.all([
    publishedBetween(site, last.start.toISOString(), last.end.toISOString()),
    publishedPosts(site, 30),
    pitchOutcomes(site, last.start.toISOString()),
    lastApproved(site),
    earlierProposals(site, quarter),
  ]);

  // The rounds so far: each earlier proposal's questions were answered by the
  // request that followed it (the next row's, or this run's). Without this
  // the model saw only the latest answers, re-asked settled questions and
  // reworded every topic each round (first-day run, 2026-10-11).
  const answered: Answered[] = [];
  const asked = new Set<string>();
  for (const [i, row] of earlier.entries()) {
    for (const q of row.proposal?.questions ?? []) asked.add(q);
    const next = earlier[i + 1]?.request ?? request;
    for (const a of parseAnswers(next)) if (!answered.some((x) => x.question === a.question)) answered.push(a);
  }
  const lastProposal = [...earlier].reverse().find((r) => r.proposal)?.proposal ?? null;
  const previous = lastProposal
    ? { summary: lastProposal.summary, topics: lastProposal.topics.map((t) => ({ name: t.name, low: t.low, high: t.high })), questions: lastProposal.questions }
    : null;
  const settingPerMonth = parseInt(String(set["strategist.reviewPerMonth"] ?? ""), 10);
  const fromAnswer = Number.isFinite(settingPerMonth) ? null : perMonthFromAnswers(answered);
  const perMonthAnswer = fromAnswer === null ? "" : (answered.find((a) => perMonthFromAnswers([a]) !== null)?.answer ?? "");

  return {
    site: { id: s.id, name: s.name, domain: s.domain ?? "", blog: s.domain || `${s.slug}.propaganda.pub` },
    website,
    perMonth: fromAnswer ?? reviewPerMonth(set["strategist.reviewPerMonth"]),
    perMonthAnswered: Number.isFinite(settingPerMonth) || fromAnswer !== null,
    answers: prof?.answers ?? {},
    plan: { text: [prof?.plan_text ?? "", ...planTexts].filter(Boolean).join("\n\n").slice(0, 30_000), files: (prof?.plan_files ?? []).map((f) => f.name) },
    pages,
    siteClaims,
    history: {
      lastQuarter: quarterLabelOf(last.start),
      publishedLastQuarter: lastPosts.length,
      recentTitles: recent.map((p) => p.title).slice(0, 30),
      approved: outcomes.approved,
      rejected: outcomes.rejected,
      rejectReasons: outcomes.reasons,
    },
    lastEdits: approved?.edits ?? [],
    taste: taste?.summary ?? "",
    request,
    rounds: { answered, previous, perMonthAnswer },
  };
}

// ---- keyword data, the reader's searches, and who ranks ----

/**
 * A site that ranks for the reader's searches today, by what its address
 * says. An address says little: ".org" is a trade body as often as a
 * tutorial site (geeksforgeeks.org, 2026-10-20), so the kind is a hint and
 * the model judges who each one is by name.
 */
export type RankerKind = "government" | "school" | "competitor they named" | "video" | "forum" | ".org" | "site";

export interface Ranker {
  domain: string;
  kind: RankerKind;
  /** How many of the seed searches it ranks in the top 100 for. */
  keywords: number;
  avgPosition: number;
}

interface Market {
  keywords: Keyword[];
  ours: Keyword[];
  competitors: { domain: string; keywords: Keyword[] }[];
  serps: { query: string; top: { position: number; url: string; title: string }[] }[];
  /** The reader's job vocabulary, priced (searches first, 2026-10-20): biggest first. Absent on a run recorded before. */
  priced?: Keyword[];
  /** One line on who the reader is and the job the searches come from, from the vocabulary step. */
  job?: string;
  /** Who ranks across the biggest priced searches (`rankedFor`), best first. */
  whoRanks?: Ranker[];
  rankedFor?: string[];
  /** Lower-cased queries that are never a target: the company's names and the pages it hosts for customers. */
  notTargets?: string[];
}

async function market(site: string, pack: Pack): Promise<Market> {
  const out = await keywordData(site, pack);
  if (dataForSeoConfigured()) out.serps = await whoRanks(site, pack);
  return out;
}

/** Keyword ideas around their searches, and what they and their competitors rank for. */
async function keywordData(site: string, pack: Pack): Promise<Market> {
  const out: Market = { keywords: [], ours: [], competitors: [], serps: [] };
  // Short phrases only: a sentence typed as a search seeds a category dump.
  const seeds = searchSeeds(lines(pack.answers.searches));
  if (!dataForSeoConfigured()) return out;
  const w = { site, ...LOCATION };
  const ourDomain = hostOf(pack.website);
  const competitorDomains = await competitorHosts(site, lines(pack.answers.watch), ourDomain);
  const tries: Promise<void>[] = [];
  // Phrases that contain each seed, and the searches next to it; kept when
  // they share a word with a seed or the offer, 100 at most. keyword_ideas
  // (until 2026-10-12) answered "AI CMS" with every "ai" search there is.
  const pulled: KeywordRow[] = [];
  for (const seed of seeds) {
    tries.push(keywordSuggestions(w, JOB, seed, 50).then((k) => void pulled.push(...k)));
    tries.push(relatedKeywords(w, JOB, seed, 30).then((k) => void pulled.push(...k)));
  }
  if (ourDomain) tries.push(rankedKeywords(w, JOB, ourDomain, 50).then((k) => void (out.ours = k)));
  for (const d of competitorDomains) {
    tries.push(rankedKeywords(w, JOB, d, 30).then((k) => void out.competitors.push({ domain: d, keywords: k })));
  }
  const settled = await Promise.allSettled(tries);
  for (const r of settled) if (r.status === "rejected") console.warn(`strategist keyword data: ${(r.reason as Error).message}`);
  out.keywords = relevantKeywords(pulled, seeds, pack.answers.offer, 100);
  return out;
}

// ---- the reader's searches: the job's vocabulary, priced wide ----
//
// The tenant's own searches describe the company ("school nutrition
// software"); the reader searches for the job ("offer versus serve", "food
// buying guide calculator"), and those are where the demand is (Havoc,
// 2026-10-20: the ideas pull around the tenant's seeds priced every phrase
// at 0, and the plan played for 1,000 searches a month). So a small model
// call writes the job's vocabulary first, the whole list is priced in one
// overview call with SERP info, Google Ads fills in what Labs has no row
// for, and one request says who ranks across the biggest of them.

const VOCAB_SYSTEM = `You know how people search for their work. A company will get a blog; before anyone plans it, list the Google searches the people it sells to make about their own job, so the searches can be priced.

Think about the reader, not the company: the rules they follow, the forms they file, the calculations they get right, the deadlines they meet, the programs and acronyms of their field, the tools and templates they look for, the numbers they look up every year. Each search is a phrase a person types (2 to 6 words, the way they say it, the acronym and the long form when both are used), never a sentence, never a question with a question mark, never a phrase with the company's name in it. Specific beats generic: "offer versus serve" beats "school lunch rules". Include the few searches a buyer makes when choosing a product like this one, but most of the list is the daily job. 50 to 80 searches, the biggest first as you'd guess them. US English.

Also pick, from the searches the company already ranks for, the ones that are never a target for its blog: its own name and product names, and pages it hosts for its customers (a customer's menu, portal, login or listing). Copy those exactly.

Answer with JSON only: {"job": "one line: who the reader is and what job the searches come from", "searches": ["...", "..."], "notTargets": ["...", "..."]}`;

interface Vocabulary {
  job: string;
  searches: string[];
  notTargets: string[];
}

function parseVocabulary(value: unknown): Vocabulary {
  const o = obj(value, "The answer");
  const phrase = (s: string) => s.trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ").toLowerCase();
  const searches = [...new Set(arr(o.searches, "searches").map((s, i) => phrase(str(s, `searches[${i}]`, { max: 120 }))).filter((s) => s && s.split(" ").length <= 8))];
  if (searches.length < 5) throw new Error(`searches has ${searches.length} phrases; give 50 to 80.`);
  return {
    job: str(o.job, "job", { optional: true, max: 300 }).trim(),
    searches: searches.slice(0, 80),
    notTargets: [...new Set(arr(o.notTargets, "notTargets", { optional: true }).map((s, i) => phrase(str(s, `notTargets[${i}]`, { max: 200 }))).filter(Boolean))],
  };
}

/** The words of the company's name and its domain's first label: a search carrying one is navigational, never a target. */
function brandWords(pack: Pack): string[] {
  const words = new Set<string>();
  for (const w of pack.site.name.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) words.add(w);
  const stem = hostOf(pack.website).split(".")[0] ?? "";
  if (stem.length >= 3) words.add(stem);
  return [...words];
}

function isBrand(query: string, brand: string[]): boolean {
  const q = query.toLowerCase();
  return brand.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`).test(q));
}

/** The job's vocabulary, from one small model call; a failure leaves the run on the ideas pull alone. */
async function jobVocabulary(site: string, pack: Pack, ours: Keyword[]): Promise<Vocabulary> {
  const a = pack.answers;
  const site_text = pack.pages
    .map((p) => `## ${p.url}\n${p.text}`)
    .join("\n\n")
    .slice(0, 12_000);
  const prompt = [
    `Company: ${pack.site.name}. Website: ${pack.website || "(not given)"}.`,
    `What they sell, who buys (their answer): ${a.offer || "(blank)"}`,
    `Searches they want to be found by (their answer): ${a.searches || "(blank)"}`,
    `Competitors they named: ${a.watch || "(blank)"}`,
    site_text ? `\nTheir website, as text:\n${site_text}` : "",
    ours.length ? `\nSearches they already rank for (pick the never-targets from these):\n${ours.slice(0, 50).map((k) => `- ${k.keyword}${k.position !== null ? ` (#${k.position})` : ""}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const v = await askJson("job vocabulary", { site, job: JOB, model: MODELS.strategist, system: VOCAB_SYSTEM, prompt, maxOutputTokens: 4_000, reasoning: "low" }, parseVocabulary);
  const brand = brandWords(pack);
  const notTargets = new Set(v.notTargets);
  for (const k of ours) if (isBrand(k.keyword, brand)) notTargets.add(k.keyword.toLowerCase());
  return { ...v, searches: v.searches.filter((s) => !isBrand(s, brand)), notTargets: [...notTargets] };
}

function rankerKind(domain: string, competitors: string[]): RankerKind {
  const d = domain.toLowerCase();
  const site = siteOf(d);
  if (competitors.some((c) => siteOf(c) === site)) return "competitor they named";
  if (/(^|\.)(youtube|vimeo|tiktok)\.com$/.test(d)) return "video";
  if (/(^|\.)(facebook|reddit|quora|linkedin|x|twitter|instagram|pinterest)\.com$/.test(d)) return "forum";
  if (/\.(gov|mil)$/.test(d) || /\.state\.[a-z]{2}\.us$/.test(d) || /\.k12\.[a-z]{2}\.us$/.test(d) || /\.[a-z]{2}\.us$/.test(d)) return "government";
  if (/\.edu$/.test(d)) return "school";
  if (/\.org$/.test(d)) return ".org";
  return "site";
}

/** Price the job's vocabulary wide, then ask who ranks across the biggest of it. One DBOS step; each call that fails is logged and skipped. */
async function readerSearches(site: string, pack: Pack, vocab: Vocabulary, m: Market): Promise<Pick<Market, "priced" | "whoRanks" | "rankedFor">> {
  const w = { site, ...LOCATION };
  const out: Pick<Market, "priced" | "whoRanks" | "rankedFor"> = { priced: [], whoRanks: [], rankedFor: [] };
  if (!dataForSeoConfigured() || !vocab.searches.length) return out;
  const byQuery = new Map<string, Keyword>();
  try {
    for (const k of await keywordOverview(w, JOB, vocab.searches, { serpInfo: true })) byQuery.set(k.keyword.toLowerCase(), { ...k, position: null });
  } catch (err) {
    console.warn(`strategist keyword overview: ${(err as Error).message}`);
  }
  // Labs has no row for many exact job phrases; Google Ads often does. Its number is kept as the volume, with no difficulty.
  const unpriced = vocab.searches.filter((q) => (byQuery.get(q)?.volume ?? null) === null);
  if (unpriced.length) {
    try {
      for (const k of await adsSearchVolume(w, JOB, unpriced)) {
        const have = byQuery.get(k.keyword.toLowerCase());
        byQuery.set(k.keyword.toLowerCase(), have ? { ...have, volume: k.volume, trend6: have.trend6 ?? k.trend6, peakMonth: have.peakMonth ?? k.peakMonth } : { ...k, position: null });
      }
    } catch (err) {
      console.warn(`strategist ads volume: ${(err as Error).message}`);
    }
  }
  // Our own position on each, when we have one.
  for (const k of m.ours) {
    const have = byQuery.get(k.keyword.toLowerCase());
    if (have) byQuery.set(k.keyword.toLowerCase(), { ...have, position: k.position });
  }
  const priced = vocab.searches.map((q) => byQuery.get(q) ?? { keyword: q, volume: null, difficulty: null, position: null }).sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  out.priced = priced;
  // Who ranks across the ten biggest priced searches: the reader's page one today.
  const seeds = priced.filter((k) => k.volume !== null && k.volume >= 50).slice(0, 10).map((k) => k.keyword);
  if (seeds.length >= 3) {
    try {
      const competitors = m.competitors.map((c) => c.domain);
      out.whoRanks = (await serpCompetitors(w, JOB, seeds, 25)).map((c) => ({ ...c, kind: rankerKind(c.domain, competitors) }));
      out.rankedFor = seeds;
    } catch (err) {
      console.warn(`strategist serp competitors: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Who ranks for the tenant's own searches (at most 5, so at most 5 paid searches). */
async function whoRanks(site: string, pack: Pack): Promise<Market["serps"]> {
  const serps: Market["serps"] = [];
  if (!searchConfigured()) return serps;
  for (const q of lines(pack.answers.searches).slice(0, 5)) {
    try {
      const hits = await searchWeb(q, 10, { site, job: JOB });
      serps.push({ query: q, top: hits.slice(0, 5).map((h) => ({ position: h.position, url: h.url, title: h.title })) });
    } catch (err) {
      console.warn(`strategist search "${q}": ${(err as Error).message}`);
    }
  }
  return serps;
}

/**
 * The watch list as hostnames. "airops.com" is one already; a bare name
 * ("AirOps") is looked up with one web search and pickHost() chooses among
 * the results, so a tenant who types names still gets competitor keyword data.
 */
async function competitorHosts(site: string, watch: string[], ourDomain: string): Promise<string[]> {
  const hosts: string[] = [];
  for (const line of watch) {
    if (hosts.length >= 2) break;
    let host = hostOf(line);
    if (!host.includes(".") && searchConfigured()) {
      try {
        const hits = await searchWeb(line, 5, { site, job: JOB });
        host = pickHost(line, hits.map((h) => hostOf(h.url)), ourDomain);
      } catch (err) {
        console.warn(`strategist: couldn't resolve "${line}": ${(err as Error).message}`);
        host = "";
      }
    }
    if (host && host.includes(".") && host !== ourDomain && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** Every keyword we have numbers for, by lower-cased query; the priced job searches and our position win over an idea's. */
function keywordMap(m: Market): Map<string, Keyword> {
  const map = new Map<string, Keyword>();
  for (const k of m.keywords) map.set(k.keyword.toLowerCase(), { ...k, position: null });
  for (const k of m.priced ?? []) if (k.volume !== null || !map.has(k.keyword.toLowerCase())) map.set(k.keyword.toLowerCase(), k);
  for (const k of m.ours) {
    const have = map.get(k.keyword.toLowerCase());
    map.set(k.keyword.toLowerCase(), have ? { ...have, position: k.position } : k);
  }
  return map;
}

/** Volume, difficulty and page one's links for searches the model proposed that the pulls never covered. A failure prices nothing; the run goes on. */
async function priceSearches(site: string, queries: string[], serpInfo = false): Promise<Keyword[]> {
  if (!dataForSeoConfigured() || !queries.length) return [];
  try {
    return (await keywordOverview({ site, ...LOCATION }, JOB, queries, { serpInfo })).map((k) => ({ ...k, position: null }));
  } catch (err) {
    console.warn(`strategist keyword overview: ${(err as Error).message}`);
    return [];
  }
}

// ---- 2. the model call ----

const SYSTEM = `You are the Strategist for a company's blog, inside Propaganda (a content platform). You propose the company's goals for a calendar quarter: how many posts, on which topics, which Google searches to win, which sites to watch. A person approves them; nothing you say is final. You are a strategist, not a form filler: a proposal that only restates what the company typed is a failure, however well it fits the rules.

The rules (code checks them; a proposal that breaks one is sent back):
1. Volume is their number. The cap you're given is what they said they can review; propose it when the searches and topics carry it, and go below it only for a reason you state (a thin market, or a burst followed by silence: after a Launch the rest of the quarter still carries at least a post a week). More demand in the data is a reason to use the whole cap, never a reason to exceed it.
2. The searches describe the reader; the site and the answers describe the company. Work in this order: group the priced searches into the jobs the reader is doing (a rule to follow, a form to file, a calculation to get right, a deadline, a tool to use), then make a topic of each group that has enough demand and enough to say, then write the summary from the topics. 1 to ${TOPICS_MAX} topics, best first, each a range (low to high) sized to its searches. A topic has a name and a thesis. The name is a label of 2 to 6 words, at most 60 characters, a plain noun phrase or statement the founder would say in a meeting ("Knowing what's true before writing", "One message across three channels"): never a product category, never one of their searches pasted back, never "cluster" or "pillar", and never a whole sentence. No two-part names ("Thing: explanation"), no second half that starts with an -ing verb, no negation set up to be knocked down ("X isn't a Y problem"): the title rules below say how. The thesis is one plain sentence: a claim about how the reader's work goes right or wrong that a quarter of posts can show and the reader can check against their own week. The company's product belongs in a thesis when its design is the answer to that claim (a choice the company made and competitors did not), and then the topic says so plainly; a headline, a slogan or a feature list is not a thesis, and no more than three topics are about what the product does. A number or a customer result is proof and goes in a post, not in a topic. Each topic is a different thing they know: no two topics restate one claim, and no one idea (a price, a customer, an example from their site) runs through more than one topic. A thesis is never an argument with the pages that rank today or with a competitor's claim: what ranks is context for the posts, never their cast. The first topic is the one a buyer reads before they buy, and it gets the biggest range. The low ends add up to at most the volume. In a revision, keep each topic's exact name unless they asked for that topic to change: their pitches hang on the names, and a reworded name throws the pitches away.
3. Every topic gets pitched from every source; there is no internal/external split.
4. 3 to 8 watched sites, taken first from who ranks on page one for the reader's searches (the data lists them: regulators, state agencies, trade bodies), then the competitors they named. Each is a source that keeps publishing (a site, a blog index, a news section: the root or one path segment), never one article, whitepaper or listicle. Each tied to one topic, each with a why. The competitors they named are always in. Use real sites you know or that appear in the data; full https addresses. A site earns its place by authority in this niche (a known company, a study, a regulator, the trade press these buyers read), never by ranking for a search today; the why says in a few words who they are.
5. ${SEARCHES_MIN} to ${SEARCHES_MAX} target searches, each marked with its bucket. "now" (10 to ${NOW_MAX}): winnable this quarter, which means difficulty under 30 and page one averaging under ${WINNABLE_MAX_LINKS} referring domains, or a search where they already sit on page two; the difficulty score alone is not enough, because government pages score easy and are not. "later" (${LATER_MIN} to ${LATER_MAX}, required when the data has them): the biggest searches the reader's job depends on, with page one up to about ${MUST_WIN_MAX_LINKS} referring domains, or difficulty up to ${MUST_WIN_MAX_DIFFICULTY} as long as page one stays under ${MUST_WIN_HARD_LINKS}, each with a position goal in its why (into the top 30, then the top 20) rather than page one; leaving an 18,000-a-month search out because it is hard is the founder's decision, not yours. "nodata" (at most ${NODATA_MAX}): a search the data has no number for, kept because the intent is exact. Each names one of the topics and is a question a post in that topic would literally answer. Take the searches from the priced data first; a search you add that the data doesn't list gets its numbers looked up before your proposal is checked. Use the 6-month trend and the peak month: a seasonal search gets its posts written two to three months before its peak and judged after it, and the why says so, even when the peak falls outside the quarter. A search the company ranks for by its own name, or a page it hosts for a customer, is never a target. A search whose page one is lists of tools ("best X", "top X tools", "X software") stays eligible: the why says the post answers the buyer's question behind the search and never argues with the lists. A new domain targets at most 2 on page one by quarter end, counted among the "now" searches. The AI-mention target comes from the searches where Google shows an AI overview: propose how many of those should cite one of the posts by quarter end (a new domain: 1 to 3); when none of the target searches has an overview, set it to null and say why.
6. No Readership target without 4 weeks of reader data: value null, and say a target comes after 4 weeks of readers.
7. Every number has a why (one sentence a person would say out loud, the point first, under about 25 words, adding something they didn't already know and never restating the number) and a basis (what it came from). A basis quotes only what they actually said, what their site says, or a number from the data: "your answer: 8 posts a month", "their site says: no link farms", "DataForSEO: 320 searches/month, difficulty 12". Their site is not them talking to you: it is marketing copy, so a sentence from it is "their site says", never "you said" or "your answer", and a sentence the site repeats is repeated by the layout (a header, a footer, a card on every page), not because it is what the company cares about most. Never put words in their mouth: a default is called a default ("review capacity not answered; assumed 8 a month"), and anything you had to assume becomes a question.
8. At most 3 questions: only what you couldn't decide alone. When their answers are thin (a blank, a one-liner, capacity not answered), ask at least one. A blank "coming up" answer is a blank: a deadline that changes what the posts should be (a rule taking effect, a season) goes in the plan with its name, in the same sentence as the date; a launch, a beta or an event is never a reason for a post on a blog, so it gets no question and no post. When what they asked for answers your earlier questions, those questions are settled: decide with their answers, never ask one again, and ask something new only when an answer leaves a choice you truly can't make alone. Where an answer is still vague, pick the sensible reading and say so in the basis.
9. The summary is the strategy in one sentence the founder would say about the next three months, not a list of the numbers.
10. Everything you write is read by one person at the company. Propaganda is "we"; never name an agent (no "the Strategist", "the Writer", "the Scout"), never "the tenant", never "your plan says" (it is "the plan"), and never a note about what we lack (an empty knowledge base, missing data) unless it is a question they can answer.

Write plainly. No jargon, no hype. Everything you write (the profile, topic names, whys, bases, the summary, questions) follows these:

${HOUSE_STYLE}

${TITLE_RULES}

Answer with JSON only, in this shape:
{"profile": "one paragraph, 3 to 5 sentences, headed by their name: who they are, what they sell and to whom, how they grow, who they are up against, written from their answers, their site and the data, so they see we know them", "readersFind": "one paragraph: who ranks on page one for the reader's searches today, by kind (government, trade body, competitor, forum), and what that means for this blog, in plain words", "summary": "one line", "volume": {"value": 18, "why": "...", "basis": "..."}, "topics": [{"name": "...", "thesis": "...", "low": 5, "high": 7, "why": "...", "basis": "..."}], "ranking": {"searches": [{"query": "...", "topic": "...", "bucket": "now", "why": "..."}], "pageOneTarget": {"value": 2, "why": "...", "basis": "..."}, "aiMentionTarget": {"value": null, "why": "...", "basis": "..."}}, "readership": {"value": null, "why": "...", "basis": "..."}, "watchedSites": [{"url": "https://...", "topic": "...", "why": "..."}], "questions": []}`;

/** Ideas the site carries in four or more different sentences, minus the words of what they sell and search for. */
function siteIdeas(pack: Pack, a: Pack["answers"]): string[] {
  const claims = pack.siteClaims ?? [];
  if (claims.length < 8) return [];
  return sharedIdeas(claims.map((c) => c.text), { max: 3, own: [String(a.offer ?? ""), String(a.searches ?? ""), String(a.watch ?? "")] })
    .slice(0, 5)
    .map((m) => `"${m.word}" in ${m.items.length}`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One keyword as a line of the prompt: the number first, then what else the data says. */
function keywordLine(k: Keyword): string {
  const parts = [k.volume === null ? "no data" : `${k.volume}/month`];
  if (k.volume !== null || k.difficulty !== null) parts.push(`difficulty ${k.difficulty ?? "?"}`);
  if (typeof k.referringDomains === "number") parts.push(`page one averages ${k.referringDomains} referring domains`);
  if (typeof k.trend6 === "number") parts.push(`6-month trend ${k.trend6 >= 0 ? "+" : ""}${k.trend6}%`);
  if (typeof k.peakMonth === "number") parts.push(`peaks in ${MONTHS[k.peakMonth - 1]}`);
  if (k.intent) parts.push(`intent ${k.intent}`);
  if (typeof k.aiOverview === "boolean") parts.push(`AI overview ${k.aiOverview ? "yes" : "no"}`);
  if (k.position !== null) parts.push(`we rank #${k.position}`);
  return `- ${k.keyword}: ${parts.join(", ")}`;
}

function promptFor(pack: Pack, m: Market, o: { kind: ProposalKind; quarter: string; covers: { from: string; to: string; weeks: number }; cap: number; hasHistory: boolean; launch: { target: number } | null; today: string; searchesFirst?: boolean }): string {
  const kw = (list: Keyword[], n: number) => list.slice(0, n).map(keywordLine).join("\n") || "(none)";
  const a = pack.answers;
  const notTargets = new Set(m.notTargets ?? []);
  const ours = o.searchesFirst ? m.ours.filter((k) => !notTargets.has(k.keyword.toLowerCase())) : m.ours;
  return [
    `Company: ${pack.site.name}. Website: ${pack.website || "(not given)"}. Blog: ${pack.site.blog}.`,
    `Proposal: ${o.kind}, for ${o.quarter}, covering ${o.covers.from} to ${o.covers.to} (${o.covers.weeks} weeks).`,
    `Volume cap: ${o.cap} posts for those weeks (${
      o.hasHistory
        ? `last quarter they published ${pack.history.publishedLastQuarter}; at most +20%`
        : pack.perMonthAnswered
          ? `their team can review ${pack.perMonth} posts a month${pack.rounds.perMonthAnswer ? ` (their answer to your question: "${pack.rounds.perMonthAnswer}")` : ""}${o.searchesFirst ? "" : ", and a first quarter is at most 2 a week"}`
          : `they did not answer how many posts a month their team can review, so ${pack.perMonth} a month is assumed${o.searchesFirst ? "" : "; a first quarter is at most 2 a week"}. Say it is assumed, and ask`
    }).`,
    o.launch ? `They're new: a ${o.launch.target}-post Launch runs first and counts toward the volume.` : "",
    pack.rounds.previous
      ? `\nYour previous proposal this quarter (this is a revision of it). Keep each topic's exact name unless they asked for that topic to change: their pitches hang on the names, and a reworded name throws the pitches away. Summary: ${pack.rounds.previous.summary}\nTopics:\n${pack.rounds.previous.topics.map((t) => `- "${t.name}" (${t.low} to ${t.high})`).join("\n")}`
      : "",
    pack.rounds.answered.length
      ? `\nQuestions you asked in earlier rounds and their answers (settled: decide with them, never ask again):\n${pack.rounds.answered.map((a) => `- Q: ${a.question}\n  A: ${a.answer}`).join("\n")}`
      : "",
    pack.request ? `\nWhat they asked for:\n${pack.request}` : "",
    `\nTheir onboarding answers:\n- What they sell, who buys: ${a.offer || "(blank)"}\n- Searches they want to be found by: ${a.searches || "(blank)"}\n- Competitors and sites to watch: ${a.watch || "(blank)"}\n- Coming up in the next three months: ${a.upcoming || "(blank)"}`,
    pack.plan.text || pack.plan.files.length
      ? `\nTheir own plan (follow it where it fits the rules; say where you changed it):\n${pack.plan.text}${pack.plan.files.length ? `\nFiles they attached: ${pack.plan.files.join(", ")}` : ""}`
      : "",
    pack.pages.length ? `\nTheir website, as text (marketing copy, not their answers: quote it as "their site says"):\n${pack.pages.map((p) => `## ${p.url}\n${p.text}`).join("\n\n")}` : "",
    pack.siteClaims?.some((c) => c.count > 1)
      ? `\nSentences their site repeats (how many times; that is the layout repeating them, not the company's priority, and none of them is a topic or a thesis):\n${pack.siteClaims
          .filter((c) => c.count > 1)
          .slice(0, 12)
          .map((c) => `- ${c.count}x: ${c.text}`)
          .join("\n")}`
      : "",
    siteIdeas(pack, a).length
      ? `\nIdeas their site returns to in different sentences (${siteIdeas(pack, a).join(", ")}): an example repeated across the copy is an example, not their strategy. None of them is the centre of more than one topic.`
      : "",
    pack.history.recentTitles.length ? `\nRecent posts:\n${pack.history.recentTitles.map((t) => `- ${t}`).join("\n")}` : "\nNo posts yet.",
    pack.history.approved || pack.history.rejected
      ? `\nPitches last quarter: ${pack.history.approved} approved, ${pack.history.rejected} rejected.${pack.history.rejectReasons.length ? ` Reasons given:\n${pack.history.rejectReasons.map((r) => `- ${r}`).join("\n")}` : ""}`
      : "",
    pack.lastEdits.length
      ? `\nHow they edited your last proposal before approving (respect this):\n${pack.lastEdits.map((e) => `- ${e.field}: ${e.from} → ${e.to}${e.reason ? ` (${e.reason})` : ""}`).join("\n")}`
      : "",
    pack.taste ? `\nWhat they like and dislike (from their decisions on pitches):\n${pack.taste}` : "",
    m.priced?.length
      ? `\nDataForSEO, the searches the reader makes about the job (${m.job || "the people this company sells to, about their own work"}), priced, biggest first. "no data" means DataForSEO has no number, not zero. "Page one averages N referring domains" is how many distinct websites link to a page that ranks on page one today: under 10 is open ground for a good post, 10 to 30 takes a quarter with a few sites linking to the post, 30 to 80 takes a year, above that is beyond a blog post. The 6-month trend compares the last six months with the six before; the peak month says when the search is biggest. "AI overview yes" means Google answers this search with an AI overview that cites pages.\n${kw(m.priced, 100)}`
      : "",
    m.whoRanks?.length
      ? `\nWho ranks in Google's top 100 across the ${m.rankedFor?.length ?? 0} biggest of those searches (${(m.rankedFor ?? []).join(", ")}). The kind in brackets is read from the address (a .gov is government, a .org may be a trade body or a tutorial site): say who each one is by name:\n${m.whoRanks.map((r) => `- ${r.domain} (${r.kind}): ranks for ${r.keywords} of the ${m.rankedFor?.length ?? 0}, average position ${r.avgPosition}`).join("\n")}`
      : "",
    `\nDataForSEO, searches that contain theirs or sit next to them (relevant first, then by volume):\n${kw(m.keywords, 60)}`,
    `\nSearches they already rank for:\n${kw(ours, 25)}`,
    o.searchesFirst && notTargets.size
      ? `\nNever targets (the company's own name, and pages it hosts for customers; context only): ${[...notTargets].slice(0, 30).join("; ")}`
      : "",
    ...m.competitors.map((c) => `\nSearches ${c.domain} ranks for:\n${kw(c.keywords, 15)}`),
    m.serps.length
      ? `\nWho ranks for their own searches today:\n${m.serps.map((s) => `"${s.query}": ${s.top.map((t) => `#${t.position} ${t.url}`).join(", ") || "(nothing)"}`).join("\n")}`
      : "",
    `\nToday is ${o.today}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- 3 and 4: the run ----

async function strategistRun(proposalId: string): Promise<{ status: "sent" | "failed" | "skipped"; errors?: string[] }> {
  const runId = DBOS.workflowID ?? `strategist-${proposalId}`;
  const row = await DBOS.runStep(() => getProposal(proposalId), { name: "read request" });
  if (!row || !["requested", "running"].includes(row.status)) return { status: "skipped" };
  const site = row.site;
  if (!(await DBOS.runStep(() => claimProposal(proposalId, runId), { name: "claim" }))) return { status: "skipped" };

  try {
    // Before any paid call: a quarter's plan takes a fixed number of revisions (the UI stops earlier; this holds for a direct call too).
    if (await DBOS.patch("strategist-round-limit")) {
      const rounds = row.kind === "revision" ? await DBOS.runStep(() => roundsOf(site, row.quarter), { name: "rounds" }) : 0;
      if (rounds > MAX_PLAN_ROUNDS) {
        await DBOS.runStep(() => failProposal(proposalId, ROUND_LIMIT_ERROR), { name: "fail" });
        return { status: "failed", errors: [ROUND_LIMIT_ERROR] };
      }
    }
    const now = new Date(await DBOS.runStep(async () => new Date().toISOString(), { name: "now" }));
    const pack = await DBOS.runStep(() => gather(site, row.request, now, row.quarter), { name: "gather", retriesAllowed: true, maxAttempts: 3, intervalSeconds: 10 });
    // A run started before rounds existed replays its recorded gather output after a restart: no rounds yet.
    pack.rounds ??= { answered: [], previous: null, perMonthAnswer: "" };
    const hasHistory = pack.history.publishedLastQuarter > 0;
    // Nothing to plan from: stop before spending a model call (and say what to answer).
    if (emptyBrief({ website: pack.website, answers: pack.answers, planText: pack.plan.text, planFiles: pack.plan.files.length, published: pack.history.publishedLastQuarter + pack.history.recentTitles.length })) {
      await DBOS.runStep(() => failProposal(proposalId, EMPTY_BRIEF_ERROR), { name: "fail" });
      return { status: "failed", errors: [EMPTY_BRIEF_ERROR] };
    }
    // A tenant with no history and no approved goals is onboarding, whatever asked for the run: its first proposal carries the Launch.
    const hasGoals = await DBOS.runStep(() => hasApprovedGoals(site), { name: "approved goals" });
    const kind = effectiveKind(row.kind, { hasHistory, hasGoals });
    const window = windowFor(kind, now, row.quarter);
    // Two steps since day one's progress card (GET /progress/strategist): the
    // searches and their volumes, then who ranks for them. Runs from before
    // did both in "keyword data".
    // Searches first (2026-10-20): the reader's job vocabulary from a small
    // model call, priced wide, and who ranks across it; three buckets of
    // target searches, up to 8 topics, the cap is their number. A run
    // recorded before replays the old steps and the old rules.
    const searchesFirst = await DBOS.patch("strategist-searches-first");
    let m: Market;
    if (await DBOS.patch("strategist-who-ranks-step")) {
      m = await DBOS.runStep(() => keywordData(site, pack), { name: "keyword data" });
      if (searchesFirst) {
        let vocab: Vocabulary | null = null;
        try {
          vocab = await jobVocabulary(site, pack, m.ours);
        } catch (err) {
          console.warn(`strategist job vocabulary: ${(err as Error).message}`);
        }
        if (vocab) {
          const reader = await DBOS.runStep(() => readerSearches(site, pack, vocab!, m), { name: "job searches", retriesAllowed: true, maxAttempts: 2, intervalSeconds: 5 });
          m = { ...m, ...reader, job: vocab.job, notTargets: vocab.notTargets };
        } else {
          m = { ...m, notTargets: m.ours.filter((k) => isBrand(k.keyword, brandWords(pack))).map((k) => k.keyword.toLowerCase()) };
        }
      }
      const serps = dataForSeoConfigured() ? await DBOS.runStep(() => whoRanks(site, pack), { name: "who ranks" }) : [];
      m = { ...m, serps };
    } else {
      m = await DBOS.runStep(() => market(site, pack), { name: "keyword data" });
    }
    const keywords = keywordMap(m);
    const cap = volumeCap({ weeks: window.covers.weeks, perMonth: pack.perMonth, lastQuarterPublished: hasHistory ? pack.history.publishedLastQuarter : null, firstQuarterLimit: !searchesFirst });
    const launch = kind === "onboarding" && !hasHistory ? launchFor(now, window.join) : null;
    const rules = {
      volumeCap: cap,
      hasHistory,
      readerWeeks: 0,
      keywords,
      seedSearches: lines(pack.answers.searches),
      thinAnswers: thinAnswers(pack.answers, pack.perMonthAnswered),
      answered: pack.rounds.answered,
      previousTopics: pack.rounds.previous?.topics.map((t) => t.name) ?? [],
      requestAboutTopics: asksAboutTopics(pack.request),
      // Title rules on topic names (2026-10-12): a run recorded before them keeps its draft.
      titleRules: await DBOS.patch("strategist-title-rules"),
      // The twenty rules' hard checks (2026-10-12): same reason.
      houseStyle: await DBOS.patch("strategist-house-style"),
      // A short name plus a thesis, and the site's own sentences banned as either (2026-10-12): same reason.
      thesis: await DBOS.patch("strategist-thesis"),
      // One idea in one topic (2026-10-14): same reason.
      motifs: await DBOS.patch("strategist-motifs"),
      // A topic's name may borrow a site headline (2026-10-18): a run recorded before keeps the old check.
      headlineNames: await DBOS.patch("strategist-headline-names"),
      siteSentences: pack.siteClaims?.length ? pack.siteClaims.map((c) => c.text) : siteSentences(pack.pages.map((p) => p.text)),
      searchesFirst,
      notTargets: m.notTargets ?? [],
      // The institutions the reader finds today, for the watched-sites check: never a forum or a video site.
      whoRanks: (m.whoRanks ?? []).filter((r) => !["forum", "video"].includes(r.kind)).slice(0, 12).map((r) => r.domain),
    };
    const previousTopics = rules.previousTopics;

    const ask = {
      site,
      job: JOB,
      model: MODELS.strategist,
      system: SYSTEM,
      prompt: promptFor(pack, m, { kind, quarter: window.quarter, covers: window.covers, cap, hasHistory, launch, today: dayOf(now), searchesFirst }),
      // 20 searches, up to 8 topics and two paragraphs since 2026-10-20: the old 6,000 cut a full proposal short.
      maxOutputTokens: searchesFirst ? 12_000 : 6_000,
      // Medium effort and a cached prompt (Ayadi, 2026-10-14): the fix calls and revisions read it at the cache price.
      reasoning: "medium" as const,
      cache: true,
    };
    // Searches the model proposed that the data never priced get their numbers
    // now, so the winnable check sees them and the proposal carries them.
    let priced = 0;
    // A search DataForSEO has no row for is asked once: the fix draft doesn't
    // pay for it again (2026-10-12; a run recorded before asks twice, as it did).
    const priceOnce = await DBOS.patch("strategist-price-once");
    const asked = new Set<string>();
    const price = async (d: Draft) => {
      const missing = d.ranking.searches.map((s) => s.query.toLowerCase()).filter((q) => !keywords.has(q) && !(priceOnce && asked.has(q)));
      if (!missing.length) return;
      for (const q of missing) asked.add(q);
      const rows = await DBOS.runStep(() => priceSearches(site, missing, searchesFirst), { name: "price proposed searches" });
      for (const k of rows) keywords.set(k.keyword.toLowerCase(), k);
      priced += rows.length;
    };
    let draft: Draft = keepTopicNames(await askJson("propose", ask, parseDraft), previousTopics);
    await price(draft);
    let errors = validate(draft, rules);
    if (errors.length) {
      draft = await askJson("propose (fix)", {
        ...ask,
        ...appended(ask, `Your proposal broke these rules:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nYour proposal was:\n${JSON.stringify(draft)}\n\nAnswer again with the whole proposal, fixed.`),
      }, parseDraft);
      draft = keepTopicNames(draft, previousTopics);
      await price(draft);
      errors = validate(draft, rules);
    }
    if (errors.length) {
      await DBOS.runStep(() => failProposal(proposalId, `Broke the rules twice: ${errors.join(" ")}`), { name: "fail" });
      await DBOS.runStep(() => runCost(proposalId, runId), { name: "cost" });
      return { status: "failed", errors };
    }

    // Watched sites the Scout can't read are dropped (rule 4).
    const readable = await DBOS.runStep(async () => {
      const ok: string[] = [];
      for (const w of draft.watchedSites) {
        try {
          await readPage(w.url, 500);
          ok.push(w.url);
        } catch {
          /* dead, blocked or private: dropped */
        }
      }
      return ok;
    }, { name: "check watched sites" });
    draft = { ...draft, watchedSites: draft.watchedSites.filter((w) => readable.includes(w.url)) };

    if (rules.houseStyle) draft = proposalWithoutDashes(draft);
    const cadence = await DBOS.runStep(() => batchCadence(site), { name: "batching" });
    const proposal = finish(draft, { kind, window, cadence, launch, keywords, searchesFirst });
    const inputs = {
      website: pack.website,
      pages: pack.pages.map((p) => p.url),
      perMonth: pack.perMonth,
      perMonthAnswered: pack.perMonthAnswered,
      thinAnswers: rules.thinAnswers,
      cap,
      publishedLastQuarter: pack.history.publishedLastQuarter,
      keywords: m.keywords.length,
      rankedFor: m.ours.length,
      competitors: m.competitors.map((c) => c.domain),
      serps: m.serps.map((s) => s.query),
      pricedSearches: priced,
      jobSearches: m.priced?.length ?? 0,
      jobSearchesPriced: (m.priced ?? []).filter((k) => k.volume !== null).length,
      whoRanks: m.whoRanks?.length ?? 0,
      notTargets: m.notTargets?.length ?? 0,
      planRead: Boolean(pack.plan.text || pack.plan.files.length),
      droppedSites: draft.watchedSites.length - readable.length,
      at: now.toISOString(),
    };
    await DBOS.runStep(() => sendProposal(proposalId, site, proposal, inputs, MODELS.strategist), { name: "send" });
    // Day one: the first pitches, written while the person reads the plan
    // (workflows/first-day.ts). A run of its own, so the plan doesn't wait.
    if (await DBOS.patch("strategist-first-pitches")) await startFirstPitches(row, Boolean(proposal.launch));
    if (inputs.planRead) await DBOS.runStep(() => markPlanRead(site), { name: "plan read" });
    await DBOS.runStep(() => runCost(proposalId, runId), { name: "cost" });
    return { status: "sent" };
  } catch (err) {
    await DBOS.runStep(() => failProposal(proposalId, (err as Error).message), { name: "fail" });
    throw err;
  }
}

export const strategist = DBOS.registerWorkflow(strategistRun, { name: "strategist" });

/**
 * The exact model input an onboarding run for `site` would send today
 * (system prompt and user message), for reading and for comparing models by
 * hand. It runs the gather and the keyword pulls (the DataForSEO calls are
 * logged like a run's) and asks no model.
 */
export async function strategistInput(site: string, now = new Date()): Promise<{ system: string; prompt: string; cap: number; thinAnswers: boolean }> {
  const window = windowFor("onboarding", now);
  const pack = await gather(site, "", now);
  let m = await market(site, pack);
  try {
    const vocab = await jobVocabulary(site, pack, m.ours);
    m = { ...m, ...(await readerSearches(site, pack, vocab, m)), job: vocab.job, notTargets: vocab.notTargets };
  } catch (err) {
    console.warn(`strategist job vocabulary: ${(err as Error).message}`);
  }
  const hasHistory = pack.history.publishedLastQuarter > 0;
  const cap = volumeCap({ weeks: window.covers.weeks, perMonth: pack.perMonth, lastQuarterPublished: hasHistory ? pack.history.publishedLastQuarter : null });
  const launch = !hasHistory ? launchFor(now, window.join) : null;
  return {
    system: SYSTEM,
    prompt: promptFor(pack, m, { kind: "onboarding", quarter: window.quarter, covers: window.covers, cap, hasHistory, launch, today: dayOf(now), searchesFirst: true }),
    cap,
    thinAnswers: thinAnswers(pack.answers, pack.perMonthAnswered),
  };
}

export function strategistRunId(proposalId: string): string {
  return `strategist-${proposalId}`;
}

/** Rows this process already started, so the fast tick doesn't ask DBOS again every few seconds. */
const startedRows = new Map<string, number>();

/** Start the run for each requested proposal (once per row, however often it's asked). */
export async function dispatchStrategist(): Promise<string[]> {
  const started: string[] = [];
  const now = Date.now();
  for (const r of await requestedProposals()) {
    const id = strategistRunId(r.id);
    const at = startedRows.get(id);
    // DBOS dedupes by id anyway; this only saves it a write per tick. Asked again after 10 minutes.
    if (at === undefined || now - at > 10 * 60_000) {
      await startOnceForTenant(r.site, id, strategist, r.id);
      startedRows.set(id, now);
    }
    started.push(id);
  }
  for (const [id, at] of startedRows) if (now - at > 60 * 60_000) startedRows.delete(id);
  return started;
}

export const STOPPED_ERROR = "The Strategist stopped before finishing. Ask it again: your answers are saved.";
const ENDED = new Set(["ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);

/**
 * Running proposals whose run ended without saying so (it died where its own
 * catch couldn't write, or was cancelled) are marked failed, so the person sees
 * "ask again" instead of waiting forever, and strategy_request takes a new ask
 * (it returns the open one while a row says running). A row with no run after
 * 15 minutes counts as ended too. Returns the ids it failed.
 */
export async function settleStrategist(now = Date.now()): Promise<string[]> {
  const failed: string[] = [];
  for (const r of await runningProposals()) {
    const st = await DBOS.getWorkflowStatus(r.run_id || strategistRunId(r.id));
    const ended = st ? ENDED.has(st.status) : now - Date.parse(r.created) > 15 * 60_000;
    if (!ended) continue;
    await failProposal(r.id, STOPPED_ERROR);
    failed.push(r.id);
  }
  return failed;
}

/**
 * The Strategist's polls. Requested proposals every
 * WORKER_STRATEGIST_PICKUP_SECONDS (5): on day one the person is waiting, and
 * the query is one lookup on a partial index (strategy_proposals_requested,
 * status = 'requested') that is empty almost always. Day one's approvals and
 * rejections (workflows/first-day.ts) every WORKER_FIRST_DAY_SECONDS (15).
 * Runs that ended without a word (settleStrategist) every minute.
 * WORKER_DISPATCH_SECONDS=0 turns both off. Returns a stop function.
 */
export function startStrategistPoller(): () => void {
  if (Number(process.env.WORKER_DISPATCH_SECONDS ?? 60) <= 0) return () => {};
  const pickup = Math.max(1, Number(process.env.WORKER_STRATEGIST_PICKUP_SECONDS ?? 5));
  const firstDay = Math.max(1, Number(process.env.WORKER_FIRST_DAY_SECONDS ?? 15));
  const poll = (what: string, fn: () => Promise<unknown>, seconds: number) => {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        DBOS.logger.error(`${what} poller: ${(err as Error).message}`);
      } finally {
        busy = false;
      }
    };
    void tick();
    return setInterval(() => void tick(), seconds * 1000);
  };
  const timers = [
    poll("strategist", dispatchStrategist, pickup),
    poll("first day", () => dispatchFirstDay(), firstDay),
    poll("strategist settle", () => settleStrategist(), 60),
  ];
  return () => timers.forEach((t) => clearInterval(t));
}

/**
 * A run started by hand (Admin's "Run now", for testing): a revision of the
 * current quarter, or an onboarding proposal when the tenant has none yet.
 * Returns the run id.
 */
export async function runStrategistNow(site: string, by: string, note = "Run by hand from Admin."): Promise<string> {
  const quarter = quarterLabelOf(new Date());
  const kind: ProposalKind = (await latestGoals(site, quarter)) ? "revision" : "onboarding";
  const id = await requestProposal(site, quarter, kind, note, by);
  const handle = await startOnceForTenant(site, strategistRunId(id), strategist, id);
  return handle.workflowID;
}

/** Monday's check for one tenant, now (Admin's "Run now"). Its own run id, so the schedule's still runs. */
export async function weeklyCheckNow(site: string, by?: string): Promise<string> {
  const day = dayOf(new Date());
  const handle = await DBOS.startWorkflow(strategistWeeklyCheck, {
    workflowID: `strategist-check-${site}-${day}-manual-${Date.now().toString(36)}`,
    queueName: AGENT_QUEUE,
    workflowAttributes: by ? { site, trigger: "manual", requestedBy: by } : { site, trigger: "manual" },
  })(site, day);
  return handle.workflowID;
}

/** Chat: "redo the goals, we launch X in November" is a revision of the current quarter. */
registerAgent("strategist", async (input: DispatchInput) => {
  const id = await requestProposal(input.site, quarterLabelOf(new Date()), "revision", input.task, input.requestedBy);
  const handle = await startOnceForTenant(input.site, strategistRunId(id), strategist, id);
  return handle.workflowID;
});

// ---- schedules ----

/** Two weeks before each quarter (17 Mar, Jun, Sep, Dec): next quarter's proposal for every tenant with goals. */
async function quarterlyRun(scheduled: Date): Promise<void> {
  const current = quarterLabelOf(scheduled);
  const next = nextQuarter(current);
  const sites = await DBOS.runStep(() => sitesWithGoals(current), { name: "tenants" });
  for (const site of sites) {
    await DBOS.runStep(() => requestProposal(site, next, "quarterly", "", "agent:strategist"), { name: `request ${site}` });
  }
}
export const strategistQuarterly = DBOS.registerWorkflow(quarterlyRun, { name: "strategist:quarterly" });

/** One tenant's Monday check: notes when a goal is behind. Code only. */
async function weeklyCheckRun(site: string, day: string): Promise<number> {
  const now = new Date(`${day}T06:00:00Z`);
  const quarter = quarterLabelOf(now);
  const goals = await DBOS.runStep(() => latestGoals(site, quarter), { name: "goals" });
  if (!goals) return 0;
  const { start, end } = quarterBounds(quarter);
  const from = goals.covers?.from ? new Date(`${goals.covers.from}T00:00:00Z`) : start;
  const facts = await DBOS.runStep(async () => {
    const posts = await publishedBetween(site, from.toISOString(), end.toISOString());
    const byTopic: Record<string, number> = {};
    for (const p of posts) for (const t of new Set(p.topics)) byTopic[t] = (byTopic[t] ?? 0) + 1;
    const series = await pageOneSeries(site, dayOf(new Date(now.getTime() - 21 * 86_400_000)));
    return { published: posts.length, byTopic, trend: series.slice(-3).map((s) => s.pageOne) };
  }, { name: "facts" });
  const notes = weeklyNotes(goals.targets, { now, from, to: end, published: facts.published, publishedByTopic: facts.byTopic, pageOneTrend: facts.trend });
  if (notes.length) await DBOS.runStep(() => saveNotes(site, notes), { name: "save notes" });
  return notes.length;
}
export const strategistWeeklyCheck = DBOS.registerWorkflow(weeklyCheckRun, { name: "strategist:weekly-check" });

async function weeklyRun(scheduled: Date): Promise<void> {
  const day = dayOf(scheduled);
  const sites = await DBOS.runStep(() => sitesWithGoals(quarterLabelOf(scheduled)), { name: "tenants" });
  for (const site of sites) {
    await DBOS.startWorkflow(strategistWeeklyCheck, {
      workflowID: `strategist-check-${site}-${day}`,
      queueName: AGENT_QUEUE,
      workflowAttributes: { site },
    })(site, day);
  }
}
export const strategistWeekly = DBOS.registerWorkflow(weeklyRun, { name: "strategist:weekly" });

export const WEEKLY_CRON = process.env.STRATEGIST_WEEKLY_CRON ?? "0 6 * * 1";
export const QUARTERLY_CRON = process.env.STRATEGIST_QUARTERLY_CRON ?? "0 6 17 3,6,9,12 *";

/** Called once after launch. */
export async function scheduleStrategist(): Promise<void> {
  await DBOS.applySchedules([
    { scheduleName: "strategist-weekly", workflowFn: strategistWeekly, schedule: WEEKLY_CRON, cronTimezone: "UTC" },
    { scheduleName: "strategist-quarterly", workflowFn: strategistQuarterly, schedule: QUARTERLY_CRON, cronTimezone: "UTC" },
  ]);
}
