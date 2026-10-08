// The Launch: a new tenant's first 30 days (agents/strategist-cold-start-and-pacing.md,
// section 2). 15 posts produced in 20 days, published over 30, in three batches
// on day 1, 8 and 15. Gone after day 30.

import { Rocket02 } from "@untitledui/icons";
import type { Launch } from "@/lib/goals/types";
import { LAUNCH_WHY } from "@/lib/goals/copy";
import { addDays, shortDate } from "@/lib/goals/quarter";
import { AuthorityExplainer, Card, ProgressBar } from "./bits";
import { cx } from "@/utils/cx";

export function LaunchCard({ launch }: { launch: Launch }) {
  const paceLive = Math.round((launch.target * launch.day) / 30);
  const paceProduced = Math.min(launch.target, Math.round((launch.target * launch.day) / 20));
  return (
    <Card
      icon={<Rocket02 className="size-5" aria-hidden />}
      title={`Launch, day ${launch.day} of 30`}
      subtitle={LAUNCH_WHY}
      footer="Above 20 posts only if you bring something real for each extra one: an expert, your own data, an opinion. Every post carries a named byline."
    >
      <p className="text-sm text-primary">
        <span className="font-medium">
          {launch.live} of {launch.target} live
        </span>
        {launch.clusters.map((c) => (
          <span key={c.name} className="text-secondary">
            {" · "}
            {c.name} {c.live}/{c.planned}
          </span>
        ))}
        <span className="text-secondary"> · Indexed: {launch.indexed} of {launch.live}</span>
      </p>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Meter label="Produced (approved drafts)" value={launch.produced} max={launch.target} pace={paceProduced} note={`All ${launch.target} written by day 20 (${shortDate(addDays(launch.startedAt, 19))}).`} />
        <Meter label="Published" value={launch.live} max={launch.target} pace={paceLive} note={launch.longestGap > 4 ? `Longest gap so far: ${launch.longestGap} days. The rule is 4.` : "Spread over 30 days, never more than 4 days quiet."} />
      </div>

      <ol className="mt-6 grid gap-3 md:grid-cols-3">
        {launch.batches.map((b) => {
          const due = addDays(launch.startedAt, b.dueDay - 1);
          const arrived = b.arrived;
          return (
            <li key={b.number} className={cx("rounded-xl p-3 ring-1 ring-secondary ring-inset", !arrived && "opacity-70")}>
              <p className="text-sm font-medium text-primary">
                Batch {b.number} · day {b.dueDay}
              </p>
              <p className="text-xs text-tertiary">{shortDate(due)}</p>
              <p className="mt-2 text-sm text-secondary">
                {b.number === 1 ? `${b.briefs} briefs, 3 already written` : `${b.briefs} briefs`}
              </p>
              <p className="text-sm text-tertiary">{arrived ? `${b.drafted} drafted · ${b.approved} approved` : "Not in your inbox yet"}</p>
            </li>
          );
        })}
      </ol>

      <div className="mt-5">
        <AuthorityExplainer />
      </div>
    </Card>
  );
}

function Meter({ label, value, max, pace, note }: { label: string; value: number; max: number; pace: number; note: string }) {
  const behind = value < pace - 1;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="text-secondary">{label}</span>
        <span className="text-tertiary tabular-nums">
          {value} / {max} <span className={behind ? "text-warning-primary" : "text-quaternary"}>(pace {pace})</span>
        </span>
      </div>
      <ProgressBar value={value} max={max} marker={pace} />
      <p className="mt-1.5 text-xs text-quaternary">{note}</p>
    </div>
  );
}
