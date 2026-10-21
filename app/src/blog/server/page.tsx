// What a blog page is made of on the server: the same React components the
// browser renders (blog/components/ for the original blog, blog/theme/ for
// the themed one), rendered to a string and placed in the app's built shell
// (dist/index.html, so the script and stylesheet the browser needs are the
// build's own), with the head crawlers read: title, description, canonical,
// Open Graph, the feed, JSON-LD.
//
// The markup goes in <div id="pg-ssr">, next to the empty #root the app mounts
// in; BlogApp keeps it on screen until its first real render (TakeOver).

import { renderToString } from "react-dom/server";
import blogCss from "../styles.css?inline";
import pgCss from "../theme/pg.css?inline";
import { Home } from "../components/Home";
import { ReaderArticle } from "../components/ReaderArticle";
import { SiteNotFound } from "../components/SiteNotFound";
import { Topbar } from "../components/Topbar";
import { Colophon } from "../components/Colophon";
import { PgSite, postOf } from "../theme/Site";
import { buildVM, firstImage, firstParagraph, type PgLinks, type PgRoute } from "../theme/vm";
import { resolveDesign } from "../theme/schema";
import { compiledOf, themeCss } from "../theme/design";
import { themedInputOf, themedSettingsOf, themeOf } from "../theme/input";
import { blogAddress, type BlogPost } from "../model";
import { originalSettingsOf } from "../original";
import { homeHref, routeHref, type BlogRoute } from "../route";
import type { BlogSite } from "../siteTypes";
import type { Collection } from "@/types";
import { collectionSlugOf } from "@/lib/slug";
import { absolute, postUrl, siteUrl, type Hosts } from "./urls";
import type { FillOptions } from "./fill";

export interface SiteData {
  site: BlogSite;
  settings: Map<string, unknown>;
  collections: Collection[];
  posts: BlogPost[];
}

/** A rendered page before it goes into the shell: entry.tsx fills the build's
 * shell (fill.ts); the box writes the parts as a fragment for Caddy to wrap. */
export interface Rendered {
  status: number;
  parts: FillOptions;
}

interface Head {
  title: string;
  description: string;
  canonical: string;
  type: "website" | "article";
  image?: string | null;
  published?: number | null;
  modified?: number | null;
  /** Keep crawlers off a page that answers 404. */
  noindex?: boolean;
  /** The post as Markdown (its address plus .md), for crawlers that prefer it. */
  markdown?: string | null;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[] | null;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const get = (settings: Map<string, unknown>) => (key: string) => settings.get(key);

/** A post's one-line description: subtitle, excerpt, else its first paragraph. */
export function dekOf(post: BlogPost): string {
  return (post.subtitle || post.excerpt || "").trim() || firstParagraph(post.content) || "";
}

/** A post's first image as an absolute URL, for Open Graph. */
function imageOf(post: BlogPost, site: BlogSite, hosts: Hosts): string | null {
  const im = firstImage(post.content);
  if (!im) return null;
  try {
    return new URL(im.src, siteUrl(site, hosts)).href;
  } catch {
    return null;
  }
}

const iso = (ms: number | null | undefined) => (ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

function headTags(h: Head, data: SiteData, hosts: Hosts, siteTitle: string): string {
  const tags: string[] = [];
  const meta = (attr: string, content: string | null | undefined) => {
    if (content) tags.push(`<meta ${attr} content="${esc(content)}">`);
  };
  tags.push(`<title>${esc(h.title)}</title>`);
  meta('name="description"', h.description);
  tags.push(`<link rel="canonical" href="${esc(h.canonical)}">`);
  if (h.noindex) meta('name="robots"', "noindex");
  meta('property="og:site_name"', siteTitle);
  meta('property="og:type"', h.type);
  meta('property="og:title"', h.title);
  meta('property="og:description"', h.description);
  meta('property="og:url"', h.canonical);
  meta('property="og:image"', h.image);
  meta('property="article:published_time"', iso(h.published));
  meta('property="article:modified_time"', iso(h.modified));
  meta('name="twitter:card"', h.image ? "summary_large_image" : "summary");
  meta('name="twitter:title"', h.title);
  meta('name="twitter:description"', h.description);
  meta('name="twitter:image"', h.image);
  tags.push(`<link rel="alternate" type="application/rss+xml" title="${esc(siteTitle)}" href="${esc(absolute(data.site, hosts, "/feed.xml"))}">`);
  if (h.markdown) tags.push(`<link rel="alternate" type="text/markdown" href="${esc(h.markdown)}">`);
  if (h.jsonLd) tags.push(`<script type="application/ld+json">${JSON.stringify(h.jsonLd).replace(/</g, "\\u003c")}</script>`);
  return tags.join("\n    ");
}

/** The parts of a page, with the favicon URL escaped for its attribute. */
function parts(opts: FillOptions): FillOptions {
  return { ...opts, favicon: opts.favicon ? esc(opts.favicon) : null };
}

export function siteNotFoundParts(): Rendered {
  const markup = renderToString(<SiteNotFound />);
  const head = [`<title>Site not found</title>`, `<meta name="robots" content="noindex">`].join("\n    ");
  return { status: 404, parts: parts({ head, css: [blogCss], markup }) };
}

/* ---------------------------------------------------------------- original */

const noop = () => {};

function originalPage(route: BlogRoute, data: SiteData, hosts: Hosts): Rendered {
  const { site, settings, collections, posts } = data;
  const original = originalSettingsOf(get(settings), site);
  const siteTitle = (settings.get("site.title") as string) || site.name;
  const favicon = (settings.get("favicon.url") as string) || null;
  const hidden = new Set(collections.filter((c) => c.isHidden).map((c) => c.name));
  const home = (): Rendered => {
    const initialTab = route.view === "collection" ? collections.find((c) => (c.slug || collectionSlugOf(c.name, collections)) === route.collection)?.name ?? null : null;
    const markup = renderToString(<Home collections={collections} posts={posts} site={site} settings={original} initialTab={initialTab} />);
    const head: Head = {
      title: siteTitle,
      description: original.manifesto || (settings.get("site.tagline") as string) || `${siteTitle}: ${posts.length} posts.`,
      canonical: siteUrl(site, hosts),
      type: "website",
      jsonLd: { "@context": "https://schema.org", "@type": "Blog", name: siteTitle, url: siteUrl(site, hosts) },
    };
    return { status: 200, parts: parts({ head: headTags(head, data, hosts, siteTitle), css: [blogCss], markup, favicon }) };
  };
  if (route.view !== "post") return home();

  const post = posts.find((p) => p.slug === route.slug && collectionSlugOf(p.type, collections) === route.collection) ?? null;
  if (!post || hidden.has(post.type)) {
    const isHidden = !!post;
    const markup = renderToString(
      <div className="blog-app">
        <Topbar site={site} backLabel="Index" onBack={noop} />
        <article className="blog-article">
          <h1>{isHidden ? "Private collection." : "Not found."}</h1>
          <p className="dek">{isHidden ? "This post belongs to a collection that isn't publicly available." : "That post isn't published, or the URL is off."}</p>
        </article>
        <Colophon site={site} />
      </div>,
    );
    const head: Head = { title: `${isHidden ? "Private collection" : "Not found"} — ${siteTitle}`, description: "", canonical: siteUrl(site, hosts), type: "website", noindex: true };
    return { status: 404, parts: parts({ head: headTags(head, data, hosts, siteTitle), css: [blogCss], markup, favicon }) };
  }
  const markup = renderToString(<ReaderArticle post={post} collections={collections} posts={posts} site={site} author={original.author} onBack={noop} />);
  const canonical = postUrl(site, hosts, route.collection, post.slug);
  const image = imageOf(post, site, hosts);
  const who = publishingOf(data, hosts, original.author.name || siteTitle, siteTitle, false);
  const crumbs = [
    { name: siteTitle, url: siteUrl(site, hosts) },
    { name: post.type, url: absolute(site, hosts, `/${encodeURIComponent(route.collection)}`) },
    { name: post.title || "Untitled", url: canonical },
  ];
  const head: Head = {
    title: `${post.title || "Untitled"} — ${site.name}`,
    description: dekOf(post),
    canonical,
    type: "article",
    image,
    published: post.publishedAt,
    modified: post.updatedAt,
    markdown: `${canonical}.md`,
    jsonLd: postJsonLd(post, canonical, image, who, crumbs),
  };
  return { status: 200, parts: parts({ head: headTags(head, data, hosts, siteTitle), css: [blogCss], markup, favicon }) };
}

/** Who wrote it and who publishes it, as JSON-LD wants them. */
export interface Publishing {
  author: { name: string; url: string; bio?: string | null };
  publisher: { name: string; url: string; logo?: string | null };
}

function publishingOf(data: SiteData, hosts: Hosts, authorName: string, siteTitle: string, authorPage: boolean): Publishing {
  const { site, settings } = data;
  const home = siteUrl(site, hosts);
  const bio = (settings.get("author.bio") as string) || null;
  const favicon = (settings.get("favicon.url") as string) || null;
  let logo: string | null = null;
  if (favicon) {
    try {
      logo = new URL(favicon, home).href;
    } catch {
      logo = null;
    }
  }
  return {
    author: { name: authorName, url: authorPage ? absolute(site, hosts, "/author") : home, bio },
    publisher: { name: siteTitle, url: home, logo },
  };
}

/** The post's BlogPosting and its BreadcrumbList (home, collection, post). */
function postJsonLd(post: BlogPost, url: string, image: string | null, who: Publishing, crumbs: Array<{ name: string; url: string }>): Record<string, unknown>[] {
  const posting = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title || "Untitled",
    description: dekOf(post),
    url,
    mainEntityOfPage: url,
    ...(image ? { image } : {}),
    ...(iso(post.publishedAt) ? { datePublished: iso(post.publishedAt) } : {}),
    ...(iso(post.updatedAt) ? { dateModified: iso(post.updatedAt) } : {}),
    author: { "@type": "Person", name: who.author.name, url: who.author.url, ...(who.author.bio ? { description: who.author.bio } : {}) },
    publisher: {
      "@type": "Organization",
      name: who.publisher.name,
      url: who.publisher.url,
      ...(who.publisher.logo ? { logo: { "@type": "ImageObject", url: who.publisher.logo } } : {}),
    },
    ...(post.wordCount ? { wordCount: post.wordCount } : {}),
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
  };
  return [posting, breadcrumbs];
}

/* ---------------------------------------------------------------- themed */

const links: PgLinks = {
  home: () => homeHref(),
  collection: (slug) => routeHref({ view: "collection", collection: slug }),
  post: (collection, slug) => routeHref({ view: "post", collection, slug }),
  author: () => routeHref({ view: "author" }),
};

function pgRouteOf(r: BlogRoute): PgRoute {
  if (r.view === "post") return { tpl: "post", collection: r.collection, post: r.slug };
  if (r.view === "legacy") return { tpl: "post", post: r.slug };
  if (r.view === "collection") return { tpl: "collection", collection: r.collection };
  if (r.view === "author") return { tpl: "author" };
  return { tpl: "home" };
}

function themedPage(route: BlogRoute, data: SiteData, hosts: Hosts): Rendered {
  const { site, settings, collections, posts } = data;
  const themed = themedSettingsOf(get(settings), site);
  const design = themed.design!;
  const favicon = (settings.get("favicon.url") as string) || null;
  const theme = themeOf(design.theme, themed.customThemes);
  const compiled = compiledOf(theme);
  const resolved = resolveDesign(theme, design.overrides).design;
  const vm = buildVM(themedInputOf(themed, collections, posts), compiled, links, theme.layout?.headerAlign);
  const pgRoute = pgRouteOf(route);
  const post = postOf(vm, pgRoute);
  const title = themed.title;

  let status = 200;
  let page: { title: string; text: string; home?: boolean } | null = null;
  let head: Head;
  if (pgRoute.tpl === "post") {
    if (!post) {
      // In a private collection (the vm leaves those out), or nothing at all.
      const raw = posts.find((p) => p.slug === pgRoute.post && (!pgRoute.collection || collectionSlugOf(p.type, collections) === pgRoute.collection));
      const isHidden = !!raw && collections.some((c) => c.name === raw.type && c.isHidden);
      page = isHidden
        ? { title: "Private collection", text: "This post belongs to a collection that isn’t publicly available.", home: true }
        : { title: "Not found", text: "That post isn’t published, or the address is off.", home: true };
      status = 404;
      head = { title: `${page.title} — ${title}`, description: "", canonical: siteUrl(site, hosts), type: "website", noindex: true };
    } else {
      const raw = posts.find((p) => p.id === post.id)!;
      const canonical = postUrl(site, hosts, post.col.slug, post.slug);
      const image = imageOf(raw, site, hosts);
      const who = publishingOf(data, hosts, vm.author.displayName, title, true);
      const crumbs = [
        { name: title, url: siteUrl(site, hosts) },
        { name: post.col.name, url: absolute(site, hosts, post.col.href) },
        { name: post.title, url: canonical },
      ];
      head = {
        title: `${post.title} — ${title}`,
        description: post.dek || firstParagraph(post.content) || "",
        canonical,
        type: "article",
        image,
        published: raw.publishedAt,
        modified: raw.updatedAt,
        markdown: `${canonical}.md`,
        jsonLd: postJsonLd(raw, canonical, image, who, crumbs),
      };
    }
  } else if (pgRoute.tpl === "collection") {
    const c = vm.collections.find((x) => x.slug === pgRoute.collection);
    if (!c) {
      status = 404;
      page = { title: "Not found", text: "There’s no collection at this address.", home: true };
      head = { title: `Not found — ${title}`, description: "", canonical: siteUrl(site, hosts), type: "website", noindex: true };
    } else {
      head = { title: `${c.name} — ${title}`, description: c.description || `${c.count} posts in ${c.name}.`, canonical: absolute(site, hosts, c.href), type: "website" };
    }
  } else if (pgRoute.tpl === "author") {
    head = { title: `${vm.author.displayName} — ${title}`, description: vm.author.bio || vm.author.tagline || "", canonical: absolute(site, hosts, "/author"), type: "website" };
  } else {
    head = {
      title,
      description: vm.site.tagline || vm.site.manifesto || `${title}: ${vm.posts.length} posts.`,
      canonical: siteUrl(site, hosts),
      type: "website",
      jsonLd: { "@context": "https://schema.org", "@type": "Blog", name: title, url: siteUrl(site, hosts) },
    };
  }

  const markup = renderToString(<PgSite vm={vm} design={resolved} attrs={compiled.attrs} route={pgRoute} page={page} />);
  const headHtml = `${headTags(head, data, hosts, title)}\n    <style id="pg-theme">${themeCss(compiled)}</style>`;
  return {
    status,
    parts: parts({ head: headHtml, css: [pgCss], htmlAttrs: `style="background:${esc(compiled.palette.paper)}"`, markup, favicon }),
  };
}

/** Which renderer the site has: a published design means the themed one (blog/BlogApp.tsx decides the same). */
export function isThemed(settings: Map<string, unknown>): boolean {
  return !!themedSettingsOf(get(settings), { id: "", slug: "", domain: "", name: "", analyticsTenant: "" }).design;
}

export function renderParts(route: BlogRoute, data: SiteData, hosts: Hosts): Rendered {
  return isThemed(data.settings) ? themedPage(route, data, hosts) : originalPage(route, data, hosts);
}

export { blogAddress };
