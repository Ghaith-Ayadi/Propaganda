// The tenant's model spend this month, on Home. API prices, whatever the app
// actually pays. Shows a bar once the tenant has a budget; says so plainly when
// background work has stopped.

import { useEffect, useState } from "react";
import { budgetState, loadMonthUsage, usd, type MonthUsage } from "@/lib/cost";
import { reportError } from "@/lib/telemetry";

export function CostMeter() {
  const [usage, setUsage] = useState<MonthUsage | null>(null);

  useEffect(() => {
    let live = true;
    loadMonthUsage().then(
      (u) => live && setUsage(u),
      // Home works without the meter (and before the cost log exists on the server).
      (err) => reportError("CostMeter", err),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!usage) return null;
  const state = budgetState(usage);
  const pct = usage.monthlyLimit ? Math.min(100, (usage.spentUsd / usage.monthlyLimit) * 100) : 0;

  return (
    <div className="mt-8 rounded-xl border border-secondary bg-primary px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium text-secondary">Model usage this month</span>
        <span className="text-sm text-primary">
          {usd(usage.spentUsd)}
          {usage.monthlyLimit !== null && <span className="text-tertiary"> of {usd(usage.monthlyLimit)}</span>}
        </span>
      </div>
      {usage.monthlyLimit !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tertiary" role="img" aria-label={`${Math.round(pct)}% of the monthly budget used`}>
          <div
            className={state === "over" ? "h-full bg-error-solid" : state === "warn" ? "h-full bg-warning-solid" : "h-full bg-brand-solid"}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {state === "warn" && (
        <p className="mt-2 text-xs text-tertiary">Past {Math.round(usage.warnRatio * 100)}% of this month's budget.</p>
      )}
      {state === "over" && (
        <p className="mt-2 text-xs text-tertiary">Monthly budget reached: background work is paused. Writing and editing keep working.</p>
      )}
      {usage.killed && (
        <p className="mt-2 text-xs text-tertiary">Background work is paused for everyone while a spending limit is under review.</p>
      )}
    </div>
  );
}
