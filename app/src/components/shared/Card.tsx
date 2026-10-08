// The shell's card (components/shell/Card.tsx: a header whose divider runs
// edge to edge, 16px title, 14px description, a footer), plus the pieces Home
// and the Inbox put inside it. Sections inside a card are plain, labelled
// blocks (CardSection), never nested cards.

import type { ReactNode } from "react";
import { CardBody as ShellCardBody } from "@/components/shell/Card";
import { cx } from "@/utils/cx";

export { Card, CardFooter } from "@/components/shell/Card";

/**
 * The shell's header, except that the actions wrap under the title when the
 * card is narrow (a pitch has three buttons; a phone has 390px). Same classes
 * otherwise: switch back to the shell's once it wraps.
 */
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
    <header className="flex flex-wrap items-start gap-3 border-b border-secondary px-5 py-4">
      <div className="flex min-w-[min(100%,16rem)] flex-1 items-start gap-3">
        {icon && <div className="mt-0.5 shrink-0 text-fg-quaternary">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-primary">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-tertiary">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The shell's body, with its sections stacked. */
export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <ShellCardBody className={cx("flex flex-col gap-6 py-5", className)}>{children}</ShellCardBody>;
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
