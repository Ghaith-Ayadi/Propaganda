// Content pipeline (#/pipeline, lib/routes.ts): the board (Pitched, Writing,
// In review, Scheduled) plus a full-height calendar panel (week or month).
// Ideas never show: the agent only pitches what has a reason behind it, and
// pitches of a batch not released yet stay off the board. Published posts live
// under Content. The pitch brief opens over the board at #/pipeline/pitch/<id>;
// review happens in the post screen's Review tab.
//
// The header sits in the shared container; the board and the calendar run
// edge to edge below it.

import { useMemo, useState } from "react";
import { Plus } from "@untitledui/icons";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { toast } from "@/components/base/toast/toast";
import { PageHeader } from "@/components/shell/PageHeader";
import { go, goPage, usePageRest } from "@/lib/route";
import { getActiveCollection } from "@/lib/activeCollection";
import { byFitThenDate } from "@/lib/pipeline/fit";
import { shortDate } from "@/lib/pipeline/dates";
import {
  addToColumn,
  isReleased,
  personById,
  usePipeline,
} from "@/lib/pipeline/store";
import {
  BOARD_STAGES,
  STAGE_LABEL,
  type PipelineItem,
  type Stage,
} from "@/lib/pipeline/types";
import { reportError } from "@/lib/telemetry";
import { cx } from "@/utils/cx";
import { FitBadge, Handoff, NotesBadge, TopicBadge } from "./bits";
import { BatchButton } from "./BatchPanel";
import { CalendarPanel } from "./CalendarPanel";
import { PitchDrawer } from "./PitchDrawer";
import { openItem, usePostTitles } from "./shared";

/** Columns that take a + (Scheduled fills from review, never by hand). */
const ADDABLE: Stage[] = ["pitched", "writing", "in_review"];

const ADD_PLACEHOLDER: Partial<Record<Stage, string>> = {
  pitched: "Your idea, as a title",
  writing: "Title of what you'll write",
  in_review: "Title of the draft to review",
};

export function PipelinePage() {
  const rest = usePageRest();
  const { items, people, settings, batches } = usePipeline();
  const titles = usePostTitles(items);
  const pitchId = rest?.match(/^pitch\/(.+)$/)?.[1];

  const columns = useMemo(() => {
    const by: Record<Stage, PipelineItem[]> = {
      pitched: [],
      writing: [],
      in_review: [],
      scheduled: [],
      published: [],
      rejected: [],
      not_now: [],
    };
    for (const i of items) if (isReleased(i, batches)) by[i.stage].push(i);
    by.pitched.sort(byFitThenDate);
    by.writing.sort((a, b) => a.publishBy.localeCompare(b.publishBy));
    by.in_review.sort((a, b) => a.publishBy.localeCompare(b.publishBy));
    by.scheduled.sort((a, b) =>
      (a.scheduledFor?.date ?? a.publishBy).localeCompare(
        b.scheduledFor?.date ?? b.publishBy,
      ),
    );
    return by;
  }, [items, batches]);

  return (
    <div className="flex min-h-full flex-col xl:h-full">
      <PageHeader
        title="Content pipeline"
        actions={<BatchButton />}
      />

      <div className="flex flex-col xl:min-h-0 xl:flex-1 xl:flex-row">
        <section className="min-w-0 flex-1 xl:overflow-y-auto">
          <div className="overflow-x-auto px-4 pt-6 pb-10 md:px-8">
            <div className="grid min-w-[1040px] grid-cols-4 gap-4 xl:min-w-[880px]">
              {BOARD_STAGES.map((stage) => (
                <Column key={stage} stage={stage} items={columns[stage]}>
                  {columns[stage].map((item) => (
                    <Card
                      key={item.id}
                      item={item}
                      title={
                        (item.postId && titles.get(item.postId)) || item.title
                      }
                    >
                      {item.stage === "pitched" ? (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {item.reasons.length > 0 ? (
                              <FitBadge reasons={item.reasons} />
                            ) : (
                              <TopicBadge>Your idea</TopicBadge>
                            )}
                            {item.topics.map((t) => (
                              <TopicBadge key={t}>{t}</TopicBadge>
                            ))}
                          </div>
                          {item.learned && (
                            <p className="line-clamp-2 text-sm text-tertiary italic">
                              {item.learned}
                            </p>
                          )}
                          <div className="text-sm text-tertiary">
                            {personById(people, item.writerId)?.name} · by{" "}
                            {shortDate(item.publishBy)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            <TopicBadge>{item.collection}</TopicBadge>
                            {item.stage === "writing" && (
                              <NotesBadge
                                count={item.notes.filter((n) => !n.done).length}
                              />
                            )}
                            {item.sentBackNote && item.stage === "writing" && (
                              <span className="text-xs font-medium text-error-primary">
                                Sent back
                              </span>
                            )}
                          </div>
                          {item.stage === "scheduled" ? (
                            <div className="text-sm text-tertiary">
                              {personById(people, item.writerId)?.name} ·{" "}
                              {shortDate(
                                item.scheduledFor?.date ?? item.publishBy,
                              )}
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
                  ))}
                </Column>
              ))}
            </div>
          </div>
        </section>

        <CalendarPanel />
      </div>

      {pitchId && <PitchDrawer id={decodeURIComponent(pitchId)} />}
    </div>
  );
}

function Column({
  stage,
  items,
  children,
}: {
  stage: Stage;
  items: PipelineItem[];
  children: React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const addable = ADDABLE.includes(stage);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const item = await addToColumn(stage, title, getActiveCollection());
      setAdding(false);
      setTitle("");
      if (!item) throw new Error("addToColumn returned nothing");
      if (item.stage === "pitched") goPage("pipeline", `pitch/${item.id}`);
      else if (item.postId) go({ view: "post", id: item.postId });
    } catch (err) {
      reportError("pipeline.addToColumn", err);
      toast.add({
        type: "error",
        title: "Couldn't add it",
        description: "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-secondary/60 p-2">
      <div className="flex h-8 items-center justify-between pl-2 type-eyebrow text-tertiary">
        <span>
          {STAGE_LABEL[stage]}{" "}
          <span className="ml-1 font-normal text-quaternary">
            {items.length}
          </span>
        </span>
        {addable && (
          <ButtonUtility
            size="xs"
            color="tertiary"
            icon={Plus}
            tooltip={
              stage === "pitched"
                ? "Pitch an idea"
                : `Add to ${STAGE_LABEL[stage]}`
            }
            onClick={() => setAdding(true)}
          />
        )}
      </div>
      {adding && (
        <form
          className="rounded-lg bg-primary p-2 shadow-xs ring-1 ring-brand ring-inset"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAdding(false);
                setTitle("");
              }
            }}
            onBlur={() => !title.trim() && !busy && setAdding(false)}
            placeholder={ADD_PLACEHOLDER[stage]}
            aria-label={ADD_PLACEHOLDER[stage]}
            className="w-full bg-transparent px-1 py-1 text-sm text-primary outline-hidden placeholder:text-placeholder"
          />
          <p className="px-1 text-xs text-quaternary">
            Enter to add, Esc to cancel
          </p>
        </form>
      )}
      {children}
      {items.length === 0 && !adding && (
        <p className="px-2 py-3 text-sm text-quaternary">Nothing here.</p>
      )}
    </div>
  );
}

function Card({
  item,
  title,
  children,
}: {
  item: PipelineItem;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => void openItem(item)}
      className={cx(
        "flex flex-col gap-2 rounded-lg bg-primary p-3 text-left shadow-xs ring-1 ring-secondary transition ring-inset",
        "hover:ring-primary focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-hidden",
      )}
    >
      <span className="type-heading text-primary">{title}</span>
      {children}
    </button>
  );
}
