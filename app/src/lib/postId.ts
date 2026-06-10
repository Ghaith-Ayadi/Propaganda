// Post identifier scheme: `${COLLECTION_PREFIX}·${SEQ}` — e.g. "HKM·01".
//
//  - prefix: first 3 consonants of the collection name (upper-case),
//    falling back to any letters when the name doesn't have enough.
//  - seq: collection-scoped sequential id, zero-padded to 2 digits.

const VOWELS = new Set("aeiouyAEIOUY");

export function collectionPrefix(name: string | null | undefined): string {
  if (!name) return "XXX";
  const letters = [...name].filter((ch) => /[a-zA-Z]/.test(ch));
  const consonants = letters.filter((ch) => !VOWELS.has(ch));
  const pool = consonants.length >= 3 ? consonants : letters;
  const picked = pool.slice(0, 3).join("").toUpperCase();
  if (picked.length === 3) return picked;
  // Pad shorter pools (e.g. one-letter names) with X.
  return (picked + "XXX").slice(0, 3);
}

export function padSeq(seq: number | null | undefined): string {
  const n = seq ?? 0;
  return n.toString().padStart(2, "0");
}

export function postSlug(collectionName: string, seq: number | null | undefined): string {
  return `${collectionPrefix(collectionName)}·${padSeq(seq)}`;
}

/**
 * Derive a URL slug from a post title.
 * Lowercases, replaces spaces/special chars with hyphens, collapses runs.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")  // strip non-word, non-space, non-hyphen
    .replace(/[\s_]+/g, "-")   // spaces/underscores → hyphens
    .replace(/-+/g, "-")       // collapse multiple hyphens
    .replace(/^-|-$/g, "")     // trim leading/trailing hyphens
    || "untitled";
}

/**
 * Make `base` unique against the `taken` set by appending `-2`, `-3`, … until
 * it no longer collides. `posts.slug` carries a UNIQUE index, so any derived
 * slug has to be deduped before it hits the DB.
 */
export function dedupeSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
