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

/**
 * An assigned post's body is the writing it came with (the plugin, Assign posts,
 * a person who put everything in the brief), not a few lines of brief: the
 * Writer treats it as source material. The origin says so; failing that, a
 * long body with no outline does.
 */
export function hasSourceMaterial(b: Pick<BriefRow, "origin" | "body" | "outline">): boolean {
  if (b.origin === "assigned") return b.body.trim().length > 0;
  return !b.outline?.length && b.body.trim().length >= 1200;
}

export function briefBlock(b: BriefRow): string {
  const notes = (b.notes ?? []).map((n) => {
    const line = n.lineId ? (b.outline ?? []).find((l) => l.id === n.lineId)?.text : null;
    const on = n.quote || line;
    return `- ${on ? `On "${on}": ` : ""}${n.text}`;
  });
  const images = (b.sources ?? []).filter((s) => s.kind === "image");
  const pdfs = (b.sources ?? []).filter((s) => s.kind === "pdf");
  return [
    `Title: ${b.title}`,
    b.angle && `Angle: ${b.angle}`,
    b.audience && `Audience: ${b.audience}`,
    b.length && `Length: ${b.length}`,
    b.outline?.length
      ? `Outline:\n${b.outline.map((l, i) => `${i + 1}. ${l.text}`).join("\n")}`
      : hasSourceMaterial(b)
        ? `Source material, from the tenant (the primary source for this post: its facts are the tenant's own and may be used as they are; keep its argument, its examples and its order, and write the post from it rather than beside it; where it already reads as a finished post, edit it into the house voice instead of writing another):\n${b.body}`
        : b.body,
    images.length ? `Images to place in the post, each where it belongs (Markdown):\n${images.map((s) => `![${s.label}](${s.url})`).join("\n")}` : "",
    pdfs.length ? `Documents attached (you can't open them here; say in your facts list what you needed from them):\n${pdfs.map((s) => `- ${s.label}`).join("\n")}` : "",
    notes.length ? `Reviewer notes on the pitch (do what they say):\n${notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

