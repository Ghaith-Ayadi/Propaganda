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
| `src/agents/` | What every agent shares: `model.ts` (`askText`/`askJson`, one `modelStep` per call through the gateway), `web.ts` (`searchWeb`, logged through `callPaidApi`, and `readPage`, public addresses only), `backend.ts` (PostgREST with the service key: `select`, `rpc`, `insert`, `patch`), `ids.ts`, and `testing.ts` (what tests import). Each agent's own files sit beside them: the knowledge base agents are `checker.ts`, `guardian.ts` (+ `verdict.ts`, its rule set `guardian-policy-v1.md`), `dispatch.ts`, `text.ts` and `ai.ts` (`ask()`, with canned answers for tests) |
| `src/kb/` | `read.ts`: what the knowledge base agents read through the read-only pool |
| `build.mjs` | esbuild: bundles `src/` and the gateway from `../api/_ai` into `dist/` (tsc only typechecks) |
| `test/` | `npm test`: unit checks, then the worker end to end against a real Postgres. The knowledge base agents end to end: `supabase/tests/kb_agents.mjs` on the laptop stack |

## Where things live

- **DBOS's tables** are in their own database, `propaganda_dbos`, on the stack's
  Postgres. DBOS creates and upgrades it on start. Nothing a person or the app
  writes is in there, so it is not part of `supabase/migrations`, and losing it
  loses run history, not content. The nightly backup covers the `postgres`
  database only.
- **The app's database** (`postgres`) is read through a read-only pool:
  `private.superadmins` (who may use the Runs API), `public.model_calls` (the
  cost log) and the knowledge base. The agents write only through its functions
  over PostgREST (below). Both come
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

## The knowledge base agents

Design: `docs/knowledge-base.md`. Both only work for tenants with a row in
`kb_agent_sites` (Lite tenants never spend a token on them):

```sql
insert into public.kb_agent_sites (site) values ('<site id>');  -- checks posts written from now on
```

- **The dispatcher** (`agents/dispatch.ts`) polls every `WORKER_DISPATCH_SECONDS`
  (60) for work: the newest version of a post in `done` or `published`, left
  alone `WORKER_SETTLE_SECONDS` (600) and not read yet; re-check flags not read
  yet; contests with no draft; open proposals. Each run's id comes from its work
  (`checker-<version>`, `guardian-<proposal>-<round>`), so a piece of work runs
  once however many ticks see it. A failed run stays failed until retried from
  Admin > Runs.
- **The Checker** (base model, `WORKER_MODEL_BASE`): links a post version to the
  claims it relies on, opens a flag per conflict and closes the ones a newer
  version fixed, checks numbers and quotes against the pages the post links,
  and offers Remember on tenant facts no claim covers (`kb_checks.report`). It
  also re-reads posts after a claim they rely on changed (cleared, or open with
  a suggested fix) and drafts a person's contest into changes and an argument.
- **The Guardian** (advanced model, `WORKER_MODEL_ADVANCED`): runs policy v1's
  checks on a proposal (a site's own `kb_policies` text wins over the bundled
  one) and the code decides the verdict (`verdict.ts`). It only ever writes
  through `kb_guardian_decide`.
- **Chat's hand-off** (`POST /agents/checker`, below): the post by id, or the
  one whose title the task names, checked under the dispatcher's run id
  `checker-<version>`; `422` when no post matches.
- Writes go through PostgREST at `SUPABASE_URL` with the service key
  (`SERVICE_ROLE_KEY` on the box): the pg pool stays read-only. The gateway needs
  a model provider key (`AI_GATEWAY_API_KEY`).
- `WORKER_FAKE_ANSWERS` (tests only) replaces every model call with canned
  answers by job name and logs nothing.

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
registerAgent("checker", startCheckOnRequest);   // agents/dispatch.ts
```

## Running it

```
cd worker && npm install
npm test                      # PGURL=postgres://postgres:postgres@localhost:5432 by default
```

Against the laptop stack (`supabase/docker-compose.yml`): `POSTGRES_PASSWORD`
and `JWT_SECRET` from `supabase/.env`, `PGHOST=localhost PGPORT=54322`, then
`npm run build && npm start`; the app finds it with `VITE_WORKER_URL=http://localhost:3010`.

On the box it is built from the Propaganda checkout Bedrock keeps for the
schema (same ref, `main`), on every Bedrock deploy. Like a migration, a merged
change here reaches the box on the next Bedrock deploy.
