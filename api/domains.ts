// Vercel serverless function: a site's custom domain, set up by its owner.
//
//   GET    /api/domains?site=<id>&domain=<host>  the live check (any member)
//   POST   /api/domains  {site, domain}          connect it, once DNS is right (owner)
//   DELETE /api/domains?site=<id>                back to <slug>.propaganda.pub (owner)
//
// The owner adds two records at their DNS provider:
//   CNAME <host> -> domains.propaganda.pub  (an apex: A -> the box's address)
//   TXT   _propaganda.<host> = <token>      proves the domain is theirs
// The token is an HMAC of (site, domain), so nothing is stored until the
// domain is connected, and nobody can claim a domain they don't control:
// `sites.domain` is unique, so a squatter would lock the real owner out.
//
// Connecting writes `sites.domain` with the service role (owners can't set it
// through the API: update_site leaves it out). From then on Caddy's on-demand
// TLS check (tls_check() in supabase/migrations) approves the host, Caddy's
// catch-all site (Bedrock compose/sites/propaganda-custom-domains.caddy)
// serves it, and the blog's subdomain forwards there (app/src/blog/site.ts).
// The certificate is requested on the first TLS handshake, which this function
// makes itself, against the box's own address only.
//
// Env:
//   SUPABASE_URL / VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY  the backend
//   SUPABASE_SERVICE_ROLE_KEY   writes sites.domain; also keys the token
//   DOMAIN_TOKEN_SECRET         optional: keys the token instead
//   VITE_PLATFORM_DOMAIN        defaults to propaganda.pub

import { createHmac } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { connect } from "node:tls";
import { backendGet, requireMember } from "./_auth";
import { withTelemetry } from "./_telemetry";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN_SECRET = process.env.DOMAIN_TOKEN_SECRET || SERVICE_KEY;
const PLATFORM = (process.env.VITE_PLATFORM_DOMAIN || "propaganda.pub").toLowerCase();
/** What a custom domain points at: covered by the `*` record that points blog subdomains at the box. */
const TARGET = `domains.${PLATFORM}`;

// Public resolvers, so an answer isn't a stale copy cached near the function.
const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

type Check = "ok" | "missing" | "wrong";

export interface DomainStatus {
  domain: string;
  /** The zone the records go in ("kontra.run"), and whether the domain is that zone itself. */
  zone: string;
  apex: boolean;
  /** Who runs the zone's DNS, from its nameservers: "cloudflare", "godaddy", … or "". */
  provider: string;
  records: Array<{
    role: "point" | "verify";
    type: "CNAME" | "A" | "TXT";
    /** Relative to the zone, as most providers' forms want it ("blog", "@", "_propaganda.blog"). */
    name: string;
    value: string;
    check: Check;
    /** What DNS answers today, when it isn't the value. */
    found: string[];
  }>;
  /** Cloudflare's proxy is on (orange cloud): the record has to be "DNS only". */
  proxied: boolean;
  /** This site's domain now. */
  connected: boolean;
  /** Another site already uses it. */
  taken: boolean;
  https: { check: "ok" | "pending" | "skipped"; detail: string };
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!SUPABASE_URL) return json({ error: "Backend not configured" }, 503);

  if (request.method === "GET") {
    const site = url.searchParams.get("site") || "";
    const domain = normalize(url.searchParams.get("domain") || "");
    const auth = await requireMember(request, site);
    if (!domain) return json({ error: "That isn't a domain name.", code: "DOMAIN-INVALID" }, 400);
    if (!TOKEN_SECRET) return json({ error: "Custom domains aren't switched on yet.", code: "DOMAIN-OFF" }, 503);
    const current = await siteDomains(auth.token, site, domain);
    return json(await status(site, domain, current, false));
  }

  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { site?: string; domain?: string };
    const site = body.site || "";
    const domain = normalize(body.domain || "");
    const auth = await requireOwner(request, site);
    if (!domain) return json({ error: "That isn't a domain name.", code: "DOMAIN-INVALID" }, 400);
    if (!SERVICE_KEY || !TOKEN_SECRET) {
      return json({ error: "Custom domains aren't switched on yet.", code: "DOMAIN-OFF" }, 503);
    }
    const current = await siteDomains(auth.token, site, domain);
    const before = await status(site, domain, current, false);
    if (before.taken) return json({ error: "Another site already uses this domain.", code: "DOMAIN-TAKEN" }, 409);
    if (!before.records.every((r) => r.check === "ok")) {
      return json({ error: "The DNS records aren't there yet.", code: "DOMAIN-DNS", status: before }, 409);
    }
    if (!before.connected) {
      const res = await serviceFetch(`/rest/v1/sites?id=eq.${site}`, {
        method: "PATCH",
        body: JSON.stringify({ domain }),
      });
      if (res.status === 409) return json({ error: "Another site already uses this domain.", code: "DOMAIN-TAKEN" }, 409);
      if (!res.ok) return json({ error: "The domain couldn't be saved.", code: "DOMAIN-SAVE" }, 502);
    }
    // Ask for the certificate now, so the first reader doesn't wait for it.
    return json(await status(site, domain, { mine: domain, taken: false }, true));
  }

  if (request.method === "DELETE") {
    const site = url.searchParams.get("site") || "";
    await requireOwner(request, site);
    if (!SERVICE_KEY) return json({ error: "Custom domains aren't switched on yet.", code: "DOMAIN-OFF" }, 503);
    const res = await serviceFetch(`/rest/v1/sites?id=eq.${site}`, {
      method: "PATCH",
      body: JSON.stringify({ domain: "" }),
    });
    if (!res.ok) return json({ error: "The domain couldn't be removed.", code: "DOMAIN-SAVE" }, 502);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

/** The DNS and HTTPS state of `domain` for `site`. `issue` waits longer for a certificate. */
async function status(
  site: string,
  domain: string,
  current: { mine: string; taken: boolean },
  issue: boolean,
): Promise<DomainStatus> {
  const { zone, provider } = await zoneOf(domain);
  const apex = domain === zone;
  const relative = (host: string) => (host === zone ? "@" : host.slice(0, -(zone.length + 1)));
  const boxIps = await resolver.resolve4(TARGET).catch(() => [] as string[]);

  // Pointing: a CNAME to the target, or (apex, or a provider that flattens) A records equal to the target's.
  const cnames = await resolver.resolveCname(domain).catch(() => [] as string[]);
  const ips = await resolver.resolve4(domain).catch(() => [] as string[]);
  const cnameOk = cnames.some((c) => c.replace(/\.$/, "").toLowerCase() === TARGET);
  const ipsOk = ips.length > 0 && ips.every((ip) => boxIps.includes(ip));
  const pointOk = cnameOk || ipsOk;
  const proxied = !pointOk && provider === "cloudflare" && ips.length > 0 && cnames.length === 0;
  const point: DomainStatus["records"][number] = apex
    ? {
        role: "point",
        type: "A",
        name: "@",
        value: boxIps[0] || "",
        check: pointOk ? "ok" : ips.length ? "wrong" : "missing",
        found: pointOk ? [] : ips,
      }
    : {
        role: "point",
        type: "CNAME",
        name: relative(domain),
        value: TARGET,
        check: pointOk ? "ok" : cnames.length || ips.length ? "wrong" : "missing",
        found: pointOk ? [] : cnames.length ? cnames.map((c) => c.replace(/\.$/, "")) : ips,
      };

  const token = tokenFor(site, domain);
  const txtHost = `_propaganda.${domain}`;
  const txts = (await resolver.resolveTxt(txtHost).catch(() => [] as string[][])).map((parts) => parts.join(""));
  const verify: DomainStatus["records"][number] = {
    role: "verify",
    type: "TXT",
    name: relative(txtHost),
    value: token,
    check: txts.includes(token) ? "ok" : txts.length ? "wrong" : "missing",
    found: txts.includes(token) ? [] : txts,
  };

  const connected = current.mine === domain;
  let https: DomainStatus["https"] = { check: "skipped", detail: "Waiting for DNS." };
  if (pointOk && connected && boxIps[0]) {
    https = await handshake(boxIps[0], domain, issue ? 20000 : 6000);
  } else if (pointOk) {
    https = { check: "skipped", detail: "Requested once the domain is connected." };
  }

  return { domain, zone, apex, provider, records: [point, verify], proxied, connected, taken: current.taken, https };
}

/**
 * A TLS handshake with the box for `domain`, verified like a browser would.
 * Caddy issues the certificate during the first one, so the first may fail
 * while it does. Always the box's own address: this never connects anywhere a
 * caller picked.
 */
function handshake(ip: string, domain: string, timeoutMs: number): Promise<DomainStatus["https"]> {
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port: 443, servername: domain, rejectUnauthorized: true, ALPNProtocols: ["http/1.1"] });
    const done = (result: DomainStatus["https"]) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => done({ check: "pending", detail: "The certificate is being issued." }), timeoutMs);
    socket.once("secureConnect", () => done({ check: "ok", detail: "" }));
    socket.once("error", (err: NodeJS.ErrnoException) =>
      done({ check: "pending", detail: err.code === "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR" ? "The certificate is being issued." : err.code || err.message }),
    );
  });
}

/** The zone a host's records go in (the nearest name with NS records), and its DNS provider. */
async function zoneOf(domain: string): Promise<{ zone: string; provider: string }> {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    const ns = await resolver.resolveNs(name).catch(() => [] as string[]);
    if (ns.length) return { zone: name, provider: providerOf(ns) };
  }
  return { zone: labels.slice(-2).join("."), provider: "" };
}

const PROVIDERS: Array<[RegExp, string]> = [
  [/\.ns\.cloudflare\.com$/, "cloudflare"],
  [/domaincontrol\.com$/, "godaddy"],
  [/registrar-servers\.com$/, "namecheap"],
  [/(googledomains\.com|squarespacedns\.com|google\.com)$/, "squarespace"],
  [/awsdns/, "route53"],
  [/porkbun\.com$/, "porkbun"],
  [/(ovh\.net|ovh\.ca|anycast\.me)$/, "ovh"],
  [/gandi\.net$/, "gandi"],
  [/(dns-parking\.com|hostinger)/, "hostinger"],
  [/(ui-dns|ionos)/, "ionos"],
  [/vercel-dns\.com$/, "vercel"],
  [/(wixdns\.net)$/, "wix"],
  [/name\.com$/, "namecom"],
  [/digitalocean\.com$/, "digitalocean"],
];

function providerOf(ns: string[]): string {
  for (const host of ns.map((n) => n.toLowerCase().replace(/\.$/, ""))) {
    for (const [re, id] of PROVIDERS) if (re.test(host)) return id;
  }
  return "";
}

/** A host as people paste it ("https://Blog.Kontra.run/"), to "blog.kontra.run". "" if it can't be a custom domain. */
export function normalize(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (host.length > 253 || !host.includes(".")) return "";
  if (!host.split(".").every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return "";
  if (/^[0-9.]+$/.test(host)) return "";
  if (host === PLATFORM || host.endsWith(`.${PLATFORM}`)) return "";
  return host;
}

function tokenFor(site: string, domain: string): string {
  const mac = createHmac("sha256", TOKEN_SECRET!).update(`${site}:${domain}`).digest("hex");
  return `propaganda-verify=${mac.slice(0, 32)}`;
}

/** This site's domain, and whether `domain` belongs to another site. */
async function siteDomains(token: string, site: string, domain: string): Promise<{ mine: string; taken: boolean }> {
  const res = await backendGet(
    `/rest/v1/sites?select=id,domain&or=(id.eq.${site},domain.eq.${encodeURIComponent(domain)})`,
    token,
  );
  if (!res.ok) throw new Response("Site lookup failed", { status: 502 });
  const rows = (await res.json()) as Array<{ id: string; domain: string }>;
  return {
    mine: rows.find((r) => r.id === site)?.domain || "",
    taken: rows.some((r) => r.id !== site && r.domain === domain),
  };
}

async function requireOwner(request: Request, site: string) {
  const auth = await requireMember(request, site);
  const res = await backendGet(
    `/rest/v1/site_members?select=role&site=eq.${site}&user_id=eq.${auth.userId}&limit=1`,
    auth.token,
  );
  const rows = res.ok ? ((await res.json()) as Array<{ role: string }>) : [];
  if (rows[0]?.role !== "owner") throw new Response(JSON.stringify({ error: "Only the site's owner can change its domain.", code: "DOMAIN-OWNER" }), { status: 403 });
  return auth;
}

function serviceFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** requireMember and requireOwner throw Responses; they are the answer. */
async function answer(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

const route = withTelemetry("domains", answer);
export const GET = route;
export const POST = route;
export const DELETE = route;
