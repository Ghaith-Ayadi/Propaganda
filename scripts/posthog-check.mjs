#!/usr/bin/env node
// Did a dev or E2E run leave errors behind in PostHog? Run it before calling a run green.
//
//   node scripts/posthog-check.mjs --env dev --since 2h
//   node scripts/posthog-check.mjs --env prod --since 1d --json
//
// Lists new exceptions and rage-clicked or errored sessions in the window, with replay links.
// Exit 0 = nothing found, 1 = something to look at, 2 = could not ask PostHog (no key, bad reply).
// Read-only. Needs POSTHOG_READ_KEY (a personal API key that can read queries); never printed.
// Docs: docs/posthog-check.md
import { parseArgs } from "node:util";

const HOST = (process.env.POSTHOG_HOST ?? "https://eu.posthog.com").replace(/\/$/, "");
const PROJECT = process.env.POSTHOG_PROJECT_ID ?? "293764";

// Browser events carry $host; Vercel functions and the worker carry app_env only.
const ENV_FILTER = {
  dev: `(properties.$host like '%dev.propaganda.pub' or properties.app_env in ('dev', 'development'))`,
  prod: `(properties.$host in ('app.propaganda.pub', 'propaganda.pub') or properties.app_env = 'production')`,
  all: `true`,
};

export function parseSince(text) {
  const m = /^(\d+)\s*(m|h|d)$/.exec(String(text).trim());
  if (!m) throw new Error(`--since must look like 30m, 2h or 1d (got "${text}")`);
  const minutes = Number(m[1]) * { m: 1, h: 60, d: 1440 }[m[2]];
  if (!minutes || minutes > 60 * 24 * 30) throw new Error("--since must be between 1m and 30d");
  return minutes;
}

// $exception_types and $exception_values come back as JSON array strings ('["TypeError"]').
export function plain(value) {
  if (value == null) return "";
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.join("; ");
  } catch {}
  return String(value);
}

export function queries(env, minutes) {
  const scope = `timestamp > now() - interval ${minutes} minute
    and ${ENV_FILTER[env]}
    and coalesce(properties.app_env, '') != 'artificial-test'`;
  return {
    exceptions: `select properties.$exception_issue_id as issue,
        any(properties.$exception_types) as types,
        any(properties.$exception_values) as message,
        any(properties.$current_url) as url,
        any(properties.route) as route,
        count() as events,
        count(distinct properties.$session_id) as sessions,
        min(timestamp) as first_seen
      from events
      where event = '$exception' and ${scope}
      group by issue order by events desc limit 25`,
    rageclicks: `select properties.$session_id as session,
        any(properties.$current_url) as url,
        count() as clicks,
        min(timestamp) as first_seen
      from events
      where event in ('$rageclick', '$dead_click') and ${scope}
      group by session order by clicks desc limit 25`,
    // Sessions with a recording where an exception fired: the ones worth watching.
    errored: `select properties.$session_id as session, count() as exceptions, min(timestamp) as first_seen
      from events
      where event = '$exception' and properties.$session_id is not null and ${scope}
      group by session order by exceptions desc limit 25`,
  };
}

async function run(key, query) {
  const res = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "posthog-check" }),
  });
  if (!res.ok) {
    throw new Error(`PostHog said ${res.status}: ${(await res.text()).slice(0, 200).replace(key, "***")}`);
  }
  const body = await res.json();
  return (body.results ?? []).map((row) =>
    Object.fromEntries((body.columns ?? []).map((c, i) => [c, row[i]])),
  );
}

const replay = (id) => `${HOST}/project/${PROJECT}/replay/${id}`;
const issueUrl = (id) => `${HOST}/project/${PROJECT}/error_tracking/${id}`;

async function main() {
  const { values } = parseArgs({
    options: {
      env: { type: "string", default: "dev" },
      since: { type: "string", default: "2h" },
      json: { type: "boolean", default: false },
    },
  });
  if (!(values.env in ENV_FILTER)) throw new Error("--env must be dev, prod or all");
  const key = process.env.POSTHOG_READ_KEY;
  if (!key) throw new Error("POSTHOG_READ_KEY is not set in this session");
  const minutes = parseSince(values.since);
  const q = queries(values.env, minutes);
  const [exceptions, rage, errored] = await Promise.all([
    run(key, q.exceptions),
    run(key, q.rageclicks),
    run(key, q.errored),
  ]);
  const report = {
    env: values.env,
    window: values.since,
    exceptions: exceptions.map((e) => ({ ...e, link: e.issue ? issueUrl(e.issue) : null })),
    rageClickSessions: rage.map((r) => ({ ...r, link: replay(r.session) })),
    erroredSessions: errored.map((r) => ({ ...r, link: replay(r.session) })),
  };
  report.clean = !exceptions.length && !rage.length;

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`PostHog, ${values.env}, last ${values.since}`);
    console.log(`  exceptions: ${exceptions.length} issue(s)`);
    for (const e of report.exceptions) {
      console.log(`    - ${plain(e.types) || "?"}: ${plain(e.message).slice(0, 120)} (${e.events}x, ${e.sessions} session(s))`);
      console.log(`      ${e.url ?? e.route ?? ""} ${e.link ?? ""}`.trimEnd());
    }
    console.log(`  rage or dead clicks: ${rage.length} session(s)`);
    for (const r of report.rageClickSessions) console.log(`    - ${r.clicks} click(s) on ${r.url} ${r.link}`);
    console.log(`  sessions with an error: ${errored.length}`);
    for (const r of report.erroredSessions) console.log(`    - ${r.exceptions} error(s) ${r.link}`);
    console.log(report.clean ? "CLEAN: nothing found." : "NOT CLEAN: look at the above before calling the run green.");
  }
  process.exit(report.clean ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`posthog-check could not run: ${err.message}`);
    process.exit(2);
  });
}
