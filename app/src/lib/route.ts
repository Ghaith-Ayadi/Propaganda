// Tiny URL state hook. Routes by post ID (not slug) so editing the slug
// in the attribute panel doesn't break the page.
//
// The 0.2 pages (Home, Inbox, Pipeline, ...) are `{ view: "page" }`: one entry
// each in lib/routes.ts, at #/<path>[/<rest>]. `rest` is the page's own
// sub-path (an inbox item, a KB claim), read with usePageRest().

import { useEffect, useState } from "react";

export type Route =
  | { view: "page"; page: string; rest: string | null }
  /** Content > Blog, with the active collection (lib/activeCollection.ts). */
  | { view: "list" }
  | { view: "post"; id: string }
  /** Kept for old callers: the Pipeline page. */
  | { view: "plan" }
  | { view: "brief"; id: string }
  | { view: "analytics" }
  | { view: "admin"; section: string | null };

function parse(): Route {
  const h = window.location.hash;
  // Post ids are PocketBase record ids, minted on the client, so a draft keeps
  // its id from the first keystroke to the server.
  const m = h.match(/^#\/post\/([A-Za-z0-9_-]+)$/);
  if (m) return { view: "post", id: m[1] };
  const mb = h.match(/^#\/brief\/(.+)$/);
  if (mb) return { view: "brief", id: decodeURIComponent(mb[1]) };
  if (h === "#/plan") return { view: "page", page: "pipeline", rest: null };
  if (h === "#/analytics") return { view: "analytics" };
  const ma = h.match(/^#\/admin(?:\/([a-z-]+))?$/);
  if (ma) return { view: "admin", section: ma[1] ?? null };
  const mp = h.match(/^#\/([a-z][a-z0-9-]*)(?:\/(.+))?$/);
  if (mp) return { view: "page", page: mp[1], rest: mp[2] ?? null };
  return { view: "page", page: "home", rest: null };
}

function toHash(r: Route): string {
  if (r.view === "page") return r.rest ? `#/${r.page}/${r.rest}` : `#/${r.page}`;
  if (r.view === "list") return "#/content/blog";
  if (r.view === "plan") return "#/pipeline";
  if (r.view === "brief") return `#/brief/${encodeURIComponent(r.id)}`;
  if (r.view === "analytics") return "#/analytics";
  if (r.view === "admin") return r.section ? `#/admin/${r.section}` : "#/admin";
  return `#/post/${r.id}`;
}

let current: Route = parse();
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    current = parse();
    for (const l of listeners) l();
  });
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const on = () => setRoute(current);
    listeners.add(on);
    on();
    return () => {
      listeners.delete(on);
    };
  }, []);
  return [route, go];
}

export function go(r: Route) {
  window.location.hash = toHash(r);
}

/** Open a registered page (lib/routes.ts), optionally at a sub-path. */
export function goPage(page: string, rest?: string | null) {
  go({ view: "page", page, rest: rest ?? null });
}

/** The open page's sub-path: "abc" for #/inbox/abc, null for #/inbox. */
export function usePageRest(): string | null {
  const [route] = useRoute();
  return route.view === "page" ? route.rest : null;
}

export function pageHref(page: string, rest?: string | null): string {
  return toHash({ view: "page", page, rest: rest ?? null });
}

export function postHref(id: string): string {
  return `#/post/${id}`;
}

export function analyticsHref(): string {
  return "#/analytics";
}

export function planHref(): string {
  return "#/pipeline";
}

export function briefHref(id: string): string {
  return `#/brief/${encodeURIComponent(id)}`;
}
