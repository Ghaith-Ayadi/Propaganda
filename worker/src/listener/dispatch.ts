// Chat's hand-off (POST /agents/listener): someone pastes a call's transcript
// into Chat and asks the Listener to read it. The text is stored like an ingest
// URL post and read under the same run id, so pasting it twice reads it once.
// No transcript in the ask (just "read my last call") answers 422: the
// Listener reads what it's given, it doesn't go looking for old calls.

import { dispatchAttributes, registerAgent, type DispatchInput } from "../workflows/agents.js";
import { ingest } from "./ingest.js";
import { parseTranscriptText } from "./transcript.js";

/** An unformatted paste this long is worth a read even with no speaker names. */
const MIN_UNNAMED_CHARS = 1000;

/** Two named turns ("Name: ...") or a long paste; anything less is an ask, not a transcript. */
function looksLikeTranscript(segments: { speaker: string; text: string }[]): boolean {
  if (segments.filter((s) => s.speaker !== "Unknown").length >= 2) return true;
  return segments.reduce((n, s) => n + s.text.length, 0) >= MIN_UNNAMED_CHARS;
}

export async function listenOnRequest(input: DispatchInput): Promise<string | null> {
  const segments = parseTranscriptText(input.task);
  if (!looksLikeTranscript(segments)) return null;
  const r = await ingest(
    input.site,
    {
      origin: "url",
      externalId: "",
      title: "Pasted in Chat",
      uri: "",
      occurred: null,
      participants: [],
      segments,
    },
    dispatchAttributes("listener", input),
  );
  return r.run;
}

registerAgent("listener", listenOnRequest);
