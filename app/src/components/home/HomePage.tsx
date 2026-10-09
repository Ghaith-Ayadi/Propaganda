// Home: where the tenant stands. The campaign running now (the Launch first),
// the four goals as small cards with the quarter's goal under each, the
// month's model spend, and their own recent writing. What waits on them is the
// Inbox's job; the button in the header goes there.

import { ArrowDown, ArrowRight, ArrowUp } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { CostMeter } from "@/components/cost/CostMeter";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/shared/Card";
import { ExampleBadge } from "@/components/shared/ExampleBadge";
import { MiniChart } from "@/components/shared/MiniChart";
import { pageHref } from "@/lib/route";
import { cx } from "@/utils/cx";
import { useHome, type Goal, type Home } from "./data";
import { RecentWriting } from "./RecentWriting";

export function HomePage() {
  const home = useHome();

  return (
    <>
      <PageHeader
        title={home.tenant}
        description={`${home.quarter.label} · week ${home.week} of 13`}
        actions={
          <Button size="md" color="primary" iconTrailing={ArrowRight} href={pageHref("inbox")}>
            {home.inboxTotal === 0 ? "Inbox is clear" : `${home.inboxTotal} in the inbox`}
          </Button>
        }
      />
      <PageBody>
      {home.campaign && <CampaignCard campaign={home.campaign} />}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {home.goals.map((g) => (
          <GoalCard key={g.key} goal={g} />
        ))}
      </div>

      <CostMeter />

      <section className="mt-12">
        <h2 className="font-title text-2xl text-primary">Your writing</h2>
        <RecentWriting />
      </section>
      </PageBody>
    </>
  );
}

function CampaignCard({ campaign: c }: { campaign: NonNullable<Home["campaign"]> }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            <span className="text-sm font-normal text-tertiary">
              day {c.day} of {c.days}
            </span>
          </span>
        }
        description={c.description}
        actions={
          <>
            <ExampleBadge why="Campaigns read the Strategist's plan and the indexing check, which don't exist yet." />
            <Badge type="pill-color" color={c.onTrack ? "success" : "error"} size="sm">
              {c.onTrack ? "On track" : "Off track"}
            </Badge>
          </>
        }
      />
      <CardBody>
        <Progress label="Overall" value={c.progress} detail={`${Math.round(c.progress * 100)}% done, ${Math.round((c.day / c.days) * 100)}% of the time gone`} strong />
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {c.objectives.map((o) => (
            <Progress key={o.label} label={o.label} value={o.value / o.target} detail={`${o.value} of ${o.target}`} />
          ))}
        </div>
      </CardBody>
      <CardFooter>{c.why}</CardFooter>
    </Card>
  );
}

function Progress({ label, value, detail, strong }: { label: string; value: number; detail: string; strong?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={strong ? "font-semibold text-primary" : "text-secondary"}>{label}</span>
        <span className="text-tertiary tabular-nums">{detail}</span>
      </div>
      <div
        className={cx("mt-2 overflow-hidden rounded-full bg-tertiary", strong ? "h-2" : "h-1.5")}
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cx("h-full rounded-full", strong ? "bg-gold" : "bg-fg-secondary")} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const ch = goal.change;
  return (
    <Card>
      <CardHeader title={goal.name} description={goal.question} actions={goal.example && <ExampleBadge why={goal.example} />} />
      <CardBody className="gap-4">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-display-sm font-semibold text-primary tabular-nums">{goal.headline}</p>
            {ch && (
              <p className="mt-2 flex items-center gap-1 text-sm">
                <span
                  className={cx(
                    "flex items-center gap-0.5 font-medium",
                    ch.direction === "up" ? "text-success-primary" : ch.direction === "down" ? "text-error-primary" : "text-tertiary",
                  )}
                >
                  {ch.direction === "up" && <ArrowUp className="size-4" />}
                  {ch.direction === "down" && <ArrowDown className="size-4" />}
                  {ch.text}
                </span>
              </p>
            )}
          </div>
          <MiniChart points={goal.points} label={`${goal.name} this quarter`} />
        </div>
        {goal.topics && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-tertiary">
                <th className="pb-1.5 font-medium">Topic</th>
                <th className="pb-1.5 text-right font-medium">Published</th>
                <th className="pb-1.5 text-right font-medium">Pitched</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {goal.topics.map((t) => (
                <tr key={t.name} className="border-t border-secondary">
                  <td className="py-1.5 text-secondary">{t.name}</td>
                  <td className="py-1.5 text-right text-primary">
                    {t.published} <span className="text-tertiary">of {t.target}</span>
                  </td>
                  <td className="py-1.5 text-right text-primary">{t.pitched}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      <CardFooter>{goal.goal}</CardFooter>
    </Card>
  );
}
