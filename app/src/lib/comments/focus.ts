// What the comments panel and the editor share while a post is open: which
// thread is hovered or active, which threads still find their words in the
// text, and the passage someone has just selected to comment on.

import { useSyncExternalStore } from "react";

export interface Draft {
  quote: string;
  before: string;
  after: string;
}

interface Focus {
  active: string | null;
  hover: string | null;
  /** Which side set `active`; the other scrolls to it. */
  from: "editor" | "panel" | null;
  seq: number;
  /** Threads whose words are still in the text. */
  found: ReadonlySet<string>;
  /** A passage waiting for its comment to be written. */
  draft: Draft | null;
}

let state: Focus = { active: null, hover: null, from: null, seq: 0, found: new Set(), draft: null };
const listeners = new Set<() => void>();

function set(patch: Partial<Focus>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export const commentFocus = () => state;
export const subscribeCommentFocus = subscribe;
export const useCommentFocus = (): Focus => useSyncExternalStore(subscribe, () => state, () => state);

export const activateComment = (id: string | null, from: "editor" | "panel") =>
  set({ active: id, from: id ? from : null, seq: state.seq + 1, draft: id ? null : state.draft });
export const hoverComment = (id: string | null) => state.hover !== id && set({ hover: id });
export const startComment = (draft: Draft | null) => set({ draft, active: null, from: null, seq: state.seq + 1 });
export function setFoundComments(found: Set<string>) {
  const prev = state.found;
  if (prev.size === found.size && [...found].every((id) => prev.has(id))) return;
  set({ found });
}
export const clearCommentFocus = () => set({ active: null, hover: null, from: null, draft: null, found: new Set() });
