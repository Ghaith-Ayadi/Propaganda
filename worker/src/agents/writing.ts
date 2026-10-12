// House writing rules every agent that writes for a reader follows, and the
// checks that hold drafts, titles and topic names to them.

/**
 * Ayadi, 2026-10-07: never "That's not X. It's Y." unless absolutely necessary.
 * Say it as a comparison instead.
 * Ayadi, 2026-10-12, after the third PPGD strategy run: the title and sentence
 * frames below (TITLE_RULES) are the signature of machine writing; cut them.
 */
export const HOUSE_RULES = `House rules (these override any voice guide):
1. Never use the "That's not X. It's Y." contrast, in any spelling ("It isn't X, it's Y", "This is not about X. It's about Y", "Not X. Y."). Say it as a comparison instead. Example: "That's not art. That's maintenance." becomes "This is much more of a maintenance job than it is the ol' art of writing."
2. Every number, statistic and quote links its source inline, as a Markdown link on the words it supports. No source, no number.
3. Facts about the tenant (product, prices, customers, plans, people) come only from the knowledge base claims you were given. If a fact you need isn't there, write around it and list it under "Missing facts" in your notes. Never invent one.
4. A contested claim is never stated as settled.
5. No filler openings ("In today's fast-paced world"), no closing summaries that repeat the post, no "In conclusion".
6. Never the word "quietly".
7. No lead-in sentence that the next sentence doesn't need. "Consistency isn't a calendar problem. Your blog, newsletter and LinkedIn disagree because they were written three times" is one good sentence with a decoy in front of it: nothing in it is about a calendar. Write the second sentence and delete the first. A sentence that can be cut without losing the argument is cut.`;

/**
 * How a title, a topic name, a subhead or a subtitle is written. Shared by the
 * Strategist (topic names), the Pitcher (brief titles) and the Writer (titles,
 * subtitles, subheads); titleHits() holds them to it.
 */
export const TITLE_RULES = `A title, topic name, subtitle or subhead is one plain statement, the way the founder would say it out loud. Rules:
- One part, not two. No "Thing: explanation", no "Question? Answer", no "Statement. Statement". The two-part form is allowed only when the first part is a name that needs the rest ("Propaganda 2.0: social is here"); a sentence with a colon in the middle is never that.
- Never a second half that starts with an -ing verb ("Fast servers on Windows? Turning a machine into..."; "...: turning meeting transcripts into content"). Say what the post says, once.
- Never a negation set up to be knocked down ("X isn't a Y problem", "This is not about X"), in a title or anywhere else.
- Never the word "quietly".
- Short: a reader scans it. Under about twelve words, usually fewer.
Good: "Your blog, newsletter and LinkedIn disagree because they were written three times". "One post a week beats eight posts and then silence". "What a founder should ask an AI content tool before paying for it".
Bad: "The writing is the easy part: what a founder without a marketing team should ask an AI content tool before paying for it". "Your sales calls already contain next month's posts: turning meeting transcripts into content prospects asked for". "Consistency isn't a calendar problem. Your blog, newsletter and LinkedIn disagree".`;

export interface Hit {
  sentence: string;
  rule: "not-x-its-y" | "unsourced-number" | "quietly" | "two-part" | "ing-half" | "lead-in";
}

/** The house rule each hit breaks, as the model is told it. */
export const RULE_NAMES: Record<Hit["rule"], string> = {
  "not-x-its-y": 'the "That\'s not X. It\'s Y." contrast (house rule 1): say it as a comparison',
  "unsourced-number": "a number with no source link (house rule 2)",
  quietly: 'the word "quietly" (house rule 6): drop it or say what actually happened',
  "two-part": 'a two-part "Thing: explanation" title (title rules): make it one plain statement',
  "ing-half": "a second half that starts with an -ing verb (title rules): say what the post says, once",
  "lead-in": 'a lead-in sentence set up to be knocked down ("X isn\'t a Y problem") (house rule 7): delete it, keep the sentence that carries the point',
};

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

// ---- titles, topic names, subtitles, subheads ----

// Ayadi, 2026-10-12. Three frames engineers love and readers skim past:
// "Thing: explanation", "catchy phrase? Verb-ing what it actually is", and a
// negation in front of the sentence that carries the point. "quietly" too.

const QUIETLY = /\bquietly\b/i;
// A two-part title: a colon, a dash, or a sentence break with text on both sides.
// "10:30" and "https://" are not breaks. The first part may be a short name
// ("Propaganda 2.0", "Q4 goals"): up to three words, so "Propaganda 2.0: social is
// here" passes and "The writing is the easy part: what a founder..." does not.
const BREAK = /(?<![\d/])(?::|\s[—–-]\s|(?<=\S)[?!.])(?!\d|\/)\s*(?=\S)/;
const NAME = /^\S+(?:\s+\S+){0,2}$/;
const isName = (s: string) => NAME.test(s) && (/\d/.test(s) || /\s[A-Z]/.test(s));
// The first word after the break ending in -ing (a verb, not "thing"/"nothing"/"string").
const ING = /^\W*(?:(?:[a-z]+ing)(?!\w))/i;
const NOT_VERBS = new Set(["thing", "something", "nothing", "anything", "everything", "king", "ring", "string", "spring", "wing", "sing", "bring", "morning", "evening", "during", "ceiling", "building", "meeting", "feeling", "being"]);
// "X isn't a Y problem." / "This is not about X." as a sentence of its own.
const LEAD_IN = /^[^.!?]{0,60}?\b(?:isn['’]t|is not|aren['’]t|are not|was never|isn['’]t really|is no longer)\b(?:\s+(?:a|an|the|about|just|only|really|some|your|our))*\s+[^.!?]{0,40}?\b(?:problem|question|issue|thing|matter|game|story|job|feature|bug|choice|tool|trick|race|fight|battle)\b\s*[.!?]?$/i;

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** The problems in a title, topic name, subtitle or subhead. Empty means it passes. */
export function titleHits(title: string): Hit[] {
  const out: Hit[] = [];
  const t = title.trim();
  if (!t) return out;
  if (QUIETLY.test(t)) out.push({ sentence: t, rule: "quietly" });
  const parts = t.split(BREAK).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const [first, second] = parts;
    const firstWord = second.match(ING)?.[0].replace(/^\W+/, "").toLowerCase();
    if (firstWord && !NOT_VERBS.has(firstWord)) out.push({ sentence: t, rule: "ing-half" });
    else if (LEAD_IN.test(first) || /^(?:not|no)\b/i.test(first)) out.push({ sentence: t, rule: "lead-in" });
    else if (!isName(first) || /[?!.]\s*$/.test(first)) out.push({ sentence: t, rule: "two-part" });
  } else if (LEAD_IN.test(t)) out.push({ sentence: t, rule: "lead-in" });
  return out;
}

/**
 * The prose problems contrastHits() doesn't see: "quietly" anywhere, and a
 * paragraph that opens with a negation set up to be knocked down. Headings are
 * checked as titles.
 */
export function proseHits(markdown: string): Hit[] {
  const out: Hit[] = [];
  for (const para of markdown.split(/\n{2,}/)) {
    if (/^\s*(```|>|\|)/.test(para)) continue;
    if (/^\s*#/.test(para)) {
      out.push(...titleHits(para.replace(/^\s*#+\s*/, "")));
      continue;
    }
    const list = sentences(para);
    for (const s of list) {
      if (QUIETLY.test(s)) out.push({ sentence: s, rule: "quietly" });
    }
    if (list.length > 1 && words(list[0]) <= 12 && LEAD_IN.test(list[0])) out.push({ sentence: `${list[0]} ${list[1]}`, rule: "lead-in" });
  }
  return out;
}

/** Every house-rule problem in a draft's prose: the contrast, "quietly", lead-ins, two-part subheads. */
export function styleHits(markdown: string): Hit[] {
  return [...contrastHits(markdown), ...proseHits(markdown)];
}
