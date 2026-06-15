// Where traffic comes from — referrer source buckets with horizontal bars.

import { useReferrerMix } from "@/lib/analytics/hook";
import type { DateRangePreset } from "@/lib/analytics/types";

interface Props { range: DateRangePreset }

function fmt(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function ReferrerPanel({ range }: Props) {
  const rows = useReferrerMix(range);
  return (
    <section className="rounded-xl border border-secondary bg-primary p-5">
      <h3 className="-mx-5 -mt-5 mb-4 border-b border-secondary px-5 py-3 text-[11px] font-medium uppercase tracking-wide text-quaternary">
        Where readers come from
      </h3>
      {rows == null ? (
        <div className="text-sm text-tertiary">
          No data yet. Try the command palette: <code>/simulateTraffic</code>.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.bucket} className="text-sm">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-secondary">{r.label}</span>
                <span className="font-mono text-xs text-quaternary">
                  {fmt(r.value)} · {Math.round(r.pct * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-utility-blue-500"
                  style={{ width: `${Math.max(2, r.pct * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
