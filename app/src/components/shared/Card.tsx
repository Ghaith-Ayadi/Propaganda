// The shell's card (components/shell/Card.tsx: a header whose divider runs
// edge to edge, 16px title, 14px description, a footer), plus the pieces Home
// and the Inbox put inside it. Sections inside a card are plain, labelled
// blocks (CardSection), never nested cards.

import type { ReactNode } from "react";
import { CardBody as ShellCardBody } from "@/components/shell/Card";
import { cx } from "@/utils/cx";

export { Card, CardFooter, CardHeader } from "@/components/shell/Card";

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
