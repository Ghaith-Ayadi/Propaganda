// The live themed blog: the site's published design (or, in the Design panel's
// preview frame, its draft) applied to its posts, collections and settings.
// BlogApp renders this instead of the original blog once a site has published
// a design (blog/theme/design.ts).

import { useEffect, useMemo, useState } from "react";
import "./pg.css";
import { PgSite, postOf } from "./Site";
import { buildVM, firstParagraph, type PgInput, type PgLinks, type PgRoute } from "./vm";
import { resolveDesign } from "./schema";
import { asCustomThemes, asDesign, compiledOf, DESIGN_KEY, DRAFT_KEY, themeCss, themeOf, THEMES_KEY, type SiteDesign } from "./design";
import type { ThemeSource } from "./compile";
import { fetchPostAt, fetchLegacyPost, type BlogPost } from "@/blog/data";
import { homeHref, navigateTo, routeHref, themedRouteOfHref, type BlogRoute } from "@/blog/route";
import type { BlogSite } from "@/blog/site";
import { installPageTracker } from "@/blog/track";
import { useSetting } from "@/lib/settings";
import { collectionSlugOf, postPath } from "@/lib/slug";
import { appOrigin, siteHost } from "@/lib/siteUrl";
import type { Collection } from "@/types";

const VERBATIM_MANIFESTO =
  "It's called Verbatim because none of it is edited. I don't edit what I write. If I don't like what I said, I don't publish. No AI writing, no nonsense.";

/** ?pg-preview=draft: the Design panel's preview frame. */
export function isDraftPreview(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pg-preview") === "draft";
}

/**
 * The design this page shows: the draft in the preview frame, else the
 * published one (null: none published). In the preview frame, also the custom
 * theme the panel is editing, when it sent one.
 */
export function useActiveDesign(): { design: SiteDesign | null; previewTheme: ThemeSource | null } {
  const published = asDesign(useSetting<unknown>(DESIGN_KEY, null));
  const draft = asDesign(useSetting<unknown>(DRAFT_KEY, null));
  const [pushed, setPushed] = useState<{ design: SiteDesign; theme?: ThemeSource } | null>(null);
  const preview = isDraftPreview();
  // The Design panel posts every change to its preview frame, so the preview
  // follows before the draft has saved. Only from the editor's own origins.
  useEffect(() => {
    if (!preview) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== appOrigin() && e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; design?: unknown; theme?: ThemeSource } | null;
      if (data?.type !== "pg-preview") return;
      const d = asDesign(data.design);
      if (d) setPushed({ design: d, theme: data.theme });
    };
    window.addEventListener("message", onMessage);
    window.parent?.postMessage({ type: "pg-preview-ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [preview]);
  if (preview) return { design: pushed?.design ?? draft ?? published, previewTheme: pushed?.theme ?? null };
  return { design: published, previewTheme: null };
}

interface Props {
  site: BlogSite;
  design: SiteDesign;
  route: BlogRoute;
  collections: Collection[];
  posts: BlogPost[];
  previewTheme?: ThemeSource | null;
}

const links: PgLinks = {
  home: () => homeHref(),
  collection: (slug) => routeHref({ view: "collection", collection: slug }),
  post: (collection, slug) => routeHref({ view: "post", collection, slug }),
  author: () => routeHref({ view: "author" }),
};

function pgRouteOf(r: BlogRoute): PgRoute {
  if (r.view === "post") return { tpl: "post", collection: r.collection, post: r.slug };
  if (r.view === "collection") return { tpl: "collection", collection: r.collection };
  if (r.view === "author") return { tpl: "author" };
  return { tpl: "home" };
}

export function Themed({ site, design, route, collections, posts, previewTheme }: Props) {
  const customThemes = asCustomThemes(useSetting<unknown>(THEMES_KEY, null));
  const title = useSetting<string>("site.title", site.name) || site.name;
  const tagline = useSetting<string>("site.tagline", "") ?? "";
  const authorTagline = useSetting<string>("author.tagline", "") ?? "";
  const manifesto = useSetting<string>("site.manifesto", site.slug === "verbatim" ? VERBATIM_MANIFESTO : "") ?? "";
  const author = {
    name: useSetting<string>("author.name", "") ?? "",
    tagline: authorTagline,
    location: useSetting<string>("author.location", "") ?? "",
    bio: useSetting<string>("author.bio", "") ?? "",
    avatar: useSetting<string | null>("author.avatar", null) ?? null,
    links: useSetting<{ label: string; url: string }[]>("author.links", []) ?? [],
  };

  const theme = (previewTheme && previewTheme.id === design.theme ? previewTheme : null) ?? themeOf(design.theme, customThemes);
  const compiled = compiledOf(theme);
  const resolved = useMemo(() => resolveDesign(theme, design.overrides).design, [theme, design.overrides]);

  const input: PgInput = useMemo(
    () => ({
      site: { name: title, host: siteHost(site), lang: "en", tagline: tagline || authorTagline, manifesto },
      author,
      collections: collections.map((c) => ({ name: c.name, slug: c.slug || collectionSlugOf(c.name, collections), description: c.description, emoji: c.emoji, hidden: c.isHidden })),
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, tagline, authorTagline, manifesto, JSON.stringify(author), collections, posts, site],
  );
  const vm = useMemo(() => buildVM(input, compiled, links, theme.layout?.headerAlign), [input, compiled, theme]);
  const pgRoute = pgRouteOf(route);
  const post = postOf(vm, pgRoute);

  // A post address the loaded posts don't have: an old address that moved, a
  // post in a private collection, or nothing at all.
  const [lookup, setLookup] = useState<{ key: string; state: "loading" | "hidden" | "missing" } | null>(null);
  const lookupKey = route.view === "post" ? `${route.collection}/${route.slug}` : route.view === "legacy" ? `p/${route.slug}` : "";
  useEffect(() => {
    if (!lookupKey || (route.view === "post" && post)) return;
    let cancelled = false;
    setLookup({ key: lookupKey, state: "loading" });
    void (async () => {
      const r = route.view === "legacy" ? await fetchLegacyPost(site.id, route.slug) : route.view === "post" ? await fetchPostAt(site.id, route.collection, route.slug) : null;
      if (cancelled || !r) return;
      if (r.kind === "moved") navigateTo({ view: "post", collection: r.collection, slug: r.slug }, { replace: true });
      else setLookup({ key: lookupKey, state: r.kind === "hidden" ? "hidden" : "missing" });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupKey, !!post, site.id]);

  // The theme's stylesheet.
  useEffect(() => {
    let el = document.getElementById("pg-theme") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "pg-theme";
      document.head.appendChild(el);
    }
    el.textContent = themeCss(compiled);
    const html = document.documentElement;
    const before = html.style.background;
    html.style.background = compiled.palette.paper;
    return () => {
      html.style.background = before;
    };
  }, [compiled]);

  // Tab title.
  useEffect(() => {
    if (pgRoute.tpl === "post" && post) document.title = `${post.title} — ${title}`;
    else if (pgRoute.tpl === "collection") {
      const c = vm.collections.find((x) => x.slug === pgRoute.collection);
      document.title = c ? `${c.name} — ${title}` : title;
    } else if (pgRoute.tpl === "author") document.title = `${vm.author.displayName} — ${title}`;
    else document.title = title;
  });

  // Page-view beacon, one reading session per post.
  useEffect(() => {
    if (!post) return;
    return installPageTracker({ postId: post.slug, collection: post.col.name, path: postPath(post.col.slug, post.slug) });
  }, [post?.id, post?.slug, post?.col.slug]);

  // Links inside the site navigate without a page load.
  const onClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (!href) return;
    const r = themedRouteOfHref(href);
    if (!r) return;
    e.preventDefault();
    navigateTo(r);
  };

  let page: { title: string; text: string; home?: boolean } | null = null;
  if ((route.view === "post" && !post) || route.view === "legacy") {
    const state = lookup?.key === lookupKey ? lookup.state : "loading";
    page =
      state === "hidden"
        ? { title: "Private collection", text: "This post belongs to a collection that isn’t publicly available.", home: true }
        : state === "missing"
          ? { title: "Not found", text: "That post isn’t published, or the address is off.", home: true }
          : { title: "Loading…", text: "" };
  }

  return (
    <div onClick={onClick}>
      <PgSite vm={vm} design={resolved} attrs={compiled.attrs} route={route.view === "legacy" ? { tpl: "post", post: route.slug } : pgRoute} page={page} />
    </div>
  );
}
