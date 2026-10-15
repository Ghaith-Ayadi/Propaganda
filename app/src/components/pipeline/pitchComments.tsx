// Highlight-to-comment inside a pitch: the pitch is plain text in several
// fields (why, angle, audience, outline lines), so the highlight is found by
// the quote inside its field. Comments stay in the dialog until the pitch is
// approved; then they travel together as the pitch's notes.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MessagePlusSquare } from "@untitledui/icons";
import type { PipelineItem, PitchNote } from "@/lib/pipeline/types";
import type { CommentItem, ThreadItem } from "@/components/shared/CommentThreads";
import { newId } from "@/lib/supabase";
import { cx } from "@/utils/cx";

export interface PitchThread {
  id: string;
  /** The field the passage sits in ("angle", an outline line id); null on a general comment. */
  field: string | null;
  quote: string | null;
  resolved: boolean;
  comments: CommentItem[];
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The text of every field a passage can be picked from. */
export function pitchFields(item: PipelineItem): Record<string, string> {
  const f: Record<string, string> = { why: item.why, angle: item.angle, audience: item.audience };
  item.reasons.forEach((r, n) => (f[`reason:${n}`] = r.text));
  item.outline.forEach((l) => (f[l.id] = l.text));
  return f;
}

/** The pitch's saved notes, as threads (one comment each). */
export function threadsFromNotes(notes: PitchNote[], item: PipelineItem): PitchThread[] {
  return notes
    .filter((n) => n.text.trim())
    .map((n) => ({
      id: newId(),
      field: n.quote ? (n.lineId ?? findField(item, n.quote)) : null,
      quote: n.quote ?? null,
      resolved: !!n.done,
      comments: [{ id: newId(), author: "You", at: Date.now(), body: n.text, mine: true }],
    }));
}

function findField(item: PipelineItem, quote: string): string | null {
  const q = squash(quote);
  return Object.entries(pitchFields(item)).find(([, t]) => squash(t).includes(q))?.[0] ?? null;
}

/** The notes the writer gets: one per open thread, replies joined under the first comment. */
export function notesFromThreads(threads: PitchThread[], item: PipelineItem): PitchNote[] {
  const lines = new Set(item.outline.map((l) => l.id));
  return threads
    .filter((t) => !t.resolved && t.comments.length)
    .map((t) => {
      const text = t.comments.map((c) => c.body.trim()).filter(Boolean).join("\n");
      if (!t.quote) return { lineId: null, text };
      return { lineId: t.field && lines.has(t.field) ? t.field : null, text, quote: t.quote };
    })
    .filter((n) => n.text);
}

export function toThreadItems(threads: PitchThread[], item: PipelineItem): ThreadItem[] {
  const fields = pitchFields(item);
  return threads.map((t) => ({
    id: t.id,
    quote: t.quote,
    lost: !!t.quote && !!t.field && !squash(fields[t.field] ?? "").includes(squash(t.quote)),
    resolved: t.resolved,
    comments: t.comments,
  }));
}

interface Ctx {
  threads: PitchThread[];
  activeId: string | null;
  hoverId: string | null;
  onActivate: (id: string) => void;
  onHover: (id: string | null) => void;
}
const HlContext = createContext<Ctx | null>(null);
export const HighlightProvider = HlContext.Provider;

/** Text with the passages comments are about marked. Without a provider it is plain text. */
export function Hl({ field, text }: { field: string; text: string }) {
  const c = useContext(HlContext);
  if (!c) return <>{text}</>;
  const flat = squash(text);
  const spans = c.threads
    .filter((t) => t.field === field && t.quote && !t.resolved)
    .map((t) => ({ id: t.id, at: flat.indexOf(squash(t.quote!)), len: squash(t.quote!).length }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => a.at - b.at);
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.at < pos) continue;
    if (s.at > pos) parts.push(flat.slice(pos, s.at));
    parts.push(
      <mark
        key={s.id}
        data-pitch-mark={s.id}
        onMouseEnter={() => c.onHover(s.id)}
        onMouseLeave={() => c.onHover(null)}
        onClick={() => c.onActivate(s.id)}
        className={cx(
          "cursor-pointer rounded-xs text-inherit transition-colors",
          c.activeId === s.id || c.hoverId === s.id ? "bg-utility-blue-300" : "bg-utility-blue-100",
        )}
      >
        {flat.slice(s.at, s.at + s.len)}
      </mark>,
    );
    pos = s.at + s.len;
  }
  if (!parts.length) return <span data-pitch-field={field}>{text}</span>;
  parts.push(flat.slice(pos));
  return <span data-pitch-field={field}>{parts}</span>;
}

/** A field's text, selectable for a comment. */
export function Passage({ field, text }: { field: string; text: string }) {
  return (
    <span data-pitch-field-root={field}>
      <Hl field={field} text={text} />
    </span>
  );
}

interface Pick {
  field: string;
  quote: string;
  x: number;
  y: number;
}

function fieldOf(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>("[data-pitch-field-root]") ?? null;
}

/**
 * Watches a selection inside one field of `root` and offers a Comment button
 * beside it. Calls `onPick(field, quote)` when it is pressed.
 */
export function SelectionComment({ root, onPick }: { root: HTMLElement | null; onPick: (field: string, quote: string) => void }) {
  const [pick, setPick] = useState<Pick | null>(null);

  useEffect(() => {
    if (!root) return;
    const read = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setPick(null);
      const range = sel.getRangeAt(0);
      const a = fieldOf(range.startContainer);
      const b = fieldOf(range.endContainer);
      if (!a || a !== b || !root.contains(a)) return setPick(null);
      const quote = squash(sel.toString());
      if (!quote) return setPick(null);
      const r = range.getBoundingClientRect();
      setPick({ field: a.dataset.pitchFieldRoot!, quote, x: r.left + r.width / 2, y: r.top });
    };
    const clear = () => setPick(null);
    root.addEventListener("mouseup", read);
    root.addEventListener("keyup", read);
    root.addEventListener("scroll", clear);
    return () => {
      root.removeEventListener("mouseup", read);
      root.removeEventListener("keyup", read);
      root.removeEventListener("scroll", clear);
    };
  }, [root]);

  if (!pick) return null;
  return (
    <button
      type="button"
      // keep the selection alive while pressing
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onPick(pick.field, pick.quote);
        window.getSelection()?.removeAllRanges();
        setPick(null);
      }}
      style={{ left: pick.x, top: Math.max(8, pick.y - 44) }}
      className="fixed z-[60] flex -translate-x-1/2 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-secondary shadow-lg ring-1 ring-primary ring-inset hover:bg-primary_hover"
    >
      <MessagePlusSquare className="size-4" />
      Comment
    </button>
  );
}
