// The target searches table, shared by the onboarding plan
// (gettingStarted/StrategyView) and the Goals page (ProposalView). Redesigned
// on Ayadi's approval (2026-10-24): four cells per search, each two lines, with
// numbers only. Every label lives in a two-line header whose lines name the
// cell's lines, and the header explains itself on hover. Rows sit under their
// bucket (three since 2026-10-20: winnable now, must win over time, no data).
// The number columns hug their content; the search column takes the rest.

import { HelpCircle, Trash01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import type { Day, RankingSearch, SearchBucket } from "@/lib/goals/types";
import { shortDate } from "@/lib/goals/quarter";
import { cx } from "@/utils/cx";

export const BUCKETS: { key: SearchBucket; label: string; color: "success" | "blue" | "gray"; why: string }[] = [
  { key: "now", label: "Winnable now", color: "success", why: "A post can reach page one this quarter: difficulty under 30 and under 30 sites linking to an average page-one result, or you already sit on page two." },
  { key: "later", label: "Must win over time", color: "blue", why: "The searches your business has to own in a year or two. The goal this quarter is a position (into the top 30, then the top 20), not page one." },
  { key: "nodata", label: "No data yet", color: "gray", why: "DataForSEO has no number for it. Kept because the intent is exactly right; we report its position all the same." },
];

export function bucketOf(s: Pick<RankingSearch, "bucket">): SearchBucket {
  return s.bucket ?? "now";
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtVolume = (n: number) => n.toLocaleString("en-US");
export const fmtTrend = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

/** What page one takes, from difficulty and page one's links: the thresholds the Strategist's prompt reads them by. */
export function verdictOf(s: Pick<RankingSearch, "difficulty" | "referringDomains">): string {
  const d = s.difficulty;
  const l = s.referringDomains;
  if (d == null || l == null) return "no data";
  if (l < 10 && d < 30) return "open ground";
  if (l <= 30 && d < 30) return "a quarter";
  if (l <= 80 || d <= 50) return "a year";
  return "beyond a post";
}

/** This quarter's goal for a search, from its bucket and where it sits today. */
export function goalOf(s: Pick<RankingSearch, "bucket" | "position">): { label: string; tone: string } {
  switch (bucketOf(s)) {
    case "later":
      return { label: "Top 30, then top 20", tone: "text-brand-secondary" };
    case "nodata":
      return { label: "Tracked", tone: "text-tertiary" };
    default:
      return s.position != null && s.position <= 20 ? { label: "Page one", tone: "text-primary" } : { label: "Climb toward page one", tone: "text-secondary" };
  }
}

export function BucketBadge({ bucket }: { bucket: SearchBucket }) {
  const b = BUCKETS.find((x) => x.key === bucket) ?? BUCKETS[0];
  return (
    <Tooltip title={b.label} description={b.why}>
      <TooltipTrigger className="cursor-default">
        <Badge type="pill-color" color={b.color} size="sm">
          {b.label}
        </Badge>
      </TooltipTrigger>
    </Tooltip>
  );
}

/** The topic a search belongs to, as a chip that says so on hover. */
function TopicChip({ name }: { name: string }) {
  if (!name) return null;
  return (
    <Tooltip title="Topic" description={`${name}: the topic this search belongs to. Its posts are the ones meant to win it.`}>
      <TooltipTrigger className="cursor-default">
        <Badge type="pill-color" color="gray" size="sm">
          {name}
        </Badge>
      </TooltipTrigger>
    </Tooltip>
  );
}

/** Google answers this search with an AI overview; being cited there is a goal. */
function AiAnswerMark() {
  return (
    <Tooltip title="AI answer" description="Google answers this search with an AI overview above the results, and that overview cites pages. One of the posts getting cited there is a goal for this search.">
      <TooltipTrigger className="cursor-default">
        <Badge type="pill-color" color="gray" size="sm">
          AI answer
        </Badge>
      </TooltipTrigger>
    </Tooltip>
  );
}

/** The four headers: the first line names the cell's first line, the second its second. */
function headers(quarterEnd: Day | undefined) {
  return [
    { top: "Search term · Topic", bottom: "Why", why: "The search people type, the topic whose posts are meant to win it, and the plan's reason for picking it." },
    { top: "A month", bottom: "vs last year · peak", why: "How many times a month people in the US search it (DataForSEO; Google Ads where DataForSEO has no row). Below: the last twelve months against the twelve before, so the seasons cancel, and the month the search is biggest. A dash means no number, not zero." },
    { top: "Difficulty · links", bottom: "What it takes", why: "DataForSEO's difficulty, 0 to 100, and how many distinct websites link to an average page-one result today. Below, what page one takes: under 10 links is open ground, 10 to 30 takes a quarter, 30 to 80 a year, more is beyond a post." },
    { top: "Today", bottom: quarterEnd ? `Goal, ${shortDate(quarterEnd)}` : "Goal", why: "Where you appear on Google today (new blogs start outside the top 100), and what this quarter aims for: page one for the winnable searches, a position for the must-wins." },
  ];
}

const NUM = "w-px whitespace-nowrap px-3 py-2.5 align-top tabular-nums";

export function SearchTable({
  searches,
  quarterEnd,
  onRemove,
  showWhy = true,
}: {
  searches: (RankingSearch & { why?: string })[];
  /** The quarter's last day, named in the goal header. */
  quarterEnd?: Day;
  /** When set, each row gets a remove button (the Goals page while the proposal is editable). */
  onRemove?: (index: number) => void;
  showWhy?: boolean;
}) {
  const indexed = searches.map((s, i) => ({ s, i }));
  /** Proposals since 2026-10-20 mark each search's bucket; older ones are one list. */
  const grouped = searches.some((s) => s.bucket);
  const groups = grouped ? BUCKETS.map((b) => ({ b, rows: indexed.filter(({ s }) => bucketOf(s) === b.key) })).filter((g) => g.rows.length) : [{ b: null, rows: indexed }];
  const cols = headers(quarterEnd);
  const span = cols.length + (onRemove ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-secondary bg-secondary text-left text-xs text-tertiary">
          <tr>
            {cols.map((c, k) => (
              <th key={c.top} scope="col" className={cx("py-2.5 align-top font-medium", k === 0 ? "px-5" : "w-px whitespace-nowrap px-3")}>
                <Tooltip title={c.top} description={c.why}>
                  <TooltipTrigger className="block cursor-default text-left">
                    <span className="flex items-center gap-1 text-xs leading-5 text-secondary">
                      {c.top}
                      <HelpCircle className="size-3 text-quaternary" aria-hidden />
                    </span>
                    <span className="block text-xs font-normal leading-[18px] text-quaternary">{c.bottom}</span>
                  </TooltipTrigger>
                </Tooltip>
              </th>
            ))}
            {onRemove && <th className="w-px" aria-label="Remove" />}
          </tr>
        </thead>
        {groups.map(({ b, rows }) => (
          <tbody key={b?.key ?? "all"} className="divide-y divide-secondary border-b border-secondary last:border-b-0">
            {b && (
              <tr>
                <th scope="colgroup" colSpan={span} className="px-5 pb-2 pt-3.5 text-left">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <BucketBadge bucket={b.key} />
                    <span className="text-xs font-normal text-tertiary">{b.why}</span>
                  </span>
                </th>
              </tr>
            )}
            {rows.map(({ s, i }) => {
              const goal = goalOf(s);
              return (
                <tr key={s.query}>
                  <td className="px-5 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-primary">{s.query}</span>
                      <TopicChip name={s.topic} />
                    </div>
                    {showWhy && s.why && <p className="mt-0.5 text-xs leading-[18px] text-tertiary">{s.why}</p>}
                  </td>
                  <td className={NUM}>
                    <div className="font-medium text-primary">{s.volume != null ? fmtVolume(s.volume) : "–"}</div>
                    <div className="text-xs leading-[18px]">
                      <span className={s.yoy != null && s.yoy > 0 ? "text-success-primary" : "text-tertiary"}>{s.yoy != null ? fmtTrend(s.yoy) : s.volume != null ? "no history" : "–"}</span>
                      {s.peakMonth != null && <span className="text-tertiary"> · {MONTHS[s.peakMonth - 1]}</span>}
                    </div>
                  </td>
                  <td className={NUM}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-primary">
                        {s.difficulty != null ? s.difficulty : "–"}
                        {s.referringDomains != null && <span className="font-normal text-tertiary"> · {s.referringDomains}</span>}
                      </span>
                      {s.aiOverview && <AiAnswerMark />}
                    </div>
                    <div className="text-xs leading-[18px] text-tertiary">{verdictOf(s)}</div>
                  </td>
                  <td className={NUM}>
                    <div className="text-tertiary">{s.position != null ? `#${s.position}` : "Not in the top 100"}</div>
                    <div className={cx("text-xs leading-[18px]", goal.tone)}>{goal.label}</div>
                  </td>
                  {onRemove && (
                    <td className="w-px px-3 py-2 align-top">
                      <Button size="sm" color="tertiary" iconLeading={Trash01} aria-label={`Remove ${s.query}`} onClick={() => onRemove(i)} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
