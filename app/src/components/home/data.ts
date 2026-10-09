// What Home shows: the running campaign (the Launch first), and the four goal
// cards with their numbers, a small line each and the quarter's goal.
//
// Sources:
//   Volume line     published posts this quarter, from the local posts table
//   Readership line pageviews a day when the analytics worker is configured
//   Inbox count     from useInbox() (components/inbox/data.ts)
//   Targets, topics, grades, rankings and the Launch: the Strategist's goals
//                   (lib/goals, goal_versions and friends). A tenant without
//                   goals sees each card say so, never example numbers.
//   The UI preview (VITE_UI_PREVIEW) alone fills the gaps from placeholder.ts.
//
// Coverage is not on Home (Ayadi, 2026-10-08); the Strategist's drift notes
// moved to the Inbox tab they concern.
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
import { dayKey, quarterDays, quarterOf, shortDate, weekOfQuarter, type Quarter } from "@/components/shared/quarter";
import { useLaunch, useQuarterGoals } from "@/lib/goals/useGoals";
import { quarterOf as goalQuarterOf, toDay } from "@/lib/goals/quarter";
import { UI_PREVIEW } from "@/lib/preview";
import { placeholderHome } from "./placeholder";

export type GoalKey = "volume" | "consistency" | "readership" | "ranking";

export interface Goal {
  key: GoalKey;
  name: string;
  question: string;
  /** The big number: "6 of 18", "C · B", "1,204". */
  headline: string;
  /** What moved in the last 7 days: "+2 this week". */
  change: { text: string; direction: "up" | "down" | "flat" } | null;
  points: DayPoint[];
  /** The quarter's goal, in a sentence: the card's footer. */
  goal: string;
  /** Volume only: each topic's published, pitched and target counts. */
  topics?: { name: string; published: number; pitched: number; target: number }[];
  /** Set while any of it is example data: why. */
  example?: string;
}

export interface Objective {
  label: string;
  value: number;
  target: number;
}

/** A campaign: a stretch of work with its own objectives. The Launch is the first. */
export interface Campaign {
  id: string;
  name: string;
  description: string;
  day: number;
  days: number;
  objectives: Objective[];
  why: string;
}

/** What the placeholder adapter fills in until the goal tables exist. */
export interface HomePlaceholder {
  volumeTarget: number;
  volumeTopics: { name: string; published: number; pitched: number; target: number }[];
  consistency: (days: string[]) => DayPoint[];
  grades: { content: string; kb: string; contentTarget: string; kbTarget: string };
  ranking: (days: string[]) => DayPoint[];
  readership: (days: string[]) => DayPoint[];
  rankingTargets: number;
  rankingGoal: number;
  campaigns: Campaign[];
}

export interface Home {
  tenant: string;
  quarter: Quarter;
  week: number;
  goals: Goal[];
  /** The campaign running now, with its status. */
  campaign: (Campaign & { progress: number; onTrack: boolean }) | null;
  /** The same count the Inbox page shows, example items included. */
  inboxTotal: number;
  example: boolean;
}

const count = (v: number) => Math.round(v).toLocaleString("en-US");

/** The change over the last 7 days of a cumulative or level series. */
function weekChange(s: DayPoint[], unit: (n: number) => string): Goal["change"] {
  if (s.length < 2) return null;
  const now = s[s.length - 1].value;
  const then = s[Math.max(0, s.length - 8)].value;
  const d = Math.round(now - then);
  if (d === 0) return { text: "No change this week", direction: "flat" };
  return { text: `${d > 0 ? "+" : ""}${unit(d)} this week`, direction: d > 0 ? "up" : d < 0 ? "down" : "flat" };
}

/** Views in the last 7 days against the 7 before. */
function viewsChange(s: DayPoint[]): Goal["change"] {
  if (s.length < 14) return null;
  const sum = (a: DayPoint[]) => a.reduce((t, d) => t + d.value, 0);
  const now = sum(s.slice(-7));
  const before = sum(s.slice(-14, -7));
  if (before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs last week`, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

export function useHome(): Home {
  const quarter = useMemo(() => quarterOf(new Date()), []);
  const days = useMemo(() => quarterDays(quarter), [quarter]);
  const inbox = useInbox();
  const p = UI_PREVIEW ? placeholderHome : null;
  const key = useMemo(() => goalQuarterOf(toDay(new Date())), []);
  const goalsNow = useQuarterGoals(key);
  const launch = useLaunch();
  const targets = goalsNow.current?.targets ?? null;

  const posts = useLiveQuery(() => db.posts.where("status").equals("published").toArray(), [], [] as Post[]);
  const views = useSiteViews("90d");

  const goals = useMemo<Goal[]>(() => {
    const end = shortDate(quarter.end);
    // Volume: published posts, cumulative over the quarter.
    const perDay = new Map<string, number>();
    for (const post of posts) {
      if (!post.publishedAt) continue;
      const k = dayKey(new Date(post.publishedAt));
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    let running = 0;
    const volume = days.map((day) => ({ day, value: (running += perDay.get(day) ?? 0) }));
    const last = (s: DayPoint[]) => s[s.length - 1]?.value ?? 0;
    const flat = days.map((day) => ({ day, value: 0 }));
    const scored = (s: { day: string; value: number }[] | undefined) => (s && s.length ? s : flat);

    const viewsByDay = new Map((views?.series ?? []).map((d) => [d.day, d.value]));
    const readership = views ? days.map((day) => ({ day, value: viewsByDay.get(day) ?? 0 })) : p ? p.readership(days) : flat;
    const readTotal = readership.reduce((s, d) => s + d.value, 0);

    if (p) {
      const consistency = p.consistency(days);
      const ranking = p.ranking(days);
      return [
        {
          key: "volume",
          name: "Volume",
          question: "Are we publishing enough, on the right topics?",
          headline: `${last(volume)} of ${p.volumeTarget}`,
          change: weekChange(volume, (n) => `${n} ${Math.abs(n) === 1 ? "post" : "posts"}`),
          points: volume,
          goal: `Quarter goal: ${p.volumeTarget} posts published by ${end}.`,
          topics: p.volumeTopics,
          example: "The count is your published posts. The target and the topics are examples.",
        },
        {
          key: "consistency",
          name: "Consistency",
          question: "Is what we publish true and aligned?",
          headline: `${p.grades.content} · ${p.grades.kb}`,
          change: weekChange(consistency, (n) => `${n}% clean`),
          points: consistency,
          goal: `Quarter goal: content ${p.grades.contentTarget}, knowledge base ${p.grades.kbTarget}.`,
          example: "Example grades.",
        },
        {
          key: "readership",
          name: "Readership",
          question: "Is anyone reading?",
          headline: count(readTotal),
          change: viewsChange(readership),
          points: readership,
          goal: "No target this quarter: views are tracked, not graded.",
          example: views ? undefined : "Example line.",
        },
        {
          key: "ranking",
          name: "Ranking",
          question: "Do we show up where it counts?",
          headline: `${last(ranking)} of ${p.rankingTargets}`,
          change: weekChange(ranking, (n) => `${n} on page one`),
          points: ranking,
          goal: `Quarter goal: ${p.rankingGoal} of ${p.rankingTargets} target searches on page one by ${end}.`,
          example: "Example line.",
        },
      ];
    }

    // The tenant's own goals, or an honest "no goals yet".
    const noGoals = "No goals yet: the Strategist proposes them in Goals.";
    const now = goalsNow.now;
    const topics = targets?.volume.topics.map((t) => ({
      name: t.name,
      published: now.volume.byTopic[t.name] ?? 0,
      pitched: now.volume.pitchedByTopic[t.name] ?? 0,
      target: t.low,
    }));
    const consistency = scored(goalsNow.scores.consistency);
    const grade = (g: string | null) => g ?? "–";
    const searches = targets?.ranking.searches ?? [];
    const onPageOne = searches.filter((q) => {
      const pos = now.ranking.positions[q.query] ?? q.position;
      return pos != null && pos <= 10;
    }).length;
    const ranking = scored(goalsNow.scores.ranking);
    return [
      {
        key: "volume",
        name: "Volume",
        question: "Are we publishing enough, on the right topics?",
        headline: targets ? `${last(volume)} of ${targets.volume.total}` : `${last(volume)}`,
        change: weekChange(volume, (n) => `${n} ${Math.abs(n) === 1 ? "post" : "posts"}`),
        points: volume,
        goal: targets ? `Quarter goal: ${targets.volume.total} posts published by ${end}.` : noGoals,
        topics: topics?.length ? topics : undefined,
      },
      {
        key: "consistency",
        name: "Consistency",
        question: "Is what we publish true and aligned?",
        headline: now.consistency.contentGrade || now.consistency.kbGrade ? `${grade(now.consistency.contentGrade)} · ${grade(now.consistency.kbGrade)}` : "–",
        change: goalsNow.scores.consistency?.length ? weekChange(consistency, (n) => `${n}% clean`) : null,
        points: consistency,
        goal: now.consistency.contentGrade || now.consistency.kbGrade ? "Quarter goal: content and knowledge base at A." : "Nothing to check yet: grades start with your first posts and facts.",
      },
      {
        key: "readership",
        name: "Readership",
        question: "Is anyone reading?",
        headline: count(readTotal),
        change: viewsChange(readership),
        points: readership,
        goal: "No target this quarter: views are tracked, not graded.",
      },
      {
        key: "ranking",
        name: "Ranking",
        question: "Do we show up where it counts?",
        headline: searches.length ? `${onPageOne} of ${searches.length}` : "–",
        change: goalsNow.scores.ranking?.length ? weekChange(ranking, (n) => `${n} on page one`) : null,
        points: ranking,
        goal: searches.length
          ? `Quarter goal: ${targets!.ranking.pageOneTarget} of ${searches.length} target searches on page one by ${end}.`
          : targets
            ? "No target searches this quarter."
            : noGoals,
      },
    ];
  }, [posts, views, days, quarter, p, goalsNow, targets]);

  const campaign = useMemo(() => {
    if (p) {
      const c = p.campaigns[0];
      if (!c) return null;
      const main = c.objectives[0];
      const progress = main ? main.value / main.target : 0;
      // On track while the main objective is at or ahead of the days gone.
      return { ...c, progress, onTrack: progress >= c.day / c.days };
    }
    if (!launch || launch.day > 30) return null;
    const c: Campaign = {
      id: "launch",
      name: "Launch",
      description: `${launch.target} posts over the first 30 days`,
      day: launch.day,
      days: 30,
      objectives: [
        { label: "Posts produced", value: launch.produced, target: launch.target },
        { label: "Posts live", value: launch.live, target: launch.target },
        ...launch.clusters.map((k) => ({ label: k.name, value: k.live, target: Math.max(k.planned, 1) })),
      ],
      why: "A new blog has no authority yet. The first month builds a library in a few topics so Google and readers can tell what you're about.",
    };
    const progress = launch.target ? launch.produced / launch.target : 0;
    return { ...c, progress, onTrack: progress >= c.day / c.days };
  }, [p, launch]);

  return {
    tenant: activeSite()?.name ?? "Your tenant",
    quarter,
    week: weekOfQuarter(quarter),
    goals,
    campaign,
    inboxTotal: inbox.total,
    example: !!p,
  };
}
