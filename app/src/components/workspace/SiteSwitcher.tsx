import { Check, ChevronDown, LogOut01, Plus, UserPlus01 } from "@untitledui/icons";
import {
  Button as AriaButton,
  Header as AriaHeader,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger as AriaMenuTrigger,
  Popover as AriaPopover,
  Separator as AriaSeparator,
} from "react-aria-components";
import { Avatar } from "@/components/base/avatar/avatar";
import { useWorkspace } from "@/components/Workspace";
import { usePlan } from "@/lib/tenantPlan";
import { loadSiteIcon, useSiteIcon } from "@/lib/siteIcons";
import { useEffect } from "react";
import { cx } from "@/utils/cx";

/**
 * The tenant switcher: trigger + menu for the active tenant (a site).
 * Lists every account on this browser, each account's sites underneath, and
 * the usual account-level actions. Switching is IndexedDB-only (lib/scope.ts),
 * so nothing here waits on the network.
 */
export function SiteSwitcher() {
  const { account, site, accounts, sitesOf, switchTo, addAccount, newSite, signOut, isSignedIn } = useWorkspace();

  // Every tenant's favicon, once per page load (lib/siteIcons.ts).
  useEffect(() => {
    for (const a of accounts) {
      if (!isSignedIn(a.userId)) continue;
      for (const s of sitesOf(a.userId)) loadSiteIcon(a, s.id);
    }
  }, [accounts, sitesOf, isSignedIn]);

  return (
    <AriaMenuTrigger>
      <AriaButton
        aria-label="Switch tenant"
        className="-mx-1 flex max-w-full items-center gap-2 rounded-md px-1 py-1 outline-none transition hover:bg-primary_hover data-[pressed]:bg-primary_hover"
      >
        <TenantMark siteId={site.id} name={site.name} />
        <span className="truncate font-title text-xl tracking-tight text-primary">{site.name}</span>
        <ChevronDown className="size-4 shrink-0 text-quaternary" />
      </AriaButton>

      <AriaPopover
        placement="bottom start"
        className={cx(
          "z-50 w-[300px] max-h-[70vh] overflow-y-auto rounded-xl border border-secondary bg-secondary p-1.5 shadow-2xl ring-1 ring-primary",
          "entering:animate-in entering:fade-in entering:zoom-in-95 entering:duration-100",
          "exiting:animate-out exiting:fade-out exiting:zoom-out-95 exiting:duration-75",
        )}
      >
        <AriaMenu className="outline-none" onAction={(key) => onAction(String(key))}>
          {accounts.flatMap((a) => {
            const signedIn = isSignedIn(a.userId);
            const sites = sitesOf(a.userId);
            return [
              <AriaMenuSection key={`section-${a.userId}`}>
                <AriaHeader className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
                  <Avatar size="xs" src={a.avatar || undefined} initials={initialsOf(a)} alt={a.email} />
                  <span className="truncate text-xs text-quaternary">{a.email}</span>
                </AriaHeader>

                {!signedIn && (
                  <AriaMenuItem
                    id={`resignin:${a.userId}`}
                    className="mx-1 cursor-pointer rounded-md px-2.5 py-1.5 text-sm text-error-primary outline-none hover:bg-error-primary/10 focus:bg-error-primary/10"
                  >
                    Session expired — sign in
                  </AriaMenuItem>
                )}

                {signedIn &&
                  sites.map((s) => (
                    <AriaMenuItem
                      key={s.id}
                      id={`site:${a.userId}:${s.id}`}
                      className="mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-secondary outline-none hover:bg-tertiary hover:text-primary focus:bg-tertiary focus:text-primary"
                    >
                      <TenantMark siteId={s.id} name={s.name} small />
                      <span className="truncate">{s.name}</span>
                      <PlanTag siteId={s.id} />
                      <Check
                        className={cx(
                          "ml-auto size-3.5 shrink-0 text-fg-brand-primary",
                          (a.userId !== account.userId || s.id !== site.id) && "invisible",
                        )}
                      />
                    </AriaMenuItem>
                  ))}
              </AriaMenuSection>,
              <AriaSeparator key={`sep-${a.userId}`} className="my-1 h-px bg-border-secondary" />,
            ];
          })}

          <AriaMenuItem
            id="new-site"
            className="mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-secondary outline-none hover:bg-tertiary hover:text-primary focus:bg-tertiary focus:text-primary"
          >
            <Plus className="size-3.5 shrink-0 text-quaternary" />
            <span>New tenant</span>
          </AriaMenuItem>
          <AriaMenuItem
            id="add-account"
            className="mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-secondary outline-none hover:bg-tertiary hover:text-primary focus:bg-tertiary focus:text-primary"
          >
            <UserPlus01 className="size-3.5 shrink-0 text-quaternary" />
            <span>Add another account</span>
          </AriaMenuItem>
          <AriaMenuItem
            id="sign-out"
            className="mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-error-primary outline-none hover:bg-error-primary/10 focus:bg-error-primary/10"
          >
            <LogOut01 className="size-3.5 shrink-0" />
            <span className="truncate">Sign out of {account.email}</span>
          </AriaMenuItem>
        </AriaMenu>
      </AriaPopover>
    </AriaMenuTrigger>
  );

  function onAction(key: string) {
    if (key === "new-site") return newSite();
    if (key === "add-account") return addAccount();
    if (key === "sign-out") return signOut(account.userId);
    if (key.startsWith("resignin:")) return addAccount();
    if (key.startsWith("site:")) {
      const [, userId, siteId] = key.split(":");
      return switchTo(userId, siteId);
    }
  }
}

function initialsOf(a: { name: string; email: string }): string {
  const src = a.name || a.email;
  return src.slice(0, 1).toUpperCase();
}

/** A tenant's mark: its main site's favicon, or its initial. */
function TenantMark({ siteId, name, small = false }: { siteId: string; name: string; small?: boolean }) {
  const icon = useSiteIcon(siteId);
  const box = small ? "size-5 rounded" : "size-7 rounded-md";
  if (icon) {
    return <img src={icon} alt="" aria-hidden className={cx(box, "shrink-0 object-cover")} />;
  }
  return (
    <span
      aria-hidden
      className={cx(
        box,
        "flex shrink-0 items-center justify-center bg-(--color-fg-primary) font-title text-(--color-bg-primary)",
        small ? "text-xs" : "text-base",
      )}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** "Lite" beside a tenant on the free plan (lib/tenantPlan.ts). */
function PlanTag({ siteId }: { siteId: string }) {
  if (usePlan(siteId) !== "lite") return null;
  return <span className="shrink-0 rounded px-1.5 text-xs text-quaternary ring-1 ring-inset ring-secondary">Lite</span>;
}
