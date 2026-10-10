// The Strategist (agents/strategist.md, approved 2026-10-09): says what a
// tenant should aim for this quarter, with a reason for every number, then
// says early and plainly when they're drifting.
//
// Mostly code, one model call in the middle:
//   1. gather (code): the onboarding answers and plan, the website, last
//      quarter's output and pitch outcomes, the last approved proposal's edits,
//      the taste summary, keyword data from DataForSEO, and who ranks for the
//      tenant's own searches;
//   2. one model call (MODELS.strategist, Claude Fable 5.1) writes the proposal as JSON;
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
import { askJson, MODELS } from "../agents/model.js";
import { assertPublicUrl, readPage, searchWeb, searchConfigured } from "../agents/web.js";
import { getSite, publishedPosts, tasteProfile } from "../agents/store.js";
import {
  claimProposal,
  failProposal,
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
  requestProposal,
  runCost,
  saveNotes,
  sendProposal,
  settings,
  sitesWithGoals,
} from "../agents/strategy-store.js";
import {
  dayOf,
  effectiveKind,
  emptyBrief,
  EMPTY_BRIEF_ERROR,
  finish,
  launchFor,
  nextQuarter,
  parseDraft,
  quarterBounds,
  quarterLabelOf,
  reviewPerMonth,
  thinAnswers,
  pickHost,
  validate,
  volumeCap,
  weeklyNotes,
  windowFor,
  type Draft,
  type Keyword,
  type ProposalKind,
} from "../agents/strategy.js";
import { batchCadence } from "../agents/store.js";
import { dataForSeoConfigured, keywordIdeas, keywordOverview, rankedKeywords } from "../scout/dataforseo.js";
import { AGENT_QUEUE, registerAgent, startOnceForTenant, type DispatchInput } from "./agents.js";

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
}

async function gather(site: string, request: string, now: Date): Promise<Pack> {
  const [s, prof, set, taste] = await Promise.all([
    getSite(site),
    profile(site),
    settings(site, ["tenant.website", "strategist.reviewPerMonth"]),
    tasteProfile(site),
  ]);
  if (!s) throw new Error(`site ${site} not found`);
  const website = String(set["tenant.website"] ?? "").trim();

  // The website as text: home, plus the usual pages when they exist.
  const pages: Pack["pages"] = [];
  if (website) {
    const base = /^https?:\/\//.test(website) ? website : `https://${website}`;
    for (const path of ["", "/pricing", "/about", "/product"]) {
      try {
        const p = await readPage(new URL(path, base).toString(), path ? 4_000 : 8_000);
        if (p.text.trim()) pages.push(p);
      } catch {
        /* missing or unreadable: skip */
      }
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
  const [lastPosts, recent, outcomes, approved] = await Promise.all([
    publishedBetween(site, last.start.toISOString(), last.end.toISOString()),
    publishedPosts(site, 30),
    pitchOutcomes(site, last.start.toISOString()),
    lastApproved(site),
  ]);

  return {
    site: { id: s.id, name: s.name, domain: s.domain ?? "", blog: s.domain || `${s.slug}.propaganda.pub` },
    website,
    perMonth: reviewPerMonth(set["strategist.reviewPerMonth"]),
    perMonthAnswered: Number.isFinite(parseInt(String(set["strategist.reviewPerMonth"] ?? ""), 10)),
    answers: prof?.answers ?? {},
    plan: { text: [prof?.plan_text ?? "", ...planTexts].filter(Boolean).join("\n\n").slice(0, 30_000), files: (prof?.plan_files ?? []).map((f) => f.name) },
    pages,
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
  };
}

// ---- keyword data and who ranks ----

interface Market {
  keywords: Keyword[];
  ours: Keyword[];
  competitors: { domain: string; keywords: Keyword[] }[];
  serps: { query: string; top: { position: number; url: string; title: string }[] }[];
}

async function market(site: string, pack: Pack): Promise<Market> {
  const out: Market = { keywords: [], ours: [], competitors: [], serps: [] };
  const seeds = lines(pack.answers.searches).slice(0, 5);
  if (!dataForSeoConfigured()) return out;
  const w = { site, ...LOCATION };
  const ourDomain = hostOf(pack.website);
  const competitorDomains = await competitorHosts(site, lines(pack.answers.watch), ourDomain);
  const tries: Promise<void>[] = [];
  if (seeds.length) tries.push(keywordIdeas(w, JOB, seeds, 60).then((k) => void (out.keywords = k)));
  if (ourDomain) tries.push(rankedKeywords(w, JOB, ourDomain, 50).then((k) => void (out.ours = k)));
  for (const d of competitorDomains) {
    tries.push(rankedKeywords(w, JOB, d, 30).then((k) => void out.competitors.push({ domain: d, keywords: k })));
  }
  const settled = await Promise.allSettled(tries);
  for (const r of settled) if (r.status === "rejected") console.warn(`strategist keyword data: ${(r.reason as Error).message}`);

  // Who ranks for the tenant's own searches (at most 5, so at most 5 paid searches).
  if (searchConfigured()) {
    for (const q of seeds) {
      try {
        const hits = await searchWeb(q, 10, { site, job: JOB });
        out.serps.push({ query: q, top: hits.slice(0, 5).map((h) => ({ position: h.position, url: h.url, title: h.title })) });
      } catch (err) {
        console.warn(`strategist search "${q}": ${(err as Error).message}`);
      }
    }
  }
  return out;
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

/** Every keyword we have numbers for, by lower-cased query; our position wins over an idea's. */
function keywordMap(m: Market): Map<string, Keyword> {
  const map = new Map<string, Keyword>();
  for (const k of m.keywords) map.set(k.keyword.toLowerCase(), { ...k, position: null });
  for (const k of m.ours) map.set(k.keyword.toLowerCase(), k);
  return map;
}

/** Volume and difficulty for searches the model proposed that the ideas pull never covered. A failure prices nothing; the run goes on. */
async function priceSearches(site: string, queries: string[]): Promise<Keyword[]> {
  if (!dataForSeoConfigured() || !queries.length) return [];
  try {
    return (await keywordOverview({ site, ...LOCATION }, JOB, queries)).map((k) => ({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, position: null }));
  } catch (err) {
    console.warn(`strategist keyword overview: ${(err as Error).message}`);
    return [];
  }
}

// ---- 2. the model call ----

const SYSTEM = `You are the Strategist for a company's blog, inside Propaganda (a content platform). You propose the company's goals for a calendar quarter: how many posts, on which topics, which Google searches to win, which sites to watch. A person approves them; nothing you say is final. You are a strategist, not a form filler: a proposal that only restates what the company typed is a failure, however well it fits the rules.

The rules (code checks them; a proposal that breaks one is sent back):
1. Volume comes from capacity, never ambition. The cap you're given is a ceiling, not a target: propose less when more would mean a burst and then silence (after a Launch, the rest of the quarter should still carry about a post a week), and say so.
2. 1 to 4 topics, best first, each a range (low to high). A topic is an angle with a point of view: what this company knows or believes that its competitors don't say, aimed at a named buyer. Name it the way the founder would say it in a sentence, never a product category, never one of their searches pasted back, never "cluster" or "pillar". The first topic is the buying-intent one (what a buyer reads before they buy); then the long-tail topics a new domain can win. The first topic gets the biggest range. The low ends add up to at most the volume.
3. Every topic gets pitched from every source; there is no internal/external split.
4. 3 to 8 watched sites: regulators, trade press, competitors' blogs, standards bodies, newsletters. Each is a source that keeps publishing (a site, a blog index, a news section: the root or one path segment), never one article, whitepaper or listicle. Each tied to one topic, each with a why. The competitors they named are always in. Use real sites you know or that appear in the data; full https addresses.
5. 5 to 10 target searches (10 when the data allows, and at least 8 with 6 from the data when the data is rich): all winnable, which means difficulty under 30 with at least 50 searches a month, or a search where they're already on page two. A new domain targets long-tail searches only, never a head term (nothing over 5,000 searches a month), each one a question a post in its topic would literally answer. Each names one of the topics. A search you propose that the data doesn't list gets its numbers looked up before your proposal is checked, so take the best questions from the data first and add your own only when the data has none. A new domain targets at most 2 on page one by quarter end, and no AI-mention target in its first quarter (set it to null and say why).
6. No Readership target without 4 weeks of reader data: value null, and say a target comes after 4 weeks of readers.
7. Every number has a why (one line a person would say out loud, adding something they didn't already know) and a basis (what it came from). A basis quotes only what they actually said or a number from the data: "your answer: 8 posts a month", "DataForSEO: 320 searches/month, difficulty 12". Never put words in their mouth: a default is called a default ("review capacity not answered; assumed 8 a month"), and anything you had to assume becomes a question.
8. At most 3 questions: only what you couldn't decide alone. When their answers are thin (a blank, a one-liner, capacity not answered), ask at least one. Anything they said is coming up (a launch, an event, a deadline) gets either a place in the plan or a question, never silence. When what they asked for answers your earlier questions, those questions are settled: decide with their answers, never ask one again, and ask something new only when an answer leaves a choice you truly can't make alone. Where an answer is still vague, pick the sensible reading and say so in the basis.
9. The summary is the strategy in one sentence the founder would say about the next three months, not a list of the numbers.

Write plainly. No jargon, no hype. Never write "That's not X. It's Y."; say it as a comparison.

Answer with JSON only, in this shape:
{"summary": "one line", "volume": {"value": 18, "why": "...", "basis": "..."}, "topics": [{"name": "...", "low": 5, "high": 7, "why": "...", "basis": "..."}], "ranking": {"searches": [{"query": "...", "topic": "...", "why": "..."}], "pageOneTarget": {"value": 2, "why": "...", "basis": "..."}, "aiMentionTarget": {"value": null, "why": "...", "basis": "..."}}, "readership": {"value": null, "why": "...", "basis": "..."}, "watchedSites": [{"url": "https://...", "topic": "...", "why": "..."}], "questions": []}`;

function promptFor(pack: Pack, m: Market, o: { kind: ProposalKind; quarter: string; covers: { from: string; to: string; weeks: number }; cap: number; hasHistory: boolean; launch: { target: number } | null; today: string }): string {
  const kw = (list: Keyword[], n: number) =>
    list
      .slice(0, n)
      .map((k) => `- ${k.keyword}: ${k.volume}/month, difficulty ${k.difficulty ?? "?"}${k.position !== null ? `, we rank #${k.position}` : ""}`)
      .join("\n") || "(none)";
  const a = pack.answers;
  return [
    `Company: ${pack.site.name}. Website: ${pack.website || "(not given)"}. Blog: ${pack.site.blog}.`,
    `Proposal: ${o.kind}, for ${o.quarter}, covering ${o.covers.from} to ${o.covers.to} (${o.covers.weeks} weeks).`,
    `Volume cap: ${o.cap} posts for those weeks (${
      o.hasHistory
        ? `last quarter they published ${pack.history.publishedLastQuarter}; at most +20%`
        : pack.perMonthAnswered
          ? `their team can review ${pack.perMonth} posts a month, and a first quarter is at most 2 a week`
          : `they did not answer how many posts a month their team can review, so ${pack.perMonth} a month is assumed; a first quarter is at most 2 a week. Say it is assumed, and ask`
    }).`,
    o.launch ? `They're new: a ${o.launch.target}-post Launch runs first and counts toward the volume.` : "",
    pack.request ? `\nWhat they asked for:\n${pack.request}` : "",
    `\nTheir onboarding answers:\n- What they sell, who buys: ${a.offer || "(blank)"}\n- Searches they want to be found by: ${a.searches || "(blank)"}\n- Competitors and sites to watch: ${a.watch || "(blank)"}\n- Coming up in the next three months: ${a.upcoming || "(blank)"}`,
    pack.plan.text || pack.plan.files.length
      ? `\nTheir own plan (follow it where it fits the rules; say where you changed it):\n${pack.plan.text}${pack.plan.files.length ? `\nFiles they attached: ${pack.plan.files.join(", ")}` : ""}`
      : "",
    pack.pages.length ? `\nTheir website, as text:\n${pack.pages.map((p) => `## ${p.url}\n${p.text}`).join("\n\n")}` : "",
    pack.history.recentTitles.length ? `\nRecent posts:\n${pack.history.recentTitles.map((t) => `- ${t}`).join("\n")}` : "\nNo posts yet.",
    pack.history.approved || pack.history.rejected
      ? `\nPitches last quarter: ${pack.history.approved} approved, ${pack.history.rejected} rejected.${pack.history.rejectReasons.length ? ` Reasons given:\n${pack.history.rejectReasons.map((r) => `- ${r}`).join("\n")}` : ""}`
      : "",
    pack.lastEdits.length
      ? `\nHow they edited your last proposal before approving (respect this):\n${pack.lastEdits.map((e) => `- ${e.field}: ${e.from} → ${e.to}${e.reason ? ` (${e.reason})` : ""}`).join("\n")}`
      : "",
    pack.taste ? `\nWhat they like and dislike (from their decisions on pitches):\n${pack.taste}` : "",
    `\nDataForSEO, searches around theirs:\n${kw(m.keywords, 40)}`,
    `\nSearches they already rank for:\n${kw(m.ours, 25)}`,
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
    const now = new Date(await DBOS.runStep(async () => new Date().toISOString(), { name: "now" }));
    const pack = await DBOS.runStep(() => gather(site, row.request, now), { name: "gather", retriesAllowed: true, maxAttempts: 3, intervalSeconds: 10 });
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
    const m = await DBOS.runStep(() => market(site, pack), { name: "keyword data" });
    const keywords = keywordMap(m);
    const cap = volumeCap({ weeks: window.covers.weeks, perMonth: pack.perMonth, lastQuarterPublished: hasHistory ? pack.history.publishedLastQuarter : null });
    const launch = kind === "onboarding" && !hasHistory ? launchFor(now, window.join) : null;
    const rules = {
      volumeCap: cap,
      hasHistory,
      readerWeeks: 0,
      keywords,
      seedSearches: lines(pack.answers.searches),
      thinAnswers: thinAnswers(pack.answers, pack.perMonthAnswered),
    };

    const ask = {
      site,
      job: JOB,
      model: MODELS.strategist,
      system: SYSTEM,
      prompt: promptFor(pack, m, { kind, quarter: window.quarter, covers: window.covers, cap, hasHistory, launch, today: dayOf(now) }),
      maxOutputTokens: 6_000,
    };
    // Searches the model proposed that the data never priced get their numbers
    // now, so the winnable check sees them and the proposal carries them.
    let priced = 0;
    const price = async (d: Draft) => {
      const missing = d.ranking.searches.map((s) => s.query.toLowerCase()).filter((q) => !keywords.has(q));
      if (!missing.length) return;
      const rows = await DBOS.runStep(() => priceSearches(site, missing), { name: "price proposed searches" });
      for (const k of rows) keywords.set(k.keyword.toLowerCase(), k);
      priced += rows.length;
    };
    let draft: Draft = await askJson("propose", ask, parseDraft);
    await price(draft);
    let errors = validate(draft, rules);
    if (errors.length) {
      draft = await askJson("propose (fix)", {
        ...ask,
        prompt: `${ask.prompt}\n\nYour proposal broke these rules:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nYour proposal was:\n${JSON.stringify(draft)}\n\nAnswer again with the whole proposal, fixed.`,
      }, parseDraft);
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

    const cadence = await DBOS.runStep(() => batchCadence(site), { name: "batching" });
    const proposal = finish(draft, { kind, window, cadence, launch, keywords });
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
      planRead: Boolean(pack.plan.text || pack.plan.files.length),
      droppedSites: draft.watchedSites.length - readable.length,
      at: now.toISOString(),
    };
    await DBOS.runStep(() => sendProposal(proposalId, site, proposal, inputs, MODELS.strategist), { name: "send" });
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
  const m = await market(site, pack);
  const hasHistory = pack.history.publishedLastQuarter > 0;
  const cap = volumeCap({ weeks: window.covers.weeks, perMonth: pack.perMonth, lastQuarterPublished: hasHistory ? pack.history.publishedLastQuarter : null });
  const launch = !hasHistory ? launchFor(now, window.join) : null;
  return {
    system: SYSTEM,
    prompt: promptFor(pack, m, { kind: "onboarding", quarter: window.quarter, covers: window.covers, cap, hasHistory, launch, today: dayOf(now) }),
    cap,
    thinAnswers: thinAnswers(pack.answers, pack.perMonthAnswered),
  };
}

export function strategistRunId(proposalId: string): string {
  return `strategist-${proposalId}`;
}

/** Start the run for each requested proposal (once per row, however often it's asked). */
export async function dispatchStrategist(): Promise<string[]> {
  const started: string[] = [];
  for (const r of await requestedProposals()) {
    const id = strategistRunId(r.id);
    await startOnceForTenant(r.site, id, strategist, r.id);
    started.push(id);
  }
  return started;
}

/** Look for requested proposals now and every WORKER_DISPATCH_SECONDS. Returns a stop function. */
export function startStrategistPoller(): () => void {
  // The same tick as the knowledge base dispatcher (config.ts dispatchSeconds).
  const seconds = Number(process.env.WORKER_DISPATCH_SECONDS ?? 60);
  if (seconds <= 0) return () => {};
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await dispatchStrategist();
    } catch (err) {
      DBOS.logger.error(`strategist poller: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), seconds * 1000);
  return () => clearInterval(timer);
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
