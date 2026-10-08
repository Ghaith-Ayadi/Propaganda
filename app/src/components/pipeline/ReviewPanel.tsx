// The post screen's Review tab: the notes left at the pitch, the source check
// on the draft's external links and stats, Remember on sentences about the
// tenant's own product, and the reviewer's decision (approve and schedule, or
// send back with a note). Things that don't hold up never block approval.

import { useState } from "react";
import { Check } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { goPage } from "@/lib/route";
import { shortDate } from "@/lib/pipeline/dates";
import {
  approveAndSchedule,
  personById,
  sendBack,
  sendForReview,
  setClaimState,
  usePipeline,
  usePipelineItemForPost,
} from "@/lib/pipeline/store";
import { STAGE_LABEL, type SourceCheck } from "@/lib/pipeline/types";
import { track } from "@/lib/telemetry";
import { TextArea } from "./bits";

export function ReviewPanel({ postId }: { postId: string }) {
  const { people, settings } = usePipeline();
  const item = usePipelineItemForPost(postId);
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");

  if (!item) {
    return <p className="text-sm text-tertiary">This post isn't in the pipeline, so there's nothing to review here.</p>;
  }

  const writer = personById(people, item.writerId);
  const reviewer = personById(people, item.reviewerId);
  const isMe = item.reviewerId === settings.meId;
  const review = item.review;
  const problems = review?.checks.filter((c) => c.status !== "matches").length ?? 0;
  const reviewing = item.stage === "in_review";
  const writerName = writer?.agent ? "The writer agent" : (writer?.name ?? "The writer");

  const approve = () => {
    const when = approveAndSchedule(item.id);
    track("review_approved", { open_findings: problems });
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
    <div className="flex flex-col gap-6">
      <p className="text-sm text-tertiary">
        {reviewing
          ? `${writerName} sent this for review. ${isMe ? "You're the reviewer." : `${reviewer?.name ?? "Nobody"} reviews it.`} Due ${shortDate(item.publishBy)}.`
          : `${STAGE_LABEL[item.stage]}. Due ${shortDate(item.publishBy)}.`}
      </p>

      {item.notes.length > 0 && (
        <Section title="Your notes at the pitch">
          <ul className="flex flex-col gap-3">
            {item.notes.map((n, k) => (
              <li key={k} className="border-l-2 border-fg-warning-primary pl-3 text-sm text-secondary">
                {n.text}
                {n.lineId && <span className="text-tertiary"> on “{item.outline.find((l) => l.id === n.lineId)?.text}”</span>}{" "}
                {n.done ? <span className="text-success-primary">Done.</span> : <span className="text-warning-primary">Not yet.</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Source check">
        {!review ? (
          <p className="text-sm text-tertiary">Runs when the draft is sent for review.</p>
        ) : review.checks.length === 0 ? (
          <p className="text-sm text-tertiary">No numbers or quotes to check.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {review.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        )}
      </Section>

      {review && review.ownClaims.length > 0 && (
        <Section title="About us, said here">
          <ul className="flex flex-col gap-4">
            {review.ownClaims.map((c) => (
              <li key={c.id}>
                <blockquote className="border-l-2 border-secondary pl-3 text-sm text-primary">“{c.sentence}”</blockquote>
                {c.state === "open" ? (
                  <>
                    <p className="mt-2 text-sm text-tertiary">First time we say this in public. Remember it, so later posts stay consistent with it?</p>
                    <div className="mt-2 flex gap-2">
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
                  <p className="mt-2 text-sm text-tertiary">
                    {c.state === "remembered" ? "Remembered. Later posts will be checked against it." : "Marked as not a fact."}{" "}
                    <button type="button" className="text-brand-secondary underline-offset-4 hover:underline" onClick={() => setClaimState(item.id, c.id, "open")}>
                      Undo
                    </button>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {reviewing &&
        (sendingBack ? (
          <div>
            <label htmlFor="send-back-note" className="text-sm font-semibold text-primary">
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
          <div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" color="secondary" onClick={() => setSendingBack(true)}>
                Send back
              </Button>
              <Button size="sm" color="primary" onClick={approve}>
                Approve and schedule
              </Button>
            </div>
            <p className="mt-2 text-sm text-tertiary">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">{title}</h3>
      {children}
    </section>
  );
}

function CheckRow({ check }: { check: SourceCheck }) {
  if (check.status === "matches") {
    return (
      <li className="flex gap-2 text-sm text-secondary">
        <Check className="mt-0.5 size-4 shrink-0 text-fg-success-primary" aria-label="Holds up" />
        <span>
          “{check.quote}”. {check.detail}
        </span>
      </li>
    );
  }
  return (
    <li className="border-l-2 border-error pl-3 text-sm text-secondary">
      <span className="font-semibold text-primary">{check.status === "mismatch" ? "Doesn't match its source." : "No source."}</span>{" "}
      {check.detail}
      <div className="mt-1 text-tertiary">“{check.quote}”</div>
      {check.where && <div className="text-tertiary">{check.where}</div>}
    </li>
  );
}
