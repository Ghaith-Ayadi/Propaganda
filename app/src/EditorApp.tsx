import { Suspense, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useHotkeys } from "react-hotkeys-hook";
import { Workspace } from "@/components/Workspace";
import { Toaster } from "@/components/base/toast/toast";
import { NavBar } from "@/components/shell/NavBar";
import { PhoneTabs } from "@/components/shell/PhoneTabs";
import { EmptyPage } from "@/components/shell/EmptyPage";
import { ContentDrawer } from "@/components/pages/ContentDrawer";
import { Editor } from "@/components/Editor";
import { AttributePanel } from "@/components/AttributePanel";
import { CommandPalette } from "@/components/CommandPalette";
import { AnalyticsPage } from "@/components/analytics/AnalyticsPage";
import { AdminPage } from "@/components/admin/AdminPage";
import { BriefPage } from "@/components/plan/BriefPage";
import { db } from "@/lib/db";
import { useRoute } from "@/lib/route";
import { findPlanPage } from "@/components/lite/pages";
import { LockedPage } from "@/components/lite/LockedPage";
import { usePlan } from "@/lib/tenantPlan";
import { useLayout } from "@/lib/layout";
import { useActiveCollection } from "@/lib/activeCollection";
import { installLifecycleHandlers, runSync } from "@/lib/sync";
import { startRealtime, stopRealtime } from "@/lib/realtime";
import { installSearchIndex } from "@/lib/search";
import { snapshotVersion } from "@/lib/versions";
import { toggleTheme } from "@/lib/theme";
import { initTelemetry } from "@/lib/telemetry";
import { setDrawer, useDrawer, useIsMobile, useMobileShell } from "@/lib/mobile";

// Errors and product analytics, editor only (lib/telemetry.ts).
initTelemetry();
import { exposeThemeConsole } from "@/lib/customThemes";

// The app's display face (Rowan) instead of the blogs' (index.css).
document.documentElement.classList.add("ppgd-app");

// The service worker is the editor's offline shell, so only the editor
// registers it: blog readers never download the whole app. The same call
// vite-plugin-pwa used to inject into every page (injectRegister: false).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}

// Custom blog themes are installed from the console for now (lib/customThemes.ts).
exposeThemeConsole();

export function EditorApp() {
  return (
    <>
      <Workspace>
        <Shell />
      </Workspace>
      {/* Outside Workspace so a toast outlives a site switch or sign-in screen. */}
      <Toaster />
    </>
  );
}

function Shell() {
  const [route] = useRoute();
  const [layout, , toggleAuthorMode] = useLayout();
  const isMobile = useIsMobile();
  const drawer = useDrawer();
  useMobileShell();

  // Workspace renders this once per scope (account + site), keyed by it, so
  // this effect runs again on every switch, against the new site.
  useEffect(() => {
    installLifecycleHandlers();
    installSearchIndex();
    void runSync();
    void startRealtime();
    // Anyone who has visited /admin once is considered "admin" for the
    // purpose of showing the back-to-admin strip on the public site.
    try { localStorage.setItem("verbatim:admin-known", "1"); } catch {}
    // Load app_settings (author bio, favicon, …) into the in-memory cache,
    // then start the Verbose recorder if enabled.
    void import("@/lib/settings")
      .then((m) => m.installSettings())
      .then(() =>
        // VERBOSE MODULE (optional, personal).
        import("@/features/verbose").then((v) => {
          if (v.isVerboseEnabled()) v.installVerbose();
        }),
      );
    // Leaving: Workspace drains writes and pushes this site in the background.
    return () => {
      void stopRealtime();
    };
  }, []);

  useHotkeys(
    "mod+\\",
    (e) => {
      e.preventDefault();
      toggleAuthorMode();
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );
  useHotkeys(
    "mod+shift+l",
    (e) => {
      e.preventDefault();
      toggleTheme();
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  const currentPost = useLiveQuery(
    () => (route.view === "post" ? db.posts.get(route.id) : undefined),
    [route.view === "post" ? route.id : null],
  );

  // While editing a post, highlight the tab that matches its collection.
  const [, setActiveCollection] = useActiveCollection();
  useEffect(() => {
    if (route.view === "post" && currentPost?.type) {
      setActiveCollection(currentPost.type);
    }
  }, [route.view === "post", currentPost?.type, setActiveCollection]);

  useHotkeys(
    "mod+shift+s",
    async (e) => {
      e.preventDefault();
      if (currentPost) await snapshotVersion(currentPost, "user", "Manual snapshot");
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
    [currentPost?.id, currentPost?.content],
  );

  const sidebar = <NavBar currentCollection={route.view === "post" ? currentPost?.type : undefined} />;
  const attributes = route.view === "post" && currentPost ? <AttributePanel post={currentPost} /> : null;

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {isMobile ? (
        <>
          <MobileDrawer side="left" open={drawer === "nav"}>{sidebar}</MobileDrawer>
          {attributes && (
            <MobileDrawer side="right" open={drawer === "attributes"}>{attributes}</MobileDrawer>
          )}
        </>
      ) : (
        layout.sidebar && (
          <>
            {sidebar}
            {/* Writing a post: the blog's drawer stays beside it, as in 0.1. */}
            {route.view === "post" && currentPost && (
              <ContentDrawer channel="blog" activeCollection={currentPost.type || null} currentPostId={currentPost.id} />
            )}
          </>
        )
      )}
      {route.view === "brief" ? (
        <BriefPage key={route.id} id={route.id} />
      ) : (
        <>
          <main className="flex min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
            {/* The editor has its own nav bar with the menu button. */}
            {isMobile && route.view !== "post" && <PhoneTabs />}
            {route.view === "page" && <PageOutlet id={route.page} />}
            {route.view === "list" && <PageOutlet id="content" />}
            {route.view === "plan" && <PageOutlet id="pipeline" />}
            {route.view === "analytics" && <AnalyticsPage />}
            {route.view === "admin" && <AdminPage section={route.section} />}
            {route.view === "post" && !currentPost && (
              <div className="flex h-full items-center justify-center text-tertiary">
                Post not found.
              </div>
            )}
            {route.view === "post" && currentPost && <Editor post={currentPost} />}
          </main>
          {!isMobile && layout.attributes && attributes}
        </>
      )}
      <CommandPalette currentPostId={currentPost?.id ?? null} />
    </div>
  );
}

/** A phone's stand-in for a side column: slides over the page, tap outside to close. */
function MobileDrawer({ side, open, children }: { side: "left" | "right"; open: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 animate-in fade-in" onClick={() => setDrawer(null)} />
      <div
        className={[
          "absolute inset-y-0 flex max-w-[88vw] shadow-2xl duration-200 animate-in",
          side === "left" ? "left-0 slide-in-from-left" : "right-0 slide-in-from-right",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

/** A registered page (lib/routes.ts), or its empty state until it is built. */
function PageOutlet({ id }: { id: string }) {
  const found = findPlanPage(usePlan(), id);
  if (!found) {
    return <div className="flex h-full items-center justify-center text-tertiary">Page not found.</div>;
  }
  const { page, locked } = found;
  if (locked) return <LockedPage page={page} />;
  const Page = page.component;
  if (!Page) return <EmptyPage page={page} />;
  return (
    <Suspense fallback={null}>
      <Page key={page.id} />
    </Suspense>
  );
}
