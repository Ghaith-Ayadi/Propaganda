// The open ingest URL: any recorder, Zapier, Make or a script can POST a
// transcript to https://app.propaganda.pub/worker/v1/ingest/<token>. The
// token is the tenant's (Settings > Connections), shown once, revocable.
//
// Accepted bodies:
//   text/plain, text/vtt, application/x-subrip   the transcript itself;
//                                                ?title=&occurred=&uri= in the query
//   application/json   { title?, occurred?, uri?, external_id?,
//                        participants?: [{ name, email? }],
//                        transcript?: string            (plain, VTT or SRT)
//                        segments?: [{ speaker, text, at? }] }
// One of transcript / segments is required.

import { parseTranscriptText, type Participant, type Segment, type Transcript } from "../transcript.js";

export class BadInput extends Error {}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function when(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function fromUrlPost(contentType: string, raw: string, query: URLSearchParams): Transcript {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") {
    const segments = parseTranscriptText(raw);
    if (!segments.length) throw new BadInput("The transcript is empty");
    return {
      origin: "url",
      externalId: str(query.get("external_id"), 200),
      title: str(query.get("title"), 300),
      uri: str(query.get("uri"), 2000),
      occurred: when(query.get("occurred")),
      participants: [],
      segments,
    };
  }

  let body: Record<string, unknown>;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    body = v;
  } catch {
    throw new BadInput("The body is not a JSON object");
  }
  let segments: Segment[] = [];
  if (Array.isArray(body.segments)) {
    segments = body.segments
      .map((s) => (s ?? {}) as Record<string, unknown>)
      .map((s) => ({ speaker: str(s.speaker, 200) || "Unknown", text: str(s.text, 100_000), at: when(s.at) ?? undefined }))
      .filter((s) => s.text.trim());
  } else if (typeof body.transcript === "string") {
    segments = parseTranscriptText(body.transcript);
  }
  if (!segments.length) throw new BadInput("Send `transcript` (text) or `segments` ([{ speaker, text }])");

  const participants: Participant[] = Array.isArray(body.participants)
    ? body.participants
        .map((p) => (p ?? {}) as Record<string, unknown>)
        .map((p) => ({ name: str(p.name, 200), email: str(p.email, 320) || undefined }))
        .filter((p) => p.name || p.email)
        .map((p) => ({ ...p, name: p.name || p.email! }))
    : [];

  return {
    origin: "url",
    externalId: str(body.external_id, 200),
    title: str(body.title, 300),
    uri: str(body.uri, 2000),
    occurred: when(body.occurred),
    participants,
    segments,
  };
}
