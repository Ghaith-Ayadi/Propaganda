# The knowledge base

Propaganda 0.2. The schema is `supabase/migrations/20261008000010_knowledge_base.sql`
(tables, rules, search, grades, the read views the Knowledge pages use) and
`20261008000011_kb_agents.sql` (what the agents write through). The agents are in
`worker/src/agents/` (see `worker/README.md`). Tests: `supabase/tests/kb/run.sh`
(the SQL, on any Postgres with pgvector) and `supabase/tests/kb_agents.mjs` (the
worker end to end on the laptop stack).

Designed 2026-10-06 (Notion PPG-87, PPG-90); the Guardian's rule set is
`worker/src/agents/guardian-policy-v1.md`, its regression cases
`worker/test/guardian-fixtures.yaml`.

## Changes since the design draft

- `kb_flags.status` gains `cleared` (a re-check whose post still holds) and
  `checked` (when the agent read the post). An open re-check counts in the
  content grade only once checked.
- `kb_changes.contested` (per change: the first sweep admits the newer post's
  claim settled and the older contested), and `target_change` / `other_change`
  so a relationship can name a claim the same proposal adds (a Remember that
  contradicts a live claim).
- `kb_decisions.checks` has a fixed shape, `[{check: "C8", result, reason}]`.
- `kb_proposals.axis` (time, scope, audience, wording) for contests; `kb_contest`
  takes it.
- `kb_search(..., p_any)` matches any word, for agents searching with a whole passage.
- `kb_grade` reports `total_weight` and `bad_weight`; `kb_claim_list` and
  `kb_evidence_context` are the list and quote views.
- New: `kb_agent_sites` (which tenants the agents work for, and since when) and
  `kb_checks` (the Checker's report per post version).
- Not taken from the grades doc: the goals tables and `briefs.coverage`/`topic`
  (they belong to the Goals and Pitcher work).

## The shape

Fourteen tables (plus the agents' two), all prefixed `kb_`, all keyed on `site`. That's it: no pages, no graph database, no second store.

| Table | Holds |
|---|---|
| `kb_claims` | One plain sentence each, with status (Settled, Contested, Superseded, Retracted), scope, dates, rationale, who remembered it, and its embedding and keyword index. **Each row is a version**: a change is a new row. |
| `kb_relationships` | Claim to claim: supersedes, contradicts, refines, depends_on |
| `kb_topics`, `kb_claim_topics` | A light tree, reorganised freely. Claims point at topics, never at pages. |
| `kb_people`, `kb_topic_owners` | People (from Slack or on first use) and who owns which topic. One `top_authority` flag rules on everything. |
| `kb_sources`, `kb_evidence` | Everything that can be cited (call, document, Slack, chat, post version, a person's Remember, external signal) with a tier, its text, and a pointer to the original file in the object store; and the exact quoted span backing or contradicting a claim |
| `kb_proposals`, `kb_changes` | Pull requests: a proposal is a set of changes (add, supersede, retract, relate) that land together or not at all. A **draft** proposal with many changes is a **branch** (a repositioning). |
| `kb_decisions` | The review: admit, admit as contested, reject, escalate, with the argument, the named checks, the change severity (patch, minor, major), and who ruled (Guardian model and rule-set version, or a person). Append-only. |
| `kb_post_claims` | The lockfile: which claims each **post version** relies on (asserts, assumes, mentions). Both directions are one query. |
| `kb_flags` | The inbox: a post contradicts a claim, a post needs a re-check, or two claims contradict each other |
| `kb_policies` | The Guardian's judgment rules as a versioned text per site |

People are never in claim text: `remembered_by`, `opened_by` and `decided_by` are columns.

## Rules enforced by the database, not the app

These are deterministic, so they live in SQL. Judgment lives in the Guardian's prompt and rule set.

1. **The Guardian is the only writer.** Browsers can read every `kb_` table of their site but can't insert a claim, relationship, evidence or decision. They call five functions: `kb_remember`, `kb_contest`, `kb_submit`, `kb_close_flag`, `kb_owner_rule`. The Guardian's worker calls `kb_guardian_decide` with the service key, and that's the only path that changes claims.
2. **A Remember is never rejected.** The Guardian can only admit it and flag what it contradicts (a `contradicts` relationship opens a `kb_conflict` flag for the owner).
3. **Owners decide.** Superseding or retracting a remembered claim, or any claim in an owned topic, needs an owner of that topic (or a parent topic) or the top authority. The Guardian has to escalate. Adding new claims to an owned topic doesn't need the owner: that would drown them during the first sweep.
4. **Meaning is never edited.** A claim's text, scope and dates are frozen; only status, rationale and embedding change. History is the chain of `supersedes`.
5. **Decisions are append-only.** Arguing again is a second decision.
6. **One admission at a time per site** (an advisory lock), and a proposal whose target was retired meanwhile fails and has to be re-run against the current knowledge base, like a merge queue.
7. **Can't fix is never chosen by hand.** People can mark a flag won't fix, retracted (they took the content down), snoozed or duplicate. Fixed and reconciled come from the agent and the Guardian; can't fix comes from the object type.

## The flows

**Remember.** A person selects a sentence and clicks Remember. `kb_remember` stores the person as a tier-1 source and opens a proposal. The Guardian admits it as Settled, runs its checks, and flags anything it contradicts.

**Ingestion (calls, documents, Slack, chats).** Calls come from Google Meet, Zoom and Teams directly (in 0.2). Each item becomes a `kb_sources` row. A cheap model extracts candidate claims with their quoted spans. For each candidate, the worker runs `kb_search` to pull the 10 to 20 nearest existing claims, never the whole knowledge base. Candidates that only repeat what's known add evidence. Everything new or conflicting is grouped into one proposal per source, and the Guardian rules on it. A weak answer in a call is a content gap, which becomes a pitch, not a claim.

**Slack** is likely the richest source: it's where ideas start and where the subject-matter experts state facts. A thread is one source, with its permalink and its people linked to `kb_people` by Slack id. When a topic's owner states a fact in Slack, that's strong evidence, and the natural move is to ask them in Slack whether to Remember it. Ideas found in Slack become pitches, not claims.

**Posts.** When a post version is saved for review, the reviewing agent splits it into passages, searches claims for each, links the version to every claim it relies on (`kb_post_claims`), and opens a `contradiction` flag for each conflict. Posts are also sources, at the lowest tier, so the first sweep over existing posts seeds the knowledge base this way.

**External signals** (search and AI-search data) are stored as `signal` sources and never mined for claims. They feed ideas and coverage, so the knowledge base doesn't only learn from itself.

**A flag, then contest.** On a flagged post, the person can fix the post (the agent sees the new version and closes the flag as fixed), mark it won't fix (closed, still counts against the grade), take the content down (retracted: closed, and out of the grade because the content is gone), or contest the flag with one sentence. `kb_contest` opens a draft proposal tied to the flag. The agent turns the sentence into changes (usually missing scope or a date) and the argument; the person submits. If the Guardian admits it, the flag closes as reconciled. A weak but not wrong argument is admitted as Contested, which lowers the knowledge base grade until someone settles it.

**A change, then one re-check thread.** When a claim is superseded or retracted (severity minor or major; patch skips this), every post whose version relies on it gets a `recheck` flag, all with the same `batch` (the decision). That's the Renovate-style thread: one per change, with bulk actions, assigned to the topic owner. The agent fills in the suggested action (leave, edit wording, rewrite, add a dated note, unpublish) and fix.

**Repositioning.** In chat, the operator and the agent build one draft proposal with all the supersessions. They preview the affected posts (a query on `kb_post_claims`), then submit. The owner rules, everything lands at once, and the re-checks arrive as one thread.

## The object store

Every original we pull (a recording or transcript file, a PDF, a scraped page's HTML) goes into a **private Cloudflare R2 bucket**, the same provider Bedrock already uses for backups, under `<site>/<source id>/<file name>`. `kb_sources` keeps the key, type, size and a SHA-256, so the same transcript or page pulled twice is stored once per site. The extracted text stays in Postgres (`kb_sources.body`), because search, quotes and the context around a quote need it there. Only the server-side worker touches the bucket; browsers get short-lived signed links when someone opens an original. Not Vercel Blob: it serves public image URLs, and company sources must stay private.

## Retrieval

`kb_search(site, query, embedding)` merges keyword search (Postgres full text) and meaning search (pgvector, cosine, HNSW index) by reciprocal rank, and returns Settled and Contested claims with their topics by default. It runs with the caller's rights, so a member only ever searches their own sites. Agents render the hits as one sentence per line under topic headings, with ids, which reads almost like prose.

Embeddings are 1024 numbers (the Qwen3-Embedding or BGE-M3 class, which you can run yourself or call cheaply). The worker fills them in; changing model later means re-embedding a few hundred rows.

**Token cost, order of magnitude** (an estimate, prices not checked today): checking one post or ingesting one call is about 10 to 30k tokens (the item plus 20 claims per passage, plus the Guardian's ruling). At DeepSeek or Kimi prices that's around a cent. A full first sweep of 200 posts is a few dollars.

## Grades (first version)

Two views, shares with fixed bands (A at 95% and up, B 85%, C 70%, D 50%, from the Goals page), meant to be recalibrated on real projects:

- `kb_content_grade`: the share of published posts with no open, snoozed or won't-fix flag. Can't-fix flags are left out.
- `kb_grade`: the share of live claims that are Settled and in no open contradiction, each weighted by 1 + the number of posts relying on it, so splitting claims into trivial ones can't game it.

## Decided (Ayadi, 2026-10-06)

- **Organisation = site, for now.** "One knowledge base per organisation" is one per site today, since that's Propaganda's tenant. If an organisation ever has several sites, the knowledge base moves up a level.
- **Retiring a remembered or owned claim needs its owner or the top authority.**
- **The Guardian can reject an agent's proposal** (a sweep, a call, a contest) with a reason. It doesn't reject a Remember, because we have no reason to yet: that can change if one shows up. The prototype still shows the Guardian rejecting a claim.
- **Any one owner of a claim's topics may rule**, not all of them. The top authority breaks ties.

## Other defaults

- **Plain `public` tables with a `kb_` prefix**, not a separate schema, so PostgREST serves them with no Bedrock config change. They are not in the Dexie sync because sync lists its tables explicitly.
- **Versions are rows**, linked by `supersedes`, rather than a version number on a stable claim id. It handles a claim split in two or two merged into one.

## Not built yet

- Embeddings: `kb_claims.embedding` stays empty, so retrieval is keyword-only (any word, ranked). Fine at a few hundred claims; the worker fills embeddings once the gateway can embed.
- The first sweep over existing posts, the Listener (calls, Slack) and the R2 object store.
- Social and email objects: flags point at blog posts only, matching 0.2's blog-only scope.
- Teams as topic owners, SLA defaults for `due`, auto-closing stale contested claims, the weekly changelog (a query over `kb_decisions`), and realtime on flags for the inbox.
