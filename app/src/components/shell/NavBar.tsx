// The 0.2 nav bar: tenant switcher, the registered pages in order (Content
// with its channel > sub-channel tree), and the footer. Every row comes from
// lib/routes.ts; nothing here knows about a specific page except the tree.

import { ChevronDown, Eye, Moon01, SearchLg, Sun } from "@untitledui/icons";
import { openCommandPalette } from "@/components/CommandPalette";
import { useWorkspace } from "@/components/Workspace";
import { SiteSwitcher } from "@/components/workspace/SiteSwitcher";
import { useActiveCollection } from "@/lib/activeCollection";
import { pageHref, useRoute, type Route } from "@/lib/route";
import { PAGES, type NavNode, type PageRoute } from "@/lib/routes";
import { sitePublicUrl } from "@/lib/siteUrl";
import { toggleTheme, useTheme } from "@/lib/theme";
import { cx } from "@/utils/cx";
import { activePageOf, toggleFolded, useFolded } from "./nav";

export function NavBar({ currentCollection }: { currentCollection?: string | null }) {
  const [route] = useRoute();
  const { site } = useWorkspace();
  const [theme] = useTheme();
  const active = activePageOf(route);

  return (
    <aside className="flex h-full w-[260px] max-w-full shrink-0 flex-col border-r border-secondary bg-secondary max-md:w-[300px]">
      <div className="px-3 pt-3 pb-2">
        <SiteSwitcher />
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2 rounded-lg bg-primary px-2.5 py-1.5 text-sm text-quaternary shadow-xs ring-1 ring-inset ring-primary transition hover:text-tertiary"
        >
          <SearchLg className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="shrink-0 rounded border border-secondary bg-secondary px-1 text-[11px]">⌘K</kbd>
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-0.5">
          {PAGES.filter((p) => p.section === "main").map((p) => (
            <PageItem key={p.id} page={p} active={active === p.id} route={route} currentCollection={currentCollection} />
          ))}
        </ul>
      </nav>

      <div className="border-t border-secondary px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {PAGES.filter((p) => p.section === "footer").map((p) => (
            <PageItem key={p.id} page={p} active={active === p.id} route={route} />
          ))}
          <li>
            <button type="button" onClick={toggleTheme} className={rowClass(false)}>
              {theme === "dark" ? <Sun className="size-4 text-quaternary" /> : <Moon01 className="size-4 text-quaternary" />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
          </li>
          <li>
            <a href={sitePublicUrl(site)} target="_blank" rel="noreferrer" className={rowClass(false)}>
              <Eye className="size-4 text-quaternary" />
              <span>Preview site</span>
            </a>
          </li>
        </ul>
      </div>
    </aside>
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
  currentCollection,
}: {
  page: PageRoute;
  active: boolean;
  route: Route;
  currentCollection?: string | null;
}) {
  const Icon = page.icon;
  const badge = page.useBadge?.() ?? null;
  const children = page.useChildren?.();
  const folded = useFolded();
  const open = !folded.has(page.id);

  return (
    <li>
      <div className="relative flex items-center">
        <a href={pageHref(page.path)} aria-current={active ? "page" : undefined} className={rowClass(active && !children)}>
          <Icon className="size-4 shrink-0 text-quaternary" />
          <span className="truncate">{page.label}</span>
          {badge != null && badge > 0 && (
            <span
              className={cx(
                "ml-auto rounded-full px-1.5 text-xs tabular-nums",
                page.id === "inbox" ? "bg-primary-solid font-medium text-white" : "text-quaternary",
              )}
            >
              {badge}
            </span>
          )}
        </a>
        {children && (
          <FoldButton id={page.id} open={open} className="absolute right-1" />
        )}
      </div>
      {children && open && (
        <NavTree page={page} nodes={children} route={route} currentCollection={currentCollection} depth={0} />
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
      <ChevronDown className={cx("size-3.5 transition", !open && "-rotate-90")} />
    </button>
  );
}

function NavTree({
  page,
  nodes,
  route,
  currentCollection,
  depth,
}: {
  page: PageRoute;
  nodes: NavNode[];
  route: Route;
  currentCollection?: string | null;
  depth: number;
}) {
  const [activeCollection] = useActiveCollection();
  const folded = useFolded();
  const here = currentRest(page, route, currentCollection ?? activeCollection);

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
              <span className="w-4 shrink-0 text-center text-[13px] leading-none">{n.emoji}</span>
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
            {n.children && n.children.length > 0 && open && (
              <NavTree page={page} nodes={n.children} route={route} currentCollection={currentCollection} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The rest of the URL the tree should highlight. Content: a post's collection counts as being there. */
function currentRest(page: PageRoute, route: Route, collection: string | null): string | null {
  if (page.id === "content") {
    const sub = (r: string) => `blog/${encodeURIComponent(r)}`;
    if (route.view === "post" || route.view === "list") return collection ? sub(collection) : "blog";
    if (route.view === "page" && route.page === "content") {
      if (!route.rest || route.rest === "blog") return collection ? sub(collection) : "blog";
      return route.rest;
    }
    return null;
  }
  return route.view === "page" && route.page === page.id ? route.rest : null;
}
