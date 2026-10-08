// One shape for everything the Listener reads: a call from any recorder, a
// Slack thread, a transcript someone POSTed. Each connector turns its own
// payload into a Transcript; the rest of the Listener only knows this.
//
// The body that lands in kb_sources is rendered here, once, as
// "Speaker: text" lines. Quotes are spans of that body (kb_evidence keeps
// offsets into it), so the rendering must never change for a stored source.

import { createHash } from "node:crypto";

export type Origin = "url" | "granola" | "slack" | "meet" | "zoom" | "teams";

/** Whose side a speaker is on. Facts about the tenant only come from its own people. */
export type Side = "internal" | "external" | "unknown";

export interface Participant {
  name: string;
  email?: string;
  slackId?: string;
  side?: Side;
}

export interface Segment {
  speaker: string;
  text: string;
  /** Epoch ms, when the recorder gives it. */
  at?: number;
}

export interface Transcript {
  origin: Origin;
  /** The recorder's own id (a Granola note, a Zoom meeting uuid, a Slack thread): idempotency. */
  externalId: string;
  title: string;
  /** Link to the original, '' when there is none. */
  uri: string;
  /** Epoch ms when the call or thread started. */
  occurred: number | null;
  participants: Participant[];
  segments: Segment[];
}

export const MAX_BODY = 2_000_000; // kb_sources.body's limit

/** "Speaker: text" per line, consecutive turns of one speaker merged. */
export function renderBody(segments: Segment[]): string {
  const lines: string[] = [];
  let last = "";
  for (const s of segments) {
    const text = s.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker = s.speaker.replace(/\s+/g, " ").trim() || "Unknown";
    if (speaker === last && lines.length) lines[lines.length - 1] += ` ${text}`;
    else lines.push(`${speaker}: ${text}`);
    last = speaker;
  }
  const body = lines.join("\n");
  return body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---- formats people paste or recorders export ----

const CUE_TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*/;

function cueMs(line: string): number | undefined {
  const m = CUE_TIME.exec(line);
  if (!m) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, "0"));
}

/**
 * WebVTT (Zoom, Teams, Meet exports) and SRT. Speakers come from `<v Name>`
 * tags (Teams), a "Name: text" cue (Zoom), or are left unknown.
 */
export function parseCaptions(text: string): Segment[] {
  const out: Segment[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timeIdx = lines.findIndex((l) => CUE_TIME.test(l));
    if (timeIdx < 0) continue;
    const at = cueMs(lines[timeIdx]!);
    const cue = lines.slice(timeIdx + 1).join(" ").trim();
    if (!cue) continue;
    let speaker = "";
    let said = cue;
    const v = /^<v(?:\.[^ >]*)?\s+([^>]+)>(.*?)(?:<\/v>)?$/s.exec(cue);
    if (v) {
      speaker = v[1]!.trim();
      said = v[2]!;
    } else {
      const named = /^([^:]{1,80}):\s+(.*)$/s.exec(cue);
      if (named) {
        speaker = named[1]!.trim();
        said = named[2]!;
      }
    }
    said = said.replace(/<[^>]+>/g, "").trim();
    if (said) out.push({ speaker: speaker || "Unknown", text: said, at });
  }
  return out;
}

/** Plain text: "Name: text" lines, or "Name" on its own line then what they said. Otherwise one unknown speaker. */
export function parsePlain(text: string): Segment[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Segment[] = [];
  let speaker = "";
  let named = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // "Ayadi: ..." or "[00:12:03] Ayadi: ..." or "Ayadi (00:12): ..."
    const m = /^(?:\[?[\d:.]+\]?\s+)?([A-Z][^:]{0,60}?)(?:\s*\([\d:.]+\))?:\s+(.+)$/.exec(line);
    if (m) {
      speaker = m[1]!.trim();
      named++;
      out.push({ speaker, text: m[2]! });
    } else if (out.length && speaker) {
      out[out.length - 1]!.text += ` ${line}`;
    } else {
      out.push({ speaker: "Unknown", text: line });
    }
  }
  // Mostly unnamed lines: it isn't a speaker format, keep the text whole.
  if (named === 0) return [{ speaker: "Unknown", text: lines.join(" ").trim() }].filter((s) => s.text);
  return out;
}

/** WEBVTT / SRT when it looks like captions, else plain text. */
export function parseTranscriptText(text: string): Segment[] {
  const head = text.slice(0, 2000);
  if (/^﻿?WEBVTT/.test(head) || /\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/.test(head)) return parseCaptions(text);
  return parsePlain(text);
}

/**
 * Who is internal, from email domains: the tenant's own domains are passed in
 * (its members' and its site's). Anything else with an email is external.
 */
export function sideOf(p: Participant, internalDomains: Set<string>): Side {
  if (p.side && p.side !== "unknown") return p.side;
  const domain = p.email?.split("@")[1]?.toLowerCase();
  if (!domain) return "unknown";
  return internalDomains.has(domain) ? "internal" : "external";
}
