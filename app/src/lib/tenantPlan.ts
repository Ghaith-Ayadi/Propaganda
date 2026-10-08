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
// The plan is per tenant, so one account can hold a Lite tenant (Verbatim)
// and a full one (PPGD) and the switcher moves between them.
//
// A viewer can be switched by hand to see a tenant on the other plan: on
// localhost, in the UI preview build, and for a superadmin. That choice is
// per tenant and per browser.

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

// The hand-picked view per tenant: site id -> plan.
const KEY = "propaganda:plan-view";
let views: Record<string, Plan> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
})();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Show a tenant as the other plan; back to its own plan when `next` is its own. */
export function setPlanView(siteId: string, next: Plan) {
  views = { ...views };
  if (next === planOf(siteId)) delete views[siteId];
  else views[siteId] = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {}
  for (const l of listeners) l();
}

/** Whether this viewer may switch between Lite and full by hand. */
export function useCanSwitchPlan(): boolean {
  const superadmin = useSuperadminAccount();
  return import.meta.env.DEV || import.meta.env.VITE_UI_PREVIEW === "1" || superadmin != null;
}

/** The plan the UI shows for a tenant (the open one by default). */
export function usePlan(siteId?: string): Plan {
  const { site } = useWorkspace();
  const id = siteId ?? site.id;
  const picked = useSyncExternalStore(subscribe, () => views[id] ?? null);
  const canSwitch = useCanSwitchPlan();
  return (canSwitch && picked) || planOf(id);
}
