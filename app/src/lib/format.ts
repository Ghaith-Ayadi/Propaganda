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

/**
 * Human-readable distance from now. Spelled-out units, escalating to
 * "Y years and M months ago" once we cross a year. Years collapse to
 * "Y years ago" when the months remainder is zero.
 *   "just now" · "5 minutes ago" · "3 hours ago" · "4 days ago"
 *   "2 weeks ago" · "5 months ago" · "2 years and 3 months ago"
 */
export function relativeTime(ms: number | null | undefined): string {
  if (ms == null) return "—";
  let dt = Date.now() - ms;
  const future = dt < 0;
  dt = Math.abs(dt);
  const m = Math.floor(dt / 60_000);

  if (m < 1) return "just now";

  let body: string;
  if (m < 60) body = plural(m, "minute");
  else {
    const h = Math.floor(m / 60);
    if (h < 24) body = plural(h, "hour");
    else {
      const d = Math.floor(h / 24);
      if (d < 7) body = plural(d, "day");
      else if (d < 30) body = plural(Math.floor(d / 7), "week");
      else if (d < 365) body = plural(Math.floor(d / 30), "month");
      else {
        const years = Math.floor(d / 365);
        const monthsRem = Math.floor((d - years * 365) / 30);
        body = monthsRem
          ? `${plural(years, "year")} and ${plural(monthsRem, "month")}`
          : plural(years, "year");
      }
    }
  }
  return future ? `in ${body}` : `${body} ago`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ordinal(n: number): "st" | "nd" | "rd" | "th" {
  const j = n % 10, k = n % 100;
  if (k >= 11 && k <= 13) return "th";
  if (j === 1) return "st";
  if (j === 2) return "nd";
  if (j === 3) return "rd";
  return "th";
}

/**
 * Exact date in title-case short-month form with an ordinal day and a
 * two-digit year:  "Oct 19th, '24".
 * Used alongside `relativeTime` for the post Info panel.
 */
export function formatExactDate(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const mon = SHORT_MONTHS[d.getMonth()];
  const day = d.getDate();
  const yy = String(d.getFullYear()).slice(-2);
  return `${mon} ${day}${ordinal(day)}, '${yy}`;
}
