// The writing-activity panel on the home dashboard: a single merged card with
// the contribution heatmap on top and a full-width, evenly-distributed grid of
// totals + averages below. Returns null when the feature is disabled.

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Post } from "@/types";
import { dayKey, getActivityMap, subscribe } from "./store";
import { useVerboseEnabled } from "./flag";

const WEEKS = 26; // ~6 months
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Green scale (level 0 = faint track). rgba works in both light/dark themes.
const COLORS = [
  "color-mix(in srgb, var(--color-fg, #888) 8%, transparent)",
  "rgba(34, 197, 94, 0.30)",
  "rgba(34, 197, 94, 0.50)",
  "rgba(34, 197, 94, 0.75)",
  "rgba(34, 197, 94, 1)",
];

function level(words: number): number {
  if (words <= 0) return 0;
  if (words < 100) return 1;
  if (words < 300) return 2;
  if (words < 600) return 3;
  return 4;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

interface Cell {
  key: string;
  date: Date;
  words: number;
  future: boolean;
}

export function VerboseActivity() {
  const enabled = useVerboseEnabled();
  const [map, setMap] = useState<Map<string, number>>(new Map());
  const [selected, setSelected] = useState<{ key: string; words: number; date: Date } | null>(null);
  const posts = useLiveQuery(() => db.posts.toArray(), [], [] as Post[]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => void getActivityMap().then((m) => alive && setMap(m));
    load();
    const unsub = subscribe(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [enabled]);

  const { columns, monthLabels, todayWords, since, tiles } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startSunday = addDays(today, -today.getDay() - (WEEKS - 1) * 7);

    const columns: Cell[][] = [];
    const monthLabels: { col: number; label: string }[] = [];
    let prevMonth = -1;
    for (let c = 0; c < WEEKS; c++) {
      const weekStart = addDays(startSunday, c * 7);
      if (weekStart.getMonth() !== prevMonth && weekStart.getDate() <= 7) {
        monthLabels.push({ col: c, label: MONTHS[weekStart.getMonth()] });
        prevMonth = weekStart.getMonth();
      }
      const col: Cell[] = [];
      for (let r = 0; r < 7; r++) {
        const date = addDays(weekStart, r);
        const key = dayKey(date);
        col.push({ key, date, words: map.get(key) ?? 0, future: date > today });
      }
      columns.push(col);
    }

    const entries = [...map.entries()];
    const year = today.getFullYear();
    const monthPrefix = dayKey(today).slice(0, 7);
    let yearTotal = 0;
    let monthTotal = 0;
    let total = 0;
    let best = 0;
    let earliest: string | null = null;
    for (const [k, w] of entries) {
      total += w;
      if (k.startsWith(String(year))) yearTotal += w;
      if (k.startsWith(monthPrefix)) monthTotal += w;
      if (w > best) best = w;
      if (w > 0 && (!earliest || k < earliest)) earliest = k;
    }
    const writingDays = entries.filter(([, w]) => w > 0).length;
    const todayWords = map.get(dayKey(today)) ?? 0;

    const has = (d: Date) => (map.get(dayKey(d)) ?? 0) > 0;
    let current = 0;
    let cursor = has(today) ? today : addDays(today, -1);
    while (has(cursor)) {
      current++;
      cursor = addDays(cursor, -1);
    }
    let longest = 0;
    let run = 0;
    for (let d = startSunday; d <= today; d = addDays(d, 1)) {
      if (has(d)) {
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }

    let last30 = 0;
    for (let i = 0; i < 30; i++) last30 += map.get(dayKey(addDays(today, -i))) ?? 0;
    const postWords = posts.reduce((a, p) => a + (p.wordCount ?? 0), 0);

    const num = (n: number) => Math.round(n).toLocaleString();
    const since = earliest
      ? new Date(`${earliest}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : null;

    const tiles = [
      { label: "this month", value: num(monthTotal) },
      { label: "this year", value: num(yearTotal) },
      { label: "streak", value: `${current}d` },
      { label: "longest", value: `${longest}d` },
      { label: "best day", value: num(best) },
      { label: "per writing day", value: num(writingDays ? total / writingDays : 0) },
      { label: "per day (30d)", value: num(last30 / 30) },
      { label: "per post", value: num(posts.length ? postWords / posts.length : 0) },
      { label: "days written", value: num(writingDays) },
      { label: "posts", value: num(posts.length) },
    ];

    return { columns, monthLabels, todayWords, since, tiles };
  }, [map, posts]);

  if (!enabled) return null;

  return (
    <div className="rounded-xl border border-secondary bg-primary">
      <div className="flex items-baseline justify-between border-b border-secondary px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium text-secondary">Writing activity</h2>
          {since && <span className="text-xs text-quaternary">(since {since})</span>}
          {selected && (
            <span className="text-xs text-tertiary">
              · {selected.words.toLocaleString()} {selected.words === 1 ? "word" : "words"} on{" "}
              {selected.date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
        <span className="text-xs text-tertiary">
          <span className="font-medium text-secondary">{todayWords.toLocaleString()}</span>{" "}
          <span className="text-quaternary">today</span>
        </span>
      </div>

      <div className="flex flex-col gap-6 p-5 lg:flex-row lg:items-center">
        {/* heatmap */}
        <div className="overflow-hidden lg:shrink-0">
          <div className="inline-block">
            <div className="relative mb-1 h-3">
              {monthLabels.map(({ col, label }) => (
                <span key={`${col}-${label}`} className="absolute text-[10px] text-quaternary" style={{ left: col * 14 }}>
                  {label}
                </span>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {columns.map((col, ci) => (
                <div key={ci} className="flex flex-col gap-[3px]">
                  {col.map((cell) =>
                    cell.future ? (
                      <div key={cell.key} className="size-[11px]" />
                    ) : (
                      <button
                        key={cell.key}
                        type="button"
                        onClick={() =>
                          setSelected((s) =>
                            s?.key === cell.key ? null : { key: cell.key, words: cell.words, date: cell.date },
                          )
                        }
                        title={`${cell.words.toLocaleString()} ${cell.words === 1 ? "word" : "words"} · ${cell.date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`}
                        className="size-[11px] rounded-[2px] outline-none ring-offset-1 ring-offset-primary transition hover:ring-1 hover:ring-tertiary focus-visible:ring-2 focus-visible:ring-brand"
                        style={{
                          backgroundColor: COLORS[level(cell.words)],
                          boxShadow: selected?.key === cell.key ? "0 0 0 2px var(--color-brand, #22c55e)" : undefined,
                        }}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* stats — even grid, beside the graph */}
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 lg:border-l lg:border-secondary lg:pl-6">
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="text-xl font-semibold tabular-nums text-primary">{t.value}</div>
              <div className="text-xs text-quaternary">{t.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
