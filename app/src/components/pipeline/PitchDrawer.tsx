// The pitch brief, over the board (#/pipeline/pitch/<id>). Approve as is,
// approve with notes (general, or on an outline line), or reject with a reason.
// Approving hands off to the editor: a draft post and its brief are created.

import { useEffect, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Check, LinkExternal01, MessagePlusSquare, Minus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { NativeSelect } from "@/components/base/select/select-native";
import { toast } from "@/components/base/toast/toast";
import { go, goPage } from "@/lib/route";
import { shortDate } from "@/lib/pipeline/dates";
import { approvePitch, notNowPitch, personById, rejectPitch, usePipeline } from "@/lib/pipeline/store";
import { GOAL_LABEL, ORIGIN_LABEL, STAGE_LABEL, type GoalKey, type PipelineItem, type PitchNote, type ReasonKind } from "@/lib/pipeline/types";
import { reportError, track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { Card, CardBody, CardHeader } from "@/components/shell/Card";
import { FitBadge, TextArea } from "./bits";

const REASON_LABEL: Record<ReasonKind, string> = {
  demand: "Demand",
  mix: "Mix",
  cadence: "Cadence",
  timeliness: "Timeliness",
  gap: "Gap",
  duplicate: "Overlap",
};

const GOALS: GoalKey[] = ["volume", "consistency", "readership", "ranking"];

export function PitchDrawer({ id }: { id: string }) {
  const { items, people, settings } = usePipeline();
  const item = items.find((i) => i.id === id);
  const close = () => goPage("pipeline");

  useEffect(() => {
    if (items.length && !item) {
      toast.add({ title: "That pitch isn't here anymore" });
      close();
    }
  }, [items.length, item]);

  if (!item) return null;

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => !open && close()}
      className="fixed inset-0 z-50 bg-overlay/40 duration-150 entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out"
    >
      <Modal className="fixed inset-y-0 right-0 flex w-full max-w-[640px] duration-200 entering:animate-in entering:slide-in-from-right exiting:animate-out exiting:slide-out-to-right">
        <Dialog aria-label={item.title} className="flex h-full w-full flex-col bg-primary shadow-xl outline-hidden">
          <PitchBody key={item.id} item={item} people={people} meId={settings.meId} onClose={close} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function PitchBody({
  item,
  people,
  meId,
  onClose,
}: {
  item: PipelineItem;
  people: ReturnType<typeof usePipeline>["people"];
  meId: string;
  onClose: () => void;
}) {
  const decidable = item.stage === "pitched";
  const [writerId, setWriterId] = useState(item.writerId);
  const [reviewerId, setReviewerId] = useState(item.reviewerId);
  const [publishBy, setPublishBy] = useState(item.publishBy);
  const [lineNotes, setLineNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.notes.filter((n) => n.lineId).map((n) => [n.lineId!, n.text])),
  );
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [generalNote, setGeneralNote] = useState(item.notes.find((n) => n.lineId === null)?.text ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const notes: PitchNote[] = [
    ...(generalNote.trim() ? [{ lineId: null, text: generalNote.trim() }] : []),
    ...Object.entries(lineNotes)
      .filter(([, t]) => t.trim())
      .map(([lineId, t]) => ({ lineId, text: t.trim() })),
  ];

  const writerName = personById(people, writerId)?.name ?? "Unassigned";
  const options = people.map((p) => ({ label: p.id === meId ? "You" : p.agent ? "Writer agent" : p.name, value: p.id }));

  const approve = async () => {
    setBusy(true);
    try {
      const postId = await approvePitch(item.id, { writerId, reviewerId, publishBy, notes });
      if (!postId) throw new Error("approvePitch returned no post");
      track("pitch_approved", { with_notes: notes.length > 0, notes: notes.length });
      toast.add({
        type: "success",
        title: `Approved. ${writerId === meId ? "You have" : `${writerName} has`} it, due ${shortDate(publishBy)}.`,
        description: "A draft and its brief are ready in the editor.",
        actionProps: { children: "Open draft", onClick: () => go({ view: "post", id: postId }) },
      });
      onClose();
    } catch (err) {
      reportError("pipeline.approvePitch", err);
      toast.add({ type: "error", title: "Couldn't approve the pitch", description: "Try again in a moment." });
      setBusy(false);
    }
  };

  const notNow = () => {
    notNowPitch(item.id, reason);
    track("pitch_not_now");
    toast.add({ title: "Kept for later. It's off the board for this batch." });
    onClose();
  };

  const reject = () => {
    if (!reason.trim()) return;
    rejectPitch(item.id, reason);
    track("pitch_rejected");
    toast.add({ title: "Rejected. The next pitches will take your reason into account." });
    onClose();
  };

  const nameOf = (id: string) => options.find((o) => o.value === id)?.label ?? "Unassigned";

  return (
    <>
      {/* header: what it is, in one look */}
      <header className="border-b border-secondary px-6 pt-5 pb-6 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-tertiary">
            {item.reasons.length > 0 && <FitBadge reasons={item.reasons} />}
            <span className="truncate">
              {item.batch ? `Batch ${item.batch}` : "Bonus pitch"} · {ORIGIN_LABEL[item.origin]}
            </span>
          </div>
          <CloseButton size="md" onPress={onClose} label="Close" className="-mr-2 shrink-0" />
        </div>
        <h2 className="mt-4 type-title text-primary">{item.title}</h2>
        {item.why && <p className="mt-2 text-sm text-secondary">{item.why}</p>}
        {item.learned && <p className="mt-2 text-sm text-tertiary italic">{item.learned}</p>}
        {!decidable && (
          <p className="mt-4 text-sm font-medium text-primary">
            {STAGE_LABEL[item.stage]}
            {item.rejectReason ? `: ${item.rejectReason}` : ""}
          </p>
        )}
      </header>

      {/* body: one column, one rhythm */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8 px-6 py-6 md:px-8">
          {item.research && (
            <p className="border-l-2 border-secondary pl-3 text-sm text-secondary">
              <span className="font-medium text-primary">Less research than usual. </span>
              {item.research}
            </p>
          )}
          {item.changed && (
            <p className="border-l-2 border-secondary pl-3 text-sm text-secondary">
              <span className="font-medium text-primary">Pitched before. </span>
              {item.changed}
            </p>
          )}

          <Block title="The post">
            <Fields
              rows={[
                ["Angle", item.angle],
                ["Who it's for", item.audience],
                [item.topics.length > 1 ? "Topics" : "Topic", [item.topics.join(", "), item.topicProgress].filter(Boolean).join(" · ")],
                ["Format", [`Blog post in ${item.collection}`, item.length].filter(Boolean).join(", ")],
              ]}
            />
          </Block>

          <Block title="Why now">
            {item.reasons.length ? (
              <Fields rows={item.reasons.map((r) => [REASON_LABEL[r.kind], r.text, !r.counts] as const)} />
            ) : (
              <p className="text-sm text-tertiary">Your idea: no reasons from the Pitcher.</p>
            )}
          </Block>

          <Block title="Goals it moves">
            <ul className="flex flex-col divide-y divide-secondary">
              {GOALS.map((g) => {
                const e = item.goals.find((x) => x.goal === g);
                return (
                  <li key={g} className="flex gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    {e?.moves ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-fg-primary" aria-label="Moves it" />
                    ) : (
                      <Minus className="mt-0.5 size-4 shrink-0 text-fg-quaternary" aria-label="Doesn't move it" />
                    )}
                    <span className={cx("w-28 shrink-0", e?.moves ? "font-medium text-primary" : "text-tertiary")}>{GOAL_LABEL[g]}</span>
                    <span className="text-tertiary">{e?.note}</span>
                  </li>
                );
              })}
            </ul>
          </Block>

          {item.outline.length > 0 && (
            <Block title="Outline" hint={decidable ? "Hover a line to leave a note on it." : undefined}>
              <ol className="flex flex-col">
                {item.outline.map((l, n) => {
                  const note = lineNotes[l.id];
                  const showNote = note !== undefined || openNote === l.id;
                  return (
                    <li key={l.id} className="group -mx-2 rounded-lg px-2 py-1.5 hover:bg-primary_hover">
                      <div className="flex items-start gap-3">
                        <span className="w-4 shrink-0 text-right text-sm text-quaternary tabular-nums">{n + 1}</span>
                        <span className="flex-1 text-sm text-primary">{l.text}</span>
                        {decidable && !showNote && (
                          <button
                            type="button"
                            onClick={() => setOpenNote(l.id)}
                            aria-label={`Add a note on line ${n + 1}`}
                            className="rounded-md p-0.5 text-fg-quaternary transition hover:text-fg-secondary md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                          >
                            <MessagePlusSquare className="size-4" />
                          </button>
                        )}
                      </div>
                      {showNote && (
                        <TextArea
                          autoFocus={openNote === l.id && note === undefined}
                          rows={2}
                          disabled={!decidable}
                          className="mt-2 ml-7 w-[calc(100%-1.75rem)]"
                          placeholder="Your note on this line"
                          value={note ?? ""}
                          onChange={(e) => setLineNotes((m) => ({ ...m, [l.id]: e.target.value }))}
                          onBlur={() => {
                            if (!lineNotes[l.id]?.trim()) {
                              setLineNotes(({ [l.id]: _, ...rest }) => rest);
                              setOpenNote(null);
                            }
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
            </Block>
          )}

          {item.sources.length > 0 && (
            <Block title="Sources">
              <ul className="flex flex-col gap-1.5">
                {item.sources.map((s) => (
                  <li key={s.url} className="flex items-center gap-2 text-sm">
                    <LinkExternal01 className="size-4 shrink-0 text-fg-quaternary" />
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-secondary underline decoration-border-primary underline-offset-4 hover:text-primary">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <Card>
            <CardHeader
              title="Hand-off"
              description={decidable ? "Who writes it, who reviews it, and by when." : `${nameOf(writerId)} writes, ${nameOf(reviewerId)} reviews.`}
            />
            <CardBody className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <NativeSelect label="Writer" size="md" options={options} value={writerId} disabled={!decidable} onChange={(e) => setWriterId(e.target.value)} />
                <NativeSelect label="Reviewer" size="md" options={options} value={reviewerId} disabled={!decidable} onChange={(e) => setReviewerId(e.target.value)} />
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-secondary">Publish by</span>
                  <input
                    type="date"
                    value={publishBy}
                    disabled={!decidable}
                    onChange={(e) => e.target.value && setPublishBy(e.target.value)}
                    className="rounded-lg bg-primary px-3 py-2 text-md text-primary shadow-xs ring-1 ring-primary outline-hidden ring-inset focus:ring-2 focus:ring-brand disabled:opacity-60"
                  />
                </label>
              </div>
              {decidable && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-secondary">
                    Note for the writer <span className="font-normal text-tertiary">(optional)</span>
                  </span>
                  <TextArea rows={2} placeholder="Anything to keep in mind while writing it" value={generalNote} onChange={(e) => setGeneralNote(e.target.value)} />
                </label>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* footer: the decision */}
      {decidable &&
        (rejecting ? (
          <footer className="flex flex-col gap-3 border-t border-secondary px-6 py-4 md:px-8">
            <label htmlFor="reject-reason" className="text-sm font-medium text-primary">
              Why reject it? <span className="font-normal text-tertiary">The Pitcher learns from your reason.</span>
            </label>
            <TextArea
              id="reject-reason"
              autoFocus
              rows={2}
              placeholder="For example: we don't write about competitors' ERPs this quarter."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button size="md" color="tertiary" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
              <Button size="md" color="primary-destructive" isDisabled={!reason.trim()} onClick={reject}>
                Reject pitch
              </Button>
            </div>
          </footer>
        ) : (
          <footer className="flex items-center justify-between gap-3 border-t border-secondary px-6 py-4 md:px-8">
            <div className="flex gap-1">
              <Button size="md" color="tertiary" onClick={() => setRejecting(true)}>
                Reject
              </Button>
              <Button size="md" color="tertiary" onClick={notNow}>
                Not now
              </Button>
            </div>
            <Button size="md" color="primary" isLoading={busy} onClick={() => void approve()}>
              {notes.length ? `Approve with ${notes.length === 1 ? "a note" : `${notes.length} notes`}` : "Approve"}
            </Button>
          </footer>
        ))}
    </>
  );
}

/** A section of the brief: a small heading, then its content. */
function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="type-heading text-primary">{title}</h3>
        {hint && <span className="hidden text-xs text-tertiary md:inline">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** Label and value rows, the label in a fixed column; empty values are left out. */
function Fields({ rows }: { rows: ReadonlyArray<readonly [string, string | undefined, boolean?]> }) {
  return (
    <dl className="flex flex-col divide-y divide-secondary">
      {rows
        .filter(([, v]) => v)
        .map(([k, v, muted], n) => (
          <div key={n} className="grid gap-1 py-2.5 text-sm first:pt-0 last:pb-0 sm:grid-cols-[112px_1fr] sm:gap-4">
            <dt className="text-tertiary">{k}</dt>
            <dd className={muted ? "text-tertiary" : "text-primary"}>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
