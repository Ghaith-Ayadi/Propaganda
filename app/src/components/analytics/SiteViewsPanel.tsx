// Big number + delta vs previous window + 30-day spark line under it.
// One of the four T1 panels on the analytics overview.

import { useSiteViews } from "@/lib/analytics/hook";
import type { DateRangePreset } from "@/lib/analytics/types";
import { Sparkline } from "./Sparkline";

interface Props { range: DateRangePreset }

function fmt(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function delta(curr: number, prev: number): { pct: number; sign: "+" | "−" | "" } {
  if (prev === 0) return { pct: 0, sign: "" };
  const pct = (curr - prev) / prev;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return { pct: Math.abs(pct), sign };
}

export function SiteViewsPanel({ range }: Props) {
  const data = useSiteViews(range);
  return (
    <Card title="Total views">
      {data == null ? (
        <Empty />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <div className="font-title text-4xl text-primary">{fmt(data.total)}</div>
            {range !== "all" && data.previousTotal > 0 && (() => {
              const d = delta(data.total, data.previousTotal);
              return (
                <div
                  className={[
                    "text-xs",
                    d.sign === "+"
                      ? "text-utility-green-600"
                      : d.sign === "−"
                        ? "text-utility-red-600"
                        : "text-quaternary",
                  ].join(" ")}
                >
                  {d.sign}
                  {Math.round(d.pct * 100)}% vs previous
                </div>
              );
            })()}
          </div>
          <div className="mt-3 h-[60px] text-utility-blue-500">
            <Sparkline data={data.series} width={300} height={60} />
          </div>
        </>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-secondary bg-primary p-5">
      <h3 className="-mx-5 -mt-5 mb-4 border-b border-secondary px-5 py-3 text-[11px] font-medium uppercase tracking-wide text-quaternary">{title}</h3>
      {children}
    </section>
  );
}

function Empty() {
  return (
    <div className="text-sm text-tertiary">
      No data yet. Try the command palette: <code>/simulateTraffic</code>.
    </div>
  );
}
