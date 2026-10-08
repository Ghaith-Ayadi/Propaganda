// Small shared pieces of the Goals pages.

import type { ReactNode } from "react";
import { InfoCircle } from "@untitledui/icons";
import { NativeSelect } from "@/components/base/select/select-native";
import { AUTHORITY_EXPLAINER } from "@/lib/goals/copy";
import { goalsArePlaceholder } from "@/lib/goals/useGoals";
import { SCENARIOS, placeholderScenario, setPlaceholderScenario, type ScenarioId } from "@/lib/goals/placeholder";
import type { PlanOrigin } from "@/lib/goals/types";
import { Badge } from "@/components/base/badges/badges";
import { Card as ShellCard, CardBody, CardFooter, CardHeader } from "@/components/shell/Card";
import { cx } from "@/utils/cx";

/**
 * A Goals card on the shell's shared card (components/shell/Card.tsx): header
 * with an edge-to-edge divider (title 16, description 14), body, optional footer.
 */
export function Card({
  title,
  subtitle,
  aside,
  icon,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <ShellCard className={className}>
      {(title || aside) && <CardHeader title={title} description={subtitle} actions={aside} icon={icon} />}
      {children != null && <CardBody className="py-5">{children}</CardBody>}
      {footer && <CardFooter>{footer}</CardFooter>}
    </ShellCard>
  );
}

/** A big number with its unit: "9 of 18". */
export function Headline({ value, unit, className }: { value: ReactNode; unit?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-baseline gap-2", className)}>
      <span className="type-figure text-primary">{value}</span>
      {unit && <span className="text-sm text-tertiary">{unit}</span>}
    </div>
  );
}

/** "Why" in ink, "based on" in grey: every number the Strategist proposes carries both. */
export function Reason({ why, basis, origin, planSaid }: { why: string; basis?: string; origin?: PlanOrigin; planSaid?: string }) {
  return (
    <div className="mt-1.5 space-y-0.5 text-sm">
      <p className="text-secondary">{why}</p>
      {(basis || origin) && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-quaternary">
          {origin && <OriginBadge origin={origin} />}
          {planSaid && <span>Your plan said {planSaid}.</span>}
          {basis && <span>Based on: {basis}</span>}
        </p>
      )}
    </div>
  );
}

const ORIGIN_LABEL: Record<PlanOrigin, { label: string; color: "brand" | "warning" | "gray" }> = {
  plan: { label: "From your plan", color: "brand" },
  plan_changed: { label: "From your plan, changed", color: "warning" },
  added: { label: "Added", color: "gray" },
};

export function OriginBadge({ origin }: { origin: PlanOrigin }) {
  const o = ORIGIN_LABEL[origin];
  return (
    <Badge type="pill-color" color={o.color} size="sm">
      {o.label}
    </Badge>
  );
}

/** Why a new blog ranks slowly. Same words on the Launch card, Goals and the proposal. */
export function AuthorityExplainer({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cx("rounded-xl bg-secondary p-4 text-sm", compact && "p-3")}>
      <p className="mb-1.5 flex items-center gap-1.5 font-medium text-secondary">
        <InfoCircle className="size-4 text-fg-quaternary" aria-hidden />
        Why rankings take a while
      </p>
      <ul className="space-y-1 text-tertiary">
        {AUTHORITY_EXPLAINER.map((l) => (
          // Help center articles come before GA; the slug is kept so the link lands then.
          <li key={l.helpSlug} data-help={l.helpSlug}>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Says the page shows sample data, and lets you switch the sample tenant's situation. */
export function PlaceholderBanner() {
  if (!goalsArePlaceholder) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl bg-warning-primary p-3 text-sm ring-1 ring-secondary ring-inset md:flex-row md:items-center md:justify-between">
      <p className="text-warning-primary">
        <span className="font-medium">Sample data.</span> The goal tables don't exist yet; this is a made-up tenant. Nothing you do here is saved.
      </p>
      <NativeSelect
        size="sm"
        aria-label="Sample situation"
        className="md:w-72"
        value={placeholderScenario()}
        onChange={(e) => setPlaceholderScenario(e.target.value as ScenarioId)}
        options={SCENARIOS.map((s) => ({ value: s.id, label: s.label }))}
      />
    </div>
  );
}

/** `pitched` draws a lighter bar behind `value`: what was offered, behind what's done. */
export function ProgressBar({ value, max, marker, pitched, className }: { value: number; max: number; marker?: number; pitched?: number; className?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const pw = pitched != null && max > 0 ? Math.min(100, (pitched / max) * 100) : 0;
  const m = marker != null && max > 0 ? Math.min(100, (marker / max) * 100) : null;
  return (
    <div className={cx("relative h-2 rounded-full bg-quaternary", className)}>
      {pw > 0 && <div className="absolute inset-y-0 left-0 rounded-full bg-fg-quaternary" style={{ width: `${pw}%` }} />}
      <div className="relative h-2 rounded-full bg-fg-primary" style={{ width: `${w}%` }} />
      {m != null && <div className="absolute -top-1 h-4 w-0.5 rounded bg-fg-primary" style={{ left: `calc(${m}% - 1px)` }} aria-hidden />}
    </div>
  );
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}
