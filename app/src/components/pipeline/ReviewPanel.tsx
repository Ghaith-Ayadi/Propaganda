// The post screen's Review tab, read like a grammar checker beside the text.
// Every note is anchored to the words it is about: they're highlighted in the
// editor, and hovering or clicking either one lights up the other and scrolls
// it into view. Three sections, one colour each: the tenant's own notes from
// the pitch, the source check on numbers and quotes, and the knowledge base.
// Below them, the reviewer's decision (approve and schedule, or send back).
// Nothing here blocks approval.
//
// The notes are built beside the editor (lib/review/notes) and read from the
// review store, so the highlights exist whichever side tab is open.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LinkExternal01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { goPage } from "@/lib/route";
import { shortDate } from "@/lib/pipeline/dates";
import { approveAndSchedule, personById, sendBack, sendForReview, usePipeline, usePipelineItemForPost } from "@/lib/pipeline/store";
import { STAGE_LABEL } from "@/lib/pipeline/types";
import { activate, setHover, useReviewState, type ReviewSection } from "@/lib/review/store";
import type { ReviewNote } from "@/lib/review/notes";
import { track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { TextArea } from "./bits";

const SECTIONS: { id: ReviewSection; title: string; hint: string; empty: string }[] = [
  {
    id: "pitch",
    title: "Your notes at the pitch",
    hint: "What you asked for when you approved the pitch.",
    empty: "You approved the pitch without notes.",
  },
  {
    id: "sources",
    title: "Source checks",
    hint: "Numbers and quotes, checked against their sources.",
    empty: "Runs when the draft is sent for review.",
  },
  {
    id: "kb",
    title: "Knowledge base",
    hint: "Checked against what you've said before.",
    empty: "Nothing here disagrees with the knowledge base.",
  },
];

/** The section's colour: the same as its highlight in the text (Editor's REVIEW_MARK_CSS). */
const SWATCH: Record<ReviewSection, string> = {
  pitch: "bg-utility-neutral-400",
  sources: "bg-utility-red-500",
  kb: "bg-utility-orange-500",
};
const RING: Record<ReviewSection, string> = {
  pitch: "ring-utility-neutral-400",
  sources: "ring-utility-red-500",
  kb: "ring-utility-orange-500",
};

export function ReviewPanel({ postId }: { postId: string }) {
  const review = useReviewState();
  const item = usePipelineItemForPost(postId);
  const notes = review.postId === postId ? review.notes : [];
  const open = notes.filter((n) => !n.resolved).length;

  return (
    <div className="flex flex-col">
      <p className="text-sm text-tertiary">
        {open === 0
          ? notes.length
            ? "Everything here is handled."
            : "Nothing to review yet."
          : `${open} ${open === 1 ? "note" : "notes"} to look at. Click one to find it in the text.`}
      </p>

      {SECTIONS.map((s) => (
        <Section
          key={s.id}
          section={s}
          notes={notes.filter((n) => n.section === s.id)}
          found={review.found}
          empty={s.id === "sources" && (review.checkedAt || item?.review) ? "No numbers or quotes to check." : s.empty}
        />
      ))}

      {item && <Decision postId={postId} open={notes.filter((n) => !n.resolved && n.tone === "issue").length} />}
    </div>
  );
}

function Section({
  section,
  notes,
  found,
  empty,
}: {
  section: (typeof SECTIONS)[number];
  notes: ReviewNote[];
  found: ReadonlyMap<string, number>;
  empty: string;
}) {
  // Open notes in the order they appear in the text (general ones first), handled ones after.
  const pos = (n: ReviewNote) => (n.quote ? (found.get(n.id) ?? Number.MAX_SAFE_INTEGER) : -1);
  const open = notes.filter((n) => !n.resolved).sort((a, b) => pos(a) - pos(b));
  const done = notes.filter((n) => n.resolved);

  return (
    <section className="-mx-5 mt-5 border-t border-secondary px-5 pt-5" aria-labelledby={`review-${section.id}`}>
      <header className="flex items-center gap-2">
        <span className={cx("size-2 shrink-0 rounded-full", SWATCH[section.id])} aria-hidden />
        <h3 id={`review-${section.id}`} className="type-eyebrow text-secondary">
          {section.title}
        </h3>
        {open.length > 0 && <span className="ml-auto text-xs text-tertiary">{open.length} open</span>}
      </header>
      <p className="mt-1 text-xs text-tertiary">{section.hint}</p>

      {notes.length === 0 ? (
        <p className="mt-3 text-sm text-tertiary">{empty}</p>
      ) : (
        <>
          {open.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {open.map((n) => (
                <NoteCard key={n.id} note={n} inText={!n.quote || found.has(n.id)} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {done.map((n) => (
                <DoneRow key={n.id} note={n} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** One open note. Folded to its title and words until it's the active one, like a grammar checker's card. */
function NoteCard({ note, inText }: { note: ReviewNote; inText: boolean }) {
  const { active, activeFrom, hover, seq } = useReviewState();
  const isActive = active === note.id;
  const ref = useRef<HTMLLIElement>(null);
  const [busy, setBusy] = useState(false);

  // Its highlight was clicked in the text: bring the card into view.
  useEffect(() => {
    if (isActive && activeFrom === "editor") ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [isActive, activeFrom, seq]);

  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.add({ type: "error", title: err instanceof Error ? err.message : "That didn't work. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      ref={ref}
      className={cx(
        "rounded-lg border bg-primary shadow-xs transition",
        isActive ? cx("border-transparent ring-2", RING[note.section]) : hover === note.id ? "border-primary" : "border-secondary",
      )}
      onMouseEnter={() => setHover(note.id)}
      onMouseLeave={() => setHover(null)}
    >
      <button
        type="button"
        aria-expanded={isActive}
        className="block w-full px-3 pt-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={() => activate(isActive ? null : note.id, "panel")}
      >
        <span className="block text-sm font-medium text-primary">{note.title}</span>
        {note.quote && !(isActive && note.fix) && (
          <span className={cx("mt-1 block font-serif text-sm text-tertiary", !isActive && "line-clamp-1")}>“{note.quote}”</span>
        )}
        {!isActive && <span className="mt-1 line-clamp-1 block pb-3 text-sm text-secondary">{note.body}</span>}
      </button>

      {isActive && (
        <div className="px-3 pb-3">
          {note.fix && note.quote && (
            <p className="mt-1 font-serif text-sm">
              <del className="text-tertiary decoration-fg-error-secondary">{note.quote}</del>{" "}
              <ArrowRight className="inline size-3.5 text-quaternary" aria-label="becomes" />{" "}
              <ins className="rounded-sm bg-utility-green-50 px-0.5 text-primary no-underline">{note.fix}</ins>
            </p>
          )}
          <p className="mt-2 text-sm text-secondary">{note.body}</p>
          {note.meta && (
            <p className="mt-1.5 text-xs text-tertiary">
              {note.href ? (
                <a
                  href={note.href}
                  target={note.href.startsWith("#") ? undefined : "_blank"}
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:text-secondary hover:underline"
                >
                  {note.meta}
                  <LinkExternal01 className="size-3" aria-hidden />
                </a>
              ) : (
                note.meta
              )}
            </p>
          )}
          {!inText && <p className="mt-1.5 text-xs text-tertiary">These words aren't in the post anymore.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {note.actions.map((a) => (
              <Button
                key={a.label}
                size="sm"
                color={a.primary ? "primary" : "secondary"}
                isDisabled={busy || (!inText && (a.label === "Accept" || a.label === "Add a link"))}
                onClick={() => void run(a.run)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

/** A handled note: one line, with undo when it can be undone. */
function DoneRow({ note }: { note: ReviewNote }) {
  return (
    <li className="flex items-start gap-2 text-sm text-tertiary">
      <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="text-secondary">{note.quote && note.section !== "pitch" ? `“${note.quote}”` : note.title}</span>
        <span>. {note.resolved}.</span>
        {note.undo && (
          <>
            {" "}
            <button type="button" className="text-secondary underline-offset-4 hover:underline" onClick={note.undo}>
              Undo
            </button>
          </>
        )}
      </span>
    </li>
  );
}

/** The reviewer's decision, pinned under the notes. */
function Decision({ postId, open }: { postId: string; open: number }) {
  const { people, settings } = usePipeline();
  const item = usePipelineItemForPost(postId)!;
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");

  const writer = personById(people, item.writerId);
  const reviewer = personById(people, item.reviewerId);
  const isMe = item.reviewerId === settings.meId;
  const reviewing = item.stage === "in_review";
  const writerName = writer?.agent ? "The writer agent" : (writer?.name ?? "The writer");

  const approve = () => {
    const when = approveAndSchedule(item.id);
    track("review_approved", { open_findings: open });
    toast.add({
      type: "success",
      title: `Approved. Moved to Scheduled for ${when}.`,
      description: "Publishing comes with the Publish step; the post itself isn't scheduled yet.",
    });
    goPage("pipeline");
  };

  const back = () => {
    if (!note.trim()) return;
    sendBack(item.id, note);
    track("review_sent_back");
    toast.add({ title: `Sent back to ${writer?.agent ? "the writer agent" : (writer?.name ?? "the writer")}.` });
    setSendingBack(false);
    setNote("");
  };

  return (
    <div className="sticky -bottom-6 -mx-5 mt-6 border-t border-secondary bg-secondary px-5 pt-4 pb-6">
      <p className="text-sm text-tertiary">
        {reviewing
          ? `${writerName} sent this for review. ${isMe ? "You're the reviewer." : `${reviewer?.name ?? "Nobody"} reviews it.`} Due ${shortDate(item.publishBy)}.`
          : `${STAGE_LABEL[item.stage]}. Due ${shortDate(item.publishBy)}.`}
      </p>

      {reviewing &&
        (sendingBack ? (
          <div className="mt-3">
            <label htmlFor="send-back-note" className="text-sm font-medium text-primary">
              What needs to change? Required.
            </label>
            <TextArea
              id="send-back-note"
              autoFocus
              rows={3}
              className="mt-2 text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example: use the number from the call, and link a source for the €10,000 rule."
            />
            <div className="mt-3 flex justify-between">
              <Button size="sm" color="tertiary" onClick={() => setSendingBack(false)}>
                Cancel
              </Button>
              <Button size="sm" color="primary" isDisabled={!note.trim()} onClick={back}>
                Send back
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" color="secondary" onClick={() => setSendingBack(true)}>
                Send back
              </Button>
              <Button size="sm" color="primary" onClick={approve}>
                Approve and schedule
              </Button>
            </div>
            <p className="mt-2 text-xs text-tertiary">
              {open === 0
                ? "Everything checked holds up."
                : `${open} ${open === 1 ? "thing doesn't" : "things don't"} hold up yet. You can still approve.`}
            </p>
          </>
        ))}

      {item.stage === "writing" && (
        <div className="mt-3">
          {item.sentBackNote && (
            <p className="mb-3 text-sm text-secondary">
              <span className="font-medium">Sent back:</span> {item.sentBackNote}
            </p>
          )}
          <Button
            size="sm"
            color="primary"
            onClick={() => {
              sendForReview(item.id);
              toast.add({ title: `Sent to ${isMe ? "you" : (reviewer?.name ?? "the reviewer")} for review.` });
            }}
          >
            Send for review
          </Button>
        </div>
      )}
    </div>
  );
}
