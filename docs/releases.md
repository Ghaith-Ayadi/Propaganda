# Releases

Production moves in numbered releases (Ayadi, 2026-10-10). A release is one commit on
`main`, tagged `vMAJOR.MINOR.PATCH`, that passed every free test suite and the real-model
tests for whatever changed. Its GitHub Release page is the release log.

## Cutting one

Only on Ayadi's word. Run the **release** workflow (`.github/workflows/release.yml`) on `main`:

| Input | Choices |
| --- | --- |
| `bump` | `patch` (default: fixes and small changes), `minor` (a milestone), `major` |
| `ai_tests` | `changed` (default) or `all` |
| `deploy_app` | deploy the app to Vercel production once tagged (default yes) |

The first release is `v0.2.0`; after that the number is the previous tag bumped. `v1.0.0` is
Verbatim's tag from May 2026 and is not counted.

It runs, in order:

1. **Plan.** The next number, and which real-model tests to run (below).
2. **Free suites** on that exact commit: `api.yml`, `worker.yml`, `kb.yml`, `blog-themes.yml`.
   The same workflows run on PRs; the release runs all of them whatever changed.
3. **Real-model tests** (`worker/test/live/`) through the AI Gateway, with the cost of each.
4. **Tag and release log.** Only when everything above is green: the tag, and a GitHub
   Release listing its PRs, which real-model tests ran or were skipped and why, and what
   they cost.
5. **The app** to Vercel production through `deploy-app.yml`.

**The box** runs the Propaganda commit named by `SCHEMA_REF` in Bedrock's
`compose/propaganda-supabase/schema.env` (schema, migrations, worker). It pins a release
tag, so moving the box to a release is a one-line Bedrock PR (`SCHEMA_REF=v0.2.1`) that
deploys on merge. Until the first pin it is `main`, and every Bedrock deploy ships `main`.

## The real-model tests

`worker/test/live/*.mjs` are the scripted agent tests' twins with the stand-in model taken
out: the real workflows, a stand-in database (in memory) and stand-in keyword data and web
pages, and every model call through `callModel()` to the real gateway. They check what a
real model's answer has to satisfy (a proposal that passes the Strategist's rules, a pitch
with an outline, a draft that keeps house rule 1), not exact words. Costs come from the
cost log rows the gateway writes, priced at what the AI Gateway reported.

| Area | Test | Model in the test |
| --- | --- | --- |
| Strategist | `strategist.mjs` | Claude Sonnet 5.5 (prod: Fable 5.1) |
| Pitcher, Writer, voice guide | `pitch-write.mjs` | DeepSeek V4 Pro, as in prod |
| Listener, knowledge base agents, Scout, Chat | not written yet | |

The Strategist is the only agent tested on a different model: Sonnet is the same family as
Fable and follows the same prompt, at a fifth of the price ($2/$10 per million tokens against
$10/$50). Haiku would be cheaper, but a long plan in JSON is where it fails, and a test that
fails because of the test model is worse than no test. The other agents already run on a
cheap model in prod, so their tests use it.

Each test stops at $5 of model spend (`LIVE_SPEND_CAP_USD`): the stand-in `cost_gate` reports
what the test has spent so far against that cap, and the gateway refuses the next call.

Without `AI_GATEWAY_API_KEY` a real-model test prints `skipped`; with `LIVE_REQUIRED=1` (the
release run) that is a failure. To run one by hand:
`cd worker && npm run build && AI_GATEWAY_API_KEY=... node test/live/strategist.mjs`
(needs a Postgres at `PGURL`, as the other worker tests).

## Only what changed

`worker/test/live/affected.mjs` decides which areas run. An area's code is every file its
entry points load, read from esbuild's import graph rather than guessed from folders (the
Strategist's is 16 files, the gateway among them), plus files read at run time next to the
code, the area's test, the shared test kit, and the worker's dependencies and build. An area
runs when one of those files changed since the previous release.

What git can't see: a provider changing a model under the same name, the model set on the
box, and settings stored in the database. So every test runs on the first release of each
calendar month, on the first release, and when `ai_tests` is `all`.

Adding an area: an entry in `AREAS` in `affected.mjs` and a test in `worker/test/live/`.
