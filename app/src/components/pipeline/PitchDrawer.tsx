// The pitch brief, over the board (#/pipeline/pitch/<id>), in a large dialog
// with the comments beside it. Highlight a passage and choose Comment for a
// contextual comment, or write a general one; the comments stay here and go
// together, as the pitch's notes, when it is approved. Or reject with a reason.
// Approving hands off to the editor: a draft post and its brief are created.

import { useEffect, useState, type ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Check, LinkExternal01, Minus } from "@untitledui/icons";
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
import { CommentThreads } from "@/components/shared/CommentThreads";
import { newId } from "@/lib/supabase";
import { FitBadge, TextArea } from "./bits";
import {
  HighlightProvider,
  Passage,
  SelectionComment,
  notesFromThreads,
  threadsFromNotes,
  toThreadItems,
  type PitchThread,
} from "./pitchComments";

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
      <Modal className="fixed inset-0 flex items-center justify-center p-0 duration-200 entering:animate-in entering:fade-in entering:zoom-in-95 exiting:animate-out exiting:fade-out exiting:zoom-out-95 md:p-6">
        <Dialog aria-label={item.title} className="flex h-full w-full max-w-[1200px] flex-col bg-primary shadow-xl outline-hidden md:max-h-[920px] md:rounded-2xl lg:flex-row">
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
  const [threads, setThreads] = useState<PitchThread[]>(() => threadsFromNotes(item.notes, item));
  const [draft, setDraft] = useState<{ field: string; quote: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const notes: PitchNote[] = notesFromThreads(threads, item);

  const mine = (body: string) => ({ id: newId(), author: "You", at: Date.now(), body: body.trim(), mine: true });
  const addThread = (field: string | null, quote: string | null, body: string) => {
    const t: PitchThread = { id: newId(), field, quote, resolved: false, comments: [mine(body)] };
    setThreads((all) => [...all, t]);
    setActiveId(t.id);
  };
  const mapThread = (id: string, f: (t: PitchThread) => PitchThread) => setThreads((all) => all.map((t) => (t.id === id ? f(t) : t)));

  const writerName = personById(people, writerId)?.name ?? "Unassigned";
  const options = people.map((p) => ({ label: p.id === meId ? "You" : p.agent ? "Us" : p.name, value: p.id }));

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

  const items = toThreadItems(threads, item);

  return (
    <HighlightProvider
      value={{ threads: decidable ? threads : [], activeId, hoverId, onActivate: setActiveId, onHover: setHoverId }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
        {item.why && (
          <p className="mt-2 text-sm text-secondary">
            <Passage field="why" text={item.why} />
          </p>
        )}
        {item.learned && <p className="mt-2 text-sm text-tertiary italic">{item.learned}</p>}
        {!decidable && (
          <p className="mt-4 text-sm font-medium text-primary">
            {STAGE_LABEL[item.stage]}
            {item.rejectReason ? `: ${item.rejectReason}` : ""}
          </p>
        )}
      </header>

      {/* body: one column, one rhythm */}
      <div ref={setBodyEl} className="flex-1 overflow-y-auto">
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
                ["Angle", item.angle && <Passage key="angle" field="angle" text={item.angle} />],
                ["Who it's for", item.audience && <Passage key="audience" field="audience" text={item.audience} />],
                [item.topics.length > 1 ? "Topics" : "Topic", [item.topics.join(", "), item.topicProgress].filter(Boolean).join(" · ")],
                ["Format", [`Blog post in ${item.collection}`, item.length].filter(Boolean).join(", ")],
              ]}
            />
          </Block>

          <Block title="Why now">
            {item.reasons.length ? (
              <Fields rows={item.reasons.map((r, n) => [REASON_LABEL[r.kind], <Passage key={n} field={`reason:${n}`} text={r.text} />, !r.counts] as const)} />
            ) : (
              <p className="text-sm text-tertiary">Your idea: no reasons from us.</p>
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
            <Block title="Outline" hint={decidable ? "Highlight any words to comment on them." : undefined}>
              <ol className="flex flex-col gap-2">
                {item.outline.map((l, n) => (
                  <li key={l.id} className="flex items-start gap-3">
                    <span className="w-4 shrink-0 text-right text-sm text-quaternary tabular-nums">{n + 1}</span>
                    <span className="flex-1 text-sm text-primary">
                      <Passage field={l.id} text={l.text} />
                    </span>
                  </li>
                ))}
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
                <NativeSelect label="Written by" size="md" options={options} value={writerId} disabled={!decidable} onChange={(e) => setWriterId(e.target.value)} />
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
            </CardBody>
          </Card>
        </div>
      </div>

      {/* footer: the decision */}
      {decidable &&
        (rejecting ? (
          <footer className="flex flex-col gap-3 border-t border-secondary px-6 py-4 md:px-8">
            <label htmlFor="reject-reason" className="text-sm font-medium text-primary">
              Why reject it? <span className="font-normal text-tertiary">We learn from your reason.</span>
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
      </div>

      {/* comments: highlights and general, sent together on approve */}
      <aside className="flex max-h-[45%] w-full shrink-0 flex-col border-t border-secondary bg-secondary_subtle lg:max-h-none lg:w-[360px] lg:border-t-0 lg:border-l">
        <div className="border-b border-secondary px-5 py-4">
          <h3 className="type-heading text-primary">Comments</h3>
          <p className="mt-1 text-xs text-tertiary">
            {decidable ? "They go to the writer together when you approve." : "What was said when this pitch was decided."}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {decidable ? (
            <CommentThreads
              threads={items}
              draftQuote={draft?.quote ?? null}
              activeId={activeId}
              hoverId={hoverId}
              onActivate={setActiveId}
              onHover={setHoverId}
              onComment={(body) => {
                if (draft) addThread(draft.field, draft.quote, body);
                setDraft(null);
              }}
              onCancelDraft={() => setDraft(null)}
              onGeneral={(body) => addThread(null, null, body)}
              onReply={(id, body) => mapThread(id, (t) => ({ ...t, comments: [...t.comments, mine(body)] }))}
              onResolve={(id, resolved) => mapThread(id, (t) => ({ ...t, resolved }))}
              onDelete={(cid) => setThreads((all) => all.map((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== cid) })).filter((t) => t.comments.length))}
              generalPlaceholder="Anything to keep in mind while writing it"
            />
          ) : item.notes.length ? (
            <ul className="flex flex-col gap-3">
              {item.notes.map((n, i) => (
                <li key={i} className="flex flex-col gap-2 rounded-xl bg-primary p-3 text-sm ring-1 ring-secondary ring-inset">
                  {n.quote && <blockquote className="border-l-2 border-brand pl-3 text-tertiary">{n.quote}</blockquote>}
                  <p className="whitespace-pre-wrap text-primary">{n.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-tertiary">No comments.</p>
          )}
        </div>
      </aside>
      {decidable && <SelectionComment root={bodyEl} onPick={(field, quote) => setDraft({ field, quote })} />}
    </HighlightProvider>
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
function Fields({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode, boolean?]> }) {
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
