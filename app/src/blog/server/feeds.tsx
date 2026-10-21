// A site's sitemap, RSS feed and robots.txt, from the same data as its pages.

import { renderToString } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BlogPost } from "../model";
import { collectionSlugOf } from "@/lib/slug";
import { dekOf, esc, isThemed, type SiteData } from "./page";
import { absolute, postUrl, siteUrl, type Hosts } from "./urls";

const FEED_ITEMS = 20;

/** The site's public posts (none from a hidden collection), with their addresses. */
function publicPosts(data: SiteData, hosts: Hosts): Array<{ post: BlogPost; url: string }> {
  const hidden = new Set(data.collections.filter((c) => c.isHidden).map((c) => c.name));
  return data.posts
    .filter((p) => !hidden.has(p.type))
    .map((post) => ({ post, url: postUrl(data.site, hosts, collectionSlugOf(post.type, data.collections), post.slug) }));
}

const day = (ms: number | null) => (ms != null && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);

export function sitemap(data: SiteData, hosts: Hosts): string {
  const themed = isThemed(data.settings);
  const urls: Array<{ loc: string; lastmod?: string | null }> = [];
  const posts = publicPosts(data, hosts);
  const latest = posts.map((p) => p.post.updatedAt).reduce((m, t) => Math.max(m, t), 0) || null;
  urls.push({ loc: siteUrl(data.site, hosts), lastmod: day(latest) });
  if (themed) {
    for (const c of data.collections) {
      if (c.isHidden) continue;
      const slug = c.slug || collectionSlugOf(c.name, data.collections);
      const inIt = posts.filter((p) => p.post.type === c.name);
      if (!inIt.length) continue;
      urls.push({ loc: absolute(data.site, hosts, `/${encodeURIComponent(slug)}`), lastmod: day(Math.max(...inIt.map((p) => p.post.updatedAt))) });
    }
    urls.push({ loc: absolute(data.site, hosts, "/author") });
  }
  for (const { post, url } of posts) urls.push({ loc: url, lastmod: day(post.updatedAt) });
  const body = urls
    .map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function postHtml(post: BlogPost): string {
  return renderToString(<ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>);
}

export function rss(data: SiteData, hosts: Hosts): string {
  const { site, settings } = data;
  const title = (settings.get("site.title") as string) || site.name;
  const description = (settings.get("site.tagline") as string) || (settings.get("site.manifesto") as string) || title;
  const author = (settings.get("author.name") as string) || "";
  const home = siteUrl(site, hosts);
  const items = publicPosts(data, hosts)
    .filter((p) => p.post.publishedAt != null)
    .slice(0, FEED_ITEMS)
    .map(({ post, url }) => {
      const parts = [
        `      <title>${esc(post.title || "Untitled")}</title>`,
        `      <link>${esc(url)}</link>`,
        `      <guid isPermaLink="true">${esc(url)}</guid>`,
        `      <pubDate>${new Date(post.publishedAt!).toUTCString()}</pubDate>`,
        `      <category>${esc(post.type)}</category>`,
      ];
      const dek = dekOf(post);
      if (dek) parts.push(`      <description>${esc(dek)}</description>`);
      if (author) parts.push(`      <dc:creator>${esc(author)}</dc:creator>`);
      parts.push(`      <content:encoded><![CDATA[${postHtml(post).replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>`);
      return `    <item>\n${parts.join("\n")}\n    </item>`;
    });
  const latest = data.posts.find((p) => p.publishedAt != null)?.publishedAt;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    `  <channel>`,
    `    <title>${esc(title)}</title>`,
    `    <link>${esc(home)}</link>`,
    `    <description>${esc(description)}</description>`,
    `    <language>en</language>`,
    `    <generator>Propaganda</generator>`,
    `    <atom:link href="${esc(absolute(site, hosts, "/feed.xml"))}" rel="self" type="application/rss+xml"/>`,
    latest != null ? `    <lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>` : "",
    ...items,
    `  </channel>`,
    `</rss>`,
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function robots(data: SiteData, hosts: Hosts): string {
  return ["User-agent: *", "Allow: /", "Disallow: /admin", "", `Sitemap: ${absolute(data.site, hosts, "/sitemap.xml")}`, ""].join("\n");
}
