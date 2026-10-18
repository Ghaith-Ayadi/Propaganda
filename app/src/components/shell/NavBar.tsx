// The 0.2 nav bar: tenant switcher, the registered pages in order (Content
// with its channel > sub-channel tree), and the footer. Every row comes from
// lib/routes.ts; nothing here knows about a specific page except the tree.
//
// On PPGD Lite (lib/tenantPlan.ts) the same bar puts content first, like the
// 0.1 sidebar: the plan's few pages and Analytics on top, then every
// collection with its posts filling the bar (components/lite).

import { BarChart01, ChevronDown, Eye, LayoutLeft, SearchLg, Shield01, SwitchHorizontal01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { openCommandPalette } from "@/components/CommandPalette";
import { useWorkspace } from "@/components/Workspace";
import { SiteSwitcher } from "@/components/workspace/SiteSwitcher";
import { LiteCollections } from "@/components/lite/LiteCollections";
import { hookKey, usePages } from "@/components/lite/pages";
import { Collapse } from "@/components/motion/Collapse";
import { NumberPop } from "@/components/motion/NumberPop";
import { useLayout } from "@/lib/layout";
import { useIsMobile } from "@/lib/mobile";
import { analyticsHref, pageHref, useRoute, type Route } from "@/lib/route";
import { badgeOf, type NavNode, type PageRoute } from "@/lib/routes";
import { sitePublicUrl } from "@/lib/siteUrl";
import { useSuperadminAccount } from "@/lib/superadmin";
import { setPlanView, useCanSwitchPlan, usePlan } from "@/lib/tenantPlan";
import { cx } from "@/utils/cx";
import { activePageOf, toggleFolded, useFolded } from "./nav";

export function NavBar() {
  const [route] = useRoute();
  const { site } = useWorkspace();
  const active = activePageOf(route);
  const pages = usePages();
  const lite = usePlan() === "lite";
  const canSwitch = useCanSwitchPlan();
  // The server's is_superadmin() answer (lib/superadmin.ts), as in the command menu.
  const superadmin = useSuperadminAccount();
  const [layout, setLayout] = useLayout();
  const isMobile = useIsMobile();

  // Collapsed on a laptop: an icon rail, so the details panel gets the room.
  const collapsed = layout.sidebarCollapsed && !isMobile;
  const rail = (
    <div className="flex h-full w-[52px] flex-col items-center py-3">
      <button
        type="button"
        aria-label="Expand sidebar"
        title="Expand sidebar (⌘.)"
        onClick={() => setLayout({ sidebarCollapsed: false })}
        className="rounded-lg p-2 text-quaternary transition hover:bg-primary_hover hover:text-secondary"
      >
        <LayoutLeft className="size-4" />
      </button>
      <nav aria-label="Main" className="mt-2 flex flex-1 flex-col items-center gap-0.5 overflow-y-auto [scrollbar-width:none]">
        {pages
          .filter((p) => p.section === "main" && !(lite && p.id === "content"))
          .map((p) => (
            <RailLink key={hookKey(p)} page={p} active={active === p.id} />
          ))}
      </nav>
      <div className="flex flex-col items-center gap-0.5 border-t border-secondary pt-2">
        {pages.filter((p) => p.section === "footer").map((p) => (
          <RailLink key={hookKey(p)} page={p} active={active === p.id} />
        ))}
      </div>
    </div>
  );

  return (
    <aside
      data-intro="left"
      className={cx(
        "h-full max-w-full shrink-0 overflow-hidden border-r border-secondary bg-secondary transition-[width] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none",
        collapsed ? "w-[52px]" : "w-[260px] max-md:w-[300px]",
      )}
    >
      {collapsed ? rail : (
    <div className="flex h-full w-[260px] max-w-full flex-col max-md:w-[300px]">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <SiteSwitcher />
        </div>
        {!isMobile && (
          <button
            type="button"
            aria-label="Collapse sidebar"
            title="Collapse sidebar (⌘.)"
            onClick={() => setLayout({ sidebarCollapsed: true })}
            className="shrink-0 rounded-lg p-2 text-quaternary transition hover:bg-primary_hover hover:text-secondary"
          >
            <LayoutLeft className="size-4" />
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-sm text-quaternary shadow-xs ring-1 ring-inset ring-primary transition hover:text-tertiary"
        >
          <SearchLg className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="shrink-0 rounded border border-secondary bg-secondary px-1 text-xs">⌘K</kbd>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-0.5">
          {pages
            .filter((p) => p.section === "main" && !(lite && p.id === "content"))
            .map((p) => (
              <PageItem key={hookKey(p)} page={p} active={active === p.id} route={route} />
            ))}
          {lite && (
            <li>
              <a
                href={analyticsHref()}
                aria-current={route.view === "analytics" ? "page" : undefined}
                className={rowClass(route.view === "analytics")}
              >
                <BarChart01 className="size-4 shrink-0 text-quaternary" />
                <span>Analytics</span>
              </a>
            </li>
          )}
        </ul>
        {lite && (
          <div className="mt-2 border-t border-secondary pt-1">
            <LiteCollections currentPostId={route.view === "post" ? route.id : null} rowClass={rowClass} />
          </div>
        )}
      </nav>

      <div className="border-t border-secondary px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {pages.filter((p) => p.section === "footer").map((p) => (
            <PageItem key={hookKey(p)} page={p} active={active === p.id} route={route} />
          ))}
          {superadmin && (
            <li>
              <a href="#/admin" aria-current={route.view === "admin" ? "page" : undefined} className={rowClass(route.view === "admin")}>
                <Shield01 className="size-4 shrink-0 text-quaternary" />
                <span>Admin</span>
              </a>
            </li>
          )}
          <li>
            <a href={sitePublicUrl(site)} target="_blank" rel="noreferrer" className={rowClass(false)}>
              <Eye className="size-4 text-quaternary" />
              <span>Preview site</span>
            </a>
          </li>
          {canSwitch && (
            <li>
              {/* Localhost, the UI preview and superadmins: see the other plan. */}
              <button type="button" onClick={() => setPlanView(site.id, lite ? "full" : "lite")} className={rowClass(false)}>
                <SwitchHorizontal01 className="size-4 text-quaternary" />
                <span>{lite ? "View as full plan" : "View as Lite"}</span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
      )}
    </aside>
  );
}

/** A page as an icon in the collapsed rail. */
function RailLink({ page, active }: { page: PageRoute; active: boolean }) {
  const Icon = page.icon;
  const badge = badgeOf(page.useBadge?.());
  return (
    <a
      href={pageHref(page.path)}
      aria-label={page.label}
      title={page.label}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative rounded-lg p-2 outline-none transition focus-visible:ring-2 focus-visible:ring-brand",
        active ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-secondary" : "text-quaternary hover:bg-primary_hover hover:text-secondary",
      )}
    >
      <Icon className="size-4" />
      {badge?.urgent && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-fg-error-primary" />}
    </a>
  );
}

function rowClass(active: boolean) {
  return cx(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition outline-none focus-visible:ring-2 focus-visible:ring-brand",
    active
      ? "bg-primary font-medium text-primary shadow-xs ring-1 ring-inset ring-secondary"
      : "text-secondary hover:bg-primary_hover hover:text-primary",
  );
}

function PageItem({
  page,
  active,
  route,
}: {
  page: PageRoute;
  active: boolean;
  route: Route;
}) {
  const Icon = page.icon;
  const badge = badgeOf(page.useBadge?.());
  const children = page.useChildren?.();
  const folded = useFolded();
  const open = !folded.has(page.id);

  return (
    <li>
      <div className="relative flex items-center">
        <a href={pageHref(page.path)} aria-current={active ? "page" : undefined} className={rowClass(active && !children)}>
          <Icon className="size-4 shrink-0 text-quaternary" />
          <span className="truncate">{page.label}</span>
          {badge && (
            <Badge size="sm" color={badge.urgent ? "error" : "gray"} className={cx("ml-auto tabular-nums", children && "mr-6")}>
              <NumberPop value={badge.count} />
            </Badge>
          )}
        </a>
        {children && (
          <FoldButton id={page.id} open={open} className="absolute right-1" />
        )}
      </div>
      {children && (
        <Collapse open={open}>
          <NavTree page={page} nodes={children} route={route} depth={0} />
        </Collapse>
      )}
    </li>
  );
}

function FoldButton({ id, open, className }: { id: string; open: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={open ? "Collapse" : "Expand"}
      aria-expanded={open}
      onClick={() => toggleFolded(id)}
      className={cx("rounded p-1 text-quaternary transition hover:bg-primary_hover hover:text-secondary", className)}
    >
      <ChevronDown className={cx("size-3.5 transition-transform duration-200 motion-reduce:transition-none", !open && "-rotate-90")} />
    </button>
  );
}

function NavTree({
  page,
  nodes,
  route,
  depth,
}: {
  page: PageRoute;
  nodes: NavNode[];
  route: Route;
  depth: number;
}) {
  const folded = useFolded();
  const here = currentRest(page, route);

  return (
    <ul className={cx("mt-0.5 flex flex-col gap-0.5 border-l border-secondary", depth === 0 ? "ml-[18px] pl-1.5" : "ml-3 pl-1.5")}>
      {nodes.map((n) => {
        const key = `${page.id}/${n.id}`;
        const open = !folded.has(key);
        const Icon = n.icon;
        const isActive = n.rest != null && here === n.rest;
        const body = (
          <>
            {Icon ? (
              <Icon className="size-4 shrink-0 text-quaternary" />
            ) : n.emoji ? (
              <span className="w-4 shrink-0 text-center text-sm leading-none">{n.emoji}</span>
            ) : null}
            <span className="truncate">{n.label}</span>
            {n.note ? (
              <span className="ml-auto text-xs text-quaternary">{n.note}</span>
            ) : n.count != null ? (
              <span className={cx("ml-auto text-xs tabular-nums text-quaternary", n.children && "mr-5")}>{n.count}</span>
            ) : null}
          </>
        );
        return (
          <li key={n.id}>
            <div className="relative flex items-center">
              {n.rest != null ? (
                <a
                  href={pageHref(page.path, n.rest)}
                  aria-current={isActive ? "page" : undefined}
                  className={cx(rowClass(isActive), "py-1", !n.children && "pr-2")}
                >
                  {body}
                </a>
              ) : (
                <span aria-disabled className="flex w-full items-center gap-2.5 px-2.5 py-1 text-sm text-quaternary">
                  {body}
                </span>
              )}
              {n.children && n.children.length > 0 && (
                <FoldButton id={key} open={open} className="absolute right-1" />
              )}
            </div>
            {n.children && n.children.length > 0 && (
              <Collapse open={open}>
                <NavTree page={page} nodes={n.children} route={route} depth={depth + 1} />
              </Collapse>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The rest of the URL the tree should highlight. Content: a post's collection counts as being there. */
function currentRest(page: PageRoute, route: Route): string | null {
  if (page.id === "content") {
    // A post or a collection is Blog; Social and Email name themselves.
    if (route.view === "post" || route.view === "list") return "blog";
    if (route.view === "page" && route.page === "content") return (route.rest ?? "blog").split("/")[0] || "blog";
    return null;
  }
  return route.view === "page" && route.page === page.id ? route.rest : null;
}
