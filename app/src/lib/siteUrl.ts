// Where a site's public blog lives.
//
// Every blog is served at the root of its own host: its subdomain on the
// platform domain (verbatim.propaganda.pub) or, once one is mapped, its custom
// domain (the `domain` field; Verbatim: verbatim.ayadighaith.com). The editor
// and the API live on the app host (app.propaganda.pub), and the bare platform
// domain is the marketing site. Old "/@slug" links forward to the blog's
// address (see blog/site.ts).
//
// VITE_PLATFORM_DOMAIN overrides the platform domain. Set to "localhost" in dev,
// blogs open at http://<slug>.localhost:<port> and the editor at localhost.

import { postPath } from "@/lib/slug";

export interface SiteAddress {
  slug: string;
  domain: string;
}

export const PLATFORM_DOMAIN = (
  (import.meta.env.VITE_PLATFORM_DOMAIN as string | undefined) || "propaganda.pub"
).toLowerCase();

const DEV_PLATFORM = PLATFORM_DOMAIN === "localhost";

/** The platform subdomain that serves the editor and the API. */
const APP_LABEL = "app";

/** scheme://host[:port] of a host on the platform domain; "" is the bare domain. */
function platformOrigin(label: string): string {
  const host = label ? `${label}.${PLATFORM_DOMAIN}` : PLATFORM_DOMAIN;
  // In dev, keep the dev server's scheme and port.
  if (DEV_PLATFORM) return `${location.protocol}//${host}${location.port ? `:${location.port}` : ""}`;
  return `https://${host}`;
}

/** Where the editor lives: https://app.propaganda.pub (the dev server itself in dev). */
export function appOrigin(): string {
  return platformOrigin(DEV_PLATFORM ? "" : APP_LABEL);
}

/**
 * The slug of the site a host serves by subdomain: "verbatim" for
 * verbatim.propaganda.pub. Null for the app host, the bare platform domain, a
 * custom domain, or anything more than one label deep.
 */
export function platformSlugOf(host: string = location.hostname): string | null {
  const suffix = `.${PLATFORM_DOMAIN}`;
  const h = host.toLowerCase();
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!label || label.includes(".") || label === APP_LABEL) return null;
  return label;
}

/**
 * Where to send this page instead, before anything renders: the editor never
 * runs on a blog's subdomain (that origin belongs to the blog's posts), and the
 * app host's root is the editor. Null to stay.
 */
export function editorRedirect(loc: Location = location): string | null {
  if (loc.pathname.startsWith("/admin") && platformSlugOf(loc.hostname)) {
    return appOrigin() + loc.pathname + loc.search + loc.hash;
  }
  if (loc.pathname === "/" && loc.origin === appOrigin()) return "/admin" + loc.hash;
  return null;
}

/** Absolute URL of a site's home page: its custom domain, else its subdomain. */
export function sitePublicUrl(site: SiteAddress): string {
  if (site.domain) return `https://${site.domain}/`;
  return `${platformOrigin(site.slug)}/`;
}

/** The host a site's blog answers on, for display: "verbatim.propaganda.pub". */
export function siteHost(site: SiteAddress): string {
  return site.domain || `${site.slug}.${PLATFORM_DOMAIN}`;
}

/** Absolute URL of a post: /<collection slug>/<post slug> on its site (see lib/slug.ts). */
export function postPublicUrl(site: SiteAddress, collectionSlug: string, slug: string): string {
  return sitePublicUrl(site) + postPath(collectionSlug, slug).slice(1);
}

/**
 * A URL as people read it, for display only: no scheme, and escapes decoded, so
 * a legacy slug shows as "journal/JRN·47", not "journal/JRN%C2%B747". Links
 * keep the encoded form. decodeURI leaves reserved characters (/, ?, #) escaped.
 */
export function readableUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "");
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
}

/** "/@slug/rest", an address from before blogs had their own hosts, to { slug, rest }. Null otherwise. */
export function parseLegacySitePath(pathname: string): { slug: string; rest: string } | null {
  const m = /^\/@([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  return { slug: m[1], rest: m[2] || "/" };
}
