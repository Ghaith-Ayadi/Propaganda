// Each tenant's mark in the switcher is its main site's favicon (the
// `favicon.url` setting), remembered per browser so the menu draws at once.
// Fetched once per page load per site through the account's own client;
// offline or unset, the switcher falls back to the site's initial.

import { useSyncExternalStore } from "react";
import { clientFor, type Account } from "@/lib/accounts";
import { reportError } from "@/lib/telemetry";

const KEY = "propaganda:site-icons";
type Icons = Record<string, string>;

let icons: Icons = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Icons;
  } catch {
    return {};
  }
})();
const listeners = new Set<() => void>();
const asked = new Set<string>();

function save(siteId: string, url: string | null) {
  if ((icons[siteId] ?? null) === url) return;
  icons = { ...icons };
  if (url) icons[siteId] = url;
  else delete icons[siteId];
  try {
    localStorage.setItem(KEY, JSON.stringify(icons));
  } catch {}
  for (const l of listeners) l();
}

/** Look up a site's favicon once per page load (no-op offline or when already asked). */
export function loadSiteIcon(account: Account, siteId: string): void {
  if (asked.has(siteId) || !navigator.onLine) return;
  asked.add(siteId);
  void (async () => {
    try {
      const { data, error } = await clientFor(account)
        .from("app_settings")
        .select("value")
        .eq("site", siteId)
        .eq("key", "favicon.url")
        .maybeSingle();
      if (error) throw error;
      const v = data?.value;
      save(siteId, typeof v === "string" && v ? v : null);
    } catch (err) {
      asked.delete(siteId);
      reportError("Site icon not loaded", err);
    }
  })();
}

export function useSiteIcon(siteId: string): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => icons[siteId] ?? null,
  );
}
