// The Checker: reads a post in review against its sources and the knowledge
// base. Three runs:
//   check    a post version: links it to the claims it relies on, opens a
//            flag for each conflict (closes as fixed the ones the new version
//            no longer has), checks numbers and quotes against the pages it
//            links, and offers Remember on the tenant facts it found
//   recheck  a claim a post relies on changed: does the post still hold?
//   contest  a person pushed back on a flag in one sentence: draft the
//            changes and the argument they submit to the Guardian
// It never writes a claim: anything for the knowledge base goes through the
// Guardian. Model: the base tier (MODELS.base).

import { DBOS } from "@dbos-inc/dbos-sdk";
import { ask } from "./ai.js";
import { MODELS } from "./model.js";
import { config } from "../config.js";
import * as read from "../kb/read.js";
import { rpc } from "./backend.js";
import { htmlToText, links, passages } from "./text.js";

const AGENT = () => `checker:${MODELS.base}`;
const ACTIONS = new Set(["leave", "edit_wording", "rewrite", "dated_note", "unpublish"]);
const action = (a: unknown) => (typeof a === "string" && ACTIONS.has(a) ? a : "");

const WRITING = `When you write a suggested fix, match the post's voice and keep it as close to the original
sentence as you can. Never use the "That's not X. It's Y." construction; say it as a comparison instead.`;

// ---- check a post version ----

interface CheckAnswer {
  links?: { claim: string; reliance: string; quote: string }[];
  conflicts?: { claim: string; quote: string; explanation: string; suggested_action: string; suggested_fix: string }[];
  sources?: { url: string; quote: string; verdict: string; note: string }[];
  remember?: { text: string; quote: string }[];
  summary?: string;
}

const CHECK_SYSTEM = `You are the Checker of a tenant's content. You read one post in review and compare it with
two things: the tenant's knowledge base (claims: one plain sentence each, settled or contested), and the
pages the post links to. You never decide what is true for the tenant: the knowledge base does.

For each claim listed, decide whether the post relies on it:
- "asserts": the post states it; "assumes": the post depends on it without saying it; "mentions": it comes up
  in passing. Leave out claims the post doesn't touch.
A conflict is a passage that can't be true at the same time, scope and audience as a live claim. A post
that is dated (it talks about the past) or explicitly about another scope doesn't conflict. A contested
claim conflicts only when the post contradicts it outright. Quote the exact passage.
For each linked page, check the numbers and quotes the post takes from it: "ok", "mismatch" (it says
something else), "unsupported" (the page doesn't say it) or "unreachable" (no text was fetched).
"remember": facts about the tenant itself (its product, pricing, customers, policies, decisions) that the
post states and no listed claim covers, one plain standalone sentence each, with the quote. No people's
names in the sentence, no style rules.

${WRITING}

Answer with one JSON object and nothing else:
{"links": [{"claim": "<id>", "reliance": "asserts|assumes|mentions", "quote": "..."}],
 "conflicts": [{"claim": "<id>", "quote": "...", "explanation": "one or two sentences",
                "suggested_action": "edit_wording|rewrite|dated_note|unpublish", "suggested_fix": "the passage, fixed"}],
 "sources": [{"url": "...", "quote": "...", "verdict": "ok|mismatch|unsupported|unreachable", "note": "..."}],
 "remember": [{"text": "...", "quote": "..."}],
 "summary": "one or two sentences for the author"}`;

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "PropagandaChecker/0.2 (+https://propaganda.pub)" },
    });
    if (!res.ok) return "";
    const type = res.headers.get("content-type") ?? "";
    if (!/text|html|json|xml/.test(type)) return "";
    const body = (await res.text()).slice(0, 2_000_000);
    return type.includes("html") ? htmlToText(body) : body.slice(0, 12000);
  } catch {
    return "";
  }
}

async function checkRun(postVersionId: string): Promise<{ linked: number; opened: number; closed: number } | null> {
  const ctx = await DBOS.runStep(
    async () => {
      const v = await read.postVersion(postVersionId);
      if (!v) return null;
      const found = new Map<string, read.Claim>();
      // The title and each passage pull their nearest claims; the post sees the union.
      for (const text of [v.title, ...passages(v.content)]) {
        for (const c of await read.searchClaims(v.site, text, 6)) found.set(c.id, c);
        if (found.size >= 60) break;
      }
      return { v, claims: [...found.values()] };
    },
    { name: "read the post and the claims near it" },
  );
  if (!ctx) return null;
  const { v, claims } = ctx;

  const pages = await DBOS.runStep(
    async () => Promise.all(links(v.content).map(async (l) => ({ ...l, text: await fetchPage(l.url) }))),
    { name: "fetch the linked pages" },
  );

  const answer = await ask<CheckAnswer>("check the post", {
    site: v.site,
    job: "checker",
    model: MODELS.base,
    system: CHECK_SYSTEM,
    prompt: JSON.stringify(
      {
        post: { title: v.title, status: v.status, published_at: v.published_at, content: v.content.slice(0, 120_000) },
        claims: claims.map((c) => ({ id: c.id, text: c.text, status: c.status, scope: c.scope, topics: c.topics })),
        linked_pages: pages.map((p) => ({ url: p.url, sentence_in_post: p.context, page_text: p.text || null })),
      },
      null,
      1,
    ),
  });

  const ids = new Set(claims.map((c) => c.id));
  const linksOut = (answer.links ?? [])
    .filter((l) => ids.has(l.claim) && ["asserts", "assumes", "mentions"].includes(l.reliance))
    .map((l) => ({ claim: l.claim, reliance: l.reliance, quote: String(l.quote ?? "").slice(0, 4000) }));
  const conflicts = (answer.conflicts ?? [])
    .filter((c) => ids.has(c.claim))
    .map((c) => ({ ...c, suggested_action: action(c.suggested_action) }));
  const report = {
    summary: String(answer.summary ?? "").slice(0, 2000),
    sources: (answer.sources ?? []).slice(0, 20),
    remember: (answer.remember ?? []).filter((r) => r?.text).slice(0, 20),
  };

  return DBOS.runStep(
    () =>
      rpc<{ linked: number; opened: number; closed: number }>("kb_checker_record", {
        p_site: v.site,
        p_post_version: v.id,
        p_links: linksOut,
        p_conflicts: conflicts,
        p_seen: [...ids],
        p_report: report,
        p_agent: AGENT(),
        p_workflow: DBOS.workflowID ?? "",
      }),
    { name: "record the check" },
  );
}

export const checkPost = DBOS.registerWorkflow(checkRun, { name: "checker" });

// ---- re-check a post after a claim changed ----

interface RecheckAnswer {
  holds: boolean;
  explanation: string;
  suggested_action: string;
  suggested_fix: string;
}

const RECHECK_SYSTEM = `You are the Checker of a tenant's content. A claim in the tenant's knowledge base changed
(superseded by a new one, or retracted). A published post relied on the old claim. Read the post and decide
whether it still holds: it still holds when it only mentions the old fact in a dated context, or in a way the
change doesn't touch. Otherwise say what to do: edit the wording, rewrite the passage, add a dated note, or
unpublish, and write the fixed passage.

${WRITING}

Answer with one JSON object and nothing else:
{"holds": true|false, "explanation": "one or two sentences: the TL;DR for the owner",
 "suggested_action": "leave|edit_wording|rewrite|dated_note|unpublish", "suggested_fix": "the passage, fixed, or empty"}`;

async function recheckRun(flagId: string): Promise<{ flag: string; holds: boolean } | null> {
  const ctx = await DBOS.runStep(
    async () => {
      const f = await read.flag(flagId);
      if (!f || f.kind !== "recheck" || !["open", "snoozed"].includes(f.status) || !f.post) return null;
      const v = await read.latestVersion(f.post);
      return v ? { f, v } : null;
    },
    { name: "read the flag and the post" },
  );
  if (!ctx) return null;
  const { f, v } = ctx;

  const answer = await ask<RecheckAnswer>("re-check the post", {
    site: f.site,
    job: "checker-recheck",
    model: MODELS.base,
    system: RECHECK_SYSTEM,
    prompt: JSON.stringify(
      {
        old_claim: f.claim_text,
        change: f.replaced_by ? { superseded_by: f.replaced_by } : { retracted: true },
        passage_that_relied_on_it: f.quote,
        post: { title: v.title, published_at: v.published_at, content: v.content.slice(0, 120_000) },
      },
      null,
      1,
    ),
  });

  const holds = answer.holds === true;
  await DBOS.runStep(
    () =>
      rpc("kb_agent_review_flag", {
        p_flag: f.id,
        p_holds: holds,
        p_explanation: String(answer.explanation ?? "").slice(0, 4000),
        p_suggested_action: action(answer.suggested_action),
        p_suggested_fix: String(answer.suggested_fix ?? "").slice(0, 20000),
      }),
    { name: "record the re-check" },
  );
  return { flag: f.id, holds };
}

export const recheckPost = DBOS.registerWorkflow(recheckRun, { name: "checker-recheck" });

// ---- draft a contest ----

interface DraftAnswer {
  changes: { op: "add" | "supersede"; text: string; target?: string; scope?: Record<string, unknown>;
             valid_from?: string; valid_until?: string; rationale?: string }[];
  argument: string;
}

const DRAFT_SYSTEM = `You help a person push back on a flag. The flag says a post contradicts a claim in the
tenant's knowledge base. The person says, in one sentence, why both can be true, along an axis: time (it
changed, the post is dated), scope (a product, plan, region or customer type), audience, or wording.

Turn their sentence into the smallest change to the knowledge base that makes the post and the knowledge base
agree, for the Guardian to rule on:
- usually one "add": a new claim with the scope or dates that reconcile them;
- a "supersede" only when the existing claim must narrow (name it in "target").
Claims are one plain standalone sentence, no people's names, no style rules. Use only what the person and the
sources say: never invent evidence. Then write the argument the Guardian reads: which axis, why both hold,
what evidence there is (say so plainly when the only evidence is the person's word or the flagged post).

Answer with one JSON object and nothing else:
{"changes": [{"op": "add|supersede", "text": "...", "target": "<claim id, for supersede>",
              "scope": {"product": "..."}, "valid_from": "YYYY-MM-DD", "valid_until": "YYYY-MM-DD",
              "rationale": "..."}],
 "argument": "three sentences at most"}`;

async function contestRun(proposalId: string): Promise<{ proposal: string; changes: number } | null> {
  const ctx = await DBOS.runStep(
    async () => {
      const p = await read.proposal(proposalId);
      if (!p || p.origin !== "contest" || p.status !== "draft" || !p.flag) return null;
      if ((await read.changes(p.id)).length) return null;
      const f = await read.flag(p.flag);
      if (!f) return null;
      const nearby = await read.searchClaims(p.site, `${f.claim_text} ${f.quote}`, 10);
      return { p, f, nearby };
    },
    { name: "read the contest" },
  );
  if (!ctx) return null;
  const { p, f, nearby } = ctx;

  // What the draft cites: the person's sentence, and the flagged post itself
  // (tier 5; the Guardian's C10 knows a post can't excuse itself).
  const sources = await DBOS.runStep(
    async () => ({
      said: await rpc<string>("kb_agent_source", {
        p_site: p.site, p_kind: "chat", p_tier: 4, p_title: "Contest", p_body: p.summary,
      }),
      post: f.post_version
        ? await rpc<string>("kb_agent_source", {
            p_site: p.site, p_kind: "post", p_tier: 5, p_title: "Flagged post", p_body: "",
            p_uri: "", p_post_version: f.post_version,
          })
        : null,
    }),
    { name: "record the sources" },
  );

  const answer = await ask<DraftAnswer>("draft the contest", {
    site: p.site,
    job: "checker-contest",
    model: MODELS.base,
    system: DRAFT_SYSTEM,
    prompt: JSON.stringify(
      {
        flag: { claim_id: f.claim, claim: f.claim_text, post_passage: f.quote, why_flagged: f.explanation },
        person_says: p.summary,
        axis: p.axis || null,
        nearby_claims: nearby.map((c) => ({ id: c.id, text: c.text, status: c.status, scope: c.scope })),
      },
      null,
      1,
    ),
  });

  const known = new Set([f.claim, ...nearby.map((c) => c.id)]);
  const evidence = [
    { source: sources.said, quote: p.summary.slice(0, 4000), stance: "supports" },
    ...(sources.post && f.quote ? [{ source: sources.post, quote: f.quote, stance: "supports" }] : []),
  ];
  const changes = (answer.changes ?? [])
    .filter((c) => c?.text && (c.op === "add" || (c.op === "supersede" && c.target && known.has(c.target))))
    .slice(0, 5)
    .map((c) => ({
      op: c.op,
      text: String(c.text).slice(0, 1000),
      target: c.op === "supersede" ? c.target : null,
      scope: c.scope && typeof c.scope === "object" ? c.scope : {},
      valid_from: /^\d{4}-\d{2}-\d{2}$/.test(c.valid_from ?? "") ? c.valid_from : null,
      valid_until: /^\d{4}-\d{2}-\d{2}$/.test(c.valid_until ?? "") ? c.valid_until : null,
      rationale: String(c.rationale ?? "").slice(0, 4000),
      evidence,
    }));

  await DBOS.runStep(
    () => rpc("kb_agent_draft", { p_proposal: p.id, p_changes: changes, p_argument: String(answer.argument ?? "").slice(0, 4000) }),
    { name: "record the draft" },
  );
  return { proposal: p.id, changes: changes.length };
}

export const draftContest = DBOS.registerWorkflow(contestRun, { name: "checker-contest" });
