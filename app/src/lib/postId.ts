// Legacy post codes like "HKM·01" (`${COLLECTION_PREFIX}·${SEQ}`). Still stored
// on new posts so old links by code keep resolving (blog/data.ts), but no longer
// shown: a post's number (Post.number) and address (lib/slug.ts) replaced them.
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
