// Everything the Review tab says about one post, as one list of notes: the
// tenant's own notes from the pitch, the source check on numbers and quotes,
// and the knowledge base's flags and Remember offers. Each note carries the
// words it is about (its anchor in the text) and what can be done about it.
//
// Sources, until the pipeline and the knowledge base read live data:
//   - the pipeline item (lib/pipeline, placeholder): pitch notes, its draft's
//     source check, sentences about the tenant, and sample flags;
//   - kb().postFindings (lib/knowledge): the Checker's latest kb_checks report
//     and the open kb_flags on the post. Empty while KB_BACKEND is "placeholder".

import { useCallback, useEffect, useState } from "react";
import { kb } from "@/lib/knowledge/adapter";
import { changed, useKb } from "@/lib/knowledge/hooks";
import type { PostFindings, PostFlag } from "@/lib/knowledge/types";
import { setClaimState, updateItem } from "@/lib/pipeline/store";
import type { PipelineItem } from "@/lib/pipeline/types";
import { pageHref } from "@/lib/route";
import { siteId } from "@/lib/scope";
import { track } from "@/lib/telemetry";
import { toast } from "@/components/base/toast/toast";
import { clearNotes, editorHandle, setNotes, type ReviewSection } from "./store";

export type NoteTone = "issue" | "note" | "ok";

export interface NoteAction {
  label: string;
  run: () => void | Promise<void>;
  /** The main action of the card. */
  primary?: boolean;
}

export interface ReviewNote {
  id: string;
  section: ReviewSection;
  tone: NoteTone;
  /** The words in the post it is about; null for a general note. */
  quote: string | null;
  title: string;
  body: string;
  /** Where it comes from: a call, a source link, a knowledge base claim. */
  meta?: string;
  href?: string;
  /** Replacement for `quote`, shown as a suggestion. */
  fix?: string;
  /** Set once handled: "Done", "Dismissed", "Remembered"... The card collapses. */
  resolved: string | null;
  actions: NoteAction[];
  /** Undo for a resolved note, when it can be undone. */
  undo?: () => void;
}

const EMPTY: PostFindings = { checkedAt: null, sources: [], remember: [], flags: [] };

// ---- how findings with no server state were handled (this browser only) ----

function resolvedKey(postId: string): string {
  let site = "none";
  try {
    site = siteId();
  } catch {
    // no active site
  }
  return `propaganda:review-resolved:${site}:${postId}`;
}

function readResolved(postId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(resolvedKey(postId)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Note id → what was done ("Dismissed", "Fixed"...), kept per post in this browser. */
function useLocalResolved(postId: string): [Record<string, string>, (id: string, label: string | null) => void] {
  const [map, setMap] = useState(() => readResolved(postId));
  const [forPost, setForPost] = useState(postId);
  if (forPost !== postId) {
    setForPost(postId);
    setMap(readResolved(postId));
  }
  const set = useCallback(
    (id: string, label: string | null) => {
      setMap((prev) => {
        const next = { ...prev };
        if (label) next[id] = label;
        else delete next[id];
        try {
          localStorage.setItem(resolvedKey(postId), JSON.stringify(next));
        } catch {
          // storage full or blocked: it holds until reload
        }
        return next;
      });
    },
    [postId],
  );
  return [map, set];
}

// ---- the list ----

/** What the cards do to the text: through the editor's handle (lib/review/store). */
const h = {
  replace: (noteId: string, text: string) => editorHandle()?.replace(noteId, text) ?? false,
  select: (noteId: string) => editorHandle()?.select(noteId) ?? false,
  toast: (title: string) => {
    toast.add({ title });
  },
};

export function useReviewNotes(postId: string, item: PipelineItem | undefined) {
  const findings = useKb<PostFindings>("review.findings", () => kb().postFindings(postId), [postId]);
  const [local, resolve] = useLocalResolved(postId);

  const f = findings.data ?? EMPTY;
  const notes: ReviewNote[] = [];

  const dismissible = (id: string): Pick<ReviewNote, "resolved" | "undo"> & { dismissAction: NoteAction } => ({
    resolved: local[id] ?? null,
    undo: local[id] ? () => resolve(id, null) : undefined,
    dismissAction: { label: "Dismiss", run: () => resolve(id, "Dismissed") },
  });

  // 1. Your notes at the pitch.
  item?.notes.forEach((n, k) => {
    const id = `pitch-${k}`;
    const line = n.lineId ? item.outline.find((l) => l.id === n.lineId)?.text : undefined;
    const setDone = (done: boolean) =>
      updateItem(item.id, { notes: item.notes.map((m, j) => (j === k ? { ...m, done } : m)) });
    notes.push({
      id,
      section: "pitch",
      tone: "note",
      quote: n.quote ?? line ?? null,
      title: line ? `On “${line}”` : "On the whole post",
      body: n.text,
      resolved: n.done ? "Done" : null,
      undo: n.done ? () => setDone(false) : undefined,
      actions: [{ label: "Mark done", primary: true, run: () => setDone(true) }],
    });
  });

  // 2. Source checks: the draft's own (placeholder) and the Checker's.
  const sourceNote = (
    id: string,
    s: { quote: string; status: "matches" | "mismatch" | "unsourced" | "unreachable"; detail: string; where?: string; url?: string; fix?: string },
  ) => {
    const d = dismissible(id);
    const titles = {
      matches: "Holds up",
      mismatch: "Doesn't match its source",
      unsourced: "No source",
      unreachable: "The source didn't load",
    } as const;
    const actions: NoteAction[] = [];
    if (s.fix) {
      actions.push({
        label: "Accept",
        primary: true,
        run: () => {
          if (h.replace(id, s.fix!)) {
            resolve(id, "Fixed");
            track("review_fix_applied", { section: "sources" });
          } else h.toast("Those words aren't in the post anymore.");
        },
      });
    }
    if (s.status === "unsourced") {
      actions.push({
        label: "Add a link",
        primary: !s.fix,
        run: () => {
          if (h.select(id)) h.toast("Paste a link to attach it to the selected words.");
          else h.toast("Those words aren't in the post anymore.");
        },
      });
    }
    actions.push(d.dismissAction);
    notes.push({
      id,
      section: "sources",
      tone: s.status === "matches" ? "ok" : "issue",
      quote: s.quote || null,
      title: titles[s.status],
      body: s.detail,
      meta: s.where,
      href: s.url,
      fix: s.fix,
      resolved: s.status === "matches" ? "Holds up" : d.resolved,
      undo: d.undo,
      actions,
    });
  };
  item?.review?.checks.forEach((c) => sourceNote(`src-${c.id}`, c));
  // Keyed by the report and the words, so a dismissal never carries over to a new finding.
  f.sources.forEach((s, k) =>
    sourceNote(`chk-${keyOf(f.checkedAt, s.quote, k)}`, {
      quote: s.quote,
      status: s.verdict === "ok" ? "matches" : s.verdict === "unsupported" ? "unsourced" : s.verdict,
      detail: s.note,
      url: s.url || undefined,
      where: s.url ? hostOf(s.url) : undefined,
      fix: s.fix,
    }),
  );

  // 3. Knowledge base: flags, then sentences about the tenant to remember.
  const flagNote = (id: string, flag: PostFlag, live: boolean) => {
    const resolvedPlaceholder = !live && flag.status !== "open" && flag.status !== "snoozed";
    const setStatus = (status: PostFlag["status"]) => {
      if (!item?.review) return;
      updateItem(item.id, {
        review: { ...item.review, flags: (item.review.flags ?? []).map((x) => (x.id === flag.id ? { ...x, status } : x)) },
      });
    };
    const actions: NoteAction[] = [];
    if (flag.fix) {
      actions.push({
        label: "Accept",
        primary: true,
        run: () => {
          if (!h.replace(id, flag.fix!)) {
            h.toast("Those words aren't in the post anymore.");
            return;
          }
          track("review_fix_applied", { section: "kb" });
          if (live) resolve(id, "Fixed. The Checker confirms it on the next version.");
          else setStatus("fixed");
        },
      });
    }
    actions.push({
      label: "Won't fix",
      run: async () => {
        if (live) {
          await kb().closeFlag(flag.id, "wont_fix");
          changed();
        } else setStatus("wont_fix");
      },
    });
    notes.push({
      id,
      section: "kb",
      tone: "issue",
      quote: flag.quote || null,
      title: FLAG_TITLE[flag.kind],
      body: flag.explanation,
      meta: flag.claim ? `Knowledge base: “${flag.claim}”` : undefined,
      fix: flag.fix ?? undefined,
      resolved: local[id]
        ? local[id]
        : resolvedPlaceholder
          ? flag.status === "fixed"
            ? "Fixed"
            : "Won't fix"
          : null,
      undo: resolvedPlaceholder ? () => setStatus("open") : undefined,
      href: live ? pageHref("knowledge", `flags/${flag.id}`) : undefined,
      actions,
    });
  };
  item?.review?.flags?.forEach((fl) => flagNote(`flag-${fl.id}`, fl, false));
  f.flags.forEach((fl) => flagNote(`kbf-${fl.id}`, fl, true));

  item?.review?.ownClaims.forEach((c) => {
    notes.push({
      id: `own-${c.id}`,
      section: "kb",
      tone: "note",
      quote: c.sentence,
      title: "New fact about you",
      body: "First time this is said in public. Remember it, so later posts stay consistent with it?",
      resolved: c.state === "remembered" ? "Remembered" : c.state === "not_a_fact" ? "Not a fact" : null,
      undo: c.state === "open" ? undefined : () => setClaimState(item.id, c.id, "open"),
      actions: [
        {
          label: "Remember",
          primary: true,
          run: () => {
            setClaimState(item.id, c.id, "remembered");
            track("claim_remembered", { from: "review" });
          },
        },
        { label: "Not a fact", run: () => setClaimState(item.id, c.id, "not_a_fact") },
      ],
    });
  });
  f.remember.forEach((r, k) => {
    const id = `rem-${keyOf(f.checkedAt, r.text, k)}`;
    const d = dismissible(id);
    notes.push({
      id,
      section: "kb",
      tone: "note",
      quote: r.quote || null,
      title: "New fact about you",
      body: `“${r.text}” First time this is said in public. Remember it, so later posts stay consistent with it?`,
      resolved: d.resolved,
      undo: local[id] === "Not a fact" ? d.undo : undefined,
      actions: [
        {
          label: "Remember",
          primary: true,
          run: async () => {
            await kb().remember({ text: r.text, topics: [], scope: {} });
            track("claim_remembered", { from: "review" });
            resolve(id, "Remembered");
            h.toast("Remembered. The Guardian files it in the knowledge base.");
          },
        },
        { label: "Not a fact", run: () => resolve(id, "Not a fact") },
      ],
    });
  });

  return { notes, loading: findings.loading, error: findings.error, checkedAt: f.checkedAt };
}

const FLAG_TITLE: Record<PostFlag["kind"], string> = {
  contradiction: "Contradicts the knowledge base",
  recheck: "A fact it relies on changed",
  kb_conflict: "The knowledge base disagrees with itself here",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Builds the post's notes and publishes them to the review store. Mounted with
 * the editor, so the highlights show whichever side tab is open.
 */
export function useReviewPublisher(postId: string, item: PipelineItem | undefined) {
  const { notes, loading, checkedAt } = useReviewNotes(postId, item);
  useEffect(() => {
    setNotes(postId, notes, loading, checkedAt);
  });
  useEffect(() => () => clearNotes(postId), [postId]);
}

/** A short stable key for a finding of one Checker report. */
function keyOf(checkedAt: string | null, text: string, k: number): string {
  let h = 0;
  for (const c of `${checkedAt ?? ""}|${text || k}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
