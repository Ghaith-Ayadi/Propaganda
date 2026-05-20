// Date format used everywhere — "30 MAR 2026" — monospace + tabular figures.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatDate(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS[d.getMonth()];
  const yyyy = d.getFullYear();
  return `${day} ${mon} ${yyyy}`;
}

/**
 * Whitespace-tokenized word count after stripping common Markdown markers.
 * Cheap enough to call on every keystroke (the editor already debounces it).
 */
export function countWords(md: string | null | undefined): number {
  if (!md) return 0;
  const stripped = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#*_>\-`\[\]()!]/g, " ");
  let n = 0;
  for (const tok of stripped.split(/\s+/)) if (tok) n++;
  return n;
}

const WORDS_PER_MINUTE = 220;

export function readTime(words: number | null | undefined): number {
  if (!words || words <= 0) return 0;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

export function formatWordCount(words: number | null | undefined): string {
  const w = words ?? 0;
  const min = readTime(w);
  return `${w.toLocaleString()} Words · ${min} min`;
}

export function relativeTime(ms: number): string {
  const dt = Date.now() - ms;
  const m = Math.floor(dt / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
