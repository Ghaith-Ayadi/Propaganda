import { useEffect, useState } from "react";
import "./styles.css";
import { useBlogData } from "./data";
import { useBlogRoute } from "./route";
import { Home } from "./components/Home";
import { Reader } from "./components/Reader";
import { AdminStrip } from "./components/AdminStrip";
import { SiteNotFound } from "./components/SiteNotFound";
import { customDomainTarget, legacyAddressTarget, resolveBlogSite, type BlogSite } from "./site";
import { bindPublicSettings, installSettings, useSetting } from "@/lib/settings";
import { publicSb } from "@/lib/supabase";

function Loading() {
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
  if (site === null) return <SiteNotFound />;
  return <BlogAppInner site={site} />;
}

function BlogAppInner({ site }: { site: BlogSite }) {
  const [route] = useBlogRoute();
  const { loading, collections, posts, error } = useBlogData(site.id);
  const faviconUrl = useSetting<string | null>("favicon.url", null);
  const siteTitle = useSetting<string>("site.title", site.name);

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
    if (typeof document === "undefined") return;
    if (siteTitle && route.view === "home") document.title = siteTitle;
  }, [siteTitle, route.view]);

  if (error) {
    return (
      <div className="blog-app">
        <AdminStrip />
        <div className="blog-article">
          <h1>Something broke.</h1>
          <p className="dek">{error}</p>
        </div>
      </div>
    );
  }

  if (loading) return <Loading />;

  return (
    <>
      <AdminStrip />
      {route.view !== "home" ? (
        <Reader route={route} site={site} />
      ) : (
        <Home collections={collections} posts={posts} site={site} />
      )}
    </>
  );
}
