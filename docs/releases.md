# Releases

Production moves in numbered releases (Ayadi, 2026-10-10). A release is one commit on
`main`, tagged `vMAJOR.MINOR.PATCH`, that passed every free test suite and the real-model
tests for whatever changed. Its GitHub Release page is the release log.

## Cutting one

Only on Ayadi's word. First merge the version's **release notes** to `main` (below), then run
the **release** workflow (`.github/workflows/release.yml`) on `main`:

| Input | Choices |
| --- | --- |
| `bump` | `minor` (default: every full release, from `main`), `major`; `patch` only for a hotfix on its `hotfix/` branch |
| `ai_tests` | `changed` (default), `all`, or `none` (skip the real-model tests, only on Ayadi's word; the release log says they were skipped) |
| `deploy_app` | deploy the app to Vercel production once tagged (default yes) |
| `notes_since` | first release only: the commit to list PRs from (default: GitHub's own list) |

**Version numbers (Ayadi, 2026-10-14).** A full release is the next minor version: v0.3.0, v0.4.0,
and on to v0.12.0 and beyond (0.12 is later than 0.2: the numbers count, they are not decimals).
Every hotfix is a patch on the release it fixes (v0.2.5, v0.2.6, then v0.3.1 after v0.3.0).
The workflow refuses a patch from `main` and a minor or major from a hotfix branch.

The first release was `v0.2.0`; after that the number is the highest tag, bumped. `v1.0.0` is
Verbatim's tag from May 2026 and is not counted. For that first release, `notes_since` (a commit,
such as the last production deploy) lists the PRs merged after it in the log instead of
everything since May.

It runs, in order:

1. **Plan.** The next number, and which real-model tests to run (below).
2. **Free suites** on that exact commit: `api.yml`, `worker.yml`, `kb.yml`, `blog-themes.yml`.
   The same workflows run on PRs; the release runs all of them whatever changed.
3. **Real-model tests** (`worker/test/live/`) through the AI Gateway, with the cost of each in
   the run's summary.
4. **Tag and release log.** Only when everything above is green: the tag, and a GitHub
   Release opening with the version's notes and listing its PRs and which real-model tests ran
   or were skipped and why. Costs never go on a release (Ayadi, 2026-10-12): they are in the
   run's summary.
5. **The app** to Vercel production through `deploy-app.yml`.

**The box** runs the Propaganda commit named by `SCHEMA_REF` in Bedrock's
`compose/propaganda-supabase/schema.env` (schema, migrations, worker). It pins the last release
tag (v0.2.4 from 2026-10-14), so a box deploy ships released code only. Moving the box to a new
release is a one-line Bedrock PR (`SCHEMA_REF=vX.Y.Z`) that deploys on merge: make it after every
release, and merge it right after the release's app deploy.

## Chat round trip

`scripts/chat-roundtrip.mjs` runs Chat's path against a deployed server: start a conversation,
read it back the way a refresh does, send one message (`--send`), check
the question and reply are stored, delete it. Every answer must be JSON from our functions, which
catches a function that crashes on load and a rewrite that answers an API call with the app's
HTML. `--send` makes one real Chat call: a few cents of DeepSeek on dev, but on prod it runs on prod's Chat model and bills that tenant, so run prod without `--send` unless that is what you want. Before any release or hotfix that touches `api/`, `vercel.json` or the Chat page, run it
against the dev site after the deploy and again against prod after the release:

```
CHAT_CHECK_TOKEN=<a member's access token> CHAT_CHECK_SITE=<site id> \
  node scripts/chat-roundtrip.mjs --base https://dev.propaganda.pub --send
```

Exit 0 passes, 1 names the failing step, 2 means no token or site (not a pass).

## Hotfix

A fix that must reach production before the next full release. A normal release ships all of
`main`, so unreleased work and its 25-minute model tests ride along; a hotfix ships the last
release plus the fix and nothing else. It is still a numbered release (always the next patch,
v0.2.5 after v0.2.4), only on Ayadi's word, with notes and a log.

1. The fix merges to `main` as always (desk, then merge).
2. Cut `hotfix/<next version>` from the last release tag, cherry-pick the fix onto it, and add
   `release-notes/<next version>.md` there (one or two lines, no costs).
3. Run the **release** workflow on that branch (`bump: patch`). The plan job refuses it unless the
   branch is named for the next version, descends from the last release, has no merge commits since
   it (cherry-pick, never merge `main` in) and adds no migration: a migration waits for a full
   release and Ayadi's yes to its file.
4. Everything else is the normal release: the free suites on that commit, real-model tests only
   for agents whose code the fix touches since the last release (usually none; all of them on the first release of a month), the tag and log,
   the app to Vercel from the branch.
5. Bedrock PR `SCHEMA_REF=<next version>` for the box, as after any release. The worker is built
   from that tag, so a worker fix reaches the box only this way.
   The checks cannot tell a fix from other changes: only cherry-pick the fix and its notes onto
   the branch. Who may create or push `hotfix/**` is a repository setting, not something these
   workflows enforce; `deploy-app.yml` refuses a hotfix branch commit that has no release tag, so
   a hand-run deploy cannot skip the plan checks.
6. The notes file also goes to `main` in a notes PR, so `/release-notes` and the next release's
   log carry it. The next release on `main` numbers from the highest tag, so it is the next minor (v0.3.0 after v0.2.x hotfixes). That
   hotfix tag is not an ancestor of `main`: the "what changed" test comparison is by tree, which
   already holds the fix, and GitHub's PR list for that release starts at the hotfix tag, so it
   may repeat the fix's PR.

## Release notes

Every release has a Markdown file, `release-notes/vX.Y.Z.md`, written before it is cut: a
`# vX.Y.Z` title, a line with the date and the release's focus, then what changed in plain
words for the people using Propaganda (not PR titles). Images go in `release-notes/images/` and
are linked as `images/<file>`. The workflow refuses to release a version without its file.

The same file is shown in two places:

- **GitHub:** the opening of the release's page, above what the workflow adds (tests, PRs).
  Images are linked from the release commit. To change a published release's notes, merge the
  edit and run the **release-log** workflow (`.github/workflows/release-log.yml`) with its tag:
  it rewrites that release's page from the file on `main`, without costs.
- **The app:** `app.propaganda.pub/release-notes` lists every release newest first
  (`app/src/releaseNotes/`, read at build time; public, no sign-in). The editor's command
  palette (Version) names the current release and links there. The newest file is the release
  the build carries, so a notes file merges together with, or just before, the release it names.

## The real-model tests

`worker/test/live/*.mjs` are the scripted agent tests' twins with the stand-in model taken
out: the real workflows, a stand-in database (in memory) and stand-in keyword data and web
pages, and every model call through `callModel()` to the real gateway. They check what a
real model's answer has to satisfy (a proposal that passes the Strategist's rules, a pitch
with an outline, a draft with no "not X, it's Y" contrast and no em dash), not exact words. Costs come from the
cost log rows the gateway writes, priced at what the AI Gateway reported.

| Area | Test | Model in the test |
| --- | --- | --- |
| Strategist | `strategist.mjs` | DeepSeek V4 Pro (prod: Fable 5.1) |
| Pitcher, Writer, voice guide | `pitch-write.mjs` | DeepSeek V4 Pro, as in prod |
| Listener, knowledge base agents, Scout, Chat | not written yet | |

These are plumbing tests: they check that each agent's workflow, rules and writes hold up
against a real model's answer, not how good the answer is (that is Propaganda Labs). So every
test runs on DeepSeek V4 Pro, the Strategist included, though it runs on Fable in prod. Claude
models are kept for UX testing and benchmarks (Ayadi, 2026-10-11).

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
