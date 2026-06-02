// Seedable PRNG. Same seed → same sequence forever. Used to make the
// simulated analytics dataset deterministic: every reload renders the
// same charts so screenshots and design review are stable.
//
// mulberry32 — small, fast, good enough for non-cryptographic UI mock data.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [min, max] inclusive. */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Power-law-ish skew toward 0: lots of low values, few high ones. */
export function powerLaw(rng: () => number, exp = 2.5): number {
  return Math.pow(rng(), exp);
}

/** Pick one item from a weighted list. */
export function weightedPick<T>(rng: () => number, items: ReadonlyArray<{ value: T; weight: number }>): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng() * total;
  for (const i of items) {
    r -= i.weight;
    if (r <= 0) return i.value;
  }
  return items[items.length - 1].value;
}
