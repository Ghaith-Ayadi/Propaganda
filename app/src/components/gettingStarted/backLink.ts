// A draft opened from Getting started: the editor shows a way back, and the
// first article's "Approve and publish now". Remembered per tab, per post.

const KEY = "propaganda:from-getting-started";

/** Open a draft in the editor, remembering it came from Getting started. */
export function openFromStart(postId: string) {
  try {
    sessionStorage.setItem(KEY, postId);
  } catch {
    // No session storage: the editor opens without the strip.
  }
  window.location.hash = `#/post/${postId}`;
}

/** True when this post was opened from Getting started in this tab. */
export function openedFromStart(postId: string): boolean {
  try {
    return sessionStorage.getItem(KEY) === postId;
  } catch {
    return false;
  }
}

export function forgetStart() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Set once a post is published from the strip, so the page can celebrate it once. */
export const JUST_PUBLISHED_KEY = "propaganda:just-published";
