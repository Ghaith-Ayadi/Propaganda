// Which plan the open tenant is on: PPGD Lite (the CMS alone, free forever)
// or the full Propaganda (agents, knowledge base, goals). Lite shows the same
// app with content first and the agent pages left out (components/lite).
//
// PLACEHOLDER. The plan has no home on the server yet; the proposal is a
// `sites.plan` column only a superadmin can write (never app_settings: that
// table is publicly readable and written by the client, so a tenant could
// upgrade itself). Until then: Verbatim, Ayadi's own blog, is Lite and every
// other tenant is full. What this returns only decides what the UI shows.
//
// A viewer can be switched by hand to see the other plan: on localhost, in
// the UI preview build, and for a superadmin. That choice is per browser.

import { useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/Workspace";
import { VERBATIM_SITE_ID } from "@/lib/scope";
import { useSuperadminAccount } from "@/lib/superadmin";

export type Plan = "lite" | "full";

const LITE_SITES = new Set<string>([VERBATIM_SITE_ID]);

/** The tenant's own plan, as the server will one day say it. */
export function planOf(siteId: string): Plan {
  return LITE_SITES.has(siteId) ? "lite" : "full";
}

// The hand-picked view, if any: the same for every tenant on this browser.
const KEY = "propaganda:plan-view";
let view: Plan | null = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "lite" || v === "full" ? v : null;
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setPlanView(next: Plan | null) {
  view = next;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {}
  for (const l of listeners) l();
}

/** Whether this viewer may switch between Lite and full by hand. */
export function useCanSwitchPlan(): boolean {
  const superadmin = useSuperadminAccount();
  return import.meta.env.DEV || import.meta.env.VITE_UI_PREVIEW === "1" || superadmin != null;
}

/** The plan the UI shows for the open tenant. */
export function usePlan(): Plan {
  const { site } = useWorkspace();
  const picked = useSyncExternalStore(subscribe, () => view);
  const canSwitch = useCanSwitchPlan();
  return (canSwitch && picked) || planOf(site.id);
}
