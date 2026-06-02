import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useHotkeys } from "react-hotkeys-hook";
import { AuthGate } from "@/components/AuthGate";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { AttributePanel } from "@/components/AttributePanel";
import { CommandPalette } from "@/components/CommandPalette";
import { CollectionTabs } from "@/components/CollectionTabs";
import { AnalyticsPage } from "@/components/analytics/AnalyticsPage";
import { HelpFab } from "@/components/HelpFab";
import { db } from "@/lib/db";
import { useRoute } from "@/lib/route";
import { useLayout } from "@/lib/layout";
import { useActiveCollection } from "@/lib/activeCollection";
import { installLifecycleHandlers, setSyncUser, runSync, flushSync } from "@/lib/sync";
import { startRealtime, stopRealtime } from "@/lib/realtime";
import { installSearchIndex } from "@/lib/search";
import { snapshotVersion } from "@/lib/versions";
import { toggleTheme } from "@/lib/theme";

export function EditorApp() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  const [route] = useRoute();
  const [layout, , toggleAuthorMode] = useLayout();

  // Auth bypassed for now — sync runs unconditionally.
  useEffect(() => {
    installLifecycleHandlers();
    installSearchIndex();
    setSyncUser(1);
    void runSync();
    startRealtime();
    // Anyone who has visited /admin once is considered "admin" for the
    // purpose of showing the back-to-admin strip on the public site.
    try { localStorage.setItem("verbatim:admin-known", "1"); } catch {}
    // Load app_settings (author bio, favicon, …) into the in-memory cache.
    void import("@/lib/settings").then((m) => m.installSettings());
    return () => {
      void flushSync();
      stopRealtime();
      setSyncUser(null);
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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {layout.sidebar && <Sidebar currentId={route.view === "post" ? route.id : null} />}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {route.view === "list" && <CollectionTabs />}
        {route.view === "analytics" && <AnalyticsPage />}
        {route.view === "post" && !currentPost && (
          <div className="flex h-full items-center justify-center text-tertiary">
            Post not found.
          </div>
        )}
        {route.view === "post" && currentPost && <Editor post={currentPost} />}
      </main>
      {layout.attributes && route.view === "post" && currentPost && (
        <AttributePanel post={currentPost} />
      )}
      <CommandPalette currentPostId={currentPost?.id ?? null} />
      <HelpFab />
    </div>
  );
}
