// Review (#/pipeline/review/<id>): the draft, with the source check on its
// external links and stats, the notes left at the pitch, and Remember offered
// on sentences about the tenant's own product. Approve and schedule, or send
// back with a note. Things that don't hold up never block approval.

import { useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen01, Check } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { PageBody } from "@/components/shell/PageHeader";
import { go, goPage } from "@/lib/route";
import { shortDate } from "@/lib/pipeline/dates";
import { approveAndSchedule, personById, sendBack, sendForReview, setClaimState, usePipeline } from "@/lib/pipeline/store";
import { STAGE_LABEL, type DraftForReview, type SourceCheck } from "@/lib/pipeline/types";
import { track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { TextArea } from "./bits";
import { usePostTitles } from "./shared";

export function ReviewPage({ id }: { id: string }) {
  const { items, people, settings } = usePipeline();
  const item = items.find((i) => i.id === id);
  const titles = usePostTitles(item ? [item] : []);
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");

  if (!item) {
    return (
      <PageBody>
        <BackLink />
        <p className="mt-8 text-md text-tertiary">This piece isn't in the pipeline anymore.</p>
      </PageBody>
    );
  }

  const writer = personById(people, item.writerId);
  const reviewer = personById(people, item.reviewerId);
  const isMe = item.reviewerId === settings.meId;
  const title = (item.postId && titles.get(item.postId)) || item.title;
  const review = item.review;
  const problems = review?.checks.filter((c) => c.status !== "matches").length ?? 0;
  const reviewing = item.stage === "in_review";

  const approve = () => {
    const when = approveAndSchedule(item.id);
    track("review_approved", { open_findings: problems });
    toast.add({ type: "success", title: `Approved and scheduled for ${when}.` });
    goPage("pipeline");
  };

  const back = () => {
    if (!note.trim()) return;
    sendBack(item.id, note);
    track("review_sent_back");
    toast.add({ title: `Sent back to ${writer?.agent ? "the writer agent" : (writer?.name ?? "the writer")}.` });
    goPage("pipeline");
  };

  return (
    <PageBody wide>
      <BackLink />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-title text-3xl tracking-tight text-primary md:text-4xl">Review</h1>
          <p className="mt-1.5 text-md text-tertiary">
            {reviewing ? (
              <>
                {writer?.agent ? "The writer agent" : (writer?.name ?? "The writer")} sent this for review.{" "}
                {isMe ? "You're the reviewer." : `${reviewer?.name ?? "Nobody"} reviews it.`} Due {shortDate(item.publishBy)}.
              </>
            ) : (
              <>
                {STAGE_LABEL[item.stage]}. Due {shortDate(item.publishBy)}.
              </>
            )}
          </p>
        </div>
        {item.postId && (
          <Button size="sm" color="secondary" iconTrailing={ArrowUpRight} onClick={() => go({ view: "post", id: item.postId! })}>
            Open in the editor
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <article className="rounded-2xl bg-primary px-5 py-8 shadow-xs ring-1 ring-secondary ring-inset md:px-12 md:py-10">
          <div className="flex items-center gap-1.5 text-sm text-tertiary">
            <BookOpen01 className="size-4" /> {item.collection}
          </div>
          <h2 className="mt-3 font-title text-3xl tracking-tight text-primary md:text-4xl">{title}</h2>
          {review ? (
            <div className="mt-6 flex max-w-[640px] flex-col gap-5 text-lg leading-8 text-primary">
              {review.paragraphs.map((p, n) => (
                <p key={n}>
                  <Marked text={p} review={review} />
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-6 text-md text-tertiary">
              The draft is in the editor. The source check runs when it's sent for review.
            </p>
          )}
        </article>

        <aside className="flex flex-col gap-4">
          {item.notes.length > 0 && (
            <Panel title="Your notes at the pitch">
              <ul className="flex flex-col gap-3">
                {item.notes.map((n, k) => (
                  <li key={k} className="border-l-2 border-fg-warning-primary pl-3 text-md text-secondary">
                    {n.text}
                    {n.lineId && (
                      <span className="text-tertiary">
                        {" "}on “{item.outline.find((l) => l.id === n.lineId)?.text}”
                      </span>
                    )}{" "}
                    {n.done ? <span className="text-success-primary">Done.</span> : <span className="text-warning-primary">Not yet.</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {review && (
            <Panel title="Source check">
              {review.checks.length === 0 ? (
                <p className="text-md text-tertiary">No numbers or quotes to check.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {review.checks.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {review && review.ownClaims.length > 0 && (
            <Panel title="About us, said here">
              <ul className="flex flex-col gap-4">
                {review.ownClaims.map((c) => (
                  <li key={c.id}>
                    <blockquote className="border-l-2 border-secondary pl-3 text-md text-primary">“{c.sentence}”</blockquote>
                    {c.state === "open" ? (
                      <>
                        <p className="mt-2 text-sm text-tertiary">
                          First time we say this in public. Remember it, so later posts stay consistent with it?
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            color="secondary"
                            onClick={() => {
                              setClaimState(item.id, c.id, "remembered");
                              track("claim_remembered", { from: "review" });
                            }}
                          >
                            Remember
                          </Button>
                          <Button size="sm" color="tertiary" onClick={() => setClaimState(item.id, c.id, "not_a_fact")}>
                            Not a fact
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 flex items-center gap-2 text-sm text-tertiary">
                        {c.state === "remembered" ? "Remembered. Later posts will be checked against it." : "Marked as not a fact."}
                        <button type="button" className="text-sm text-brand-secondary underline-offset-4 hover:underline" onClick={() => setClaimState(item.id, c.id, "open")}>
                          Undo
                        </button>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {reviewing &&
            (sendingBack ? (
              <div className="rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary ring-inset">
                <label htmlFor="send-back-note" className="text-sm font-semibold text-primary">
                  What needs to change? Required.
                </label>
                <TextArea
                  id="send-back-note"
                  autoFocus
                  rows={3}
                  className="mt-2"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="For example: use the Haldane number from the call, and link a source for the €10,000 rule."
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
              <div>
                <div className="flex flex-wrap gap-3">
                  <Button size="md" color="secondary" onClick={() => setSendingBack(true)}>
                    Send back
                  </Button>
                  <Button size="md" color="primary" onClick={approve}>
                    Approve and schedule
                  </Button>
                </div>
                <p className="mt-3 text-sm text-tertiary">
                  {problems === 0
                    ? "Everything checked holds up."
                    : `${problems} ${problems === 1 ? "thing doesn't" : "things don't"} hold up yet. You can still approve.`}
                </p>
              </div>
            ))}

          {item.stage === "writing" && (
            <div>
              {item.sentBackNote && (
                <p className="mb-3 text-sm text-secondary">
                  <span className="font-medium">Sent back:</span> {item.sentBackNote}
                </p>
              )}
              <Button
                size="md"
                color="primary"
                onClick={() => {
                  sendForReview(item.id);
                  toast.add({ title: `Sent to ${item.reviewerId === settings.meId ? "you" : (reviewer?.name ?? "the reviewer")} for review.` });
                }}
              >
                Send for review
              </Button>
            </div>
          )}
        </aside>
      </div>
    </PageBody>
  );
}

function BackLink() {
  return (
    <button
      type="button"
      onClick={() => goPage("pipeline")}
      className="flex items-center gap-2 text-md text-tertiary transition hover:text-secondary"
    >
      <ArrowLeft className="size-4" /> Pipeline
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-primary p-5 shadow-xs ring-1 ring-secondary ring-inset">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-tertiary uppercase">{title}</h3>
      {children}
    </section>
  );
}

function CheckRow({ check }: { check: SourceCheck }) {
  if (check.status === "matches") {
    return (
      <li className="flex gap-2 text-md text-secondary">
        <Check className="mt-1 size-4 shrink-0 text-fg-success-primary" aria-label="Holds up" />
        <span>
          “{check.quote}”. {check.detail}
        </span>
      </li>
    );
  }
  return (
    <li className="border-l-2 border-error pl-3 text-md text-secondary">
      <span className="font-semibold text-primary">{check.status === "mismatch" ? "Doesn't match its source." : "No source."}</span>{" "}
      {check.detail}
      <div className="mt-1 text-sm text-tertiary">“{check.quote}”</div>
      {check.where && <div className="text-sm text-tertiary">{check.where}</div>}
    </li>
  );
}

/** A paragraph with [[id]]…[[/]] spans underlined by what the check found. */
function Marked({ text, review }: { text: string; review: DraftForReview }) {
  const parts = text.split(/(\[\[[a-z0-9]+\]\][\s\S]*?\[\[\/\]\])/g);
  return (
    <>
      {parts.map((part, n) => {
        const m = part.match(/^\[\[([a-z0-9]+)\]\]([\s\S]*?)\[\[\/\]\]$/);
        if (!m) return <span key={n}>{part}</span>;
        const check = review.checks.find((c) => c.id === m[1]);
        const claim = review.ownClaims.find((c) => c.id === m[1]);
        const tone = check
          ? check.status === "matches"
            ? "decoration-fg-success-primary"
            : "decoration-fg-error-primary"
          : claim?.state === "open"
            ? "decoration-fg-quaternary decoration-dashed"
            : "decoration-transparent";
        return (
          <span key={n} className={cx("underline decoration-2 underline-offset-[5px]", tone)} title={check?.detail}>
            {m[2]}
          </span>
        );
      })}
    </>
  );
}
