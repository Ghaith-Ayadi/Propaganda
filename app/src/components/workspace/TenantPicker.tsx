import { Plus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import type { Account, SiteRef } from "@/lib/accounts";
import { siteHost } from "@/lib/siteUrl";

/**
 * Right after signing in: every tenant this account belongs to, and "Add
 * tenant". Opening one that was never set up starts its first run there.
 */
export function TenantPicker({
  account,
  sites,
  onPick,
  onAdd,
}: {
  account: Account;
  sites: SiteRef[];
  onPick: (site: SiteRef) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-primary px-4 py-12">
      <div className="w-full max-w-[440px] rounded-2xl border border-secondary bg-secondary px-6 py-9 shadow-2xl ring-1 ring-primary sm:px-8">
        <header className="text-center">
          <h1 className="type-title text-primary">Your tenants</h1>
          <p className="mx-auto mt-2 max-w-[34ch] text-sm text-balance text-tertiary">Signed in as {account.email}. Pick one to open.</p>
        </header>
        <ul className="mt-8 flex flex-col gap-2">
          {sites.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex w-full items-center gap-3 rounded-xl bg-primary px-4 py-3 text-left ring-1 ring-secondary transition ring-inset hover:ring-primary focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-hidden"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-semibold text-secondary ring-1 ring-secondary ring-inset">
                  {(s.name || "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate type-heading text-primary">{s.name || "Untitled tenant"}</span>
                  <span className="block truncate text-sm text-tertiary">{siteHost(s)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button className="mt-4 w-full" size="md" color="secondary" iconLeading={Plus} onClick={onAdd}>
          Add tenant
        </Button>
      </div>
    </div>
  );
}
