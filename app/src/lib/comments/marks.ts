// Highlights the passages comments are about, like Google Docs: a ProseMirror
// plugin that finds each comment's quote in the post and paints an inline
// decoration over it. Nothing is written into the post. When the quote
// appears more than once, the words saved before and after it pick the right
// one; when the words are rewritten, the highlight goes (the comment stays in
// the list, marked as having lost its passage).

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { normalizeQuote, textblocks } from "@/lib/review/marks";

export interface CommentAnchor {
  id: string;
  quote: string;
  before: string;
  after: string;
}

interface State {
  anchors: CommentAnchor[];
  active: string | null;
  hover: string | null;
  ranges: Map<string, { from: number; to: number }>;
  decorations: DecorationSet;
}

export type CommentMarksMeta = Partial<Pick<State, "anchors" | "active" | "hover">>;

export const commentMarksKey = new PluginKey<State>("commentMarks");

type PmDoc = EditorState["doc"];

function tail(s: string, n: number): string {
  return normalizeQuote(s).slice(-n);
}
function head(s: string, n: number): string {
  return normalizeQuote(s).slice(0, n);
}

/** Where each anchor's words sit now; the best match by surrounding words when they repeat. */
export function findCommentRanges(doc: PmDoc, anchors: CommentAnchor[]): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>();
  if (!anchors.length) return out;
  const blocks = textblocks(doc);
  for (const a of anchors) {
    const q = normalizeQuote(a.quote);
    if (!q) continue;
    let best: { from: number; to: number; score: number } | null = null;
    for (const b of blocks) {
      let i = b.text.indexOf(q);
      while (i >= 0) {
        const around = b.text.slice(0, i);
        const after = b.text.slice(i + q.length);
        const score =
          (a.before && around.endsWith(tail(a.before, 12)) ? 1 : 0) + (a.after && after.startsWith(head(a.after, 12)) ? 1 : 0);
        if (!best || score > best.score) best = { from: b.pos[i], to: b.pos[i + q.length - 1] + 1, score };
        i = b.text.indexOf(q, i + 1);
      }
    }
    if (best) out.set(a.id, { from: best.from, to: best.to });
  }
  return out;
}

function build(doc: PmDoc, s: Pick<State, "anchors" | "active" | "hover">): Pick<State, "ranges" | "decorations"> {
  const ranges = findCommentRanges(doc, s.anchors);
  const decos: Decoration[] = [];
  for (const [id, r] of ranges) {
    const cls = ["comment-mark"];
    if (s.hover === id) cls.push("is-hover");
    if (s.active === id) cls.push("is-active");
    decos.push(Decoration.inline(r.from, r.to, { class: cls.join(" "), "data-comment-id": id }));
  }
  return { ranges, decorations: DecorationSet.create(doc, decos) };
}

/** `onFound` hears which comments are in the text after every change. */
export function commentMarksPlugin(onFound: (found: Set<string>) => void): Plugin<State> {
  return new Plugin<State>({
    key: commentMarksKey,
    state: {
      init: (_, { doc }) => {
        const base = { anchors: [], active: null, hover: null };
        return { ...base, ...build(doc, base) };
      },
      apply(tr, value, _old, next: EditorState) {
        const meta = tr.getMeta(commentMarksKey) as CommentMarksMeta | undefined;
        if (!meta && !tr.docChanged) return value;
        const s = { anchors: value.anchors, active: value.active, hover: value.hover, ...meta };
        return { ...s, ...build(next.doc, s) };
      },
    },
    props: { decorations: (s) => commentMarksKey.getState(s)?.decorations },
    view: (view) => {
      const report = () => onFound(new Set(commentMarksKey.getState(view.state)?.ranges.keys() ?? []));
      report();
      return { update: report };
    },
  });
}
