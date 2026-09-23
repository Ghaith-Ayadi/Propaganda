/// <reference path="../pb_data/types.d.ts" />
// Instance settings from the environment, applied on EVERY start. A migration
// runs once, so anything that may arrive later (R2 keys, SMTP) belongs here.
// Idempotent. Identical copy in every app's pb_hooks; change all three together.
//
// Env (from /srv/<app>/.env):
//   PB_APP_NAME, PB_APP_URL, PB_SENDER_ADDRESS, PB_SENDER_NAME
//   PB_SMTP_HOST, PB_SMTP_PORT, PB_SMTP_USERNAME, PB_SMTP_PASSWORD   (optional)
//   PB_S3_ENDPOINT, PB_S3_BUCKET, PB_S3_ACCESS_KEY, PB_S3_SECRET    (backups → R2)
onBootstrap((e) => {
  e.next();
  // Values may arrive wrapped in quotes (a hand-edited .env, or `docker run --env-file`).
  const env = (k) => ($os.getenv(k) || "").replace(/^["']|["']$/g, "");
  const s = e.app.settings();

  if (env("PB_APP_NAME")) s.meta.appName = env("PB_APP_NAME");
  if (env("PB_APP_URL")) s.meta.appURL = env("PB_APP_URL");
  if (env("PB_SENDER_ADDRESS")) s.meta.senderAddress = env("PB_SENDER_ADDRESS");
  if (env("PB_SENDER_NAME")) s.meta.senderName = env("PB_SENDER_NAME");

  if (env("PB_SMTP_HOST") && env("PB_SMTP_PASSWORD")) {
    s.smtp.enabled = true;
    s.smtp.host = env("PB_SMTP_HOST");
    s.smtp.port = parseInt(env("PB_SMTP_PORT") || "465", 10);
    s.smtp.username = env("PB_SMTP_USERNAME") || "resend";
    s.smtp.password = env("PB_SMTP_PASSWORD");
    s.smtp.tls = s.smtp.port === 465;
  } else {
    s.smtp.enabled = false;
  }

  // Nightly backups, keep 14. To R2 when credentials exist, else local disk.
  // One bucket PER APP: PocketBase prunes by listing the whole bucket, so a
  // shared bucket would let each app delete the others' archives. Crons are
  // staggered per app via PB_BACKUP_CRON. R2 lifecycle (30 days) is the cap.
  s.backups.cron = env("PB_BACKUP_CRON") || "0 3 * * *";
  s.backups.cronMaxKeep = 14;
  if (env("PB_S3_ENDPOINT") && env("PB_S3_ACCESS_KEY") && env("PB_S3_SECRET")) {
    s.backups.s3.enabled = true;
    s.backups.s3.endpoint = env("PB_S3_ENDPOINT");
    s.backups.s3.bucket = env("PB_S3_BUCKET");
    s.backups.s3.region = "auto";
    s.backups.s3.accessKey = env("PB_S3_ACCESS_KEY");
    s.backups.s3.secret = env("PB_S3_SECRET");
    s.backups.s3.forcePathStyle = true;
  } else {
    s.backups.s3.enabled = false;
  }

  // Behind Caddy: trust the rightmost X-Forwarded-For entry (Caddy wrote it).
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;

  s.rateLimits.enabled = true;
  e.app.save(s);
});
