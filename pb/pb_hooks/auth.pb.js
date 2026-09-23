/// <reference path="../pb_data/types.d.ts" />
// Sign-in policy: Google only. Applied on every start from the environment, so
// adding PB_GOOGLE_CLIENT_ID / PB_GOOGLE_CLIENT_SECRET to /srv/<app>/.env and
// restarting is all it takes. Until those exist, password auth stays on as the
// only method (PocketBase refuses an auth collection with no method at all).
// Email OTP and MFA are off unconditionally.
// Identical copy in every app's pb_hooks; change all three together.
onBootstrap((e) => {
  e.next();
  const env = (k) => $os.getenv(k) || "";
  const users = e.app.findCollectionByNameOrId("users");
  const id = env("PB_GOOGLE_CLIENT_ID");
  const secret = env("PB_GOOGLE_CLIENT_SECRET");
  users.otp.enabled = false;
  users.mfa.enabled = false;
  if (id && secret) {
    users.oauth2.enabled = true;
    users.oauth2.providers = [{ name: "google", clientId: id, clientSecret: secret }];
    users.oauth2.mappedFields = { name: "name", avatarURL: "avatar" };
    users.passwordAuth.enabled = false;
  } else {
    users.oauth2.enabled = false;
    users.passwordAuth.enabled = true;
  }
  e.app.save(users);
});
