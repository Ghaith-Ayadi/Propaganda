// Tiny inline sparkline. Hand-rolled SVG — no charting lib.
// Hand it a series of numbers; it normalizes and draws a stroke.

import type { DayPoint } from "@/lib/analytics/types";

interface Props {
  data: DayPoint[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 22,
  stroke = "currentColor",
  fill = "none",
}: Props) {
  if (data.length === 0) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = width / Math.max(1, data.length - 1);
  const points = data
    .map((d, i) => `${(i * stepX).toFixed(2)},${(height - (d.value / max) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points} fill={fill} stroke={stroke} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
