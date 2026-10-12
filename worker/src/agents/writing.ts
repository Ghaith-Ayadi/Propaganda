// House writing rules every agent that writes for a reader follows, and the
// checks that hold drafts, titles and topic names to them.

import { DASH, HOUSE_STYLE, stripDashes } from "../../../api/_ai/houseStyle";

/**
 * Ayadi, 2026-10-07: never "That's not X. It's Y." unless absolutely necessary.
 * Ayadi, 2026-10-12: the twenty rules for human text (HOUSE_STYLE, shared with
 * Chat in api/_ai/houseStyle.ts). The checks below hold the ones a pattern can
 * catch: hard rules always (a regex, zero tolerance), soft rules only flagged
 * for a model to judge (softHits, polishPrompt).
 */
export const HOUSE_RULES = `House rules (these override any voice guide):
1. Every number, statistic and quote links its source inline, as a Markdown link on the words it supports. No source, no number.
2. Facts about the tenant (product, prices, customers, plans, people) come only from the knowledge base claims you were given. If a fact you need isn't there, write around it and list it under "Missing facts" in your notes. Never invent one.
3. A contested claim is never stated as settled.

${HOUSE_STYLE}`;

export { HOUSE_STYLE };

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
- No em dash, ever (rule 13), and none of "the hard part is" and its family (rule 18).
- Short: a reader scans it. Under about twelve words, usually fewer.
Good: "Your blog, newsletter and LinkedIn disagree because they were written three times". "One post a week beats eight posts and then silence". "What a founder should ask an AI content tool before paying for it".
Bad: "The writing is the easy part: what a founder without a marketing team should ask an AI content tool before paying for it". "Your sales calls already contain next month's posts: turning meeting transcripts into content prospects asked for". "Consistency isn't a calendar problem. Your blog, newsletter and LinkedIn disagree".`;

export interface Hit {
  sentence: string;
  rule: "not-x-its-y" | "unsourced-number" | "quietly" | "two-part" | "ing-half" | "lead-in" | "em-dash" | "announcer";
}

/** The house rule each hit breaks, as the model is told it. */
export const RULE_NAMES: Record<Hit["rule"], string> = {
  "not-x-its-y": 'the "That\'s not X. It\'s Y." contrast (rule 2): say it as a comparison',
  "unsourced-number": "a number with no source link (house rule 1)",
  quietly: 'the word "quietly" (rule 6): drop it, or give what nobody noticed a sentence of its own',
  "two-part": 'a two-part "Thing: explanation" title (rule 11): make it one plain statement',
  "ing-half": "a second half that starts with an -ing verb (rule 11): say what the post says, once",
  "lead-in": 'a lead-in sentence set up to be knocked down ("X isn\'t a Y problem") (rule 1): delete it, keep the sentence that carries the point',
  "em-dash": "an em dash (rule 13): zero em dashes; use a comma, a period or parentheses, or split the sentence",
  announcer: '"the hard part is" or its family (rule 18): delete the announcement and say the thing',
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
// An abbreviation's period is not a break: "U.S. tariffs", "Blog vs. newsletter", "e.g.".
const BREAK = /(?<![\d/])(?<!\b[A-Za-z])(?<!\bvs|\be\.g|\bi\.e|\betc)(?::|\s?[—–]\s?|\s-\s|(?<=\S)[?!.])(?!\d|\/)\s*(?=\S)/;
const isName = (s: string) => (/^\S+(?:\s+\S+){0,2}$/.test(s) && /\d/.test(s)) || /^\S+\s+[A-Z]\S*$/.test(s);
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

// ---- the twenty rules (2026-10-12): hard checks, soft flags, the judge ----

// Rule 18's family, eradicated (Ayadi: "we should eradicate the hard part and its
// siblings"). "The key is" stays a soft flag: "the key is stored" is an API key.
const ANNOUNCER = /\b(?:the\s+(?:hard|easy|tricky|difficult|simple|fun|boring)\s+part\s+(?:is|was|isn['’]t)|the\s+real\s+(?:problem|question|issue|work|challenge|job|story|test)\s+(?:is|was)|the\s+(?:trick|secret|truth|catch|kicker)\s+(?:is|was|here)|here['’]s\s+the\s+(?:thing|kicker|catch|truth|deal)|the\s+thing\s+is\b)/i;

/** Text with fenced code blocks and inline code taken out: no rule reads code. */
function prose(text: string): string {
  return text.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

/** Every sentence of a text, headings and list lines included, code left out. */
function allSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of prose(text).split(/\n{2,}/)) {
    for (const line of para.split(/\n(?=\s*(?:#|[-*+]\s|\d+[.)]\s|>|\|))/)) {
      out.push(...sentences(line.replace(/^\s*(?:#+|[-*+]|\d+[.)]|>)\s*/, "")));
    }
  }
  return out;
}

/**
 * The hard rules the full-post fix doesn't cover, sentence by sentence: an em dash
 * (rule 13) and "the hard part is" and its family (rule 18). Zero tolerance.
 */
export function hardHits(text: string): Hit[] {
  const out: Hit[] = [];
  for (const s of allSentences(text)) {
    if (DASH.test(s)) out.push({ sentence: s, rule: "em-dash" });
    if (ANNOUNCER.test(s)) out.push({ sentence: s, rule: "announcer" });
  }
  return out;
}

/** The title rules with the twenty rules' hard checks on top: titleHits() plus an em dash or an announcer. */
export function houseTitleHits(title: string): Hit[] {
  const t = title.trim();
  const out = titleHits(t);
  if (DASH.test(t)) out.push({ sentence: t, rule: "em-dash" });
  if (ANNOUNCER.test(t)) out.push({ sentence: t, rule: "announcer" });
  return out;
}

/** Rule 13 with no exceptions: every em dash out of a text, code left alone. The last resort after a rewrite. */
export function noDashes(text: string): string {
  if (!DASH.test(text)) return text;
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : stripDashes(part)))
    .join("");
}

export type SoftRule = "adverb" | "intensifier" | "marketing" | "opener" | "drumroll" | "label-list" | "announce" | "crowd";

/** A word or frame that is usually filler and sometimes doing work: a model decides which. */
export interface Flag {
  sentence: string;
  rule: SoftRule;
  word: string;
}

export const SOFT_RULE_NAMES: Record<SoftRule, string> = {
  adverb: 'rule 6, an adverb in the "quietly" family that says nothing checkable',
  intensifier: "rule 7, an intensifier or reassurance",
  marketing: "rule 8, a software-marketing word with a plain word underneath",
  opener: "rule 12, a curtain-raiser or curtain call",
  drumroll: "rule 14, a drumroll: a rhetorical question, a teaser or a staccato fragment",
  "label-list": 'rule 15, a list item that opens with a bold label and a colon ("**Voice:** ...")',
  announce: 'rule 18, an announcement in front of the point ("it\'s worth noting")',
  crowd: "rule 20, a crowd noun where one reader or a named one belongs",
};

// Each list is what the twenty rules name, plus the forms a model writes.
const SOFT: { rule: SoftRule; re: RegExp }[] = [
  { rule: "adverb", re: /\b(?:silently|subtly|seamlessly|effortlessly)\b/i },
  { rule: "intensifier", re: /\b(?:actually|really|literally|truly|genuinely|directly|honestly|absolutely|incredibly)\b/i },
  {
    rule: "marketing",
    re: /\b(?:leverag(?:e|es|ed|ing)|robust|streamlin(?:e|es|ed|ing)|unlock(?:s|ed|ing)?|empower(?:s|ed|ing|ment)?|elevat(?:e|es|ed|ing)|landscapes?|ecosystems?|journeys?|game[- ]chang(?:er|ers|ing)|navigat(?:e|es|ed|ing)|delv(?:e|es|ed|ing)|crucial|seamless|cutting[- ]edge|holistic|key)\b/i,
  },
  {
    rule: "opener",
    re: /\b(?:in today['’]s\b|let['’]s (?:dive|explore|unpack|break (?:it|this) down|take a (?:closer )?look)|dive (?:in|into)\b|in conclusion|to sum up|in summary|the bottom line|at the end of the day|in a world where|without further ado)/i,
  },
  { rule: "drumroll", re: /(?:\bsound familiar\?|\bhere['’]s why\b|^(?:the|your) (?:result|answer|catch|twist)\?|\bwhy does (?:this|it|that) matter\?|\bso what does (?:this|that|it) mean\b|\bguess what\b|\bever (?:wondered|published|written|tried)\b[^?]*\?)/i },
  {
    rule: "announce",
    re: /\b(?:it['’]s worth (?:noting|mentioning|remembering|pointing out)|importantly|crucially|notably|needless to say|it goes without saying|it['’]s important to (?:note|understand|remember|realize|recognize)|what this means (?:is|for)\b|the key (?:is|to)\b)/i,
  },
  { rule: "crowd", re: /\b(?:businesses|organi[sz]ations|enterprises|stakeholders|users|industry leaders)\b/i },
];
const LABEL_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*[^*\n]{1,40}\*\*\s*:|\*\*[^*\n]{1,40}:\*\*|__[^_\n]{1,40}__\s*:)/;

/**
 * Rules 6 (the "quietly" family), 7, 8, 12, 14, 15, 18 and 20: every sentence
 * holding a word or frame that is usually filler, with the rule it tripped. Code
 * only flags; judgeAnswer() keeps the word when a model says it is doing work
 * ("key" in "your API key", "journey" in a post about travel). Empty on a clean text.
 */
export function softHits(text: string): Flag[] {
  const out: Flag[] = [];
  const clean = prose(text);
  for (const line of clean.split("\n")) {
    if (LABEL_LINE.test(line)) out.push({ sentence: line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ""), rule: "label-list", word: line.match(/\*\*([^*]+)\*\*|__([^_]+)__/)?.[0] ?? "" });
  }
  for (const para of clean.split(/\n{2,}/)) {
    if (/^\s*\|/.test(para)) continue;
    const list = allSentences(para);
    for (const [i, s] of list.entries()) {
      for (const { rule, re } of SOFT) {
        const found = [...new Set(s.match(new RegExp(re.source, "gi")) ?? [])];
        if (!found.length) continue;
        // A rhetorical question goes with its answer: deleting the question alone leaves "Because ..." behind.
        const pair = rule === "drumroll" && /\?$/.test(s) && list[i + 1] ? `${s} ${list[i + 1]}` : s;
        out.push({ sentence: pair, rule, word: found.join('", "') });
      }
    }
    // Staccato: three or more sentences in a row of three words or fewer ("Fast. Simple. True.").
    for (let i = 0; i + 2 < list.length; i++) {
      if ([0, 1, 2].every((k) => words(list[i + k]) <= 3)) {
        out.push({ sentence: list.slice(i, i + 3).join(" "), rule: "drumroll", word: "staccato fragments" });
        i += 2;
      }
    }
  }
  return out;
}

/** One judged item: a sentence and every flag or hard hit on it. */
export interface PolishItem {
  n: number;
  sentence: string;
  /** A hard rule broke: the sentence must change. */
  must: boolean;
  why: string[];
}

/** The flags and hits of a text, one item per sentence, hard hits first. Empty means no call. */
export function polishItems(hard: Hit[], soft: Flag[]): PolishItem[] {
  const by = new Map<string, PolishItem>();
  const add = (sentence: string, must: boolean, why: string) => {
    const item = by.get(sentence) ?? { n: 0, sentence, must: false, why: [] };
    item.must ||= must;
    if (!item.why.includes(why)) item.why.push(why);
    by.set(sentence, item);
  };
  for (const h of hard) add(h.sentence, true, RULE_NAMES[h.rule]);
  for (const f of soft) add(f.sentence, false, `"${f.word}": ${SOFT_RULE_NAMES[f.rule]}`);
  return [...by.values()].sort((a, b) => Number(b.must) - Number(a.must)).map((item, i) => ({ ...item, n: i + 1 }));
}

/** The one small call: judge each flagged sentence, rewrite only what breaks a rule. */
export function polishPrompt(items: PolishItem[]): string {
  return `A draft was checked against the twenty rules. Code flagged these sentences; code can't tell whether a flagged word is filler or doing work, you can.

${items.map((i) => `${i.n}. ${i.must ? "[must change] " : ""}"${i.sentence}"\n   ${i.why.join("\n   ")}`).join("\n")}

For each one: if the flagged word or frame is doing real work in that sentence ("key" in "your API key", a question the next sentence answers, a quote someone said), leave it out of your answer. If it is filler or a tell, rewrite the sentence by the rules, keeping its meaning, its facts, its links and the voice. A sentence marked [must change] breaks a hard rule and always gets a rewrite. An opener, closer, drumroll or announcement that says nothing may be deleted: give an empty rewrite. Never add an em dash.

Answer with JSON only, listing only the sentences you changed: {"rewrites": [{"n": 1, "rewrite": "..."}]}`;
}

export interface PolishAnswer {
  n: number;
  rewrite: string;
}

export function parsePolish(v: unknown): PolishAnswer[] {
  const list = (v && typeof v === "object" && Array.isArray((v as { rewrites?: unknown }).rewrites) ? (v as { rewrites: unknown[] }).rewrites : []) as unknown[];
  return list
    .filter((r): r is { n: unknown; rewrite: unknown } => Boolean(r) && typeof r === "object")
    .map((r) => ({ n: Number(r.n), rewrite: typeof r.rewrite === "string" ? r.rewrite.trim() : "" }))
    .filter((r) => Number.isInteger(r.n) && r.n > 0);
}

/** What the judge did with the flags, for the version's lint and the A/B: how often a flagged word was kept. */
export interface PolishStats {
  items: number;
  /** Soft-only sentences the judge left as they were: the flagged word was doing work. */
  kept: number;
  rewritten: number;
  /** Rewrites refused by code: a hard rule still broke, nothing got better, or the sentence wasn't found. */
  refused: number;
}

const DELETABLE = /rule (?:12|14|18),/;

/** Replace one sentence in a text, whatever whitespace the text has between its words. */
function replaceSentence(text: string, sentence: string, rewrite: string): string | null {
  const loose = new RegExp(sentence.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+") + (rewrite ? "" : "[ \\t]*"));
  if (!loose.test(text)) return null;
  return text.replace(loose, () => rewrite);
}

/**
 * Applies the judge's rewrites to a text. A rewrite is kept only when it breaks
 * no hard rule and carries fewer flags than the sentence it replaces; an empty
 * one deletes the sentence only for an opener, a drumroll or an announcement.
 */
export function applyPolish(texts: string[], items: PolishItem[], answers: PolishAnswer[]): { texts: string[]; stats: PolishStats } {
  const stats: PolishStats = { items: items.length, kept: 0, rewritten: 0, refused: 0 };
  const answered = new Map(answers.map((a) => [a.n, a.rewrite]));
  const out = [...texts];
  for (const item of items) {
    const rewrite = answered.get(item.n);
    if (rewrite === undefined) {
      if (!item.must) stats.kept++;
      continue;
    }
    const before = hardHits(item.sentence).length + styleHits(item.sentence).length;
    const ok =
      rewrite === ""
        ? !item.must && item.why.every((w) => DELETABLE.test(w))
        : hardHits(rewrite).length + styleHits(rewrite).length === 0 &&
          (before > 0 || softHits(rewrite).length < softHits(item.sentence).length || softHits(item.sentence).length === 0) &&
          rewrite.length < item.sentence.length * 3 + 80;
    let done = false;
    for (let i = 0; ok && !done && i < out.length; i++) {
      const next = replaceSentence(out[i], item.sentence, rewrite);
      if (next !== null) {
        out[i] = next.replace(/\n{3,}/g, "\n\n").trim();
        done = true;
      }
    }
    if (done) stats.rewritten++;
    else stats.refused++;
  }
  return { texts: out, stats };
}
