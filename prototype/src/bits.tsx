// Shared bits: the small vocabulary every screen is built from.

import { Check, ChevronRight } from "@untitledui/icons";

export function cx(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

export function Button({
  children,
  onClick,
  kind = "secondary",
  size = "md",
  iconLeading,
  disabled,
  className,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  iconLeading?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const kinds = {
    primary: "bg-brand-solid text-white hover:bg-brand-solid_hover ring-1 ring-inset ring-brand_alt",
    secondary: "bg-primary text-secondary ring-1 ring-inset ring-primary hover:bg-primary_hover shadow-xs",
    ghost: "text-secondary hover:bg-primary_hover",
    danger: "bg-primary text-error-primary ring-1 ring-inset ring-error_subtle hover:bg-error-primary",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-40",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        kinds[kind],
        className,
      )}
    >
      {iconLeading}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  pad = true,
}: {
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={cx(
        "overflow-hidden rounded-xl border border-secondary bg-primary",
        pad && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHead({
  title,
  hint,
  right,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 className="font-title text-lg text-primary">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-tertiary">{hint}</p>}
      </div>
      {right}
    </header>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-quaternary">{children}</div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-secondary text-tertiary ring-secondary",
  good: "bg-success-primary text-success-primary ring-success_subtle",
  warn: "bg-warning-primary text-warning-primary ring-warning_subtle",
  bad: "bg-error-primary text-error-primary ring-error_subtle",
  info: "bg-brand-primary text-brand-secondary ring-brand",
};

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const fill = {
    neutral: "bg-quaternary",
    good: "bg-success-solid",
    warn: "bg-warning-solid",
    bad: "bg-error-solid",
    info: "bg-brand-solid",
  }[tone];
  return <span className={cx("size-1.5 shrink-0 rounded-full", fill)} />;
}

/** The letter grade, the one piece of chrome the Home screen is built around. */
export function Grade({
  letter,
  label,
  share,
  size = "lg",
}: {
  letter: string;
  label: string;
  share: number;
  size?: "lg" | "sm";
}) {
  const tone: Tone = letter === "A" ? "good" : letter === "B" ? "info" : letter === "C" ? "warn" : "bad";
  const ring = { good: "ring-success_subtle", info: "ring-brand", warn: "ring-warning_subtle", bad: "ring-error_subtle", neutral: "ring-secondary" }[tone];
  const fg = { good: "text-success-primary", info: "text-brand-secondary", warn: "text-warning-primary", bad: "text-error-primary", neutral: "text-primary" }[tone];
  return (
    <div className="flex items-center gap-3">
      <div
        className={cx(
          "grid shrink-0 place-items-center rounded-xl bg-secondary ring-1 ring-inset",
          ring,
          size === "lg" ? "size-16" : "size-11",
        )}
      >
        <span className={cx("font-title leading-none", fg, size === "lg" ? "text-4xl" : "text-2xl")}>
          {letter}
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-primary">{label}</div>
        <div className="tnum text-xs text-tertiary">{Math.round(share * 100)}% clean</div>
      </div>
    </div>
  );
}

export function Meter({ value, tone = "info" }: { value: number; tone?: Tone }) {
  const fill = {
    neutral: "bg-quaternary",
    good: "bg-success-solid",
    warn: "bg-warning-solid",
    bad: "bg-error-solid",
    info: "bg-brand-solid",
  }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-quaternary/60">
      <div className={cx("h-full rounded-full transition-[width] duration-500", fill)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

/** Range bar: where production sits inside a topic's min-max range. */
export function RangeBar({ published, range }: { published: number; range: [number, number] }) {
  const [min, max] = range;
  const scale = Math.max(max, published) * 1.15;
  const tone: Tone = published >= min ? "good" : published > 0 ? "warn" : "bad";
  const fill = { good: "bg-success-solid", warn: "bg-warning-solid", bad: "bg-error-solid", info: "", neutral: "" }[tone];
  return (
    <div className="relative h-5 w-full">
      <div className="absolute inset-x-0 top-1.5 h-2 rounded-full bg-secondary ring-1 ring-inset ring-secondary" />
      <div
        className="absolute top-1.5 h-2 rounded-full bg-quaternary/50"
        style={{ left: `${(min / scale) * 100}%`, width: `${((max - min) / scale) * 100}%` }}
        title={`Range ${min}–${max}`}
      />
      <div className={cx("absolute top-1.5 h-2 rounded-l-full", fill)} style={{ width: `${(published / scale) * 100}%` }} />
      <div className="absolute top-0.5 w-px bg-primary" style={{ left: `${(published / scale) * 100}%`, height: 14 }} />
    </div>
  );
}

export function Spark({ points, tone = "info" }: { points: number[]; tone?: Tone }) {
  const w = 96;
  const h = 26;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - ((p - lo) / span) * (h - 4) - 2] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const stroke = { good: "var(--color-fg-success-primary)", warn: "var(--color-fg-warning-primary)", bad: "var(--color-fg-error-primary)", info: "var(--color-fg-brand-primary)", neutral: "var(--color-fg-quaternary)" }[tone];
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" className="overflow-visible">
      <path d={area} fill={stroke} opacity="0.1" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2" fill={stroke} />
    </svg>
  );
}

export function Quote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="rounded-lg border-l-2 border-brand-solid bg-secondary px-3 py-2">
      <blockquote className="text-sm text-secondary">“{children}”</blockquote>
      <figcaption className="mt-1 text-xs text-quaternary">{label}</figcaption>
    </figure>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-secondary">{label}</span>
      {children}
      {hint && <span className="text-xs text-tertiary">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-inset ring-primary outline-none transition placeholder:text-placeholder focus:ring-2 focus:ring-brand";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-lg bg-secondary p-0.5 ring-1 ring-inset ring-secondary">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            "rounded-md px-2.5 py-1 text-xs font-medium transition",
            value === o.value ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition",
        on ? "bg-brand-solid" : "bg-quaternary",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 size-4 rounded-full bg-primary shadow-sm transition-[left]",
          on ? "left-4.5" : "left-0.5",
        )}
      />
    </button>
  );
}

export function Row({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cx(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition",
        onClick && "hover:bg-secondary",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-14 text-center">
      <div className="grid size-9 place-items-center rounded-full bg-success-primary text-success-primary ring-1 ring-inset ring-success_subtle">
        <Check className="size-4" />
      </div>
      <div className="text-sm font-medium text-primary">{title}</div>
      {hint && <div className="max-w-sm text-xs text-tertiary">{hint}</div>}
    </div>
  );
}

export function LinkRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-1 text-xs font-medium text-brand-secondary hover:underline"
    >
      {children}
      <ChevronRight className="size-3.5 transition group-hover:translate-x-0.5" />
    </button>
  );
}

// ── Objects and excerpts ────────────────────────────────────────────────

import { BookOpen01, FileAttachment04, LinkExternal01, Mail01, Microphone01 } from "@untitledui/icons";
import type { ObjectType, Excerpt as ExcerptT } from "./data";
import { objectTypes } from "./data";

function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path fill="#fff" d="M7.1 9.6h2.4V17H7.1zM8.3 5.9a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM11 9.6h2.3v1h.03c.32-.6 1.1-1.24 2.27-1.24 2.43 0 2.88 1.6 2.88 3.68V17h-2.4v-3.5c0-.84-.02-1.92-1.17-1.92-1.17 0-1.35.92-1.35 1.86V17H11z" />
    </svg>
  );
}

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="currentColor" />
      <path fill="var(--color-bg-primary)" d="M13.35 10.9 18.6 5h-1.25l-4.56 5.12L9.15 5H5l5.5 7.84L5 19h1.25l4.8-5.4L14.9 19H19zm-1.7 1.91-.56-.78-4.43-6.12h1.9l3.58 4.94.56.78 4.65 6.43h-1.9z" />
    </svg>
  );
}

/** Identifying icon per object type: blog, newsletter, and each network's own mark. */
export function TypeIcon({ type, className = "size-4" }: { type: ObjectType; className?: string }) {
  if (type === "linkedin") return <LinkedInMark className={cx("shrink-0", className)} />;
  if (type === "x") return <XMark className={cx("shrink-0 text-primary", className)} />;
  const Icon = type === "newsletter" ? Mail01 : BookOpen01;
  return <Icon className={cx("shrink-0 text-tertiary", className)} />;
}

export function TypeLabel({ type }: { type: ObjectType }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-tertiary">
      <TypeIcon type={type} className="size-3.5" />
      {objectTypes[type].label}
    </span>
  );
}

export function SourceIcon({ kind, className = "size-3.5" }: { kind: "call" | "doc"; className?: string }) {
  const Icon = kind === "call" ? Microphone01 : FileAttachment04;
  return <Icon className={cx("shrink-0 text-tertiary", className)} />;
}

/** A link to the original. Prototype: shows where it goes instead of going. */
export function OriginalLink({ url, label = "Open the original" }: { url: string; label?: string }) {
  return (
    <a
      href={"https://" + url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.preventDefault()}
      title={url}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-secondary hover:underline"
    >
      {label}
      <LinkExternal01 className="size-3" />
    </a>
  );
}

/**
 * A quote with what came before and after, the flagged part marked, and a link
 * to the original. `replace` turns it into a proposed fix.
 */
export function Excerpt({
  excerpt,
  head,
  mark = "bad",
  replace,
}: {
  excerpt: ExcerptT;
  head: React.ReactNode;
  mark?: "bad" | "neutral";
  replace?: string;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-tertiary">{head}</span>
        <OriginalLink url={excerpt.url} />
      </figcaption>
      <blockquote className="rounded-lg bg-secondary px-3 py-2.5 text-sm leading-relaxed text-tertiary">
        {excerpt.before && <span>…{excerpt.before}</span>}
        {replace !== undefined ? (
          <>
            <del className="rounded bg-error-primary px-0.5 text-error-primary decoration-1">{excerpt.text}</del>{" "}
            <ins className="rounded bg-success-primary px-0.5 text-success-primary no-underline">{replace}</ins>
          </>
        ) : (
          <mark
            className={cx(
              "rounded px-0.5 text-primary",
              mark === "bad" ? "bg-error-primary ring-1 ring-inset ring-error_subtle" : "bg-primary ring-1 ring-inset ring-secondary",
            )}
          >
            {excerpt.text}
          </mark>
        )}
        {excerpt.after && <span>{excerpt.after}{/[.!?]$/.test(excerpt.after.trim()) ? "" : "…"}</span>}
      </blockquote>
      <div className="text-xs text-quaternary">{excerpt.at}</div>
    </figure>
  );
}
