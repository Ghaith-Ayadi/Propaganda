import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import "./styles.css";
import { useBlogData } from "./data";
import { setBasePath, useBlogRoute } from "./route";
import { isPostPreview, previewBase } from "./preview";
import { Home } from "./components/Home";
import { Reader } from "./components/Reader";
import { AdminStrip } from "./components/AdminStrip";
import { SiteNotFound } from "./components/SiteNotFound";
import { customDomainTarget, legacyAddressTarget, resolveBlogSite, type BlogSite } from "./site";
import { bindPublicSettings, getSetting, installSettings, useSetting, useSettingsVersion } from "@/lib/settings";
import { originalSettingsOf } from "./original";
import { publicSb } from "@/lib/supabase";
import { Themed, useActiveDesign } from "./theme/Themed";

/** Settings decide which renderer a site gets, so the page waits for them. */
function useSettingsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void installSettings().finally(() => setReady(true));
  }, []);
  return ready;
}

// The page the rendering function sent (api/blog.ts, blog/server/): the same
// markup this app is about to render, kept on screen until the data is here.
const SERVER_MARKUP = "pg-ssr";
const serverMarkup = () => (typeof document === "undefined" ? null : document.getElementById(SERVER_MARKUP));

/** Mounted with the first real render: takes the server's page down in the same frame. */
function TakeOver() {
  useLayoutEffect(() => {
    serverMarkup()?.remove();
  }, []);
  return null;
}

function Loading() {
  // Nothing to say while the server's page is still showing.
  if (serverMarkup()) return null;
  return (
    <div
      className="blog-app"
      style={{
        display: "grid",
        placeItems: "center",
        height: "100vh",
        color: "var(--mute)",
        fontSize: 12,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      Loading…
    </div>
  );
}

// A members' preview (blog/preview.ts): kept out of search, and marked as a preview.
if (isPostPreview() && typeof document !== "undefined") {
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow";
  document.head.appendChild(robots);
}

/** The corner pill: "Preview" with a way back to the editor on a preview, else the admin shortcut. */
function Strip() {
  if (!isPostPreview()) return <AdminStrip />;
  return (
    <a href="/admin" className="blog-admin-fab" aria-label="Preview, not published. Back to the editor">
      Preview · not published
    </a>
  );
}

function PreviewSignIn() {
  return (
    <div className="blog-app">
      <article className="blog-article">
        <h1>Sign in to see this preview.</h1>
        <p className="dek">
          Posts that aren't published yet are only shown to the site's members. <a href="/admin">Sign in to Propaganda</a>, then open the
          preview again.
        </p>
      </article>
    </div>
  );
}

export function BlogApp() {
  // undefined = resolving, null = no site matched this host/path.
  const [site, setSite] = useState<BlogSite | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      // An old "/@slug/…" address: the blog lives on its own host now.
      const target = await legacyAddressTarget();
      if (target) {
        window.location.replace(target);
        return;
      }
      const s = await resolveBlogSite();
      const elsewhere = s && customDomainTarget(s);
      if (elsewhere) {
        window.location.replace(elsewhere);
        return;
      }
      // Must happen before anything reads settings or navigates.
      if (s) bindPublicSettings(publicSb, s.id);
      if (isPostPreview()) setBasePath(previewBase());
      setSite(s);
    })();
  }, []);

  if (site === undefined) return <Loading />;
  if (site === null && isPostPreview()) return <PreviewSignIn />;
  if (site === null)
    return (
      <>
        <TakeOver />
        <SiteNotFound />
      </>
    );
  return <BlogAppInner site={site} />;
}

function BlogAppInner({ site }: { site: BlogSite }) {
  const [route] = useBlogRoute();
  const { loading, collections, posts, error } = useBlogData(site.id);
  // A published design switches the site to the themed templates.
  const { design, previewTheme } = useActiveDesign();
  const settingsReady = useSettingsReady();
  const faviconUrl = useSetting<string | null>("favicon.url", null);
  const siteTitle = useSetting<string>("site.title", site.name);
  const version = useSettingsVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const original = useMemo(() => originalSettingsOf(getSetting, site), [version, site]);

  useEffect(() => {
    void installSettings();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [faviconUrl]);

  useEffect(() => {
    if (typeof document === "undefined" || design) return;
    if (siteTitle && route.view === "home") document.title = siteTitle;
  }, [siteTitle, route.view, design]);

  if (error) {
    return (
      <div className="blog-app">
        <TakeOver />
        <Strip />
        <div className="blog-article">
          <h1>Something broke.</h1>
          <p className="dek">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !settingsReady) return <Loading />;

  if (design) {
    return (
      <>
        <TakeOver />
        <Strip />
        <Themed site={site} design={design} route={route} collections={collections} posts={posts} previewTheme={previewTheme} />
      </>
    );
  }

  // The original blog has no collection or author pages: those addresses show its home.
  return (
    <>
      <TakeOver />
      <Strip />
      {route.view === "post" || route.view === "legacy" ? (
        <Reader route={route} site={site} settings={original} />
      ) : (
        <Home
          collections={collections}
          posts={posts}
          site={site}
          settings={original}
          initialTab={route.view === "collection" ? collections.find((c) => (c.slug || "") === route.collection)?.name ?? null : null}
        />
      )}
    </>
  );
}
