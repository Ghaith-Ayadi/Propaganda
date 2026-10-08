// A goal's daily line over the quarter. Hand-rolled SVG like the analytics
// sparkline: one series in ink, the target as a dashed line, a mark on each day
// the goals changed (a change recalculates the quarter, so the old line isn't
// kept), and a crosshair with the day's value on hover.

import { useId, useRef, useState } from "react";
import type { DayPoint } from "@/lib/analytics/types";
import { cx } from "@/utils/cx";
import { parseDay, shortDate } from "./quarter";

interface Props {
  points: DayPoint[];
  /** Days in the whole quarter: the x axis always spans it, so the line shows how far in we are. */
  totalDays: number;
  /** A flat target, or a pace line from 0 to the target at quarter end. */
  target?: { value: number; shape: "flat" | "pace" } | null;
  /** Days the goals were changed. */
  changes?: string[];
  format: (v: number) => string;
  /** Upper bound of the y axis; defaults to the larger of the data and the target. */
  max?: number;
  height?: number;
  label: string;
}

const W = 320;

export function LineGraph({ points, totalDays, target, changes = [], format, max, height = 88, label }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();

  const top = max ?? Math.max(1, target?.value ?? 0, ...points.map((p) => p.value)) * 1.08;
  const pad = 4;
  const h = height;
  const x = (i: number) => (i / Math.max(1, totalDays - 1)) * W;
  const y = (v: number) => pad + (h - pad * 2) * (1 - Math.min(v, top) / top);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = points.length > 1 ? `${line}L${x(points.length - 1).toFixed(1)},${h}L0,${h}Z` : "";
  const dayIndex = new Map(points.map((p, i) => [p.day, i]));

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || points.length === 0) return;
    const i = Math.round(((e.clientX - r.left) / r.width) * (totalDays - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const hp = hover !== null ? points[hover] : null;
  const last = points[points.length - 1];

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${h}`}
        preserveAspectRatio="none"
        className="block h-[88px] w-full touch-none overflow-visible"
        style={{ height: h }}
        role="img"
        aria-label={last ? `${label}: ${format(last.value)} on ${shortDate(parseDay(last.day))}` : `${label}: no data yet`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <clipPath id={clip}>
          <rect x="0" y="0" width={W} height={h} />
        </clipPath>
        {/* baseline */}
        <line x1="0" x2={W} y1={h - 0.5} y2={h - 0.5} className="stroke-[var(--color-border-secondary)]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {target && (
          <line
            x1="0"
            x2={W}
            y1={target.shape === "pace" ? y(0) : y(target.value)}
            y2={y(target.value)}
            className="stroke-[var(--color-fg-quaternary)]"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {changes.map((d) => {
          const i = dayIndex.get(d);
          if (i === undefined) return null;
          return (
            <line key={d} x1={x(i)} x2={x(i)} y1="0" y2={h} className="stroke-[var(--color-fg-warning-secondary)]" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          );
        })}
        <g clipPath={`url(#${clip})`}>
          {area && <path d={area} className="fill-[var(--color-fg-primary)] opacity-[0.05]" />}
          <path d={line} fill="none" className="stroke-[var(--color-fg-primary)]" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
        {hover !== null && hp && (
          <line x1={x(hover)} x2={x(hover)} y1="0" y2={h} className="stroke-[var(--color-fg-tertiary)]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* The end dot and the hover dot as HTML, so they stay round when the SVG stretches. */}
      {last && hover === null && <Dot left={x(points.length - 1) / W} top={y(last.value) / h} />}
      {hover !== null && hp && (
        <>
          <Dot left={x(hover) / W} top={y(hp.value) / h} />
          <div
            className={cx(
              "pointer-events-none absolute top-0 z-10 rounded-md bg-primary-solid px-2 py-1 text-xs whitespace-nowrap text-white shadow-md",
              x(hover) / W > 0.6 ? "-ml-2 -translate-x-full" : "ml-2",
            )}
            style={{ left: `${(x(hover) / W) * 100}%` }}
          >
            {shortDate(parseDay(hp.day))} · {format(hp.value)}
          </div>
        </>
      )}
    </div>
  );
}

function Dot({ left, top }: { left: number; top: number }) {
  return (
    <span
      className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-fg-primary)] ring-2 ring-[var(--color-bg-primary)]"
      style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
    />
  );
}
