// Small pieces the inbox details share: a quote in its context, a knowledge
// base claim, a list row, and a plain text area in the kit's input style.

import type { ReactNode } from "react";
import { LinkExternal01, Scales02 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { postHref } from "@/lib/route";
import { ObjectIcon, objectLabel } from "@/components/shared/ObjectIcon";
import { cx } from "@/utils/cx";
import type { Claim, InboxObject, Passage } from "./data";

/** "…before [quote] after…", with the quote marked. */
export function PassageText({ passage, mark = "flag" }: { passage: Passage; mark?: "flag" | "plain" }) {
  return (
    <p className="text-md leading-7 text-secondary">
      {passage.before && <>…{passage.before}</>}
      <mark
        className={cx(
          "rounded-sm bg-transparent px-0.5 text-primary",
          mark === "flag" ? "ring-1 ring-[var(--color-border-error)] ring-inset [box-decoration-break:clone]" : "ring-1 ring-primary ring-inset",
        )}
      >
        {passage.quote}
      </mark>
      {passage.after && <>{passage.after}…</>}
    </p>
  );
}

/** Where the original lives: the editor for our posts, the live page otherwise. */
export function originalHref(object: InboxObject): string | null {
  if (object.postId) return postHref(object.postId);
  return object.url ?? null;
}

export function OpenOriginal({ object }: { object: InboxObject }) {
  const href = originalHref(object);
  if (!href) return null;
  return (
    <a href={href} className="inline-flex shrink-0 items-center gap-1 text-sm text-secondary hover:text-primary">
      Open the original <LinkExternal01 className="size-3.5" />
    </a>
  );
}

export function SourceBlock({
  icon,
  heading,
  action,
  children,
  footer,
}: {
  icon: ReactNode;
  heading: string;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-secondary">
          {icon}
          {heading}
        </span>
        {action}
      </div>
      <div className="rounded-xl bg-secondary px-4 py-3">{children}</div>
      {footer && <div className="mt-2 text-sm text-tertiary">{footer}</div>}
    </section>
  );
}

export function ClaimBlock({ claim, heading, action }: { claim: Claim; heading: string; action?: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-secondary">
          <Scales02 className="size-4 text-fg-quaternary" />
          {heading}
        </span>
        {action ?? <ClaimStatus status={claim.status} />}
      </div>
      <div className="rounded-xl border border-secondary bg-primary px-4 py-3">
        <p className="text-md leading-7 text-primary">{claim.text}</p>
        <p className="mt-1 text-sm text-tertiary">
          {claim.topic} · {claim.origin} · since {claim.since}
        </p>
      </div>
      <div className="mt-2 text-sm text-tertiary">
        {claim.evidence} piece{claim.evidence === 1 ? "" : "s"} of evidence
      </div>
    </section>
  );
}

export function ClaimStatus({ status }: { status: Claim["status"] }) {
  return status === "settled" ? (
    <Badge type="pill-color" color="success" size="sm">Settled</Badge>
  ) : (
    <Badge type="pill-color" color="warning" size="sm">Contested</Badge>
  );
}

export function ObjectLine({ object }: { object: InboxObject }) {
  return (
    <span className="flex items-center gap-2 text-sm text-secondary">
      <ObjectIcon kind={object.kind} className="size-4" />
      {objectLabel[object.kind]}
      <span className="text-tertiary">{object.state}</span>
    </span>
  );
}

export function ListRow({
  selected,
  onSelect,
  icon,
  title,
  sub,
  aside,
  extra,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  sub: ReactNode;
  aside?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cx(
        "flex w-full gap-3 border-b border-secondary px-4 py-3.5 text-left outline-focus-ring transition-colors last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2",
        selected ? "bg-secondary" : "hover:bg-primary_hover",
      )}
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-md text-primary">{title}</span>
        <span className="mt-0.5 block truncate text-sm text-tertiary">{sub}</span>
        {extra && <span className="mt-2 flex flex-wrap gap-1.5">{extra}</span>}
      </span>
      {aside && <span className="shrink-0 text-sm text-tertiary">{aside}</span>}
    </button>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <textarea
      aria-label={label}
      value={value}
      rows={rows}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-lg bg-primary px-3.5 py-3 text-md text-primary shadow-xs ring-1 ring-primary outline-hidden ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
    />
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-primary px-6 py-12 text-center">
      <p className="font-title text-xl text-primary">{title}</p>
      <p className="mt-1 text-sm text-tertiary">{body}</p>
    </div>
  );
}
