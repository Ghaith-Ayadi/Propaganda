// Bridges the generic core save event to the writing-activity store. This is
// the module's only inbound coupling to core, and it is one-directional: core
// emits, Verbose listens. Core has no idea Verbose exists.

import { onPostContentSaved } from "@/lib/postEvents";
import { addWords } from "./store";

export function installRecorder(): () => void {
  return onPostContentSaved(({ prevWordCount, wordCount }) => {
    const delta = (wordCount ?? 0) - (prevWordCount ?? 0);
    if (delta > 0) void addWords(delta);
  });
}
