// Compact formats for the analytics surfaces. Hits get short suffixes
// (k / M); durations get s/m/h/d. Pair them as "544 · 9h" on rows.

export function formatHits(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

/** "544 · 9h" — the canonical row format. */
export function formatHitsAndDuration(hits: number, seconds: number): string {
  return `${formatHits(hits)} · ${formatDuration(seconds)}`;
}
