// The pipeline's calendar panel, full height beside the board on a wide screen
// (below it otherwise). Week: every day with full titles and details, the
// cadence line on top, open slots marked; the arrows move a week up or down.
// Month: about one month per screen height, scrolling through the months
// around this quarter, with a divider at each quarter; the arrows jump a month.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "@untitledui/icons";
import { ButtonGroup, ButtonGroupItem } from "@/components/base/button-group/button-group";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { addDays, dayLabel, weekLabel, weekStart, ymd } from "@/lib/pipeline/dates";
import { isReleased, personById, usePipeline } from "@/lib/pipeline/store";
import { STAGE_LABEL, type PipelineItem, type Stage } from "@/lib/pipeline/types";
import { cx } from "@/utils/cx";
import { TopicBadge } from "./bits";
import { openItem, usePostTitles } from "./shared";

type Mode = "week" | "month";

/** The day an item sits on: its slot once scheduled, its publish-by date before. */
function dayOf(i: PipelineItem): string {
  return i.scheduledFor?.date ?? i.publishBy;
}

const CHIP: Partial<Record<Stage, string>> = {
  writing: "bg-utility-amber-50 text-utility-amber-700",
  in_review: "bg-utility-purple-50 text-utility-purple-700",
  scheduled: "bg-utility-blue-50 text-utility-blue-700",
  published: "bg-utility-green-50 text-utility-green-700",
};

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarPanel() {
  const { items, batches } = usePipeline();
  const [mode, setMode] = useState<Mode>("week");
  const [offset, setOffset] = useState(0);
  const monthsRef = useRef<HTMLDivElement>(null);

  /** On the calendar: everything past the pitch stage, from released batches. */
  const placed = useMemo(
    () => items.filter((i) => i.stage !== "pitched" && i.stage !== "rejected" && isReleased(i, batches)),
    [items, batches],
  );

  const jumpMonth = (dir: 1 | -1) => {
    const box = monthsRef.current;
    if (!box) return;
    const months = [...box.querySelectorAll<HTMLElement>("[data-month]")];
    const top = box.scrollTop + 4;
    const target =
      dir === 1 ? months.find((m) => m.offsetTop > top) : [...months].reverse().find((m) => m.offsetTop < top - 8);
    if (target) box.scrollTo({ top: target.offsetTop, behavior: "smooth" });
  };

  const start = useMemo(() => addDays(weekStart(new Date()), offset * 7), [offset]);

  return (
    <aside className="flex shrink-0 flex-col border-t border-secondary bg-primary xl:h-full xl:w-[420px] xl:border-t-0 xl:border-l">
      <div className="flex items-start justify-between gap-3 px-4 pt-6 pb-4 md:px-8 xl:px-6">
        <div>
          <div className="type-eyebrow text-tertiary">
            {mode === "month"
              ? "Month"
              : offset === 0
                ? "This week"
                : offset === 1
                  ? "Next week"
                  : offset === -1
                    ? "Last week"
                    : "Week"}
          </div>
          <div className="mt-1 type-title text-primary">{mode === "week" ? weekLabel(start) : "Calendar"}</div>
        </div>
        <div className="flex items-center gap-2">
          <ButtonGroup
            size="sm"
            selectedKeys={[mode]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const next = [...keys][0] as Mode | undefined;
              if (next) setMode(next);
            }}
          >
            <ButtonGroupItem id="week">Week</ButtonGroupItem>
            <ButtonGroupItem id="month">Month</ButtonGroupItem>
          </ButtonGroup>
          <div className="flex gap-1">
            <ButtonUtility
              size="sm"
              color="secondary"
              icon={ChevronUp}
              tooltip={mode === "week" ? "Previous week" : "Previous month"}
              onClick={() => (mode === "week" ? setOffset((o) => o - 1) : jumpMonth(-1))}
            />
            <ButtonUtility
              size="sm"
              color="secondary"
              icon={ChevronDown}
              tooltip={mode === "week" ? "Next week" : "Next month"}
              onClick={() => (mode === "week" ? setOffset((o) => o + 1) : jumpMonth(1))}
            />
          </div>
        </div>
      </div>

      {mode === "week" ? (
        <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          <WeekView start={start} placed={placed} />
        </div>
      ) : (
        <div ref={monthsRef} className="relative h-[85dvh] overflow-y-auto border-t border-secondary xl:h-auto xl:min-h-0 xl:flex-1">
          <MonthsView placed={placed} scrollBox={monthsRef} />
        </div>
      )}
    </aside>
  );
}

function WeekView({ start, placed }: { start: Date; placed: PipelineItem[] }) {
  const { people, settings, items } = usePipeline();
  const titles = usePostTitles(items);
  const today = ymd(new Date());
  const days = Array.from({ length: 7 }, (_, n) => addDays(start, n));
  const from = ymd(days[0]);
  const to = ymd(days[6]);
  const inWeek = placed.filter((i) => dayOf(i) >= from && dayOf(i) <= to);
  const published = inWeek.filter((i) => i.stage === "published").length;

  return (
    <>
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
              <div className="flex items-center justify-between text-sm font-medium text-primary">
                <span>{dayLabel(d)}</span>
                {key === today && <span className="font-normal text-tertiary">today</span>}
              </div>
              {dayItems.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => void openItem(i)}
                  className={cx(
                    "mt-2 flex w-full flex-col gap-1.5 rounded-lg p-3 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-hidden",
                    i.stage === "published" ? "bg-success-primary hover:bg-success-secondary" : "bg-secondary hover:bg-secondary_hover",
                  )}
                >
                  <span className="text-sm text-primary">{(i.postId && titles.get(i.postId)) || i.title}</span>
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
    </>
  );
}

/** The quarter before this one through the quarter after. */
function monthRange(): Date[] {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) * 3;
  return Array.from({ length: 9 }, (_, n) => new Date(now.getFullYear(), q - 3 + n, 1));
}

function MonthsView({ placed, scrollBox }: { placed: PipelineItem[]; scrollBox: React.RefObject<HTMLDivElement | null> }) {
  const { settings, items } = usePipeline();
  const titles = usePostTitles(items);
  const months = useMemo(monthRange, []);
  const today = ymd(new Date());
  const thisMonth = useRef<HTMLElement>(null);

  // Open on the current month.
  useEffect(() => {
    const box = scrollBox.current;
    const el = thisMonth.current;
    if (box && el) box.scrollTop = el.offsetTop;
  }, [scrollBox]);

  return (
    <>
      {months.map((m) => {
        const firstOfQuarter = m.getMonth() % 3 === 0;
        const isThisMonth = m.getFullYear() === new Date().getFullYear() && m.getMonth() === new Date().getMonth();
        const gridStart = weekStart(m);
        const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
        const weeks = Math.ceil((((m.getDay() + 6) % 7) + last.getDate()) / 7);
        const monthKey = `${m.getFullYear()}-${m.getMonth()}`;
        return (
          <section
            key={monthKey}
            data-month={monthKey}
            ref={isThisMonth ? thisMonth : undefined}
            className="flex min-h-[calc(100dvh-140px)] flex-col px-4 pt-3 pb-5 md:px-8 xl:px-6"
          >
            {firstOfQuarter && (
              <div className="mb-3 flex items-center gap-3 type-eyebrow text-brand-secondary">
                Q{m.getMonth() / 3 + 1} {m.getFullYear()}
                <span className="h-px flex-1 bg-border-brand" />
              </div>
            )}
            <h3 className="mb-2 type-heading text-primary">{MONTH.format(m)}</h3>
            <div className="grid grid-cols-7 text-center text-xs text-quaternary">
              {WEEKDAYS.map((w) => (
                <div key={w} className="pb-1">
                  {w}
                </div>
              ))}
            </div>
            <div
              className="grid flex-1 grid-cols-7 overflow-hidden rounded-lg ring-1 ring-secondary ring-inset"
              style={{ gridTemplateRows: `repeat(${weeks}, minmax(84px, 1fr))` }}
            >
              {Array.from({ length: weeks * 7 }, (_, n) => {
                const d = addDays(gridStart, n);
                const key = ymd(d);
                const inMonth = d.getMonth() === m.getMonth();
                const dayItems = inMonth ? placed.filter((i) => dayOf(i) === key) : [];
                const openSlot = inMonth && !dayItems.length && settings.slotDays.includes(d.getDay()) && key >= today;
                return (
                  <div
                    key={key}
                    className={cx(
                      "flex min-w-0 flex-col gap-0.5 border-r border-b border-secondary p-1",
                      n % 7 === 6 && "border-r-0",
                      !inMonth && "bg-secondary/50",
                    )}
                  >
                    <span
                      className={cx(
                        "self-end px-1 text-xs",
                        !inMonth ? "text-quaternary/50" : key === today ? "rounded-full bg-brand-solid text-white" : "text-tertiary",
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {dayItems.slice(0, 2).map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => void openItem(i)}
                        title={`${(i.postId && titles.get(i.postId)) || i.title} · ${STAGE_LABEL[i.stage]}`}
                        className={cx("line-clamp-2 rounded px-1 py-0.5 text-left text-xs leading-tight font-medium break-words", CHIP[i.stage])}
                      >
                        {(i.postId && titles.get(i.postId)) || i.title}
                      </button>
                    ))}
                    {dayItems.length > 2 && <span className="px-1 text-xs text-tertiary">+{dayItems.length - 2} more</span>}
                    {openSlot && (
                      <span className="mt-auto rounded border border-dashed border-primary px-1 text-center text-xs text-quaternary" title="Open slot. Approve a pitch to fill it.">
                        Open
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
