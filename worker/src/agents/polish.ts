// The twenty rules' one small call (house-style/twenty-rules.md, last section):
// code flags the sentences that break a hard rule or hold a usually-filler word,
// one call judges them and answers with rewrites only, and code keeps a rewrite
// only when it is better. Nothing fires on a clean text. Em dashes that survive
// are taken out by code: rule 13 is zero, whatever the model did.

import { askJson } from "./model.js";
import { applyPolish, applyRhythm, hardHits, noDashes, parsePolish, parseRhythm, polishItems, polishPrompt, rhythmFlags, rhythmPrompt, softHits, type PolishStats, type RhythmStats } from "./writing.js";

export interface PolishAsk {
  site: string;
  job: string;
  model: string;
  system: string;
}

/** Polishes several texts in one call (a draft, or a brief's fields); same order back. */
export async function polishTexts(step: string, ask: PolishAsk, texts: string[]): Promise<{ texts: string[]; stats: PolishStats }> {
  const items = polishItems(texts.flatMap(hardHits), texts.flatMap(softHits));
  let out = texts;
  let stats: PolishStats = { items: 0, kept: 0, rewritten: 0, refused: 0 };
  if (items.length) {
    const answers = await askJson(step, { ...ask, reasoning: "low", maxOutputTokens: 600 + 150 * items.length, prompt: polishPrompt(items) }, parsePolish);
    ({ texts: out, stats } = applyPolish(texts, items, answers));
  }
  return { texts: out.map(noDashes), stats };
}

/**
 * The rhythm pass (2026-10-24): code measures second person and sentence
 * monotony paragraph by paragraph (writing.ts, rhythmFlags), one call rewrites
 * the paragraphs over the line, and code keeps a rewrite only when the numbers
 * got better and nothing else broke. Nothing fires on a text that reads right.
 * A writing job, so it runs on the Writer's model.
 */
export async function polishRhythm(step: string, ask: PolishAsk, markdown: string): Promise<{ markdown: string; stats: RhythmStats | null }> {
  const flags = rhythmFlags(markdown);
  if (flags.length === 0) return { markdown, stats: null };
  const answers = await askJson(step, { ...ask, maxOutputTokens: 1000 + 400 * flags.length, prompt: rhythmPrompt(flags) }, parseRhythm);
  const { markdown: out, stats } = applyRhythm(markdown, flags, answers);
  return { markdown: noDashes(out), stats };
}
