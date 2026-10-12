import { useSyncExternalStore } from "react";
// A tenant's first run, decided from its own data: opening a full tenant that
// has no approved goals yet goes to #/getting-started. No tenant
// is named here; Lite tenants (the CMS alone) never get it.
//
// Asked once per tab per tenant, and only on the home page, so a link to a
// post still opens the post; Getting started is in the nav either way. When the server can't be read the tenant opens as usual and is
// asked again on the next load.

import { must, sb } from "@/lib/supabase";
import { siteId } from "@/lib/scope";
import { planOf } from "@/lib/tenantPlan";
import { getSetting, installSettings, setSetting } from "@/lib/settings";
import { UI_PREVIEW } from "@/lib/preview";
import { reportError } from "@/lib/telemetry";

/** Home, the page a tenant opens on: #/home, #/ or no hash. */
const onHome = () => /^#?\/?(home)?$/.test(window.location.hash);
const asked = (site: string) => `propaganda:first-run-asked:${site}`;

// Whether each tenant has no approved goals yet, as last read: site -> boolean.
const noGoals = new Map<string, boolean>();
const listeners = new Set<() => void>();

/**
 * True when the open tenant has no approved goals yet, so its first day isn't
 * over whatever onboarding.completed says (the pre-0.2 wizard wrote that key
 * before any plan existed). False until it has been read.
 */
export function useNoGoalsYet(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => noGoals.get(siteId()) === true,
  );
}

/**
 * A full tenant with no approved goals yet: its first day isn't done. Null
 * when the server couldn't be read.
 */
export async function isFirstRun(site: string): Promise<boolean | null> {
  if (UI_PREVIEW || planOf(site) === "lite") return false;
  try {
    const [goals, plan] = await Promise.all([
      must(sb.from("goal_versions").select("version").eq("site", site).limit(1)),
      // A tenant that picked Lite on another device (lib/tenantPlan.ts).
      must(sb.from("app_settings").select("value").eq("site", site).eq("key", "tenant.plan").limit(1)),
    ]);
    if ((plan as { value: unknown }[] | null)?.[0]?.value === "lite") return false;
    const first = !goals?.length;
    noGoals.set(site, first);
    for (const l of listeners) l();
    return first;
  } catch (err) {
    reportError("First run not checked", err);
    return null;
  }
}

/**
 * Sends the open tenant to its first run when it needs one, and puts Getting
 * started in its nav (onboarding.started, components/lite/pages.ts) on any
 * page: a tab that was asked once already (or loaded first on another page)
 * still finds it there.
 */
export async function openFirstRunIfNeeded(go: () => void): Promise<void> {
  const site = siteId();
  const first = await isFirstRun(site);
  if (!first || site !== siteId()) return;
  if (!getSetting<string>("onboarding.started", "")) {
    await installSettings();
    if (site === siteId() && !getSetting<string>("onboarding.started", "")) {
      void setSetting("onboarding.started", new Date().toISOString());
    }
  }
  if (!onHome()) return;
  try {
    if (sessionStorage.getItem(asked(site))) return;
    sessionStorage.setItem(asked(site), "1");
  } catch {
    // No session storage: asked again next load.
  }
  if (site === siteId() && onHome()) go();
}
