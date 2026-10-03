#!/usr/bin/env node
// Fresh secrets for a Supabase stack, as .env lines on stdout:
//
//   node supabase/keys.mjs > supabase/.env            (the laptop stack)
//   node supabase/keys.mjs --box                      (lines for /srv/propaganda-supabase/.env)
//
// The anon and service_role keys are HS256 JWTs signed with JWT_SECRET; every
// service verifies them with that secret. The anon key is public (it ships in
// the app bundle as VITE_SUPABASE_ANON_KEY); everything else is a secret.
import { createHmac, randomBytes } from "node:crypto";

const box = process.argv.includes("--box");
const b64url = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
// Letters and digits only: a value that is safe unquoted in any .env reader.
const alnum = (n) => {
  const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(randomBytes(n), (b) => abc[b % abc.length]).join("");
};

const jwtSecret = alnum(48);
const sign = (role) => {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ role, iss: "supabase", iat, exp: iat + 10 * 365 * 24 * 3600 });
  const sig = createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};

const lines = [
  `POSTGRES_PASSWORD=${alnum(40)}`,
  `JWT_SECRET=${jwtSecret}`,
  `ANON_KEY=${sign("anon")}`,
  `SERVICE_ROLE_KEY=${sign("service_role")}`,
  `SECRET_KEY_BASE=${alnum(64)}`,
  // Realtime encrypts its tenant secrets with this; it must be 16 characters.
  `REALTIME_DB_ENC_KEY=${alnum(16)}`,
  `PG_META_CRYPTO_KEY=${alnum(32)}`,
];

if (!box) {
  lines.push(
    "",
    "# The laptop stack (supabase/docker-compose.yml): the app runs on Vite at :5173.",
    "SITE_URL=http://localhost:5173",
    "API_EXTERNAL_URL=http://localhost:54321/auth/v1",
    "ADDITIONAL_REDIRECT_URLS=http://localhost:5173/**",
    "# Email codes go to Mailpit (http://localhost:54324).",
    "ENABLE_EMAIL=true",
    "SMTP_HOST=mail",
    "SMTP_PORT=1025",
    "SMTP_USER=local",
    "SMTP_PASS=local",
    "SMTP_ADMIN_EMAIL=no-reply@propaganda.local",
    "SMTP_SENDER_NAME=Propaganda",
    "# Google sign-in needs a client whose redirect URIs include API_EXTERNAL_URL/callback.",
    "GOOGLE_ENABLED=false",
    "GOOGLE_CLIENT_ID=",
    "GOOGLE_SECRET=",
  );
}
console.log(lines.join("\n"));
