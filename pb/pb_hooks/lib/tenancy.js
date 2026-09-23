// Shared helpers for the tenancy hooks. JSVM handlers cannot see variables
// declared outside their own body, so every handler `require()`s this file.

const RESERVED = [
  "admin", "api", "app", "assets", "static", "www", "mail", "blog", "help",
  "about", "login", "logout", "signup", "signin", "new", "settings", "account",
  "accounts", "site", "sites", "_",
];

/** Lowercase, dash-separated, 2–40 chars, no leading/trailing dash. */
function validSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(slug) && RESERVED.indexOf(slug) === -1;
}

/** The membership of `userId` in `siteId`, or null. */
function membership(app, siteId, userId) {
  try {
    return app.findFirstRecordByFilter("site_members", "site = {:s} && user = {:u}", { s: siteId, u: userId });
  } catch (_) {
    return null;
  }
}

/** Every site id the user belongs to. */
function siteIdsOf(app, userId) {
  return app.findRecordsByFilter("site_members", "user = {:u}", "created", 50, 0, { u: userId })
    .map((m) => m.getString("site"));
}

module.exports = { RESERVED, validSlug, membership, siteIdsOf };
