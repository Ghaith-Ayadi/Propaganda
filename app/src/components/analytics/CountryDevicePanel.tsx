// Compact split panel: top countries on the left, device class on the right.

import { useCountryMix, useDeviceMix } from "@/lib/analytics/hook";
import type { DateRangePreset, BucketRow } from "@/lib/analytics/types";

interface Props { range: DateRangePreset }

function fmt(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function CountryDevicePanel({ range }: Props) {
  const countries = useCountryMix(range);
  const devices = useDeviceMix(range);

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card title="Top countries">
        {countries == null ? <Empty /> : <BarList rows={countries} accent="bg-utility-purple-500" />}
      </Card>
      <Card title="Devices">
        {devices == null ? <Empty /> : <BarList rows={devices} accent="bg-utility-green-500" />}
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-secondary bg-primary p-5">
      <h3 className="-mx-5 -mt-5 mb-4 border-b border-secondary px-5 py-3 text-[11px] font-medium uppercase tracking-wide text-quaternary">{title}</h3>
      {children}
    </div>
  );
}

function Empty() {
  return (
    <div className="text-sm text-tertiary">
      No data yet. Try <code>/simulateTraffic</code>.
    </div>
  );
}

function BarList({ rows, accent }: { rows: BucketRow[]; accent: string }) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-secondary">{r.label}</span>
            <span className="font-mono text-xs text-quaternary">
              {fmt(r.value)} · {Math.round(r.pct * 100)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className={`h-full ${accent}`} style={{ width: `${Math.max(2, r.pct * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
