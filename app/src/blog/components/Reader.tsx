// The original blog's post page in the browser: fetches the post the address
// names (or forwards an old address), then renders ReaderArticle, which the
// rendering function (blog/server/) renders too, from the same data.

import { useEffect, useState } from "react";
import { blogAddress, fetchLegacyPost, fetchPostAt, useBlogData, type BlogPost } from "@/blog/data";
import { navigateTo, useBlogRoute, type BlogRoute } from "@/blog/route";
import { postPath } from "@/lib/slug";
import { setActiveTab } from "@/blog/activeTab";
import { installPageTracker } from "@/blog/track";
import type { BlogSite } from "@/blog/siteTypes";
import type { OriginalSettings } from "@/blog/original";
import { Topbar } from "./Topbar";
import { Colophon } from "./Colophon";
import { ReaderArticle } from "./ReaderArticle";

interface Props {
  /** A post's address, or a pre-collections /p/<slug> link to forward. */
  route: Extract<BlogRoute, { view: "post" } | { view: "legacy" }>;
  site: BlogSite;
  settings: OriginalSettings;
}

export function Reader({ route, site, settings }: Props) {
  const [, _navigate] = useBlogRoute(); // subscribe so re-renders propagate
  void _navigate;
  const { collections, posts } = useBlogData(site.id);
  const [post, setPost] = useState<BlogPost | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPost(null);
    setHidden(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    void (async () => {
      const result =
        route.view === "legacy"
          ? await fetchLegacyPost(site.id, route.slug)
          : await fetchPostAt(site.id, route.collection, route.slug);
      if (cancelled) return;
      if (result.kind === "moved") {
        // An old address: show the current one in the URL bar, then load it.
        navigateTo({ view: "post", collection: result.collection, slug: result.slug }, { replace: true });
        return;
      }
      if (result.kind === "post") setPost(result.post);
      else if (result.kind === "hidden") setHidden(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [route.view, route.view === "post" ? route.collection : "", route.slug, site.id]);

  // Tab title (SEO + nicety).
  useEffect(() => {
    if (post?.title) document.title = `${post.title} — ${site.name}`;
  }, [post?.title, site.name]);

  // Page-view beacon: one reading session per loaded post. Teardown flushes
  // on SPA navigation to the next post; pagehide/tab-hide flush on real exit.
  useEffect(() => {
    if (!post) return;
    return installPageTracker({
      postId: post.slug,
      collection: post.type,
      path: postPath(blogAddress(post, collections).collection, post.slug),
    });
  }, [post?.id, post?.slug, post?.type, collections]);

  function backToCollection() {
    if (post?.type) setActiveTab(post.type);
    navigateTo({ view: "home" });
  }

  if (loading) {
    return (
      <div className="blog-app">
        <Topbar site={site} backLabel="Index" onBack={() => navigateTo({ view: "home" })} />
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
        <Topbar site={site} backLabel="Index" onBack={() => navigateTo({ view: "home" })} />
        <article className="blog-article">
          <h1>Private collection.</h1>
          <p className="dek">
            This post belongs to a collection that isn't publicly available.
          </p>
        </article>
        <Colophon site={site} />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="blog-app">
        <Topbar site={site} backLabel="Index" onBack={() => navigateTo({ view: "home" })} />
        <article className="blog-article">
          <h1>Not found.</h1>
          <p className="dek">That post isn't published, or the URL is off.</p>
        </article>
        <Colophon site={site} />
      </div>
    );
  }

  return <ReaderArticle post={post} collections={collections} posts={posts} site={site} author={settings.author} onBack={backToCollection} />;
}
