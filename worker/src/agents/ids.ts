// Ids in the app's shape (15 chars of [a-z0-9], app/src/lib/supabase.ts newId()).
import { createHash, randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(): string {
  let s = "";
  for (let i = 0; i < 15; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** An id in the same shape derived from `key`: the same key always gives the same id. */
export function stableId(key: string): string {
  const digest = createHash("sha256").update(key).digest();
  let s = "";
  for (let i = 0; i < 15; i++) s += ALPHABET[digest[i] % ALPHABET.length];
  return s;
}
