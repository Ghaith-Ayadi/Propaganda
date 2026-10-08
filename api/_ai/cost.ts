// Pure cost and budget rules for the model gateway. No I/O, so the rules are
// testable on their own (cost.test.ts). Prices are data (public.model_prices),
// limits are data (public.cost_limits); nothing here is a constant of either.

export interface Price {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok: number;
  cacheWritePerMtok: number;
}

export interface Usage {
  /** All input tokens, cached ones included (the AI SDK's inputTokens). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** API-price cost in USD. Cache reads and writes are priced on their own rates, not as plain input. */
export function costUsd(price: Price, u: Usage): number {
  const plainInput = Math.max(0, u.inputTokens - u.cacheReadTokens - u.cacheWriteTokens);
  const usd =
    (plainInput * price.inputPerMtok +
      u.outputTokens * price.outputPerMtok +
      u.cacheReadTokens * price.cacheReadPerMtok +
      u.cacheWriteTokens * price.cacheWritePerMtok) /
    1_000_000;
  // The column keeps six decimals.
  return Math.round(usd * 1e6) / 1e6;
}

/** What public.cost_gate returns: spend so far and the limits. A null limit is off. */
export interface Gate {
  tenantMonthUsd: number;
  tenantMonthlyLimit: number | null;
  tenantWarnRatio: number;
  globalDayUsd: number;
  globalDailyLimit: number | null;
  killed: boolean;
}

export type Verdict =
  | { allow: true; warn: boolean; engageKill?: false }
  | { allow: false; reason: "kill-switch" | "global-daily-cap" | "tenant-budget"; engageKill?: boolean };

/**
 * May this call go ahead?
 *  - the kill switch blocks everything until a superadmin lifts it;
 *  - reaching the global daily cap engages the kill switch;
 *  - a tenant at 100% of its monthly budget loses background work only, the
 *    editor keeps working; at the warn ratio (default 80%) calls carry a warning.
 * With every limit null (the default) the answer is always allow.
 */
export function decide(gate: Gate, background: boolean): Verdict {
  if (gate.killed) return { allow: false, reason: "kill-switch" };
  if (gate.globalDailyLimit !== null && gate.globalDayUsd >= gate.globalDailyLimit) {
    return { allow: false, reason: "global-daily-cap", engageKill: true };
  }
  const limit = gate.tenantMonthlyLimit;
  if (limit === null) return { allow: true, warn: false };
  if (gate.tenantMonthUsd >= limit) {
    return background ? { allow: false, reason: "tenant-budget" } : { allow: true, warn: true };
  }
  return { allow: true, warn: gate.tenantMonthUsd >= limit * gate.tenantWarnRatio };
}
