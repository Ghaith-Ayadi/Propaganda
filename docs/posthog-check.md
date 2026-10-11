# PostHog check

Front-end errors and failed sessions never show up in CI output, the worker log or the dev
database. PostHog has them. Before a dev or E2E run is called green, ask PostHog what it saw.

```
node scripts/posthog-check.mjs --env dev --since 2h
node scripts/posthog-check.mjs --env prod --since 1d --json
```

| Flag | Meaning |
| --- | --- |
| `--env` | `dev` (default), `prod` or `all` |
| `--since` | the window, `30m`, `2h`, `1d` (default `2h`, at most 30 days) |
| `--json` | the report as JSON |

It prints, for the window and environment: the exception issues (type, message, count, link),
the sessions with a rage click or dead click, and the sessions where an error fired, each with a
replay link. Exit `0` = nothing found. Exit `1` = look at it before calling the run green.
Exit `2` = it could not ask PostHog (no key, PostHog said no); that is not a pass either.

## Which environment is which

- **prod**: browser events from `app.propaganda.pub`, plus functions and worker with `app_env = production`.
- **dev**: browser events from `*dev.propaganda.pub`, plus functions and worker with `app_env` `dev` or
  `development` (the dev box's worker sets `dev`; its api sets nothing, so it reads as `development`).
- Events tagged `app_env = artificial-test` are left out: they are on-purpose test errors.

Window the run: pass `--since` as the age of the run (a 40 minute E2E: `--since 1h`), so older
failures do not make a clean run look dirty. A failure in the window that you did not cause (say, a
model cap) still counts: say what it is and why it is not this run's, in the report.

## The key

`POSTHOG_READ_KEY`: a personal API key, read-only, on project 293764 only (EU), set as a
cloud-session secret by the keys thread. It never goes in a file, a log or a message; the script
only sends it to `https://eu.posthog.com`. `POSTHOG_HOST` and `POSTHOG_PROJECT_ID` override the
host and project.
