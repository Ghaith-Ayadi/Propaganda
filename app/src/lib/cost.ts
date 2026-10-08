// Model spend, as the cost log (public.model_calls) records it: API prices in
// USD, even while the app runs on a subscription. A tenant reads its own month;
// the superadmin reads everything (components/admin/ConsumptionPage.tsx). The
// server decides who may read what; nothing here filters by account.

import { BackendError, must, sb, type Client } from "@/lib/supabase";
import { siteId } from "@/lib/scope";
import { coded, withCode } from "@/lib/errors";

export interface MonthUsage {
  spentUsd: number;
  calls: number;
  /** The tenant's monthly budget; null while none is set. */
  monthlyLimit: number | null;
  warnRatio: number;
  /** The global kill switch is on: background work is stopped for everyone. */
  killed: boolean;
}

export type BudgetState = "none" | "ok" | "warn" | "over";

export function budgetState(u: MonthUsage): BudgetState {
  if (u.monthlyLimit === null) return "none";
  if (u.spentUsd >= u.monthlyLimit) return "over";
  return u.spentUsd >= u.monthlyLimit * u.warnRatio ? "warn" : "ok";
}

/** Null while the server has no cost log yet (PostgREST: function not found): no meter, no error. */
export async function loadMonthUsage(): Promise<MonthUsage | null> {
  let r: Record<string, unknown>;
  try {
    r = (await must(sb.rpc("cost_my_month", { p_site: siteId() }))) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BackendError && err.code === "PGRST202") return null;
    throw coded("COST-USAGE", err);
  }
  return {
    spentUsd: Number(r.spent_usd),
    calls: Number(r.calls),
    monthlyLimit: r.monthly_limit === null ? null : Number(r.monthly_limit),
    warnRatio: Number(r.warn_ratio),
    killed: r.killed === true,
  };
}

export function usd(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---- superadmin ----

export interface ConsumptionRow {
  site: string;
  siteName: string;
  job: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: number;
}

export interface DayCost {
  day: string;
  costUsd: number;
}

export interface Limits {
  scope: string;
  monthlyUsd: number | null;
  dailyUsd: number | null;
  warnRatio: number;
}

export interface Killswitch {
  engaged: boolean;
  reason: string;
}

const toNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Every tenant's calls between two instants, by tenant, job and model. */
export async function loadConsumption(client: Client, from: Date, to: Date): Promise<ConsumptionRow[]> {
  const rows = (await withCode(
    "COST-ADMIN",
    must(client.rpc("cost_admin_summary", { p_from: from.toISOString(), p_to: to.toISOString() })),
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    site: String(r.site),
    siteName: String(r.site_name),
    job: String(r.job),
    model: String(r.model),
    calls: Number(r.calls),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costUsd: Number(r.cost_usd),
    unpriced: Number(r.unpriced),
  }));
}

export async function loadDaily(client: Client, from: Date, to: Date): Promise<DayCost[]> {
  const rows = (await withCode(
    "COST-ADMIN",
    must(client.rpc("cost_admin_daily", { p_from: from.toISOString(), p_to: to.toISOString() })),
  )) as Record<string, unknown>[];
  return rows.map((r) => ({ day: String(r.day), costUsd: Number(r.cost_usd) }));
}

export async function loadLimits(client: Client): Promise<{ limits: Limits[]; kill: Killswitch }> {
  const [limits, kill] = await Promise.all([
    withCode("COST-ADMIN", must(client.from("cost_limits").select("*"))),
    withCode("COST-ADMIN", must(client.from("cost_kill").select("engaged, reason").single())),
  ]);
  return {
    limits: (limits as Record<string, unknown>[]).map((r) => ({
      scope: String(r.scope),
      monthlyUsd: toNum(r.monthly_usd),
      dailyUsd: toNum(r.daily_usd),
      warnRatio: Number(r.warn_ratio),
    })),
    kill: { engaged: (kill as { engaged: boolean }).engaged, reason: (kill as { reason: string }).reason },
  };
}

export async function setLimits(client: Client, l: Limits): Promise<void> {
  await withCode(
    "COST-ADMIN",
    must(client.rpc("cost_set_limits", {
      p_scope: l.scope, p_monthly: l.monthlyUsd, p_daily: l.dailyUsd, p_warn: l.warnRatio,
    })),
  );
}

export async function liftKill(client: Client): Promise<void> {
  await withCode("COST-ADMIN", must(client.rpc("cost_lift_kill")));
}
