// Resolves which site the public blog is showing, from the host. Every blog is
// served at the root of its own host (see lib/siteUrl.ts):
//   1. <slug>.<platform domain> (verbatim.propaganda.pub): that site;
//   2. a custom domain: the site whose `domain` matches the hostname;
//   3. VITE_DEFAULT_SITE_SLUG, for hosts with neither (Vercel's preview URLs);
//   4. none of the above: no site (BlogApp shows a "Site not found" page).
// An unknown subdomain is also "no site", not a fallback.
//
// Addresses from before blogs had their own hosts, "/@slug/…", forward to the
// same path at the site's address (legacyAddressTarget()), and so does the
// subdomain of a blog with a custom domain (customDomainTarget()).
//
// Resolved once and cached at module scope: every blog component reads the
// same site through currentBlogSite() without re-fetching or prop-drilling.

import { must, publicSb } from "@/lib/supabase";
import { parseLegacySitePath, platformSlugOf, sitePublicUrl } from "@/lib/siteUrl";

export interface BlogSite {
  id: string;
  slug: string;
  domain: string;
  name: string;
  analyticsTenant: string;
}

interface SiteRecord {
  id: string;
  name: string;
  slug: string;
  domain: string;
  analytics_tenant: string;
}

function fromRecord(r: SiteRecord): BlogSite {
  return {
    id: r.id,
    slug: r.slug,
    domain: r.domain || "",
    name: r.name,
    analyticsTenant: r.analytics_tenant || r.slug,
  };
}

const SITE_FIELDS = "id,name,slug,domain,analytics_tenant";

let resolved: BlogSite | null = null;
let inflight: Promise<BlogSite | null> | null = null;

/** The resolved site. Null until resolveBlogSite() has settled, or when none matched. */
export function currentBlogSite(): BlogSite | null {
  return resolved;
}

/** Resolve which site to show for the current location. Memoized: safe to call from every mount. */
export function resolveBlogSite(): Promise<BlogSite | null> {
  if (inflight) return inflight;
  inflight = resolve().then((site) => {
    resolved = site;
    return site;
  });
  return inflight;
}

async function bySlug(slug: string): Promise<BlogSite | null> {
  const record = (await must(publicSb.from("sites").select(SITE_FIELDS).eq("slug", slug).maybeSingle()).catch(
    () => null,
  )) as SiteRecord | null;
  return record ? fromRecord(record) : null;
}

async function byDomain(domain: string): Promise<BlogSite | null> {
  const record = (await must(publicSb.from("sites").select(SITE_FIELDS).eq("domain", domain).maybeSingle()).catch(
    () => null,
  )) as SiteRecord | null;
  return record ? fromRecord(record) : null;
}

async function resolve(): Promise<BlogSite | null> {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;

  const slug = platformSlugOf(host);
  if (slug) return bySlug(slug);

  const mapped = host ? await byDomain(host) : null;
  if (mapped) return mapped;

  const fallbackSlug = import.meta.env.VITE_DEFAULT_SITE_SLUG as string | undefined;
  if (fallbackSlug) return bySlug(fallbackSlug);

  return null;
}

/**
 * Where a blog with a custom domain is read: its subdomain forwards there,
 * same path, so every post has one address. Only from the subdomain, so a
 * preview host resolved by VITE_DEFAULT_SITE_SLUG stays put. Null to stay.
 */
export function customDomainTarget(site: BlogSite): string | null {
  if (typeof window === "undefined" || !site.domain || !platformSlugOf(window.location.hostname)) return null;
  const { pathname, search, hash } = window.location;
  return sitePublicUrl(site) + pathname.slice(1) + search + hash;
}

/**
 * Where an old "/@slug/…" address lives now: the same path, query and hash at
 * that site's address (its custom domain when it has one). Null when the path
 * isn't one, or names no site.
 */
export async function legacyAddressTarget(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const parsed = parseLegacySitePath(window.location.pathname);
  if (!parsed) return null;
  const site = await bySlug(parsed.slug);
  if (!site) return null;
  return sitePublicUrl(site) + parsed.rest.slice(1) + window.location.search + window.location.hash;
}
