/// <reference path="../pb_data/types.d.ts" />
// A fresh instance configures itself from the environment on first start:
// superuser, app metadata, SMTP (Resend), local scheduled backups. Every part is
// skipped when its variables are absent, so the same file works on a laptop
// with no secrets. Idempotent: rerunning changes nothing.
//
// Env (from /srv/propaganda/.env on the box, never committed):
//   PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD
//   PB_APP_NAME, PB_APP_URL
//   PB_SMTP_HOST, PB_SMTP_PORT, PB_SMTP_USERNAME, PB_SMTP_PASSWORD, PB_SENDER_ADDRESS, PB_SENDER_NAME
migrate((app) => {
  const env = (k) => $os.getenv(k) || "";

  // Superuser
  const email = env("PB_SUPERUSER_EMAIL");
  const password = env("PB_SUPERUSER_PASSWORD");
  if (email && password) {
    const col = app.findCollectionByNameOrId("_superusers");
    let exists = true;
    try { app.findAuthRecordByEmail(col, email); } catch (_) { exists = false; }
    if (!exists) {
      const r = new Record(col);
      r.set("email", email);
      r.set("password", password);
      app.save(r);
    }
  }

  // Settings
  const s = app.settings();
  if (env("PB_APP_NAME")) s.meta.appName = env("PB_APP_NAME");
  if (env("PB_APP_URL")) s.meta.appURL = env("PB_APP_URL");
  if (env("PB_SENDER_ADDRESS")) s.meta.senderAddress = env("PB_SENDER_ADDRESS");
  if (env("PB_SENDER_NAME")) s.meta.senderName = env("PB_SENDER_NAME");
  s.meta.hideControls = false;

  if (env("PB_SMTP_HOST") && env("PB_SMTP_PASSWORD")) {
    s.smtp.enabled = true;
    s.smtp.host = env("PB_SMTP_HOST");
    s.smtp.port = parseInt(env("PB_SMTP_PORT") || "465", 10);
    s.smtp.username = env("PB_SMTP_USERNAME") || "resend";
    s.smtp.password = env("PB_SMTP_PASSWORD");
    s.smtp.tls = s.smtp.port === 465;
  }

  // Local scheduled backups: nightly, keep 14. S3 (R2) is switched on later.
  s.backups.cron = "0 3 * * *";
  s.backups.cronMaxKeep = 14;

  // Rate limits on auth endpoints stay at PocketBase defaults (enabled).
  s.rateLimits.enabled = true;

  app.save(s);
}, (app) => {
  // Nothing to undo: settings and the superuser are environment-owned.
});
