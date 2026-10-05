// In-memory state for the prototype: dummy data in, clicks mutate it, grades
// recompute. A reload starts over.

import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import * as D from "./data";
import type { Flag, FlagStatus, Pitch, PitchStatus } from "./data";

export type Route = "onboarding" | "home" | "inbox" | "settings" | "blog" | "social" | "email" | "sales" | "kb" | `post-${string}`;
const ROUTES = ["onboarding", "home", "inbox", "settings", "blog", "social", "email", "sales", "kb"];

interface State {
  objects: D.ContentObject[];
  bodies: Record<string, string[]>;
  flags: Flag[];
  pitches: Pitch[];
  contested: typeof D.kb.contested;
  contradictions: typeof D.kb.contradictions;
  kbEntries: number;
  reviews: typeof D.reviews;
  topics: D.Topic[];
  internalPublished: number;
  toasts: Array<{ id: number; text: string }>;
}

type Action =
  | { type: "flag"; id: string; status: FlagStatus; rejection?: string }
  | { type: "applyFix"; id: string; fix: string }
  | { type: "title"; id: string; title: string }
  | { type: "body"; id: string; body: string[] }
  | { type: "object"; id: string; patch: Partial<D.ContentObject> }
  | { type: "newPost"; obj: D.ContentObject; body: string[] }
  | { type: "kbAdmit" }
  | { type: "kbContest"; claim: string; why: string }
  | { type: "kbResolve"; id: string }
  | { type: "pitch"; id: string; status: PitchStatus }
  | { type: "publishReview"; id: string }
  | { type: "toast"; text: string }
  | { type: "untoast"; id: number }
  | { type: "reset" };

const initial = (): State => ({
  objects: D.objects.map((o) => ({ ...o })),
  bodies: Object.fromEntries(Object.entries(D.bodies).map(([k, v]) => [k, [...v]])),
  flags: D.flags.map((f) => ({ ...f })),
  pitches: D.pitches.map((p) => ({ ...p })),
  contested: [...D.kb.contested],
  contradictions: [...D.kb.contradictions],
  kbEntries: D.kb.entries,
  reviews: [...D.reviews],
  topics: D.topics.map((t) => ({ ...t })),
  internalPublished: D.coverage.internal.published,
  toasts: [],
});

let toastSeq = 0;

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "flag":
      return {
        ...s,
        flags: s.flags.map((f) => (f.id === a.id ? { ...f, status: a.status, rejection: a.rejection ?? f.rejection } : f)),
      };
    case "applyFix": {
      const f = s.flags.find((x) => x.id === a.id)!;
      const body = s.bodies[f.objectId] ?? bodyFor(s, f.objectId);
      return {
        ...s,
        flags: s.flags.map((x) => (x.id === a.id ? { ...x, status: "fixed" } : x)),
        bodies: { ...s.bodies, [f.objectId]: body.map((p) => p.replace(f.excerpt.text, a.fix)) },
        objects: s.objects.map((o) => (o.id === f.objectId && o.title === f.excerpt.text ? { ...o, title: a.fix } : o)),
      };
    }
    case "title":
      return { ...s, objects: s.objects.map((o) => (o.id === a.id ? { ...o, title: a.title } : o)) };
    case "object":
      return { ...s, objects: s.objects.map((o) => (o.id === a.id ? { ...o, ...a.patch } : o)) };
    case "body":
      return { ...s, bodies: { ...s.bodies, [a.id]: a.body } };
    case "newPost":
      return { ...s, objects: [a.obj, ...s.objects], bodies: { ...s.bodies, [a.obj.id]: a.body } };
    case "kbAdmit":
      return { ...s, kbEntries: s.kbEntries + 1 };
    case "kbContest":
      return {
        ...s,
        kbEntries: s.kbEntries + 1,
        contested: [...s.contested, { id: "k" + Date.now(), claim: a.claim, since: D.TODAY, why: a.why }],
      };
    case "kbResolve":
      return {
        ...s,
        contested: s.contested.filter((k) => k.id !== a.id),
        contradictions: s.contradictions.filter((k) => k.id !== a.id),
      };
    case "pitch":
      return { ...s, pitches: s.pitches.map((p) => (p.id === a.id ? { ...p, status: a.status } : p)) };
    case "publishReview": {
      const r = s.reviews.find((x) => x.id === a.id);
      return {
        ...s,
        reviews: s.reviews.filter((x) => x.id !== a.id),
        objects: s.objects.map((o) => (r && o.id === r.objectId ? { ...o, status: "published", date: D.TODAY } : o)),
        internalPublished: s.internalPublished + 1,
        topics: s.topics.map((t) => (r && t.id === r.topic ? { ...t, published: t.published + 1 } : t)),
      };
    }
    case "toast":
      return { ...s, toasts: [...s.toasts, { id: ++toastSeq, text: a.text }] };
    case "untoast":
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case "reset":
      return initial();
  }
}

// ── Derived numbers ─────────────────────────────────────────────────────

/** Statuses that count against the content grade. "Not worth fixing" still counts. */
export const COUNTS_AGAINST: FlagStatus[] = ["open", "guardian", "rejected", "escalated", "not-worth-fixing"];
/** Statuses that need someone to act (the inbox). */
export const NEEDS_ACTION: FlagStatus[] = ["open", "rejected", "escalated"];

export function gradeFor(share: number) {
  return D.gradeCutoffs.find(([, min]) => share >= min)![0];
}

function derive(s: State) {
  // "Can't fix" is decided by the object's type: flags on a sent newsletter or
  // an X post are logged and left out of the content grade.
  const fixable = (f: Flag) => D.objectTypes[objectOf(f.objectId).type].fixable;
  const counting = s.flags.filter((f) => COUNTS_AGAINST.includes(f.status) && fixable(f));
  const flaggedPosts = new Set(counting.map((f) => f.objectId));
  const excluded = new Set(
    s.flags
      .filter((f) => !fixable(f) && !["admitted", "fixed"].includes(f.status) && !flaggedPosts.has(f.objectId))
      .map((f) => f.objectId),
  );
  const total = s.objects.filter((o) => o.status === "published").length + D.backCatalogue;
  const denom = total - excluded.size;
  const contentShare = (denom - flaggedPosts.size) / denom;

  const kbIssues = s.contested.length + s.contradictions.length;
  const kbShare = (s.kbEntries - kbIssues) / s.kbEntries;

  const themes = new Map<string, number>();
  for (const f of counting) themes.set(f.theme, (themes.get(f.theme) ?? 0) + 1);
  const notes = [...themes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const inbox = {
    flags: s.flags.filter((f) => NEEDS_ACTION.includes(f.status)).length,
    pitches: s.pitches.filter((p) => p.status === "new").length,
    knowledge: kbIssues,
    reviews: s.reviews.length,
  };
  const inboxTotal = inbox.flags + inbox.pitches + inbox.knowledge + inbox.reviews;

  const internal = { ...D.coverage.internal, published: s.internalPublished };
  const external = D.coverage.external;
  const pct = (c: { published: number; goal: number }) => Math.min(1, c.published / c.goal);
  const coveragePct = (pct(internal) + pct(external)) / 2;

  return {
    content: { share: contentShare, grade: gradeFor(contentShare), flagged: flaggedPosts.size, denom, excluded: excluded.size, notes },
    kb: { share: kbShare, grade: gradeFor(kbShare), issues: kbIssues, entries: s.kbEntries },
    inbox,
    inboxTotal,
    coverage: { internal, external, pct: coveragePct, internalPct: pct(internal), externalPct: pct(external) },
  };
}

// ── Context ──────────────────────────────────────────────────────────────

const Ctx = createContext<null | {
  s: State;
  d: ReturnType<typeof derive>;
  dispatch: React.Dispatch<Action>;
  toast: (text: string) => void;
  route: Route;
  go: (r: Route) => void;
}>(null);

function readHash(): Route {
  const h = location.hash.replace("#", "");
  return (ROUTES.includes(h) || h.startsWith("post-") ? h : "onboarding") as Route;
}

/** The editor's paragraphs: written ones, or a stub built from the title and any flagged passages. */
export function bodyFor(s: { bodies: Record<string, string[]>; flags: Flag[] }, id: string): string[] {
  if (s.bodies[id]) return s.bodies[id];
  const o = liveObjects.find((x) => x.id === id);
  const flagged = s.flags.filter((f) => f.objectId === id).map((f) => [f.excerpt.before, f.excerpt.text, f.excerpt.after].join("").trim());
  return flagged.length ? flagged : [o ? `${o.title}.` : "", "Start writing here."];
}

// The prototype's one shortcut: lookups read the live object list without
// threading state through every component.
let liveObjects: D.ContentObject[] = D.objects;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, undefined, initial);
  liveObjects = s.objects;
  const d = useMemo(() => derive(s), [s]);
  const [route, setRoute] = useState<Route>(readHash);

  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const go = (r: Route) => {
    try {
      history.replaceState(null, "", "#" + r);
    } catch {}
    setRoute(r);
    document.getElementById("main")?.scrollTo({ top: 0 });
  };

  const toast = (text: string) => {
    dispatch({ type: "toast", text });
    const id = toastSeq;
    setTimeout(() => dispatch({ type: "untoast", id }), 3600);
  };

  return <Ctx.Provider value={{ s, d, dispatch, toast, route, go }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}

export function topicName(id: string) {
  return D.topics.find((t) => t.id === id)?.name ?? id[0].toUpperCase() + id.slice(1);
}
export function objectOf(id: string) {
  return liveObjects.find((p) => p.id === id)!;
}
export function postTitle(id: string) {
  return objectOf(id)?.title ?? "Untitled";
}
export function claimOf(id: string) {
  return D.claims.find((c) => c.id === id)!;
}
export function sourceOf(id: string) {
  return D.sources.find((x) => x.id === id)!;
}
