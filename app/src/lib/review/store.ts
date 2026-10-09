// The link between the editor's highlights and the Review tab's cards.
//
// The post's review notes are published here (`setNotes`, from lib/review/notes);
// the editor highlights the passages they're about and reports back which ones it found in the text
// and where. Hovering or clicking either side sets `hover` / `active` here, so
// the highlight and its card light up together, and `activeFrom` tells the
// other side to scroll its half into view. Edits the panel makes in the text
// (accept a fix, select a passage) go through the handle the editor registers.

import { useSyncExternalStore } from "react";
import type { ReviewNote } from "./notes";

/** The three parts of the Review tab, each with its own highlight colour. */
export type ReviewSection = "pitch" | "sources" | "kb";

export interface Anchor {
  id: string;
  section: ReviewSection;
  /** The words to find in the post. */
  quote: string;
}

export interface ReviewState {
  postId: string | null;
  /** The Review tab's notes for `postId`, built beside the editor (useReviewPublisher). */
  notes: ReviewNote[];
  loading: boolean;
  /** When the Checker last read the post. */
  checkedAt: string | null;
  anchors: Anchor[];
  /** Anchor id → position in the post, for the anchors found in the text. */
  found: ReadonlyMap<string, number>;
  hover: string | null;
  active: string | null;
  /** Which side set `active`: the other side scrolls to it. */
  activeFrom: "editor" | "panel" | null;
  /** Bumped on every activation, so clicking the same note again still scrolls. */
  seq: number;
}

/** What the editor lets the panel do to the text. */
export interface EditorHandle {
  /** Replaces the anchor's words with `text`. False when they're no longer in the post. */
  replace(id: string, text: string): boolean;
  /** Selects the anchor's words and focuses the editor. */
  select(id: string): boolean;
}

let state: ReviewState = { postId: null, notes: [], loading: false, checkedAt: null, anchors: [], found: new Map(), hover: null, active: null, activeFrom: null, seq: 0 };
let handle: EditorHandle | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<ReviewState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useReviewState(): ReviewState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function subscribeReview(cb: () => void): () => void {
  return subscribe(cb);
}

export function reviewState(): ReviewState {
  return state;
}

/** Publishes the notes for a post; the open ones with words to find become the editor's highlights. */
export function setNotes(postId: string, notes: ReviewNote[], loading: boolean, checkedAt: string | null) {
  const anchors: Anchor[] = notes
    .filter((n) => n.quote && !n.resolved)
    .map((n) => ({ id: n.id, section: n.section, quote: n.quote! }));
  const same =
    state.postId === postId &&
    state.anchors.length === anchors.length &&
    state.anchors.every((a, i) => a.id === anchors[i].id && a.quote === anchors[i].quote && a.section === anchors[i].section);
  set({ postId, notes, loading, checkedAt, anchors: same ? state.anchors : anchors });
}

/** Clears everything when the post closes. */
export function clearNotes(postId: string) {
  if (state.postId !== postId) return;
  set({ postId: null, notes: [], loading: false, checkedAt: null, anchors: [], found: new Map(), hover: null, active: null, activeFrom: null });
}

export function setFound(found: Map<string, number>) {
  const prev = state.found;
  if (prev.size === found.size && [...found].every(([k, v]) => prev.get(k) === v)) return;
  set({ found });
}

export function setHover(id: string | null) {
  if (state.hover !== id) set({ hover: id });
}

export function activate(id: string | null, from: "editor" | "panel") {
  set({ active: id, activeFrom: id ? from : null, seq: state.seq + 1 });
}

export function registerEditor(h: EditorHandle | null) {
  handle = h;
}

export function editorHandle(): EditorHandle | null {
  return handle;
}
