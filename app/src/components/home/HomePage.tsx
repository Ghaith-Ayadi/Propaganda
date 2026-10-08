// Home: where the tenant stands this week. What waits on them, what the
// Strategist noticed, the Launch while it runs, the five goals as daily lines
// over the quarter, the month's model spend, and their own recent writing.

import { ArrowRight, AlertTriangle, InfoCircle } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { CostMeter } from "@/components/cost/CostMeter";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { ExampleBadge } from "@/components/shared/ExampleBadge";
import { LineGraph } from "@/components/shared/LineGraph";
import { pageHref } from "@/lib/route";
import { useHome, type DriftNote, type Goal, type Launch } from "./data";
import { RecentWriting } from "./RecentWriting";

export function HomePage() {
  const home = useHome();
  const w = home.thisWeek;

  return (
    <PageBody>
      <PageHeader
        title={home.tenant}
        description={`${home.quarter.label} · week ${home.week} of 13`}
        actions={
          <Button size="md" color="primary" iconTrailing={ArrowRight} href={pageHref("inbox")}>
            {home.inboxTotal === 0 ? "Inbox is clear" : `${home.inboxTotal} in the inbox`}
          </Button>
        }
      />

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-secondary bg-primary px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-tertiary uppercase">This week</h2>
            {home.inboxExample && (
              <ExampleBadge why="Flags, pitches and knowledge rulings are the Inbox's example items until their tables exist. Reviews and planned posts are real." />
            )}
          </div>
          <p className="mt-1 text-md text-primary">{weekLine(w)}</p>
        </div>
        <Button size="sm" color="secondary" iconTrailing={ArrowRight} href={pageHref("pipeline")}>
          Open the pipeline
        </Button>
      </section>

      {home.drift.length > 0 && <Drift notes={home.drift} />}
      {home.launch && <LaunchCard launch={home.launch} />}

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {home.goals.map((g) => (
          <GoalCard key={g.key} goal={g} days={home.quarter.days} />
        ))}
      </div>

      <CostMeter />

      <section className="mt-12">
        <h2 className="font-title text-2xl text-primary">Your writing</h2>
        <RecentWriting />
      </section>
    </PageBody>
  );
}

function weekLine(w: { flags: number; pitches: number; reviews: number; knowledge: number; planned: number }): string {
  const parts = [
    w.pitches && plural(w.pitches, "pitch", "pitches"),
    w.reviews && plural(w.reviews, "review", "reviews"),
    w.flags && plural(w.flags, "flag", "flags"),
    w.knowledge && plural(w.knowledge, "knowledge ruling", "knowledge rulings"),
  ].filter(Boolean) as string[];
  const one = w.flags + w.pitches + w.reviews + w.knowledge === 1;
  const waiting = parts.length === 0 ? "Nothing waits on you." : `${list(parts)} ${one ? "waits" : "wait"} on you.`;
  const planned = w.planned === 0 ? "No posts planned this week." : `${plural(w.planned, "post", "posts")} planned this week.`;
  return `${waiting} ${planned}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function Drift({ notes }: { notes: DriftNote[] }) {
  return (
    <section className="mt-4 rounded-xl border border-secondary bg-primary px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-tertiary uppercase">The Strategist noticed</h2>
        <ExampleBadge why="Drift notes come from the Strategist's weekly check (drift_notes), which doesn't run yet." />
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-secondary">
        {notes.slice(0, 3).map((n) => (
          <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-1 last:pb-0">
            <span className="flex min-w-0 flex-1 gap-2.5 text-md text-secondary">
              {n.severity === "warning" ? (
                <AlertTriangle className="mt-1 size-4 shrink-0 text-fg-warning-secondary" aria-label="Warning" />
              ) : (
                <InfoCircle className="mt-1 size-4 shrink-0 text-fg-quaternary" aria-label="Note" />
              )}
              {n.message}
            </span>
            {n.action && (
              <Button size="sm" color="link-gray" iconTrailing={ArrowRight} href={pageHref(n.action.page, n.action.rest)}>
                {n.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LaunchCard({ launch }: { launch: Launch }) {
  return (
    <section className="mt-4 rounded-xl border border-secondary bg-primary px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-tertiary uppercase">Launch · day {launch.day} of 30</h2>
        <ExampleBadge why="The Launch card reads content_batches and the indexing check, which don't exist yet." />
      </div>
      <p className="mt-1 text-md text-primary">
        {launch.live} of {launch.planned} live.{" "}
        {launch.clusters.map((c) => `${c.name} ${c.live}/${c.planned}`).join(", ")}. Indexed: {launch.indexed} of {launch.live}.
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-tertiary" role="img" aria-label={`${launch.live} of ${launch.planned} launch posts live`}>
        <div className="h-full bg-fg-primary" style={{ width: `${Math.min(100, (launch.live / launch.planned) * 100)}%` }} />
      </div>
      <p className="mt-3 text-sm text-tertiary">{launch.why}</p>
    </section>
  );
}

function GoalCard({ goal, days }: { goal: Goal; days: number }) {
  return (
    <section className="flex flex-col rounded-xl border border-secondary bg-primary px-5 pt-4 pb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-title text-xl text-primary">{goal.name}</h3>
          <p className="text-sm text-tertiary">{goal.question}</p>
        </div>
        {goal.example && <ExampleBadge why={goal.example} />}
      </div>
      <p className="mt-4 font-title text-3xl text-primary tabular-nums">{goal.headline}</p>
      <p className="mt-0.5 text-sm text-tertiary">{goal.detail}</p>
      <div className="mt-5">
        <LineGraph
          label={goal.name}
          points={goal.points}
          totalDays={days}
          target={goal.target}
          changes={goal.changes}
          format={goal.format}
          max={goal.max}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-quaternary">
        <span>Quarter start</span>
        {goal.target && <span>{goal.target.shape === "pace" ? "dashed: the pace to target" : "dashed: target"}</span>}
        <span>Quarter end</span>
      </div>
    </section>
  );
}
