// The batch indicator in the pipeline header ("Batch 2 of 5") and its side
// panel: what each batch of the quarter brought or will bring, with "Run now"
// on the next one. Rules: agents/strategist-cold-start-and-pacing.md (quotas
// count approved briefs; a short batch is topped up the next day).

import { useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { LayersThree01 as Layers } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { toast } from "@/components/base/toast/toast";
import { shortDate } from "@/lib/pipeline/dates";
import { closeBatch, currentBatch, nextBatch, runBatch, usePipeline } from "@/lib/pipeline/store";
import type { Batch, BatchState, PipelineItem } from "@/lib/pipeline/types";
import { track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";

const STATE: Record<BatchState, { label: string; color: "gray" | "brand" | "warning" | "success" }> = {
  closed: { label: "Closed", color: "gray" },
  in_review: { label: "In review", color: "brand" },
  topping_up: { label: "Topping up", color: "warning" },
  pending: { label: "Coming", color: "gray" },
  cancelled: { label: "Cancelled", color: "gray" },
};

export function BatchButton() {
  const { batches } = usePipeline();
  const [open, setOpen] = useState(false);
  const now = currentBatch(batches);
  if (!batches.length) return null;
  return (
    <>
      <Button size="sm" color="secondary" iconLeading={Layers} onClick={() => setOpen(true)}>
        Batch {now?.number ?? 1} of {batches.length}
      </Button>
      {open && <BatchPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function tally(items: PipelineItem[], n: number) {
  const mine = items.filter((i) => i.batch === n);
  return {
    pitched: mine.length,
    approved: mine.filter((i) => i.stage !== "pitched" && i.stage !== "rejected" && i.stage !== "not_now").length,
    rejected: mine.filter((i) => i.stage === "rejected").length,
    later: mine.filter((i) => i.stage === "not_now").length,
    waiting: mine.filter((i) => i.stage === "pitched").length,
  };
}

function BatchPanel({ onClose }: { onClose: () => void }) {
  const { batches, items, settings } = usePipeline();
  const next = nextBatch(batches);

  const run = (b: Batch) => {
    runBatch(b.number);
    const count = items.filter((i) => i.batch === b.number && i.stage === "pitched").length;
    track("batch_run_now", { batch: b.number });
    toast.add({
      type: "success",
      title: `Batch ${b.number} is on the board.`,
      description: count ? `${count} ${count === 1 ? "pitch is" : "pitches are"} waiting on you.` : "Its pitches arrive as the Pitcher writes them.",
    });
    onClose();
  };

  const close = (b: Batch) => {
    closeBatch(b.number);
    track("batch_closed", { batch: b.number });
    toast.add({ title: `Batch ${b.number} closed.`, description: "Its open pitches stay on the board." });
  };

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(o) => !o && onClose()}
      className="fixed inset-0 z-50 bg-overlay/40 duration-150 entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out"
    >
      <Modal className="fixed inset-y-0 right-0 flex w-full max-w-[480px] duration-200 entering:animate-in entering:slide-in-from-right">
        <Dialog aria-label="Batches" className="flex h-full w-full flex-col overflow-y-auto bg-primary shadow-xl outline-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-secondary px-6 py-5">
            <div>
              <h2 className="type-title text-primary">Batches</h2>
              <p className="mt-1 text-sm text-tertiary">
                {settings.quarter}, {settings.batching === "weekly" ? "weekly" : "all at once"}. What you approve, reject and note in a
                batch shapes the next one.
              </p>
            </div>
            <CloseButton size="md" label="Close" onPress={onClose} className="-mt-1 -mr-2" />
          </div>
          <ol className="flex flex-col gap-3 p-6">
            {batches.map((b) => {
              const t = tally(items, b.number);
              const released = b.state !== "pending" && b.state !== "cancelled";
              return (
                <li
                  key={b.number}
                  className={cx(
                    "rounded-xl p-4 ring-1 ring-inset",
                    b.state === "in_review" || b.state === "topping_up" ? "ring-brand" : "ring-secondary",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="type-heading text-primary">Batch {b.number}</span>
                      <Badge type="pill-color" size="sm" color={STATE[b.state].color}>
                        {STATE[b.state].label}
                      </Badge>
                    </div>
                    <span className="text-sm text-tertiary">
                      {b.releasedAt ? `Out ${shortDate(b.releasedAt)}` : b.expectedOn ? `Expected ${shortDate(b.expectedOn)}` : ""}
                    </span>
                  </div>
                  {released ? (
                    <ul className="mt-3 flex flex-col gap-1 text-sm text-secondary">
                      <li>
                        {t.approved} of {b.quota} approved{t.approved >= b.quota ? ", quota met" : ""}
                      </li>
                      <li className="text-tertiary">
                        {t.pitched} pitched · {t.rejected} rejected{t.later ? ` · ${t.later} not now` : ""}
                        {t.waiting ? ` · ${t.waiting} waiting on you` : ""}
                      </li>
                      {b.topups > 0 && (
                        <li className="text-tertiary">Topped up {b.topups === 1 ? "once" : `${b.topups} times`} after falling short.</li>
                      )}
                      {b.state === "topping_up" && (
                        <li className="text-tertiary">Short of its quota: top-up pitches arrive tomorrow, shaped by your rejections.</li>
                      )}
                      {(b.state === "in_review" || b.state === "topping_up") && (
                        <li className="mt-2 flex items-center gap-2">
                          <Button size="sm" color="secondary" onClick={() => close(b)}>
                            That's enough
                          </Button>
                          <span className="text-tertiary">Closes the batch, with no more top-ups.</span>
                        </li>
                      )}
                    </ul>
                  ) : (
                    <div className="mt-3 text-sm text-secondary">
                      <p>
                        About {b.quota} approved briefs
                        {b.expectedTopics?.length ? ` on ${b.expectedTopics.join(" and ")}` : ""}. The Pitcher sends a few more pitches than
                        that and reads your decisions on the batches before it.
                      </p>
                      {next?.number === b.number && (
                        <Button size="sm" color="primary" className="mt-3" onClick={() => run(b)}>
                          Run now
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
