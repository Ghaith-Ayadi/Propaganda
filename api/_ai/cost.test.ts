// tsx --test _ai/cost.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd, decide, type Gate } from "./cost";

const price = { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 };

test("costUsd prices plain, output and cached tokens separately", () => {
  const usd = costUsd(price, {
    inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 400_000, cacheWriteTokens: 100_000,
  });
  // 500k plain *3 + 100k out *15 + 400k read *0.3 + 100k write *3.75 = 1.5+1.5+0.12+0.375 per M
  assert.equal(usd, 3.495);
});

test("costUsd never goes negative when cached exceeds input", () => {
  assert.equal(costUsd(price, { inputTokens: 10, outputTokens: 0, cacheReadTokens: 50, cacheWriteTokens: 0 }) >= 0, true);
});

const off: Gate = {
  tenantMonthUsd: 999, tenantMonthlyLimit: null, tenantWarnRatio: 0.8,
  globalDayUsd: 999, globalDailyLimit: null, killed: false,
};

test("limits default to off: always allowed, no warning", () => {
  assert.deepEqual(decide(off, true), { allow: true, warn: false });
  assert.deepEqual(decide(off, false), { allow: true, warn: false });
});

test("tenant warns at 80%, stops background at 100%, editor keeps working", () => {
  const g = { ...off, tenantMonthlyLimit: 100 };
  assert.deepEqual(decide({ ...g, tenantMonthUsd: 79.99 }, true), { allow: true, warn: false });
  assert.deepEqual(decide({ ...g, tenantMonthUsd: 80 }, true), { allow: true, warn: true });
  assert.deepEqual(decide({ ...g, tenantMonthUsd: 100 }, true), { allow: false, reason: "tenant-budget" });
  assert.deepEqual(decide({ ...g, tenantMonthUsd: 100 }, false), { allow: true, warn: true });
});

test("global daily cap engages the kill switch; the switch blocks everything", () => {
  const g = { ...off, globalDailyLimit: 50, globalDayUsd: 50 };
  assert.deepEqual(decide(g, false), { allow: false, reason: "global-daily-cap", engageKill: true });
  assert.deepEqual(decide({ ...off, killed: true }, false), { allow: false, reason: "kill-switch" });
});
