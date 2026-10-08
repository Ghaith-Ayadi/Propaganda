// Small pieces every knowledge base screen shares: status and tier badges, a
// quote in its whole paragraph, a fix shown as a diff, a Guardian ruling with
// its checks, the sample-data notice and a plain text area.

import type { ReactNode } from "react";
import { TextArea as AriaTextArea, TextField as AriaTextField, Label as AriaLabel } from "react-aria-components";
import { AlertTriangle, CheckCircle, Database01, LinkExternal01, MinusCircle, ShieldTick, XCircle } from "@untitledui/icons";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Card, CardBody, CardHeader } from "@/components/shell/Card";
import { cx } from "@/utils/cx";
import type {
  CheckLine,
  CheckResult,
  ClaimStatus,
  Decision,
  FixPreview,
  FlagStatus,
  Letter,
  RelationKind,
  Reliance,
  Severity,
  SourceKind,
  SuggestedAction,
  Tier,
  Verdict,
} from "@/lib/knowledge/types";

// ---- labels (the words people see; never "canon", "Record" or "ledger") ----

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  settled: "Settled",
  contested: "Contested",
  superseded: "Superseded",
  retracted: "Retracted",
};

const STATUS_COLOR: Record<ClaimStatus, "success" | "warning" | "gray" | "error"> = {
  settled: "success",
  contested: "warning",
  superseded: "gray",
  retracted: "error",
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <BadgeWithDot type="pill-color" size="sm" color={STATUS_COLOR[status]}>
      {STATUS_LABEL[status]}
    </BadgeWithDot>
  );
}

export function ConflictBadge() {
  return (
    <Badge type="pill-color" size="sm" color="error">
      In a contradiction
    </Badge>
  );
}

/** Tiers as the Guardian's policy ranks them (1 strongest). */
export const TIER_LABEL: Record<Tier, string> = {
  1: "A person's word",
  2: "Owner's document or call",
  3: "Document, call or Slack",
  4: "Chat",
  5: "Published post",
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  person: "Remember",
  document: "Document",
  call: "Call",
  slack: "Slack",
  chat: "Chat",
  post: "Post",
  signal: "Search data",
};

export function TierBadge({ tier }: { tier: Tier }) {
  const color = tier <= 2 ? "brand" : tier === 3 ? "blue" : "gray";
  return (
    <Badge type="color" size="sm" color={color}>
      Tier {tier} · {TIER_LABEL[tier]}
    </Badge>
  );
}

export const RELATION_LABEL: Record<RelationKind, { out: string; in: string }> = {
  supersedes: { out: "Replaces", in: "Replaced by" },
  contradicts: { out: "Contradicts", in: "Contradicted by" },
  refines: { out: "Refines", in: "Refined by" },
  depends_on: { out: "Depends on", in: "Needed by" },
};

export const RELIANCE_LABEL: Record<Reliance, string> = {
  asserts: "Says it",
  assumes: "Assumes it",
  mentions: "Mentions it",
};

export const FLAG_STATUS_LABEL: Record<FlagStatus, string> = {
  open: "Open",
  snoozed: "Snoozed",
  fixed: "Fixed",
  reconciled: "Reconciled",
  wont_fix: "Won't fix",
  retracted: "Taken down",
  cant_fix: "Can't be fixed",
  duplicate: "Duplicate",
  cleared: "Still holds",
};

const FLAG_STATUS_COLOR: Record<FlagStatus, "gray" | "warning" | "success" | "error" | "blue"> = {
  open: "warning",
  snoozed: "gray",
  fixed: "success",
  reconciled: "success",
  wont_fix: "error",
  retracted: "gray",
  cant_fix: "gray",
  duplicate: "gray",
  cleared: "success",
};

export function FlagStatusBadge({ status }: { status: FlagStatus }) {
  return (
    <BadgeWithDot type="pill-color" size="sm" color={FLAG_STATUS_COLOR[status]}>
      {FLAG_STATUS_LABEL[status]}
    </BadgeWithDot>
  );
}

export const ACTION_LABEL: Record<SuggestedAction, string> = {
  "": "No suggestion",
  leave: "Leave as is",
  edit_wording: "Edit the wording",
  rewrite: "Rewrite",
  dated_note: "Add a dated note",
  unpublish: "Unpublish",
};

export function ActionBadge({ action }: { action: SuggestedAction }) {
  const color = action === "rewrite" || action === "unpublish" ? "orange" : action === "leave" ? "gray" : "blue";
  return (
    <Badge type="color" size="sm" color={color}>
      {ACTION_LABEL[action]}
    </Badge>
  );
}

const SEVERITY_LABEL: Record<Exclude<Severity, "">, string> = {
  patch: "Patch: wording only",
  minor: "Minor: re-checks advisory",
  major: "Major: re-checks required",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  if (!severity) return null;
  return (
    <Badge type="pill-color" size="sm" color={severity === "major" ? "error" : severity === "minor" ? "warning" : "gray"}>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

// ---- a Guardian ruling ----

const VERDICT: Record<Verdict, { label: string; color: "success" | "warning" | "error" | "purple" }> = {
  admit: { label: "Admitted", color: "success" },
  admit_contested: { label: "Admitted as contested", color: "warning" },
  reject: { label: "Rejected", color: "error" },
  escalate: { label: "Sent to the owner", color: "purple" },
};

const CHECK_ICON: Record<CheckResult, { icon: typeof CheckCircle; className: string; label: string }> = {
  pass: { icon: CheckCircle, className: "text-success-primary", label: "Pass" },
  weak: { icon: MinusCircle, className: "text-warning-primary", label: "Weak" },
  fail: { icon: XCircle, className: "text-error-primary", label: "Fail" },
  escalate: { icon: AlertTriangle, className: "text-brand-secondary", label: "Escalate" },
};

/** The Guardian's checks, listed like a pull request's CI checks. */
export function CheckList({ checks }: { checks: CheckLine[] }) {
  if (!checks.length) return null;
  return (
    <ul className="divide-y divide-secondary rounded-lg ring-1 ring-secondary">
      {checks.map((c, i) => {
        const meta = CHECK_ICON[c.result];
        const Icon = meta.icon;
        return (
          <li key={i} className="flex items-start gap-2.5 px-3 py-2 text-sm">
            <Icon className={cx("mt-0.5 size-4 shrink-0", meta.className)} aria-label={meta.label} />
            <span className="w-8 shrink-0 font-mono text-xs leading-5 text-tertiary">{c.check}</span>
            <span className="text-secondary">{c.reason}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function DecisionCard({ decision, title = "The Guardian" }: { decision: Decision; title?: string }) {
  const v = VERDICT[decision.verdict];
  const who =
    decision.decidedBy.kind === "person"
      ? `Ruled by ${decision.decidedBy.person.name}`
      : `Guardian${decision.decidedBy.policyVersion ? `, rules v${decision.decidedBy.policyVersion}` : ""}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldTick className="size-4 text-tertiary" />
        <span className="text-sm font-medium text-primary">{title}</span>
        <Badge type="pill-color" size="sm" color={v.color}>
          {v.label}
        </Badge>
        <SeverityBadge severity={decision.severity} />
        <span className="text-xs text-quaternary">
          {who} · {formatDate(decision.created)}
        </span>
      </div>
      <p className="text-sm text-secondary">{decision.argument}</p>
      <CheckList checks={decision.checks} />
    </div>
  );
}

// ---- quotes and fixes ----

/** A quote with the text around it: the context muted, the quote marked. */
export function QuoteInContext({
  before,
  quote,
  after,
  tone = "neutral",
}: {
  before: string;
  quote: string;
  after: string;
  tone?: "neutral" | "error";
}) {
  return (
    <blockquote className="rounded-lg bg-secondary px-4 py-3 text-sm leading-6 text-tertiary">
      {before}
      <mark
        className={cx(
          "rounded-sm bg-transparent px-0.5 text-primary ring-1",
          tone === "error" ? "ring-error_subtle decoration-error underline decoration-1 underline-offset-4" : "ring-primary",
        )}
      >
        {quote}
      </mark>
      {after}
    </blockquote>
  );
}

export function FixDiff({ fix }: { fix: FixPreview }) {
  return (
    <div className="rounded-lg bg-secondary px-4 py-3 text-sm leading-6 text-tertiary">
      {fix.before}
      {fix.removed && <del className="text-error-primary decoration-1">{fix.removed}</del>}{" "}
      {fix.added && <ins className="text-success-primary no-underline">{fix.added}</ins>}
      {fix.after}
    </div>
  );
}

export function OriginalLink({ href, label = "Open the original" }: { href: string; label?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-tertiary hover:text-secondary">
      {label}
      <LinkExternal01 className="size-3.5" />
    </a>
  );
}

// ---- grades ----

export function LetterGrade({ letter, size = "lg" }: { letter: Letter; size?: "sm" | "lg" }) {
  const tone =
    letter === "A"
      ? "bg-success-primary text-success-primary"
      : letter === "B"
        ? "bg-brand-primary text-brand-secondary"
        : letter === "C"
          ? "bg-warning-primary text-warning-primary"
          : "bg-error-primary text-error-primary";
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-xl font-medium",
        size === "lg" ? "size-16 type-figure" : "size-8 text-sm",
        tone,
      )}
      aria-label={`Grade ${letter}`}
    >
      {letter}
    </span>
  );
}

// ---- page furniture ----

export function SampleNotice() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl bg-secondary px-4 py-3 text-sm ring-1 ring-secondary">
      <Database01 className="mt-0.5 size-4 shrink-0 text-tertiary" />
      <p className="text-tertiary">
        <span className="font-medium text-secondary">Sample data.</span> The knowledge base isn't switched on for this tenant
        yet, so these pages show a made-up clinic-software tenant. Nothing you do here touches your posts.
      </p>
    </div>
  );
}

/** The shared card (components/shell/Card) with an optional header. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      {title && <CardHeader title={title} description={description} actions={actions} />}
      {children && <CardBody className={bodyClassName}>{children}</CardBody>}
    </Card>
  );
}

/** Only high urgency shows. */
export function UrgentBadge() {
  return (
    <Badge type="pill-color" size="sm" color="error">
      Urgent
    </Badge>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="type-eyebrow text-quaternary">{children}</h3>
      {right}
    </div>
  );
}

export function Loading() {
  return <div className="py-16 text-center text-sm text-quaternary">Loading…</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-secondary px-6 py-12 text-center">
      <p className="text-sm font-medium text-secondary">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-tertiary">{children}</div>}
    </div>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  autoFocus,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  hint?: ReactNode;
}) {
  return (
    <AriaTextField value={value} onChange={onChange} autoFocus={autoFocus} className="flex flex-col gap-1.5">
      <AriaLabel className="text-sm font-medium text-secondary">{label}</AriaLabel>
      <AriaTextArea
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-sm text-primary shadow-xs ring-1 ring-primary outline-hidden ring-inset placeholder:text-placeholder focus:ring-2 focus:ring-brand"
      />
      {hint && <div className="text-sm text-tertiary">{hint}</div>}
    </AriaTextField>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(1).replace(/\.0$/, "")}%`;
}
