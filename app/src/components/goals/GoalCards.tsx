// The four goals of a quarter, each with its number, the detail behind it and
// its daily score as a line. Separate numbers, never merged. Coverage is no
// longer a goal: it lives in Volume as each topic's pitched count.

import type { QuarterGoals } from "@/lib/goals/types";
import { GOAL_COPY } from "@/lib/goals/copy";
import { quarterEnd, quarterStart, shortDate } from "@/lib/goals/quarter";
import { pct } from "@/lib/goals/score";
import { Card, Headline, ProgressBar, fmtInt, fmtPct } from "./bits";
import { LineChart, type ChangeMark } from "./LineChart";
import { Badge } from "@/components/base/badges/badges";

export function GoalCards({ goals }: { goals: QuarterGoals }) {
  const t = goals.current!.targets;
  const from = quarterStart(goals.quarter);
  const to = quarterEnd(goals.quarter);
  const marks: ChangeMark[] = goals.history
    .filter((v) => v.approvedAt >= from && v.approvedAt <= to)
    .map((v) => ({ day: v.approvedAt, label: v.version === 1 ? "Goals set" : `Goals changed (v${v.version})` }));
  const chart = { from, to, marks };
  const { volume, consistency, readership, ranking } = goals.now;

  const onTarget = t.volume.topics.filter((x) => (volume.byTopic[x.name] ?? 0) >= x.low).length;
  const queries = t.ranking.searches.map((s) => s.query);
  const pageOne = queries.filter((q) => (ranking.positions[q] ?? 999) <= 10).length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* 1. Volume */}
      <Card title={GOAL_COPY.volume.title} subtitle={GOAL_COPY.volume.question} className="lg:col-span-2">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <Headline value={fmtPct(pct(volume.published, t.volume.total))} unit={`${volume.published} of ${t.volume.total} planned posts`} />
            <p className="mt-1 text-sm text-tertiary">
              Topics on target: {onTarget} of {t.volume.topics.length}
              {volume.bonus > 0 && <span className="ml-2 text-quaternary">+{volume.bonus} bonus {volume.bonus === 1 ? "post" : "posts"}</span>}
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-quaternary">
                  <th className="pb-1.5 font-medium">Topic</th>
                  <th className="pb-1.5 text-right font-medium">Goal</th>
                  <th className="pb-1.5 text-right font-medium">Done</th>
                  <th className="pb-1.5 text-right font-medium">Pitched</th>
                </tr>
              </thead>
              <tbody>
                {t.volume.topics.map((x) => {
                  const n = volume.byTopic[x.name] ?? 0;
                  const pitched = volume.pitchedByTopic[x.name] ?? 0;
                  const rejected = volume.rejectedByTopic[x.name] ?? 0;
                  return (
                    <tr key={x.name} className="align-top">
                      <td className="pt-2 pr-3">
                        <span className="block truncate text-secondary">{x.name}</span>
                        <ProgressBar className="mt-1.5" value={n} pitched={pitched} max={Math.max(x.high, n, pitched)} marker={x.low} />
                        {rejected > 0 && (
                          <span className="mt-1 block text-xs text-quaternary">
                            {rejected} {rejected === 1 ? "pitch" : "pitches"} rejected
                          </span>
                        )}
                      </td>
                      <td className="pt-2 pl-2 text-right text-tertiary tabular-nums">{x.low === x.high ? x.low : `${x.low} to ${x.high}`}</td>
                      <td className="pt-2 pl-2 text-right font-medium text-primary tabular-nums">{n}</td>
                      <td className="pt-2 pl-2 text-right text-tertiary tabular-nums">{pitched}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-quaternary">
              Pitched is how hard the Strategist is covering each topic. Rejected pitches don't count as done, so a topic you keep turning down shows here as a shortfall. A post in two topics counts in both, and once in the total.
            </p>
          </div>
          <LineChart label="Volume, % of the quarter's planned posts" points={goals.scores.volume} target={100} pace {...chart} format={fmtPct} minMax={100} />
        </div>
      </Card>

      {/* 2. Consistency */}
      <Card title={GOAL_COPY.consistency.title} subtitle={GOAL_COPY.consistency.question} aside={<Badge type="pill-color" color="success" size="sm">Always A</Badge>}>
        {consistency.contentGrade == null && consistency.kbGrade == null ? (
          <p className="py-6 text-sm text-tertiary">Nothing to check yet. Grades appear once posts are published and the knowledge base has claims.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-secondary">Content</p>
                <Headline value={consistency.contentGrade ?? "–"} unit={consistency.contentClean != null ? `${fmtPct(consistency.contentClean * 100)} clean` : "nothing yet"} />
              </div>
              <div>
                <p className="text-sm text-secondary">Knowledge base</p>
                <Headline value={consistency.kbGrade ?? "–"} unit={consistency.kbClean != null ? `${fmtPct(consistency.kbClean * 100)} settled` : "no claims yet"} />
              </div>
            </div>
            <p className="mt-3 text-xs text-quaternary">A at 95%, B 85%, C 70%, D 50%. "Not worth fixing" still counts against it.</p>
            <div className="mt-4">
              <LineChart label="Content clean share, %" points={goals.scores.consistency} target={95} {...chart} format={fmtPct} minMax={100} height={130} />
            </div>
          </>
        )}
      </Card>

      {/* 3. Readership */}
      <Card title={GOAL_COPY.readership.title} subtitle={GOAL_COPY.readership.question}>
        <Headline value={fmtInt(readership.corpusMinutes)} unit={t.readership.corpusMinutes ? `of ${fmtInt(t.readership.corpusMinutes)} minutes read` : "minutes read, no target yet"} />
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <Stat label="Pageviews" value={fmtInt(readership.pageviews)} target={t.readership.pageviews != null ? fmtInt(t.readership.pageviews) : null} />
          <Stat label="Pages a session" value={readership.pagesPerSession.toFixed(2)} target={t.readership.pagesPerSession?.toFixed(1) ?? null} />
          <Stat label="Time per post" value={fmtSeconds(readership.secondsPerPost)} target={t.readership.secondsPerPost != null ? fmtSeconds(t.readership.secondsPerPost) : null} />
        </dl>
        {!t.readership.corpusMinutes && <p className="mt-3 text-xs text-quaternary">The Strategist proposes a target after 4 weeks of readers.</p>}
        <div className="mt-4">
          <LineChart label="Total minutes read" points={goals.scores.readership} target={t.readership.corpusMinutes} pace={!!t.readership.corpusMinutes} {...chart} format={fmtInt} minMax={10} height={130} />
        </div>
      </Card>

      {/* 4. Ranking */}
      <Card title={GOAL_COPY.ranking.title} subtitle={GOAL_COPY.ranking.question} className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-secondary">Search</p>
            <Headline value={pageOne} unit={`of ${queries.length} on page one · target ${t.ranking.pageOneTarget}`} />
          </div>
          <div>
            <p className="text-sm text-secondary">AI answers</p>
            <Headline value={ranking.aiMentions} unit={t.ranking.aiMentionTarget != null ? `of ${queries.length} mention you · target ${t.ranking.aiMentionTarget}` : `of ${queries.length} mention you · measured, no target`} />
          </div>
        </div>
        <div className="mt-4">
          <LineChart label="Target searches on page one" points={goals.scores.ranking} target={t.ranking.pageOneTarget} {...chart} minMax={Math.max(3, t.ranking.pageOneTarget)} height={130} />
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-tertiary hover:text-secondary">The {queries.length} target searches</summary>
          <ul className="mt-2 divide-y divide-secondary">
            {t.ranking.searches.map((s) => {
              const p = ranking.positions[s.query];
              return (
                <li key={s.query} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-secondary">{s.query}</span>
                  <span className={p != null && p <= 10 ? "font-semibold text-success-primary tabular-nums" : "text-quaternary tabular-nums"}>{p != null ? `#${p}` : "not ranked"}</span>
                </li>
              );
            })}
          </ul>
        </details>
      </Card>
    </div>
  );
}

function Stat({ label, value, target }: { label: string; value: string; target: string | null }) {
  return (
    <div>
      <dt className="text-quaternary">{label}</dt>
      <dd className="text-primary tabular-nums">{value}</dd>
      {target && <dd className="text-xs text-quaternary">target {target}</dd>}
    </div>
  );
}

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`;
}

export function ChangeHistory({ goals }: { goals: QuarterGoals }) {
  if (!goals.history.length) return null;
  return (
    <Card title="Changes" subtitle="Every change recalculates the whole quarter with the new targets. The graphs mark the day.">
      <ol className="space-y-4">
        {[...goals.history].reverse().map((v) => (
          <li key={v.version} className="flex gap-3">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-fg-warning-secondary" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="text-primary">
                <span className="font-semibold">Version {v.version}</span> · {shortDate(v.approvedAt)} · approved by {v.approvedBy}
              </p>
              {v.changes.length ? (
                <ul className="mt-0.5 text-secondary">
                  {v.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-secondary">{v.covers ? `First goals, covering ${v.covers.weeks} weeks from ${shortDate(v.covers.from)}.` : "First goals for the quarter."}</p>
              )}
              {v.note && <p className="mt-0.5 text-tertiary">"{v.note}"</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
