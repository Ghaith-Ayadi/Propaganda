// Highlights the Review tab's passages in the editor, like a grammar checker:
// a ProseMirror plugin that finds each note's words in the post and paints an
// inline decoration over them. Nothing is written into the post; the marks are
// recomputed from the text on every change, so they follow edits and vanish
// when the words are rewritten.

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Anchor } from "./store";

type PmNode = EditorState["doc"];

export interface MarksState {
  anchors: Anchor[];
  hover: string | null;
  active: string | null;
  /** Anchor id → its range in the document. */
  ranges: Map<string, { from: number; to: number }>;
  decorations: DecorationSet;
}

export type MarksMeta = Partial<Pick<MarksState, "anchors" | "hover" | "active">>;

export const reviewMarksKey = new PluginKey<MarksState>("reviewMarks");

/** Lower case, straight quotes, single spaces, no markdown emphasis: how a quote and the text are compared. */
function normChar(c: string): string {
  if (/\s/.test(c)) return " ";
  if (c === "‘" || c === "’" || c === "ʼ") return "'";
  if (c === "“" || c === "”") return '"';
  return c.toLowerCase();
}

export function normalizeQuote(q: string): string {
  let out = "";
  for (const c of q.replace(/\*\*|__|`/g, "").trim()) {
    const n = normChar(c);
    if (n === " " && out.endsWith(" ")) continue;
    out += n;
  }
  // A quote is often a whole sentence; the text may carry it without the final stop.
  return out.replace(/[.\s]+$/, "").replace(/^["']|["']$/g, "");
}

/** Every textblock's text, normalised, with the document position of each character. */
function textblocks(doc: PmNode): { text: string; pos: number[] }[] {
  const out: { text: string; pos: number[] }[] = [];
  doc.descendants((node, start) => {
    if (!node.isTextblock) return true;
    let text = "";
    const pos: number[] = [];
    node.forEach((child, offset) => {
      const at = start + 1 + offset;
      if (child.isText) {
        const s = child.text ?? "";
        for (let i = 0; i < s.length; i++) {
          const n = normChar(s[i]);
          if (n === " " && text.endsWith(" ")) continue;
          text += n;
          pos.push(at + i);
        }
      } else {
        // An inline node (a mention): one character nobody quotes.
        text += "￼";
        pos.push(at);
      }
    });
    out.push({ text, pos });
    return false;
  });
  return out;
}

export function findRanges(doc: PmNode, anchors: Anchor[]): Map<string, { from: number; to: number }> {
  const ranges = new Map<string, { from: number; to: number }>();
  if (!anchors.length) return ranges;
  const blocks = textblocks(doc);
  for (const a of anchors) {
    const q = normalizeQuote(a.quote);
    if (q.length < 3) continue;
    for (const b of blocks) {
      const i = b.text.indexOf(q);
      if (i < 0) continue;
      ranges.set(a.id, { from: b.pos[i], to: b.pos[i + q.length - 1] + 1 });
      break;
    }
  }
  return ranges;
}

function build(doc: PmNode, s: Omit<MarksState, "decorations" | "ranges">): Pick<MarksState, "ranges" | "decorations"> {
  const ranges = findRanges(doc, s.anchors);
  const decos: Decoration[] = [];
  for (const a of s.anchors) {
    const r = ranges.get(a.id);
    if (!r) continue;
    const cls = ["review-mark", `review-mark--${a.section}`];
    if (s.hover === a.id) cls.push("is-hover");
    if (s.active === a.id) cls.push("is-active");
    decos.push(Decoration.inline(r.from, r.to, { class: cls.join(" "), "data-review-id": a.id }));
  }
  return { ranges, decorations: DecorationSet.create(doc, decos) };
}

/** The plugin. `onFound` hears which anchors are in the text, and where, after every change. */
export function reviewMarksPlugin(onFound: (found: Map<string, number>) => void): Plugin<MarksState> {
  return new Plugin<MarksState>({
    key: reviewMarksKey,
    state: {
      init: (_, { doc }) => {
        const base = { anchors: [], hover: null, active: null };
        return { ...base, ...build(doc, base) };
      },
      apply(tr, value, _old, next: EditorState) {
        const meta = tr.getMeta(reviewMarksKey) as MarksMeta | undefined;
        if (!meta && !tr.docChanged) return value;
        const s = { anchors: value.anchors, hover: value.hover, active: value.active, ...meta };
        return { ...s, ...build(next.doc, s) };
      },
    },
    props: {
      decorations: (s) => reviewMarksKey.getState(s)?.decorations,
    },
    view: (view) => {
      const report = () => {
        const ranges = reviewMarksKey.getState(view.state)?.ranges ?? new Map();
        onFound(new Map([...ranges].map(([id, r]) => [id, r.from])));
      };
      report();
      return { update: report };
    },
  });
}
