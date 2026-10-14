// One idea, one budget (Strategist and goals thread, 2026-10-14). A site, a
// plan or a brief that mentions an idea once can make it the whole strategy:
// "contradicts the pricing page" went from one example on the tenant's site to
// a topic, then to most pitches and every draft. Slogan checks only catch the
// same sentence repeated; this catches the same idea in different words, at the
// points where one output feeds the next (topics, a batch of pitches, a draft).
// It is plain code: no model, no store, nothing about any tenant.


/** Words every tenant's content shares; an idea made of these is the subject, not a motif. */
const COMMON = new Set(
  "that than then them they their there these this those what when where which while with without would your from have into over such will about after all also always any back because been before best better both build built come could day does done each even every first from get give goes good great have here into just keep know last like long look made make many more most much must need never new next not now one only other over own part people real same see should since some still such take than them then these they thing think this time use used very want way well were what when which while who will with work would year your post posts company companies being nobody someone anyone founder founders blog blogs content write writing wrote".split(
    " ",
  ),
);

const words = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

/** A word's root, so price, prices and pricing are one idea. */
export function root(word: string): string {
  const w = word.toLowerCase();
  for (const s of ["ing", "ed", "es", "s", "e"]) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length);
  return w;
}

/** The ideas in a text: the roots of its content words. */
export function ideas(text: string): Set<string> {
  return new Set(words(text).map(root).filter((r) => r.length >= 4 && !COMMON.has(r)));
}

export interface Motif {
  /** The root, e.g. "pric". */
  idea: string;
  /** A word that carries it, e.g. "price". */
  word: string;
  /** Indexes of the items that carry it. */
  items: number[];
}

/**
 * The ideas that more than `max` of the items carry. `own` is the tenant's own
 * subject (its name, its searches, its category): those words are expected
 * everywhere and never flagged. Biggest first.
 */
export function sharedIdeas(items: string[], opts: { max: number; own?: string[] }): Motif[] {
  const own = new Set((opts.own ?? []).flatMap((t) => [...ideas(t)]));
  const found = new Map<string, { words: Map<string, number>; items: number[] }>();
  type Found = { words: Map<string, number>; items: number[] };
  items.forEach((text, i) => {
    const seen = new Set<string>();
    for (const w of words(text)) {
      const r = root(w);
      if (r.length < 4 || COMMON.has(r) || own.has(r) || seen.has(r)) continue;
      seen.add(r);
      const f: Found = found.get(r) ?? { words: new Map<string, number>(), items: [] };
      f.words.set(w, (f.words.get(w) ?? 0) + 1);
      f.items.push(i);
      found.set(r, f);
    }
  });
  return [...found.entries()]
    .filter(([, f]) => f.items.length > opts.max)
    .map(([idea, f]) => ({ idea, word: [...f.words.entries()].sort((a, b) => b[1] - a[1])[0][0], items: f.items }))
    .sort((a, b) => b.items.length - a.items.length || a.idea.localeCompare(b.idea));
}

/** How many times each idea recurs in one text (a draft), counting every mention. */
export function mentions(text: string): Map<string, { word: string; count: number }> {
  const out = new Map<string, { word: string; count: number }>();
  for (const w of words(text)) {
    const r = root(w);
    if (r.length < 4 || COMMON.has(r)) continue;
    const e = out.get(r) ?? { word: w, count: 0 };
    e.count++;
    out.set(r, e);
  }
  return out;
}

/**
 * The ideas a tenant's pipeline already leans on: carried by more than a
 * quarter of its titles (and by at least three). Nothing is flagged until
 * there are six titles, because three titles about one subject is a subject.
 */
export function overusedIdeas(titles: string[], own: string[] = []): Motif[] {
  if (titles.length < 6) return [];
  return sharedIdeas(titles, { max: Math.max(2, Math.floor(titles.length / 4)), own });
}

/** One line for a prompt: the ideas to keep out of the centre of the next piece. */
export function overusedLine(m: Motif[]): string {
  return m.length ? m.slice(0, 5).map((x) => `"${x.word}" (${x.items.length})`).join(", ") : "";
}
