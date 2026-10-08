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
- Model calls go through `callModel()` (`api/_ai/gateway.ts`), which logs the cost
  with the DBOS workflow and step ids. The first agent wires the gateway into the
  worker: `setWorkflowContext(() => ({ workflowId: DBOS.workflowID ?? null, stepId: DBOS.stepID ?? null }))`
  once at start, and the Docker build context grows to include `api/_ai`.
- **Replays must match.** After a restart DBOS replays a run's code and skips the
  steps already done, in order. Changing what an existing workflow does (adding,
  removing or reordering steps) breaks runs still in flight: guard the change with
  `DBOS.patch("name")`, or bump `WORKER_APP_VERSION` (old in-flight runs then stay
  where they are until resumed by hand on the old code).

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
`{ site, task, requestedBy, conversation }` starts that agent's workflow on the
`agents` queue and answers `202 { runId }` (the contract is `api/_chat/dispatch.ts`).
Names: strategist, listener, scout, pitcher, writer, checker. A name with no
workflow registered answers 404, which Chat reads as "not running yet". The
tenant must exist (422 otherwise); Chat has already checked the person is a
member. The run carries the attributes `site`, `agent`, `conversation` and
`requestedBy`. With no secret set the route answers 503 (Chat reports the hand-off failed).

An agent's thread plugs in with one call, in a file `main.ts` imports:

```ts
export const checkerRun = DBOS.registerWorkflow(checker, { name: "checker" });
registerAgent("checker", checkerRun);   // checker(input: DispatchInput)
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
