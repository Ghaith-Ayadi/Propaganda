// Set the password for a Supabase Auth user, without sending any email.
//
// The dashboard only offers "send magic link" / "send password recovery", both
// of which need working SMTP — which is exactly what got the OTP login disabled
// in this project. The Auth admin API has no such dependency.
//
// Usage:
//   cd scripts
//   node --experimental-strip-types src/set-admin-password.ts <email>
//   node --experimental-strip-types src/set-admin-password.ts <email> --check
//
// --check looks the user up and reports status without changing anything.
//
// The password is read from a hidden stdin prompt: it is never passed as an
// argv (visible in `ps` and shell history), never echoed, and never logged.

import { createInterface } from "node:readline";
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const checkOnly = process.argv.includes("--check");

if (!url || !serviceKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email || email.startsWith("--")) {
  console.error("Usage: node --experimental-strip-types src/set-admin-password.ts <email> [--check]");
  process.exit(1);
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

// ── Find the user ───────────────────────────────────────────────────────────

const listRes = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers });
if (!listRes.ok) {
  console.error(`Could not list users: ${listRes.status} ${await listRes.text()}`);
  process.exit(1);
}
const { users } = (await listRes.json()) as {
  users: { id: string; email?: string; email_confirmed_at?: string | null }[];
};
const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`No user with email ${email}. Found: ${users.map((u) => u.email).join(", ") || "(none)"}`);
  process.exit(1);
}

console.log(`User ${email}`);
console.log(`  id:        ${user.id}`);
console.log(`  confirmed: ${user.email_confirmed_at ? "yes" : "no"}`);

if (checkOnly) {
  console.log("\n--check: nothing changed.");
  process.exit(0);
}

// ── Read the new password without echoing it ────────────────────────────────

async function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Suppress echo: readline writes each keystroke back to the terminal.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  const answer = await new Promise<string>((resolve) => rl.question("", resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

const password = await askHidden("New password (hidden): ");
const again = await askHidden("Confirm: ");

if (password !== again) {
  console.error("Passwords do not match. Nothing changed.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Use at least 8 characters. Nothing changed.");
  process.exit(1);
}

// ── Set it ──────────────────────────────────────────────────────────────────

const res = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
  method: "PUT",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});

if (!res.ok) {
  console.error(`Failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`\nPassword set for ${email}. Sign in at /admin — no email was sent.`);
