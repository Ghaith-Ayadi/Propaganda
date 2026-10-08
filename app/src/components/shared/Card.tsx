// The 0.2 card: a header (16px title, 14px description, actions on the right)
// and an optional footer, each set off by a divider that runs edge to edge.
// Sections inside a card are plain, labelled blocks (CardSection), never
// nested cards.

import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("flex flex-col rounded-xl border border-secondary bg-primary shadow-xs", className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-secondary px-5 py-4">
      <div className="flex min-w-0 flex-1 gap-3">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-md font-semibold text-primary">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-1 flex-col gap-6 px-5 py-5", className)}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <footer className="border-t border-secondary px-5 py-3 text-sm text-tertiary">{children}</footer>;
}

/** A labelled block inside a card: "Why now", "Angle", "Metadata". */
export function CardSection({ label, action, children }: { label: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold tracking-wide text-tertiary uppercase">{label}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Rows of label and value, for a card's Metadata section. */
export function MetaList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="flex items-center justify-between gap-3 border-b border-secondary pb-2 sm:block sm:border-0 sm:pb-0">
          <dt className="text-tertiary">{i.label}</dt>
          <dd className="text-primary sm:mt-0.5">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
