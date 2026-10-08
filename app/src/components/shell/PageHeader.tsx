// The 0.2 page layout. Every page is a header, then its body:
//
//   <PageHeader title="Inbox" description="…" actions={…} tabs={<PageTabs …/>} />
//   <PageBody>…</PageBody>
//
// The header spans the main column and its divider runs edge to edge; its
// text lines up with the shared content container. PageBody is that container
// (one width for every contained page: Inbox, Knowledge base, Goals, Site,
// Chat, Connections). A page that needs the full width (Pipeline's Gantt)
// passes `contained={false}` to both. `<Page>` does both in one.

import type { Key, ReactNode } from "react";
import { Tabs } from "@/components/application/tabs/tabs";
import { cx } from "@/utils/cx";

/** The shared content container: width and side gutters. */
export const CONTAINER = "mx-auto w-full max-w-[1120px] px-4 md:px-8";
const FULL = "w-full px-4 md:px-8";

export function PageHeader({
  title,
  description,
  actions,
  tabs,
  breadcrumbs,
  contained = true,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Sits on the divider: use <PageTabs>. */
  tabs?: ReactNode;
  /** Above the title (Content / Blog / …). */
  breadcrumbs?: ReactNode;
  contained?: boolean;
  /** Below the title row, above the tabs (filters, a search). */
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-secondary">
      <div className={cx(contained ? CONTAINER : FULL, "pt-6 md:pt-8", tabs ? "pb-0" : "pb-5 md:pb-6")}>
        {breadcrumbs && <div className="mb-3 text-sm text-tertiary">{breadcrumbs}</div>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="type-title text-primary">{title}</h1>
            {description && <p className="mt-1 text-sm text-tertiary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-5">{children}</div>}
        {tabs && <div className="-mb-px mt-5">{tabs}</div>}
      </div>
    </header>
  );
}

/** The page's content, in the shared container (or full width). */
export function PageBody({ children, contained = true, className }: { children: ReactNode; contained?: boolean; className?: string }) {
  return <div className={cx(contained ? CONTAINER : FULL, "pt-6 pb-16 md:pt-8", className)}>{children}</div>;
}

/** Header + body in one. */
export function Page({
  children,
  contained = true,
  ...header
}: Parameters<typeof PageHeader>[0] & { children: ReactNode }) {
  return (
    <>
      <PageHeader {...header} contained={contained} />
      <PageBody contained={contained}>{children}</PageBody>
    </>
  );
}

export interface PageTab {
  id: string;
  label: ReactNode;
  /** A count beside the label. */
  badge?: number | string;
}

/** The one tab style for page sections (Untitled UI underline, small), as on Goals. */
export function PageTabs({
  items,
  selected,
  onChange,
  label = "Sections",
}: {
  items: PageTab[];
  selected: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <Tabs selectedKey={selected} onSelectionChange={(k: Key) => onChange(String(k))}>
      <Tabs.List type="underline" size="sm" aria-label={label} className="overflow-x-auto [scrollbar-width:none]">
        {items.map((t) => (
          <Tabs.Item key={t.id} id={t.id} badge={t.badge}>
            {t.label}
          </Tabs.Item>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
