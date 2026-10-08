// The Guardian: the only path that changes the knowledge base. It reads one
// proposal (a Remember, a contest, the Listener's facts, a sweep, a chat
// branch), runs policy v1's checks with the model, decides the verdict in code
// (verdict.ts) and rules through kb_guardian_decide. It rejects agents' proposals,
// never a person's Remember (the database refuses that too).
//
// Model: the advanced tier (Opus). It never sees the whole knowledge base:
// only the proposal, its evidence and the claims retrieved around it.

import { readFileSync } from "node:fs";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { ask } from "./ai.js";
import { MODELS } from "./model.js";
import { config } from "../config.js";
import * as read from "../kb/read.js";
import { rpc } from "./backend.js";
import { numbersMatch } from "./text.js";
import { cleanChecks, decide, severityOf, type Check, type Verdict } from "./verdict.js";

const BUNDLED_POLICY = { version: 1, body: readFileSync(new URL("./guardian-policy-v1.md", import.meta.url), "utf8") };

interface Ruling {
  checks: unknown;
  contested_changes?: unknown;
  relations?: unknown;
  severity?: string;
  argument?: string;
}

export interface GuardianResult {
  proposal: string;
  verdict: Verdict | "skipped";
  decision?: string;
  checks?: Check[];
}

const OUTPUT = `Answer with one JSON object and nothing else:
{
  "checks": [{"check": "C1", "result": "pass|weak|fail|escalate", "reason": "one line"}, ...],
  "contested_changes": ["<change id>", ...],
  "relations": [{"change": "<change id>", "claim": "<claim id>", "relation": "contradicts|refines|depends_on"},
                {"change": "<change id>", "other_change": "<change id>", "relation": "contradicts"}],
  "severity": "patch|minor|major|",
  "argument": "three lines at most: what changes, which check decided it, what would change your mind"
}
- List every check that applies to this proposal (C1-C8 for each added claim, C9-C10 on a push back,
  C11 on a supersede or retract, where C11's result is its severity: patch, minor or major).
- "relations": every relationship you found between a claim this proposal adds (by its change id) and a
  live claim listed under "Nearby" (by its claim id), or between two of its own changes. A Remember that
  contradicts a live claim must have its "contradicts" relation here: that is how the owner gets the flag.
- "contested_changes": only in the first sweep, the changes that go in contested (the older side of a
  disagreement).`;

function describeProposal(
  p: read.Proposal,
  cs: read.Change[],
  flaggedVersion: string | null,
  extra: Record<string, unknown>,
): string {
  return JSON.stringify(
    {
      proposal: { id: p.id, origin: p.origin, title: p.title, summary: p.summary, axis: p.axis || undefined },
      changes: cs.map((c) => ({
        id: c.id,
        op: c.op,
        text: c.text || undefined,
        target: c.target ?? undefined,
        other: c.other ?? undefined,
        relation: c.relation ?? undefined,
        scope: Object.keys(c.scope ?? {}).length ? c.scope : undefined,
        valid_from: c.valid_from ?? undefined,
        valid_until: c.valid_until ?? undefined,
        rationale: c.rationale || undefined,
        evidence: c.evidence.map((e) => ({
          quote: e.quote,
          stance: e.stance ?? "supports",
          kind: e.kind,
          tier: e.tier,
          date: e.occurred ?? undefined,
          is_the_flagged_post: flaggedVersion && e.post_version === flaggedVersion ? true : undefined,
        })),
      })),
      ...extra,
    },
    null,
    1,
  );
}

async function guardianRun(proposalId: string, round: number): Promise<GuardianResult> {
  const context = await DBOS.runStep(
    async () => {
      const p = await read.proposal(proposalId);
      if (!p || p.status !== "open" || p.decisions !== round) return null;
      const cs = await read.changes(p.id);
      const policy = (await read.sitePolicy(p.site)) ?? BUNDLED_POLICY;

      // What each change touches: the claims it retires, and what's already
      // said near each claim it adds.
      const targetIds = cs.flatMap((c) => [c.target, c.other]).filter((x): x is string => !!x);
      const targets = await read.claimsById(targetIds);
      const nearby = new Map<string, read.Claim>();
      for (const c of cs) {
        if (!c.text) continue;
        for (const hit of await read.searchClaims(p.site, c.text, 10)) nearby.set(hit.id, hit);
      }
      for (const t of targets) nearby.delete(t.id);

      let flag: read.Flag | null = null;
      if (p.flag) flag = await read.flag(p.flag);

      const hints = cs
        .filter((c) => c.text && (c.op === "add" || c.op === "supersede"))
        .map((c) => ({ change: c.id, c5: numbersMatch(c.text, c.evidence.map((e) => e.quote)) }))
        .filter((h) => !h.c5.ok)
        .map((h) => ({ change: h.change, numbers: h.c5.problems }));

      return { p, cs, policy, targets, nearby: [...nearby.values()], flag, hints };
    },
    { name: "read the proposal" },
  );
  if (!context) return { proposal: proposalId, verdict: "skipped" };
  const { p, cs, policy, targets, nearby, flag, hints } = context;

  const prompt = describeProposal(p, cs, flag?.post_version ?? null, {
    pushed_back_flag: flag
      ? { claim: flag.claim_text, post_quote: flag.quote, why_flagged: flag.explanation || undefined }
      : undefined,
    retires: targets.map((t) => ({ id: t.id, text: t.text, status: t.status, remembered: t.remembered, owned_topic: t.owned })),
    nearby: nearby.map((c) => ({ id: c.id, text: c.text, status: c.status, scope: c.scope, topics: c.topics })),
    worker_number_check: hints.length ? hints : undefined,
  });

  const ruling = await ask<Ruling>("check the proposal", {
    site: p.site,
    job: "guardian",
    model: MODELS.advanced,
    system: `${policy.body}\n\n---\n\n${OUTPUT}`,
    prompt: `The proposal, its evidence and the claims around it:\n\n${prompt}`,
  });

  const changeIds = new Set(cs.map((c) => c.id));
  const claimIds = new Set([...nearby.map((c) => c.id), ...targets.map((t) => t.id)]);
  const checks = cleanChecks(ruling.checks);
  const retiresProtected = cs.some(
    (c) => (c.op === "supersede" || c.op === "retract") && targets.some((t) => t.id === c.target && (t.remembered || t.owned)),
  );
  const decided = decide({ origin: p.origin, checks, retiresProtected });
  let verdict = decided.verdict;

  // Relationships the ruling found, kept only when they name this proposal's
  // changes and claims it was shown.
  const relations = (Array.isArray(ruling.relations) ? ruling.relations : [])
    .map((r: Record<string, unknown>) => ({
      change: typeof r.change === "string" && changeIds.has(r.change) ? r.change : undefined,
      claim: typeof r.claim === "string" && claimIds.has(r.claim) ? r.claim : undefined,
      other_change: typeof r.other_change === "string" && changeIds.has(r.other_change) ? r.other_change : undefined,
      relation: ["contradicts", "refines", "depends_on"].includes(String(r.relation)) ? String(r.relation) : undefined,
    }))
    .filter((r) => r.change && r.relation && (r.claim || r.other_change) && r.other_change !== r.change)
    .map((r) => ({ change: r.change, relation: r.relation, ...(r.claim ? { other: r.claim } : { other_change: r.other_change }) }));

  let contested: string[] = [];
  if (decided.sweepContested) {
    contested = (Array.isArray(ruling.contested_changes) ? ruling.contested_changes : []).filter(
      (id): id is string => typeof id === "string" && changeIds.has(id),
    );
    if (!contested.length) verdict = "admit_contested";
  }

  const severity = severityOf(checks, cs.map((c) => c.op));
  const argument = (ruling.argument ?? "").trim().slice(0, 4000) || `${verdict} by policy v${policy.version}.`;

  const decision = await DBOS.runStep(
    () =>
      rpc<string>("kb_guardian_decide", {
        p_proposal: p.id,
        p_verdict: verdict,
        p_argument: argument,
        p_checks: decided.checks,
        p_severity: severity,
        p_agent: `guardian:${MODELS.advanced}`,
        p_policy_version: policy.version,
        p_relations: verdict === "admit" || verdict === "admit_contested" ? relations : [],
        p_contested: contested,
      }),
    { name: "rule" },
  );
  return { proposal: p.id, verdict, decision, checks: decided.checks };
}

export const guardian = DBOS.registerWorkflow(guardianRun, { name: "guardian" });
