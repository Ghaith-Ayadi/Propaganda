// The pitch brief, over the board (#/pipeline/pitch/<id>). Approve as is,
// approve with notes (general, or on an outline line), or reject with a reason.
// Approving hands off to the editor: a draft post and its brief are created.

import { useEffect, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { BookOpen01, Check, MessagePlusSquare, Minus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { NativeSelect } from "@/components/base/select/select-native";
import { toast } from "@/components/base/toast/toast";
import { go, goPage } from "@/lib/route";
import { shortDate } from "@/lib/pipeline/dates";
import { approvePitch, personById, rejectPitch, usePipeline } from "@/lib/pipeline/store";
import { GOAL_LABEL, ORIGIN_LABEL, STAGE_LABEL, type GoalKey, type PipelineItem, type PitchNote, type ReasonKind } from "@/lib/pipeline/types";
import { reportError, track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { Eyebrow, FitBadge, TextArea, TopicBadge } from "./bits";

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
      className="fixed inset-0 z-50 bg-overlay/60 backdrop-blur-[2px] duration-150 entering:animate-in entering:fade-in exiting:animate-out exiting:fade-out"
    >
      <Modal className="fixed inset-y-0 right-0 flex w-full max-w-[720px] duration-200 entering:animate-in entering:slide-in-from-right exiting:animate-out exiting:slide-out-to-right">
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
  const reviewerName = reviewerId === meId ? "you review" : `${personById(people, reviewerId)?.name ?? "nobody"} reviews`;
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

  const reject = () => {
    if (!reason.trim()) return;
    rejectPitch(item.id, reason);
    track("pitch_rejected");
    toast.add({ title: "Rejected. The next pitches will take your reason into account." });
    onClose();
  };

  return (
    <>
      {/* header */}
      <div className="border-b border-secondary px-5 pt-5 pb-5 md:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-tertiary uppercase">Pitch</span>
            <FitBadge reasons={item.reasons} />
            {item.topics.map((t) => (
              <TopicBadge key={t}>{t}</TopicBadge>
            ))}
            <span className="text-sm text-tertiary">{ORIGIN_LABEL[item.origin]}</span>
            {item.batch && <span className="text-sm text-quaternary">· batch {item.batch}</span>}
          </div>
          <CloseButton size="md" onPress={onClose} label="Close" className="-mt-1 -mr-2 shrink-0" />
        </div>
        <h2 className="mt-3 font-title text-3xl text-primary">{item.title}</h2>
        <p className="mt-2 text-md text-tertiary">{item.why}</p>
        {!decidable && (
          <p className="mt-3 text-sm font-medium text-secondary">
            {STAGE_LABEL[item.stage]}
            {item.rejectReason ? `: ${item.rejectReason}` : ""}
          </p>
        )}
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-5 py-6 md:px-8">
        <h3 className="text-md font-semibold text-primary">Why this, why now</h3>
        <dl className="mt-3 flex flex-col gap-1.5">
          {item.reasons.map((r, n) => (
            <div key={n} className="grid grid-cols-[110px_1fr] gap-3 rounded-lg bg-secondary px-4 py-3 text-md">
              <dt className="text-secondary">{REASON_LABEL[r.kind]}</dt>
              <dd className={r.counts ? "text-primary" : "text-tertiary"}>{r.text}</dd>
            </div>
          ))}
          {item.reasons.length === 0 && <p className="text-sm text-tertiary">No reasons recorded.</p>}
        </dl>

        <h3 className="mt-7 text-md font-semibold text-primary">Against your goals</h3>
        <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {GOALS.map((g) => {
            const e = item.goals.find((x) => x.goal === g);
            return (
              <li key={g} className="flex gap-2 text-sm">
                {e?.moves ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" aria-label="Moves it" />
                ) : (
                  <Minus className="mt-0.5 size-4 shrink-0 text-fg-quaternary" aria-label="Doesn't move it" />
                )}
                <span>
                  <span className={e?.moves ? "font-medium text-primary" : "text-tertiary"}>{GOAL_LABEL[g]}</span>
                  {e?.note && <span className="text-tertiary">. {e.note}</span>}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-7 grid gap-4 sm:grid-cols-3">
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

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <Eyebrow>Format</Eyebrow>
            <div className="mt-1.5 flex items-center gap-1.5 text-sm text-secondary">
              <BookOpen01 className="size-4" /> Blog post · {item.collection}
            </div>
          </div>
          <div>
            <Eyebrow>{item.topics.length > 1 ? "Topics" : "Topic"}</Eyebrow>
            <div className="mt-1.5 text-md text-primary">{item.topics.join(", ")}</div>
            {item.topicProgress && <div className="text-sm text-tertiary">{item.topicProgress}</div>}
          </div>
          <div>
            <Eyebrow>Length</Eyebrow>
            <div className="mt-1.5 text-md text-primary">{item.length}</div>
          </div>
        </div>

        <Section title="Angle">{item.angle}</Section>
        <Section title="Who it's for">{item.audience}</Section>

        {item.outline.length > 0 && (
          <div className="mt-7">
            <h3 className="text-md font-semibold text-primary">Outline</h3>
            {decidable && <p className="text-sm text-tertiary">Leave a note on any line.</p>}
            <ol className="mt-3 flex flex-col gap-1">
              {item.outline.map((l, n) => {
                const note = lineNotes[l.id];
                const showNote = note !== undefined || openNote === l.id;
                return (
                  <li key={l.id} className={cx("group rounded-lg px-3 py-2", showNote && "bg-secondary")}>
                    <div className="flex items-start gap-3">
                      <span className="w-5 shrink-0 text-right text-md text-quaternary">{n + 1}.</span>
                      <span className="flex-1 text-md text-primary">{l.text}</span>
                      {decidable && !showNote && (
                        <button
                          type="button"
                          onClick={() => setOpenNote(l.id)}
                          aria-label={`Add a note on line ${n + 1}`}
                          className="rounded-md p-1 text-fg-quaternary opacity-100 transition hover:bg-primary_hover hover:text-fg-secondary md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
                        className="mt-2 ml-8 w-[calc(100%-2rem)] bg-warning-primary"
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
          </div>
        )}

        {item.sources.length > 0 && (
          <div className="mt-7">
            <h3 className="text-md font-semibold text-primary">Sources</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {item.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-md text-brand-secondary underline underline-offset-4">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {decidable && (
          <label className="mt-7 block">
            <span className="text-md font-semibold text-primary">A note for the writer</span>
            <span className="ml-2 text-sm text-tertiary">optional</span>
            <TextArea
              rows={2}
              className="mt-2"
              placeholder="Anything to keep in mind while writing it"
              value={generalNote}
              onChange={(e) => setGeneralNote(e.target.value)}
            />
          </label>
        )}
      </div>

      {/* footer */}
      {decidable &&
        (rejecting ? (
          <div className="border-t border-secondary p-4 md:px-8">
            <div className="rounded-xl bg-error-primary p-4">
              <label htmlFor="reject-reason" className="text-xs font-semibold tracking-wide text-error-primary uppercase">
                Why reject it? Required.
              </label>
              <TextArea
                id="reject-reason"
                autoFocus
                rows={2}
                className="mt-2"
                placeholder="For example: we don't write about competitors' ERPs this quarter."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="mt-2 text-sm text-tertiary">
                Your reasons teach Propaganda your strategy and taste, so the next pitches fit better.
              </p>
              <div className="mt-3 flex items-center justify-between">
                <Button size="sm" color="tertiary" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
                <Button size="sm" color="secondary-destructive" isDisabled={!reason.trim()} onClick={reject}>
                  Reject pitch
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-secondary px-5 py-4 md:px-8">
            <Button size="md" color="secondary-destructive" onClick={() => setRejecting(true)}>
              Reject…
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-sm text-tertiary">
                {writerName} · {reviewerName} · by {shortDate(publishBy)}
              </span>
              <Button size="md" color="primary" isLoading={busy} onClick={() => void approve()}>
                {notes.length ? "Approve with notes" : "Approve"}
              </Button>
            </div>
          </div>
        ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="mt-7">
      <h3 className="text-md font-semibold text-primary">{title}</h3>
      <p className="mt-2 text-md leading-7 text-secondary">{children}</p>
    </div>
  );
}
