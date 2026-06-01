import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchPostBySlug, useBlogData, type BlogPost } from "@/blog/data";
import { navigateTo, postHref, useBlogRoute } from "@/blog/route";
import { setActiveTab } from "@/blog/activeTab";
import { Topbar } from "./Topbar";
import { Colophon } from "./Colophon";
import { readTime } from "@/lib/format";
import { useSetting } from "@/lib/settings";

interface Props {
  slug: string;
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
function resolveWikilinks(md: string, postsBySlug: Map<string, BlogPost>): string {
  return md.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_, raw: string) => {
    const slug = raw.trim();
    const target = postsBySlug.get(slug);
    const label = target?.title || slug;
    return `[${label}](${postHref(slug)})`;
  });
}

/** First paragraph of body content as a dek fallback. */
function firstParagraph(md: string, maxLen = 220): string {
  if (!md) return "";
  for (const block of md.split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    if (/^([#`>]|-{1,2}\s|\*\s|\d+\.\s|```)/.test(t)) continue;
    const flat = t.replace(/\s+/g, " ").replace(/[*_`]/g, "").trim();
    if (flat.length <= maxLen) return flat;
    return flat.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  }
  return "";
}


export function Reader({ slug }: Props) {
  const [, _navigate] = useBlogRoute(); // subscribe so re-renders propagate
  void _navigate;
  const { collections, posts } = useBlogData();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const authorName = useSetting<string>("author.name", "Ghaith Ayadi");
  const authorTagline = useSetting<string>("author.tagline", "");
  const authorLocation = useSetting<string>("author.location", "");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPost(null);
    setHidden(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    void (async () => {
      const result = await fetchPostBySlug(slug);
      if (cancelled) return;
      if (result.kind === "post") setPost(result.post);
      else if (result.kind === "hidden") setHidden(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Tab title (SEO + nicety).
  useEffect(() => {
    if (post?.title) document.title = `${post.title} — Verbatim`;
  }, [post?.title]);

  const peers = useMemo(() => {
    if (!post) return [] as BlogPost[];
    return posts
      .filter((p) => p.type === post.type)
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  }, [post, posts]);
  const idx = post ? peers.findIndex((p) => p.id === post.id) : -1;
  const prev = idx >= 0 && idx < peers.length - 1 ? peers[idx + 1] : null; // older
  const next = idx > 0 ? peers[idx - 1] : null; // newer

  const collection = post ? collections.find((c) => c.name === post.type) : null;
  const colDisplay = collection ? collection.name : post?.type ?? "";

  function backToCollection() {
    if (post?.type) setActiveTab(post.type);
    navigateTo({ view: "home" });
  }

  if (loading) {
    return (
      <div className="blog-app">
        <Topbar backLabel="Index" onBack={() => navigateTo({ view: "home" })} />
        <div
          style={{
            padding: "120px 0",
            textAlign: "center",
            color: "var(--mute)",
            fontSize: 12,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Loading…
        </div>
      </div>
    );
  }

  if (hidden) {
    return (
      <div className="blog-app">
        <Topbar backLabel="Index" onBack={() => navigateTo({ view: "home" })} />
        <article className="blog-article">
          <h1>Private collection.</h1>
          <p className="dek">
            This post belongs to a collection that isn't publicly available.
          </p>
        </article>
        <Colophon />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="blog-app">
        <Topbar backLabel="Index" onBack={() => navigateTo({ view: "home" })} />
        <article className="blog-article">
          <h1>Not found.</h1>
          <p className="dek">That post isn't published, or the URL is off.</p>
        </article>
        <Colophon />
      </div>
    );
  }

  const rtMin = readTime(post.wordCount);
  const dek = post.excerpt?.trim() || firstParagraph(post.content);
  const prettyPermalink = `verbatim/${colDisplay.toLowerCase().replace(/\s+/g, "-")}/${post.slug}`;
  const postsBySlug = new Map(posts.map((p) => [p.slug, p]));
  const resolvedContent = resolveWikilinks(post.content, postsBySlug);

  return (
    <div className="blog-app">
      <Topbar
        backLabel={colDisplay || "Index"}
        onBack={backToCollection}
        right={
          <>
            {rtMin > 0 && <span>{rtMin} min read</span>}
            <span>{fmtDate(post.publishedAt)}</span>
          </>
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
          <div className="by-right">
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}%20${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Share
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
            >
              Email
            </a>
          </div>
        </div>

        <div className="blog-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children, ...rest }) => {
                if (!href) return <a {...rest}>{children}</a>;
                const external =
                  /^https?:\/\//i.test(href) && !href.includes(window.location.host);
                const internalPost = href.startsWith("/p/");
                if (internalPost) {
                  return (
                    <a
                      href={href}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        const slug = decodeURIComponent(href.replace(/^\/p\//, ""));
                        navigateTo({ view: "post", slug });
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
              onClick={() => navigateTo({ view: "post", slug: prev.slug })}
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
              onClick={() => navigateTo({ view: "post", slug: next.slug })}
            >
              <div className="npl">Next →</div>
              <div className="npt">{next.title || "Untitled"}</div>
            </button>
          ) : (
            <span />
          )}
        </div>
      )}

      <Colophon />
    </div>
  );
}
