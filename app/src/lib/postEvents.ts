// Generic, feature-agnostic notification that a post's body was saved locally.
// Core emits it; optional modules (e.g. the Verbose writing-activity heatmap)
// may subscribe. With no subscribers this is a no-op, so it is safe to keep in
// core even when every optional module is stripped out for distribution.

export interface PostContentSaved {
  id: number;
  /** Word count before this save (null if the post had none yet). */
  prevWordCount: number | null;
  /** Word count after this save. */
  wordCount: number | null;
}

type Listener = (e: PostContentSaved) => void;

const listeners = new Set<Listener>();

export function onPostContentSaved(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitPostContentSaved(e: PostContentSaved): void {
  for (const l of listeners) l(e);
}
