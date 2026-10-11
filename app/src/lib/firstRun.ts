// A tenant's first run, decided from its own data: opening a full tenant that
// never finished onboarding and has no goals yet goes to #/getting-started. No tenant
// is named here; Lite tenants (the CMS alone) never get it.
//
// Asked once per tab per tenant, so "Finish later" in the flow sticks until
// the next visit, and only on the home page, so a link to a post still opens
// the post. When the server can't be read the tenant opens as usual and is
// asked again on the next load.

import { must, sb } from "@/lib/supabase";
import { siteId } from "@/lib/scope";
import { planOf } from "@/lib/tenantPlan";
import { UI_PREVIEW } from "@/lib/preview";
import { reportError } from "@/lib/telemetry";

/** Home, the page a tenant opens on: #/home, #/ or no hash. */
const onHome = () => /^#?\/?(home)?$/.test(window.location.hash);
const asked = (site: string) => `propaganda:first-run-asked:${site}`;

/** Null when the server couldn't be read. */
export async function isFirstRun(site: string): Promise<boolean | null> {
  if (UI_PREVIEW || planOf(site) === "lite") return false;
  try {
    const [done, goals] = await Promise.all([
      must(sb.from("app_settings").select("id").eq("site", site).eq("key", "onboarding.completed").limit(1)),
      must(sb.from("goal_versions").select("version").eq("site", site).limit(1)),
    ]);
    return !done?.length && !goals?.length;
  } catch (err) {
    reportError("First run not checked", err);
    return null;
  }
}

/** Sends the open tenant to its first run when it needs one. */
export async function openFirstRunIfNeeded(go: () => void): Promise<void> {
  const site = siteId();
  if (!onHome()) return;
  try {
    if (sessionStorage.getItem(asked(site))) return;
  } catch {
    // No session storage: ask anyway.
  }
  const first = await isFirstRun(site);
  if (first === null || site !== siteId()) return;
  try {
    sessionStorage.setItem(asked(site), "1");
  } catch {
    // Asked again next load.
  }
  if (first && onHome()) go();
}
