// Tiny URL state hook. Routes by post ID (not slug) so editing the slug
// in the attribute panel doesn't break the page.

import { useEffect, useState } from "react";

export type Route =
  | { view: "list" }
  | { view: "post"; id: number }
  | { view: "plan" }
  | { view: "brief"; id: string }
  | { view: "analytics" };

function parse(): Route {
  const h = window.location.hash;
  const m = h.match(/^#\/post\/(\d+)$/);
  if (m) return { view: "post", id: Number(m[1]) };
  const mb = h.match(/^#\/brief\/(.+)$/);
  if (mb) return { view: "brief", id: decodeURIComponent(mb[1]) };
  if (h === "#/plan") return { view: "plan" };
  if (h === "#/analytics") return { view: "analytics" };
  return { view: "list" };
}

function toHash(r: Route): string {
  if (r.view === "list") return "#/";
  if (r.view === "plan") return "#/plan";
  if (r.view === "brief") return `#/brief/${encodeURIComponent(r.id)}`;
  if (r.view === "analytics") return "#/analytics";
  return `#/post/${r.id}`;
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse());
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (r: Route) => {
    const hash = toHash(r);
    if (window.location.hash !== hash) window.location.hash = hash;
    else setRoute(r);
  };
  return [route, navigate];
}

export function go(r: Route) {
  window.location.hash = toHash(r);
}

export function postHref(id: number): string {
  return `#/post/${id}`;
}

export function analyticsHref(): string {
  return "#/analytics";
}

export function planHref(): string {
  return "#/plan";
}

export function briefHref(id: string): string {
  return `#/brief/${encodeURIComponent(id)}`;
}
