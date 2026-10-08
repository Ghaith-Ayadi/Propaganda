// The phone's nav: a menu button (the full nav bar in a drawer) and every
// page in the tenant's plan as a tab in one scrolling row, the open one scrolled into view.

import { useEffect, useRef } from "react";
import { Menu01 } from "@untitledui/icons";
import { toggleDrawer } from "@/lib/mobile";
import { pageHref, useRoute } from "@/lib/route";
import type { PageRoute } from "@/lib/routes";
import { usePages } from "@/components/lite/pages";
import { cx } from "@/utils/cx";
import { activePageOf } from "./nav";

export function PhoneTabs() {
  const [route] = useRoute();
  const active = activePageOf(route);
  const pages = usePages();
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    row.current
      ?.querySelector<HTMLElement>("[aria-current=page]")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <div className="sticky top-0 z-40 flex items-center border-b border-secondary bg-primary/85 backdrop-blur">
      <button
        type="button"
        aria-label="Menu"
        onClick={() => toggleDrawer("nav")}
        className="ml-1 shrink-0 rounded-md p-2.5 text-tertiary transition hover:bg-primary_hover hover:text-secondary"
      >
        <Menu01 className="size-5" />
      </button>
      <nav aria-label="Pages" ref={row} className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 py-2 [scrollbar-width:none]">
        {pages.map((p) => (
          <Tab key={p.id} page={p} active={active === p.id} />
        ))}
      </nav>
    </div>
  );
}

function Tab({ page, active }: { page: PageRoute; active: boolean }) {
  const badge = page.useBadge?.() ?? null;
  return (
    <a
      href={pageHref(page.path)}
      aria-current={active ? "page" : undefined}
      className={cx(
        "shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition",
        active ? "bg-primary text-primary shadow-xs ring-1 ring-inset ring-secondary" : "text-secondary",
      )}
    >
      {page.label}
      {badge != null && badge > 0 && <span className="ml-1 text-quaternary tabular-nums">{badge}</span>}
    </a>
  );
}
