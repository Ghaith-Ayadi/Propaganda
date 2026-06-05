// /admin#/analytics — the dashboard shell. Wires the date-range control
// to every panel and renders the simulation banner above the grid when
// sim mode is on.

import { useState } from "react";
import type { DateRangePreset } from "@/lib/analytics/types";
import { useSimMode } from "@/lib/analytics/sim";
import { liveConfigured } from "@/lib/analytics/live";
import { SimulationBanner } from "./SimulationBanner";
import { DateRangePicker } from "./DateRangePicker";
import { SiteViewsPanel } from "./SiteViewsPanel";
import { TopPostsPanel } from "./TopPostsPanel";
import { ReferrerPanel } from "./ReferrerPanel";
import { CountryDevicePanel } from "./CountryDevicePanel";

export function AnalyticsPage() {
  const [range, setRange] = useState<DateRangePreset>("30d");
  const sim = useSimMode();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SimulationBanner />

      <div className="border-b border-secondary px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-title text-2xl text-primary">Analytics</h1>
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SiteViewsPanel range={range} />
          </div>
          <div className="lg:row-span-2">
            <ReferrerPanel range={range} />
          </div>
          <div className="lg:col-span-2">
            <TopPostsPanel range={range} />
          </div>
          <div className="lg:col-span-3">
            <CountryDevicePanel range={range} />
          </div>
        </div>

        {!sim && !liveConfigured && (
          <p className="mx-auto mt-8 max-w-[700px] text-center text-xs text-quaternary">
            No live analytics backend is configured. To preview the dashboard with sample data, open
            the command palette (⌘K) and run <code className="font-mono">/simulateTraffic</code>.
          </p>
        )}
      </div>
    </div>
  );
}
