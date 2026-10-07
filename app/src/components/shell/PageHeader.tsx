import type { ReactNode } from "react";

/** The top of a 0.2 page: serif title, a line under it, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Below the title row: tabs, filters. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 md:mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-title text-3xl tracking-tight text-primary md:text-4xl">{title}</h1>
          {description && <p className="mt-1.5 text-md text-tertiary">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}

/** The column a page sits in: the gutters and max width every page shares. */
export function PageBody({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-4 pt-6 pb-16 md:px-10 md:pt-10 ${wide ? "max-w-[1400px]" : "max-w-[1100px]"}`}>
      {children}
    </div>
  );
}
