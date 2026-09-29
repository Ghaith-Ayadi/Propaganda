// Shared helpers for the tenancy hooks. JSVM handlers cannot see variables
// declared outside their own body, so every handler `require()`s this file.

// A site's slug is also its subdomain (<slug>.propaganda.pub), so these names
// are kept for the platform's own hosts, the ones it uses and the ones it may.
const RESERVED = [
  // in use: the editor and API, the marketing site, the custom-domain target
  "app", "www", "api", "domains",
  // mail and DNS
  "mail", "email", "smtp", "imap", "pop", "mx", "ns", "ns1", "ns2", "dns",
  // hosts a platform tends to need
  "admin", "assets", "static", "cdn", "media", "images", "files", "uploads",
  "blog", "docs", "help", "support", "status", "community", "developers", "dev",
  "staging", "preview", "test", "demo", "beta", "sandbox",
  "auth", "login", "logout", "signup", "signin", "sso", "oauth", "account",
  "accounts", "billing", "pay", "settings", "dashboard", "analytics",
  // from the path-based addresses
  "about", "new", "site", "sites", "_",
];

/**
 * Lowercase letters, digits and dashes, 2 to 40 chars, no leading or trailing
 * dash: a valid DNS label. Not reserved, and not IDN-style ("xn--…", or any
 * "--" in third and fourth place, which DNS keeps for encodings).
 */
function validSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(slug) &&
    slug.slice(2, 4) !== "--" &&
    RESERVED.indexOf(slug) === -1;
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
