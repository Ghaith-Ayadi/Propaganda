// Public blog routing. Singleton store so every useBlogRoute() consumer
// sees the same state — previously each hook had its own useState and only
// the caller's component re-rendered on navigate().
//
// Routes:
//   /        → Home
//   /p/:slug → Single post
//
// Multi-tenant: every path lives under the resolved site's base path ("" at
// its own domain's root, "/@slug" otherwise — see lib/siteUrl.ts). BlogApp
// calls setBasePath() once the site is resolved, before anything else reads
// or navigates; parse()/toPath() strip and re-add that prefix so the rest of
// this module (and every component using it) only ever deals with the
// site-relative path.
//
// The active home tab is component-local state (not in the URL): tab
// clicks shouldn't push history or scroll.

import { useEffect, useState } from "react";

export type BlogRoute =
  | { view: "home" }
  | { view: "post"; slug: string };

let basePath = "";

/** Site-relative pathname (prefix stripped), e.g. "/p/foo" or "/". */
function relativePath(pathname: string): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(basePath + "/")) return pathname.slice(basePath.length);
  return pathname;
}

function parse(): BlogRoute {
  if (typeof window === "undefined") return { view: "home" };
  const path = relativePath(window.location.pathname);
  const m = path.match(/^\/p\/([^/]+)\/?$/);
  if (m) return { view: "post", slug: decodeURIComponent(m[1]) };
  return { view: "home" };
}

function toPath(r: BlogRoute): string {
  const rel = r.view === "post" ? `/p/${encodeURIComponent(r.slug)}` : "/";
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
 * Set the site's base path ("" or "/@slug") and re-derive the current route
 * from the (unchanged) URL under it. Called once by BlogApp right after the
 * site resolves, before any navigation happens.
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

export function postHref(slug: string): string {
  return toPath({ view: "post", slug });
}

export function homeHref(): string {
  return toPath({ view: "home" });
}
