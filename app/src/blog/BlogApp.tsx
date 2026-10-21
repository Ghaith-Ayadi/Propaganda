import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import "./styles.css";
import { useBlogData } from "./data";
import { useBlogRoute } from "./route";
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
      setSite(s);
    })();
  }, []);

  if (site === undefined) return <Loading />;
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
        <AdminStrip />
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
        <AdminStrip />
        <Themed site={site} design={design} route={route} collections={collections} posts={posts} previewTheme={previewTheme} />
      </>
    );
  }

  // The original blog has no collection or author pages: those addresses show its home.
  return (
    <>
      <TakeOver />
      <AdminStrip />
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
