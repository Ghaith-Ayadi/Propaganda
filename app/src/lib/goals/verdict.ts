// What a target search's numbers mean, in words: the bucket it sits in, what
// page one takes, and this quarter's goal. Pure functions, no React, so they
// are tested with node's own runner (verdict.test.ts). The bands here are the
// ones the Strategist's prompt and the table header give; keep the three in step.

import type { RankingSearch, SearchBucket } from "./types";

export function bucketOf(s: Pick<RankingSearch, "bucket">): SearchBucket {
  return s.bucket ?? "now";
}

/**
 * What page one takes, from page one's links alone: under 10 is open ground,
 * 10 to 30 takes a quarter, 30 to 80 a year, more is beyond a post. Difficulty
 * stays out of it (easy-scoring government pages are not easy), so the line
 * says what the header's tooltip says.
 */
export function verdictOf(s: Pick<RankingSearch, "referringDomains">): string {
  const l = s.referringDomains;
  if (l == null) return "no data";
  if (l < 10) return "open ground";
  if (l <= 30) return "a quarter";
  if (l <= 80) return "a year";
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
