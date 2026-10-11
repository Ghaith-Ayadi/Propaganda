// Small parts shared by the Getting started steps.

import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function StepTitle({ title, lede }: { title: ReactNode; lede?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-1">
      <h2 className="font-title text-2xl text-primary">{title}</h2>
      {lede && <p className="text-sm text-tertiary">{lede}</p>}
    </div>
  );
}

export function StepFooter({ children }: { children: ReactNode }) {
  return <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-secondary pt-5">{children}</div>;
}

export function SectionTitle({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-3">
      <h3 className="type-heading text-primary">{title}</h3>
      {lede && <p className="mt-0.5 text-sm text-tertiary">{lede}</p>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium tracking-wide text-quaternary uppercase">{label}</p>
      <div className="text-secondary">{children}</div>
    </div>
  );
}

export function Spinner({ light }: { light?: boolean }) {
  return <span className={cx("inline-block size-3 animate-spin rounded-full border-2 border-t-transparent", light ? "border-white" : "border-fg-quaternary")} />;
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-secondary", className)} />;
}

export function Choice({ selected, onSelect, title, hint }: { selected: boolean; onSelect: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx("flex flex-col gap-1 rounded-xl p-4 text-left ring-1 ring-inset transition", selected ? "bg-brand-primary ring-brand" : "bg-primary ring-secondary hover:bg-primary_hover")}
    >
      <span className="text-sm font-semibold text-primary">{title}</span>
      <span className="text-xs text-tertiary">{hint}</span>
    </button>
  );
}

/** m:ss */
export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
