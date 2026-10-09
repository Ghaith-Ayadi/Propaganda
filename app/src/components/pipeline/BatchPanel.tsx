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
import { userMessage } from "@/lib/errors";
import { closeBatch, currentBatch, nextBatch, requestNextBatch, runBatch, usePipeline } from "@/lib/pipeline/store";
import type { Batch, BatchState, Batching, PipelineItem } from "@/lib/pipeline/types";
import { reportError, track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";

const STATE: Record<BatchState, { label: string; color: "gray" | "brand" | "warning" | "success" }> = {
  closed: { label: "Closed", color: "gray" },
  in_review: { label: "In review", color: "brand" },
  topping_up: { label: "Topping up", color: "warning" },
  pending: { label: "Coming", color: "gray" },
  cancelled: { label: "Cancelled", color: "gray" },
};

const HOW: Record<Batching, string> = { weekly: "weekly", flood: "all at once", live: "each pitch as it's written" };

/**
 * Live: ask the Pitcher for pitches now. It pitches the best ideas waiting;
 * with none waiting it has nothing to send.
 */
export async function askForPitches(): Promise<void> {
  track("batch_run_now", { batch: "next" });
  try {
    const why = await requestNextBatch();
    toast.add(
      why
        ? { type: "error", title: "The Pitcher didn't start", description: `The worker says ${why}.` }
        : { type: "success", title: "The Pitcher is on it.", description: "Its pitches show up here as it writes them." },
    );
  } catch (err) {
    reportError("pipeline.requestNextBatch", err);
    toast.add({ type: "error", title: "Couldn't ask the Pitcher", description: userMessage(err) });
  }
}

export function BatchButton() {
  const { batches, placeholder, loading } = usePipeline();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = currentBatch(batches);
  if (loading) return null;
  if (!batches.length) {
    if (placeholder) return null;
    return (
      <Button
        size="sm"
        color="secondary"
        iconLeading={Layers}
        isLoading={busy}
        onClick={() => {
          setBusy(true);
          void askForPitches().finally(() => setBusy(false));
        }}
      >
        Ask for pitches
      </Button>
    );
  }
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
  const { batches, items, settings, placeholder } = usePipeline();
  const next = nextBatch(batches);
  const [busy, setBusy] = useState(false);

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
                {settings.quarter}, {HOW[settings.batching]}. What you approve, reject and note in a batch shapes the next one.
                Change it in Goals.
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
          {!placeholder && (
            <div className="mt-auto flex flex-col gap-2 border-t border-secondary px-6 py-5">
              <Button
                size="sm"
                color="secondary"
                className="self-start"
                isLoading={busy}
                onClick={() => {
                  setBusy(true);
                  void askForPitches().finally(() => {
                    setBusy(false);
                    onClose();
                  });
                }}
              >
                Send the next batch now
              </Button>
              <p className="text-sm text-tertiary">The Pitcher pitches the best ideas waiting, without waiting for the next batch's day.</p>
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
