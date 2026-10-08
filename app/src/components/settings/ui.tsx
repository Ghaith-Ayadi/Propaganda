// Small pieces shared by the Settings and Connections pages, built from the kit.

import type { ReactNode } from "react";
import { useState } from "react";
import { Copy01, Check } from "@untitledui/icons";
import { Card as ShellCard, CardBody, CardHeader } from "@/components/shell/Card";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { cx } from "@/utils/cx";

/** The shell's shared card, with the title / description / action / body shape the sections use. */
export function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <ShellCard>
      <div className={children ? undefined : "[&>header]:border-b-0"}>
        <CardHeader title={title} description={description} actions={action} />
      </div>
      {children && <CardBody>{children}</CardBody>}
    </ShellCard>
  );
}

/** A labelled row: text on the left, a control on the right. */
export function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-secondary py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-primary">{title}</div>
        {hint && <div className="text-xs text-tertiary">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Few choices, one visible at a time. Same look as the editor settings. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-lg border border-secondary bg-secondary p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-3 py-1.5 text-sm transition",
            value === o.value ? "bg-primary text-primary shadow-xs ring-1 ring-secondary" : "text-secondary hover:text-primary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  rows = 6,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  label: string;
}) {
  return (
    <textarea
      aria-label={label}
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs outline-none ring-1 ring-inset ring-primary transition-shadow duration-100 ease-linear placeholder:text-placeholder focus:ring-2 focus:ring-inset focus:ring-brand"
    />
  );
}

/** Read-only value with a copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  }
  return (
    <div className="flex items-center gap-2">
      <Input size="sm" aria-label={label} value={value} isReadOnly wrapperClassName="flex-1" />
      <Button size="sm" color="secondary" iconLeading={copied ? Check : Copy01} onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** The honest empty state: this piece is drawn and saved, not wired to a server yet. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-tertiary">{children}</p>;
}
