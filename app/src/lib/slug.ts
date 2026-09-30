// Post addresses: /<collection slug>/<post slug> at the root of the site's own
// host, its subdomain or custom domain (see lib/siteUrl.ts).
//
// Same slugify and reserved words as the server (pb/pb_hooks/lib/addresses.js),
// which has the last word: it gives a published post's address a -2, -3, … when
// it's taken, keeps a redirect whenever a published post moves, and sets every
// collection's slug.

/** First path segments the app or the edge already own; no collection gets one. */
export const RESERVED_SEGMENTS = ["admin", "api", "assets", "author", "cards", "feed", "p", "rss", "search", "tags"];

/** "Café au lait!" -> "cafe-au-lait". Empty when nothing usable is left. */
export function slugify(text: string | null | undefined): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** A post's slug from its title: what it follows until it's first published. */
export function titleSlug(title: string | null | undefined): string {
  return slugify(title) || "untitled";
}

/** base, base-2, base-3, …: the first one not in `taken`. */
export function dedupe(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Whether a post has a public address: it's published, or it has been
 * (`publishedAt` is set on first publish and never cleared). Its slug is fixed
 * from then on; before, it follows the title.
 */
export function hasAddress(post: { status: string | null; publishedAt: number | null }): boolean {
  return post.status === "published" || post.publishedAt != null;
}

/** A collection's URL segment: the slug the server gave it, else its name slugified. */
export function collectionSlugOf(
  name: string | null | undefined,
  collections: Iterable<{ name: string; slug?: string | null }>,
): string {
  for (const c of collections) if (c.name === name && c.slug) return c.slug;
  return slugify(name) || "collection";
}

/** A post's path under its site's base path. */
export function postPath(collectionSlug: string, slug: string): string {
  return `/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(slug)}`;
}
