// #/admin — the superadmin shell. A side list of sections and the open one.
// Shown only to a browser holding a superadmin account (lib/superadmin.ts);
// anyone else gets a plain "not found".

import { useMemo } from "react";
import { adminClient, useSuperadminAccount } from "@/lib/superadmin";
import { ADMIN_SECTIONS, findSection } from "@/lib/admin/sections";
import { go } from "@/lib/route";
import { AdminContext } from "./AdminContext";

export function AdminPage({ section }: { section: string | null }) {
  const account = useSuperadminAccount();
  const api = useMemo(() => (account ? { account, client: adminClient(account) } : null), [account]);

  if (!api) {
    return <div className="flex h-full items-center justify-center text-tertiary">Page not found.</div>;
  }

  const current = findSection(section);
  const Section = current.component;

  return (
    <AdminContext.Provider value={api}>
      <div className="flex h-full flex-col overflow-hidden md:flex-row">
        <nav className="shrink-0 border-b border-secondary px-3 py-4 md:w-56 md:border-b-0 md:border-r">
          <h1 className="px-3 pb-3 type-title text-primary">Admin</h1>
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {ADMIN_SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => go({ view: "admin", section: s.id })}
                  aria-current={s.id === current.id ? "page" : undefined}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-secondary transition hover:bg-tertiary aria-[current=page]:bg-tertiary aria-[current=page]:font-medium aria-[current=page]:text-primary"
                >
                  <s.icon className="size-4 shrink-0 text-quaternary" />
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 hidden px-3 text-xs text-quaternary md:block">Signed in as {api.account.email}</p>
        </nav>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-[1000px]">
            <h2 className="type-heading text-primary">{current.title}</h2>
            <p className="mb-6 mt-1 text-sm text-tertiary">{current.description}</p>
            <Section />
          </div>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
