// What the Listener asks the model, and how it checks the answer. Pure: no
// I/O, so test/listener.mjs runs it on fixtures.
//
// One read of the source pulls three things out, each with the exact span it
// came from: ideas (objections, questions, weak answers, claims nobody backed
// up), candidate facts for the knowledge base, and who said them. It errs on
// the side of too much: the Pitcher and the Guardian are the filters.
//
// The model's quotes are never trusted: each one is found in the body, and an
// item whose quote isn't there is dropped. A weak answer in a call is a
// content gap, never a fact.

import type { Participant, Side } from "./transcript.js";

export const IDEA_KINDS = ["objection", "question", "weak_answer", "unbacked_claim", "contention", "other"] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

export interface Span {
  quote: string;
  start: number;
  end: number;
}

export interface Fact extends Span {
  /** One standalone sentence, no people in it ("Kontra's Pro plan includes 3 seats"). */
  text: string;
  speaker: string;
  topic: string;
}

export interface Idea extends Span {
  title: string;
  kind: IdeaKind;
  why: string;
  speaker: string;
}

export interface Extraction {
  facts: Fact[];
  ideas: Idea[];
  /** Items the model gave whose quote isn't in the source, or that broke a rule. */
  dropped: number;
}

/** Characters per model call. A one-hour call is about 60k; longer ones are read in parts. */
export const CHUNK_CHARS = 90_000;

export function chunks(body: string, size = CHUNK_CHARS): { offset: number; text: string }[] {
  if (body.length <= size) return [{ offset: 0, text: body }];
  const out: { offset: number; text: string }[] = [];
  let at = 0;
  while (at < body.length) {
    let end = Math.min(at + size, body.length);
    // Cut at a line break so a turn isn't split.
    if (end < body.length) {
      const nl = body.lastIndexOf("\n", end);
      if (nl > at + size / 2) end = nl + 1;
    }
    out.push({ offset: at, text: body.slice(at, end) });
    at = end;
  }
  return out;
}

export function systemPrompt(tenantName: string): string {
  return `You are the Listener for ${tenantName || "a tenant"} on Propaganda, a content system. You read one call transcript or one Slack thread and pull out what the content team needs. You never write content.

Return JSON only, this shape:
{"ideas":[{"title":"","kind":"objection|question|weak_answer|unbacked_claim|contention|other","why":"","quote":"","speaker":""}],
 "facts":[{"text":"","quote":"","speaker":"","topic":""}]}

Ideas are content gaps: an objection someone raised, a question asked, an answer that was weak or improvised, a claim nobody backed up, two people disagreeing (contention). "title" is the post or answer the team is missing, in a few words. "why" is one sentence on why it is a gap.

Facts are candidate facts about the tenant: what it sells, prices, plans, features, customers, numbers, dates, positions it takes. "text" is one plain, standalone sentence that could be wrong, naming the subject in full (write "${tenantName || "The tenant"}'s Pro plan includes 3 seats", never "It includes 3"). Never put a person in the sentence. "topic" is a short subject label (Pricing, Product, Security...).

Rules:
- "quote" is copied exactly, character for character, from the transcript: the shortest span that shows it. Never paraphrase a quote.
- A weak answer is an idea, never a fact.
- Facts come from the tenant's own people only (marked internal). What a prospect, customer or guest says is an idea at most.
- Err on the side of too much: a few ideas and facts per call is normal; an empty list is fine when there is nothing.
- People named in the transcript are not facts.`;
}

export function userPrompt(input: {
  title: string;
  kind: "call" | "slack";
  participants: (Participant & { side: Side })[];
  text: string;
  part?: { index: number; of: number };
}): string {
  const who = input.participants.length
    ? input.participants.map((p) => `- ${p.name}${p.email ? ` <${p.email}>` : ""}: ${p.side}`).join("\n")
    : "- not listed";
  const part = input.part && input.part.of > 1 ? ` (part ${input.part.index + 1} of ${input.part.of})` : "";
  return `${input.kind === "call" ? "Call" : "Slack thread"}: ${input.title || "untitled"}${part}

Participants:
${who}

Transcript:
<<<
${input.text}
>>>`;
}

// ---- checking the answer ----

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** The JSON object in a model's answer (it may wrap it in a code fence or a sentence). */
export function parseJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Where `quote` is in `body`: exact first, then ignoring case, runs of
 * whitespace and curly quotes. Null when it isn't there.
 */
export function anchor(body: string, quote: string, from = 0): { start: number; end: number } | null {
  const q = quote.trim();
  if (q.length < 3) return null;
  const exact = body.indexOf(q, from);
  if (exact >= 0) return { start: exact, end: exact + q.length };

  // Normalise both, keeping a map from each normalised character to the body's offset.
  const norm = (c: string) => c.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  let nb = "";
  const map: number[] = [];
  let space = false;
  for (let i = from; i < body.length; i++) {
    const c = body[i]!;
    if (/\s/.test(c)) {
      if (!space && nb.length) {
        nb += " ";
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    nb += norm(c);
    map.push(i);
  }
  const nq = norm(q).replace(/\s+/g, " ");
  const at = nb.indexOf(nq);
  if (at < 0) return null;
  return { start: map[at]!, end: map[at + nq.length - 1]! + 1 };
}

/**
 * Turn the model's JSON for one chunk into checked items, with spans in the
 * whole body. `sides` maps a speaker name (lower case) to their side.
 */
export function checkExtraction(
  answer: Record<string, unknown> | null,
  body: string,
  chunk: { offset: number; text: string },
  sides: Map<string, Side>,
): Extraction {
  const out: Extraction = { facts: [], ideas: [], dropped: 0 };
  if (!answer) return out;
  const find = (quote: string) => {
    const a = anchor(chunk.text, quote);
    if (!a) return null;
    const start = chunk.offset + a.start;
    const end = chunk.offset + a.end;
    return { quote: body.slice(start, end), start, end };
  };

  for (const raw of Array.isArray(answer.ideas) ? answer.ideas : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const span = find(str(r.quote, 4000));
    const title = str(r.title, 300);
    if (!span || !title) {
      out.dropped++;
      continue;
    }
    const kind = (IDEA_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as IdeaKind) : "other";
    out.ideas.push({ ...span, title, kind, why: str(r.why, 1000), speaker: str(r.speaker, 200) });
  }

  for (const raw of Array.isArray(answer.facts) ? answer.facts : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const span = find(str(r.quote, 4000));
    const text = str(r.text, 1000);
    const speaker = str(r.speaker, 200);
    // Facts come from the tenant's people. Unknown sides (a pasted transcript
    // with no emails) are let through: the Guardian checks them anyway.
    if (!span || !text || sides.get(speaker.toLowerCase()) === "external") {
      out.dropped++;
      continue;
    }
    out.facts.push({ ...span, text, speaker, topic: str(r.topic, 120) });
  }
  return out;
}

/** Merge the parts of a long source, dropping the same item seen twice at a chunk edge. */
export function mergeExtractions(parts: Extraction[]): Extraction {
  const out: Extraction = { facts: [], ideas: [], dropped: 0 };
  const seenFacts = new Set<string>();
  const seenIdeas = new Set<string>();
  for (const p of parts) {
    out.dropped += p.dropped;
    for (const f of p.facts) {
      const k = f.text.toLowerCase();
      if (seenFacts.has(k)) continue;
      seenFacts.add(k);
      out.facts.push(f);
    }
    for (const i of p.ideas) {
      const k = `${i.title.toLowerCase()}|${i.start}`;
      if (seenIdeas.has(k)) continue;
      seenIdeas.add(k);
      out.ideas.push(i);
    }
  }
  return out;
}
