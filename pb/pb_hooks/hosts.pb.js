/// <reference path="../pb_data/types.d.ts" />
// Caddy's on-demand TLS check (Bedrock: `on_demand_tls { ask … }` in
// compose/Caddyfile). Before issuing a certificate for a host it hasn't seen,
// Caddy asks
//
//   GET /api/propaganda/tls-check?domain=<host>
//
// and only goes ahead on a 200. Blogs live at <slug>.<platform domain>
// (PROPAGANDA_PLATFORM_DOMAIN, default propaganda.pub), so the answer is 200
// for the subdomain of an existing site and 404 for anything else. Without the
// check, anyone could point hostnames at the box and make Caddy request
// certificates for them. Site slugs are public already (the `sites` list
// rule), so the answer reveals nothing new. Custom domains join here once
// their ownership can be verified.

routerAdd("GET", "/api/propaganda/tls-check", (e) => {
  const domain = String(e.requestInfo().query["domain"] || "").trim().toLowerCase().replace(/\.$/, "");
  const platform = String($os.getenv("PROPAGANDA_PLATFORM_DOMAIN") || "propaganda.pub").toLowerCase();
  const suffix = "." + platform;
  if (domain.endsWith(suffix)) {
    const slug = domain.slice(0, -suffix.length);
    if (slug && slug.indexOf(".") === -1) {
      try {
        e.app.findFirstRecordByFilter("sites", "slug = {:s}", { s: slug });
        return e.string(200, "ok");
      } catch (_) {
        // no site has that slug
      }
    }
  }
  return e.string(404, "unknown host");
});
