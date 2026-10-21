// The themed blog's input from a site's data: its settings, collections and
// posts. Pure, so Themed.tsx (the browser) and the rendering function
// (blog/server/) build the same view model from the same rows.

import { asCustomThemes, asDesign, themeOf, type CustomThemes, type SiteDesign } from "./design";
import { firstParagraph, type PgInput } from "./vm";
import type { BlogPost } from "@/blog/model";
import type { BlogSite } from "@/blog/siteTypes";
import { VERBATIM_MANIFESTO } from "@/blog/original";
import { collectionSlugOf } from "@/lib/slug";
import { siteHost } from "@/lib/siteUrl";
import type { Collection } from "@/types";

export interface ThemedSettings {
  /** The site's name for the page: `site.title`, else the site's name. */
  title: string;
  design: SiteDesign | null;
  customThemes: CustomThemes;
  input: Omit<PgInput, "collections" | "posts">;
}

/** The settings the themed blog reads, through `get` (a settings cache or a fetched map). */
export function themedSettingsOf(get: (key: string) => unknown, site: BlogSite): ThemedSettings {
  const str = (key: string) => {
    const v = get(key);
    return typeof v === "string" ? v : "";
  };
  const title = str("site.title") || site.name;
  const tagline = str("site.tagline");
  const authorTagline = str("author.tagline");
  const manifesto = str("site.manifesto") || (site.slug === "verbatim" ? VERBATIM_MANIFESTO : "");
  const links = get("author.links");
  const avatar = get("author.avatar");
  return {
    title,
    design: asDesign(get("blog.design")),
    customThemes: asCustomThemes(get("blog.themes")),
    input: {
      site: { name: title, host: siteHost(site), lang: "en", tagline: tagline || authorTagline, manifesto },
      author: {
        name: str("author.name"),
        tagline: authorTagline,
        location: str("author.location"),
        bio: str("author.bio"),
        avatar: typeof avatar === "string" ? avatar : null,
        links: Array.isArray(links) ? (links as { label: string; url: string }[]) : [],
      },
    },
  };
}

/** The full input: the settings' part plus the site's collections and posts. */
export function themedInputOf(settings: ThemedSettings, collections: Collection[], posts: BlogPost[]): PgInput {
  return {
    ...settings.input,
    collections: collections.map((c) => ({
      name: c.name,
      slug: c.slug || collectionSlugOf(c.name, collections),
      description: c.description,
      emoji: c.emoji,
      hidden: c.isHidden,
    })),
    posts: posts.map((p) => ({
      id: p.id,
      number: p.number,
      slug: p.slug,
      collection: collectionSlugOf(p.type, collections),
      title: p.title,
      subtitle: p.subtitle,
      excerpt: p.excerpt || firstParagraph(p.content),
      date: p.publishedAt,
      words: p.wordCount,
      content: p.content,
    })),
  };
}

export { themeOf };
