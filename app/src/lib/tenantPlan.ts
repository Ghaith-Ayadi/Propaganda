// Which plan the open tenant is on: PPGD Lite (the CMS alone, free forever)
// or the full Propaganda (agents, knowledge base, goals). Lite shows the same
// app with content first and the agent pages left out (components/lite).
//
// PLACEHOLDER. The plan has no server-enforced home yet; the proposal is a
// `sites.plan` column only a superadmin can write. Until then: Verbatim,
// Ayadi's own blog, is Lite; a tenant that picked Lite when it was created
// (workspace/Onboarding.tsx) carries `tenant.plan` = "lite" in app_settings,
// remembered on this device too; every other tenant is full. A tenant can
// write that key, but writing "lite" only takes things away from itself, and
// full is everyone's default anyway. What this returns decides what the UI
// shows; the worker skips Lite tenants' KB agents (worker/src/kb/read.ts).
//
// The plan is per tenant, so one account can hold a Lite tenant (Verbatim)
// and a full one (PPGD) and the switcher moves between them.
//
// A viewer can be switched by hand to see a tenant on the other plan: on
// localhost, in the UI preview build, and for a superadmin. That choice is
// per tenant and per browser.

import { useEffect, useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/Workspace";
import { VERBATIM_SITE_ID } from "@/lib/scope";
import { useSuperadminAccount } from "@/lib/superadmin";
import { useSetting } from "@/lib/settings";

export type Plan = "lite" | "full";

const LITE_SITES = new Set<string>([VERBATIM_SITE_ID]);

// Tenants this device has seen on Lite: site id -> "lite".
const PICKED_KEY = "propaganda:plans";
let picked: Record<string, Plan> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PICKED_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
})();

/** Remember a tenant's own plan on this device (its `tenant.plan` setting). */
export function rememberPlan(siteId: string, plan: Plan) {
  if ((picked[siteId] ?? "full") === plan) return;
  picked = { ...picked };
  if (plan === "lite") picked[siteId] = plan;
  else delete picked[siteId];
  try {
    localStorage.setItem(PICKED_KEY, JSON.stringify(picked));
  } catch {}
  for (const l of listeners) l();
}

/** The tenant's own plan, as the server will one day say it. */
export function planOf(siteId: string): Plan {
  return LITE_SITES.has(siteId) || picked[siteId] === "lite" ? "lite" : "full";
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
  // The open tenant's own setting, for a device that hasn't seen it yet.
  const own = useSetting<string>("tenant.plan", "");
  useEffect(() => {
    if (id === site.id && (own === "lite" || own === "full")) rememberPlan(id, own);
  }, [id, site.id, own]);
  const view = useSyncExternalStore(subscribe, () => views[id] ?? null);
  useSyncExternalStore(subscribe, () => picked[id] ?? null);
  const canSwitch = useCanSwitchPlan();
  return (canSwitch && view) || planOf(id);
}
