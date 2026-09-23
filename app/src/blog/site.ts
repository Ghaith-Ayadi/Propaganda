// Resolves which site the public blog is showing.
//
// Precedence (see lib/siteUrl.ts for the address rules):
//   1. a "/@slug" path prefix — wins even on a domain-mapped host, so a site
//      is always reachable there regardless of which domain is loaded;
//   2. the site whose `domain` matches the current hostname;
//   3. VITE_DEFAULT_SITE_SLUG, for local dev / preview hosts with neither;
//   4. none of the above → no site (BlogApp shows a "Site not found" page).
// An unknown slug in the path is also "no site", not a fallback.
//
// Resolved once and cached at module scope: every blog component reads the
// same site through currentBlogSite() without re-fetching or prop-drilling.

import { publicPb } from "@/lib/pocketbase";
import { parseSitePath } from "@/lib/siteUrl";

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

const sites = () => publicPb.collection<SiteRecord>("sites");

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
  const record = await sites()
    .getFirstListItem(publicPb.filter("slug = {:slug}", { slug }))
    .catch(() => null);
  return record ? fromRecord(record) : null;
}

async function byDomain(domain: string): Promise<BlogSite | null> {
  const record = await sites()
    .getFirstListItem(publicPb.filter("domain = {:domain}", { domain }))
    .catch(() => null);
  return record ? fromRecord(record) : null;
}

async function resolve(): Promise<BlogSite | null> {
  if (typeof window === "undefined") return null;

  const parsed = parseSitePath(window.location.pathname);
  if (parsed) return bySlug(parsed.slug);

  const host = window.location.hostname;
  const mapped = host ? await byDomain(host) : null;
  if (mapped) return mapped;

  const fallbackSlug = import.meta.env.VITE_DEFAULT_SITE_SLUG as string | undefined;
  if (fallbackSlug) return bySlug(fallbackSlug);

  return null;
}
