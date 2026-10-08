// Content batches: the quarter's planned list always comes in batches, on the
// tenant's cadence (Weekly or Flood, lib/goals/batching.ts), and is published
// across the whole quarter. Bonus posts sit on top of the plan.

import { useState } from "react";
import { ChevronDown, ChevronRight, FastForward } from "@untitledui/icons";
import type { BatchBriefState, BatchCadence, BatchPlan, ContentBatch } from "@/lib/goals/types";
import { CADENCE_COPY, CADENCE_RATIONALE } from "@/lib/goals/batching";
import { goalsActions } from "@/lib/goals/useGoals";
import { Button } from "@/components/base/buttons/button";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { toast } from "@/components/base/toast/toast";
import { reportError } from "@/lib/telemetry";
import { BATCH_RULE, ZERO_OPPORTUNISTIC } from "@/lib/goals/copy";
import { quarterLabel, shortDate } from "@/lib/goals/quarter";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Card } from "./bits";
import { cx } from "@/utils/cx";

const STATE: Record<ContentBatch["state"], { label: string; color: "gray" | "brand" | "success" }> = {
  pending: { label: "Not yet", color: "gray" },
  in_review: { label: "In review", color: "brand" },
  decided: { label: "Decided", color: "success" },
};

const BRIEF: Record<BatchBriefState, { label: string; color: "gray" | "blue" | "orange" | "purple" | "success" | "error" }> = {
  brief: { label: "Brief to review", color: "gray" },
  approved: { label: "Being written", color: "blue" },
  drafted: { label: "Draft to review", color: "orange" },
  scheduled: { label: "Scheduled", color: "purple" },
  published: { label: "Published", color: "success" },
  rejected: { label: "Rejected", color: "error" },
};

/** One line for the Goals page: "Q4: 18 posts in 5 batches. Batch 2 of 5 in review; all written by 14 Nov." */
export function batchSummary(plan: BatchPlan): string {
  const n = plan.batches.length;
  const current = plan.batches.find((b) => b.state === "in_review");
  const next = plan.batches.find((b) => b.state === "pending");
  const where = current
    ? `Batch ${current.number} of ${n} in review`
    : next
      ? `Batch ${next.number} of ${n} arrives ${shortDate(next.dueAt)}`
      : "Every batch decided";
  const how = plan.cadence === "flood" ? "Flood" : "weekly";
  return `${quarterLabel(plan.quarter).split(" ")[0]}: ${plan.planned} posts in ${n} ${n === 1 ? "batch" : "batches"} (${how}). ${where}; all written by ${shortDate(plan.allWrittenBy)}.`;
}

export function BatchesView({ plan }: { plan: BatchPlan }) {
  const current = plan.batches.find((b) => b.state === "in_review") ?? plan.batches.find((b) => b.state === "pending");
  return (
    <div className="space-y-4">
      <Card title="Content batches" subtitle={batchSummary(plan)}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {plan.bonus.count > 0 && (
            <Badge type="pill-color" color="brand" size="sm">
              +{plan.bonus.count} bonus {plan.bonus.count === 1 ? "post" : "posts"} ({[...new Set(plan.bonus.sources)].join(", ")})
            </Badge>
          )}
          {plan.pushedToNext > 0 && (
            <span className="text-tertiary">
              {plan.pushedToNext} planned {plan.pushedToNext === 1 ? "post" : "posts"} moved to next quarter to make room.
            </span>
          )}
        </div>
        <p className="mt-3 text-sm text-tertiary">{ZERO_OPPORTUNISTIC}</p>
        <BatchStrip batches={plan.batches} />
      </Card>
      <BatchingCard plan={plan} />
      {plan.batches.map((b) => (
        <BatchCard key={b.id} batch={b} defaultOpen={b.id === current?.id} total={plan.batches.length} />
      ))}
    </div>
  );
}

/** The Batching setting: Weekly (recommended) or Flood, plus "next batch now". */
function BatchingCard({ plan }: { plan: BatchPlan }) {
  const [switchTo, setSwitchTo] = useState<BatchCadence | null>(null);
  const [busy, setBusy] = useState(false);
  const next = plan.batches.find((b) => b.state === "pending");

  const apply = async (c: BatchCadence) => {
    setBusy(true);
    try {
      await goalsActions.setBatchCadence(c);
      setSwitchTo(null);
      toast.add({ type: "success", title: `Batching: ${CADENCE_COPY[c].label}`, description: c === "flood" ? "Everything left comes in one batch tomorrow morning." : "What's left comes weekly from tomorrow." });
    } catch (err) {
      reportError("goals.setBatchCadence", err);
      toast.add({ type: "error", title: "Couldn't change batching", description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  const bringForward = async () => {
    setBusy(true);
    try {
      const n = await goalsActions.requestNextBatch(plan.quarter);
      toast.add(n ? { type: "success", title: `Batch ${n} is on its way`, description: "Its briefs are in your inbox now." } : { type: "error", title: "Every batch is already out" });
    } catch (err) {
      reportError("goals.requestNextBatch", err);
      toast.add({ type: "error", title: "Couldn't get the next batch", description: "Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Batching"
      subtitle={BATCH_RULE}
      aside={
        <Button size="sm" color="secondary" iconLeading={FastForward} isDisabled={!next || busy} onClick={() => void bringForward()}>
          {next ? `Get batch ${next.number} now` : "Every batch is out"}
        </Button>
      }
    >
      <ButtonGroup
        size="sm"
        selectedKeys={[switchTo ?? plan.cadence]}
        disallowEmptySelection
        aria-label="Batching cadence"
        onSelectionChange={(keys) => {
          const c = [...keys][0] as BatchCadence | undefined;
          if (c) setSwitchTo(c === plan.cadence ? null : c);
        }}
      >
        <ButtonGroupItem id="weekly">Weekly (recommended)</ButtonGroupItem>
        <ButtonGroupItem id="flood">Flood</ButtonGroupItem>
      </ButtonGroup>
      <p className="mt-2 text-sm text-tertiary">{CADENCE_COPY[switchTo ?? plan.cadence].hint}</p>

      {switchTo && (
        <div className="mt-4 rounded-xl bg-secondary p-4">
          <p className="text-sm font-semibold text-secondary">Before you switch to {CADENCE_COPY[switchTo].label}</p>
          <p className="mt-1 text-sm text-secondary">{CADENCE_RATIONALE}</p>
          <p className="mt-1 text-sm text-tertiary">Batches already in your inbox stay as they are; only what hasn't arrived is re-batched.</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" color="secondary" isDisabled={busy} onClick={() => setSwitchTo(null)}>
              Keep {CADENCE_COPY[plan.cadence].label}
            </Button>
            <Button size="sm" color="primary" isDisabled={busy} isLoading={busy} onClick={() => void apply(switchTo)}>
              Switch to {CADENCE_COPY[switchTo].label}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** The batches as a row of blocks: decided, in review, waiting. */
function BatchStrip({ batches }: { batches: ContentBatch[] }) {
  return (
    <ol className="mt-5 flex gap-1.5" aria-label="Batches">
      {batches.map((b) => (
        <li key={b.id} className="min-w-0 flex-1">
          <div
            className={cx(
              "h-2 rounded-full",
              b.state === "decided" && "bg-fg-success-secondary",
              b.state === "in_review" && "bg-brand-solid",
              b.state === "pending" && "bg-quaternary",
            )}
          />
          <p className="mt-1.5 truncate text-xs text-tertiary">
            {b.number}
            {b.launch ? " · Launch" : ""} · {shortDate(b.dueAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function BatchCard({ batch, defaultOpen, total }: { batch: ContentBatch; defaultOpen: boolean; total: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const s = STATE[batch.state];
  const decided = batch.briefs.filter((b) => b.state !== "brief").length;
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary ring-inset">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <Icon className="size-4 shrink-0 text-fg-quaternary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-primary">
            Batch {batch.number} of {total}
            {batch.launch && <span className="font-normal text-tertiary"> · Launch</span>}
          </span>
          <span className="block text-sm text-tertiary">
            {batch.state === "pending" ? `Arrives ${shortDate(batch.dueAt)}, or now if you ask for it` : `Landed ${shortDate(batch.dueAt)} · ${decided} of ${batch.briefs.length} briefs decided`}
          </span>
        </span>
        <BadgeWithDot type="pill-color" color={s.color} size="sm">
          {s.label}
        </BadgeWithDot>
      </button>
      {open && (
        <ul className="divide-y divide-secondary border-t border-secondary">
          {batch.briefs.map((b) => (
            <li key={b.id} className="flex flex-col gap-1 px-5 py-3 md:flex-row md:items-center md:gap-4">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-primary">{b.title}</span>
                <span className="block text-xs text-tertiary">
                  {b.topic} · {b.origin === "internal" ? "from your knowledge" : "from outside demand"}
                  {b.publishOn && b.state !== "rejected" ? ` · publishes ${shortDate(b.publishOn)}` : ""}
                </span>
              </span>
              <Badge type="pill-color" color={BRIEF[b.state].color} size="sm">
                {BRIEF[b.state].label}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
