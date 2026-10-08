// What Home shows: the quarter, the five goals as daily lines, the
// Strategist's drift notes, the Launch card, and this week's count.
//
// Sources today:
//   Volume line     LIVE: published posts this quarter, from the local posts table
//   Readership line LIVE when the analytics worker is configured (pageviews a day)
//   Planned posts   LIVE: briefs with a planned date this week
//   Inbox counts    from useInbox() (components/inbox/data.ts)
//   Everything else PLACEHOLDER (placeholder.ts): goal targets (goals,
//                   goal_topics), stored scores (goal_scores), drift_notes,
//                   the Launch (content_batches), grades (kb_grade views)
//
// The goal model stores a score for every day (goal_scores) rather than
// computing on demand; when that table lands, the live adapter reads it and
// the Volume and Readership lines here become its rows.

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { activeSite } from "@/lib/scope";
import { useSiteViews } from "@/lib/analytics/hook";
import type { DayPoint } from "@/lib/analytics/types";
import type { Post } from "@/types";
import { useInbox } from "@/components/inbox/data";
import { dayKey, quarterDays, quarterOf, weekOf, weekOfQuarter, type Quarter } from "@/components/shared/quarter";
import { placeholderHome } from "./placeholder";

export type GoalKey = "volume" | "coverage" | "consistency" | "readership" | "ranking";

export interface Goal {
  key: GoalKey;
  name: string;
  question: string;
  /** The big number: "6 of 18", "55%", "C · B". */
  headline: string;
  /** One line under it. */
  detail: string;
  points: DayPoint[];
  target: { value: number; shape: "flat" | "pace" } | null;
  /** Days the goals changed (the quarter was recalculated). */
  changes: string[];
  format: (v: number) => string;
  /** The y axis tops out here (100 for shares). */
  max?: number;
  /** Set while any of it is example data: why. */
  example?: string;
}

export interface DriftNote {
  id: string;
  goal: GoalKey;
  severity: "info" | "warning";
  message: string;
  action?: { label: string; page: string; rest?: string };
}

export interface Launch {
  day: number;
  live: number;
  planned: number;
  clusters: { name: string; live: number; planned: number }[];
  indexed: number;
  why: string;
}

/** What the placeholder adapter fills in until the goal tables exist. */
export interface HomePlaceholder {
  volumeTarget: number;
  volumeTopics: { onTarget: number; of: number };
  coverage: (days: string[]) => DayPoint[];
  consistency: (days: string[]) => DayPoint[];
  grades: { content: string; kb: string };
  ranking: (days: string[]) => DayPoint[];
  readership: (days: string[]) => DayPoint[];
  rankingTargets: number;
  changes: (q: Quarter) => string[];
  drift: DriftNote[];
  launch: Launch | null;
}

export interface Home {
  tenant: string;
  quarter: Quarter;
  week: number;
  goals: Goal[];
  drift: DriftNote[];
  launch: Launch | null;
  thisWeek: { flags: number; pitches: number; reviews: number; knowledge: number; planned: number };
  /** Live items only while the inbox is example data (see inbox/badge.ts). */
  inboxTotal: number;
  example: boolean;
}

const pct = (v: number) => `${Math.round(v)}%`;
const count = (v: number) => Math.round(v).toLocaleString("en-US");

export function useHome(): Home {
  const quarter = useMemo(() => quarterOf(new Date()), []);
  const days = useMemo(() => quarterDays(quarter), [quarter]);
  const inbox = useInbox();
  const p = placeholderHome;

  const posts = useLiveQuery(() => db.posts.where("status").equals("published").toArray(), [], [] as Post[]);
  const planned = useLiveQuery(
    () => {
      const w = weekOf();
      return db.briefs.where("plannedDate").between(dayKey(w.start), dayKey(w.end), true, true).count();
    },
    [],
    0,
  );
  const views = useSiteViews("90d");

  const goals = useMemo<Goal[]>(() => {
    // Volume: published posts, cumulative over the quarter.
    const perDay = new Map<string, number>();
    for (const post of posts) {
      if (!post.publishedAt) continue;
      const k = dayKey(new Date(post.publishedAt));
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    let running = 0;
    const volume = days.map((day) => ({ day, value: (running += perDay.get(day) ?? 0) }));

    const viewsByDay = new Map((views?.series ?? []).map((d) => [d.day, d.value]));
    const readership = views ? days.map((day) => ({ day, value: viewsByDay.get(day) ?? 0 })) : p.readership(days);
    const readTotal = readership.reduce((s, d) => s + d.value, 0);

    const coverage = p.coverage(days);
    const consistency = p.consistency(days);
    const ranking = p.ranking(days);
    const changes = p.changes(quarter);
    const last = (s: DayPoint[]) => s[s.length - 1]?.value ?? 0;

    return [
      {
        key: "volume",
        name: "Volume",
        question: "Are we publishing enough, on the right topics?",
        headline: `${volume.length ? last(volume) : 0} of ${p.volumeTarget}`,
        detail: `posts published this quarter · ${p.volumeTopics.onTarget} of ${p.volumeTopics.of} topics on target`,
        points: volume,
        target: { value: p.volumeTarget, shape: "pace" },
        changes,
        format: (v) => `${count(v)} posts`,
        example: "The count is your published posts. The target and topics are examples until the Strategist's goals are stored.",
      },
      {
        key: "coverage",
        name: "Coverage",
        question: "Are we using what we know and what people search for?",
        headline: pct(last(coverage)),
        detail: "internal and external, combined; each capped at its goal",
        points: coverage,
        target: { value: 100, shape: "pace" },
        changes,
        format: pct,
        max: 100,
        example: "Coverage needs the knowledge base and search data; example line until goal_scores exists.",
      },
      {
        key: "consistency",
        name: "Consistency",
        question: "Is what we publish true and aligned?",
        headline: `${p.grades.content} · ${p.grades.kb}`,
        detail: "content grade · knowledge base grade; the line is the share of clean content",
        points: consistency,
        target: { value: 95, shape: "flat" },
        changes: [],
        format: (v) => `${pct(v)} clean`,
        max: 100,
        example: "Grades come from the knowledge base views, which aren't on the server yet.",
      },
      {
        key: "readership",
        name: "Readership",
        question: "Is anyone reading?",
        headline: count(readTotal),
        detail: "pageviews this quarter",
        points: readership,
        target: null,
        changes: [],
        format: (v) => `${count(v)} views`,
        example: views ? undefined : "The analytics worker isn't configured here, so this is an example line.",
      },
      {
        key: "ranking",
        name: "Ranking",
        question: "Do we show up where it counts?",
        headline: `${last(ranking)} of ${p.rankingTargets}`,
        detail: "target searches on page one",
        points: ranking,
        target: { value: Math.ceil(p.rankingTargets / 5), shape: "flat" },
        changes,
        format: (v) => `${Math.round(v)} on page one`,
        max: p.rankingTargets,
        example: "Rankings need the Scout's search checks; example line until then.",
      },
    ];
  }, [posts, views, days, quarter, p]);

  return {
    tenant: activeSite()?.name ?? "Your tenant",
    quarter,
    week: weekOfQuarter(quarter),
    goals,
    drift: p.drift,
    launch: p.launch,
    thisWeek: {
      // Example inbox items stay off Home, like the nav badge (inbox/badge.ts).
      flags: inbox.example ? 0 : inbox.flags.length,
      pitches: inbox.example ? 0 : inbox.pendingPitches,
      reviews: inbox.reviews.length,
      knowledge: inbox.example ? 0 : inbox.knowledge.length,
      planned,
    },
    inboxTotal: inbox.liveTotal,
    example: true,
  };
}
