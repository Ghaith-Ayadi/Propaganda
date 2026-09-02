// Point Supabase Auth at Resend for transactional email (password recovery),
// and make sure the app's redirect targets are allow-listed.
//
// The dashboard is the usual place for this, but it is also the only place —
// there is no SQL for it — so this drives the Management API instead. Needs a
// personal access token from https://supabase.com/dashboard/account/tokens,
// put in .env.local as SUPABASE_ACCESS_TOKEN.
//
// Usage:
//   cd scripts
//   node --experimental-strip-types src/configure-auth-smtp.ts --check
//   node --experimental-strip-types src/configure-auth-smtp.ts --apply
//
// --check prints the current auth config (secrets redacted) and the exact diff
// --apply would make. Nothing changes without --apply.
//
// Sender is onboarding@resend.dev, Resend's shared testing sender. It needs no
// verified domain, but Resend will ONLY deliver to the Resend account owner's
// address (contact@ayadighaith.com). That is fine while that is also the admin
// account; sending recovery mail anywhere else needs a verified domain.

import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, "..", "..", ".env.local") });

const projectUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const resendKey = process.env.RESEND_API_KEY;
const apply = process.argv.includes("--apply");

if (!projectUrl || !resendKey) {
  console.error("Missing VITE_SUPABASE_URL or RESEND_API_KEY in .env.local");
  process.exit(1);
}
if (!token) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN in .env.local.\n" +
      "Create one at https://supabase.com/dashboard/account/tokens and add:\n" +
      "  SUPABASE_ACCESS_TOKEN=sbp_…",
  );
  process.exit(1);
}

const ref = new URL(projectUrl).hostname.split(".")[0];
const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// The redirect targets the reset link must be allowed to return to. Supabase
// refuses to redirect anywhere not on this list, which dead-ends the link.
const WANTED_REDIRECTS = [
  "https://verbatim-rho.vercel.app/admin",
  "http://localhost:5173/admin",
];

const res = await fetch(api, { headers });
if (!res.ok) {
  console.error(`Could not read auth config: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const current = (await res.json()) as Record<string, unknown>;

const redact = (v: unknown) => (v ? "<set>" : "<empty>");
console.log("Current auth email config");
console.log(`  smtp_host:        ${current.smtp_host ?? "<empty>"}`);
console.log(`  smtp_port:        ${current.smtp_port ?? "<empty>"}`);
console.log(`  smtp_user:        ${current.smtp_user ?? "<empty>"}`);
console.log(`  smtp_pass:        ${redact(current.smtp_pass)}`);
console.log(`  smtp_admin_email: ${current.smtp_admin_email ?? "<empty>"}`);
console.log(`  smtp_sender_name: ${current.smtp_sender_name ?? "<empty>"}`);
console.log(`  site_url:         ${current.site_url ?? "<empty>"}`);
console.log(`  uri_allow_list:   ${current.uri_allow_list ?? "<empty>"}`);
console.log(`  mailer_autoconfirm (signup email off): ${current.mailer_autoconfirm}`);

// Merge rather than replace: whatever is already allow-listed stays.
const existing = String(current.uri_allow_list ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const merged = Array.from(new Set([...existing, ...WANTED_REDIRECTS]));

const payload = {
  smtp_host: "smtp.resend.com",
  smtp_port: "465", // the Management API rejects a number here
  smtp_user: "resend",
  smtp_pass: resendKey,
  smtp_admin_email: "onboarding@resend.dev",
  smtp_sender_name: "Verbatim",
  uri_allow_list: merged.join(","),
};

console.log("\nWould set");
for (const [k, v] of Object.entries(payload)) {
  console.log(`  ${k}: ${k === "smtp_pass" ? "<RESEND_API_KEY>" : v}`);
}

if (!apply) {
  console.log("\n--check: nothing changed. Re-run with --apply to write it.");
  process.exit(0);
}

const patch = await fetch(api, { method: "PATCH", headers, body: JSON.stringify(payload) });
if (!patch.ok) {
  console.error(`\nFailed: ${patch.status} ${await patch.text()}`);
  process.exit(1);
}
console.log("\nApplied. Password recovery should now send through Resend.");
