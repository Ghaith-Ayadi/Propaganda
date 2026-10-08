// Calendar quarters, the clock the five goals run on (Q1 starts 1 Jan, 13 weeks
// each). Days are local YYYY-MM-DD strings, like the analytics series.

export interface Quarter {
  /** "Q4 2026" */
  label: string;
  start: Date;
  /** The last day of the quarter (inclusive). */
  end: Date;
  /** Days in the quarter (90 to 92). */
  days: number;
}

export function quarterOf(d: Date = new Date()): Quarter {
  const q = Math.floor(d.getMonth() / 3);
  const start = new Date(d.getFullYear(), q * 3, 1);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0);
  return { label: `Q${q + 1} ${d.getFullYear()}`, start, end, days: daysBetween(start, end) + 1 };
}

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86_400_000);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Week of the quarter, 1 to 13 (14 on the odd extra day). */
export function weekOfQuarter(q: Quarter, d: Date = new Date()): number {
  return Math.floor(daysBetween(q.start, d) / 7) + 1;
}

/** Every day of the quarter from its start through `until` (capped at the end). */
export function quarterDays(q: Quarter, until: Date = new Date()): string[] {
  const last = Math.min(daysBetween(q.start, until), q.days - 1);
  const out: string[] = [];
  for (let i = 0; i <= last; i++) out.push(dayKey(addDays(q.start, i)));
  return out;
}

/** Monday to Sunday around `d`. */
export function weekOf(d: Date = new Date()): { start: Date; end: Date } {
  const offset = (d.getDay() + 6) % 7;
  const start = addDays(d, -offset);
  return { start, end: addDays(start, 6) };
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
