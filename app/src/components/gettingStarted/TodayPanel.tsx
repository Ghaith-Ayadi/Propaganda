// The right panel: today's timeline, what's done and about how long is left.

import { useEffect, useState } from "react";
import { Check, Clock } from "@untitledui/icons";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/shell/Card";
import { cx } from "@/utils/cx";
import { Spinner } from "./bits";
import { minutesLeft, TIMELINE, type StepId } from "./state";

export function TodayPanel({ done, active }: { done: Set<StepId>; active: Set<StepId> }) {
  const all = done.size === TIMELINE.length;
  return (
    <aside className="w-full shrink-0 max-lg:hidden lg:sticky lg:top-36 lg:w-80">
      <Card>
        <CardHeader
          title="Today with Propaganda"
          description={all ? "All done for today." : `About ${minutesLeft(done, active)} min left`}
          icon={<Clock className="size-5" />}
        />
        <CardBody>
          <ol className="relative flex flex-col">
            {TIMELINE.map((t, i) => {
              const isDone = done.has(t.id);
              const isActive = !isDone && active.has(t.id);
              return (
                <li key={t.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < TIMELINE.length - 1 && (
                    <span className={cx("absolute top-6 left-[11px] h-[calc(100%-1.25rem)] w-px", isDone ? "bg-fg-success-primary/40" : "bg-border-secondary")} />
                  )}
                  <span
                    className={cx(
                      "relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs",
                      isDone && "bg-success-solid text-white",
                      isActive && "bg-brand-solid text-white",
                      !isDone && !isActive && "bg-primary text-quaternary ring-1 ring-secondary ring-inset",
                    )}
                  >
                    {isDone ? <Check className="size-3.5" /> : isActive && t.agent ? <Spinner light /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cx("text-sm", isActive ? "font-medium text-primary" : isDone ? "text-tertiary" : "text-secondary")}>{t.label}</p>
                    <p className="text-xs text-quaternary">
                      {t.agent ? "Agent · " : ""}~{t.minutes} min
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardBody>
        <CardFooter>Leave any time; this page picks up where you stopped.</CardFooter>
      </Card>
    </aside>
  );
}

/** On a phone the panel is one line above the step. */
export function PhoneProgress({ step, done, active }: { step: StepId; done: Set<StepId>; active: Set<StepId> }) {
  const i = TIMELINE.findIndex((t) => t.id === step);
  return (
    <div className="mb-5 flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm text-secondary lg:hidden">
      <span>
        Step {i + 1} of {TIMELINE.length}: {TIMELINE[i]?.label}
      </span>
      <span className="text-tertiary">~{minutesLeft(done, active)} min left</span>
    </div>
  );
}

/** Re-renders every `ms`, for elapsed times. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
