// The target searches' buckets and columns, shared by the onboarding plan
// (gettingStarted/StrategyView) and the Goals page (ProposalView). Three
// buckets since 2026-10-20: winnable now, must win over time, no data.
// Column headers carry their explanation in a tooltip, never in the table.

import { HelpCircle } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import type { RankingSearch, SearchBucket } from "@/lib/goals/types";

export const BUCKETS: { key: SearchBucket; label: string; color: "success" | "blue" | "gray"; why: string }[] = [
  { key: "now", label: "Winnable now", color: "success", why: "A post can reach page one this quarter: difficulty under 30 and under 30 sites linking to an average page-one result, or you already sit on page two." },
  { key: "later", label: "Must win over time", color: "blue", why: "The searches your business has to own in a year or two. The goal this quarter is a position (into the top 30, then the top 20), not page one." },
  { key: "nodata", label: "No data yet", color: "gray", why: "DataForSEO has no number for it. Kept because the intent is exactly right; the Scout reports its position all the same." },
];

export function bucketOf(s: Pick<RankingSearch, "bucket">): SearchBucket {
  return s.bucket ?? "now";
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtVolume = (n: number) => n.toLocaleString("en-US");
export const fmtTrend = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

export const COLUMNS: { key: string; label: string; why: string }[] = [
  { key: "volume", label: "Volume", why: "How many times a month people in the US search it (DataForSEO; Google Ads where DataForSEO has no row). A dash means no number, not zero." },
  { key: "trend6", label: "6 months", why: "The last six months' searches against the six before. Rising searches are worth posts before they peak." },
  { key: "peak", label: "Peak", why: "The month the search is biggest. A seasonal search gets its posts two to three months before, and is judged after." },
  { key: "difficulty", label: "Difficulty", why: "DataForSEO's 0 to 100. Under 30 is winnable for a new blog; 30 to 50 is contested; above that belongs to the big sites. Government pages score easy and are not, so read it with the links." },
  { key: "links", label: "Page-one links", why: "How many distinct websites link to an average page-one result today. Under 10 is open ground; 10 to 30 takes a quarter; 30 to 80 a year; more is beyond a post." },
  { key: "ai", label: "AI", why: "Whether Google answers this search with an AI overview that cites pages. Those are the searches where an AI mention is the goal." },
  { key: "position", label: "Position", why: "Where you appear on Google today. New blogs start outside the top 100." },
];

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

/** A column header: the label, and a ? that explains it on hover. */
export function ColumnHeader({ label, why, className }: { label: string; why: string; className?: string }) {
  return (
    <th className={className}>
      <Tooltip title={label} description={why}>
        <TooltipTrigger className="inline-flex cursor-default items-center gap-1 font-medium">
          {label}
          <HelpCircle className="size-3 text-quaternary" aria-hidden />
        </TooltipTrigger>
      </Tooltip>
    </th>
  );
}

/** The data cells of one search, in COLUMNS order. */
export function SearchCells({ s, mono = false }: { s: RankingSearch; mono?: boolean }) {
  const cell = (v: React.ReactNode, tone = "text-secondary") => <td className={`px-3 py-2.5 ${tone} tabular-nums ${mono ? "" : ""}`}>{v}</td>;
  return (
    <>
      {cell(s.volume != null ? fmtVolume(s.volume) : "–")}
      {cell(s.trend6 != null ? fmtTrend(s.trend6) : "–", s.trend6 != null && s.trend6 > 0 ? "text-success-primary" : "text-secondary")}
      {cell(s.peakMonth != null ? MONTHS[s.peakMonth - 1] : "–")}
      {cell(s.difficulty != null ? s.difficulty : "–")}
      {cell(s.referringDomains != null ? s.referringDomains : "–")}
      {cell(s.aiOverview == null ? "–" : s.aiOverview ? "Yes" : "No")}
      {cell(s.position != null ? `#${s.position}` : "Not in the top 100", "text-tertiary")}
    </>
  );
}
