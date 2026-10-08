// Local-date helpers for the pipeline (YYYY-MM-DD strings, no time zones).

export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Monday of the week holding `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // Monday = 0
  return addDays(out, -dow);
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

/** "Oct 20" */
export function shortDate(s: string): string {
  const d = parseYmd(s);
  return `${MONTH.format(d)} ${d.getDate()}`;
}

/** "Mon Oct 5" */
export function dayLabel(d: Date): string {
  return `${WEEKDAY.format(d)} ${MONTH.format(d)} ${d.getDate()}`;
}

/** "Oct 5 to 11", or "Sep 28 to Oct 4" across a month. */
export function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const a = `${MONTH.format(start)} ${start.getDate()}`;
  return start.getMonth() === end.getMonth() ? `${a} to ${end.getDate()}` : `${a} to ${MONTH.format(end)} ${end.getDate()}`;
}
