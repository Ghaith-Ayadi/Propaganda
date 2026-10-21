// The original blog's post page, pure of fetching: the post, its site and the
// author settings in, the article out. Rendered by Reader (the browser) and
// by the rendering function (blog/server/) alike.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { blogAddress, type BlogPost } from "@/blog/model";
import { legacyPostHref, navigateTo, postHref, routeHref, routeOfHref } from "@/blog/route";
import { postPublicUrl, readableUrl } from "@/lib/siteUrl";
import type { Collection } from "@/types";
import type { BlogSite } from "@/blog/siteTypes";
import type { OriginalSettings } from "@/blog/original";
import { Topbar } from "./Topbar";
import { Colophon } from "./Colophon";
import { readTime } from "@/lib/format";
import { isImageUrl } from "@/lib/images";

interface Props {
  post: BlogPost;
  collections: Collection[];
  /** The site's published posts: peers for previous/next, targets for wikilinks. */
  posts: BlogPost[];
  site: BlogSite;
  author: OriginalSettings["author"];
  /** Back to the post's collection on the home page. */
  onBack: () => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Replace `[[slug]]` wikilinks with regular markdown links so they render as
 * real anchors. Resolves against the set of known posts for nicer label text.
 */
function resolveWikilinks(md: string, postsBySlug: Map<string, BlogPost>, cols: Collection[]): string {
  return md.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_, raw: string) => {
    const slug = raw.trim();
    const target = postsBySlug.get(slug);
    const label = target?.title || slug;
    const href = target ? postHref(blogAddress(target, cols).collection, target.slug) : legacyPostHref(slug);
    return `[${label}](${href})`;
  });
}

/** First paragraph of body content as a dek fallback. */
function firstParagraph(md: string, maxLen = 220): string {
  if (!md) return "";
  for (const block of md.split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    if (/^([#`>]|-{1,2}\s|\*\s|\d+\.\s|```)/.test(t)) continue;
    // Skip a block that's just a standalone image or link (e.g. an uploaded
    // image saved as `![name](url)` or the legacy `[name](url)`), so the dek
    // never falls back to a raw URL.
    if (/^!?\[[^\]]*\]\([^)]*\)$/.test(t)) continue;
    const flat = t
      .replace(/\s+/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → their text
      .replace(/[*_`]/g, "")
      .trim();
    if (flat.length <= maxLen) return flat;
    return flat.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  }
  return "";
}


export function ReaderArticle({ post, collections, posts, site, author, onBack }: Props) {
  const { name: authorName, tagline: authorTagline, location: authorLocation } = author;
  const peers = posts.filter((p) => p.type === post.type).sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  const idx = peers.findIndex((p) => p.id === post.id);
  const prev = idx >= 0 && idx < peers.length - 1 ? peers[idx + 1] : null; // older
  const next = idx > 0 ? peers[idx - 1] : null; // newer
  const collection = collections.find((c) => c.name === post.type);
  const colDisplay = collection ? collection.name : post.type;
  const backToCollection = onBack;

  const rtMin = readTime(post.wordCount);
  const dek = post.subtitle?.trim() || post.excerpt?.trim() || firstParagraph(post.content);
  const permalink = postPublicUrl(site, blogAddress(post, collections).collection, post.slug);
  const prettyPermalink = readableUrl(permalink);
  const postsBySlug = new Map(posts.map((p) => [p.slug, p]));
  const resolvedContent = resolveWikilinks(post.content, postsBySlug, collections);

  return (
    <div className="blog-app">
      <Topbar
        site={site}
        backLabel={colDisplay || "Index"}
        onBack={backToCollection}
        right={
          <a
            className="blog-topbar__share"
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}%20${encodeURIComponent(permalink)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Share
          </a>
        }
        showProgress
      />

      <article className="blog-article">
        <div className="a-eyebrow">
          <button
            type="button"
            onClick={backToCollection}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              cursor: "pointer",
              font: "inherit",
              color: "inherit",
              textTransform: "inherit",
              letterSpacing: "inherit",
            }}
          >
            {colDisplay}
          </button>
        </div>

        <h1>{post.title || "Untitled"}</h1>

        {dek && <p className="dek">{dek}</p>}

        <div className="blog-byline">
          <div className="avatar">
            {(authorName ?? "A").trim().charAt(0).toUpperCase() || "A"}
          </div>
          <div className="by-line-1">
            <span className="by-name">{authorName || "Author"}</span>
            {(authorTagline || authorLocation) && (
              <>
                <span className="by-sep">·</span>
                <span>{authorTagline || `Writing from ${authorLocation}`}</span>
              </>
            )}
          </div>
          <div className="by-line-2">
            <span>{fmtDate(post.publishedAt)}</span>
            {rtMin > 0 && (
              <>
                <span className="by-sep">·</span>
                <span>{rtMin} min read</span>
              </>
            )}
          </div>
        </div>

        <div className="blog-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // An image without alt text gets the post's title: never an empty alt.
              img: ({ src, alt }) => <img src={String(src ?? "")} alt={alt || post.title || ""} loading="lazy" />,
              a: ({ href, children, ...rest }) => {
                if (!href) return <a {...rest}>{children}</a>;
                // Legacy content stored uploaded images as `[name](url)` links.
                // Render any standalone image-URL link as the actual image.
                if (isImageUrl(href)) {
                  const alt = typeof children === "string" ? children : "";
                  return <img src={href} alt={alt || post.title || ""} loading="lazy" />;
                }
                const external =
                  /^https?:\/\//i.test(href) && typeof window !== "undefined" && !href.includes(window.location.host);
                // A post of this site: its address, an old /p/ link (in older
                // posts and wikilinks), site-relative or a full URL on this host.
                const internal = routeOfHref(href);
                if (internal) {
                  return (
                    <a
                      href={routeHref(internal)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        navigateTo(internal);
                      }}
                      {...rest}
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a
                    href={href}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer noopener" : undefined}
                    {...rest}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {resolvedContent}
          </ReactMarkdown>
        </div>
      </article>

      <div className="blog-a-foot">
        <div className="row">
          <span className="label">Filed under</span>
          <span className="value">{colDisplay}</span>
        </div>
        {post.wordCount != null && (
          <div className="row">
            <span className="label">Words</span>
            <span className="value">{post.wordCount.toLocaleString()}</span>
          </div>
        )}
        {post.publishedAt && (
          <div className="row">
            <span className="label">Published</span>
            <span className="value">{fmtDate(post.publishedAt)}</span>
          </div>
        )}
        <div className="row">
          <span className="label">Permalink</span>
          <span className="value">{prettyPermalink}</span>
        </div>
      </div>

      {(prev || next) && (
        <div className="blog-nextprev">
          {prev ? (
            <button
              type="button"
              className="blog-np prev"
              onClick={() => navigateTo({ view: "post", ...blogAddress(prev, collections) })}
            >
              <div className="npl">← Previous</div>
              <div className="npt">{prev.title || "Untitled"}</div>
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button
              type="button"
              className="blog-np next"
              onClick={() => navigateTo({ view: "post", ...blogAddress(next, collections) })}
            >
              <div className="npl">Next →</div>
              <div className="npt">{next.title || "Untitled"}</div>
            </button>
          ) : (
            <span />
          )}
        </div>
      )}

      <Colophon site={site} />
    </div>
  );
}
