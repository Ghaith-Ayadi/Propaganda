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
import shell from "../../../dist/index.html?raw";
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
import { fillShell, type FillOptions } from "./fill";

export interface SiteData {
  site: BlogSite;
  settings: Map<string, unknown>;
  collections: Collection[];
  posts: BlogPost[];
}

export interface Page {
  status: number;
  html: string;
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
  jsonLd?: Record<string, unknown> | null;
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
  if (h.jsonLd) tags.push(`<script type="application/ld+json">${JSON.stringify(h.jsonLd).replace(/</g, "\\u003c")}</script>`);
  return tags.join("\n    ");
}

/** The built shell with the head, the styles and the page's markup in it (fill.ts). */
function fill(opts: FillOptions): string {
  return fillShell(shell, { ...opts, favicon: opts.favicon ? esc(opts.favicon) : null });
}

/** The shell as the browser gets it today: no page in it. The app renders everything. */
export function plainShell(): string {
  return shell;
}

export function siteNotFoundPage(): Page {
  const markup = renderToString(<SiteNotFound />);
  const head = [`<title>Site not found</title>`, `<meta name="robots" content="noindex">`].join("\n    ");
  return { status: 404, html: fill({ head, css: [blogCss], markup }) };
}

/* ---------------------------------------------------------------- original */

const noop = () => {};

function originalPage(route: BlogRoute, data: SiteData, hosts: Hosts): Page {
  const { site, settings, collections, posts } = data;
  const original = originalSettingsOf(get(settings), site);
  const siteTitle = (settings.get("site.title") as string) || site.name;
  const favicon = (settings.get("favicon.url") as string) || null;
  const hidden = new Set(collections.filter((c) => c.isHidden).map((c) => c.name));
  const home = (): Page => {
    const initialTab = route.view === "collection" ? collections.find((c) => (c.slug || collectionSlugOf(c.name, collections)) === route.collection)?.name ?? null : null;
    const markup = renderToString(<Home collections={collections} posts={posts} site={site} settings={original} initialTab={initialTab} />);
    const head: Head = {
      title: siteTitle,
      description: original.manifesto || (settings.get("site.tagline") as string) || `${siteTitle}: ${posts.length} posts.`,
      canonical: siteUrl(site, hosts),
      type: "website",
      jsonLd: { "@context": "https://schema.org", "@type": "Blog", name: siteTitle, url: siteUrl(site, hosts) },
    };
    return { status: 200, html: fill({ head: headTags(head, data, hosts, siteTitle), css: [blogCss], markup, favicon }) };
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
    return { status: 404, html: fill({ head: headTags(head, data, hosts, siteTitle), css: [blogCss], markup, favicon }) };
  }
  const markup = renderToString(<ReaderArticle post={post} collections={collections} posts={posts} site={site} author={original.author} onBack={noop} />);
  const canonical = postUrl(site, hosts, route.collection, post.slug);
  const image = imageOf(post, site, hosts);
  const head: Head = {
    title: `${post.title || "Untitled"} — ${site.name}`,
    description: dekOf(post),
    canonical,
    type: "article",
    image,
    published: post.publishedAt,
    modified: post.updatedAt,
    jsonLd: postJsonLd(post, canonical, image, original.author.name || siteTitle, siteTitle),
  };
  return { status: 200, html: fill({ head: headTags(head, data, hosts, siteTitle), css: [blogCss], markup, favicon }) };
}

function postJsonLd(post: BlogPost, url: string, image: string | null, author: string, publisher: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title || "Untitled",
    description: dekOf(post),
    url,
    mainEntityOfPage: url,
    ...(image ? { image } : {}),
    ...(iso(post.publishedAt) ? { datePublished: iso(post.publishedAt) } : {}),
    ...(iso(post.updatedAt) ? { dateModified: iso(post.updatedAt) } : {}),
    author: { "@type": "Person", name: author },
    publisher: { "@type": "Organization", name: publisher },
    ...(post.wordCount ? { wordCount: post.wordCount } : {}),
  };
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

function themedPage(route: BlogRoute, data: SiteData, hosts: Hosts): Page {
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
      head = {
        title: `${post.title} — ${title}`,
        description: post.dek || firstParagraph(post.content) || "",
        canonical,
        type: "article",
        image,
        published: raw.publishedAt,
        modified: raw.updatedAt,
        jsonLd: postJsonLd(raw, canonical, image, vm.author.displayName, title),
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
    html: fill({ head: headHtml, css: [pgCss], htmlAttrs: `style="background:${esc(compiled.palette.paper)}"`, markup, favicon }),
  };
}

/** Which renderer the site has: a published design means the themed one (blog/BlogApp.tsx decides the same). */
export function isThemed(settings: Map<string, unknown>): boolean {
  return !!themedSettingsOf(get(settings), { id: "", slug: "", domain: "", name: "", analyticsTenant: "" }).design;
}

export function renderPage(route: BlogRoute, data: SiteData, hosts: Hosts): Page {
  return isThemed(data.settings) ? themedPage(route, data, hosts) : originalPage(route, data, hosts);
}

export { blogAddress };
