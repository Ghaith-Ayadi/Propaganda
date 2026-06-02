// Persistent banner shown across every analytics screen while simulated
// mode is active. Yellow on purpose — fake data must never be mistaken
// for real data.

import { Zap } from "@untitledui/icons";
import { setSimMode, useSimMode } from "@/lib/analytics/sim";

export function SimulationBanner() {
  const on = useSimMode();
  if (!on) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-utility-yellow-300 bg-utility-yellow-100 px-5 py-2 text-utility-yellow-700">
      <div className="flex items-center gap-2 text-sm">
        <Zap className="size-4 shrink-0" />
        <span>
          <span className="font-medium">Simulated data</span>
          <span className="text-utility-yellow-600"> — for preview only. None of these numbers are real.</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => setSimMode(false)}
        className="rounded-md border border-utility-yellow-300 bg-utility-yellow-50 px-2.5 py-1 text-xs font-medium text-utility-yellow-700 transition hover:bg-utility-yellow-100"
      >
        Disable
      </button>
    </div>
  );
}
