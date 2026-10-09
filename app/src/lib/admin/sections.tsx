// Admin's sections. Each is a page under #/admin/<id>. A thread that builds a
// section (Consumption, Runs, Logs) replaces its `component` here; the shell
// (components/admin/AdminPage.tsx) does the rest. A section reads the client to
// use from `useAdmin()` and calls server functions that start with
// private.require_superadmin(), so the server checks the flag on every request.

import type { ComponentType } from "react";
import { Activity, File05, Rows01, Scales02, Users01 } from "@untitledui/icons";
import { ArenaPage } from "@/components/admin/ArenaPage";
import { ComingSoon } from "@/components/admin/ComingSoon";
import { ConsumptionPage } from "@/components/admin/ConsumptionPage";
import { RunsPage } from "@/components/admin/RunsPage";
import { WaitlistPage } from "@/components/admin/WaitlistPage";

export interface AdminSection {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  component: ComponentType;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "runs",
    title: "Runs",
    description: "Every agent workflow: what ran, for which tenant, and how it ended.",
    icon: Activity,
    component: RunsPage,
  },
  {
    id: "consumption",
    title: "Consumption",
    description: "Model spend per tenant against budgets, at API prices.",
    icon: File05,
    component: ConsumptionPage,
  },
  {
    id: "arena",
    title: "Arena",
    description: "The same real agent task on two or three models, answers shown blind. Pick the best; votes and costs add up below.",
    icon: Scales02,
    component: ArenaPage,
  },
  {
    id: "waitlist",
    title: "Waitlist",
    description: "Everyone who joined the waitlist on propaganda.pub, newest first.",
    icon: Users01,
    component: WaitlistPage,
  },
  {
    id: "logs",
    title: "Logs",
    description: "Errors and server events across tenants.",
    icon: Rows01,
    component: () => <ComingSoon title="Logs" />,
  },
];

export function findSection(id: string | null): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.id === id) ?? ADMIN_SECTIONS[0];
}
