// What the original blog renderer (blog/components/) reads from the site's
// settings, resolved once by whoever holds them: BlogApp from the settings
// cache, the rendering function (blog/server/) from the rows it fetched. The
// components take the values as props, so they render the same on both sides.

import type { BlogSite } from "./siteTypes";

/** Verbatim's own manifesto and founding year; other sites show their settings or nothing. */
export const VERBATIM_MANIFESTO =
  "It's called Verbatim because none of it is edited. I don't edit what I write. If I don't like what I said, I don't publish. No AI writing, no nonsense.";

export interface OriginalSettings {
  manifesto: string;
  author: { name: string; tagline: string; location: string };
}

export function originalSettingsOf(get: (key: string) => unknown, site: Pick<BlogSite, "slug">): OriginalSettings {
  const str = (key: string) => {
    const v = get(key);
    return typeof v === "string" ? v : "";
  };
  const tagline = str("author.tagline");
  const fallback = site.slug === "verbatim" ? VERBATIM_MANIFESTO : tagline;
  return {
    manifesto: str("site.manifesto") || fallback,
    author: { name: str("author.name"), tagline, location: str("author.location") },
  };
}
