// Steps 5 and 6: the Strategist's first pitches, decided one by one, with the
// drafts the Writer started on the strongest three when the plan was approved.
// A rejection with a reason gets one replacement from the Strategist, written
// after that reason. A ready draft opens in the editor, with a way back here.

import { useState } from "react";
import { ArrowRight, Check, CheckCircle, ChevronDown, XClose } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { Card } from "@/components/shell/Card";
import { approvePitch, notNowPitch, rejectPitch, usePipeline } from "@/lib/pipeline/store";
import { FIT_LABEL, fitGrade } from "@/lib/pipeline/fit";
import type { PipelineItem } from "@/lib/pipeline/types";
import { userMessage } from "@/lib/errors";
import { reportError, track } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { Field, Spinner, StepTitle } from "./bits";
import type { StrategistProgress } from "./progress";
import type { FirstDay } from "./state";
import { openFromStart } from "./backLink";

/** A pitch with a draft: written (words in it), being written, or failed. */
function draftState(p: PipelineItem, day: FirstDay, progress: StrategistProgress | null): "ready" | "writing" | "failed" | null {
  if (p.postId && day.drafted.get(p.postId)) return "ready";
  const run = progress?.drafts.find((d) => d.briefId === p.id);
  if (run?.state === "failed") return "failed";
  if (run || (p.postId && p.stage === "pitched")) return "writing";
  return null;
}

export function FirstPitches({ day, progress, continuing }: { day: FirstDay; progress: StrategistProgress | null; continuing: boolean }) {
  const pitches = day.firstPitches;
  const decided = (p: PipelineItem) => p.stage !== "pitched";
  const approved = pitches.filter((p) => ["writing", "in_review", "scheduled", "published"].includes(p.stage)).length;
  const rejected = pitches.filter((p) => p.stage === "rejected").length;
  const waiting = pitches.filter((p) => !decided(p)).length;
  const published = pitches.filter((p) => p.stage === "published").length;
  const ready = pitches.find((p) => p.stage !== "rejected" && p.stage !== "published" && p.stage !== "not_now" && draftState(p, day, progress) === "ready");
  const [open, setOpen] = useState<string | null>(null);
  // The plan's pitching is over (or never started) and nothing came: say so instead of spinning.
  const pp = progress?.proposalId === day.proposal?.id ? progress?.pitches : undefined;
  const pitchingEnded = pp === null || (!!pp && (!!pp.failed || (pp.topics > 0 && pp.topicsDone >= pp.topics)));

  return (
    <div className="flex flex-col gap-5">
      <StepTitle
        title={continuing ? "The rest of your first batch" : "Your first pitches"}
        lede={
          continuing
            ? "Review the drafts that are ready and decide on the pitches left. Everything you skip waits in the Pipeline."
            : "The Strategist pitched these with your plan. Approve the ones you'd publish; a reason on a rejection shapes its replacement. The strongest are already being written."
        }
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge color="success" size="md">{approved} approved</Badge>
        <Badge color="gray" size="md">{rejected} rejected</Badge>
        <Badge color="gray" size="md">{waiting} waiting</Badge>
        {published > 0 && <Badge color="gray" size="md">{published} published</Badge>}
      </div>

      {ready && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3">
          <CheckCircle className="size-5 text-fg-success-primary" />
          <span className="flex-1 text-sm text-primary">
            {day.firstArticle ? "A draft is ready" : "Your first draft is ready"}: <span className="font-medium">{ready.title}</span>
          </span>
          <Button size="sm" iconTrailing={ArrowRight} onClick={() => openFromStart(ready.postId!)}>
            Open the draft
          </Button>
        </div>
      )}

      {pitches.length === 0 && pitchingEnded ? (
        <p className="rounded-lg bg-secondary px-3.5 py-2.5 text-sm text-primary">
          No first pitches came through this time. The Pitcher writes your first batch on its next morning run, and it lands here and in the Pipeline.
        </p>
      ) : pitches.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-tertiary">
          <Spinner /> The Strategist is writing your first pitches. They show up here one topic at a time.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {pitches.map((p) => (
            <PitchCard
              key={p.id}
              p={p}
              draft={draftState(p, day, progress)}
              open={open === p.id}
              onToggle={() => setOpen((o) => (o === p.id ? null : p.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PitchCard({ p, draft, open, onToggle }: { p: PipelineItem; draft: ReturnType<typeof draftState>; open: boolean; onToggle: () => void }) {
  const { settings } = usePipeline();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = p.stage === "pitched";
  const grade = fitGrade(p.reasons);

  const approve = async () => {
    setBusy(true);
    try {
      await approvePitch(p.id, { writerId: p.writerId, reviewerId: settings.meId, publishBy: p.publishBy, notes: p.notes });
      track("getting_started_pitch", { decision: "approved", drafted: draft === "ready" });
    } catch (err) {
      reportError("Getting started: pitch not approved", err);
      toast.add({ type: "error", title: "Couldn't approve that pitch", description: userMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cx(!pending && p.stage !== "published" && "opacity-80")}>
      <div className="flex w-full items-start gap-3 px-5 py-4">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-tertiary">
            {p.topics[0] && <span>{p.topics[0]}</span>}
            <Badge color={grade === "strong" ? "success" : "gray"} size="sm">{FIT_LABEL[grade]}</Badge>
            {p.learned && <Badge color="gray" size="sm">New</Badge>}
          </div>
          <p className="type-heading text-primary">{p.title}</p>
          {p.why && <p className="mt-1 text-sm text-secondary">{p.why}</p>}
          {p.learned && <p className="mt-1 text-sm text-tertiary italic">{p.learned}</p>}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {p.stage === "published" && <Badge color="success" size="sm">Published</Badge>}
          {["writing", "in_review", "scheduled"].includes(p.stage) && <Badge color="success" size="sm">Approved</Badge>}
          {p.stage === "rejected" && <Badge color="gray" size="sm">Rejected</Badge>}
          {p.stage === "not_now" && <Badge color="gray" size="sm">Not now</Badge>}
          <button type="button" onClick={onToggle} aria-label={open ? "Collapse" : "Expand"}>
            <ChevronDown className={cx("size-4 text-quaternary transition", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {draft && p.stage !== "rejected" && p.stage !== "not_now" && p.stage !== "published" && (
        <div className="-mt-1 px-5 pb-4">
          {draft === "ready" ? (
            <button
              type="button"
              onClick={() => openFromStart(p.postId!)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-primary ring-1 ring-secondary ring-inset hover:bg-primary_hover"
            >
              <CheckCircle className="size-4 text-fg-success-primary" /> Draft ready: open it <ArrowRight className="size-4 text-quaternary" />
            </button>
          ) : draft === "failed" ? (
            <p className="text-xs text-tertiary">The Writer couldn't finish this draft. Approve the pitch and it tries again.</p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-tertiary">
              <Spinner /> The Writer is drafting it
            </p>
          )}
        </div>
      )}

      {open && (
        <>
          <div className="grid gap-4 border-t border-secondary px-5 py-4 text-sm md:grid-cols-2">
            <div className="flex flex-col gap-3">
              {p.angle && <Field label="Angle">{p.angle}</Field>}
              {p.audience && <Field label="Audience">{p.audience}</Field>}
              {p.sources.length > 0 && (
                <Field label="Sources">
                  <ul className="flex flex-col gap-1">
                    {p.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-primary">
                          {s.label || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
            </div>
            {p.outline.length > 0 && (
              <Field label="Outline">
                <ol className="list-decimal space-y-1 pl-4">
                  {p.outline.map((o) => (
                    <li key={o.id}>{o.text}</li>
                  ))}
                </ol>
              </Field>
            )}
          </div>
          {pending && (
            <div className="flex flex-wrap items-center gap-2 border-t border-secondary px-5 py-3">
              {rejecting ? (
                <>
                  <input
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why not? Your reason shapes the replacement."
                    className="min-w-[14rem] flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary shadow-xs ring-1 ring-primary outline-none ring-inset focus:ring-2 focus:ring-brand"
                  />
                  <Button size="sm" color="tertiary" onClick={() => setRejecting(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    color="secondary"
                    isDisabled={!reason.trim()}
                    onClick={() => {
                      rejectPitch(p.id, reason.trim());
                      track("getting_started_pitch", { decision: "rejected" });
                    }}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" iconLeading={Check} isLoading={busy} onClick={() => void approve()}>
                    Approve
                  </Button>
                  <Button size="sm" color="secondary" iconLeading={XClose} onClick={() => setRejecting(true)}>
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    color="tertiary"
                    onClick={() => {
                      notNowPitch(p.id, "");
                      track("getting_started_pitch", { decision: "not_now" });
                    }}
                  >
                    Not now
                  </Button>
                </>
              )}
            </div>
          )}
          {p.stage === "rejected" && p.rejectReason && (
            <p className="border-t border-secondary px-5 py-3 text-sm text-tertiary">
              “{p.rejectReason}”. {p.learned ? "" : "The Strategist writes one replacement after your note."}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
