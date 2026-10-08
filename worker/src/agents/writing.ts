// House writing rules every agent that writes for a reader follows, and the
// checks that hold drafts to them.

/**
 * Ayadi, 2026-10-07: never "That's not X. It's Y." unless absolutely necessary.
 * Say it as a comparison instead.
 */
export const HOUSE_RULES = `House rules (these override any voice guide):
1. Never use the "That's not X. It's Y." contrast, in any spelling ("It isn't X, it's Y", "This is not about X. It's about Y", "Not X. Y."). Say it as a comparison instead. Example: "That's not art. That's maintenance." becomes "This is much more of a maintenance job than it is the ol' art of writing."
2. Every number, statistic and quote links its source inline, as a Markdown link on the words it supports. No source, no number.
3. Facts about the tenant (product, prices, customers, plans, people) come only from the knowledge base claims you were given. If a fact you need isn't there, write around it and list it under "Missing facts" in your notes. Never invent one.
4. A contested claim is never stated as settled.
5. No filler openings ("In today's fast-paced world"), no closing summaries that repeat the post, no "In conclusion".`;

export interface Hit {
  sentence: string;
  rule: "not-x-its-y" | "unsourced-number";
}

/** Sentences: split after . ! ? followed by a space, so URLs and decimals stay whole. */
function sentences(paragraph: string): string[] {
  return paragraph
    .replace(/\n/g, " ")
    .split(/(?<=[.!?]["')\]]?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "That's not X. It's Y." and its family: a negated "is" followed, in the same
// or the next sentence, by a restating "it's/that's/this is".
const NEGATED = /\b(?:that|it|this|they|we|you)(?:'|’)?(?:s| is| are|re)?\s*(?:not|n't|n’t)\b|\b(?:isn['’]t|aren['’]t|wasn['’]t)\b/i;
const RESTATE = /^\s*(?:(?:but\s+)?(?:it|that|this|they)(?:['’]s| is| are|['’]re)\b|it['’]s about\b)/i;
const SAME_SENTENCE = /\b(?:is|['’]s|are)(?:\s+not|n['’]t)\s+(?:about\s+)?[^,;—–]{1,60}[,;—–]\s*(?:but\s+)?(?:it|that|this|they)(?:['’]s| is| are)\b/i;
const TERSE = /^\s*not\s+[^.]{1,40}\.\s*$/i;

export function contrastHits(markdown: string): Hit[] {
  const out: Hit[] = [];
  for (const para of markdown.split(/\n{2,}/)) {
    if (/^\s*(```|>|\|)/.test(para)) continue;
    const list = sentences(para);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const next = list[i + 1] ?? "";
      if (SAME_SENTENCE.test(s)) out.push({ sentence: s.trim(), rule: "not-x-its-y" });
      else if (NEGATED.test(s) && RESTATE.test(next) && s.length < 160) out.push({ sentence: `${s.trim()} ${next.trim()}`, rule: "not-x-its-y" });
      else if (TERSE.test(s) && next) out.push({ sentence: `${s.trim()} ${next.trim()}`, rule: "not-x-its-y" });
    }
  }
  return out;
}

const NUMBER = /(?:\b\d[\d,.]*\s?(?:%|percent|x\b|times\b|million|billion|k\b)|\$\s?\d)/i;
const LINK = /\]\((https?:\/\/[^)\s]+)\)/;

/** Sentences with a statistic and no link in the sentence (headings and code skipped). */
export function unsourcedNumbers(markdown: string): Hit[] {
  const out: Hit[] = [];
  for (const para of markdown.split(/\n{2,}/)) {
    if (/^\s*(#|```|\|)/.test(para)) continue;
    for (const s of sentences(para)) {
      if (NUMBER.test(s) && !LINK.test(s)) out.push({ sentence: s.trim(), rule: "unsourced-number" });
    }
  }
  return out;
}

export function wordCount(markdown: string): number {
  return markdown.replace(/[#>*_`[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
}
