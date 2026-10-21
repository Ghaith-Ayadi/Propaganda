// The rendering function's whole job, built into one file by
// app/vite.ssr.config.ts (api/_blog/dist/entry.js) and called by api/blog.ts
// with the request and its env: which site the host names, which page the
// path names, the rows, the HTML (page.tsx) or the feed (feeds.tsx).
//
// Answers, in order:
//   /@<slug>/…            301 to the same path on that site's host (old addresses)
//   <slug>.<platform>     301 to the site's custom domain when it has one
//   no site for the host  404, "Site not found"
//   /robots.txt, /sitemap.xml, /feed.xml (and /rss.xml)
//   /p/<slug>             301 to the post's address (pre-collection links)
//   an address that moved 301 to the current one (post_redirects)
//   a page                200, or 404 with the page's own not-found markup
// ?pg-preview=draft (the Design panel's frame) gets the plain shell: the
// draft lives in the browser.

import { parseLegacySitePath } from "@/lib/siteUrl";
import { collectionSlugOf, postPath, slugify } from "@/lib/slug";
import { routeOf, type BlogRoute } from "../route";
import type { BlogSite } from "../siteTypes";
import { ApiError, collectionsOf, postIdByCode, postsOf, redirectTarget, settingsOf, siteByDomain, siteBySlug, type Api } from "./api";
import { robots, rss, sitemap } from "./feeds";
import { plainShell, renderPage, siteNotFoundPage, type SiteData } from "./page";
import { absolute, siteUrl, slugOfHost, type Hosts } from "./urls";

export interface Env {
  /** The API's origin ("https://app.propaganda.pub") and anonymous key. */
  apiUrl?: string;
  apiKey?: string;
  platformDomain?: string;
  appHost?: string;
}

/** The build's values, for whatever the function's env leaves out. */
const BUILT = {
  apiUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  apiKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  platformDomain: (import.meta.env.VITE_PLATFORM_DOMAIN as string | undefined) || "propaganda.pub",
  appHost: import.meta.env.VITE_APP_HOST as string | undefined,
};

/** The header Caddy adds with the host the reader asked for (Vercel only sees its own). */
export const HOST_HEADER = "x-propaganda-host";

const HTML = { "Content-Type": "text/html; charset=utf-8" };
const CACHE = { "Cache-Control": "public, max-age=60", Vary: HOST_HEADER };

function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...HTML, ...CACHE, ...extra } });
}
function redirect(to: string): Response {
  return new Response(null, { status: 301, headers: { Location: to, ...CACHE } });
}
function text(body: string, type: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": type, ...CACHE } });
}

/** The shell alone, when the page can't be rendered: the app in the browser still works. */
export function fallback(reason: string): Response {
  return new Response(plainShell(), { status: 200, headers: { ...HTML, "Cache-Control": "no-store", "X-Blog-Render": reason } });
}

export async function handle(request: Request, env: Env = {}): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const api: Api = { url: env.apiUrl || BUILT.apiUrl || "", key: env.apiKey || BUILT.apiKey || "" };
  const platformDomain = (env.platformDomain || BUILT.platformDomain).toLowerCase();
  const hosts: Hosts = { platformDomain, appHost: (env.appHost || BUILT.appHost || `app.${platformDomain}`).toLowerCase() };
  const url = new URL(request.url);
  const host = (request.headers.get(HOST_HEADER) || url.hostname).toLowerCase().replace(/:\d+$/, "");
  const path = url.pathname;
  // Vercel's rewrite adds what it matched (the path, the header) to the query; readers never sent those.
  for (const synthetic of ["path", HOST_HEADER]) url.searchParams.delete(synthetic);

  if (url.searchParams.has("pg-preview")) return fallback("preview");

  // An old "/@slug/…" address: the blog lives on its own host now.
  const legacy = parseLegacySitePath(path);
  if (legacy) {
    const site = await siteBySlug(api, legacy.slug);
    if (!site) return html(siteNotFoundPage().html, 404);
    return redirect(absolute(site, hosts, legacy.rest) + url.search);
  }

  const slug = slugOfHost(host, hosts);
  const site = slug ? await siteBySlug(api, slug) : await siteByDomain(api, host);
  if (!site) return html(siteNotFoundPage().html, 404);
  // A blog with a custom domain is read there; its subdomain forwards.
  if (slug && site.domain && site.domain !== host) return redirect(absolute(site, hosts, path) + url.search);

  const data = await dataOf(api, site);

  if (path === "/robots.txt") return text(robots(data, hosts), "text/plain; charset=utf-8");
  if (path === "/sitemap.xml") return text(sitemap(data, hosts), "application/xml; charset=utf-8");
  if (path === "/feed.xml" || path === "/rss.xml") return text(rss(data, hosts), "application/rss+xml; charset=utf-8");

  const route = routeOf(path);
  const moved = await movedTo(route, data, api);
  if (moved) return redirect(absolute(site, hosts, moved) + url.search);

  const page = renderPage(route, data, hosts);
  return html(page.html, page.status);
}

/** A site's settings, collections and published posts, read together. */
export async function dataOf(api: Api, site: BlogSite): Promise<SiteData> {
  const [settings, collections, posts] = await Promise.all([settingsOf(api, site.id), collectionsOf(api, site.id), postsOf(api, site.id)]);
  return { site, settings, collections, posts };
}

/** Where an address that names no loaded post now points (site-relative), or null. */
async function movedTo(route: BlogRoute, data: SiteData, api: Api): Promise<string | null> {
  const { site, collections, posts } = data;
  const addressOf = (p: { type: string; slug: string }) => postPath(collectionSlugOf(p.type, collections), p.slug);
  if (route.view === "legacy") {
    // Oldest first, as the browser resolves /p/<slug> (blog/data.ts fetchLegacyPost).
    const bySlug = [...posts].filter((p) => p.slug === route.slug).sort((a, b) => (a.publishedAt ?? -Infinity) - (b.publishedAt ?? -Infinity))[0];
    if (bySlug) return addressOf(bySlug);
    const byCode = await postIdByCode(api, site.id, route.slug);
    const coded = byCode ? posts.find((p) => p.id === byCode) : null;
    if (coded) return addressOf(coded);
    const id = await redirectTarget(api, site.id, null, route.slug);
    const target = id ? posts.find((p) => p.id === id) : null;
    return target ? addressOf(target) : null;
  }
  if (route.view === "post") {
    const col = collections.find((c) => (c.slug || collectionSlugOf(c.name, collections)) === route.collection);
    const found = col
      ? posts.find((p) => p.type === col.name && p.slug === route.slug)
      : posts.find((p) => p.slug === route.slug && slugify(p.type) === route.collection);
    if (found) return null;
    const id = await redirectTarget(api, site.id, route.collection, route.slug);
    const target = id ? posts.find((p) => p.id === id) : null;
    return target ? addressOf(target) : null;
  }
  return null;
}

// For tests and tools: the pieces behind handle().
export { ApiError, renderPage, rss, sitemap, robots, siteBySlug, siteByDomain, type BlogSite, type SiteData };
