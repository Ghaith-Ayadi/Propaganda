// Where a site's public blog lives.
//
// A site with a custom domain is served at that domain's root (Verbatim:
// verbatim.ayadighaith.com). Every site is also reachable by path on any host
// that serves the app: /@<slug>/…  Custom domains are mapped by a superuser
// (the `domain` field) and must also be added to the Vercel project.

export interface SiteAddress {
  slug: string;
  domain: string;
}

/** Path prefix for a site's pages on the current host: "" at its own domain's root, else "/@slug". */
export function siteBasePath(site: SiteAddress, host: string = location.hostname): string {
  return site.domain && site.domain === host ? "" : `/@${site.slug}`;
}

/** Absolute URL of a site's home page, preferring its custom domain. */
export function sitePublicUrl(site: SiteAddress): string {
  if (site.domain) return `https://${site.domain}/`;
  return `${location.origin}/@${site.slug}/`;
}

/** "/@slug/rest" → { slug, rest }. Null when the path has no site prefix. */
export function parseSitePath(pathname: string): { slug: string; rest: string } | null {
  const m = /^\/@([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  return { slug: m[1], rest: m[2] || "/" };
}
