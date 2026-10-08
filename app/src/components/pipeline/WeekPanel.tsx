// The pipeline's one-week panel: every day with full titles and details, the
// cadence line on top, open slots marked. Full height beside the board on a
// wide screen, below it otherwise.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "@untitledui/icons";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { addDays, dayLabel, weekLabel, weekStart, ymd } from "@/lib/pipeline/dates";
import { personById, usePipeline } from "@/lib/pipeline/store";
import { STAGE_LABEL, type PipelineItem } from "@/lib/pipeline/types";
import { cx } from "@/utils/cx";
import { TopicBadge } from "./bits";
import { openItem, usePostTitles } from "./shared";

/** The day an item sits on: its slot once scheduled, its publish-by date before. */
function dayOf(i: PipelineItem): string {
  return i.scheduledFor?.date ?? i.publishBy;
}

export function WeekPanel() {
  const { items, people, settings } = usePipeline();
  const titles = usePostTitles(items);
  const [offset, setOffset] = useState(0);
  const today = ymd(new Date());
  const start = useMemo(() => addDays(weekStart(new Date()), offset * 7), [offset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, n) => addDays(start, n)), [start]);
  const from = ymd(days[0]);
  const to = ymd(days[6]);

  const inWeek = items.filter((i) => i.stage !== "pitched" && i.stage !== "rejected" && dayOf(i) >= from && dayOf(i) <= to);
  const published = inWeek.filter((i) => i.stage === "published").length;

  return (
    <aside className="flex shrink-0 flex-col border-t border-secondary bg-primary xl:h-full xl:w-[400px] xl:overflow-y-auto xl:border-t-0 xl:border-l">
      <div className="flex items-start justify-between gap-3 px-4 pt-6 pb-4 md:px-8 xl:px-6">
        <div>
          <div className="text-xs font-semibold tracking-wide text-tertiary uppercase">
            {offset === 0 ? "This week" : offset === 1 ? "Next week" : offset === -1 ? "Last week" : "Week"}
          </div>
          <div className="mt-1 font-title text-2xl text-primary">{weekLabel(start)}</div>
        </div>
        <div className="flex gap-1.5">
          <ButtonUtility size="sm" color="secondary" icon={ChevronLeft} tooltip="Previous week" onClick={() => setOffset((o) => o - 1)} />
          <ButtonUtility size="sm" color="secondary" icon={ChevronRight} tooltip="Next week" onClick={() => setOffset((o) => o + 1)} />
        </div>
      </div>
      <div className="border-y border-secondary px-4 py-3 text-sm text-tertiary md:px-8 xl:px-6">
        Cadence goal {settings.cadence} a week · {inWeek.length - published} planned · {published} published
      </div>

      <ol>
        {days.map((d) => {
          const key = ymd(d);
          const dayItems = inWeek.filter((i) => dayOf(i) === key);
          const openSlot = dayItems.length === 0 && settings.slotDays.includes(d.getDay()) && key >= today;
          return (
            <li key={key} className="border-b border-secondary px-4 py-4 md:px-8 xl:px-6">
              <div className="flex items-center justify-between text-sm font-semibold text-primary">
                <span>{dayLabel(d)}</span>
                {key === today && <span className="font-normal text-tertiary">today</span>}
              </div>
              {dayItems.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => openItem(i)}
                  className={cx(
                    "mt-2 flex w-full flex-col gap-1.5 rounded-lg p-3 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-hidden",
                    i.stage === "published" ? "bg-success-primary hover:bg-success-secondary" : "bg-secondary hover:bg-secondary_hover",
                  )}
                >
                  <span className="text-md text-primary">{(i.postId && titles.get(i.postId)) || i.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-tertiary">
                    <TopicBadge>{i.collection}</TopicBadge>
                    {personById(people, i.writerId)?.name}
                  </span>
                  <span className="text-sm text-tertiary">
                    {i.scheduledFor && <span className="mr-1.5 font-mono">{i.scheduledFor.time}</span>}
                    {i.scheduledFor ? STAGE_LABEL[i.stage] : `Due · ${STAGE_LABEL[i.stage]}`}
                  </span>
                </button>
              ))}
              {openSlot && (
                <div className="mt-2 rounded-lg border border-dashed border-primary px-3 py-2.5 text-sm text-tertiary">
                  Open slot. Approve a pitch to fill it.
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
