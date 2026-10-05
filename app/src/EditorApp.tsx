import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useHotkeys } from "react-hotkeys-hook";
import { Workspace } from "@/components/Workspace";
import { Toaster } from "@/components/base/toast/toast";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { AttributePanel } from "@/components/AttributePanel";
import { CommandPalette, openCommandPalette } from "@/components/CommandPalette";
import { CollectionTabs } from "@/components/CollectionTabs";
import { HomePage } from "@/components/HomePage";
import { AnalyticsPage } from "@/components/analytics/AnalyticsPage";
import { PlanPage } from "@/components/plan/PlanPage";
import { BriefPage } from "@/components/plan/BriefPage";
import { db } from "@/lib/db";
import { useRoute } from "@/lib/route";
import { useLayout } from "@/lib/layout";
import { useActiveCollection } from "@/lib/activeCollection";
import { installLifecycleHandlers, runSync } from "@/lib/sync";
import { startRealtime, stopRealtime } from "@/lib/realtime";
import { installSearchIndex } from "@/lib/search";
import { snapshotVersion } from "@/lib/versions";
import { toggleTheme } from "@/lib/theme";
import { initTelemetry } from "@/lib/telemetry";
import { setDrawer, toggleDrawer, useDrawer, useIsMobile, useMobileShell } from "@/lib/mobile";
import { Menu01, Plus } from "@untitledui/icons";

// Errors and product analytics, editor only (lib/telemetry.ts).
initTelemetry();

// The service worker is the editor's offline shell, so only the editor
// registers it: blog readers never download the whole app. The same call
// vite-plugin-pwa used to inject into every page (injectRegister: false).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
}

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

  const sidebar = <Sidebar currentId={route.view === "post" ? route.id : null} />;
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
        layout.sidebar && sidebar
      )}
      {route.view === "brief" ? (
        <BriefPage key={route.id} id={route.id} />
      ) : (
        <>
          <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {/* The editor has its own nav bar with the menu button. */}
            {isMobile && route.view !== "post" && <MobileTopBar />}
            {route.view === "home" && <HomePage />}
            {route.view === "list" && <CollectionTabs />}
            {route.view === "plan" && <PlanPage />}
            {route.view === "analytics" && <AnalyticsPage />}
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

function MobileTopBar() {
  return (
    <div className="sticky top-0 z-40 flex items-center border-b border-secondary bg-primary/85 px-2 py-2 backdrop-blur">
      <button
        type="button"
        aria-label="Menu"
        onClick={() => toggleDrawer("nav")}
        className="rounded-md p-2 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
      >
        <Menu01 className="size-5" />
      </button>
      <button
        type="button"
        onClick={openCommandPalette}
        className="ml-auto flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-tertiary transition hover:bg-primary_hover hover:text-secondary"
      >
        <Plus className="size-4" />
        New post
      </button>
    </div>
  );
}
