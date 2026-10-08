// Small shared pieces of the pipeline pages, all on the Untitled UI kit.

import type { TextareaHTMLAttributes } from "react";
import { Badge } from "@/components/base/badges/badges";
import { FIT_BADGE, FIT_LABEL, fitGrade } from "@/lib/pipeline/fit";
import type { FitReason, Person } from "@/lib/pipeline/types";
import { cx } from "@/utils/cx";

export function FitBadge({ reasons }: { reasons: FitReason[] }) {
  const g = fitGrade(reasons);
  return (
    <Badge type="pill-color" size="sm" color={FIT_BADGE[g]}>
      {FIT_LABEL[g]}
    </Badge>
  );
}

export function TopicBadge({ children }: { children: string }) {
  return (
    <Badge type="pill-color" size="sm" color="gray">
      {children}
    </Badge>
  );
}

export function NotesBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge type="pill-color" size="sm" color="warning">
      {count} reviewer {count === 1 ? "note" : "notes"}
    </Badge>
  );
}

/** "Agent → you": who writes, who reviews. */
export function Handoff({ writer, reviewer, meId }: { writer?: Person; reviewer?: Person; meId: string }) {
  const name = (p?: Person) => (!p ? "Unassigned" : p.id === meId ? "you" : p.name);
  return (
    <span className="text-sm text-tertiary">
      {name(writer)} <span aria-hidden>→</span>
      <span className="sr-only">reviewed by</span> {name(reviewer)}
    </span>
  );
}

/** A label above a value, the way the brief's fields read. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("type-eyebrow text-quaternary", className)}>{children}</div>;
}

/** The kit has no textarea; this one matches its input styling. */
export function TextArea({ className, invalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full resize-y rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary outline-hidden ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand",
        invalid && "ring-error_subtle focus:ring-error",
        className,
      )}
    />
  );
}
