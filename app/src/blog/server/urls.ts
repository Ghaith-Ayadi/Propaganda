// Hosts and addresses for the rendering function, with the platform domain
// passed in: lib/siteUrl.ts reads it from the build's env, which is the same
// value on Vercel and the dev box, but the function's own env has the last word.

import { postPath } from "@/lib/slug";
import type { BlogSite } from "@/blog/siteTypes";

export interface Hosts {
  /** "propaganda.pub": blogs live at <slug>.<platform domain>. */
  platformDomain: string;
  /** The editor and the API: "app.propaganda.pub". */
  appHost: string;
}

/** The slug a host serves by subdomain, or null (the app host, the bare domain, a custom domain). */
export function slugOfHost(host: string, hosts: Hosts): string | null {
  const suffix = `.${hosts.platformDomain}`;
  const h = host.toLowerCase();
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!label || label.includes(".") || h === hosts.appHost) return null;
  return label;
}

/** A site's home page: its custom domain, else its subdomain. */
export function siteUrl(site: Pick<BlogSite, "slug" | "domain">, hosts: Hosts): string {
  return site.domain ? `https://${site.domain}/` : `https://${site.slug}.${hosts.platformDomain}/`;
}

/** An absolute URL of a site-relative path ("/essays/foo"). */
export function absolute(site: Pick<BlogSite, "slug" | "domain">, hosts: Hosts, path: string): string {
  return siteUrl(site, hosts) + path.replace(/^\//, "");
}

export function postUrl(site: Pick<BlogSite, "slug" | "domain">, hosts: Hosts, collection: string, slug: string): string {
  return absolute(site, hosts, postPath(collection, slug));
}
