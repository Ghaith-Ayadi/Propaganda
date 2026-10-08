// Pitch fit: Strong, Fair or Weak, from the reasons. Crude on purpose
// (gaia-content-flow/README.md): one point per reason that counts, minus one
// for a duplicate of something published or in the pipeline. Three or more is
// Strong, one or two Fair, none Weak. Tune it with real pitches.

import type { FitGrade, FitReason } from "./types";

export function fitScore(reasons: FitReason[]): number {
  let n = 0;
  for (const r of reasons) {
    if (r.kind === "duplicate") n -= 1;
    else if (r.counts) n += 1;
  }
  return n;
}

export function fitGrade(reasons: FitReason[]): FitGrade {
  const n = fitScore(reasons);
  if (n >= 3) return "strong";
  if (n >= 1) return "fair";
  return "weak";
}

export const FIT_LABEL: Record<FitGrade, string> = {
  strong: "Strong fit",
  fair: "Fair fit",
  weak: "Weak fit",
};

export const FIT_BADGE: Record<FitGrade, "success" | "warning" | "gray"> = {
  strong: "success",
  fair: "warning",
  weak: "gray",
};

const ORDER: Record<FitGrade, number> = { strong: 0, fair: 1, weak: 2 };

/** Pitches sort by fit, then by how soon they're due. */
export function byFitThenDate<T extends { reasons: FitReason[]; publishBy: string }>(a: T, b: T): number {
  const d = ORDER[fitGrade(a.reasons)] - ORDER[fitGrade(b.reasons)];
  return d !== 0 ? d : a.publishBy.localeCompare(b.publishBy);
}
