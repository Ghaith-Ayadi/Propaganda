// The rendering function's reads: PostgREST on the app host, as the anonymous
// key, the same rows the browser reads (blog/data.ts). No supabase-js: one
// fetch per table, paged like fetchAll().

import {
  fromBlogRecord,
  fromCollectionRecord,
  PUBLIC_POST_FIELDS,
  type BlogPost,
  type BlogPostRecord,
  type CollectionRecord,
} from "@/blog/model";
import type { BlogSite } from "@/blog/siteTypes";
import type { Collection } from "@/types";

export interface Api {
  url: string;
  key: string;
}

const PAGE = 1000;
const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function get<T>(api: Api, path: string, range?: [number, number]): Promise<T> {
  const headers: Record<string, string> = {
    apikey: api.key,
    Authorization: `Bearer ${api.key}`,
    Accept: "application/json",
  };
  if (range) {
    headers["Range-Unit"] = "items";
    headers.Range = `${range[0]}-${range[1]}`;
  }
  const res = await fetch(`${api.url.replace(/\/$/, "")}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok && res.status !== 206) throw new ApiError(`${path}: ${res.status}`, res.status);
  return (await res.json()) as T;
}

async function all<T>(api: Api, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await get<T[]>(api, path, [from, from + PAGE - 1]);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

const SITE_FIELDS = "id,name,slug,domain,analytics_tenant";
interface SiteRecord {
  id: string;
  name: string;
  slug: string;
  domain: string;
  analytics_tenant: string;
}
const fromSite = (r: SiteRecord): BlogSite => ({
  id: r.id,
  slug: r.slug,
  domain: r.domain || "",
  name: r.name,
  analyticsTenant: r.analytics_tenant || r.slug,
});

export async function siteBySlug(api: Api, slug: string): Promise<BlogSite | null> {
  const rows = await get<SiteRecord[]>(api, `sites?select=${SITE_FIELDS}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows[0] ? fromSite(rows[0]) : null;
}

export async function siteByDomain(api: Api, domain: string): Promise<BlogSite | null> {
  const rows = await get<SiteRecord[]>(api, `sites?select=${SITE_FIELDS}&domain=eq.${encodeURIComponent(domain)}&limit=1`);
  return rows[0] ? fromSite(rows[0]) : null;
}

/** Every setting of the site, as the browser's cache holds them. */
/**
 * The settings a blog page is made of: the only keys the server reads, and
 * all of them public (a site's name, tagline, manifesto, favicon, author and
 * design). Nothing else is fetched, so a key that is private stays private
 * even if the API let it through.
 */
export const PUBLIC_SETTING_KEYS = [
  "site.title", "site.tagline", "site.manifesto", "favicon.url",
  "author.name", "author.tagline", "author.location", "author.bio", "author.links", "author.avatar",
  "blog.design", "blog.themes",
] as const;

export async function settingsOf(api: Api, siteId: string): Promise<Map<string, unknown>> {
  const keys = `key=in.(${PUBLIC_SETTING_KEYS.map((k) => `"${k}"`).join(",")})`;
  const rows = await all<{ key: string; value: unknown }>(api, `app_settings?select=key,value&site=eq.${siteId}&${keys}&order=key`);
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function collectionsOf(api: Api, siteId: string): Promise<Collection[]> {
  const rows = await all<CollectionRecord>(api, `collections?select=*&site=eq.${siteId}&order=position,id`);
  return rows.map(fromCollectionRecord);
}

/** The site's published posts, newest first, undated last (blog/data.ts orders the same). */
export async function postsOf(api: Api, siteId: string): Promise<BlogPost[]> {
  const rows = await all<BlogPostRecord>(
    api,
    `posts?select=${PUBLIC_POST_FIELDS}&site=eq.${siteId}&status=eq.published&order=published_at.desc.nullslast,id`,
  );
  return rows.map(fromBlogRecord);
}

/** A published post by the legacy post_id code ("THM·08"): its id, or null. */
export async function postIdByCode(api: Api, siteId: string, code: string): Promise<string | null> {
  const rows = await get<{ id: string }[]>(
    api,
    `posts?select=id&site=eq.${siteId}&status=eq.published&post_id=eq.${encodeURIComponent(code)}&order=id&limit=1`,
  );
  return rows[0]?.id ?? null;
}

/** Where an old address points: the post's id, or null. `collection` null matches any (a /p/<slug> link). */
export async function redirectTarget(api: Api, siteId: string, collection: string | null, slug: string): Promise<string | null> {
  const col = collection === null ? "" : `&collection=eq.${encodeURIComponent(collection)}`;
  const rows = await get<{ post: string }[]>(api, `post_redirects?select=post&site=eq.${siteId}${col}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows[0]?.post ?? null;
}
