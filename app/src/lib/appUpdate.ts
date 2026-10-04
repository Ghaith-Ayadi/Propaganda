// Keeps an open editor on the deployed build.
//
// The service worker serves the app shell from its cache, so a tab or an
// installed app that stays open keeps running the build it loaded. A deploy
// installs a new worker, which takes over open pages at once (skipWaiting +
// clientsClaim in vite.config.ts) and fires `controllerchange` here. From then
// on the page is old code under a new worker: a lazy chunk it asks for may no
// longer exist. So the page reloads, at a moment that can't cost writing:
//   - when the tab is hidden (the writer is elsewhere), or
//   - when the writer clicks Reload on the toast, or
//   - when a lazy chunk fails to load (the old build is already broken).
// Before reloading it waits out the editor's save debounce and every tracked
// IndexedDB write (db.waitForWrites). Unsynced rows stay dirty in Dexie and are
// pushed after the reload, as on any page load.
//
// Only the editor registers the worker: blog readers never load it.

import { toast } from "@/components/base/toast/toast";
import { waitForWrites } from "@/lib/db";
import { track } from "@/lib/telemetry";

/** Longer than the editor's save debounce (Editor.tsx SAVE_DEBOUNCE_MS). */
const SAVE_SETTLE_MS = 300;
/** How often an open editor asks for a new worker. */
const CHECK_EVERY_MS = 30 * 60_000;
const MIN_CHECK_GAP_MS = 5 * 60_000;
/** A reload that fails again this soon gives up instead of looping. */
const RELOAD_LOOP_MS = 20_000;
const RELOADED_AT_KEY = "propaganda:update-reloaded-at";

let installed = false;
let updateReady = false;
let reloading = false;

function reloadedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOADED_AT_KEY) ?? 0) < RELOAD_LOOP_MS;
  } catch {
    return false;
  }
}

async function reloadSafely(reason: string): Promise<void> {
  if (reloading) return;
  reloading = true;
  await new Promise((r) => setTimeout(r, SAVE_SETTLE_MS));
  await waitForWrites(150);
  track("app_reloaded_for_update", { reason });
  try {
    sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    // Private mode: the loop guard is off, the reload still happens.
  }
  window.location.reload();
}

function onUpdateReady(): void {
  if (updateReady) return;
  updateReady = true;
  if (document.visibilityState === "hidden") {
    void reloadSafely("hidden");
    return;
  }
  toast.add({
    title: "A new version is ready",
    description: "It loads the next time you leave this tab.",
    timeout: 0,
    actionProps: { children: "Reload now", onClick: () => void reloadSafely("toast") },
  });
}

export function installAppUpdates(): void {
  if (installed || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  installed = true;

  // The first worker to take over a page with none is the install, not an
  // update; every takeover after that is a new build.
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled) onUpdateReady();
    controlled = true;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && updateReady) void reloadSafely("hidden");
  });

  // Old code asking the new deployment for a chunk it no longer has.
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadedRecently()) return; // let the error surface (and reach telemetry)
    event.preventDefault();
    void reloadSafely("missing-chunk");
  });

  void navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((registration) => {
      let lastCheck = Date.now();
      const check = () => {
        if (Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
        lastCheck = Date.now();
        void registration.update().catch(() => undefined);
      };
      // An installed app can stay open for days: ask when it comes back to the
      // front, and every half hour while it's open.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      setInterval(check, CHECK_EVERY_MS);
    })
    .catch(() => undefined);
}
