// A tenant's first run, decided from its own data: opening a full tenant that
// never finished onboarding and has no goals yet goes to #/welcome. No tenant
// is named here; Lite tenants (the CMS alone) never get it.
//
// Asked once per tab per tenant, so "Finish later" in the flow sticks until
// the next visit. When the server can't be read the tenant opens as usual.

import { must, sb } from "@/lib/supabase";
import { siteId } from "@/lib/scope";
import { planOf } from "@/lib/tenantPlan";
import { UI_PREVIEW } from "@/lib/preview";
import { reportError } from "@/lib/telemetry";

const asked = (site: string) => `propaganda:first-run-asked:${site}`;

export async function isFirstRun(site: string): Promise<boolean> {
  if (UI_PREVIEW || planOf(site) === "lite") return false;
  try {
    const [done, goals] = await Promise.all([
      must(sb.from("app_settings").select("id").eq("site", site).eq("key", "onboarding.completed").limit(1)),
      must(sb.from("goal_versions").select("version").eq("site", site).limit(1)),
    ]);
    return !done?.length && !goals?.length;
  } catch (err) {
    reportError("First run not checked", err);
    return false;
  }
}

/** Sends the open tenant to its first run when it needs one. */
export async function openFirstRunIfNeeded(go: () => void): Promise<void> {
  const site = siteId();
  try {
    if (sessionStorage.getItem(asked(site))) return;
    sessionStorage.setItem(asked(site), "1");
  } catch {
    // No session storage: ask anyway.
  }
  if ((await isFirstRun(site)) && site === siteId()) go();
}
