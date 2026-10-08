# The worker

Propaganda's agents run here, as [DBOS](https://docs.dbos.dev) workflows, in
one Node process on the Bedrock box (`propaganda-worker` in Bedrock's
`compose/propaganda-supabase`). It also serves the **Runs API** that Admin's
Runs page reads (`app/src/components/admin/RunsPage.tsx`).

| File | What |
|---|---|
| `src/main.ts` | Starts DBOS (which resumes every run that was in flight), then the HTTP server |
| `src/config.ts` | Settings, all from the environment |
| `src/limits.ts` | The Claude Max usage limit: `modelStep()` waits it out instead of failing |
| `src/runs.ts` | Runs, steps, cost, retry and cancel, from DBOS's management API and the cost log |
| `src/http.ts` | The Runs API (superadmins only) and Chat's dispatch route (`/agents/:name`) |
| `src/auth.ts` | Checks the Supabase access token and `private.superadmins` |
| `src/workflows/` | The workflows. `agents.ts` starts one for a tenant; `demo.ts` is a run that spends nothing |
| `src/agents/` | What every agent shares: `model.ts` (`askText`/`askJson`, one `modelStep` per call through the gateway), `web.ts` (`searchWeb`, logged through `callPaidApi`, and `readPage`, public addresses only), `backend.ts` (PostgREST with the service key: `select`, `rpc`, `insert`, `patch`), `ids.ts`, and `testing.ts` (what tests import). Each agent's own files sit beside them: the Pitcher (`pitcher.ts`, `batches.ts`, `taste.ts`, `fit.ts`, `goals.ts`, `ideas.ts`), the Writer (`writer.ts`, `voice.ts`, `edits.ts`, `writing.ts`), their data (`store.ts`) and the knowledge base (`kb.ts`) |
| `src/workflows/scout.ts`, `src/scout/` | The Scout: DataForSEO, watched pages, ranking facts, the model's triage, its database role |
| `build.mjs` | esbuild: bundles `src/` and the gateway from `../api/_ai` into `dist/` (tsc only typechecks) |
| `test/` | `npm test`: unit checks, then the worker end to end against a real Postgres |

## Where things live

- **DBOS's tables** are in their own database, `propaganda_dbos`, on the stack's
  Postgres. DBOS creates and upgrades it on start. Nothing a person or the app
  writes is in there, so it is not part of `supabase/migrations`, and losing it
  loses run history, not content. The nightly backup covers the `postgres`
  database only.
- **The app's database** (`postgres`) is read, never written: `private.superadmins`
  (who may use the Runs API) and `public.model_calls` (the cost log). Both come
  from other PRs; until they are on the box the API refuses everyone (no
  superadmins) and runs show no cost (no cost log). It connects as `postgres`
  with `POSTGRES_PASSWORD` from the stack's `.env`; `JWT_SECRET` checks tokens;
  `WORKER_DISPATCH_SECRET` (same file, and the same value in Vercel for Chat)
  guards the dispatch route.
- **Every run belongs to a tenant**: start it with `startForTenant(site, workflow, ...args)`,
  which records the workflow attribute `site` and queues it on `agents`
  (three at a time).

## Writing a workflow

```ts
import { DBOS } from "@dbos-inc/dbos-sdk";
import { modelStep } from "../limits.js";

async function scout(site: string) {
  const sources = await DBOS.runStep(() => readWatchedSites(site), { name: "read watched sites" });
  const ideas = await modelStep("find ideas", () => callModel({ site, job: "scout", background: true, ... }));
  ...
}
export const scoutRun = DBOS.registerWorkflow(scout, { name: "scout" });
```

- Import it in `src/main.ts` so it is registered before launch (recovery needs it).
- Anything with a side effect is a step. A model call is a `modelStep`.
- Model calls go through `callModel()` (`api/_ai/gateway.ts`), usually as
  `askText()`/`askJson()` from `src/agents/model.ts`; other paid APIs (DataForSEO)
  through `callPaidApi()`. Both check the tenant's budget and log the cost with the
  DBOS workflow and step ids (`main.ts` calls `wireGateway()` once at start). The
  Docker build's context is the repo root, so it can bundle `api/_ai`;
  `Dockerfile.dockerignore` keeps it to the worker and those files.
- Writes to the app's data go through `src/agents/backend.ts` (PostgREST with
  `SERVICE_ROLE_KEY`), never the read-only pool. Keep them narrow: new rows, or
  rows an agent made, filtered on the site. Never a post a person wrote.
- **Replays must match.** After a restart DBOS replays a run's code and skips the
  steps already done, in order. Changing what an existing workflow does (adding,
  removing or reordering steps) breaks runs still in flight: guard the change with
  `DBOS.patch("name")`, or bump `WORKER_APP_VERSION` (old in-flight runs then stay
  where they are until resumed by hand on the old code).

## The Pitcher and the Writer

Specs: `reviews/agents.md` and `agents/strategist-cold-start-and-pacing.md` in
the project files. Schema: `supabase/migrations/20261008000030_pitch_and_write.sql`.

**Ideas** (`agent_ideas`) are what the Listener, the Scout, Chat and people
hand the Pitcher (`ideas.ts`, reads and writes in `store.ts`): a title, a summary, an origin (calls, search, news, watched,
team, plan) and the evidence. Producers only insert, with `handOffIdeas()`; a `key` (the Scout's `scout:<site>:<dedupe>`) never
adds the same idea twice;
the Pitcher settles each one as pitched (with its brief) or rejected (with a
reason), and keeps both.

**The Pitcher** (`pitcher`) judges ideas (25 per call: topics, timeliness,
gaps, overlaps), then code turns that into reasons from the goals (`fit.ts`,
the same rule as the pipeline UI's Strong / Fair / Weak). No reason: rejected,
"No reason yet". Otherwise the strongest go out, up to the run's `max`: each a
full brief in `briefs` with status `pitched`, angle, audience, outline, sources
from a web search, fit and goal effects. Searches are charged and logged like
model calls. Each batch reads what reviewers said about the last (rejections
and notes). `draftTop: 3` has the Writer draft the three strongest before
anyone approves them (launch day one). Goals come from the run's input until
the Goals tables exist (`goals.ts`, `readGoals()`).

**Batches** (`pitcher:batch`, `batches.ts`). Every idea, from the plan, the
Scout, the Listener or a person, waits for a batch and competes for its slots;
every approved brief counts toward the quarter's target. A batch's quota
counts **approved** briefs (`content_batches`): the Pitcher over-pitches (two
pitches per slot, then the tenant's real approval rate after 6 decisions), a
batch still short once every pitch is decided is topped up the next morning,
and once approvals reach the target the open batches are cancelled. What's
left is always target minus approved. The cadence (`agent_settings.batch_cadence`)
sizes the batches: `weekly` by default (equal weekly batches through the
quarter's first two months, a double first batch) or `flood` (everything at
once). Without goals yet, the plan's size stands in for the target, and with
no plan either a batch is 3. A schedule (`PITCHER_BATCH_CRON`, every day 07:00
UTC) runs each tenant's top-ups and, once a week, its next batch. "Send me the
next batch" in Chat sends it now; the plan arriving sends the quarter's first.
A person's own ask in Chat is pitched now, outside the batches.

**Taste** (`taste.ts`, the `taste_log` and `taste_profiles` tables). Every
decision on a pitch or a draft is a row in the tenant's taste log, written by
database triggers (a pitch approved, rejected or pushed; a reviewer's first
edit after the Writer's version) and by the app (notes, "not now"). Before
each batch the Pitcher rewrites a short taste summary from new decisions and
reads it with the recent decisions and the tenant's own notes. Every idea is
checked against everything ever pitched or published (`similarity()` on
title keywords): a near-duplicate of a rejected pitch is dropped unless
something material changed, and then the brief says what; one of a published
post becomes an update suggestion. Each pitch carries one line of what it
learned (`briefs.learned`).

**The Writer** (`writer`) drafts an approved brief (`todo` or `in_progress`):
- First job on a tenant with no voice guide: writes one (`writer:voice-guide`)
  from its published posts, or the default voice when it has fewer than two.
  `VOICE_FROM=<tenant>:<site>` takes a tenant's voice from another site's posts
  (Propaganda's own tenant from Verbatim). Once a person edits the guide, the
  agent never writes it again.
- Researches (three searches, up to six pages read), reads the knowledge base
  (`kb_search`; an empty base when it isn't on the server), writes the post
  (advanced model), fixes "That's not X. It's Y." sentences once, and records
  what's left (unsourced numbers, links to pages it didn't read, facts it
  needed and didn't have) on the version for the reviewer.
- Writes into the empty post the pipeline made on approval, only while it is
  still empty, or a new draft post. Version 1 is `created_by: agent:writer`. The
  brief goes to `in_review`.
- `writer:revise` turns review notes into a suggested version in the post's
  history. It never changes the post itself.
- Reads how reviewers edited its recent drafts before writing (`edits.ts`),
  and each morning `writer:voice-suggest` turns edits that repeat across two
  or more drafts into a suggested change in `voice_guides.suggestion`. The
  tenant applies it to the guide, or doesn't.

**From Chat**: `pitcher` and `writer` are registered for `POST /agents/:name`.
The Pitcher turns the request into ideas (origin team) and pitches them; the
Writer finds the approved brief whose title matches the request.

**Settings** (the stack's `.env`): `SUPABASE_URL` (the compose file sets the
public API host), `SERVICE_ROLE_KEY` (already there), whatever the gateway
needs to reach Claude (the plan is Ayadi's Claude Max subscription; the
gateway's resolver doesn't have that path yet and sends Claude ids to the AI
Gateway), `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` for web search (without
them the agents work from what they were given), and optionally
`AGENT_MODEL_BASE`, `AGENT_MODEL_ADVANCED`, `VOICE_FROM`, `PITCHER_BATCH_CRON`.

## The Scout

Once a day (06:00 UTC, `SCOUT_CRON`) the `scout-daily` schedule starts one run
per tenant that has something to follow, under the id `scout-<site>-<day>`, so
a day is never scouted twice. A run:

1. reads the plan: this quarter's `scout_searches` (at most 10), the active
   `watched_sites`, and the topics they name;
2. checks each search on Google (DataForSEO, top 20) and writes the
   `ranking_search` fact; a search we're not on page one for becomes an idea
   (origin search, with its `target_search`), once a quarter, with the three
   results to beat;
3. on Mondays (`SCOUT_AI_WEEKDAY`), asks DataForSEO's LLM Mentions which AI
   answers mention the tenant (Google AI Overviews, and ChatGPT for US English)
   and writes `ranking_ai`;
4. reads Google News (last three days) and Reddit threads (Google's index of
   them, one ordinary search) per topic, and each watched page's links (the
   first check is a baseline; after that, new links are the news);
5. drops every link it has seen before (`scout_seen`), has the base model pick
   at most 8 ideas from the rest, and keeps only evidence it saw;
6. hands the ideas to the Pitcher (`handOffIdeas`, one stable id per idea so a
   replay never adds it twice; they wait for the next batch with the plan), then saves the facts,
   the page snapshots and the seen links in one transaction.

Each paid request is its own step: a retry or restart never pays twice. It
writes its own tables as `propaganda_scout`
(`supabase/migrations/20261008000020_scout.sql`), a role that can write nothing
else; its pool uses `APP_DATABASE_URL` and sets that role, so if that URL ever
names a restricted user, grant it `propaganda_scout`. Watched pages are fetched
from public addresses only.

Needs `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (without them it checks the
watched sites only). Start one by hand from Admin with
`POST /runs/scout { site, checkAi? }`; Chat starts one for today (AI answers
included) through `/agents/scout`.

## The usage limit

The Claude subscription answers 429 with `anthropic-ratelimit-unified-status:
rejected` when its window is used up. The gateway turns that into a
`UsageLimitError { resetsAt }`. `modelStep()` catches it, records a `stall`
event on the run (`{ step, since, until }`), sleeps durably until a minute
after the reset, clears the event and calls again. A restart during the wait
resumes the same wait. Once one step hits the limit, every other step in the
process waits too without spending a request. The Runs page shows such a run as
"Stalled until 14:05", never as failed.

## The Runs API

Served at `https://app.propaganda.pub/worker/v1/` (Caddy strips the prefix).
Every route but `/health` needs a superadmin's Supabase access token.

| | |
|---|---|
| `GET /runs?state=&site=&name=&limit=&offset=` | Newest first. States: queued, running, stalled, done, failed, cancelled |
| `GET /runs/:id` | The run with its steps, error, input, output and cost per step |
| `POST /runs/:id/retry` | A failed run is **forked** from the failed step: a new run that keeps the steps before it (their model calls aren't paid again). A cancelled run, or one DBOS gave up recovering, **resumes** under its own id |
| `POST /runs/:id/cancel` | A queued, running or stalled run |
| `POST /runs/demo` | `{ stallSeconds?, fail?, site? }`: a three-step run that spends nothing |
| `POST /runs/scout` | `{ site, day?, checkAi? }`: a Scout run now |

### Dispatch, from Chat

`POST /agents/:name` with `Authorization: Bearer $WORKER_DISPATCH_SECRET` and
`{ site, task, requestedBy, conversation, post? }` hands the ask to that agent,
which starts its run on the `agents` queue, and answers `202 { runId }` (the
contract is `api/_chat/dispatch.ts`; `post` is an optional post id).
Names: strategist, listener, scout, pitcher, writer, checker. A name with no
workflow registered answers 404, which Chat reads as "not running yet". The
tenant must exist (422 otherwise), and so must something to work on: an agent
that finds nothing in the ask answers null, and the route 422. Chat has already
checked the person is a member. A run started with `startForDispatch()` carries the attributes `site`, `agent`, `conversation` and
`requestedBy`. With no secret set the route answers 503 (Chat reports the hand-off failed).

This is the only dispatch route: an agent's thread plugs in with one call, in
a file `main.ts` imports, and never adds a route of its own:

```ts
export const scoutRun = DBOS.registerWorkflow(scout, { name: "scout" });   // scout(input: DispatchInput)
registerAgent("scout", (input) => startForDispatch("scout", scoutRun, input));
// Or start the run your own way and return its id (null: nothing to work on):
registerAgent("checker", (input) => startCheckOnRequest(input.site, input.post, input.task));
```

## Running it

```
cd worker && npm install
npm test                      # PGURL=postgres://postgres:postgres@localhost:5432 by default
npm run typecheck && npm run build
```

Against the laptop stack (`supabase/docker-compose.yml`): `POSTGRES_PASSWORD`
and `JWT_SECRET` from `supabase/.env`, `PGHOST=localhost PGPORT=54322`, then
`npm run build && npm start`; the app finds it with `VITE_WORKER_URL=http://localhost:3010`.

On the box it is built from the Propaganda checkout Bedrock keeps for the
schema (same ref, `main`), on every Bedrock deploy. Like a migration, a merged
change here reaches the box on the next Bedrock deploy.
