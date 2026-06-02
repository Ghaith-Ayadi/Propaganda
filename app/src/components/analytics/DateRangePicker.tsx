// Universal date-range control. Drives every analytics panel on the page.
// V1: presets only. Custom range deferred.

import type { DateRangePreset } from "@/lib/analytics/types";

interface Props {
  value: DateRangePreset;
  onChange: (v: DateRangePreset) => void;
}

const OPTIONS: ReadonlyArray<{ id: DateRangePreset; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "all", label: "All time" },
];

export function DateRangePicker({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex items-center gap-0.5 rounded-lg border border-secondary bg-secondary p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={[
              "rounded-md px-2.5 py-1 text-xs transition",
              active
                ? "bg-primary text-primary shadow-xs ring-1 ring-secondary"
                : "text-secondary hover:text-primary",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
