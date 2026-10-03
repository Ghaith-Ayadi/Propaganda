// Blogs on their own subdomains: Caddy's on-demand TLS check (tls_check)
// answers 200 only for the app host and the subdomain of an existing site, and
// slugs stay DNS-shaped and clear of the platform's own hosts. The port of
// pb/rehearsal/hosts.mjs. Caddy calls PostgREST directly on the box; here it
// goes through the gateway, which is the same request.
import { API, check, done, ok, status, user } from "./lib.mjs";

const tls = async (domain) => (await fetch(`${API}/rest/v1/rpc/tls_check?domain=${encodeURIComponent(domain)}`)).status;
const stranger = await user("stranger@test.local");
await ok(stranger.rpc("create_site", { site_name: "Hosts", site_slug: "hosts-test" }));

check("an existing site's subdomain gets a certificate", (await tls("verbatim.propaganda.pub")) === 200);
check("…in any case, with a trailing dot", (await tls("Verbatim.Propaganda.pub.")) === 200);
check("…and so does a site created later", (await tls("hosts-test.propaganda.pub")) === 200);
check("an unknown subdomain doesn't", (await tls("nobody-here.propaganda.pub")) === 404);
check("the app host gets a certificate too", (await tls("app.propaganda.pub")) === 200);
check("two labels deep isn't a blog", (await tls("a.verbatim.propaganda.pub")) === 404);
check("the bare platform domain isn't a blog", (await tls("propaganda.pub")) === 404);
check("a lookalike suffix isn't the platform", (await tls("verbatim.propaganda.pub.evil.test")) === 404);
check("another domain isn't one (custom domains come later)", (await tls("verbatim.ayadighaith.com")) === 404);
check("no domain at all", (await tls("")) === 404);
check("no parameter at all", (await fetch(`${API}/rest/v1/rpc/tls_check`)).status >= 400);

const create = (slug) => status(stranger.rpc("create_site", { site_name: "X", site_slug: slug }));
check("a platform host can't be a slug", (await create("domains")) === 400);
check("nor can an IDN-style label", (await create("xn--nxasmq6b")) === 400);
check("nor any label with -- in third and fourth place", (await create("ab--cd")) === 400);
check("nor a single character", (await create("a")) === 400);
check("nor a leading or trailing dash", (await create("-bad-")) === 400);

done("HOSTS");
