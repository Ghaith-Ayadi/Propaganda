// Small word-count indicator: a green dot whose brightness scales with the
// post's length, plus the number. Echoes the writing-activity heatmap's scale,
// but is generic (core) — it reads a post's word count, not writing activity.

const GREENS = [
  "color-mix(in srgb, var(--color-fg, #888) 14%, transparent)",
  "rgba(34, 197, 94, 0.35)",
  "rgba(34, 197, 94, 0.55)",
  "rgba(34, 197, 94, 0.78)",
  "rgba(34, 197, 94, 1)",
];

function level(words: number): number {
  if (words <= 0) return 0;
  if (words < 100) return 1;
  if (words < 300) return 2;
  if (words < 600) return 3;
  return 4;
}

export function WordCountDot({ words }: { words: number | null | undefined }) {
  const w = words ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${w.toLocaleString()} words`}>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: GREENS[level(w)] }}
      />
      <span className="tabular-nums text-xs text-tertiary">{w.toLocaleString()}</span>
    </span>
  );
}
