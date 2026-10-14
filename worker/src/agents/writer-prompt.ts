// The Writer's prompt pieces, apart from the workflow so the Arena (arena.ts)
// can ask any model for the same draft without loading DBOS.

import { obj, str, strs } from "./model.js";
import { HOUSE_RULES, TITLE_RULES, wordCount } from "./writing.js";
import type { BriefRow } from "./store.js";

export interface Draft {
  title: string;
  subtitle: string;
  excerpt: string;
  markdown: string;
  missingFacts: string[];
}

export function parseDraft(v: unknown): Draft {
  const o = obj(v, "The answer");
  const markdown = str(o.markdown, "markdown");
  if (wordCount(markdown) < 300) throw new Error("markdown is too short to be the full post.");
  return {
    title: str(o.title, "title", { max: 200 }),
    subtitle: str(o.subtitle, "subtitle", { optional: true, max: 300 }),
    excerpt: str(o.excerpt, "excerpt", { optional: true, max: 500 }),
    markdown,
    missingFacts: strs(o.missingFacts, "missingFacts", { optional: true }).slice(0, 20),
  };
}

export function writerSystem(voice: string): string {
  return `You are the Writer for Propaganda: you write blog posts for a tenant, in the tenant's voice, from an approved brief. Your three concerns are tone, voice and veracity.

${HOUSE_RULES}

${TITLE_RULES}

The tenant's voice guide (follow it closely):

${voice}`;
}

export function briefBlock(b: BriefRow): string {
  const notes = (b.notes ?? []).map((n) => {
    const line = n.lineId ? (b.outline ?? []).find((l) => l.id === n.lineId)?.text : null;
    return `- ${line ? `On "${line}": ` : ""}${n.text}`;
  });
  return [
    `Title: ${b.title}`,
    b.angle && `Angle: ${b.angle}`,
    b.audience && `Audience: ${b.audience}`,
    b.length && `Length: ${b.length}`,
    b.outline?.length ? `Outline:\n${b.outline.map((l, i) => `${i + 1}. ${l.text}`).join("\n")}` : b.body,
    notes.length ? `Reviewer notes on the pitch (do what they say):\n${notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

