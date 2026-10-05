// Phone layout: below Tailwind's `md` (768px) the sidebar and the attribute
// panel stop being columns and become drawers over the page, closed by default.
// Their open state lives here, not in lib/layout (the desktop columns' saved
// preference), and any navigation closes them.

import { useEffect, useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

function subscribeMedia(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeMedia,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

export type Drawer = "nav" | "attributes" | null;

let open: Drawer = null;
const listeners = new Set<() => void>();

export function setDrawer(d: Drawer) {
  if (open === d) return;
  open = d;
  for (const l of listeners) l();
}

export function toggleDrawer(d: Exclude<Drawer, null>) {
  setDrawer(open === d ? null : d);
}

function subscribeDrawer(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useDrawer(): Drawer {
  return useSyncExternalStore(subscribeDrawer, () => open, () => null);
}

/** Close the drawers on navigation, and let pinch-zoom alone while writing. */
export function useMobileShell() {
  useEffect(() => {
    const close = () => setDrawer(null);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  // The editor's viewport, set here rather than in index.html so the public
  // blog keeps pinch-zoom: iOS zooms into any focused field under 16px and
  // never zooms back; maximum-scale stops that. resizes-content shrinks the
  // layout above the on-screen keyboard so the caret stays visible.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const before = meta.content;
    meta.content =
      "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content";
    return () => {
      meta.content = before;
    };
  }, []);
}
