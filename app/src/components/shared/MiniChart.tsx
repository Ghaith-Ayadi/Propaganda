// A goal card's small chart: one line over the days so far with a soft area
// under it, no axes and no target. The card's number and footer carry the
// rest; the line only shows the direction.

import { useId } from "react";
import type { DayPoint } from "@/lib/analytics/types";

const W = 128;
const H = 56;

export function MiniChart({ points, label }: { points: DayPoint[]; label: string }) {
  const fill = useId();
  if (points.length < 2) return <div className="h-14 w-32" aria-hidden />;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => 3 + (H - 6) * (1 - (v - lo) / span);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-32 shrink-0 overflow-visible text-fg-brand-primary" role="img" aria-label={label}>
      <defs>
        <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${fill})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
