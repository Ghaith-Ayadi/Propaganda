// Public blog routing. Singleton store so every useBlogRoute() consumer
// sees the same state — previously each hook had its own useState and only
// the caller's component re-rendered on navigate().
//
// Routes:
//   /                       → Home
//   /:collection/:slug      → a post, by its address (lib/slug.ts)
//   /p/:slug                → the address posts had before collections were in
//                             it: forwarded to the current one. Links in older
//                             posts and around the web still use it.
//
// Multi-tenant: every blog is served at the root of its own host (its
// subdomain or custom domain; see lib/siteUrl.ts), so paths are site-relative
// as they stand. setBasePath() remains for a host that serves a blog under a
// prefix (a members' preview on the app host): parse()/toPath() strip and
// re-add that prefix so the rest of this module, and every component using
// it, only ever deals with the site-relative path.
//
// The active home tab is component-local state (not in the URL): tab
// clicks shouldn't push history or scroll.

import { useEffect, useState } from "react";
import { postPath } from "@/lib/slug";

export type BlogRoute =
  | { view: "home" }
  | { view: "post"; collection: string; slug: string }
  | { view: "legacy"; slug: string };

let basePath = "";

/** Site-relative pathname (prefix stripped), e.g. "/p/foo" or "/". */
function relativePath(pathname: string): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(basePath + "/")) return pathname.slice(basePath.length);
  return pathname;
}

function routeOf(path: string): BlogRoute {
  const legacy = path.match(/^\/p\/([^/]+)\/?$/);
  if (legacy) return { view: "legacy", slug: decodeURIComponent(legacy[1]) };
  const m = path.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (m) return { view: "post", collection: decodeURIComponent(m[1]), slug: decodeURIComponent(m[2]) };
  return { view: "home" };
}

function parse(): BlogRoute {
  if (typeof window === "undefined") return { view: "home" };
  return routeOf(relativePath(window.location.pathname));
}

function toPath(r: BlogRoute): string {
  const rel =
    r.view === "post" ? postPath(r.collection, r.slug) : r.view === "legacy" ? `/p/${encodeURIComponent(r.slug)}` : "/";
  return basePath + rel;
}

// --- singleton store ---
let current: BlogRoute = parse();
const listeners = new Set<(r: BlogRoute) => void>();
function emit() {
  for (const l of listeners) l(current);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    current = parse();
    emit();
  });
}

/**
 * Set the site's base path ("" at the root of its own host) and re-derive the
 * current route from the (unchanged) URL under it. Call it once the site is
 * resolved, before any navigation happens.
 */
export function setBasePath(bp: string): void {
  if (basePath === bp) return;
  basePath = bp;
  current = parse();
  emit();
}

export function navigateTo(r: BlogRoute, opts?: { replace?: boolean }) {
  const path = toPath(r);
  if (typeof window !== "undefined" && window.location.pathname !== path) {
    if (opts?.replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  current = r;
  emit();
}

export function useBlogRoute(): [BlogRoute, typeof navigateTo] {
  const [route, setRoute] = useState<BlogRoute>(current);
  useEffect(() => {
    const fn = (r: BlogRoute) => setRoute(r);
    listeners.add(fn);
    // Sync in case the singleton moved between mount and subscribe.
    setRoute(current);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [route, navigateTo];
}

export function postHref(collection: string, slug: string): string {
  return toPath({ view: "post", collection, slug });
}

/** /p/<slug>: resolved to the post's address when followed (see fetchLegacyPost). */
export function legacyPostHref(slug: string): string {
  return toPath({ view: "legacy", slug });
}

/**
 * The blog route a link in a post points at, when it's a post of this site.
 * Links in content are stored site-relative ("/essays/foo", or "/p/foo" in
 * older posts), so they work on the blog's subdomain and its custom domain
 * alike; full URLs on this host count too. Null for anything else: external,
 * the home page, or an old "/@slug/…" link, which a full page load forwards
 * (blog/site.ts).
 */
export function routeOfHref(href: string): BlogRoute | null {
  if (typeof window === "undefined") return null;
  let path: string;
  try {
    const url = new URL(href, window.location.href);
    if (url.host !== window.location.host) return null;
    path = url.pathname;
  } catch {
    return null;
  }
  if (basePath && path.startsWith(basePath + "/")) path = path.slice(basePath.length);
  else if (path.startsWith("/@")) return null;
  const r = routeOf(path);
  return r.view === "home" ? null : r;
}

/** The href of a route on this site (under its base path, where it has one). */
export function routeHref(r: BlogRoute): string {
  return toPath(r);
}

export function homeHref(): string {
  return toPath({ view: "home" });
}
