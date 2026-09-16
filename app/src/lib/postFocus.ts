// One-shot signal: "focus the title of post N the next time its editor mounts".
// Used by the cmd+K new-post flow to drop the caret in the title field.

let pending: string | null = null;

export function requestTitleFocus(id: string) {
  pending = id;
}

export function consumeTitleFocus(id: string): boolean {
  if (pending === id) {
    pending = null;
    return true;
  }
  return false;
}
