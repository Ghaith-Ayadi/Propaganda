// Admin's sections. Each is a page under #/admin/<id>. A thread that builds a
// section (Consumption, Runs, Logs) replaces its `component` here; the shell
// (components/admin/AdminPage.tsx) does the rest. A section reads the client to
// use from `useAdmin()` and calls server functions that start with
// private.require_superadmin(), so the server checks the flag on every request.

import type { ComponentType } from "react";
import { Activity, File05, Rows01 } from "@untitledui/icons";
import { ComingSoon } from "@/components/admin/ComingSoon";

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
    component: () => <ComingSoon title="Runs" />,
  },
  {
    id: "consumption",
    title: "Consumption",
    description: "Model spend per tenant against budgets, at API prices.",
    icon: File05,
    component: () => <ComingSoon title="Consumption" />,
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
