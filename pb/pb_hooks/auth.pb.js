/// <reference path="../pb_data/types.d.ts" />
// Sign-in policy: Google, plus an emailed one-time code. No passwords. Applied
// on every start from the environment, so adding PB_GOOGLE_CLIENT_ID /
// PB_GOOGLE_CLIENT_SECRET (and SMTP, for the codes) to /srv/propaganda/.env and
// restarting is all it takes. Until a method exists, password auth stays on as
// the only one (PocketBase refuses an auth collection with no method at all).
// MFA is off.
//
// Propaganda's copy diverged from Shelf/Someday when it became multi-tenant:
// email codes, and 90-day sessions so every account saved in a browser can be
// switched to instantly (the app refreshes each saved session on load).
onBootstrap((e) => {
  e.next();
  const env = (k) => $os.getenv(k) || "";
  const users = e.app.findCollectionByNameOrId("users");
  const id = env("PB_GOOGLE_CLIENT_ID");
  const secret = env("PB_GOOGLE_CLIENT_SECRET");
  const smtp = Boolean(env("PB_SMTP_HOST") && env("PB_SMTP_PASSWORD"));
  users.otp.enabled = smtp;
  users.otp.duration = 600;
  users.otp.length = 6;
  users.mfa.enabled = false;
  users.authToken.duration = 90 * 24 * 60 * 60;
  if (id && secret) {
    users.oauth2.enabled = true;
    users.oauth2.providers = [{ name: "google", clientId: id, clientSecret: secret }];
    users.oauth2.mappedFields = { name: "name", avatarURL: "avatar" };
    users.passwordAuth.enabled = false;
  } else {
    users.oauth2.enabled = false;
    users.passwordAuth.enabled = !smtp;
  }
  e.app.save(users);
});
