// Pipeline (#/pipeline, lib/routes.ts): the board (Pitched, Writing, In review, Scheduled)
// plus a full-height panel with one week. Ideas never show: the agent only
// pitches what has a reason behind it. Published posts live under Content.
// The pitch brief opens over the board at #/pipeline/pitch/<id>; the review
// screen is #/pipeline/review/<id>.

import { useMemo } from "react";
import { Plus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { go, usePageRest } from "@/lib/route";
import { getActiveCollection } from "@/lib/activeCollection";
import { byFitThenDate } from "@/lib/pipeline/fit";
import { shortDate } from "@/lib/pipeline/dates";
import { personById, usePipeline, writeYourself } from "@/lib/pipeline/store";
import { BOARD_STAGES, STAGE_LABEL, type PipelineItem, type Stage } from "@/lib/pipeline/types";
import { reportError } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { FitBadge, Handoff, NotesBadge, TopicBadge } from "./bits";
import { WeekPanel } from "./WeekPanel";
import { PitchDrawer } from "./PitchDrawer";
import { openItem, usePostTitles } from "./shared";
import { ReviewPage } from "./ReviewPage";

export function PipelinePage() {
  const rest = usePageRest();
  const review = rest?.match(/^review\/(.+)$/)?.[1];
  if (review) return <ReviewPage id={decodeURIComponent(review)} />;
  return <Board pitchId={rest?.match(/^pitch\/(.+)$/)?.[1]} />;
}

function Board({ pitchId }: { pitchId?: string }) {
  const { items, people, settings, batch, placeholder } = usePipeline();
  const titles = usePostTitles(items);

  const columns = useMemo(() => {
    const by: Record<Stage, PipelineItem[]> = { pitched: [], writing: [], in_review: [], scheduled: [], published: [], rejected: [] };
    for (const i of items) by[i.stage].push(i);
    by.pitched.sort(byFitThenDate);
    by.writing.sort((a, b) => a.publishBy.localeCompare(b.publishBy));
    by.in_review.sort((a, b) => a.publishBy.localeCompare(b.publishBy));
    by.scheduled.sort((a, b) => (a.scheduledFor?.date ?? a.publishBy).localeCompare(b.scheduledFor?.date ?? b.publishBy));
    return by;
  }, [items]);

  const onWrite = async () => {
    try {
      const postId = await writeYourself(getActiveCollection());
      if (postId) go({ view: "post", id: postId });
    } catch (err) {
      reportError("pipeline.writeYourself", err);
      toast.add({ type: "error", title: "Couldn't create a draft", description: "Try again in a moment." });
    }
  };

  return (
    <div className="flex min-h-full flex-col xl:h-full xl:flex-row xl:overflow-hidden">
      <section className="min-w-0 flex-1 px-4 pt-6 pb-10 md:px-8 md:pt-10 xl:overflow-y-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-title text-4xl text-primary">Pipeline</h1>
            <p className="mt-2 text-md text-tertiary">
              The agent only pitches ideas with a reason behind them. The rest are set aside with that reason, and you never
              see them.
            </p>
          </div>
          <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => void onWrite()} className="self-start md:self-auto">
            Write something yourself
          </Button>
        </div>

        {placeholder && (
          <p className="mt-4 text-sm text-quaternary">
            Example data for a made-up tenant. Approving a pitch creates a real draft in your Test collection.
          </p>
        )}

        <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
          <div className="grid min-w-[1040px] grid-cols-4 gap-4 xl:min-w-[880px]">
            {BOARD_STAGES.map((stage) => (
              <Column
                key={stage}
                stage={stage}
                items={columns[stage]}
                hint={
                  stage === "pitched"
                    ? `${batch ? `Batch ${batch.number} of ${batch.total}, one review session. ` : ""}Waiting on you: approve, add notes, or reject with a reason.`
                    : undefined
                }
                render={(item) => (
                  <Card key={item.id} item={item} title={(item.postId && titles.get(item.postId)) || item.title}>
                    {item.stage === "pitched" ? (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          <FitBadge reasons={item.reasons} />
                          {item.topics.map((t) => (
                            <TopicBadge key={t}>{t}</TopicBadge>
                          ))}
                        </div>
                        <div className="text-sm text-tertiary">
                          {personById(people, item.writerId)?.name} · by {shortDate(item.publishBy)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          <TopicBadge>{item.collection}</TopicBadge>
                          {item.stage === "writing" && <NotesBadge count={item.notes.filter((n) => !n.done).length} />}
                          {item.sentBackNote && item.stage === "writing" && (
                            <span className="text-xs font-medium text-error-primary">Sent back</span>
                          )}
                        </div>
                        {item.stage === "scheduled" ? (
                          <div className="text-sm text-tertiary">
                            {personById(people, item.writerId)?.name} · {shortDate(item.scheduledFor?.date ?? item.publishBy)}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-2 text-sm text-tertiary">
                            <Handoff
                              writer={personById(people, item.writerId)}
                              reviewer={personById(people, item.reviewerId)}
                              meId={settings.meId}
                            />
                            <span>by {shortDate(item.publishBy)}</span>
                          </div>
                        )}
                      </>
                    )}
                  </Card>
                )}
              />
            ))}
          </div>
        </div>
      </section>

      <WeekPanel />

      {pitchId && <PitchDrawer id={pitchId} />}
    </div>
  );
}

function Column({
  stage,
  items,
  hint,
  render,
}: {
  stage: Stage;
  items: PipelineItem[];
  hint?: string;
  render: (i: PipelineItem) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-secondary/60 p-2">
      <div className="px-2 pt-1">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wide text-tertiary uppercase">
          <span>{STAGE_LABEL[stage]}</span>
          <span>{items.length}</span>
        </div>
        {hint && <p className="mt-1 text-sm text-tertiary">{hint}</p>}
      </div>
      {items.map(render)}
      {items.length === 0 && <p className="px-2 py-3 text-sm text-quaternary">Nothing here.</p>}
    </div>
  );
}

function Card({ item, title, children }: { item: PipelineItem; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => openItem(item)}
      className={cx(
        "flex flex-col gap-2 rounded-lg bg-primary p-3 text-left shadow-xs ring-1 ring-secondary transition ring-inset",
        "hover:ring-primary focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-hidden",
      )}
    >
      <span className="text-md font-medium text-primary">{title}</span>
      {children}
    </button>
  );
}
