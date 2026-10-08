// A goal's daily score over the quarter. Plain SVG, no chart library.
// One series (the title names it, so no legend), an optional dashed target and
// pace line, a vertical mark on each day the goals changed, and a crosshair
// with a tooltip on hover.

import { useId, useMemo, useRef, useState } from "react";
import type { Day, ScorePoint } from "@/lib/goals/types";
import { daysBetween, fromDay, shortDate } from "@/lib/goals/quarter";

export interface ChangeMark {
  day: Day;
  label: string;
}

interface Props {
  points: ScorePoint[];
  /** First and last day of the quarter: the x axis always spans all of it. */
  from: Day;
  to: Day;
  /** A horizontal target line. */
  target?: number | null;
  /** A straight line from 0 at `from` to `target` at `to`: where today "should" be. */
  pace?: boolean;
  marks?: ChangeMark[];
  format?: (v: number) => string;
  /** Lowest y-axis maximum, so a flat start doesn't fill the chart. */
  minMax?: number;
  height?: number;
  label: string;
}

const W = 600;
const PAD = { l: 40, r: 12, t: 12, b: 22 };

export function LineChart({ points, from, to, target, pace, marks = [], format = (v) => String(Math.round(v)), minMax = 1, height = 160, label }: Props) {
  const H = height;
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(1, daysBetween(from, to));

  const { max, ticks } = useMemo(() => {
    const m = Math.max(minMax, target ?? 0, ...points.map((p) => p.value));
    // Round steps so the gridline labels read cleanly.
    const step = niceStep(m / 4);
    const top = Math.ceil(m / step) * step;
    return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
  }, [points, target, minMax]);

  const x = (day: Day) => PAD.l + (daysBetween(from, day) / span) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const months = monthTicks(from, to);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const last = points[points.length - 1];

  const onMove = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg || !points.length) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].day) - px) < Math.abs(x(points[best].day) - px)) best = i;
    setHover(best);
  };

  const hp = hover != null ? points[hover] : null;
  const hoverMark = hp ? marks.find((m) => m.day === hp.day) : undefined;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full touch-pan-y select-none"
        role="img"
        aria-labelledby={`${id}-t`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={`${id}-t`}>
          {label}
          {last ? `: ${format(last.value)} on ${shortDate(last.day)}` : ": no data yet"}
        </title>
        {/* gridlines and y labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-[var(--color-border-secondary)]" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" className="fill-[var(--color-fg-quaternary)] text-[10px]">
              {t >= 1000 ? `${+(t / 1000).toFixed(1)}k` : format(t)}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.day} x={x(m.day)} y={H - 6} textAnchor="start" className="fill-[var(--color-fg-quaternary)] text-[10px]">
            {m.label}
          </text>
        ))}
        {/* target and pace */}
        {target != null && target > 0 && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} className="stroke-[var(--color-fg-tertiary)]" strokeWidth={1} strokeDasharray="4 4" />
        )}
        {pace && target != null && target > 0 && (
          <line x1={x(from)} x2={x(to)} y1={y(0)} y2={y(target)} className="stroke-[var(--color-border-primary)]" strokeWidth={1} strokeDasharray="2 3" />
        )}
        {/* goal changes */}
        {marks.map((m) => (
          <g key={m.day}>
            <line x1={x(m.day)} x2={x(m.day)} y1={PAD.t} y2={H - PAD.b} className="stroke-[var(--color-fg-warning-secondary)]" strokeWidth={1.5} />
            <circle cx={x(m.day)} cy={PAD.t} r={3} className="fill-[var(--color-fg-warning-secondary)]" />
          </g>
        ))}
        {/* the series */}
        {points.length > 1 && <path d={path} fill="none" className="stroke-[var(--color-fg-brand-primary)]" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {last && <circle cx={x(last.day)} cy={y(last.value)} r={4} className="fill-[var(--color-fg-brand-primary)] stroke-[var(--color-bg-primary)]" strokeWidth={2} />}
        {/* crosshair */}
        {hp && (
          <g>
            <line x1={x(hp.day)} x2={x(hp.day)} y1={PAD.t} y2={H - PAD.b} className="stroke-[var(--color-fg-quaternary)]" strokeWidth={1} />
            <circle cx={x(hp.day)} cy={y(hp.value)} r={4} className="fill-[var(--color-fg-brand-primary)] stroke-[var(--color-bg-primary)]" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-primary px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-secondary"
          style={{ left: `${(x(hp.day) / W) * 100}%` }}
        >
          <div className="text-tertiary">{shortDate(hp.day)}</div>
          <div className="font-semibold text-primary tabular-nums">{format(hp.value)}</div>
          {hoverMark && <div className="mt-0.5 text-warning-primary">{hoverMark.label}</div>}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  if (raw <= 1) return raw <= 0.5 ? 0.5 : 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function monthTicks(from: Day, to: Day): { day: Day; label: string }[] {
  const out: { day: Day; label: string }[] = [];
  const d = fromDay(from);
  d.setDate(1);
  while (true) {
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    if (day > to) break;
    if (day >= from) out.push({ day, label: d.toLocaleDateString("en-GB", { month: "short" }) });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
