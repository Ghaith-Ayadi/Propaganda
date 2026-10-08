import { useSyncExternalStore } from "react";
import type { Route } from "@/lib/route";

/** Which registered page a route belongs to, for the nav's highlight. */
export function activePageOf(route: Route): string | null {
  if (route.view === "page") return route.page;
  if (route.view === "list" || route.view === "post") return "content";
  if (route.view === "plan" || route.view === "brief") return "pipeline";
  return null;
}

// Which nav tree rows are folded, per browser. Everything starts open.
const KEY = "propaganda:nav-folded";
let folded: Set<string> = (() => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
})();
const listeners = new Set<() => void>();

export function toggleFolded(id: string) {
  folded = new Set(folded);
  if (folded.has(id)) folded.delete(id);
  else folded.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...folded]));
  } catch {}
  for (const l of listeners) l();
}

export function useFolded(): Set<string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => folded,
  );
}
