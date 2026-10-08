// The worker's settings, all from the environment. On the box the stack's one
// env file (/srv/propaganda-supabase/.env) already has the two secrets this
// needs, POSTGRES_PASSWORD and JWT_SECRET; everything else has a default.

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`${name} is not set`);
  return v;
}

// The model gateway and the agents reach the app's data through PostgREST
// with the service role key, which the stack's .env calls SERVICE_ROLE_KEY.
// SUPABASE_URL is set in the compose file (the public API host).
process.env.SUPABASE_SERVICE_ROLE_KEY ??= process.env.SERVICE_ROLE_KEY;

const host = process.env.PGHOST ?? "propaganda-db";
const port = process.env.PGPORT ?? "5432";
const user = process.env.WORKER_PGUSER ?? "postgres";

function url(database: string): string {
  const password = encodeURIComponent(env("POSTGRES_PASSWORD"));
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

export const config = {
  /** The app's database: sites, the cost log (public.model_calls), private.superadmins. */
  appDatabaseUrl: process.env.APP_DATABASE_URL ?? url("postgres"),
  /**
   * DBOS's own tables, in a database of their own (DBOS creates it on first
   * launch). Nothing the app or a client writes lives there, so a DBOS upgrade
   * never touches people's data, and supabase/migrations stays out of it.
   */
  systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL ?? url("propaganda_dbos"),
  jwtSecret: () => env("JWT_SECRET"),
  /**
   * The bearer secret Chat (a Vercel function) sends to start an agent run.
   * Unset: the dispatch route refuses everything (503).
   */
  dispatchSecret: process.env.WORKER_DISPATCH_SECRET ?? "",
  port: Number(process.env.WORKER_PORT ?? 3010),
  /**
   * DBOS recovers only workflows stamped with the running version. Without a
   * fixed one it hashes the code, and a deploy would orphan every run in flight
   * (a job stalled on the usage limit, say). Bump it only for a change an old
   * run can't replay; see worker/README.md.
   */
  appVersion: process.env.WORKER_APP_VERSION ?? "1",
  /** How often the agents look for work (seconds); 0 turns the dispatcher off. */
  dispatchSeconds: Number(process.env.WORKER_DISPATCH_SECONDS ?? 60),
  /** A post version is read once it has been left alone this long (seconds): autosaves settle first. */
  settleSeconds: Number(process.env.WORKER_SETTLE_SECONDS ?? 600),
  /**
   * Tests only: a JSON file of canned model answers by job name. When set, no
   * model is called and nothing is logged to the cost log.
   */
  fakeAnswers: process.env.WORKER_FAKE_ANSWERS ?? "",
};
