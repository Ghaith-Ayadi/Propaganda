// Plain-text helpers the agents share. No model, no database: unit-tested.

/** A post's markdown as passages: paragraphs, headings and list items, without images or code. */
export function passages(markdown: string, max = 200): string[] {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 20)
    .slice(0, max);
}

/** Links in the post, each with the sentence around it (what the link is meant to back). */
export function links(markdown: string, max = 6): { url: string; context: string }[] {
  const out: { url: string; context: string }[] = [];
  const seen = new Set<string>();
  // Images aren't sources: blank them out, keeping offsets.
  markdown = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, (m) => " ".repeat(m.length));
  const re = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|(?<![(\w])(https?:\/\/[^\s)<>\]]+)/g;
  for (const m of markdown.matchAll(re)) {
    const url = (m[2] ?? m[3] ?? "").replace(/[.,;:]+$/, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const at = m.index ?? 0;
    const from = Math.max(0, markdown.lastIndexOf("\n", at) + 1, at - 300);
    const nl = markdown.indexOf("\n", at);
    const to = Math.min(nl < 0 ? markdown.length : nl, at + m[0].length + 300);
    out.push({ url, context: markdown.slice(from, to).replace(/\s+/g, " ").trim() });
    if (out.length >= max) break;
  }
  return out;
}

/** A fetched page as text: no tags, scripts or styles, collapsed whitespace. */
export function htmlToText(html: string, max = 12000): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const HEDGE = /\b(about|around|roughly|approximately|nearly|almost|over|under|more than|less than|up to|some)\s*$/i;

/** Numbers as written in a text ("300", "2.5", "1,200"), with the hedge word before each, if any. */
function numbers(text: string): { value: string; hedged: boolean }[] {
  const out: { value: string; hedged: boolean }[] = [];
  for (const m of text.matchAll(/~?\d[\d,]*(?:\.\d+)?/g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
    out.push({ value: m[0].replace(/^~/, "").replace(/,/g, ""), hedged: m[0].startsWith("~") || HEDGE.test(before) });
  }
  return out;
}

/**
 * C5, mechanically: every number in the claim appears in a quote, and a number
 * the quote hedges ("about 300") is hedged in the claim too. A hint for the
 * Guardian, not a ruling: "two weeks" and "2 weeks" are its call.
 */
export function numbersMatch(claim: string, quotes: string[]): { ok: boolean; problems: string[] } {
  const inQuotes = quotes.flatMap(numbers);
  const problems: string[] = [];
  for (const n of numbers(claim)) {
    const found = inQuotes.filter((q) => q.value === n.value);
    if (!found.length) problems.push(`${n.value} is not in any quote`);
    else if (!n.hedged && found.every((q) => q.hedged)) problems.push(`the quote hedges ${n.value}, the claim doesn't`);
  }
  return { ok: problems.length === 0, problems };
}
