// The registered pages (lib/routes.ts) as the open tenant's plan shows them.
// The full plan shows the registry as it is. Lite leaves out the agent pages,
// swaps Home and Pipeline for the writing dashboard and the 0.1 planning
// calendar, and adds one quiet Upgrade entry. The nav, the phone tabs, the
// command menu and the router all read pages through here.

import { lazy } from "react";
import { Calendar, Stars02 } from "@untitledui/icons";
import { PAGES, type PageRoute } from "@/lib/routes";
import { usePlan, type Plan } from "@/lib/tenantPlan";

/** Lite's take on a page: `false` leaves it out, an object changes it. */
const LITE: Record<string, false | Partial<PageRoute>> = {
  home: {
    description: "Your latest writing at a glance.",
    component: lazy(() => import("./LiteHome").then((m) => ({ default: m.LiteHome }))),
  },
  inbox: false,
  pipeline: {
    label: "Planning",
    icon: Calendar,
    description: "What goes out, and when.",
    // The Pipeline's count is pitches waiting: agent work.
    useBadge: undefined,
    component: lazy(() => import("@/components/plan/PlanPage").then((m) => ({ default: m.PlanPage }))),
  },
  knowledge: false,
  goals: false,
  chat: false,
  connections: false,
};

/** Lite only: what the full plan adds. */
export const UPGRADE: PageRoute = {
  id: "upgrade",
  label: "Upgrade",
  icon: Stars02,
  path: "upgrade",
  description: "Let Propaganda pitch, write and fact-check for you.",
  section: "footer",
  component: lazy(() => import("./UpgradePage").then((m) => ({ default: m.UpgradePage }))),
};

const LITE_PAGES: PageRoute[] = [
  ...PAGES.flatMap((p) => {
    const lite = LITE[p.id];
    if (lite === false) return [];
    return [lite ? { ...p, ...lite } : p];
  }),
  UPGRADE,
];

export function pagesFor(plan: Plan): PageRoute[] {
  return plan === "lite" ? LITE_PAGES : PAGES;
}

export function usePages(): PageRoute[] {
  return pagesFor(usePlan());
}

/**
 * The page at a path for this plan. `locked`: the page exists but is not in
 * this plan (Lite opening #/knowledge), so the router shows the upgrade note.
 */
export function findPlanPage(plan: Plan, path: string): { page: PageRoute; locked: boolean } | undefined {
  const page = pagesFor(plan).find((p) => p.path === path);
  if (page) return { page, locked: false };
  const other = PAGES.find((p) => p.path === path);
  return other ? { page: other, locked: true } : undefined;
}
