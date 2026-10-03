// Shared by the suites: clients for the laptop stack, test users, checks.
// Never points anywhere but the laptop stack (see run.sh).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const HERE = new URL(".", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${HERE}../.env`, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

export const API = "http://localhost:54321";
export const ANON_KEY = env.ANON_KEY;
export const V = "verbatimsite000";
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Bypasses row-level security: seeding and looking behind the API only. */
export const admin = createClient(API, env.SERVICE_ROLE_KEY, opts);
export const anon = () => createClient(API, ANON_KEY, opts);

/** A signed-in client for `email`, created on first use. Passwords exist only in tests. */
export async function user(email) {
  const password = `test-password-${email}`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const client = createClient(API, ANON_KEY, opts);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  client.userId = data.user.id;
  return client;
}

/** SQL as the database owner, on the laptop stack. Returns rows as arrays of strings. */
export function sql(query) {
  const out = execFileSync(
    "docker",
    ["compose", "-f", `${HERE}../docker-compose.yml`, "exec", "-T", "db", "psql", "-U", "postgres", "-tA", "-F", "\t", "-c", query],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean).map((l) => l.split("\t"));
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newId() {
  let s = "";
  for (let i = 0; i < 15; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** The data of a supabase-js result, or throw its error. */
export async function ok(request) {
  const { data, error } = await request;
  if (error) throw Object.assign(new Error(`${error.code}: ${error.message}`), error);
  return data;
}

/** The HTTP status of a supabase-js result. */
export async function status(request) {
  return (await request).status;
}

let fails = 0;
export function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`);
  if (!cond) fails++;
}
export function done(suite) {
  console.log(fails ? `${suite}: ${fails} FAILED` : `${suite}: ALL PASS`);
  process.exitCode = fails ? 1 : 0;
}

process.on("unhandledRejection", (e) => {
  console.log("ERR", e?.message ?? e);
  process.exit(1);
});
