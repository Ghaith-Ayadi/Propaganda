// The live knowledge base backend: PostgREST reads on the kb_ tables and the
// five functions people may call (kb_remember, kb_contest, kb_submit,
// kb_close_flag, and the owners' kb_owner_rule, not used by these pages yet).
//
// NOT IN USE until two drafts in the project files are applied (adapter.ts
// says "placeholder" until then):
//   - kb-data-model/20261006000001_knowledge_base.sql: the tables and functions;
//   - kb-ui/20261008000012_kb_ui_views.sql: kb_claim_list (the list with weight,
//     post count and conflict state, sortable on the server),
//     kb_evidence_context (the text around each quote, cut on the server) and
//     kb_grade's total_weight and bad_weight columns.
// Every query is filtered by the active site. Nothing here is cached in Dexie.

import type { KnowledgeBackend } from "./adapter";
import { AppError, withCode } from "@/lib/errors";
import { siteId } from "@/lib/scope";
import { must, sb } from "@/lib/supabase";
import { postHref } from "@/lib/route";
import {
  letterFor,
  type CheckLine,
  type ClaimDetail,
  type ClaimSummary,
  type ContestState,
  type Decision,
  type FixPreview,
  type FlagDetail,
  type FlagStatus,
  type FlagSummary,
  type Letter,
  type PendingProposal,
  type Person,
  type ProposalStatus,
  type RecheckThread,
  type Topic,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const OPEN: FlagStatus[] = ["open", "snoozed"];
const CLOSED: FlagStatus[] = ["fixed", "reconciled", "wont_fix", "retracted", "cant_fix", "duplicate", "cleared"];
const COUNTS: FlagStatus[] = ["open", "snoozed", "wont_fix"];

let topicCache: { site: string; topics: Topic[] } | null = null;

async function allTopics(): Promise<Topic[]> {
  const site = siteId();
  if (topicCache?.site === site) return topicCache.topics;
  const rows = await must(sb.from("kb_topics").select("id, name, parent").eq("site", site).order("name"));
  const topics = (rows ?? []).map((r: Row) => ({ id: r.id, name: r.name, parent: r.parent ?? null }));
  topicCache = { site, topics };
  return topics;
}

/** A topic and everything under it. */
function subtree(topics: Topic[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const t of topics) if (t.parent === out[i]) out.push(t.id);
  return out;
}

async function peopleById(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const want = [...new Set(ids.filter(Boolean) as string[])];
  if (!want.length) return new Map();
  const rows = await must(sb.from("kb_people").select("id, name").in("id", want));
  return new Map((rows ?? []).map((r: Row) => [r.id, { id: r.id, name: r.name }]));
}

function toSummary(r: Row, topics: Topic[]): ClaimSummary {
  return {
    id: r.id,
    text: r.text,
    status: r.status,
    topics: (r.topics ?? []).map((id: string) => topics.find((t) => t.id === id)).filter(Boolean),
    validFrom: r.valid_from ?? null,
    weight: r.weight ?? 1,
    postCount: r.post_count ?? 0,
    inConflict: !!r.in_conflict,
    created: r.created,
  };
}

const LIST_COLUMNS = "id, text, status, valid_from, created, topics, weight, post_count, in_conflict";

async function decisionsById(ids: (string | null | undefined)[]): Promise<Map<string, Decision>> {
  const want = [...new Set(ids.filter(Boolean) as string[])];
  if (!want.length) return new Map();
  const rows = (await must(sb.from("kb_decisions").select("*").in("id", want))) ?? [];
  const people = await peopleById(rows.map((r: Row) => r.decided_by));
  return new Map(
    rows.map((r: Row) => [
      r.id,
      {
        id: r.id,
        verdict: r.verdict,
        argument: r.argument,
        checks: (r.checks ?? []) as CheckLine[],
        severity: r.severity,
        decidedBy:
          r.decided_by && people.get(r.decided_by)
            ? { kind: "person", person: people.get(r.decided_by)! }
            : { kind: "guardian", agent: r.agent || "guardian", policyVersion: r.policy_version ?? null },
        created: r.created,
      } satisfies Decision,
    ]),
  );
}

async function claimDetail(id: string): Promise<ClaimDetail | null> {
  const site = siteId();
  const topics = await allTopics();
  const [base, list] = await Promise.all([
    must(sb.from("kb_claims").select("*").eq("site", site).eq("id", id).maybeSingle()),
    must(sb.from("kb_claim_list").select(LIST_COLUMNS).eq("site", site).eq("id", id).maybeSingle()),
  ]);
  if (!base || !list) return null;
  const c = base as Row;

  const [evidence, rels, links, decisions, owners] = await Promise.all([
    must(sb.from("kb_evidence_context").select("id, source, quote, stance, before, after").eq("site", site).eq("claim", id)),
    must(sb.from("kb_relationships").select("id, kind, from_claim, to_claim").eq("site", site).or(`from_claim.eq.${id},to_claim.eq.${id}`)),
    must(sb.from("kb_post_claims").select("reliance, quote, post_version").eq("site", site).eq("claim", id)),
    decisionsById([c.decision, c.retired_by]),
    must(
      sb
        .from("kb_topic_owners")
        .select("person")
        .eq("site", site)
        .in("topic", (list as Row).topics ?? []),
    ),
  ]);

  const sourceIds = (evidence ?? []).map((e: Row) => e.source);
  const sources = sourceIds.length
    ? ((await must(sb.from("kb_sources").select("id, kind, tier, title, uri, occurred, person").in("id", sourceIds))) ?? [])
    : [];
  const otherIds = (rels ?? []).map((r: Row) => (r.from_claim === id ? r.to_claim : r.from_claim));
  const others = otherIds.length ? ((await must(sb.from("kb_claims").select("id, text, status").in("id", otherIds))) ?? []) : [];
  const versionIds = (links ?? []).map((l: Row) => l.post_version);
  const versions = versionIds.length
    ? ((await must(sb.from("post_versions").select("id, version, post, posts(title, status)").in("id", versionIds))) ?? [])
    : [];
  const people = await peopleById([c.remembered_by, ...sources.map((s: Row) => s.person), ...(owners ?? []).map((o: Row) => o.person)]);

  // The supersedes chain, newest first: each older version is the target of a
  // `supersedes` relationship from the one after it.
  const history: ClaimDetail["history"] = [];
  let cursor = id;
  for (let i = 0; i < 20; i++) {
    const r = await must(
      sb.from("kb_relationships").select("to_claim").eq("site", site).eq("kind", "supersedes").eq("from_claim", cursor).maybeSingle(),
    );
    if (!r) break;
    const prev = await must(sb.from("kb_claims").select("id, text, status, created").eq("id", (r as Row).to_claim).maybeSingle());
    if (!prev) break;
    history.push(prev as ClaimDetail["history"][number]);
    cursor = (prev as Row).id;
  }

  return {
    ...toSummary(list as Row, topics),
    scope: c.scope ?? {},
    validUntil: c.valid_until ?? null,
    reviewAfter: c.review_after ?? null,
    rationale: c.rationale ?? "",
    rememberedBy: c.remembered_by ? people.get(c.remembered_by) ?? null : null,
    retired: c.retired ?? null,
    owners: [...new Set((owners ?? []).map((o: Row) => o.person))].map((p) => people.get(p as string)).filter(Boolean) as Person[],
    evidence: (evidence ?? [])
      .map((e: Row) => {
        const s = sources.find((x: Row) => x.id === e.source) as Row | undefined;
        return {
          id: e.id,
          quote: e.quote,
          before: e.before ?? "",
          after: e.after ?? "",
          stance: e.stance,
          source: {
            id: e.source,
            kind: s?.kind ?? "document",
            tier: s?.tier ?? 5,
            title: s?.title ?? "",
            uri: s?.uri ?? "",
            occurred: s?.occurred ?? null,
            person: s?.person ? people.get(s.person) ?? null : null,
          },
        };
      })
      .sort((a: { source: { tier: number } }, b: { source: { tier: number } }) => a.source.tier - b.source.tier),
    relationships: (rels ?? []).map((r: Row) => {
      const out = r.from_claim === id;
      const o = others.find((x: Row) => x.id === (out ? r.to_claim : r.from_claim)) as Row;
      return { id: r.id, kind: r.kind, direction: out ? "out" : "in", other: { id: o?.id, text: o?.text ?? "", status: o?.status } };
    }),
    posts: (links ?? []).map((l: Row) => {
      const v = versions.find((x: Row) => x.id === l.post_version) as Row | undefined;
      return {
        postId: v?.post ?? "",
        title: v?.posts?.title || "Untitled",
        version: v?.version ?? 0,
        reliance: l.reliance,
        quote: l.quote,
        published: v?.posts?.status === "published",
      };
    }),
    admittedBy: decisions.get(c.decision) ?? null,
    retiredBy: decisions.get(c.retired_by) ?? null,
    history,
  };
}

function flagSummary(r: Row, claimText: string): FlagSummary {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    postId: r.post ?? null,
    postTitle: r.posts?.title || (r.post ? "Untitled" : "Two claims disagree"),
    headline: claimText.length > 70 ? claimText.slice(0, 69) + "…" : claimText,
    // kb_flags.urgency is proposed in kb-ui/20261008000012_kb_ui_views.sql; the Guardian sets it.
    urgency: r.urgency === "high" ? "high" : "normal",
    confidence: null,
    created: r.created,
    batch: r.batch ?? null,
  };
}

/** The draft stores the replacement text; the quote is what it replaces. */
function fixOf(r: Row): FixPreview | null {
  return r.suggested_fix ? { before: "", removed: r.quote ?? "", added: r.suggested_fix, after: "", section: "" } : null;
}

async function contestOf(flagId: string): Promise<ContestState | null> {
  const p = await must(
    sb.from("kb_proposals").select("id, status, summary").eq("flag", flagId).eq("origin", "contest").order("created", { ascending: false }).limit(1).maybeSingle(),
  );
  if (!p) return null;
  const pr = p as Row;
  const [changes, decs] = await Promise.all([
    must(sb.from("kb_changes").select("op, text").eq("proposal", pr.id).order("position")),
    must(sb.from("kb_decisions").select("id").eq("proposal", pr.id).order("created", { ascending: false }).limit(1)),
  ]);
  const decision = decs?.[0] ? (await decisionsById([(decs[0] as Row).id])).get((decs[0] as Row).id) ?? null : null;
  const axis = /^Axis: (time|scope|audience|wording)\. /.exec(pr.summary ?? "");
  return {
    proposalId: pr.id,
    status: pr.status as ProposalStatus,
    reason: (pr.summary ?? "").replace(/^Axis: \w+\. /, ""),
    axis: (axis?.[1] as ContestState["axis"]) ?? null,
    changes: (changes ?? []).map((c: Row) => ({ op: c.op, text: c.text })),
    decision,
  };
}

export const liveKb: KnowledgeBackend = {
  sample: false,

  topics: () => withCode("KB-LOAD", allTopics()),

  claims: (q) =>
    withCode(
      "KB-LOAD",
      (async () => {
        const site = siteId();
        const topics = await allTopics();
        let query = sb.from("kb_claim_list").select(LIST_COLUMNS, { count: "exact" }).eq("site", site).in("status", q.statuses);
        if (q.topic) query = query.overlaps("topics", subtree(topics, q.topic));
        if (q.problemsOnly) query = query.or("status.eq.contested,in_conflict.is.true");
        if (q.search.trim()) {
          // Keyword search ranks on the server (kb_search, no embedding from the
          // browser); the list then keeps its own order among the matches.
          const hits = (await must(
            sb.rpc("kb_search", { p_site: site, p_query: q.search.trim(), p_limit: 200, p_statuses: q.statuses }),
          )) as Row[] | null;
          query = query.in("id", (hits ?? []).map((h) => h.id));
        }
        query = q.sort === "weight" ? query.order("weight", { ascending: false }).order("created", { ascending: false }) : query.order("created", { ascending: false });
        const { data, error, count, status } = await query.range(q.offset, q.offset + q.limit - 1);
        if (error) await must(Promise.resolve({ data, error, status }));
        const total = count ?? 0;
        return {
          rows: (data ?? []).map((r: Row) => toSummary(r, topics)),
          total,
          next: q.offset + q.limit < total ? q.offset + q.limit : null,
        };
      })(),
    ),

  claim: (id) => withCode("KB-LOAD", claimDetail(id)),

  pending: () =>
    withCode(
      "KB-LOAD",
      (async () => {
        const rows =
          (await must(
            sb
              .from("kb_proposals")
              .select("id, origin, status, title, opened_by, created")
              .eq("site", siteId())
              .in("status", ["open", "escalated"])
              .order("created", { ascending: false })
              .limit(20),
          )) ?? [];
        const people = await peopleById(rows.map((r: Row) => r.opened_by));
        return rows.map(
          (r: Row): PendingProposal => ({
            id: r.id,
            origin: r.origin,
            status: r.status,
            title: r.title,
            openedBy: people.get(r.opened_by) ?? null,
            created: r.created,
          }),
        );
      })(),
    ),

  remember: (input) =>
    withCode(
      "KB-REMEMBER",
      must(sb.rpc("kb_remember", { p_site: siteId(), p_text: input.text, p_topics: input.topics, p_scope: input.scope })) as Promise<string>,
    ),

  flags: (q) =>
    withCode(
      "KB-LOAD",
      (async () => {
        let query = sb
          .from("kb_flags")
          .select("id, kind, status, post, claim, batch, urgency, created, posts(title)", { count: "exact" })
          .eq("site", siteId())
          .in("status", q.status === "open" ? OPEN : CLOSED);
        query = q.kind === "all" ? query.neq("kind", "recheck") : query.eq("kind", q.kind);
        let urgentQuery = sb
          .from("kb_flags")
          .select("id", { count: "exact", head: true })
          .eq("site", siteId())
          .eq("urgency", "high")
          .in("status", q.status === "open" ? OPEN : CLOSED);
        urgentQuery = q.kind === "all" ? urgentQuery.neq("kind", "recheck") : urgentQuery.eq("kind", q.kind);
        // Urgent first ("high" sorts before "normal"), then newest.
        const [{ data, error, count, status }, urgent] = await Promise.all([
          query.order("urgency").order("created", { ascending: false }).range(q.offset, q.offset + q.limit - 1),
          urgentQuery,
        ]);
        if (error) await must(Promise.resolve({ data, error, status }));
        const rows = data ?? [];
        const claimIds = [...new Set(rows.map((r: Row) => r.claim))];
        const texts = claimIds.length ? ((await must(sb.from("kb_claims").select("id, text").in("id", claimIds))) ?? []) : [];
        const total = count ?? 0;
        return {
          rows: rows.map((r: Row) => flagSummary(r, (texts.find((t: Row) => t.id === r.claim) as Row)?.text ?? "")),
          total,
          urgent: urgent.count ?? 0,
          next: q.offset + q.limit < total ? q.offset + q.limit : null,
        };
      })(),
    ),

  flag: (id) =>
    withCode(
      "KB-LOAD",
      (async () => {
        const r = (await must(sb.from("kb_flags").select("*, posts(title)").eq("site", siteId()).eq("id", id).maybeSingle())) as Row | null;
        if (!r) return null;
        const [claim, other, contest] = await Promise.all([
          claimDetail(r.claim),
          r.other_claim ? claimDetail(r.other_claim) : Promise.resolve(null),
          contestOf(r.id),
        ]);
        if (!claim) return null;
        return {
          ...flagSummary(r, claim.text),
          passage: { before: "", quote: r.quote, after: "", section: "", uri: r.post ? postHref(r.post) : "" },
          claim,
          otherClaim: other,
          explanation: r.explanation,
          suggestedAction: r.suggested_action,
          fix: fixOf(r),
          note: r.note,
          snoozedUntil: r.snoozed_until,
          contest,
          cantFixReason: r.status === "cant_fix" ? "This kind of content can't be edited after it goes out." : null,
        } satisfies FlagDetail;
      })(),
    ),

  closeFlag: (id, status, opts) =>
    withCode(
      "KB-FLAG-CLOSE",
      must(
        sb.rpc("kb_close_flag", {
          p_flag: id,
          p_status: status,
          p_note: opts?.note ?? "",
          p_until: opts?.until ?? null,
          p_duplicate_of: opts?.duplicateOf ?? null,
        }),
      ).then(() => undefined),
    ),

  async applyFix() {
    // Applying a fix means a new post version, which the editor writes; the
    // reviewing agent then closes the flag as fixed. Until that path exists,
    // the page opens the post instead (FlagDetailView hides this button live).
    throw new AppError("KB-FIX", "Applying a fix from here isn't available yet. Open the post and make the change.");
  },

  contest: (flagId, reason, axis) =>
    withCode(
      "KB-CONTEST",
      (async () => {
        await must(sb.rpc("kb_contest", { p_flag: flagId, p_reason: axis ? `Axis: ${axis}. ${reason}` : reason }));
        return (await contestOf(flagId))!;
      })(),
    ),

  submitContest: (flagId) =>
    withCode(
      "KB-CONTEST",
      (async () => {
        const c = await contestOf(flagId);
        if (!c) throw new Error("Nothing to submit.");
        await must(sb.rpc("kb_submit", { p_proposal: c.proposalId }));
        return (await contestOf(flagId))!;
      })(),
    ),

  rechecks: () =>
    withCode(
      "KB-LOAD",
      (async () => {
        const rows =
          (await must(sb.from("kb_flags").select("batch, status, claim").eq("site", siteId()).eq("kind", "recheck").not("batch", "is", null))) ?? [];
        const byBatch = new Map<string, Row[]>();
        for (const r of rows as Row[]) byBatch.set(r.batch, [...(byBatch.get(r.batch) ?? []), r]);
        const decisions = await decisionsById([...byBatch.keys()]);
        const claimIds = [...new Set((rows as Row[]).map((r) => r.claim))];
        const texts = claimIds.length ? ((await must(sb.from("kb_claims").select("id, text").in("id", claimIds))) ?? []) : [];
        return [...byBatch.entries()]
          .map(([batch, items]) => {
            const d = decisions.get(batch);
            const text = (texts.find((t: Row) => t.id === items[0].claim) as Row)?.text ?? "A claim";
            return {
              id: batch,
              title: `"${text}" changed`,
              severity: d?.severity ?? "",
              open: items.filter((i) => OPEN.includes(i.status)).length,
              total: items.length,
              created: d?.created ?? "",
            };
          })
          .sort((a, b) => b.created.localeCompare(a.created));
      })(),
    ),

  recheck: (id) =>
    withCode(
      "KB-LOAD",
      (async () => {
        const d = (await decisionsById([id])).get(id);
        if (!d) return null;
        const items = ((await must(sb.from("kb_flags").select("*, posts(title)").eq("site", siteId()).eq("batch", id).order("created"))) ?? []) as Row[];
        if (!items.length) return null;
        const old = (await must(sb.from("kb_claims").select("id, text, topics:kb_claim_topics(topic)").eq("id", items[0].claim).maybeSingle())) as Row | null;
        const rel = (await must(
          sb.from("kb_relationships").select("from_claim").eq("kind", "supersedes").eq("to_claim", items[0].claim).maybeSingle(),
        )) as Row | null;
        const next = rel ? ((await must(sb.from("kb_claims").select("id, text").eq("id", rel.from_claim).maybeSingle())) as Row | null) : null;
        const owner = items[0].assignee ? (await peopleById([items[0].assignee])).get(items[0].assignee) ?? null : null;
        return {
          id,
          title: `"${old?.text ?? "A claim"}" changed`,
          severity: d.severity,
          open: items.filter((i) => OPEN.includes(i.status)).length,
          total: items.length,
          created: d.created,
          oldClaim: { id: old?.id ?? "", text: old?.text ?? "" },
          newClaim: next ? { id: next.id, text: next.text } : null,
          decision: d,
          owner,
          items: items.map((f) => ({
            flagId: f.id,
            postId: f.post ?? "",
            postTitle: f.posts?.title || "Untitled",
            status: f.status,
            tldr: f.explanation,
            quote: f.quote,
            // The paragraph around a post's quote isn't stored yet: the quote alone.
            before: "",
            after: "",
            suggestedAction: f.suggested_action,
            fix: fixOf(f),
          })),
        } satisfies RecheckThread;
      })(),
    ),

  bulk: (ids, action) =>
    withCode(
      "KB-BULK",
      (async () => {
        if (action === "apply_fix") throw new AppError("KB-FIX", "Applying fixes from here isn't available yet.");
        const until = action === "snooze" ? new Date(Date.now() + 7 * 864e5).toISOString() : null;
        for (const id of ids) {
          await must(sb.rpc("kb_close_flag", { p_flag: id, p_status: action === "snooze" ? "snoozed" : action, p_note: "", p_until: until, p_duplicate_of: null }));
        }
      })(),
    ),

  grades: () =>
    withCode(
      "KB-LOAD",
      (async () => {
        const site = siteId();
        const [content, knowledge, counting, todo, topics] = await Promise.all([
          must(sb.from("kb_content_grade").select("posts, flagged, grade").eq("site", site).maybeSingle()),
          must(sb.from("kb_grade").select("claims, contested, in_conflict, grade, total_weight, bad_weight").eq("site", site).maybeSingle()),
          must(
            sb
              .from("kb_flags")
              .select("post, kind, status, batch, claim")
              .eq("site", site)
              .in("kind", ["contradiction", "recheck"])
              .in("status", COUNTS)
              .not("post", "is", null)
              .limit(2000),
          ),
          must(
            sb
              .from("kb_claim_list")
              .select(LIST_COLUMNS)
              .eq("site", site)
              .in("status", ["settled", "contested"])
              .or("status.eq.contested,in_conflict.is.true")
              .order("weight", { ascending: false })
              .limit(8),
          ),
          allTopics(),
        ]);
        const c = (content ?? { posts: 0, flagged: 0, grade: "A" }) as Row;
        const k = (knowledge ?? { claims: 0, contested: 0, in_conflict: 0, grade: "A", total_weight: 0, bad_weight: 0 }) as Row;
        const rows = (counting ?? []) as Row[];
        const postsWhere = (fn: (r: Row) => boolean) => new Set(rows.filter(fn).map((r) => r.post)).size;
        const claimTopics = rows.length
          ? (((await must(sb.from("kb_claim_topics").select("claim, topic").in("claim", [...new Set(rows.map((r) => r.claim))]))) ?? []) as Row[])
          : [];
        const themes = new Map<string, { label: string; posts: Set<string>; href: string }>();
        for (const r of rows) {
          const topic = claimTopics.find((t) => t.claim === r.claim)?.topic;
          const key = r.batch ?? topic ?? "other";
          const label = r.batch ? "Re-check after a change" : topics.find((t) => t.id === topic)?.name ?? "Other";
          const e = themes.get(key) ?? { label, posts: new Set<string>(), href: r.batch ? `#/knowledge/rechecks/${r.batch}` : "#/knowledge/flags" };
          e.posts.add(r.post);
          themes.set(key, e);
        }
        const posts = Number(c.posts) || 0;
        const share = posts ? 1 - Number(c.flagged) / posts : 1;
        const total = Number(k.total_weight) || 0;
        const kbShare = total ? 1 - Number(k.bad_weight) / total : 1;
        return {
          content: {
            letter: (c.grade as Letter) ?? letterFor(share),
            posts,
            flagged: Number(c.flagged) || 0,
            share,
            breakdown: {
              open: postsWhere((r) => r.kind === "contradiction" && r.status === "open"),
              snoozed: postsWhere((r) => r.status === "snoozed"),
              wontFix: postsWhere((r) => r.status === "wont_fix"),
              rechecks: postsWhere((r) => r.kind === "recheck" && r.status === "open"),
            },
            notes: [...themes.values()]
              .map((e) => ({ label: e.label, count: e.posts.size, href: e.href }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5),
          },
          knowledge: {
            letter: (k.grade as Letter) ?? letterFor(kbShare),
            claims: Number(k.claims) || 0,
            contested: Number(k.contested) || 0,
            inConflict: Number(k.in_conflict) || 0,
            share: kbShare,
            totalWeight: total,
            badWeight: Number(k.bad_weight) || 0,
            todo: ((todo ?? []) as Row[]).map((r) => toSummary(r, topics)),
          },
        };
      })(),
    ),

  postFindings: (postId) =>
    withCode(
      "KB-LOAD",
      (async () => {
        const [check, flags] = await Promise.all([
          must(
            sb.from("kb_checks").select("report, created").eq("site", siteId()).eq("post", postId).order("created", { ascending: false }).limit(1).maybeSingle(),
          ) as Promise<Row | null>,
          must(
            sb
              .from("kb_flags")
              .select("id, kind, status, quote, claim, explanation, suggested_action, suggested_fix")
              .eq("site", siteId())
              .eq("post", postId)
              .in("status", OPEN)
              .order("created"),
          ) as Promise<Row[] | null>,
        ]);
        const rows = flags ?? [];
        const claimIds = [...new Set(rows.map((r) => r.claim))];
        const texts = claimIds.length ? (((await must(sb.from("kb_claims").select("id, text").in("id", claimIds))) ?? []) as Row[]) : [];
        const report = (check?.report ?? {}) as Row;
        return {
          checkedAt: check?.created ?? null,
          sources: Array.isArray(report.sources)
            ? report.sources.map((x: Row) => ({ quote: String(x.quote ?? ""), url: String(x.url ?? ""), verdict: x.verdict, note: String(x.note ?? "") }))
            : [],
          remember: Array.isArray(report.remember) ? report.remember.map((x: Row) => ({ text: String(x.text ?? ""), quote: String(x.quote ?? "") })) : [],
          flags: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            quote: r.quote,
            claim: texts.find((t) => t.id === r.claim)?.text ?? "",
            explanation: r.explanation,
            suggestedAction: r.suggested_action,
            fix: r.suggested_fix || null,
          })),
        };
      })(),
    ),
};
