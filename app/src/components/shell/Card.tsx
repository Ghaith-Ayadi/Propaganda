// The shared card: a header whose divider touches the card's edges (title
// 16px semibold, description 14px), a body, and an optional footer.
//
//   <Card>
//     <CardHeader title="Launch" description="Day 14 of 30" actions={…} />
//     <CardBody>…</CardBody>
//     <CardFooter>Quarterly goal: 24 posts</CardFooter>
//   </Card>

import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary ring-inset", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-3 border-b border-secondary px-5 py-4">
      {icon && <div className="mt-0.5 shrink-0 text-fg-quaternary">{icon}</div>}
      <div className="min-w-0 flex-1">
        <h3 className="text-md font-semibold text-primary">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("px-5 py-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <footer className={cx("border-t border-secondary px-5 py-3 text-sm text-tertiary", className)}>{children}</footer>;
}
